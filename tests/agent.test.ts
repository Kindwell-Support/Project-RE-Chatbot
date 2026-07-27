/**
 * Agent-layer tests — the handoff between the model and the calculators.
 *
 * This is the layer every shipped bug lived in. The calculator suite was green
 * the entire time the old build returned a frozen $148,466 for every deal,
 * because the arithmetic was never wrong: the tool schema was, so the model
 * passed nothing and the runner quietly substituted defaults.
 *
 * All clients are faked at the boundary — the real agent loop, tool router,
 * and calculators execute. No network, no API keys.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { runAgent } from '../src/agent/agent.js';
import { TOOL_DEFINITIONS } from '../src/agent/toolDefs.js';
import {
  runFlipTool,
  runBrrrrTool,
  runLandTool,
  MissingRequiredInputError,
} from '../src/agent/toolRunners.js';
import { makeFakeOpenAI, makeFakeSupabase, flushDetached } from './helpers/fakes.js';

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

/** Pull a tool definition out of what was actually sent to the model. */
function toolFrom(calls: Array<Record<string, any>>, name: string) {
  const tools = calls[0].tools as Array<any>;
  const tool = tools.find((t) => t.function.name === name);
  expect(tool, `${name} was not sent to the model`).toBeDefined();
  return tool.function.parameters as Record<string, any>;
}

async function runOnce(script: Parameters<typeof makeFakeOpenAI>[0], userMessage = 'hi') {
  const openai = makeFakeOpenAI(script);
  const supabase = makeFakeSupabase();
  const result = await runAgent(openai.client, supabase.client, config, [], userMessage);
  return { result, calls: openai.calls, inserts: supabase.inserts };
}

// ---------------------------------------------------------------------------
// 3.1 Tool schema — the day-one bug
// ---------------------------------------------------------------------------

