/**
 * The calculation library — server side.
 *
 * Client requirement: every calculator asks for a property name, and every
 * completed calculation is saved to an archive the member can open again.
 * Ruled shape: property name REQUIRED; a re-run saves a NEW entry; typed and
 * form calculations are both saved.
 *
 * Pinned here:
 *   - the /calculations routes are owner-scoped exactly like /chats (another
 *     owner's entry is 404, never 403; owner_key never round-trips)
 *   - search is by property name, case-insensitive, wildcard-safe
 *   - saving happens in executeTool, for the seeded (form) and model (typed)
 *     paths alike, and ONLY after the calculator actually produced a result
 *   - a library outage never costs the member their numbers
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { OWNER_KEY_HEADER } from '../src/server/ownerKey.js';
import {
  createCalculationLibrary,
  headlineFor,
  propertyKey,
  type CalculationLibrary,
  type CalculationToSave,
  type SavedCalculation,
} from '../src/server/calculations.js';
import { runAgent } from '../src/agent/agent.js';
import { CALCULATOR_FORMS } from '../src/agent/formSchema.js';
import { calculationRecord, makeCalculationsSupabase } from './helpers/calculationsFake.js';
import { makeFakeOpenAI, makeFakeSupabase, flushDetached } from './helpers/fakes.js';

const OWNER_A = 'device:11111111-1111-4111-8111-111111111111';
const OWNER_B = 'device:22222222-2222-4222-8222-222222222222';
const CALC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const config = loadConfig({
  NODE_ENV: 'test',
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

const auth = (owner: string) => ({ [OWNER_KEY_HEADER]: owner });

function appWith(seed = [calculationRecord()], options: { fail?: boolean } = {}) {
  const fake = makeCalculationsSupabase(seed, options);
  const app = buildApp(config, { supabase: fake.client as never });
  return { app, fake };
}

const F2_VALUES = {
  property_name: 'Tacoma duplex',
  purchase_price: '350000',
  rehab_budget: '75000',
  after_repair_value: '600000',
  holding_months: '4',
};

const silentLogger = { warn: () => undefined, error: () => undefined };

// ---------------------------------------------------------------------------

describe('GET /calculations — the library list', () => {
  it("lists only the caller's active entries, newest first, with a headline figure", async () => {
    const { app } = appWith([
      calculationRecord({ id: CALC_A, owner_key: OWNER_A, property_name: 'Older', created_at: '2026-10-01T00:00:00.000Z' }),
      calculationRecord({
        id: CALC_B,
        owner_key: OWNER_A,
        property_name: 'Newer',
        calculator: 'brrrr',
        result: { calculator: 'brrrr', outputs: { monthly_cash_flow: 412.5 } },
        created_at: '2026-10-05T00:00:00.000Z',
      }),
      calculationRecord({ owner_key: OWNER_B, property_name: 'Someone else' }),
      calculationRecord({ owner_key: OWNER_A, property_name: 'Deleted', archived_at: '2026-10-06T00:00:00.000Z' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/calculations', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, any>>;
    expect(body.map((r) => r.property_name)).toEqual(['Newer', 'Older']);
    expect(body[0].headline).toEqual({ label: 'Cash flow / mo', value: 412.5, unit: 'usd' });
    expect(body[1].headline).toEqual({ label: 'Net profit', value: 101916, unit: 'usd' });
    await app.close();
  });

  it('never ships owner_key, inputs, or whole results in the list payload', async () => {
    const { app } = appWith([calculationRecord({ owner_key: OWNER_A, inputs: { secret_marker: 1 } })]);
    const res = await app.inject({ method: 'GET', url: '/calculations', headers: auth(OWNER_A) });
    expect(res.body).not.toContain(OWNER_A);
    expect(res.body).not.toContain('secret_marker');
    await app.close();
  });

  it('?q= searches property names case-insensitively', async () => {
    const { app } = appWith([
      calculationRecord({ owner_key: OWNER_A, property_name: '123 Main St, Tacoma' }),
      calculationRecord({ owner_key: OWNER_A, property_name: 'Seattle triplex' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/calculations?q=TACOMA', headers: auth(OWNER_A) });
    expect((res.json() as Array<{ property_name: string }>).map((r) => r.property_name)).toEqual([
      '123 Main St, Tacoma',
    ]);
    await app.close();
  });

  it('a search containing % or _ matches those characters, not everything', async () => {
    const { app } = appWith([
      calculationRecord({ owner_key: OWNER_A, property_name: 'Lot 100% financed' }),
      calculationRecord({ owner_key: OWNER_A, property_name: 'Lot 1000' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/calculations?q=100%25', headers: auth(OWNER_A) });
    expect((res.json() as Array<{ property_name: string }>).map((r) => r.property_name)).toEqual([
      'Lot 100% financed',
    ]);
    await app.close();
  });

  it('a database failure answers 503 with a member-readable message', async () => {
    const { app } = appWith([], { fail: true });
    const res = await app.inject({ method: 'GET', url: '/calculations', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/library/i);
    await app.close();
  });
});

describe('GET /calculations/:id — one entry', () => {
  it('returns the full entry plus the calculator form a "Run again" renders', async () => {
    const { app } = appWith([
      calculationRecord({ id: CALC_A, owner_key: OWNER_A, chat_id: CHAT, inputs: { property_name: 'X', purchase_price: 1 } }),
    ]);
    const res = await app.inject({ method: 'GET', url: `/calculations/${CALC_A}`, headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.inputs).toEqual({ property_name: 'X', purchase_price: 1 });
    expect(body.chat_id).toBe(CHAT);
    expect(body.form.calculator).toBe('flip');
    expect(body.form.required[0].name, 'property name is not the first field').toBe('property_name');
    expect(res.body).not.toContain(OWNER_A);
    await app.close();
  });

  it("another owner's entry is 404 — existence is never confirmed", async () => {
    const { app } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_B })]);
    const res = await app.inject({ method: 'GET', url: `/calculations/${CALC_A}`, headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('a malformed id is 404, not a database error', async () => {
    const { app, fake } = appWith([]);
    const res = await app.inject({ method: 'GET', url: '/calculations/not-a-uuid', headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(404);
    expect(fake.client.from, 'a malformed id reached the database').not.toHaveBeenCalled();
    await app.close();
  });
});

describe('PATCH /calculations/:id — rename', () => {
  it('renames the property, trimmed and whitespace-collapsed', async () => {
    const { app, fake } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_A, property_name: 'Old' })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/calculations/${CALC_A}`,
      headers: auth(OWNER_A),
      payload: { property_name: '  456   Oak Ave  ' },
    });
    expect(res.statusCode).toBe(200);
    expect(fake.rows[0].property_name).toBe('456 Oak Ave');
    await app.close();
  });

  it('a blank name is 400 and changes nothing', async () => {
    const { app, fake } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_A, property_name: 'Keep' })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/calculations/${CALC_A}`,
      headers: auth(OWNER_A),
      payload: { property_name: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(fake.rows[0].property_name).toBe('Keep');
    await app.close();
  });

  it("cannot rename another owner's entry", async () => {
    const { app, fake } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_B, property_name: 'B' })]);
    const res = await app.inject({
      method: 'PATCH',
      url: `/calculations/${CALC_A}`,
      headers: auth(OWNER_A),
      payload: { property_name: 'Hijacked' },
    });
    expect(res.statusCode).toBe(404);
    expect(fake.rows[0].property_name).toBe('B');
    await app.close();
  });
});

describe('DELETE /calculations/:id — soft delete', () => {
  it('archives the entry, which then leaves the list', async () => {
    const { app, fake } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_A })]);
    const del = await app.inject({ method: 'DELETE', url: `/calculations/${CALC_A}`, headers: auth(OWNER_A) });
    expect(del.statusCode).toBe(204);
    expect(fake.rows, 'the row was hard-deleted').toHaveLength(1);
    expect(fake.rows[0].archived_at).not.toBeNull();
    const list = await app.inject({ method: 'GET', url: '/calculations', headers: auth(OWNER_A) });
    expect(list.json()).toEqual([]);
    await app.close();
  });

  it("cannot delete another owner's entry", async () => {
    const { app, fake } = appWith([calculationRecord({ id: CALC_A, owner_key: OWNER_B })]);
    const res = await app.inject({ method: 'DELETE', url: `/calculations/${CALC_A}`, headers: auth(OWNER_A) });
    expect(res.statusCode).toBe(404);
    expect(fake.rows[0].archived_at).toBeNull();
    await app.close();
  });
});

// ---------------------------------------------------------------------------

describe('createCalculationLibrary — the write path', () => {
  it('files the run under owner, chat, calculator and the cleaned property name', async () => {
    const fake = makeCalculationsSupabase([]);
    const library = createCalculationLibrary(fake.client as never, OWNER_A, CHAT, silentLogger);
    const saved = await library.save({
      calculator: 'flip',
      inputs: { property_name: '  Tacoma   duplex ', purchase_price: 350000 },
      result: { calculator: 'flip', property_name: 'Tacoma duplex', outputs: { est_net_profit: 101916 } },
    });
    expect(saved).toMatchObject({ calculator: 'flip', property_name: 'Tacoma duplex' });
    expect(fake.rows[0]).toMatchObject({ owner_key: OWNER_A, chat_id: CHAT, property_name: 'Tacoma duplex' });
    expect(fake.rows[0].result).toMatchObject({ outputs: { est_net_profit: 101916 } });
  });

  it('a database failure returns null and never throws', async () => {
    const fake = makeCalculationsSupabase([], { fail: true });
    const errors: unknown[] = [];
    const library = createCalculationLibrary(fake.client as never, OWNER_A, CHAT, {
      warn: () => undefined,
      error: (obj) => errors.push(obj),
    });
    await expect(
      library.save({ calculator: 'flip', inputs: { property_name: 'X' }, result: { property_name: 'X' } }),
    ).resolves.toBeNull();
    expect(errors, 'the lost save was not logged').toHaveLength(1);
  });

  it('propertyKey: spellings of one address share a folder; units and labels stay distinct', () => {
    const same = [
      '123 Main St',
      '123 Main Street, Tacoma',
      '123 MAIN STREET, SEATTLE, WA 98101',
      '123 main st.',
      '123 Main St Seattle WA',
    ].map(propertyKey);
    expect(new Set(same).size, `spellings split: ${same.join(' | ')}`).toBe(1);
    expect(same[0]).toBe('addr:123 MAIN STREET');
    expect(propertyKey('100 Oak Ave Unit 3')).toBe('addr:100 OAK AVENUE #3');
    expect(propertyKey('100 Oak Ave #3, Seattle')).toBe('addr:100 OAK AVENUE #3');
    expect(propertyKey('100 Oak Ave Unit 4')).not.toBe(propertyKey('100 Oak Ave Unit 3'));
    expect(propertyKey('124 Main St')).not.toBe(propertyKey('123 Main St'));
    expect(propertyKey('Tacoma duplex')).toBe(propertyKey('  tacoma   DUPLEX '));
    expect(propertyKey('Tacoma duplex')).not.toBe(propertyKey('Tacoma triplex'));
    // A house number with no street-type word keeps the whole name.
    expect(propertyKey('123 main test 1')).toBe('addr:123 MAIN TEST 1');
  });

  it('the list carries each entry\'s property_key', async () => {
    const { app } = appWith([
      calculationRecord({ owner_key: OWNER_A, property_name: '123 Main St' }),
      calculationRecord({ owner_key: OWNER_A, calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101' }),
    ]);
    const res = await app.inject({ method: 'GET', url: '/calculations', headers: auth(OWNER_A) });
    const keys = (res.json() as Array<{ property_key: string }>).map((r) => r.property_key);
    expect(keys).toEqual(['addr:123 MAIN STREET', 'addr:123 MAIN STREET']);
    await app.close();
  });

  it('headlineFor reads each calculator\'s lead figure and nothing else', () => {
    expect(headlineFor('land_purchase', { target_land_contract: 250000 })).toEqual({
      label: 'Target land price',
      value: 250000,
      unit: 'usd',
    });
    expect(headlineFor('brrrr', { monthly_cash_flow: 'n/a' })).toBeNull();
    expect(headlineFor('unknown', { est_net_profit: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** A library that records what it was asked to save. */
