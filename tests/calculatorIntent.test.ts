/**
 * Deterministic calculator-intent routing.
 *
 * The bug these pin is NOT "the form is wrong" — it is "the form is a coin
 * flip". So the central test is repeatability: the same message routed many
 * times in a row must produce the form EVERY time, and it must do so with the
 * model actively declining to ask for one.
 *
 * MUTATION CHECK — if form-triggering is reverted to the model's discretion
 * (delete the routeCalculatorIntent block in agent.ts), suite 6.2 fails: its
 * fake model never calls request_calculator_form, so the only thing that can
 * produce renderForm is the router.
 */
import { describe, it, expect } from 'vitest';
import {
  detectCalculatorIntent,
  routeCalculatorIntent,
  hasDealNumbers,
} from '../src/agent/calculatorIntent.js';
import { runAgent } from '../src/agent/agent.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server/app.js';
import { makeFakeOpenAI, makeFakeSupabase } from './helpers/fakes.js';

const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

/**
 * A model that behaves like the bug: it replies in prose and NEVER asks for a
 * form. Any renderForm in the result therefore came from the router, not here.
 */
const REFUSING_MODEL = [
  { content: 'Sure — send me the purchase price, rehab, ARV and holding period.' },
];

// ---------------------------------------------------------------------------
// 6.1 The rules — pure, code-level, no model call
// ---------------------------------------------------------------------------