describe('3.1 tool schemas are explicitly typed (frozen-number regression)', () => {
  it('flip_calculator declares typed numeric params and requires all four', async () => {
    const { calls } = await runOnce([{ content: 'hello' }]);
    const params = toolFrom(calls, 'flip_calculator');

    expect(params).toMatchObject({
      type: 'object',
      properties: {
        purchase_price: { type: 'number' },
        rehab_budget: { type: 'number' },
        after_repair_value: { type: 'number' },
        holding_months: { type: 'number' },
      },
    });
    expect(params.required).toEqual(
      expect.arrayContaining([
        'purchase_price',
        'rehab_budget',
        'after_repair_value',
        'holding_months',
      ]),
    );
  });

  it('REGRESSION: no free-form catch-all param on any calculator', async () => {
    const { calls } = await runOnce([{ content: 'hello' }]);
    // The old build's schema was a single free-form string. The model had
    // nowhere to put the deal numbers, so every deal fell back to defaults.
    for (const name of ['flip_calculator', 'brrrr_calculator', 'land_purchase_calculator']) {
      const params = toolFrom(calls, name);
      expect(params.properties, `${name} has a catch-all`).not.toHaveProperty('query');
      expect(params.properties, `${name} has a catch-all`).not.toHaveProperty('input');
      expect(params.properties, `${name} has a catch-all`).not.toHaveProperty('text');
      expect(params.properties, `${name} has a catch-all`).not.toHaveProperty('deal');
      expect(params.properties, `${name} has a catch-all`).not.toHaveProperty('parameters');

      // Stronger: every declared property is a scalar with a concrete type,
      // and no property is an untyped/free-form escape hatch.
      for (const [key, schema] of Object.entries(params.properties as Record<string, any>)) {
        expect(['number', 'string'], `${name}.${key} is not scalar`).toContain(schema.type);
        if (schema.type === 'string') {
          // Any string param must be a closed enum, never free text.
          expect(schema.enum, `${name}.${key} is free-form string`).toBeDefined();
        }
      }
      expect(params.additionalProperties).toBe(false);
    }
  });

  it('brrrr_calculator requires monthly_rent', async () => {
    const { calls } = await runOnce([{ content: 'hello' }]);
    const params = toolFrom(calls, 'brrrr_calculator');
    expect(params.properties.monthly_rent).toMatchObject({ type: 'number' });
    expect(params.required).toEqual(
      expect.arrayContaining([
        'purchase_price',
        'rehab_budget',
        'after_repair_value',
        'monthly_rent',
      ]),
    );
  });

  it('land_purchase_calculator declares typed params and requires all four', async () => {
    const { calls } = await runOnce([{ content: 'hello' }]);
    const params = toolFrom(calls, 'land_purchase_calculator');
    expect(params).toMatchObject({
      type: 'object',
      properties: {
        construction_sf: { type: 'number' },
        price_per_sf: { type: 'number' },
        new_construction_value: { type: 'number' },
        project_duration_months: { type: 'number' },
      },
    });
    expect(params.required).toEqual(
      expect.arrayContaining([
        'construction_sf',
        'price_per_sf',
        'new_construction_value',
        'project_duration_months',
      ]),
    );
  });

  it('every calculator tool is actually registered', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'flip_calculator',
        'brrrr_calculator',
        'land_purchase_calculator',
        'search_knowledge_base',
        'lookup_material_budget',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// 3.2 Tool-argument passthrough — the handoff that actually broke
// ---------------------------------------------------------------------------

describe('3.2 tool arguments survive the handoff into the calculator', () => {
  it('F2 numbers reach the calculator and 101916 comes back — not the 148466 default', async () => {
    const { calls } = await runOnce(
      [
        {
          toolCalls: [
            {
              id: 'call_1',
              name: 'flip_calculator',
              args: {
                purchase_price: 350000,
                rehab_budget: 75000,
                after_repair_value: 600000,
                holding_months: 4,
              },
            },
          ],
        },
        { content: 'Net profit is about $101,916.' },
      ],
      'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
    );

    // The second round's messages carry the tool result the model saw.
    const toolMessage = (calls[1].messages as Array<any>).find((m) => m.role === 'tool');
    expect(toolMessage, 'no tool result was fed back to the model').toBeDefined();
    const payload = JSON.parse(toolMessage.content);

    expect(payload.outputs.est_net_profit).toBeCloseTo(101916, 0);
    // The frozen-number bug, pinned:
    expect(payload.outputs.est_net_profit).not.toBeCloseTo(148466, 0);
    expect(payload.inputs_used.purchase_price).toBe(350000);
    expect(payload.inputs_used.holding_months).toBe(4);
  });

  it('a second, different deal in the same run gets its own numbers', async () => {
    const { calls } = await runOnce(
      [
        {
          toolCalls: [
            {
              id: 'c1',
              name: 'flip_calculator',
              args: {
                purchase_price: 300000,
                rehab_budget: 50000,
                after_repair_value: 550000,
                holding_months: 3,
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              id: 'c2',
              name: 'brrrr_calculator',
              args: {
                purchase_price: 250000,
                rehab_budget: 60000,
                after_repair_value: 450000,
                monthly_rent: 3000,
              },
            },
          ],
        },
        { content: 'done' },
      ],
      'run F3 then B2',
    );

    const toolMessages = (calls[2].messages as Array<any>).filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    const flip = JSON.parse(toolMessages[0].content);
    const brrrr = JSON.parse(toolMessages[1].content);

    expect(flip.calculator).toBe('flip');
    expect(flip.outputs.est_net_profit).toBeCloseTo(137868, 0);
    expect(brrrr.calculator).toBe('brrrr');
    expect(brrrr.outputs.max_allowable_offer).toBeCloseTo(277500, 0);
    expect(brrrr.outputs.five_year_irr).toBe('n/a');
  });

  it('ANTI-REGRESSION: a missing required field errors — never a silent default', () => {
    // This is the original bug's shape. Substituting 700000 here is what made
    // every deal report the same profit.
    expect(() => runFlipTool({})).toThrow(MissingRequiredInputError);
    expect(() => runFlipTool({ purchase_price: 350000 })).toThrow(/rehab_budget/);
    expect(() =>
      runFlipTool({ purchase_price: 350000, rehab_budget: 75000, after_repair_value: 600000 }),
    ).toThrow(/holding_months/);

    expect(() => runBrrrrTool({})).toThrow(MissingRequiredInputError);
    expect(() =>
      runBrrrrTool({ purchase_price: 250000, rehab_budget: 60000, after_repair_value: 450000 }),
    ).toThrow(/monthly_rent/);

    expect(() => runLandTool({})).toThrow(MissingRequiredInputError);
    expect(() => runLandTool({ construction_sf: 3000 })).toThrow(/price_per_sf/);
  });

  it('ANTI-REGRESSION: NaN/garbage required values are rejected, not computed with', () => {
    const base = {
      purchase_price: 350000,
      rehab_budget: 75000,
      after_repair_value: 600000,
      holding_months: 4,
    };
    expect(() => runFlipTool({ ...base, purchase_price: NaN })).toThrow(/purchase_price/);
    expect(() => runFlipTool({ ...base, purchase_price: Infinity })).toThrow(/purchase_price/);
    expect(() => runFlipTool({ ...base, purchase_price: '350000' })).toThrow(/purchase_price/);
    expect(() => runFlipTool({ ...base, purchase_price: null })).toThrow(/purchase_price/);
  });

  it('a tool error reaches the model as an explicit instruction not to invent numbers', async () => {
    const { calls } = await runOnce(
      [
        // Model omits holding_months entirely.
        {
          toolCalls: [
            {
              id: 'c1',
              name: 'flip_calculator',
              args: { purchase_price: 350000, rehab_budget: 75000, after_repair_value: 600000 },
            },
          ],
        },
        { content: 'What holding period should I assume?' },
      ],
      'run a flip',
    );

    // Located by tool_call_id, not by position: "run a flip" also routes an
    // input form deterministically (calculatorIntent.ts), so this conversation
    // legitimately carries two tool results and only c1 is the failed call.
    const toolMessage = (calls[1].messages as Array<any>).find(
      (m) => m.role === 'tool' && m.tool_call_id === 'c1',
    );
    expect(toolMessage, 'the failed flip_calculator result never reached the model').toBeDefined();
    const payload = JSON.parse(toolMessage.content);
    expect(payload.error).toMatch(/holding_months/);
    expect(payload.error).toMatch(/do not invent numbers/i);
    // Crucially: no numbers were fabricated.
    expect(payload).not.toHaveProperty('outputs');
  });
});

// ---------------------------------------------------------------------------
// 3.3 A13 — token_usage populated
// ---------------------------------------------------------------------------

describe('3.3 A13: qa_logs carries real token_usage', () => {
  async function postChat(opts: { matchDocuments?: any[] } = {}) {
    const openai = makeFakeOpenAI([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'flip_calculator',
            args: {
              purchase_price: 350000,
              rehab_budget: 75000,
              after_repair_value: 600000,
              holding_months: 4,
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
      },
      {
        content: 'Net profit is about $101,916.',
        usage: { prompt_tokens: 300, completion_tokens: 40, total_tokens: 340 },
      },
    ]);
    const supabase = makeFakeSupabase(opts);
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: {
        message: 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
        session_id: 'sess-a13',
        member_email: 'member@example.com',
      },
    });
    await flushDetached();
    await app.close();
    const qaLog = supabase.inserts.find((i) => i.table === 'qa_logs');
    return { res, qaLog, supabase };
  }

  it('token_usage is populated and is NOT {} (the old build logged an empty object)', async () => {
    const { res, qaLog } = await postChat();
    expect(res.statusCode).toBe(200);
    expect(qaLog, 'nothing was written to qa_logs').toBeDefined();

    expect(qaLog!.payload.token_usage).not.toEqual({});
    expect(qaLog!.payload.token_usage).toEqual(
      expect.objectContaining({ total_tokens: expect.any(Number) }),
    );
    // Accumulated across both rounds: 200 + 340.
    expect(qaLog!.payload.token_usage.total_tokens).toBe(540);
    expect(qaLog!.payload.token_usage.prompt_tokens).toBe(420);
    expect(qaLog!.payload.token_usage.completion_tokens).toBe(120);
  });

  it('user_id, question and answer are populated', async () => {
    const { qaLog } = await postChat();
    expect(qaLog!.payload.user_id).toBe('member@example.com');
    expect(qaLog!.payload.question).toBe('Flip: 350k purchase, 75k rehab, 600k ARV, 4 months');
    expect(qaLog!.payload.answer).toContain('101,916');
  });

  it('retrieved_chunk_ids and similarity_scores carry real values when retrieval ran', async () => {
    const openai = makeFakeOpenAI([
      {
        toolCalls: [
          { id: 'c1', name: 'search_knowledge_base', args: { query: 'how to build a buy box' } },
        ],
      },
      { content: 'A buy box is your written criteria.' },
    ]);
    const supabase = makeFakeSupabase({
      matchDocuments: [
        { id: 'doc-1', content: 'A buy box defines your criteria.', similarity: 0.91 },
        { id: 'doc-2', content: 'Stick to the box.', similarity: 0.84 },
      ],
    });
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'How does James build a buy box?', session_id: 'sess-rag' },
    });
    await flushDetached();
    await app.close();

    expect(res.statusCode).toBe(200);
    const qaLog = supabase.inserts.find((i) => i.table === 'qa_logs');
    expect(qaLog!.payload.retrieved_chunk_ids).toEqual(['doc-1', 'doc-2']);
    expect(qaLog!.payload.similarity_scores).toEqual([0.91, 0.84]);
    // The old build left these null even when retrieval ran.
    expect(qaLog!.payload.retrieved_chunk_ids).not.toBeNull();
    expect(qaLog!.payload.similarity_scores).not.toBeNull();
    // Embedding tokens are counted too.
    expect(qaLog!.payload.token_usage.embedding_tokens).toBeGreaterThan(0);
  });

  it('falls back to session_id as user_id when no member email is supplied', async () => {
    const openai = makeFakeOpenAI([{ content: 'hi' }]);
    const supabase = makeFakeSupabase();
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'hey', session_id: 'sess-anon', member_email: 'unknown' },
    });
    await flushDetached();
    await app.close();
    const qaLog = supabase.inserts.find((i) => i.table === 'qa_logs');
    expect(qaLog!.payload.user_id).toBe('sess-anon');
  });
});

