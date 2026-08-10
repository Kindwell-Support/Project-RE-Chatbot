/**
 * THE ARV IS GONE — and the member's own number is not.
 *
 * Two guarantees that pull in opposite directions, which is why they live in
 * one file:
 *
 *   1. NOTHING ARV-shaped comes out of the comps module. No value, no range,
 *      no confidence grade, no trimmed-mean line — not in the rendered block,
 *      and not in the payload the model sees.
 *   2. The MEMBER's ARV is untouched. `set_manual_arv`, the calculator input
 *      and the form field all still work. Removing ours must not damage theirs.
 *
 * THE INVERSION. `run_comps` used to CLEAR the comps block before hitting the
 * provider, so a failed run could not leave a stale ARV. With no ARV computed,
 * that clear would only ever destroy a number the member typed themselves. So
 * the guarantee flips: it was "a failed run leaves no stale ARV", it is now
 * "a comps run PRESERVES the manual ARV, and the mismatch guard stops it
 * reaching the wrong address".
 *
 * The guard is the surviving half of the original leak protection and it now
 * carries the whole weight, so it is tested harder than before, not less.
 *
 * Every preservation case leads with a POSITIVE PRECONDITION: "the manual ARV
 * is still there" passes trivially if nothing ever wrote it.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import { makeCompsSupabase, makeProviderSpy, type ProviderSpyOptions } from '../helpers/compsFakes.js';
import { golden01 } from '../fixtures/golden/index.js';

const MODS = ['service', 'tools'] as const;
const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

const SUBJECT_A = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
const FRESH = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (20 + i * 5) * 86_400_000).toISOString().slice(0, 10),
}));

const say = (content: string): FakeCompletion => ({ content });
const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: 'rc1', name: 'run_comps', args: { address } }],
});
const manualArv = (arv: number): FakeCompletion => ({
  toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv } }],
});
const runFlip = (args: Record<string, unknown> = {}): FakeCompletion => ({
  toolCalls: [{
    id: 'f1', name: 'flip_calculator',
    args: { purchase_price: 300000, rehab_budget: 60000, holding_months: 4, ...args },
  }],
});

function build(script: FakeCompletion[], provider: ProviderSpyOptions = {}, supabase = makeCompsSupabase({})) {
  const openai = makeFakeOpenAI(script);
  const spy = makeProviderSpy(provider);
  const app = buildApp(config, {
    openai: openai.client, supabase: supabase.client, propertyProvider: spy.provider,
  } as never);
  return { app, openai, supabase, spy };
}

const chat = (app: ReturnType<typeof buildApp>, message: string, session_id: string) =>
  app.inject({
    method: 'POST', url: '/chat',
    headers: { origin: ALLOWED, 'content-type': 'application/json' },
    payload: { message, session_id, member_email: 'member@example.com' },
  }).then((r) => ({ status: r.statusCode, body: r.statusCode < 500 ? r.json() : {} }));

/** Everything the model was shown for a given tool call id. */
function shownFor(calls: Array<Record<string, unknown>>, id: string): string[] {
  const out: string[] = [];
  for (const c of calls) {
    for (const m of ((c.messages as Array<Record<string, unknown>>) ?? [])) {
      if (m.role === 'tool' && m.tool_call_id === id) out.push(String(m.content));
    }
  }
  return out;
}
const toolResults = (calls: Array<Record<string, unknown>>) =>
  calls.flatMap((c) => ((c.messages as Array<Record<string, unknown>>) ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => { try { return JSON.parse(String(m.content)); } catch { return String(m.content); } }));

/** Any figure a member could read as a property value. */
const valueShaped = (t: string) =>
  [...t.matchAll(/\$\s?[\d,]*\d/g)].map((m) => m[0])
    .concat([...t.matchAll(/\b\d[\d,]*\s*[km]\b/gi)].map((m) => m[0]));