function recordingLibrary(outcome: 'ok' | 'fail' = 'ok') {
  const saves: CalculationToSave[] = [];
  const library: CalculationLibrary = {
    async save(entry) {
      saves.push(entry);
      if (outcome === 'fail') return null;
      return {
        id: CALC_A,
        calculator: entry.calculator,
        property_name: String(entry.inputs.property_name),
      } satisfies SavedCalculation;
    },
  };
  return { library, saves };
}

describe('runAgent — every completed calculation is saved, typed or form', () => {
  it('FORM path: the seeded calculator run is saved with its inputs and full result', async () => {
    const { library, saves } = recordingLibrary();
    const openai = makeFakeOpenAI([{ content: 'Net profit is about $101,916.' }]);
    const result = await runAgent(openai.client, makeFakeSupabase().client, config, [], 'Run the flip', {
      seedToolCall: {
        name: 'flip_calculator',
        args: { property_name: 'Tacoma duplex', purchase_price: 350000, rehab_budget: 75000, after_repair_value: 600000, holding_months: 4 },
      },
      library,
    });
    expect(saves).toHaveLength(1);
    expect(saves[0].calculator).toBe('flip');
    expect(saves[0].inputs.property_name).toBe('Tacoma duplex');
    expect((saves[0].result.outputs as Record<string, number>).est_net_profit).toBeCloseTo(101916, 0);
    expect(result.savedCalculations).toEqual([{ id: CALC_A, calculator: 'flip', property_name: 'Tacoma duplex' }]);
    expect(result.unsavedCalculations).toBe(0);
  });

  it('TYPED path: a model-issued calculator call is saved the same way', async () => {
    const { library, saves } = recordingLibrary();
    const openai = makeFakeOpenAI([
      {
        toolCalls: [
          {
            id: 't1',
            name: 'brrrr_calculator',
            args: { property_name: 'Oak St rental', purchase_price: 200000, rehab_budget: 40000, after_repair_value: 300000, monthly_rent: 2400 },
          },
        ],
      },
      { content: 'Here is the BRRRR.' },
    ]);
    const result = await runAgent(
      openai.client,
      makeFakeSupabase().client,
      config,
      [],
      'BRRRR on Oak St rental: 200k, 40k rehab, 300k ARV, 2400 rent',
      { library },
    );
    expect(saves.map((s) => s.calculator)).toEqual(['brrrr']);
    expect(result.savedCalculations[0].property_name).toBe('Oak St rental');
  });

  it('a run refused for a missing property name saves NOTHING, and the model is told to ask', async () => {
    const { library, saves } = recordingLibrary();
    const openai = makeFakeOpenAI([
      {
        toolCalls: [
          {
            id: 't1',
            name: 'flip_calculator',
            args: { purchase_price: 350000, rehab_budget: 75000, after_repair_value: 600000, holding_months: 4 },
          },
        ],
      },
      { content: 'Which property is this for?' },
    ]);
    const result = await runAgent(openai.client, makeFakeSupabase().client, config, [], 'flip 350k 75k 600k 4mo', {
      library,
    });
    expect(saves, 'an unnamed run reached the library').toHaveLength(0);
    expect(result.savedCalculations).toEqual([]);
    const toolMessage = (openai.calls[1].messages as Array<any>).find((m) => m.role === 'tool');
    expect(toolMessage.content).toMatch(/property_name/);
    expect(toolMessage.content).toMatch(/do not invent/i);
  });

  it('a library outage still returns the answer, and counts the unsaved run', async () => {
    const { library } = recordingLibrary('fail');
    const openai = makeFakeOpenAI([{ content: 'Net profit is about $101,916.' }]);
    const result = await runAgent(openai.client, makeFakeSupabase().client, config, [], 'Run the flip', {
      seedToolCall: {
        name: 'flip_calculator',
        args: { property_name: 'X', purchase_price: 350000, rehab_budget: 75000, after_repair_value: 600000, holding_months: 4 },
      },
      library,
    });
    expect(result.output).toContain('101,916');
    expect(result.savedCalculations).toEqual([]);
    expect(result.unsavedCalculations).toBe(1);
  });
});

