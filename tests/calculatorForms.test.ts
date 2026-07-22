/**
 * Inline calculator form tests.
 *
 * The feature's whole risk is drift: a second, hand-written list of form fields
 * that slowly disagrees with the tool schema, and a second calculation path that
 * skips the validation the typed path has. Both are pinned here.
 *
 * The central assertion is 4.2: the form path and the natural-language path must
 * produce the SAME calculator result object, not merely two results that each
 * look plausible.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { runAgent } from '../src/agent/agent.js';
import { TOOL_DEFINITIONS } from '../src/agent/toolDefs.js';
import {
  CALCULATOR_FORMS,
  CALCULATOR_KEYS,
  buildCalculatorForm,
  type CalculatorKey,
} from '../src/agent/formSchema.js';
import { buildFormSubmission, FormValidationError } from '../src/agent/formSubmission.js';
import { runFlipTool } from '../src/agent/toolRunners.js';
import { makeFakeOpenAI, makeFakeSupabase, flushDetached } from './helpers/fakes.js';

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

/** The raw JSON-Schema properties a tool declares, straight from TOOL_DEFINITIONS. */
function schemaOf(toolName: string) {
  const tool = TOOL_DEFINITIONS.find((t: any) => t.function?.name === toolName) as any;
  expect(tool, `${toolName} is not registered`).toBeDefined();
  return tool.function.parameters as { properties: Record<string, any>; required?: string[] };
}

function fieldNames(calculator: CalculatorKey): string[] {
  const form = CALCULATOR_FORMS[calculator];
  return [...form.required, ...form.optional].map((f) => f.name).sort();
}

// ---------------------------------------------------------------------------
// 4.1 One source of truth — the form is DERIVED from the tool schema
// ---------------------------------------------------------------------------

describe('4.1 form fields derive from the calculator tool schemas', () => {
  it.each(CALCULATOR_KEYS)('%s form covers exactly the schema properties', (key) => {
    const form = CALCULATOR_FORMS[key];
    const schema = schemaOf(form.tool);
    // Set equality both ways: no field invented by the form, none dropped from
    // the schema. A hand-maintained list would fail this the first time either
        // side changed.
    expect(fieldNames(key)).toEqual(Object.keys(schema.properties).sort());
  });

  it.each(CALCULATOR_KEYS)('%s required/optional split matches the schema', (key) => {
    const form = CALCULATOR_FORMS[key];
    const schema = schemaOf(form.tool);
    expect(form.required.map((f) => f.name).sort()).toEqual([...(schema.required ?? [])].sort());
    for (const field of form.optional) {
      expect(schema.required ?? []).not.toContain(field.name);
    }
  });

  it.each(CALCULATOR_KEYS)('%s optional fields carry a default, required ones never do', (key) => {
    const form = CALCULATOR_FORMS[key];
    for (const field of form.optional) {
      expect(field.default, `${field.name} has no default`).toBeDefined();
    }
    for (const field of form.required) {
      // A default on a required field is the silent-blank bug: it would let a
      // missing input calculate instead of erroring.
      expect(field.default, `${field.name} must not have a default`).toBeUndefined();
    }
  });

  it('enum schema fields become selects with their options', () => {
    const method = CALCULATOR_FORMS.brrrr.optional.find((f) => f.name === 'refinance_method');
    expect(method).toBeDefined();
    expect(method!.type).toBe('enum');
    expect(method!.options).toEqual(['LTV', 'DSCR']);

    const reserve = CALCULATOR_FORMS.flip.optional.find((f) => f.name === 'interest_reserve');
    expect(reserve!.type).toBe('enum');
    expect(reserve!.options).toEqual(['Yes', 'No']);
  });

  it('request_calculator_form enum stays in step with CALCULATOR_KEYS', () => {
    const schema = schemaOf('request_calculator_form');
    expect([...schema.properties.calculator.enum].sort()).toEqual([...CALCULATOR_KEYS].sort());
  });

  // The strongest form of "don't hand-duplicate the field list": add a property
  // to the live schema and the form must grow it with no code change here.
  describe('a field added to a tool schema surfaces in the form automatically', () => {
    const schema = schemaOf('flip_calculator');
    afterEach(() => {
      delete schema.properties.sewer_scope_cost;
    });

    it('picks up a newly declared optional field', () => {
      expect(fieldNames('flip')).not.toContain('sewer_scope_cost');

      schema.properties.sewer_scope_cost = {
        type: 'number',
        description: 'Sewer scope cost in dollars. Default 0',
      };

      const rebuilt = buildCalculatorForm('flip');
      const added = rebuilt.optional.find((f) => f.name === 'sewer_scope_cost');
      expect(added, 'new schema field did not reach the form').toBeDefined();
      expect(added!.label).toBe('Sewer scope cost');
      expect(added!.unit).toBe('usd');
    });
  });
});

