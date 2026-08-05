/**
 * THE SECOND ENTRY POINT — the inline calculator form.
 *
 * The P1 suite proves the chat/tool-call path. The form is a different road to
 * the same calculators, and every guarantee that path earned has to be proved
 * again here rather than assumed to carry over.
 *
 * Two questions outrank the rest, and both are answered from the wiring rather
 * than from anyone's claim:
 *
 *   1. Does a SUBMITTED form ARV go through `applyArvPrefill`, or bypass it?
 *      If it bypasses, every guard the chat path earned is reachable around.
 *   2. Can the MODEL populate the form, or only the member? If the model can
 *      put values in it, the form becomes a laundering channel for exactly the
 *      stale figures the mismatch guard exists to stop.
 *
 * DISCIPLINE NOTE. Every test here leads with a positive precondition. "The
 * stale ARV is absent from the form" passes trivially if the form never
 * renders, and a new surface is precisely where that recurs — so each case
 * first proves the form rendered and carries the field in question.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import { makeCompsSupabase, makeProviderSpy, type ProviderSpyOptions } from '../helpers/compsFakes.js';
import { golden01 } from '../fixtures/golden/index.js';
import { TOOL_DEFINITIONS } from '../../src/agent/toolDefs.js';
import { CALCULATOR_FORMS } from '../../src/agent/formSchema.js';

const MODS = ['service', 'tools'] as const;

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

const SUBJECT_A = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
const FRESH_COMPS = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (30 + i * 10) * 86_400_000).toISOString().slice(0, 10),
}));

const say = (content: string): FakeCompletion => ({ content });
const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: `rc-${address.slice(0, 6)}`, name: 'run_comps', args: { address } }],
});

interface FormPrefill {
  value: number;
  subjectAddress: string;
  arvSource: string;
  confidence?: string | null;
  /** Member-visible text. A correct value with no label is a FAIL. */
  label: string;
}
interface FormField {
  name: string;
  label: string;
  required: boolean;
  /** Static sheet default. Required fields never have one. */
  default?: number | string;
  /** Session-derived ARV binding — deliberately NOT `default`. */
  prefill?: FormPrefill;
}
interface RenderedForm {
  calculator: string;
  tool: string;
  required: FormField[];
  optional: FormField[];
}

function build(opts: { script: FakeCompletion[]; provider?: ProviderSpyOptions; supabase?: ReturnType<typeof makeCompsSupabase> }) {
  const openai = makeFakeOpenAI(opts.script);
  const supabase = opts.supabase ?? makeCompsSupabase({});
  const spy = makeProviderSpy(opts.provider ?? {});
  const app = buildApp(config, {
    openai: openai.client, supabase: supabase.client, propertyProvider: spy.provider,
  } as never);
  return { app, openai, supabase, spy };
}

async function post(
  app: ReturnType<typeof buildApp>,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST', url: '/chat',
    headers: { origin: ALLOWED, 'content-type': 'application/json' },
    payload,
  });
  return { status: res.statusCode, body: res.statusCode < 500 ? res.json() : {} };
}

const chat = (app: ReturnType<typeof buildApp>, message: string, session_id: string) =>
  post(app, { message, session_id, member_email: 'member@example.com' });

/** Pull the rendered form out of a /chat response. */
const formOf = (body: Record<string, unknown>): RenderedForm | undefined =>
  body.render_form as RenderedForm | undefined;

const fieldNamed = (form: RenderedForm, name: string): FormField | undefined =>
  [...form.required, ...form.optional].find((f) => f.name === name);

/** Every tool result the model was shown, parsed. */
function toolResults(calls: Array<Record<string, unknown>>): unknown[] {
  const out: unknown[] = [];
  for (const call of calls) {
    for (const m of (call.messages as Array<Record<string, unknown>>) ?? []) {
      if (m.role === 'tool') {
        try { out.push(JSON.parse(m.content as string)); } catch { out.push(m.content); }
      }
    }
  }
  return out;
}
const flipResult = (calls: Array<Record<string, unknown>>) =>
  toolResults(calls).find((r) => (r as { calculator?: string }).calculator === 'flip') as
    | { inputs_used?: Record<string, unknown>; arv_prefill?: Record<string, unknown> }
    | undefined;