// ---------------------------------------------------------------------------

/** The shared fake for chat/memory, with the calculations table routed to its own fake. */
function chatAppWithLibrary(options: { failLibrary?: boolean } = {}) {
  const base = makeFakeSupabase();
  const calcs = makeCalculationsSupabase([], { fail: options.failLibrary });
  const baseFrom = (base.client as any).from.bind(base.client);
  const client = Object.assign(Object.create(base.client as object), {
    from: (table: string) => (table === 'calculations' ? calcs.client.from(table) : baseFrom(table)),
  });
  const openai = makeFakeOpenAI([{ content: 'Net profit is about $101,916.' }]);
  const app = buildApp(config, { openai: openai.client, supabase: client as never });
  return { app, calcs, base };
}

describe('POST /chat — the library receipt', () => {
  it('a form submission is saved and the response carries saved_calculations', async () => {
    const { app, calcs } = chatAppWithLibrary();
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: auth(OWNER_A),
      payload: { session_id: CHAT, form_submission: { calculator: 'flip', values: F2_VALUES } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.saved_calculations).toEqual([
      { id: calcs.rows[0].id, calculator: 'flip', property_name: 'Tacoma duplex' },
    ]);
    expect(calcs.rows[0]).toMatchObject({ owner_key: OWNER_A, chat_id: CHAT, property_name: 'Tacoma duplex' });
    expect(body.user_message).toBe(
      'Run the Fix & Flip calculator for Tacoma duplex: purchase price $350,000, rehab budget $75,000, after-repair value (arv) $600,000, holding months 4 months.',
    );
    await flushDetached();
    await app.close();
  });

  it('a library outage still answers 200 and reports library_unsaved', async () => {
    const { app } = chatAppWithLibrary({ failLibrary: true });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: auth(OWNER_A),
      payload: { session_id: CHAT, form_submission: { calculator: 'flip', values: F2_VALUES } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().saved_calculations).toBeUndefined();
    expect(res.json().library_unsaved).toBe(1);
    await flushDetached();
    await app.close();
  });

  it('a form submitted without a property name is a 400 naming the field', async () => {
    const { app, calcs } = chatAppWithLibrary();
    const { property_name: _omit, ...withoutName } = F2_VALUES;
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: auth(OWNER_A),
      payload: { session_id: CHAT, form_submission: { calculator: 'flip', values: withoutName } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Property name');
    expect(calcs.rows).toHaveLength(0);
    await app.close();
  });
});

describe('the form asks for the property name first', () => {
  it.each(['flip', 'brrrr', 'land_purchase'] as const)('%s: property_name is the first required field, as text', (key) => {
    const first = CALCULATOR_FORMS[key].required[0];
    expect(first).toMatchObject({ name: 'property_name', label: 'Property name', type: 'text', required: true });
    expect(first.description, 'the model-facing instruction leaked into the member tooltip').not.toMatch(/ASK/);
  });
});