// ---------------------------------------------------------------------------
// 3.4 A15 — defaults disclosure
// ---------------------------------------------------------------------------

describe('3.4 A15: applied defaults are disclosed machine-readably', () => {
  it('flip with only the four required fields reports every applied default', () => {
    const result = runFlipTool({
      purchase_price: 350000,
      rehab_budget: 75000,
      after_repair_value: 600000,
      holding_months: 4,
    });

    expect(result.defaults_applied).toEqual(
      expect.objectContaining({
        interest_rate: 0.12,
        down_payment_pct: 0.2,
        annual_taxes: 3000,
        annual_insurance: 1200,
        interest_reserve: 'No',
        include_second_loan: 'No',
      }),
    );
    // Nothing the caller supplied is reported as a default.
    expect(result.defaults_applied).not.toHaveProperty('purchase_price');
    expect(result.defaults_applied).not.toHaveProperty('holding_months');
  });

  it('a supplied value is not listed as an applied default', () => {
    const result = runFlipTool({
      purchase_price: 350000,
      rehab_budget: 75000,
      after_repair_value: 600000,
      holding_months: 4,
      interest_rate: 0.10,
    });
    expect(result.defaults_applied).not.toHaveProperty('interest_rate');
    expect(result.inputs_used.interest_rate).toBe(0.10);
  });

  it('brrrr and land disclose their defaults too', () => {
    const brrrr = runBrrrrTool({
      purchase_price: 250000,
      rehab_budget: 60000,
      after_repair_value: 450000,
      monthly_rent: 3000,
    });
    expect(brrrr.defaults_applied).toEqual(
      expect.objectContaining({ refinance_ltarv: 0.75, refinance_method: 'LTV', vacancy_pct: 0.05 }),
    );

    const land = runLandTool({
      construction_sf: 3000,
      price_per_sf: 300,
      new_construction_value: 3000000,
      project_duration_months: 18,
    });
    expect(land.defaults_applied).toEqual(
      expect.objectContaining({ target_investor_return: 0.25, target_assignment_fee: 100000 }),
    );
  });

  it('every tool result carries the estimate disclaimer', () => {
    const result = runFlipTool({
      purchase_price: 350000,
      rehab_budget: 75000,
      after_repair_value: 600000,
      holding_months: 4,
    });
    expect(result.note).toMatch(/estimate/i);
    expect(result.note).toMatch(/not financial advice/i);
  });

  it('land exposes the computed formula cells (C9/C11/C12) for disclosure', () => {
    const land = runLandTool({
      construction_sf: 4000,
      price_per_sf: 350,
      new_construction_value: 3500000,
      project_duration_months: 24,
    });
    // The n8n bug was hardcoding these. They must be visible and recomputed.
    expect(land.computed_formula_cells.interest_reserve_months).toBe(24);
    expect(land.computed_formula_cells.estimated_utilities_insurance).toBe(6000);
    expect(land.outputs.target_land_contract).toBeCloseTo(544665, 0);
  });
});