// ---------------------------------------------------------------------------
// 4.2 The two paths must agree — same tool, same numbers, same result
// ---------------------------------------------------------------------------

describe('4.2 form submission and natural language produce the identical result', () => {
  const DEAL = {
    purchase_price: 350000,
    rehab_budget: 75000,
    after_repair_value: 600000,
    holding_months: 4,
  };

  it('F2 through the form equals F2 typed — same object, and 101916', () => {
    // Natural-language path: the model emits numbers, the runner runs them.
    const typed = runFlipTool({ ...DEAL });

    // Form path: strings out of DOM inputs, coerced by the submission builder,
    // then handed to THE SAME runner.
    const built = buildFormSubmission('flip', {
      purchase_price: '350000',
      rehab_budget: '75000',
      after_repair_value: '600000',
      holding_months: '4',
    });
    const viaForm = runFlipTool(built.args);

    expect(built.tool).toBe('flip_calculator');
    expect(built.args).toEqual(DEAL);
    expect(viaForm).toEqual(typed);
    expect(viaForm.outputs.est_net_profit).toBeCloseTo(101916, 0);
    // The frozen-number bug stays pinned on the form path too.
    expect(viaForm.outputs.est_net_profit).not.toBeCloseTo(148466, 0);
  });

  it('accepts the formatting members actually type ($ and thousands separators)', () => {
    const built = buildFormSubmission('flip', {
      purchase_price: '$350,000',
      rehab_budget: ' 75,000 ',
      after_repair_value: '$600,000',
      holding_months: '4',
    });
    expect(built.args).toEqual(DEAL);
    expect(runFlipTool(built.args)).toEqual(runFlipTool({ ...DEAL }));
  });

  it('an edited optional field changes the result the same way typing it does', () => {
    const built = buildFormSubmission('flip', {
      purchase_price: '350000',
      rehab_budget: '75000',
      after_repair_value: '600000',
      holding_months: '4',
      interest_rate: '0.15',
    });
    expect(runFlipTool(built.args)).toEqual(runFlipTool({ ...DEAL, interest_rate: 0.15 }));
    expect(runFlipTool(built.args).outputs.est_net_profit).not.toBeCloseTo(101916, 0);
  });
});

// ---------------------------------------------------------------------------
// 4.3 Required-field validation — never compute on a silent default
// ---------------------------------------------------------------------------