describe('6.1 intent detection is a code-level rule, not a model judgment', () => {
  it.each([
    // Explicit intent, flip
    ['run a flip', 'flip'],
    ['I want to run a flip', 'flip'],
    ['use the flip calculator', 'flip'],
    ['flip calculator', 'flip'],
    ['Flip Calculator', 'flip'],
    ['can you run a fix and flip for me', 'flip'],
    ["let's do a flip", 'flip'],
    ['flip', 'flip'],
    ['FLIP', 'flip'],
    ['  the flip one please ', 'flip'],
    // BRRRR
    ['BRRRR', 'brrrr'],
    ['brrrr', 'brrrr'],
    ['I want to do a BRRRR', 'brrrr'],
    ['run a brrr', 'brrrr'],
    ['brrrr calculator', 'brrrr'],
    ['I need to underwrite a BRRRR', 'brrrr'],
    // Land
    ['analyze a land deal', 'land_purchase'],
    ['Land', 'land_purchase'],
    ["let's do a land purchase", 'land_purchase'],
    ['land calculator', 'land_purchase'],
    ['I want to run new construction numbers', 'land_purchase'],
    ['can you model a ground-up build', 'land_purchase'],
    // Menu picks
    ['1', 'brrrr'],
    ['2', 'flip'],
    ['3', 'land_purchase'],
    ['2.', 'flip'],
    [' 3) ', 'land_purchase'],
  ])('%s -> %s form', (message, calculator) => {
    const intent = detectCalculatorIntent(message);
    expect(intent.kind, `"${message}" did not route to a form (rule: ${intent.rule})`).toBe('form');
    expect(intent.kind === 'form' && intent.calculator).toBe(calculator);
  });

  it.each([
    ['1', 'brrrr'],
    ['2', 'flip'],
    ['3', 'land_purchase'],
  ])('menu pick %s maps to %s, matching the prompt mapping', (pick, calculator) => {
    const intent = detectCalculatorIntent(pick);
    expect(intent.kind === 'form' && intent.calculator).toBe(calculator);
  });

  it('menu picks 4-6 have no form and fall through to the model', () => {
    for (const pick of ['4', '5', '6']) {
      expect(detectCalculatorIntent(pick).kind).toBe('none');
    }
  });

  it.each([
    'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
    'BRRRR on 300k purchase, 50k rehab, 550k ARV, 3200 rent',
    'run a flip at $350,000 purchase with 75,000 rehab, 600,000 ARV, 4 months',
    'land deal: 2400 sf at 225 per sf, 900k finished, 12 months',
  ])('a full deal calculates directly, no form forced: %s', (message) => {
    const intent = detectCalculatorIntent(message);
    expect(intent.kind, `forced a form in front of supplied numbers (${intent.rule})`).toBe('none');
  });

  it.each([
    'I want to analyze a deal',
    'can you analyze a deal for me',
    'help me underwrite a deal',
    "let's run the numbers on a property",
    'I want to use a calculator',
  ])('ambiguous calculator intent asks which one: %s', (message) => {
    expect(detectCalculatorIntent(message).kind).toBe('ask_which_calculator');
  });

  it('two calculators named at once asks which, rather than guessing', () => {
    const intent = detectCalculatorIntent('should I run a flip or a BRRRR on this');
    expect(intent.kind).toBe('ask_which_calculator');
  });

  it.each([
    'what should I budget for tile',
    'my flip is stalling, any advice',
    'why is the cash-on-cash so low',
    'what do you think about my flip',
    'tell me about flips',
    'how do you find comps',
    'I flipped a house last year',
    'what is a good ARV spread',
    'thanks, that helps',
  ])('ordinary conversation forces nothing: %s', (message) => {
    const intent = detectCalculatorIntent(message);
    expect(intent.kind, `"${message}" hijacked into ${intent.rule}`).toBe('none');
  });

  it('an explicit run/use signal beats the question guard', () => {
    // "how do I..." is normally conversation, but "run a flip" is unambiguous.
    const intent = detectCalculatorIntent('how do I run a flip on this one');
    expect(intent.kind === 'form' && intent.calculator).toBe('flip');
  });

  it('reports which rule fired, so a bad route is diagnosable', () => {
    expect(detectCalculatorIntent('2').rule).toContain('menu pick');
    expect(detectCalculatorIntent('run a flip').rule).toBeTruthy();
  });

  describe('deal-number detection', () => {
    it.each(['$350,000', '350k purchase', 'purchase 350000', '600k ARV and 4 months', '4 months at 12'])(
      'sees deal figures in %s',
      (text) => {
        expect(hasDealNumbers(text)).toBe(true);
      },
    );

    it.each(['2', 'run a flip', 'BRRRR', 'about 4 months'])('sees no deal figures in %s', (text) => {
      expect(hasDealNumbers(text)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 6.2 Determinism — the whole point. Repeated, and with the model refusing.
// ---------------------------------------------------------------------------

describe('6.2 the form fires every time, not usually', () => {
  const ITERATIONS = 25;

  it(`"run a flip" routes to the flip form on all ${ITERATIONS} runs`, () => {
    const outcomes: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const intent = detectCalculatorIntent('run a flip');
      outcomes.push(intent.kind === 'form' ? intent.calculator : `MISS:${intent.kind}`);
    }
    // Not "mostly flip" — every single element, with no tolerance.
    expect(outcomes).toEqual(new Array(ITERATIONS).fill('flip'));
    expect(new Set(outcomes).size, 'the route varied between identical inputs').toBe(1);
  });

  it.each([
    ['run a flip', 'flip'],
    ['I want to run a flip', 'flip'],
    ['2', 'flip'],
    ['BRRRR', 'brrrr'],
    ['I want to do a BRRRR', 'brrrr'],
    ['analyze a land deal', 'land_purchase'],
  ])(`"%s" -> %s form on all ${ITERATIONS} runs`, (message, calculator) => {
    const seen = new Set<string>();
    for (let i = 0; i < ITERATIONS; i++) {
      const intent = detectCalculatorIntent(message);
      seen.add(intent.kind === 'form' ? intent.calculator : `MISS:${intent.kind}`);
    }
    expect([...seen]).toEqual([calculator]);
  });

  it(`runAgent renders the form all ${ITERATIONS} times even when the model never asks for one`, async () => {
    const results: Array<string | undefined> = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const openai = makeFakeOpenAI(REFUSING_MODEL);
      const supabase = makeFakeSupabase();
      const result = await runAgent(openai.client, supabase.client, config, [], 'run a flip');
      results.push(result.renderForm?.calculator);
      // The guarantee is in code, so it must be attributed to the router.
      expect(result.formTrigger).toBe('router');
      // And it must have gone through the real tool path, leaving a trace.
      expect(result.toolCalls.map((t) => t.name)).toContain('request_calculator_form');
    }
    expect(results).toEqual(new Array(ITERATIONS).fill('flip'));
  });

  it('the model declining the tool cannot suppress the BRRRR or land form either', async () => {
    for (const [message, calculator] of [
      ['I want to do a BRRRR', 'brrrr'],
      ['1', 'brrrr'],
      ['analyze a land deal', 'land_purchase'],
      ['3', 'land_purchase'],
    ] as const) {
      const openai = makeFakeOpenAI(REFUSING_MODEL);
      const result = await runAgent(
        openai.client,
        makeFakeSupabase().client,
        config,
        [],
        message,
      );
      expect(result.renderForm?.calculator, `"${message}" produced no form`).toBe(calculator);
      expect(result.formTrigger).toBe('router');
    }
  });

  it('the routed form carries the real derived field set the widget needs', async () => {
    const openai = makeFakeOpenAI(REFUSING_MODEL);
    const result = await runAgent(
      openai.client,
      makeFakeSupabase().client,
      config,
      [],
      'run a flip',
    );
    expect(result.renderForm!.required.map((f) => f.name)).toEqual([
      'purchase_price',
      'rehab_budget',
      'after_repair_value',
      'holding_months',
    ]);
    expect(result.renderForm!.optional.find((f) => f.name === 'interest_rate')!.default).toBe(0.12);
  });

  it('the model is told the form is already up, and is not handed the defaults', async () => {
    const openai = makeFakeOpenAI(REFUSING_MODEL);
    await runAgent(openai.client, makeFakeSupabase().client, config, [], 'run a flip');
    const toolMessage = (openai.calls[0].messages as Array<any>).find((m) => m.role === 'tool');
    expect(toolMessage, 'the router never seeded a tool result').toBeDefined();
    const payload = JSON.parse(toolMessage.content);
    expect(payload.form_rendered).toBe(true);
    // Same guarantee as the model-driven path: defaults are not recitable.
    expect(JSON.stringify(payload)).not.toContain('0.12');
  });

  it('the system prompt agrees with the router (backup, not mechanism)', async () => {
    const { SYSTEM_PROMPT } = await import('../src/agent/systemPrompt.js');
    expect(SYSTEM_PROMPT).toMatch(/CALCULATOR INTENT WITHOUT NUMBERS ALWAYS GETS THE FORM/);
    expect(SYSTEM_PROMPT).toMatch(/request_calculator_form/);
  });
});

// ---------------------------------------------------------------------------
// 6.3 The natural-language path is untouched
// ---------------------------------------------------------------------------

describe('6.3 a full typed deal still calculates, with no form in the way', () => {
  it('does not route, and the model runs the calculator', async () => {
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
      },
      { content: 'Net profit is about $101,916.' },
    ]);
    const result = await runAgent(
      openai.client,
      makeFakeSupabase().client,
      config,
      [],
      'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months',
    );

    expect(result.renderForm).toBeUndefined();
    expect(result.toolCalls.map((t) => t.name)).toEqual(['flip_calculator']);
    const toolMessage = (openai.calls[1].messages as Array<any>).find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage.content).outputs.est_net_profit).toBeCloseTo(101916, 0);
  });

  it('a carry-forward turn is left to the model, not fronted with an empty form', () => {
    const history = [
      { role: 'user' as const, content: 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months' },
      { role: 'assistant' as const, content: 'Net profit is about $101,916.' },
    ];
    expect(routeCalculatorIntent('same deal but 4 months', history).kind).toBe('none');
    expect(routeCalculatorIntent('rerun that flip with the same numbers', history).kind).toBe(
      'none',
    );
  });

  it('a follow-up question about a result does not re-open a form', () => {
    const history = [
      { role: 'user' as const, content: 'Flip: 350k purchase, 75k rehab, 600k ARV, 4 months' },
      { role: 'assistant' as const, content: 'Net profit is about $101,916.' },
    ];
    expect(routeCalculatorIntent('why is the cash-on-cash so low?', history).kind).toBe('none');
  });

  it('"which calculator?" is not asked when the history already says', () => {
    const history = [
      { role: 'user' as const, content: 'I want to run a flip' },
      { role: 'assistant' as const, content: 'Fill that in.' },
    ];
    expect(detectCalculatorIntent('can you analyze the deal').kind).toBe('ask_which_calculator');
    expect(routeCalculatorIntent('can you analyze the deal', history).kind).toBe('none');
  });

  it('history can only suppress a route, never change which calculator fires', () => {
    const history = [{ role: 'user' as const, content: 'I ran a BRRRR last week' }];
    const intent = routeCalculatorIntent('run a flip', history);
    expect(intent.kind === 'form' && intent.calculator).toBe('flip');
  });
});

// ---------------------------------------------------------------------------
// 6.4 The genuinely ambiguous case: ask, then fire on the answer
// ---------------------------------------------------------------------------

describe('6.4 "analyze a deal" asks which, then the answer fires the form', () => {
  it('turn 1 asks and shows no form; turn 2 names it and the form fires', async () => {
    // Turn 1 — no calculator named. No form, and the model is directed to ask.
    const first = makeFakeOpenAI([{ content: 'Flip, BRRRR, or land — which one are we running?' }]);
    const ask = await runAgent(
      first.client,
      makeFakeSupabase().client,
      config,
      [],
      'I want to analyze a deal',
    );
    expect(ask.renderForm, 'a form was guessed at without a calculator named').toBeUndefined();
    const directive = (first.calls[0].messages as Array<any>).filter((m) => m.role === 'system');
    expect(directive.some((m: any) => /ROUTING \(this turn\)/.test(m.content))).toBe(true);
    expect(directive.some((m: any) => /Ask which one/.test(m.content))).toBe(true);

    // Turn 2 — they name it. Deterministic, even with the model still refusing.
    const history = [
      { role: 'user' as const, content: 'I want to analyze a deal' },
      { role: 'assistant' as const, content: ask.output },
    ];
    const second = makeFakeOpenAI(REFUSING_MODEL);
    const formed = await runAgent(
      second.client,
      makeFakeSupabase().client,
      config,
      history,
      'flip',
    );
    expect(formed.renderForm?.calculator).toBe('flip');
    expect(formed.formTrigger).toBe('router');
  });

  it.each([
    ['flip', 'flip'],
    ['BRRRR', 'brrrr'],
    ['land', 'land_purchase'],
    ['the flip one', 'flip'],
    ['2', 'flip'],
  ])('answering "%s" after the ask fires the %s form', (answer, calculator) => {
    const history = [
      { role: 'user' as const, content: 'I want to analyze a deal' },
      { role: 'assistant' as const, content: 'Flip, BRRRR, or land?' },
    ];
    const intent = routeCalculatorIntent(answer, history);
    expect(intent.kind === 'form' && intent.calculator).toBe(calculator);
  });
});

// ---------------------------------------------------------------------------
// 6.5 Over HTTP — the widget receives render_form on clear intent
// ---------------------------------------------------------------------------

describe('6.5 /chat returns render_form deterministically', () => {
  it.each([
    ['run a flip', 'flip'],
    ['I want to do a BRRRR', 'brrrr'],
    ['analyze a land deal', 'land_purchase'],
    ['2', 'flip'],
  ])('POST %s -> render_form %s, with the model refusing', async (message, calculator) => {
    const openai = makeFakeOpenAI(REFUSING_MODEL);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { session_id: 's-route', message },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.render_form, `no render_form for "${message}"`).toBeDefined();
    expect(body.render_form.calculator).toBe(calculator);
    expect(body.tool_calls).toContain('request_calculator_form');
  });

  it('a plain question still gets no render_form', async () => {
    const openai = makeFakeOpenAI([{ content: 'Happy to help.' }]);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { session_id: 's-plain2', message: 'what can you help with?' },
    });
    expect(res.json().render_form).toBeUndefined();
  });

  it('a form submission is not re-routed into another form', async () => {
    const openai = makeFakeOpenAI([{ content: 'Net profit is about $101,916.' }]);
    const app = buildApp(config, { openai: openai.client, supabase: makeFakeSupabase().client });
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        session_id: 's-sub',
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
    const body = res.json();
    expect(body.render_form, 'a submitted form looped back into a new form').toBeUndefined();
    expect(body.tool_calls).toEqual(['flip_calculator']);
  });
});