// ---------------------------------------------------------------------------
// 3.5 Memory wiring
// ---------------------------------------------------------------------------

describe('3.5 memory plumbing: prior turns reach the model', () => {
  it('history rows are passed into the model messages array in order', async () => {
    const openai = makeFakeOpenAI([{ content: 'Around $520k ARV.' }]);
    const supabase = makeFakeSupabase({
      history: [
        { role: 'user', content: 'flip in Seattle, 400k purchase' },
        { role: 'assistant', content: 'Got it — 400k purchase. What is the rehab budget?' },
      ],
    });
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'what ARV do I need?', session_id: 'sess-mem' },
    });
    await app.close();

    const messages = openai.calls[0].messages as Array<any>;
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: 'flip in Seattle, 400k purchase',
    });
    expect(messages[2].role).toBe('assistant');
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'user',
      content: 'what ARV do I need?',
    });
    // A14's plumbing: the 400k is in context without the user restating it.
    expect(JSON.stringify(messages)).toContain('400k purchase');
  });

  it('REGRESSION: history is persisted BEFORE the reply returns (read-your-own-writes)', async () => {
    // chat_messages was previously fire-and-forget, which raced: a follow-up
    // request could load history before the prior turn's insert landed, and the
    // agent forgot the conversation. Caught live by A16 (restart-and-continue
    // replied "I don't have your purchase price on record").
    // Memory is correctness, not observability — it must be awaited.
    let insertResolved = false;
    const openai = makeFakeOpenAI([{ content: 'Around $520k ARV.' }]);
    const base = makeFakeSupabase();
    const slowSupabase = {
      from(table: string) {
        const chain = (base.client as any).from(table);
        if (table === 'chat_messages') {
          const realInsert = chain.insert;
          chain.insert = (payload: any) =>
            new Promise((resolve) => {
              setTimeout(() => {
                realInsert(payload);
                insertResolved = true;
                resolve({ data: null, error: null });
              }, 50);
            });
        }
        return chain;
      },
      rpc: (base.client as any).rpc,
    } as any;

    const app = buildApp(config, { openai: openai.client, supabase: slowSupabase });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'flip in Seattle, 400k purchase', session_id: 's-race' },
    });
    // The reply must not come back before the turn is durable.
    expect(insertResolved, 'reply returned before history was persisted — race is back').toBe(
      true,
    );
    await app.close();
  });

  it('qa_logs stays detached — observability must not add latency', async () => {
    // The mirror of the test above: logging is NOT correctness, so it must not
    // be awaited. Nothing reads qa_logs back.
    const openai = makeFakeOpenAI([{ content: 'hi' }]);
    const base = makeFakeSupabase();
    let qaInsertStarted = false;
    let qaInsertFinished = false;
    const slowSupabase = {
      from(table: string) {
        const chain = (base.client as any).from(table);
        if (table === 'qa_logs') {
          chain.insert = () =>
            new Promise((resolve) => {
              qaInsertStarted = true;
              setTimeout(() => {
                qaInsertFinished = true;
                resolve({ data: null, error: null });
              }, 300);
            });
        }
        return chain;
      },
      rpc: (base.client as any).rpc,
    } as any;

    const app = buildApp(config, { openai: openai.client, supabase: slowSupabase });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'hey', session_id: 's-detached' },
    });
    expect(res.statusCode).toBe(200);
    expect(qaInsertStarted).toBe(true);
    expect(qaInsertFinished, 'reply waited on the qa_logs write').toBe(false);
    await flushDetached();
    await app.close();
  });

  it('REGRESSION: history is ordered deterministically, not by an ambiguous timestamp', async () => {
    // appendExchange writes the user + assistant rows in ONE insert, so they
    // share a created_at. Ordering on that column alone leaves the pair's order
    // UNDEFINED — observed live as a restored transcript with James's answer
    // sitting above the member's question. The same rows are what the model
    // reads as context, so an inverted turn is a correctness bug, not cosmetics.
    // `id` is a monotonic identity and breaks the tie by true insertion order.
    const openai = makeFakeOpenAI([{ content: 'hi' }]);
    const supabase = makeFakeSupabase({
      history: [
        { role: 'user', content: 'flip in Seattle, 400k purchase' },
        { role: 'assistant', content: 'Got it — what is the rehab budget?' },
      ],
    });
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'what ARV do I need?', session_id: 's-order' },
    });
    await app.close();

    const historyOrders = supabase.orderCalls.filter((c) => c.table === 'chat_messages');
    expect(historyOrders.map((c) => c.column), 'no id tiebreak — turn order is undefined').toEqual([
      'created_at',
      'id',
    ]);
    // Both descending, because getHistory reverses the page afterwards.
    expect(historyOrders.every((c) => c.opts?.ascending === false)).toBe(true);
  });

  it('the exchange is appended to chat_messages for the next turn', async () => {
    const openai = makeFakeOpenAI([{ content: 'Around $520k ARV.' }]);
    const supabase = makeFakeSupabase();
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'what ARV do I need?', session_id: 'sess-append' },
    });
    await flushDetached();
    await app.close();

    const append = supabase.inserts.find((i) => i.table === 'chat_messages');
    expect(append).toBeDefined();
    expect(append!.payload).toEqual([
      { session_id: 'sess-append', role: 'user', content: 'what ARV do I need?' },
      { session_id: 'sess-append', role: 'assistant', content: 'Around $520k ARV.' },
    ]);
  });

  it('tool results stay in the message chain across rounds', async () => {
    const { calls } = await runOnce([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'flip_calculator',
            args: {
              purchase_price: 350000,
              rehab_budget: 75000,
              after_repair_value: 600000,
              holding_months: 4,
            },
          },
        ],
      },
      { content: 'done' },
    ]);
    const roles = (calls[1].messages as Array<any>).map((m) => m.role);
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');
  });
});

// ---------------------------------------------------------------------------
// Agent loop guarantees
// ---------------------------------------------------------------------------

describe('agent loop guarantees', () => {
  it('temperature is 0.3 and the configured model is used', async () => {
    const { calls } = await runOnce([{ content: 'hi' }]);
    expect(calls[0].temperature).toBe(0.3);
    expect(calls[0].model).toBe(config.openaiModel);
  });

  it('a tool round-trip does not lose the user message', async () => {
    const { calls } = await runOnce(
      [
        {
          toolCalls: [
            {
              id: 'c1',
              name: 'flip_calculator',
              args: {
                purchase_price: 350000,
                rehab_budget: 75000,
                after_repair_value: 600000,
                holding_months: 4,
              },
            },
          ],
        },
        { content: 'done' },
      ],
      'my exact question',
    );
    expect(JSON.stringify(calls[1].messages)).toContain('my exact question');
  });

  it('an unknown tool name returns an error instead of throwing', async () => {
    const { result } = await runOnce([
      { toolCalls: [{ id: 'c1', name: 'nonexistent_tool', args: {} }] },
      { content: 'recovered' },
    ]);
    expect(result.output).toBe('recovered');
  });
});