describe(`the computed ARV is gone${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('nothing ARV-shaped reaches the member', () => {
    it('the rendered block carries no ARV, range, confidence or trimmed-mean line', async () => {
      const { app, openai } = build(
        [runComps('123 Main St'), say('Here are the comps.')],
        { subject: SUBJECT_A, comps: FRESH },
      );
      await chat(app, 'run comps on 123 Main St', 'rm-render');

      const shown = shownFor(openai.calls, 'rc1');
      // POSITIVE PRECONDITION — an empty result satisfies every absence below.
      expect(shown.length, 'the run_comps result never reached the model').toBeGreaterThan(0);

      // Assert on the RENDERED BLOCK, not the whole payload. An earlier version
      // matched the entire tool result and failed on the `instruction` field,
      // which legitimately says "this tool does NOT produce an ARV". The
      // guarantee is about what the MEMBER sees.
      const block = JSON.parse(shown[0]) as { rendered_block?: string };
      const text = String(block.rendered_block ?? '');
      expect(text.length, 'the rendered block is empty').toBeGreaterThan(200);
      expect(text.toLowerCase(), 'precondition: this is not a comps table').toMatch(/sold|sq ?ft|\$\/sf|per sq/);

      const t = text.toLowerCase();
      expect(t, 'the rendered block still names an ARV').not.toMatch(/\barv\b|after.repair value/);
      expect(t, 'a value RANGE survived').not.toMatch(/\brange\b|estimated value|value range/);
      expect(t, 'a confidence grade survived').not.toMatch(/confidence/);
      expect(t, 'the trimmed-mean line survived').not.toMatch(/trimmed|trim(med)? (mean|average)|outlier/);
    });

    it('the model-facing tool result carries no arv or confidence key', async () => {
      const { app, openai } = build(
        [runComps('123 Main St'), say('ok')],
        { subject: SUBJECT_A, comps: FRESH },
      );
      await chat(app, 'run comps on 123 Main St', 'rm-keys');

      const shown = shownFor(openai.calls, 'rc1');
      expect(shown.length).toBeGreaterThan(0);
      let payload: Record<string, unknown> | undefined;
      try { payload = JSON.parse(shown[0]); } catch { payload = undefined; }
      expect(payload, 'the tool result is not a JSON object').toBeDefined();

      for (const k of ['arv', 'arvLow', 'arvHigh', 'arvPerSqft', 'confidence', 'arvConfidence', 'sd', 'cv']) {
        expect(payload, `the tool result still exposes "${k}" to the model`).not.toHaveProperty(k);
      }
      const raw = JSON.stringify(payload);
      expect(raw).not.toMatch(/"(arv|arvLow|arvHigh|arvPerSqft|confidence)"\s*:/);

      // The instruction MAY name the ARV — and should, to disclaim one. An
      // earlier version forbade the token outright and failed on the very
      // sentence that tells the model not to invent a number. What it must not
      // do is promise a pre-fill or carry a figure.
      const instruction = String((payload as { instruction?: string }).instruction ?? '');
      expect(instruction.length, 'the tool sends the model no instruction at all')
        .toBeGreaterThan(0);
      expect(instruction.toLowerCase(), 'the instruction claims a pre-fill that no longer happens')
        .not.toMatch(/pre-?fill/);
      expect(valueShaped(instruction), 'the instruction carries a figure').toEqual([]);
      // Stronger than absence: it must actively disclaim producing one. With
      // no ARV in the payload and no instruction about it, a model asked for
      // "the number" fills the gap itself.
      expect(
        instruction.toLowerCase(),
        'the instruction never tells the model this tool produces no ARV',
      ).toMatch(/not produce an arv|no arv|does not produce/);
    });

    it('the prescribed opening, closing and footer are all still emitted', async () => {
      // Removing the ARV must not take the §14.7 copy with it.
      const { app, openai } = build(
        [runComps('123 Main St'), say('ok')],
        { subject: SUBJECT_A, comps: FRESH },
      );
      await chat(app, 'run comps on 123 Main St', 'rm-copy');
      const t = shownFor(openai.calls, 'rc1').join('\n').toLowerCase();

      expect(t, 'the prescribed opening is missing').toMatch(/recent comparable sales/);
      expect(t, 'the prescribed closing is missing').toMatch(/evaluate each property|lot location|external factors/);
      expect(t, 'the disclaimer footer is missing').toMatch(/not a formal appraisal/);
      // The footer was reworded when the ARV went; it must not still point at one.
      expect(t, 'the footer still tells the member to verify an ARV we no longer produce')
        .not.toMatch(/verify comps and arv/);
    });
  });

  // =========================================================================
  // THE INVERSION — preservation, not clearing.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))("the member's manual ARV survives a comps run", () => {
    async function manualThenComps(session: string, provider: ProviderSpyOptions) {
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Using your ARV of $450,000.')], {}, supabase);
      await chat(a.app, 'use 450k as the ARV', session);

      // POSITIVE PRECONDITION. "Still 450,000" is trivially satisfied if the
      // manual ARV was never stored in the first place.
      const before = supabase.compsBlockFor(session);
      expect(before?.arv, 'precondition: the manual ARV was never stored').toBe(450000);
      expect(before?.arvSource, 'precondition: not recorded as manual').toBe('manual');

      const b = build([runComps('123 Main St'), say('Comps done.')], provider, supabase);
      await chat(b.app, 'run comps on 123 Main St', session);
      return { supabase, after: supabase.compsBlockFor(session) };
    }

    it('SUCCESS path: a comps run preserves it', async () => {
      const { after } = await manualThenComps('rm-keep-ok', { subject: SUBJECT_A, comps: FRESH });
      expect(after?.arv, "a successful comps run destroyed the member's own ARV").toBe(450000);
      expect(after?.arvSource).toBe('manual');
    });

    it.each([
      ['timeout', { failSubject: { kind: 'timeout' as const } }],
      ['5xx', { failSubject: { kind: 'http' as const, status: 500 } }],
      ['4xx', { failSubject: { kind: 'http' as const, status: 404 } }],
      ['address not found', { subject: null }],
      ['too few comps', { subject: SUBJECT_A, comps: FRESH.slice(0, 2) }],
      ['no subject sqft', { subject: { ...SUBJECT_A, livingArea: null }, comps: FRESH }],
    ])('FAILURE path (%s): the manual ARV is still preserved', async (_l, provider) => {
      // The old guarantee was the opposite — a failed run CLEARED the block.
      // With no ARV computed, clearing would only ever delete the member's own
      // number, so every failure path must now leave it alone.
      const { after } = await manualThenComps(`rm-keep-${String(_l)}`, provider as ProviderSpyOptions);
      expect(after?.arv, `a ${_l} failure destroyed the member's own ARV`).toBe(450000);
      expect(after?.arvSource).toBe('manual');
    });

    it('run_comps does not write to session_state at all', async () => {
      const supabase = makeCompsSupabase({});
      const { app } = build([runComps('123 Main St'), say('ok')], { subject: SUBJECT_A, comps: FRESH }, supabase);
      await chat(app, 'run comps on 123 Main St', 'rm-nowrite');
      expect(
        supabase.stateWrites.length,
        'run_comps still writes session_state — it no longer has anything to write',
      ).toBe(0);
      expect(supabase.compsBlockFor('rm-nowrite')).toBeUndefined();
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the mismatch guard now carries the whole weight', () => {
    it('a manual ARV bound to A does not silently price a flip on B', async () => {
      // The surviving half of the original leak protection. The member's own
      // $450,000 for 123 Main must not quietly become the ARV for 456 Oak.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Using $450,000.')], {}, supabase);
      await chat(a.app, 'use 450k as the ARV for 123 Main St', 'rm-guard');
      expect(supabase.compsBlockFor('rm-guard')?.arv, 'precondition: nothing bound').toBe(450000);

      const b = build([runFlip(), say('Numbers.')], {}, supabase);
      const reply = await chat(b.app, 'run the flip numbers on 456 Oak Ave', 'rm-guard');

      const flip = toolResults(b.openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      if (flip?.inputs_used) {
        expect(
          flip.inputs_used.after_repair_value,
          "the manual ARV for 123 Main silently priced a flip the member asked about at 456 Oak",
        ).not.toBe(450000);
      }
      expect(String(reply.body.output).replace(/[$,\s]/g, '')).not.toContain('450000');
    });

    it('a leftover arvSource:comps block from a cached v2 session never pre-fills', async () => {
      // v2 sessions can still hold a block whose arvSource is 'comps'. Nothing
      // produces those any more, so they are stale by definition and must be
      // ignored rather than served.
      const supabase = makeCompsSupabase({
        sessionState: {
          'rm-legacy': {
            comps: {
              subjectAddress: '123 MAIN STREET', subjectSqft: 2000,
              subjectBeds: 3, subjectBaths: 2,
              arv: 403000, arvLow: 394000, arvHigh: 412000,
              arvConfidence: 'high', arvSource: 'comps', compsRunId: 'v2-run',
              computedAt: '2026-08-05T00:00:00.000Z',
            },
          },
        },
      });
      const { app, openai } = build([runFlip(), say('Numbers.')], {}, supabase);
      const reply = await chat(app, 'run the flip numbers', 'rm-legacy');

      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      if (flip?.inputs_used) {
        expect(
          flip.inputs_used.after_repair_value,
          'a stale arvSource:comps block from v2 was pre-filled into a calculator',
        ).not.toBe(403000);
      }
      expect(String(reply.body.output).replace(/[$,\s]/g, ''))
        .not.toContain('403000');
    });

    it("a MANUAL block on the SAME address still pre-fills — the member's number works", async () => {
      // The control. If the guard were over-tightened into "never pre-fill",
      // set_manual_arv would become decorative and the ruling would be
      // contradicted. This is what must keep working.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Using $450,000.')], {}, supabase);
      await chat(a.app, 'use 450k as the ARV', 'rm-manual-works');
      expect(supabase.compsBlockFor('rm-manual-works')?.arv).toBe(450000);

      const b = build([runFlip(), say('Net profit is $90,000.')], {}, supabase);
      const reply = await chat(b.app, 'now run the flip numbers', 'rm-manual-works');

      const flip = toolResults(b.openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'the calculator never ran').toBeDefined();
      expect(
        flip!.inputs_used!.after_repair_value,
        "the member's own manual ARV stopped reaching the calculator",
      ).toBe(450000);
      expect(String(reply.body.output).replace(/[$,\s]/g, ''), 'the echo lost the manual ARV')
        .toContain('450000');
    });
  });
});