describe('4.3 a blank required field is rejected, not defaulted', () => {
  it.each([
    ['missing entirely', {}],
    ['blank string', { after_repair_value: '' }],
    ['whitespace only', { after_repair_value: '   ' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      buildFormSubmission('flip', {
        purchase_price: '350000',
        rehab_budget: '75000',
        holding_months: '4',
        ...overrides,
      }),
    ).toThrow(FormValidationError);
  });

  it('names the missing field in plain language', () => {
    try {
      buildFormSubmission('flip', { purchase_price: '350000' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(FormValidationError);
      const e = err as FormValidationError;
      expect(e.message).toContain('Rehab budget');
      expect(e.message).toContain('After-repair value (ARV)');
      expect(e.message).toContain('Holding months');
      expect(e.fields.length).toBe(3);
    }
  });

  it('rejects non-numeric text rather than coercing it to 0', () => {
    expect(() =>
      buildFormSubmission('flip', {
        purchase_price: 'three hundred fifty thousand',
        rehab_budget: '75000',
        after_repair_value: '600000',
        holding_months: '4',
      }),
    ).toThrow(/aren't valid numbers/);
  });

  it('rejects an out-of-enum choice', () => {
    expect(() =>
      buildFormSubmission('brrrr', {
        purchase_price: '350000',
        rehab_budget: '75000',
        after_repair_value: '600000',
        monthly_rent: '3200',
        refinance_method: 'HELOC',
      }),
    ).toThrow(/LTV or DSCR/);
  });

  it('0 is a real value, not a blank', () => {
    const built = buildFormSubmission('flip', {
      purchase_price: '350000',
      rehab_budget: '0',
      after_repair_value: '600000',
      holding_months: '4',
    });
    expect(built.args.rehab_budget).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4.4 Untouched optional fields fall back to the sheet defaults, and say so
// ---------------------------------------------------------------------------

describe('4.4 optional fields left alone use — and disclose — the defaults', () => {
  it('omits untouched optionals so defaults_applied reports them', () => {
    const built = buildFormSubmission('flip', {
      purchase_price: '350000',
      rehab_budget: '75000',
      after_repair_value: '600000',
      holding_months: '4',
    });
    // Omitted, not zero-filled — a 0 here would silently change the deal.
    expect(built.args).not.toHaveProperty('interest_rate');
    expect(built.args).not.toHaveProperty('down_payment_pct');

    const result = runFlipTool(built.args);
    expect(result.defaults_applied).toMatchObject({
      interest_rate: 0.12,
      down_payment_pct: 0.2,
      annual_taxes: 3000,
      annual_insurance: 1200,
    });
  });

  it('an explicitly supplied optional drops out of defaults_applied', () => {
    const built = buildFormSubmission('flip', {
      purchase_price: '350000',
      rehab_budget: '75000',
      after_repair_value: '600000',
      holding_months: '4',
      interest_rate: '0.15',
    });
    const result = runFlipTool(built.args);
    expect(result.defaults_applied).not.toHaveProperty('interest_rate');
    expect(result.inputs_used.interest_rate).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// 4.5 Intent detection — form for bare intent, direct run for a full deal
// ---------------------------------------------------------------------------

async function runOnce(script: Parameters<typeof makeFakeOpenAI>[0], userMessage: string) {
  const openai = makeFakeOpenAI(script);
  const supabase = makeFakeSupabase();
  const result = await runAgent(openai.client, supabase.client, config, [], userMessage);
  return { result, calls: openai.calls };
}

describe('4.5 intent routes to a form only when the numbers are absent', () => {
  it.each([
    ['I want to run a flip', 'flip'],
    ['BRRRR calculator', 'brrrr'],
    ["let's analyze a land deal", 'land_purchase'],
  ])('%s renders the %s form', async (message, calculator) => {
    const { result } = await runOnce(
      [
        {
          toolCalls: [
            { id: 'c1', name: 'request_calculator_form', args: { calculator } },
          ],
        },
        { content: 'Fill that in and I will run it. Estimates only, not advice.' },
      ],
      message,
    );

    expect(result.renderForm, 'no form directive returned').toBeDefined();
    expect(result.renderForm!.calculator).toBe(calculator);
    expect(result.renderForm!.required.length).toBeGreaterThan(0);
    expect(result.toolCalls.map((t) => t.name)).toContain('request_calculator_form');
  });

  it('the form directive carries the fields and defaults the widget renders', async () => {
    const { result } = await runOnce(
      [
        { toolCalls: [{ id: 'c1', name: 'request_calculator_form', args: { calculator: 'flip' } }] },
        { content: 'Fill that in.' },
      ],
      'I want to run a flip',
    );
    const form = result.renderForm!;
    expect(form.required.map((f) => f.name)).toEqual([
      'purchase_price',
      'rehab_budget',
      'after_repair_value',
      'holding_months',
    ]);
    expect(form.required[0]).toMatchObject({ label: 'Purchase price', unit: 'usd', type: 'number' });
    expect(form.optional.find((f) => f.name === 'interest_rate')!.default).toBe(0.12);
  });

  it('the model is not handed the defaults to recite as the member\'s own', async () => {
    const { calls } = await runOnce(
      [
        { toolCalls: [{ id: 'c1', name: 'request_calculator_form', args: { calculator: 'flip' } }] },
        { content: 'Fill that in.' },
      ],
      'I want to run a flip',
    );
    const toolMessage = (calls[1].messages as Array<any>).find((m) => m.role === 'tool');
    const payload = JSON.parse(toolMessage.content);
    expect(payload.form_rendered).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('0.12');
  });

  it('a full natural-language deal still calculates directly — no form', async () => {
    const { result, calls } = await runOnce(
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
        { content: 'Net profit is about $101,916.' },
      ],
      'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
    );

    expect(result.renderForm).toBeUndefined();
    expect(result.toolCalls.map((t) => t.name)).toEqual(['flip_calculator']);
    const toolMessage = (calls[1].messages as Array<any>).find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content).outputs.est_net_profit).toBeCloseTo(101916, 0);
  });

  it('an unknown calculator name is refused, not guessed at', async () => {
    const { result } = await runOnce(
      [
        { toolCalls: [{ id: 'c1', name: 'request_calculator_form', args: { calculator: 'wholesale' } }] },
        { content: 'I do not have that one.' },
      ],
      'wholesale calculator',
    );
    expect(result.renderForm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4.6 Over HTTP — same endpoint, same validation, same logging
// ---------------------------------------------------------------------------

describe('4.6 /chat handles form submissions on the shared path', () => {
  it('runs the calculator and logs it exactly like a typed message', async () => {
    const openai = makeFakeOpenAI([{ content: 'Net profit is about $101,916.' }]);
    const supabase = makeFakeSupabase();
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        session_id: 's-form',
        member_email: 'member@test.com',
        form_submission: {
          calculator: 'flip',
          values: {
            purchase_price: '350000',
            rehab_budget: '75000',
            after_repair_value: '600000',
            holding_months: '4',
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tool_calls).toEqual(['flip_calculator']);

    // The seeded call ran the real runner and fed the real result to the model.
    const toolMessage = (openai.calls[0].messages as Array<any>).find((m) => m.role === 'tool');
    expect(toolMessage, 'form submission never reached a tool').toBeDefined();
    expect(JSON.parse(toolMessage.content).outputs.est_net_profit).toBeCloseTo(101916, 0);

    // Memory gets a readable transcript line, not a blob of JSON.
    const memory = supabase.inserts.find((i) => i.table === 'chat_messages');
    expect(memory, 'form submission was not remembered').toBeDefined();
    expect(body.user_message).toContain('Fix & Flip');
    expect(body.user_message).toContain('$350,000');

    await flushDetached();
    expect(supabase.inserts.some((i) => i.table === 'qa_logs')).toBe(true);
  });

  it('rejects a blank required field with 400 and never calls the model', async () => {
    const openai = makeFakeOpenAI([{ content: 'should not be reached' }]);
    const supabase = makeFakeSupabase();
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        session_id: 's-bad',
        form_submission: {
          calculator: 'flip',
          values: { purchase_price: '350000', rehab_budget: '75000', holding_months: '4' },
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('After-repair value (ARV)');
    expect(openai.calls.length, 'a rejected form still hit the model').toBe(0);
    await flushDetached();
    expect(supabase.inserts.length, 'a rejected form was logged as a real exchange').toBe(0);
  });

  it('rejects an unknown calculator', async () => {
    const openai = makeFakeOpenAI([{ content: 'x' }]);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { session_id: 's', form_submission: { calculator: 'wholesale', values: {} } },
    });
    expect(res.statusCode).toBe(400);
    expect(openai.calls.length).toBe(0);
  });

  it('a plain typed message is unaffected — no render_form, no user_message', async () => {
    const openai = makeFakeOpenAI([{ content: 'Hello.' }]);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { session_id: 's-plain', message: 'what can you help with?' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.render_form).toBeUndefined();
    expect(body.user_message).toBeUndefined();
    expect(body.output).toBe('Hello.');
  });

  it('still requires a message when there is no form submission', async () => {
    const app = buildApp(config, {
      openai: makeFakeOpenAI([{ content: 'x' }]).client,
      supabase: makeFakeSupabase().client,
    });
    const res = await app.inject({ method: 'POST', url: '/chat', payload: { session_id: 's' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('message is required');
  });

  it('surfaces render_form to the client when the model asks for it', async () => {
    const openai = makeFakeOpenAI([
      { toolCalls: [{ id: 'c1', name: 'request_calculator_form', args: { calculator: 'brrrr' } }] },
      { content: 'Fill that in.' },
    ]);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { session_id: 's-form2', message: 'BRRRR calculator' },
    });
    const body = res.json();
    expect(body.render_form.calculator).toBe('brrrr');
    expect(body.render_form.required.map((f: any) => f.name)).toContain('monthly_rent');
  });
});