/** Bind a comps block for `session`, then return an app to keep using. */
async function bindComps(session: string, supabase: ReturnType<typeof makeCompsSupabase>) {
  const { app } = build({
    script: [runComps('123 Main St'), say('Comps done — ARV $403,000.')],
    provider: { subject: SUBJECT_A, comps: FRESH_COMPS },
    supabase,
  });
  await chat(app, 'run comps on 123 Main St', session);
  expect(
    supabase.compsBlockFor(session)?.arv,
    'PRECONDITION: no comps block was bound, so nothing below proves anything',
  ).toBe(403000);
}

describe(`the calculator form as a second entry point${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // BLOCKER QUESTION 2 — can the model put values in the form?
  // =========================================================================
  describe('the model can choose WHICH form, never what is in it', () => {
    it('request_calculator_form accepts only a closed calculator enum', () => {
      // If the model could pass values, the form would be a laundering channel
      // for exactly the stale figures the mismatch guard exists to stop: the
      // model reads an ARV from history, puts it in the form, and it arrives
      // wearing the member's clothes.
      const def = TOOL_DEFINITIONS.find(
        (t) => t.function.name === 'request_calculator_form',
      );
      expect(def, 'request_calculator_form is not registered').toBeDefined();
      const params = def!.function.parameters as Record<string, unknown>;
      const props = params.properties as Record<string, Record<string, unknown>>;

      expect(Object.keys(props), 'the model can supply more than the calculator key')
        .toEqual(['calculator']);
      expect(props.calculator.enum).toEqual(['flip', 'brrrr', 'land_purchase']);
      expect(params.additionalProperties, 'the schema is open — the model can smuggle fields')
        .toBe(false);
      expect(params.required).toEqual(['calculator']);

      // Nothing value-shaped anywhere in the schema.
      for (const forbidden of ['values', 'defaults', 'prefill', 'after_repair_value', 'arv']) {
        expect(props, `the model can populate "${forbidden}"`).not.toHaveProperty(forbidden);
      }
    });

    it('ADVERSARIAL: extra args from the model are ignored, not honoured', async () => {
      // `additionalProperties: false` is a DIRECTIVE to the model, not a
      // runtime guarantee — a model can and does emit keys outside its schema.
      // The real defence has to be that the handler ignores them. If it merged
      // caller-supplied values into the form, the model could put any figure in
      // front of the member wearing the label of a real comps run.
      const supabase = makeCompsSupabase({});
      await bindComps('form-adversarial', supabase);

      const { app } = build({
        script: [
          {
            toolCalls: [{
              id: 'evil', name: 'request_calculator_form',
              args: {
                calculator: 'flip',
                // Everything a model might try, all at once.
                values: { after_repair_value: 999000 },
                prefill: { value: 999000, subjectAddress: '999 FAKE ST', label: 'Pre-filled from comps' },
                defaults: { after_repair_value: 999000 },
                after_repair_value: 999000,
                arv: 999000,
              },
            }],
          },
          say('Fill in the form.'),
        ],
        supabase,
      });
      const { body } = await chat(app, 'I want to run a flip', 'form-adversarial');
      const form = formOf(body);
      expect(form, 'no form rendered').toBeDefined();

      const serialized = JSON.stringify(form);
      expect(serialized, 'a model-supplied value reached the rendered form')
        .not.toContain('999000');
      expect(serialized, 'a model-supplied address reached the rendered form')
        .not.toContain('999 FAKE');

      // The genuine, session-derived prefill is what survives.
      const arv = fieldNamed(form!, 'after_repair_value')!;
      expect(arv.prefill?.value, 'the real comps prefill was displaced').toBe(403000);
      expect(arv.prefill!.subjectAddress).toContain('123 MAIN');
    });

    it('the form the model receives carries labels but no values', () => {
      // The handler returns `required_fields` as LABELS. If it returned
      // defaults, the model could recite them as though the member had given
      // them — the frozen-$148,466 shape, one surface over.
      const { app, openai } = build({
        script: [
          { toolCalls: [{ id: 'f1', name: 'request_calculator_form', args: { calculator: 'flip' } }] },
          say('Fill in the form below.'),
        ],
      });
      return chat(app, 'I want to run a flip', 'form-model-view').then(() => {
        const shown = toolResults(openai.calls).find(
          (r) => (r as { form_rendered?: boolean }).form_rendered === true,
        ) as Record<string, unknown> | undefined;
        expect(shown, 'the form result never reached the model').toBeDefined();
        const text = JSON.stringify(shown);
        expect(text, 'the model was handed field VALUES, not just labels')
          .not.toMatch(/"default"|"values"|after_repair_value"\s*:\s*\d/);
        expect(shown!.required_fields, 'labels missing').toBeDefined();
      });
    });
  });

  // =========================================================================
  // BLOCKER QUESTION 1 — does a submitted form ARV traverse applyArvPrefill?
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('a submitted form ARV goes through the same guard', () => {
    it('a form submission reaches the calculator at all', async () => {
      // PRECONDITION for everything below it.
      const { app, openai } = build({ script: [say('Here are your numbers.')] });
      const { status } = await post(app, {
        session_id: 'form-basic',
        form_submission: {
          calculator: 'flip',
          values: {
            purchase_price: 300000, rehab_budget: 60000,
            after_repair_value: 520000, holding_months: 4,
          },
        },
      });
      expect(status).toBe(200);
      const flip = flipResult(openai.calls);
      expect(flip, 'the form submission never reached flip_calculator').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(520000);
    });

    it('a submitted ARV equal to the bound block gets the SAME echo as the chat path', async () => {
      // This is the proof that the form does not bypass `applyArvPrefill`:
      // `arv_prefill` is attached by that function and by nothing else, so its
      // presence on a FORM submission means the guard ran on this path too.
      const supabase = makeCompsSupabase({});
      await bindComps('form-guard', supabase);

      const { app, openai } = build({ script: [say('Numbers are in.')], supabase });
      const { status, body } = await post(app, {
        session_id: 'form-guard',
        form_submission: {
          calculator: 'flip',
          values: {
            purchase_price: 300000, rehab_budget: 60000,
            after_repair_value: 403000, holding_months: 4,
          },
        },
      });
      expect(status).toBe(200);

      const flip = flipResult(openai.calls);
      expect(flip, 'flip never ran').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(403000);

      // The echo is prepended in `finish()` from `ctx.lastArvPrefill`, which
      // ONLY `applyArvPrefill` sets. Its presence on a FORM submission is the
      // proof that this path traverses the same guard as the chat path rather
      // than routing around it.
      expect(
        String(body.output).toUpperCase(),
        'a form submission produced no bound-address echo — it bypassed ' +
          'applyArvPrefill, and every guard the chat path earned is reachable around',
      ).toContain('123 MAIN');
    });

    it('the form path cannot be used to smuggle a value the member did not type', async () => {
      // The form has no channel for the model to write into (asserted above),
      // so the only ARV that can arrive is one a human typed. Restated as a
      // property of the delivered surface rather than of the schema.
      const supabase = makeCompsSupabase({});
      await bindComps('form-smuggle', supabase);

      const { app, openai } = build({ script: [say('ok')], supabase });
      await post(app, {
        session_id: 'form-smuggle',
        form_submission: {
          calculator: 'flip',
          values: {
            purchase_price: 300000, rehab_budget: 60000,
            after_repair_value: 450000, holding_months: 4,
          },
        },
      });
      const flip = flipResult(openai.calls);
      expect(flip, 'flip never ran').toBeDefined();
      // The member's own number wins; the bound 403,000 does not override it.
      expect(flip!.inputs_used!.after_repair_value).toBe(450000);
    });
  });

  // =========================================================================
  // THE PORTED P1 GUARANTEES.
  //
  // The form DOES consume session_state — the ARV arrives on a dedicated
  // `prefill` property, deliberately separate from `default` so the "required
  // fields never carry a default" invariant survives. Each case below proves
  // the form rendered and carries the field BEFORE asserting anything about
  // its contents.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('P1 guarantees, ported to the form surface', () => {
    /** Render a flip form in `session`; assert it exists and has the ARV field. */
    async function renderFlipForm(
      session: string,
      supabase: ReturnType<typeof makeCompsSupabase>,
      message = 'I want to run a flip',
    ) {
      const { app } = build({
        script: [
          { toolCalls: [{ id: 'ff', name: 'request_calculator_form', args: { calculator: 'flip' } }] },
          say('Fill in the form.'),
        ],
        supabase,
      });
      const { body } = await chat(app, message, session);
      const form = formOf(body);
      // POSITIVE PRECONDITION — the point of this whole block. Without it every
      // "the stale ARV is absent" assertion below passes on a form that never
      // rendered, which is the exact class caught in the state suite tonight.
      expect(form, 'no form was rendered, so every absence assertion below is vacuous')
        .toBeDefined();
      expect(form!.calculator).toBe('flip');
      const arv = fieldNamed(form!, 'after_repair_value');
      expect(arv, 'the form has no after_repair_value field to check').toBeDefined();
      return { form: form!, arvField: arv!, body };
    }

    it('ADDRESS BINDING: a pre-filled ARV carries a LABEL naming the source property', async () => {
      // The mandated case, and the one a value-only assertion would miss: a
      // correct number with no label is a FAIL, because the member cannot tell
      // which house it came from.
      const supabase = makeCompsSupabase({});
      await bindComps('form-bind', supabase);
      const { arvField } = await renderFlipForm('form-bind', supabase);

      expect(arvField.prefill, 'the form did not pre-fill from the bound comps block')
        .toBeDefined();
      expect(arvField.prefill!.value).toBe(403000);
      expect(arvField.prefill!.subjectAddress).toContain('123 MAIN');

      // THE RENDERED LABEL, not the value.
      const label = arvField.prefill!.label;
      expect(label, 'the pre-filled ARV has no member-visible label').toBeTruthy();
      expect(label.toUpperCase(), 'the label does not name the source property')
        .toContain('123 MAIN');
      expect(label.toLowerCase(), 'the label does not say it can be edited')
        .toMatch(/edit|override|change/);
    });

    it('NO FABRICATION: with no comps block, the ARV field carries no prefill', async () => {
      const supabase = makeCompsSupabase({});
      const { arvField } = await renderFlipForm('form-nofab', supabase);
      expect(supabase.compsBlockFor('form-nofab'), 'precondition: a block existed').toBeUndefined();
      expect(arvField.prefill, 'the form invented an ARV pre-fill from nothing').toBeUndefined();
      expect(arvField.default, 'a required field acquired a default').toBeUndefined();
    });

    it('CLEAR-BEFORE-PROVIDER: a FAILED comps run leaves no form pre-fill', async () => {
      // The wrong-house bug, ported. A succeeds and binds $403,000; B fails. If
      // the block were not cleared at the START of B's run, the form would
      // arrive pre-filled with A's number and labelled with A's address.
      const supabase = makeCompsSupabase({});
      await bindComps('form-clear', supabase);

      // Prove the pre-fill EXISTS first, so its later absence means something.
      const before = await renderFlipForm('form-clear', supabase);
      expect(before.arvField.prefill?.value, 'precondition: nothing was bound to clear')
        .toBe(403000);

      const failing = build({
        script: [runComps('456 Oak Ave'), say('That one did not work.')],
        provider: { failSubject: { kind: 'timeout' } },
        supabase,
      });
      await chat(failing.app, 'run comps on 456 Oak Ave', 'form-clear');
      expect(
        supabase.compsBlockFor('form-clear'),
        'precondition: the failed run did not clear the block',
      ).toBeUndefined();

      const after = await renderFlipForm('form-clear', supabase);
      expect(
        after.arvField.prefill,
        "the form still pre-fills 123 Main's ARV after the run on 456 Oak FAILED — " +
          'the wrong-house bug, reopened on the form surface',
      ).toBeUndefined();
    });

    it('MISMATCH: a form requested for a DIFFERENT address is not pre-filled', async () => {
      const supabase = makeCompsSupabase({});
      await bindComps('form-mismatch', supabase);

      // Prove the pre-fill fires on the neutral request first.
      const neutral = await renderFlipForm('form-mismatch', supabase);
      expect(neutral.arvField.prefill?.value, 'precondition: no pre-fill to suppress')
        .toBe(403000);

      const { arvField } = await renderFlipForm(
        'form-mismatch',
        supabase,
        'I want to run a flip on 456 Oak Ave',
      );
      expect(
        arvField.prefill,
        "the form pre-filled 123 Main's ARV for a flip the member asked about at 456 Oak",
      ).toBeUndefined();
    });

    it("SESSION ISOLATION: session A's block never reaches session B's form", async () => {
      const supabase = makeCompsSupabase({});
      await bindComps('form-alice', supabase);

      const alice = await renderFlipForm('form-alice', supabase);
      expect(alice.arvField.prefill?.value, 'precondition: Alice has no pre-fill').toBe(403000);

      const bob = await renderFlipForm('form-bob', supabase);
      expect(bob.arvField.prefill, "Alice's ARV leaked into Bob's form").toBeUndefined();
      expect(supabase.compsBlockFor('form-bob'), 'Bob somehow has a block').toBeUndefined();
      expect(supabase.compsBlockFor('form-alice')?.arv, 'Alice was disturbed').toBe(403000);
    });

    it('EDITABILITY: a member edit beats the pre-filled value', async () => {
      const supabase = makeCompsSupabase({});
      await bindComps('form-edit', supabase);
      const rendered = await renderFlipForm('form-edit', supabase);
      expect(rendered.arvField.prefill?.value, 'precondition: nothing was pre-filled to override')
        .toBe(403000);

      const { app, openai } = build({ script: [say('Numbers are in.')], supabase });
      await post(app, {
        session_id: 'form-edit',
        form_submission: {
          calculator: 'flip',
          values: {
            purchase_price: 300000, rehab_budget: 60000,
            after_repair_value: 375000, holding_months: 4, // edited away from 403,000
          },
        },
      });
      const flip = flipResult(openai.calls);
      expect(flip, 'flip never ran').toBeDefined();
      expect(
        flip!.inputs_used!.after_repair_value,
        'the pre-filled ARV overrode what the member actually typed',
      ).toBe(375000);
    });

    it('the pre-fill rides on `prefill`, never on `default`', () => {
      // Structural reason the invariant survives: a required field carrying a
      // `default` is the frozen-$148,466 shape — the member submits without
      // noticing and the sheet's number is priced as though it were theirs.
      // Keeping the session binding on a separate property preserves that.
      for (const [key, form] of Object.entries(CALCULATOR_FORMS)) {
        for (const field of form.required) {
          expect(
            field.default,
            `${key}.${field.name} is required AND carries a default`,
          ).toBeUndefined();
        }
      }
    });

    it('BRRRR pre-fills and labels identically', async () => {
      const supabase = makeCompsSupabase({});
      await bindComps('form-brrrr', supabase);
      const { app } = build({
        script: [
          { toolCalls: [{ id: 'bf', name: 'request_calculator_form', args: { calculator: 'brrrr' } }] },
          say('Fill in the form.'),
        ],
        supabase,
      });
      const { body } = await chat(app, 'I want to run a BRRRR', 'form-brrrr');
      const form = formOf(body);
      expect(form, 'no BRRRR form rendered').toBeDefined();
      const arv = fieldNamed(form!, 'after_repair_value');
      expect(arv, 'the BRRRR form has no ARV field').toBeDefined();
      expect(arv!.prefill?.value, 'BRRRR does not pre-fill from comps').toBe(403000);
      expect(arv!.prefill!.label.toUpperCase(), 'the BRRRR label does not name the property')
        .toContain('123 MAIN');
    });
  });
});
