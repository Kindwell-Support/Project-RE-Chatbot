/**
 * Comps snapshots in the calculation library.
 *
 * Client ruling (Clair): comps are saved as a SNAPSHOT — exactly what the
 * member was shown, dated, never refreshed — and saved BY ADDRESS.
 *
 * Pinned here:
 *   - a successful run_comps files one entry, kind 'comps', named by the
 *     subject's resolved address, carrying the verbatim rendered block
 *   - a failed lookup files nothing
 *   - the same run served again (a cache hit replays its run id) files ONE
 *     entry per member, not one per ask
 *   - a library outage never costs the member their comps
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { runAgent } from '../../src/agent/agent.js';
import { buildCompsSnapshot } from '../../src/features/comps/snapshot.js';
import {
  createCalculationLibrary,
  headlineFor,
  type CalculationLibrary,
  type CalculationToSave,
} from '../../src/server/calculations.js';
import { makeFakeOpenAI, makeFakeSupabase, type FakeCompletion } from '../helpers/fakes.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { makeCalculationsSupabase } from '../helpers/calculationsFake.js';
import { golden01 } from '../fixtures/golden/index.js';

const config = loadConfig({
  NODE_ENV: 'test',
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

const OWNER = 'device:11111111-1111-4111-8111-111111111111';
const CHAT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUBJECT = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
// Re-dated to today, as state.test.ts does: golden01's dates are relative to
// its own injected clock and would otherwise all be STALE_SALE.
const FRESH_COMPS = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (30 + i * 10) * 86_400_000).toISOString().slice(0, 10),
}));

const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: 'rc-1', name: 'run_comps', args: { address } }],
});
const silentLogger = { warn: () => undefined, error: () => undefined };

function recordingLibrary(outcome: 'ok' | 'fail' = 'ok') {
  const saves: CalculationToSave[] = [];
  const library: CalculationLibrary = {
    async save(entry) {
      saves.push(entry);
      return outcome === 'ok'
        ? { id: 'cccccccc-0000-4000-8000-000000000001', calculator: entry.calculator, property_name: String(entry.inputs.property_name) }
        : null;
    },
  };
  return { library, saves };
}

async function compsTurn(library: CalculationLibrary, subject: unknown = SUBJECT) {
  const spy = makeProviderSpy({ subject, comps: FRESH_COMPS });
  const openai = makeFakeOpenAI([runComps('123 Main St, Seattle WA'), { content: 'Here are the comps.' }]);
  const result = await runAgent(openai.client, makeFakeSupabase().client, config, [], 'run comps on 123 Main St, Seattle WA', {
    comps: { sessionId: CHAT, provider: spy.provider as never },
    library,
  });
  const toolMessage = (openai.calls[1]?.messages as Array<any> | undefined)?.find((m) => m.role === 'tool');
  return { result, toolMessage };
}

describe('a successful comps lookup is filed as a snapshot, by address', () => {
  it('saves one comps entry named by the resolved address, with the verbatim block', async () => {
    const { library, saves } = recordingLibrary();
    const { result, toolMessage } = await compsTurn(library);

    // POSITIVE PRECONDITION: the lookup really succeeded.
    const shown = JSON.parse(toolMessage.content).rendered_block as string;
    expect(JSON.parse(toolMessage.content).failure_code, 'the comps run failed').toBeUndefined();

    expect(saves).toHaveLength(1);
    const entry = saves[0];
    expect(entry.calculator).toBe('comps');
    expect(entry.inputs.property_name, 'not filed by address').toBe('123 MAIN STREET, SEATTLE, WA 98101');
    expect(entry.inputs.requested_address).toBe('123 Main St, Seattle WA');
    expect(entry.result.rendered_block, 'the snapshot is not what the member saw').toBe(shown);
    expect(entry.runId, 'no run id — repeats could not be deduplicated').toBeTruthy();
    expect(entry.result.run_id).toBe(entry.runId);
    expect(typeof entry.result.pulled_at).toBe('string');
    expect((entry.result.comps as unknown[]).length).toBeGreaterThan(0);
    expect((entry.result.outputs as Record<string, number>).comp_count).toBe((entry.result.comps as unknown[]).length);
    expect(result.savedCalculations).toEqual([
      { id: 'cccccccc-0000-4000-8000-000000000001', calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101' },
    ]);
  });

  it('a failed lookup (address not found) saves nothing', async () => {
    const { library, saves } = recordingLibrary();
    const { result, toolMessage } = await compsTurn(library, null);
    expect(JSON.parse(toolMessage.content).failure_code).toBe('ADDRESS_NOT_FOUND');
    expect(saves).toHaveLength(0);
    expect(result.savedCalculations).toEqual([]);
  });

  it('a library outage still returns the comps, and counts the unsaved snapshot', async () => {
    const { library } = recordingLibrary('fail');
    const { result, toolMessage } = await compsTurn(library);
    expect(JSON.parse(toolMessage.content).rendered_block).toBeTruthy();
    expect(result.savedCalculations).toEqual([]);
    expect(result.unsavedCalculations).toBe(1);
  });
});

describe('the same run is one snapshot per member', () => {
  it('a repeat save with the same run id returns the existing entry instead of writing', async () => {
    const fake = makeCalculationsSupabase([]);
    const library = createCalculationLibrary(fake.client as never, OWNER, CHAT, silentLogger);
    const entry = {
      calculator: 'comps' as const,
      inputs: { property_name: '123 MAIN STREET, SEATTLE, WA 98101' },
      result: { calculator: 'comps', property_name: '123 MAIN STREET, SEATTLE, WA 98101', run_id: 'run-1' },
      runId: 'run-1',
    };
    const first = await library.save(entry);
    const second = await library.save(entry);
    expect(fake.rows, 'a cache-hit repeat filed a second snapshot').toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('a different run of the same address IS a new snapshot (a later pull)', async () => {
    const fake = makeCalculationsSupabase([]);
    const library = createCalculationLibrary(fake.client as never, OWNER, CHAT, silentLogger);
    const base = { calculator: 'comps' as const, inputs: { property_name: 'A' } };
    await library.save({ ...base, result: { run_id: 'run-1', property_name: 'A' }, runId: 'run-1' });
    await library.save({ ...base, result: { run_id: 'run-2', property_name: 'A' }, runId: 'run-2' });
    expect(fake.rows).toHaveLength(2);
  });

  it("another member's identical run does not suppress this member's snapshot", async () => {
    const fake = makeCalculationsSupabase([]);
    const entry = {
      calculator: 'comps' as const,
      inputs: { property_name: 'A' },
      result: { run_id: 'run-1', property_name: 'A' },
      runId: 'run-1',
    };
    await createCalculationLibrary(fake.client as never, OWNER, CHAT, silentLogger).save(entry);
    await createCalculationLibrary(fake.client as never, 'device:22222222-2222-4222-8222-222222222222', CHAT, silentLogger).save(entry);
    expect(fake.rows).toHaveLength(2);
  });
});

describe('snapshot shape and list headline', () => {
  it('the list headline is the median $/sq ft of the comps shown', () => {
    expect(headlineFor('comps', { median_price_per_sqft: 412, comp_count: 5 })).toEqual({
      label: 'Median $/sq ft',
      value: 412,
      unit: 'usd',
    });
  });

  it('buildCompsSnapshot is pure: it records the clock it is given', () => {
    const outcome = {
      ok: true,
      runId: 'run-9',
      subject: SUBJECT,
      comps: [],
      radiusTierMi: 0.5,
      recencyTierMonths: 6,
    } as never;
    const snap = buildCompsSnapshot(outcome, 'BLOCK', '123 Main St', new Date('2026-10-09T12:00:00Z'));
    expect(snap.result.pulled_at).toBe('2026-10-09T12:00:00.000Z');
    expect(snap.result.outputs).toEqual({ comp_count: 0 });
    expect(snap.runId).toBe('run-9');
  });
});
