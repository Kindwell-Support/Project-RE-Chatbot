/**
 * BUG-011 VERIFICATION — the manual ARV's address binding, as RULED.
 *
 * The ruling (operator, 2026-08-10): `set_manual_arv` gains an optional
 * `address` argument, binding CURRENT-MESSAGE-ONLY. No address -> the stored
 * `subjectAddress` is null — not the literal string 'manual entry'. The
 * mismatch guard does not fire on null. The echo drops its address clause
 * when unbound.
 *
 * Explicitly NOT the never-conflict shortcut: a bound ARV on A still
 * conflicts with B. Only UNBOUND ARVs skip the check, because there is
 * nothing to check. The bound-and-conflicting case below is the control that
 * proves the guard still exists — if it ever passes with a silent carry, the
 * fix blurred into the shortcut and the A -> B leak is re-opened.
 *
 * These cases are written from the ruling, not from MASON's implementation,
 * and they cover the NAMED-property path specifically — the original guard
 * test passed precisely because its message contained no address, which is
 * how BUG-011 survived a green suite.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import { makeCompsSupabase, makeProviderSpy } from '../helpers/compsFakes.js';

const MODS = ['service', 'tools'] as const;

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

const say = (content: string): FakeCompletion => ({ content });
const setArv = (arv: number, address?: string): FakeCompletion => ({
  toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: address ? { arv, address } : { arv } }],
});
const runFlip = (args: Record<string, unknown> = {}): FakeCompletion => ({
  toolCalls: [{
    id: 'f1', name: 'flip_calculator',
    args: { purchase_price: 300000, rehab_budget: 60000, holding_months: 4, ...args },
  }],
});
const requestForm = (calculator: string): FakeCompletion => ({
  toolCalls: [{ id: 'rf1', name: 'request_calculator_form', args: { calculator } }],
});

function build(script: FakeCompletion[], supabase = makeCompsSupabase({})) {
  const openai = makeFakeOpenAI(script);
  const spy = makeProviderSpy({});
  const app = buildApp(config, {
    openai: openai.client, supabase: supabase.client, propertyProvider: spy.provider,
  } as never);
  return { app, openai, supabase };
}

const chat = (app: ReturnType<typeof buildApp>, message: string, session_id: string) =>
  app.inject({
    method: 'POST', url: '/chat',
    headers: { origin: ALLOWED, 'content-type': 'application/json' },
    payload: { message, session_id, member_email: 'member@example.com' },
  }).then((r) => ({ status: r.statusCode, body: r.statusCode < 500 ? r.json() : ({} as Record<string, unknown>) }));

const toolResults = (calls: Array<Record<string, unknown>>) =>
  calls.flatMap((c) => ((c.messages as Array<Record<string, unknown>>) ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => { try { return JSON.parse(String(m.content)); } catch { return String(m.content); } }));

const flipOf = (calls: Array<Record<string, unknown>>) =>
  toolResults(calls).find((r) => (r as { calculator?: string }).calculator === 'flip') as
    | { inputs_used?: Record<string, unknown> } | undefined;

describe(`manual ARV binding — the four states${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('STATE 1 — bound and MATCHING', () => {
    it('pre-fills, and the echo names the real address (never the placeholder)', async () => {
      const supabase = makeCompsSupabase({});
      const a = build([setArv(450000, '123 Main St, Seattle, WA'), say('Got it.')], supabase);
      await chat(a.app, 'use 450k as the ARV for 123 Main St', 'b-match');

      // PRECONDITION: bound to the real address, not the placeholder and not null.
      const block = supabase.compsBlockFor('b-match');
      expect(block?.arv, 'the manual ARV was never stored').toBe(450000);
      expect(
        String(block?.subjectAddress ?? '').toUpperCase(),
        `stored subjectAddress is ${JSON.stringify(block?.subjectAddress)} — the address argument was not bound`,
      ).toContain('123 MAIN');

      // The member names the SAME property. This is the path my original test
      // missed, and the path BUG-011 broke: same address must pre-fill.
      const b = build([runFlip(), say('Numbers.')], supabase);
      const reply = await chat(b.app, 'run the flip numbers on 123 Main St', 'b-match');

      const flip = flipOf(b.openai.calls);
      expect(flip, 'the calculator never ran').toBeDefined();
      expect(
        flip!.inputs_used?.after_repair_value,
        "the member's own ARV was refused for the very address they bound it to",
      ).toBe(450000);

      const out = String(reply.body.output);
      expect(out.replace(/[$,\s]/g, ''), 'the echo lost the ARV').toContain('450000');
      expect(out.toUpperCase(), 'the echo does not name the bound address').toContain('123 MAIN');
      expect(out.toLowerCase(), 'the placeholder leaked into member-visible copy')
        .not.toContain('for manual entry');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('STATE 2 — bound and CONFLICTING (the control)', () => {
    it('the guard fires and nothing is carried silently', async () => {
      // THE control against the never-conflict shortcut. If this case ever
      // sees 450,000 reach the calculator, the fix traded the guard away.
      const supabase = makeCompsSupabase({});
      const a = build([setArv(450000, '123 Main St, Seattle, WA'), say('Got it.')], supabase);
      await chat(a.app, 'use 450k as the ARV for 123 Main St', 'b-conflict');
      expect(
        String(supabase.compsBlockFor('b-conflict')?.subjectAddress ?? '').toUpperCase(),
        'PRECONDITION: nothing bound — a conflict with nothing is vacuous',
      ).toContain('123 MAIN');

      const b = build([runFlip(), say('Which property is this for?')], supabase);
      const reply = await chat(b.app, 'run the flip numbers on 456 Oak Ave', 'b-conflict');

      const flip = flipOf(b.openai.calls);
      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        flip?.inputs_used?.after_repair_value,
        "the ARV bound to 123 Main silently priced a flip on 456 Oak — the guard is gone",
      ).not.toBe(450000);
      expect(String(reply.body.output).replace(/[$,\s]/g, '')).not.toContain('450000');

      // And the guard's question must name the REAL stored address — a member
      // can answer "which deal: 123 Main or 456 Oak". Nobody can answer
      // "which deal: manual entry or 456 Oak".
      const guard = toolResults(b.openai.calls)
        .map((r) => (typeof r === 'object' && r !== null ? String((r as { error?: string }).error ?? '') : ''))
        .find((e) => /different property|do not reuse|which deal/i.test(e));
      expect(guard, 'no guard message reached the model').toBeDefined();
      expect(guard!.toUpperCase(), 'the guard does not name the bound address').toContain('123 MAIN');
      expect(guard!.toLowerCase(), 'the guard still says "manual entry" as an address')
        .not.toContain('manual entry,');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('STATE 3 — UNBOUND', () => {
    it('stores null (not the placeholder), skips the guard, and the echo drops the address clause', async () => {
      const supabase = makeCompsSupabase({});
      const a = build([setArv(450000), say('Got it.')], supabase);
      await chat(a.app, 'use 450k as the ARV', 'b-unbound');

      const block = supabase.compsBlockFor('b-unbound');
      expect(block?.arv, 'PRECONDITION: the manual ARV was never stored').toBe(450000);
      expect(
        block?.subjectAddress ?? null,
        `an unbound ARV stored subjectAddress ${JSON.stringify(block?.subjectAddress)} — the ruling is null`,
      ).toBeNull();

      // A later turn that names a property: with nothing bound there is
      // nothing to conflict with, so the guard must NOT fire.
      const b = build([runFlip(), say('Numbers.')], supabase);
      const reply = await chat(b.app, 'run the flip numbers on 456 Oak Ave', 'b-unbound');

      const flip = flipOf(b.openai.calls);
      expect(flip, 'the calculator never ran').toBeDefined();
      expect(
        flip!.inputs_used?.after_repair_value,
        'an UNBOUND manual ARV was refused — the guard fired on null',
      ).toBe(450000);

      const out = String(reply.body.output);
      expect(out.replace(/[$,\s]/g, ''), 'the echo lost the ARV').toContain('450000');
      expect(out.toLowerCase(), 'the placeholder is back').not.toContain('manual entry for');
      expect(out.toLowerCase(), '"for manual entry" survived the fix')
        .not.toContain('for manual entry');
    });

    it('the form label for an unbound ARV names no property and no placeholder', async () => {
      // Same guarantee, other surface. `prefillLabel` special-cased the
      // placeholder string; under the ruling it must handle null.
      const supabase = makeCompsSupabase({});
      const a = build([setArv(450000), say('Got it.')], supabase);
      await chat(a.app, 'use 450k as the ARV', 'b-unbound-form');
      expect(supabase.compsBlockFor('b-unbound-form')?.arv, 'PRECONDITION').toBe(450000);

      const b = build([requestForm('flip'), say('Fill in the form.')], supabase);
      const reply = await chat(b.app, 'I want to run a flip', 'b-unbound-form');

      const form = (reply.body as { render_form?: { required: Array<Record<string, unknown>>; optional: Array<Record<string, unknown>> } }).render_form;
      expect(form, 'no form rendered').toBeDefined();
      const arvField = [...form!.required, ...form!.optional]
        .find((f) => f.name === 'after_repair_value') as
        | { prefill?: { value?: number; label?: string } } | undefined;
      expect(arvField, 'the flip form has no ARV field').toBeDefined();
      expect(arvField!.prefill?.value, "the member's unbound ARV did not reach the form").toBe(450000);

      const label = String(arvField!.prefill?.label ?? '');
      expect(label.length, 'a pre-filled value with no label is the BUG-008 shape').toBeGreaterThan(0);
      expect(label.toLowerCase(), 'the label renders the placeholder as an address')
        .not.toMatch(/for manual entry|at manual entry/);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('STATE 4 — the TRANSITION: binding is current-message-only', () => {
    it('an address in EARLIER history is not scraped into the binding', async () => {
      const supabase = makeCompsSupabase({});

      // Turn 1 talks about a property. Turn 2 sets an ARV with NO address in
      // the message and none in the tool call. Current-message-only means the
      // binding must not reach back to turn 1.
      const a = build([say('Nice area — decent rental demand around 999 Elm St.')], supabase);
      await chat(a.app, 'what do you think of 999 Elm St, Seattle?', 'b-history');

      const b = build([setArv(450000), say('Got it.')], supabase);
      await chat(b.app, 'ok use 450k as the ARV', 'b-history');

      const block = supabase.compsBlockFor('b-history');
      expect(block?.arv, 'PRECONDITION: the ARV was never stored').toBe(450000);
      expect(
        String(block?.subjectAddress ?? '').toUpperCase(),
        'the binding scraped 999 Elm St out of HISTORY — it must be current-message-only',
      ).not.toContain('999 ELM');
      expect(block?.subjectAddress ?? null, 'expected an unbound (null) binding').toBeNull();
    });

    it('a LATER message naming a property does not retro-bind the stored ARV', async () => {
      const supabase = makeCompsSupabase({});
      const a = build([setArv(450000), say('Got it.')], supabase);
      await chat(a.app, 'use 450k as the ARV', 'b-later');
      expect(supabase.compsBlockFor('b-later')?.subjectAddress ?? null, 'PRECONDITION: unbound')
        .toBeNull();

      // The member now names a property in a calculator turn. The ARV may be
      // USED for it (nothing bound, nothing to conflict) — but the stored
      // block must stay unbound. Retro-binding would mean the NEXT property
      // the member asks about conflicts with an address they never gave the
      // ARV for.
      const b = build([runFlip(), say('Numbers.')], supabase);
      await chat(b.app, 'run the flip numbers on 456 Oak Ave', 'b-later');

      const after = supabase.compsBlockFor('b-later');
      expect(after?.arv, 'the flip turn destroyed the manual ARV').toBe(450000);
      expect(
        String(after?.subjectAddress ?? '').toUpperCase(),
        'the flip turn RETRO-BOUND the ARV to 456 Oak — a later message must not create a binding',
      ).not.toContain('456 OAK');

      // ...and the third turn proves why: a different property must still
      // pre-fill freely, because the member never bound this number to anything.
      const c = build([runFlip(), say('Numbers again.')], supabase);
      const reply3 = await chat(c.app, 'now run the flip numbers on 789 Pine Rd', 'b-later');
      const flip3 = flipOf(c.openai.calls);
      expect(flip3, 'the third calculator turn never ran').toBeDefined();
      expect(
        flip3!.inputs_used?.after_repair_value,
        'the unbound ARV stopped working after one use — something retro-bound it',
      ).toBe(450000);
      expect(String(reply3.body.output).replace(/[$,\s]/g, '')).toContain('450000');
    });
  });
});
