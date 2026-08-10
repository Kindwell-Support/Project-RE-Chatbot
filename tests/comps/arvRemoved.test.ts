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
      //
      // BUG-011: binding requires the model to PASS the address argument —
      // this drives the compliant path. The omission path is characterised in
      // the RESIDUAL case below, because it behaves differently by design.
      const supabase = makeCompsSupabase({});
      const a = build(
        [{ toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv: 450000, address: '123 Main St' } }] },
          say('Using $450,000 for 123 Main St.')],
        {}, supabase,
      );
      await chat(a.app, 'use 450k as the ARV for 123 Main St', 'rm-guard');
      expect(supabase.compsBlockFor('rm-guard')?.arv, 'precondition: nothing bound').toBe(450000);
      expect(
        supabase.compsBlockFor('rm-guard')?.subjectAddress ?? '',
        'precondition: the ARV did not bind — the guard below would be vacuous',
      ).toContain('123 Main');

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

    it('CLOSED (ruling 0026): an OMITTED address is EXTRACTED from the current message', () => {
      // This case was the residual I raised, written with tripwires facing
      // both ways. The operator ruled it closed in the direction I proposed
      // and MASON shipped the fallback — so the tripwire fired by name and
      // this is now the verification, not the characterisation.
      //
      // Same repro, opposite expectation: the model omits the address, the
      // MEMBER named one, and the ARV must now BIND to it rather than sitting
      // portable.
      const run = async () => {
        const supabase = makeCompsSupabase({});
        const a = build([manualArv(450000), say('Using $450,000.')], {}, supabase);
        await chat(a.app, 'use 450k as the ARV for 123 Main St', 'rm-omit');
        const block = supabase.compsBlockFor('rm-omit');
        expect(block?.arv, 'precondition: nothing stored').toBe(450000);
        expect(
          String(block?.subjectAddress ?? ''),
          'the omitted-address fallback did not bind the address the member stated',
        ).toContain('123 Main');

        // ...and the whole point of binding: the A -> B refusal now fires on
        // a path that previously carried the number silently.
        const b = build([runFlip(), say('Numbers.')], {}, supabase);
        const reply = await chat(b.app, 'run the flip numbers on 456 Oak Ave', 'rm-omit');
        const flip = toolResults(b.openai.calls).find(
          (r) => (r as { calculator?: string }).calculator === 'flip',
        ) as { inputs_used?: Record<string, unknown> } | undefined;
        if (flip?.inputs_used) {
          expect(
            flip.inputs_used.after_repair_value,
            'the extracted binding did not actually arm the guard',
          ).not.toBe(450000);
        }
        expect(String(reply.body.output).replace(/[$,\s]/g, '')).not.toContain('450000');
      };
      return run();
    });

    it('AMBIGUITY IS NEVER GUESSED: two distinct addresses in one message bind nothing', async () => {
      // The failure mode the fallback could easily have introduced. Extraction
      // that takes "the first address it finds" would bind 123 Main here and
      // then refuse every question about 456 Oak — a wrong binding is worse
      // than no binding, because the guard defends it.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Stored.')], {}, supabase);
      await chat(a.app, 'is 450k the ARV for 123 Main St or for 456 Oak Ave?', 'rm-ambig');

      const block = supabase.compsBlockFor('rm-ambig');
      expect(block?.arv, 'precondition: nothing stored').toBe(450000);
      expect(
        block?.subjectAddress ?? null,
        'extraction GUESSED between two distinct addresses — it must bind nothing',
      ).toBeNull();
    });

    it('the SAME address stated twice is one address, not ambiguity', async () => {
      // The control on the case above. Over-strict ambiguity detection would
      // refuse to bind a perfectly clear message, and the member would never
      // know why their ARV stopped naming the property.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Stored.')], {}, supabase);
      await chat(a.app, '123 Main St — use 450k as the ARV for 123 MAIN STREET', 'rm-dupe');

      expect(
        String(supabase.compsBlockFor('rm-dupe')?.subjectAddress ?? '').toUpperCase(),
        'one address repeated was treated as ambiguous',
      ).toContain('123 MAIN');
    });

    it('a dollar figure before the address does not get bound INTO it', async () => {
      // MASON's recorded over-capture quirk: the fragment regex swallows a
      // leading pure-digit run, so "620000 for 830 W America St" could bind as
      // one string. A binding that contains the price can never match the
      // member's later mention of the address, so the guard would fire on
      // every follow-up about the right property.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(620000), say('Stored.')], {}, supabase);
      await chat(a.app, 'my ARV is 620000 for 830 W America St', 'rm-overcap');

      const bound = String(supabase.compsBlockFor('rm-overcap')?.subjectAddress ?? '');
      expect(bound, 'nothing bound at all').toContain('830 W America');
      expect(bound, 'the dollar figure was bound into the address').not.toContain('620000');

      // The consequence, asserted rather than inferred: the SAME property
      // still pre-fills on a later turn.
      const b = build([runFlip(), say('Numbers.')], {}, supabase);
      const reply = await chat(b.app, 'run the flip on 830 W America St', 'rm-overcap');
      const flip = toolResults(b.openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'the flip never ran').toBeDefined();
      expect(
        flip!.inputs_used?.after_repair_value,
        'the member was refused their own ARV for the address they bound it to',
      ).toBe(620000);
      expect(String(reply.body.output).replace(/[$,\s]/g, '')).toContain('620000');
    });

    it("a street name containing digits survives refinement intact", async () => {
      // The other side of the refinement: trimming the leading digit run is
      // only correct when the digits are a PRICE. "2000 Highway 7 Ct" is an
      // address whose house number is exactly the sort of pure-digit run the
      // refiner looks for, and eating it produces a binding for a different
      // street.
      const supabase = makeCompsSupabase({});
      const a = build([manualArv(450000), say('Stored.')], {}, supabase);
      await chat(a.app, 'use 450k as the ARV for 2000 Highway 7 Ct', 'rm-digits');

      const bound = String(supabase.compsBlockFor('rm-digits')?.subjectAddress ?? '');
      expect(bound, 'nothing bound at all').toContain('Highway');
      expect(bound, 'the house number was eaten as if it were a price').toContain('2000');

      // THE CONSEQUENCE, which is what actually matters. Whatever substring
      // the extractor captured, the member must still be able to name that
      // property in full and get their own ARV. A binding that is a TRUNCATION
      // of the real address ("2000 Highway" for "2000 Highway 7 Ct") makes the
      // later full mention read as a DIFFERENT property, and the guard refuses
      // the member their own number — the BUG-011 failure shape, one layer in.
      const b = build([runFlip(), say('Numbers.')], {}, supabase);
      const reply = await chat(b.app, 'run the flip on 2000 Highway 7 Ct', 'rm-digits');
      const flip = toolResults(b.openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'the flip never ran').toBeDefined();
      expect(
        flip!.inputs_used?.after_repair_value,
        `bound as ${JSON.stringify(bound)}, then refused the member their own ARV ` +
          'when they named the same property in full',
      ).toBe(450000);
      expect(String(reply.body.output).replace(/[$,\s]/g, '')).toContain('450000');
    });
  });
});
