/**
 * PRIORITY 1 — session_state, clear-on-failure, and the pre-fill echo.
 *
 * This is the file that decides whether a member can be handed a deal analysis
 * built on the wrong house's ARV.
 *
 * The failure being hunted is specific and it is not hypothetical: run comps on
 * 123 Main St, get $412,000, then run comps on 456 Oak Ave and have it FAIL.
 * If the comps block wasn't cleared first, state still holds 123 Main's
 * $412,000. The member then asks for the flip numbers on 456 Oak and gets a
 * complete, confident, internally consistent analysis of a property that has
 * nothing to do with the one they asked about. No error. No warning. The number
 * is real — it's just the wrong house.
 *
 * Everything here asserts on OBSERVABLE output — the rendered reply and the
 * value that reaches the calculator — not on the state object alone. A correct
 * state field with a missing echo still ships the bug.
 *
 * Layer: full chat turn through `buildApp`, OpenAI and Supabase faked at the
 * client boundary per the repo's existing convention. No `vi.mock`.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import {
  makeCompsSupabase,
  makeProviderSpy,
  COMPS_STATE_KEYS,
  ARV_BEARING_KEYS,
  MANUAL_NULLED_KEYS,
  compsBlockOf,
  type CompsSupabaseOptions,
  type ProviderSpyOptions,
} from '../helpers/compsFakes.js';
import { golden01 } from '../fixtures/golden/index.js';

const MODS = ['service', 'tools'] as const;

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// THE INJECTION SEAM — the one assumption in this file.
//
// Requested in mailbox 0008: `AppDeps` gains `propertyProvider`, matching how
// `openai` and `supabase` are already injected (src/server/app.ts:35). If MASON
// wires it differently, this helper is the only thing that changes; every test
// below asserts on rendered output and tool payloads.
// ---------------------------------------------------------------------------
function buildCompsApp(opts: {
  script: FakeCompletion[];
  provider?: ProviderSpyOptions;
  supabase?: CompsSupabaseOptions;
}) {
  const openai = makeFakeOpenAI(opts.script);
  const supabase = makeCompsSupabase(opts.supabase ?? {});
  const spy = makeProviderSpy(opts.provider ?? {});
  const app = buildApp(config, {
    openai: openai.client,
    supabase: supabase.client,
    propertyProvider: spy.provider,
  } as never);
  return { app, openai, supabase, spy };
}

async function chat(
  app: ReturnType<typeof buildApp>,
  message: string,
  sessionId: string,
): Promise<{ status: number; output: string; toolCalls: string[] }> {
  const res = await app.inject({
    method: 'POST',
    url: '/chat',
    headers: { origin: ALLOWED, 'content-type': 'application/json' },
    payload: { message, session_id: sessionId, member_email: 'member@example.com' },
  });
  const body = res.statusCode === 200 ? res.json() : { output: '', tool_calls: [] };
  return {
    status: res.statusCode,
    output: (body.output as string) ?? '',
    toolCalls: (body.tool_calls ?? []) as string[],
  };
}

/** Every tool result the model was shown, parsed. */
function toolResults(calls: Array<Record<string, unknown>>): unknown[] {
  const out: unknown[] = [];
  for (const call of calls) {
    for (const m of (call.messages as Array<Record<string, unknown>>) ?? []) {
      if (m.role === 'tool') {
        try {
          out.push(JSON.parse(m.content as string));
        } catch {
          out.push(m.content);
        }
      }
    }
  }
  return out;
}

const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: `rc-${address.slice(0, 6)}`, name: 'run_comps', args: { address } }],
});
const runFlip = (args: Record<string, unknown> = {}): FakeCompletion => ({
  toolCalls: [{
    id: 'flip-1',
    name: 'flip_calculator',
    args: { purchase_price: 300000, rehab_budget: 60000, holding_months: 4, ...args },
  }],
});
const say = (content: string): FakeCompletion => ({ content });
const setArv = (arv: number, address?: string): FakeCompletion => ({
  toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: address ? { arv, address } : { arv } }],
});

/**
 * golden01's comps are dated against its injected `now` (2025-07-15), but the
 * live service runs on the real clock — replayed verbatim they are all
 * STALE_SALE, every run ends TOO_FEW_COMPS, and every state assertion below
 * would fail for a reason that has nothing to do with state. Re-dated relative
 * to today; $/sqft, sqft and coordinates untouched, so golden 01's
 * hand-computed $403,000 still holds.
 */
const FRESH_COMPS = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (30 + i * 10) * 86_400_000).toISOString().slice(0, 10),
}));

const SUBJECT_A = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
const SUBJECT_B = {
  ...golden01.subject,
  zpid: 'B-SUBJ',
  address: '456 OAK AVENUE, SEATTLE, WA 98102',
  livingArea: 1800,
};

describe(`session_state and calculator pre-fill${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('a successful comps run writes NOTHING', () => {
    // INVERTED (§14.8). This used to assert that a successful run wrote the
    // whole §8 block with `arv` a number and `arvSource: 'comps'`. `run_comps`
    // no longer touches session_state at all, so the guarantee is the opposite
    // one — and it is the load-bearing half of the removal, because a comps
    // run that still wrote a block would put a number back into the pre-fill
    // path by the back door.
    it('no state write happens on a successful run', async () => {
      const { app, supabase } = buildCompsApp({
        script: [runComps('123 Main St, Seattle WA'), say('Here are the comps.')],
        provider: { subject: SUBJECT_A, comps: FRESH_COMPS },
      });
      const reply = await chat(app, 'run comps on 123 Main St, Seattle WA', 's1');

      // POSITIVE PRECONDITION — "nothing was written" is trivially true of a
      // run that never happened. The comps must actually have come back.
      expect(reply.status, 'the turn failed outright').toBe(200);
      expect(reply.output.length, 'no reply was rendered').toBeGreaterThan(0);

      expect(
        supabase.compsBlockFor('s1'),
        'run_comps wrote a comps block — nothing may write one any more',
      ).toBeUndefined();
      for (const w of supabase.stateWrites) {
        const block = compsBlockOf(w) ?? {};
        expect(
          block.arvSource,
          `write #${w.seq} carries arvSource 'comps' — the source is retired`,
        ).not.toBe('comps');
      }
    });

    it('set_manual_arv still writes the whole §8 block, with `arv` a NUMBER', () => {
      // The half that SURVIVES. "412000" and "$412,000" render identically in
      // chat and both break the calculator, which type-rejects non-numbers
      // (tests/agent.test.ts). Removing our ARV must not damage theirs.
      const { app, supabase } = buildCompsApp({
        script: [
          { toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv: 450000 } }] },
          say('Using your ARV of $450,000.'),
        ],
      });
      return chat(app, 'use 450k as the ARV', 's-manual-write').then(() => {
        const state = supabase.compsBlockFor('s-manual-write');
        expect(state, 'no session_state row was written for a MANUAL ARV').toBeDefined();
        expect(typeof state!.arv, `arv is ${typeof state!.arv}, not number`).toBe('number');
        expect(typeof state!.subjectSqft).toBe('number');
        // BUG-011: 'use 450k as the ARV' names no property, so the binding is
        // NULL — never a string placeholder. Address-bound writes are covered
        // in manualArvBinding.test.ts.
        expect(state!.subjectAddress, 'an unbound ARV must store a null binding').toBeNull();
        expect(state!.arvSource).toBe('manual');
        expect(state!.arv).toBe(450000);
      });
    });
  });

  // =========================================================================
  // THE INVERSION — the highest-risk change in the removal.
  //
  // It was: "a failed comps run leaves NO stale ARV." `run_comps` cleared the
  // block before touching the provider, so a failure could not leave the
  // previous house's number bound to the new question.
  //
  // It is now: "a comps run PRESERVES the member's manual ARV." The clear had
  // exactly one thing left to destroy — a number the member typed themselves —
  // so it was removed (§14.8). Running comps must never silently delete that.
  //
  // The protection did not disappear, it moved: the address-mismatch guard is
  // now the whole of it, which is why it is tested harder below than the clear
  // ever was.
  //
  // DISCIPLINE. Every case here leads with a POSITIVE PRECONDITION. "The ARV
  // is still 450,000" passes trivially if nothing ever wrote it, and that is
  // the exact shape of vacuous pass this file has produced before.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))("a comps run PRESERVES the member's manual ARV", () => {
    /** Bind a manual ARV, then run comps against it with the given provider. */
    async function manualThenComps(sessionId: string, provider: ProviderSpyOptions) {
      const supabase = makeCompsSupabase({});

      const a = buildApp(config, {
        openai: makeFakeOpenAI([
          { toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv: 450000 } }] },
          say('Using your ARV of $450,000.'),
        ]).client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await chat(a, 'use 450k as the ARV', sessionId);

      const before = supabase.compsBlockFor(sessionId);
      expect(before?.arv, 'PRECONDITION: the manual ARV was never stored').toBe(450000);
      expect(before?.arvSource, 'PRECONDITION: not recorded as manual').toBe('manual');

      const spy = makeProviderSpy(provider);
      const b = buildApp(config, {
        openai: makeFakeOpenAI([runComps('456 Oak Ave'), say('Comps run.')]).client,
        supabase: supabase.client,
        propertyProvider: spy.provider,
      } as never);
      const reply = await chat(b, 'run comps on 456 Oak Ave', sessionId);

      return { supabase, spy, reply, after: supabase.compsBlockFor(sessionId) };
    }

    it('SUCCESS path: a successful comps run does not touch it', async () => {
      const { spy, after } = await manualThenComps('p-success', {
        subject: SUBJECT_B, comps: FRESH_COMPS,
      });
      expect(spy.callCount, 'PRECONDITION: the provider was never reached').toBeGreaterThan(0);
      expect(after?.arv, "a SUCCESSFUL comps run deleted the member's own ARV").toBe(450000);
      expect(after?.arvSource, 'the manual ARV was relabelled').toBe('manual');
    });

    it.each([
      ['timeout', { failSubject: { kind: 'timeout' as const } }],
      ['5xx', { failSubject: { kind: 'http' as const, status: 500 } }],
      ['4xx', { failSubject: { kind: 'http' as const, status: 404 } }],
      ['network', { failSubject: { kind: 'network' as const } }],
      ['malformed JSON', { failSubject: { kind: 'malformed' as const } }],
      ['address not found', { subject: null }],
      ['no subject sqft', { subject: { ...SUBJECT_B, livingArea: null }, comps: FRESH_COMPS }],
      ['too few comps', { subject: SUBJECT_B, comps: FRESH_COMPS.slice(0, 2) }],
    ])('every failure mode PRESERVES it: %s', async (label, provider) => {
      // This is the exact list the old suite used to prove the block was
      // CLEARED. Same eight paths, opposite expectation. Keeping the list
      // identical is deliberate: it makes the inversion legible in a diff, and
      // it means no failure mode quietly lost its coverage in the flip.
      const { after } = await manualThenComps(
        `p-fail-${label.replace(/\W+/g, '-')}`,
        provider as ProviderSpyOptions,
      );
      expect(
        after?.arv,
        `a ${label} failure destroyed the member's manual ARV — running comps ` +
          'must never silently delete a number they typed themselves',
      ).toBe(450000);
      expect(after?.arvSource).toBe('manual');
    });

    it('clearCompsBlock has no production caller on the comps path', async () => {
      // §14.8 keeps `clearCompsBlock` exported and tested but leaves it with no
      // caller. Asserted from the OUTSIDE — across a success and a failure,
      // no observable write ever removes the block — rather than by reading
      // the source, because a re-introduced caller anywhere on the path is
      // what this needs to catch, not a specific call site.
      for (const [name, provider] of [
        ['ok', { subject: SUBJECT_B, comps: FRESH_COMPS }],
        ['fail', { failSubject: { kind: 'timeout' as const } }],
      ] as const) {
        const { supabase, after } = await manualThenComps(
          `p-noclear-${name}`,
          provider as ProviderSpyOptions,
        );
        expect(after?.arv, `${name}: the block was cleared`).toBe(450000);
        for (const w of supabase.stateWrites) {
          const block = compsBlockOf(w);
          expect(
            block === null || block === undefined,
            `${name}: write #${w.seq} nulled the comps block — that is the removed clear`,
          ).toBe(false);
        }
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('atomicity: never half a comps block', () => {
    // Re-pointed onto set_manual_arv, which is now the only writer. The
    // guarantee is unchanged and still matters: §8 says the block is written
    // whole or not at all, and a half-written block is what makes an ARV
    // reachable without the address it is bound to.
    function writeManual(sessionId: string) {
      const { app, supabase } = buildCompsApp({
        script: [
          { toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv: 450000 } }] },
          say('done'),
        ],
      });
      return chat(app, 'set the ARV to 450k', sessionId).then(() => supabase);
    }

    it('no observable write has `arv` without `subjectAddress`, or the reverse', async () => {
      const supabase = await writeManual('s-atomic');

      expect(supabase.stateWrites.length, 'nothing was written').toBeGreaterThan(0);
      for (const w of supabase.stateWrites) {
        const s = compsBlockOf(w) ?? {};
        const hasArv = s.arv !== undefined;
        const hasAddress = s.subjectAddress !== undefined;
        expect(
          hasArv && !hasAddress,
          `write #${w.seq} has arv but no subjectAddress — a partial block is observable`,
        ).toBe(false);
        expect(
          hasAddress && !hasArv && s.arvSource !== undefined,
          `write #${w.seq} claims an arvSource with no arv`,
        ).toBe(false);
      }
    });

    it('a manual write never leaves a comps-shaped band behind', async () => {
      // RE-POINTED. The old case checked arv/arvLow/arvHigh moved together.
      // There is no band any more, so the risk inverted: a manual ARV must not
      // be written alongside band or confidence fields left over from a v2
      // session, which would make it look like a computed estimate.
      const supabase = await writeManual('s-band');

      expect(supabase.stateWrites.length, 'no state was written — nothing to check')
        .toBeGreaterThan(0);
      const withArv = supabase.stateWrites.filter((w) => (compsBlockOf(w) ?? {}).arv !== undefined);
      expect(withArv.length, 'no write ever carried an arv').toBeGreaterThan(0);

      for (const w of withArv) {
        const s = compsBlockOf(w) ?? {};
        for (const dead of MANUAL_NULLED_KEYS) {
          expect(
            s[dead] ?? null,
            `write #${w.seq} carries ${dead} on a MANUAL ARV — it reads as a computed estimate`,
          ).toBeNull();
        }
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the pre-fill echo is in the RENDERED reply', () => {
    it('echoes the ARV and the bound address, even when the model does not', async () => {
      // Deliberately scripting a model reply with NO echo in it. If the echo is
      // only present when the model chooses to include it, then it is a system
      // prompt instruction, and a model under pressure drops it. §8 says "the
      // reply MUST echo the injection visibly" — that has to be structural.
      //
      // RE-POINTED post-removal: the only thing that binds an ARV now is the
      // member, via set_manual_arv (BUG-011: with an address from the CURRENT
      // message). The echo guarantee is unchanged — arguably more important,
      // since the number being echoed is one the member typed and a mis-echo
      // misquotes THEM.
      const { app, openai } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored.'),
          runFlip(), say('Net profit is $88,000.'),
        ],
        supabase: {},
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 's-echo');
      const reply = await chat(app, 'now run the flip numbers', 's-echo');

      const digits = reply.output.replace(/[$,\s]/g, '');
      expect(digits, 'the pre-filled ARV is not visible in the reply').toContain('403000');
      expect(
        reply.output.toUpperCase(),
        'the reply does not say WHICH address the ARV came from',
      ).toContain('123 MAIN');
      expect(
        reply.output.toLowerCase(),
        'no way for the member to override the pre-filled ARV',
      ).toMatch(/change arv|override|different arv|not right/);

      // And the value actually reached the calculator, not just the prose.
      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'flip_calculator never ran').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(403000);
    });

    it('an explicit ARV in the call beats the pre-fill, and the echo says so', async () => {
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored.'),
          runFlip({ after_repair_value: 500000 }), say('Net profit is $140,000.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 's-explicit');

      // POSITIVE PRECONDITION: there must be a stored ARV that COULD have
      // overridden the explicit one. `flip_calculator` already exists and
      // already honours an explicit ARV, so without this the test passes with
      // the comps feature entirely absent and proves nothing about precedence.
      expect(
        supabase.compsBlockFor('s-explicit')?.arv,
        'no ARV was stored — there is nothing for the explicit value to beat',
      ).toBe(403000);

      const reply = await chat(app, 'run the flip with a 500k ARV', 's-explicit');

      // POSITIVE PRECONDITION first — `.not.toBe(403000)` is trivially true
      // when no calculator ran at all.
      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'flip_calculator never ran — nothing to prove').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value, 'the pre-fill overrode an explicit ARV')
        .toBe(500000);

      // The member's number is what prices the deal. The reply DISCLOSING that
      // it replaced a $403,000 comps estimate is correct and wanted — an
      // earlier version of this test asserted 403,000 must be absent, which
      // would have punished exactly the right behaviour. What must not happen
      // is the stored ARV reaching the CALCULATOR, and that is asserted above.
      const digits = reply.output.replace(/[$,\s]/g, '');
      expect(digits, "the member's override is not visible in the reply").toContain('500000');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('address A then address B', () => {
    it('the flip uses B\'s ARV and names B in the echo', async () => {
      // RE-POINTED: the member states an ARV for A, then a different one for
      // B. The second statement REPLACES the first (BUG-011: a manual ARV is a
      // fresh statement, no inheritance) — so the flip must price with B's
      // number and the echo must name B, with A's number gone.
      const supabase = makeCompsSupabase({});

      const app1 = buildApp(config, {
        openai: makeFakeOpenAI([setArv(403000, '123 Main St'), say('A stored')]).client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await chat(app1, 'use 403k as the ARV for 123 Main St', 's-ab');
      expect(supabase.compsBlockFor('s-ab')!.arv).toBe(403000);

      const openai2 = makeFakeOpenAI([
        setArv(362000, '456 Oak Ave'), say('B stored'), runFlip(), say('Numbers are in.'),
      ]);
      const app2 = buildApp(config, {
        openai: openai2.client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await chat(app2, 'now use 362k as the ARV for 456 Oak Ave', 's-ab');
      const reply = await chat(app2, 'run the flip numbers', 's-ab');

      expect(supabase.compsBlockFor('s-ab')!.arv).toBe(362000);
      expect(supabase.compsBlockFor('s-ab')!.subjectAddress).toContain('456 Oak');

      const flip = toolResults(openai2.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> };
      expect(flip.inputs_used!.after_repair_value, "A's stale ARV reached B's flip").toBe(362000);

      const digits = reply.output.replace(/[$,\s]/g, '');
      expect(digits).toContain('362000');
      expect(digits, "A's ARV is still being quoted").not.toContain('403000');
      expect(reply.output.toUpperCase()).toContain('456 OAK');
      expect(reply.output.toUpperCase(), 'the echo names the previous address').not.toContain('123 MAIN');
    });
  });

  // =========================================================================
  // THE PRODUCTION PATH.
  //
  // Live verification (MASON) showed the real model does NOT omit
  // `after_repair_value` and let the pre-fill inject it. It reads the ARV out
  // of its context — the member's own statement, these days — and passes it
  // EXPLICITLY. So every guarantee attached to the injection path (the echo,
  // the address-mismatch ask) was being exercised on a branch production
  // rarely takes.
  //
  // Same class as the COMPS_STRICT catch one level up: not assertions passing
  // on nothing, but assertions passing on the wrong thing. The tests below
  // drive the path the model actually takes.
  //
  // RE-POINTED post-removal: the stored block is now a MANUAL one bound to
  // 123 Main. The carry hazard is unchanged — the model re-reads a number
  // from context and applies it to a property the member named as different.
  // If anything the stakes rose: the carried number is the member's own, so
  // a silent carry misapplies THEIR figure, not our estimate.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('production path: the model carries the ARV explicitly', () => {
    /** Bind a manual ARV to A, then have the model pass an explicit ARV of its own choosing. */
    async function boundThenExplicitFlip(opts: {
      session: string;
      followUp: string;
      explicitArv: number;
    }) {
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored — ARV $403,000 for 123 Main St.'),
          runFlip({ after_repair_value: opts.explicitArv }), say('Net profit is $88,000.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', opts.session);
      expect(
        supabase.compsBlockFor(opts.session)?.arv,
        'precondition: no block was bound',
      ).toBe(403000);
      expect(
        supabase.compsBlockFor(opts.session)?.subjectAddress ?? '',
        'precondition: the ARV did not bind to the address',
      ).toContain('123 Main');

      const reply = await chat(app, opts.followUp, opts.session);
      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      return { reply, flip, supabase };
    }

    it('an explicit ARV equal to the stored block still gets the echo', async () => {
      // MASON's 8b9ee5b: same value ⇒ same guarantees. Without this the reply
      // carries no address binding at all on the path production actually uses.
      const { reply, flip } = await boundThenExplicitFlip({
        session: 'p-echo', followUp: 'now run the flip numbers', explicitArv: 403000,
      });
      expect(flip, 'flip never ran').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(403000);
      expect(reply.output.toUpperCase(), 'no bound-address echo on the explicit path')
        .toContain('123 MAIN');
      expect(reply.output.toLowerCase()).toMatch(/change arv|override/);
    });

    it('an explicit ARV equal to the stored block, on a DIFFERENT address, is refused', async () => {
      const { reply, flip } = await boundThenExplicitFlip({
        session: 'p-mismatch',
        followUp: 'run the flip on 456 Oak Ave',
        explicitArv: 403000,
      });
      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        flip?.inputs_used?.after_repair_value,
        "123 Main's ARV priced a deal the member asked about at 456 Oak",
      ).not.toBe(403000);
      expect(reply.output.replace(/[$,\s]/g, '')).not.toContain('403000');
    });

    /**
     * THE UNCOVERED CASE — the guard is keyed on `explicit === block.arv`.
     *
     * A strict equality check is defeated by ANY transformation of the carried
     * number. The model rounds ("about $400k"), trims to be conservative, or
     * re-reads the low end of the band — and the address-mismatch guard stops
     * applying entirely, because the code returns before ever calling
     * `addressConflict`.
     *
     * The result is the original wrong-house bug wearing a disguise: 456 Oak
     * gets priced off 123 Main's comps, with no echo, no ask, and a number that
     * no longer even matches the stored block so nothing downstream can
     * reconcile it.
     */
    it('LEAK: a TRANSFORMED carry on a different address is silently accepted', async () => {
      const { reply, flip } = await boundThenExplicitFlip({
        session: 'p-leak',
        followUp: 'run the flip on 456 Oak Ave',
        explicitArv: 400000, // 403,000 rounded — not equal, so the guard misses
      });

      // 400,000 is not the member's number: it appears nowhere in their message.
      // It is 123 Main's ARV, rounded, applied to a property the member named
      // as different.
      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        flip?.inputs_used?.after_repair_value,
        "a rounded carry of 123 Main's ARV priced the deal at 456 Oak — " +
          'the mismatch guard is keyed on exact equality and a transformed ' +
          'carry walks straight past it',
      ).not.toBe(400000);
      expect(
        reply.output.replace(/[$,\s]/g, ''),
        'the reply prices 456 Oak with a number derived from 123 Main',
      ).not.toContain('400000');
    });

    it('CONTROL: a member-supplied ARV for a different address IS accepted', async () => {
      // The fix must be targeted, not a blanket block. When the member states
      // both the address AND the number, asking "which deal is this?" would be
      // obtuse — they just told us. The discriminator available in code is
      // whether the figure appears in the member's own message; here "450k"
      // does, and in the LEAK case above "400000" does not.
      const { flip } = await boundThenExplicitFlip({
        session: 'p-control',
        followUp: 'run the flip on 456 Oak Ave with a 450k ARV',
        explicitArv: 450000,
      });
      expect(flip, 'a genuinely member-supplied ARV was blocked').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(450000);
    });

    it('a carried figure that happens to match a number the member typed for ANOTHER field', async () => {
      // The discriminator is "did the member say this number this turn?" — but
      // not "did they say it AS an ARV". A member's message routinely contains
      // several dollar figures, and a purchase price is the most common.
      //
      // Here the member names a different property and a purchase price of
      // 400,000; the model passes 400,000 as the ARV, carried from 123 Main's
      // rounded $403,000. `messageStatesNumber` finds it, so the call reads as
      // a genuine override and the address-conflict branch returns the args
      // untouched — no echo, no ask.
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored — $403,000 for 123 Main St.'),
          {
            toolCalls: [{
              id: 'flip-1', name: 'flip_calculator',
              args: {
                purchase_price: 400000, rehab_budget: 50000, holding_months: 4,
                after_repair_value: 400000,
              },
            }],
          },
          say('Here are the numbers.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 'p-coincide');
      expect(supabase.compsBlockFor('p-coincide')?.arv).toBe(403000);

      const reply = await chat(
        app,
        'run the flip on 456 Oak Ave, purchase price 400000, rehab 50000',
        'p-coincide',
      );

      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;

      // If this runs, the member gets a full flip on 456 Oak whose ARV equals
      // their purchase price — a 0% margin deal presented as analysis, priced
      // off a number that came from a different house. Either refuse, or say
      // out loud where the ARV came from.
      if (flip?.inputs_used) {
        const echoed = reply.output.toUpperCase();
        expect(
          echoed.includes('456 OAK') || echoed.includes('123 MAIN'),
          'a flip on 456 Oak ran with an ARV carried from 123 Main and the reply ' +
            'names neither property — the member cannot tell which house this is',
        ).toBe(true);
      }
    });

    it('the same guard covers brrrr_calculator, not just flip', async () => {
      // A guarantee that holds for one calculator and not the other is half a
      // guarantee, and BRRRR is the long-hold member's tool.
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored — $403,000 for 123 Main St.'),
          {
            toolCalls: [{
              id: 'brrrr-1', name: 'brrrr_calculator',
              args: {
                purchase_price: 250000, rehab_budget: 60000, monthly_rent: 3000,
                after_repair_value: 403000,
              },
            }],
          },
          say('Here is the BRRRR.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 'p-brrrr-guard');
      expect(supabase.compsBlockFor('p-brrrr-guard')?.arv).toBe(403000);

      const reply = await chat(app, 'run the BRRRR on 456 Oak Ave', 'p-brrrr-guard');
      const brrrr = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'brrrr',
      ) as { inputs_used?: Record<string, unknown> } | undefined;

      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        brrrr?.inputs_used?.after_repair_value,
        "123 Main's ARV priced a BRRRR the member asked about at 456 Oak",
      ).not.toBe(403000);
      expect(reply.output.replace(/[$,\s]/g, '')).not.toContain('403000');
    });

    it('CONTROL: a member-supplied ARV for the SAME address is accepted untouched', async () => {
      const { flip } = await boundThenExplicitFlip({
        session: 'p-control-2',
        followUp: 'run the flip on 123 Main St but use 520k as the ARV',
        explicitArv: 520000,
      });
      expect(flip, 'flip never ran').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(520000);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('BRRRR pre-fills identically to Flip', () => {
    it('brrrr_calculator receives the bound manual ARV and echoes the address', async () => {
      // §8 names both calculators. Flip is covered above; BRRRR has to behave
      // the same or the guarantee is half a guarantee — and BRRRR is the tool a
      // long-term-hold member reaches for, so a stale ARV there is just as
      // expensive.
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored.'),
          {
            toolCalls: [{
              id: 'brrrr-1', name: 'brrrr_calculator',
              args: { purchase_price: 250000, rehab_budget: 60000, monthly_rent: 3000 },
            }],
          },
          say('Here is the BRRRR.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 's-brrrr');
      expect(supabase.compsBlockFor('s-brrrr')?.arv, 'no ARV to pre-fill from').toBe(403000);

      const reply = await chat(app, 'now run the BRRRR numbers', 's-brrrr');

      const brrrr = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'brrrr',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(brrrr, 'brrrr_calculator never ran').toBeDefined();
      expect(brrrr!.inputs_used!.after_repair_value, 'the bound ARV did not reach BRRRR')
        .toBe(403000);

      const digits = reply.output.replace(/[$,\s]/g, '');
      expect(digits, 'the pre-filled ARV is not visible in the BRRRR reply').toContain('403000');
      expect(reply.output.toUpperCase(), 'the BRRRR echo does not name the bound address')
        .toContain('123 MAIN');
    });

    it('an explicit ARV beats the pre-fill for BRRRR too', async () => {
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored.'),
          {
            toolCalls: [{
              id: 'brrrr-2', name: 'brrrr_calculator',
              args: {
                purchase_price: 250000, rehab_budget: 60000, monthly_rent: 3000,
                after_repair_value: 520000,
              },
            }],
          },
          say('Here is the BRRRR.'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 's-brrrr-x');
      expect(supabase.compsBlockFor('s-brrrr-x')?.arv).toBe(403000);
      await chat(app, 'run the BRRRR with a 520k ARV', 's-brrrr-x');

      const brrrr = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'brrrr',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(brrrr, 'brrrr_calculator never ran').toBeDefined();
      expect(brrrr!.inputs_used!.after_repair_value, 'the pre-fill overrode an explicit ARV')
        .toBe(520000);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the stated address must match the bound one', () => {
    it('asks instead of pre-filling when the member names a different property', async () => {
      // "run comps on 123 Main" then "run the flip on 456 Oak" must NOT quietly
      // apply 123's ARV to 456. Silently pre-filling here produces a complete,
      // confident analysis of the wrong house.
      // RE-POINTED: after the removal this test was passing VACUOUSLY —
      // run_comps stored nothing, so there was no ARV to leak and the absence
      // assertions held on an empty store. The bind is manual now, with a
      // precondition that it happened.
      const { app, openai, supabase } = buildCompsApp({
        script: [
          setArv(403000, '123 Main St'), say('Stored.'),
          say('Which ARV should I use for 456 Oak Ave?'),
        ],
      });
      await chat(app, 'use 403k as the ARV for 123 Main St', 's-mismatch');
      expect(supabase.compsBlockFor('s-mismatch')?.arv, 'PRECONDITION: nothing bound').toBe(403000);
      const reply = await chat(app, 'run the flip numbers on 456 Oak Ave', 's-mismatch');

      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        flip?.inputs_used?.after_repair_value,
        "123 Main's ARV was applied to a flip the member asked for on 456 Oak",
      ).not.toBe(403000);
      expect(reply.output.replace(/[$,\s]/g, ''), "123 Main's ARV was quoted for 456 Oak")
        .not.toContain('403000');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('session isolation', () => {
    it('two sessions never see each other\'s ARV', async () => {
      const supabase = makeCompsSupabase({});

      // Re-pointed: Alice binds a MANUAL ARV, since a comps run no longer
      // stores anything for Bob to inherit. Isolation is if anything more
      // important now — a manual ARV is a number the member typed, so leaking
      // it across sessions leaks their input, not just our estimate.
      const appA = buildApp(config, {
        openai: makeFakeOpenAI([
          { toolCalls: [{ id: 'm1', name: 'set_manual_arv', args: { arv: 450000 } }] },
          say('A done'),
        ]).client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await chat(appA, 'use 450k as the ARV', 'session-alice');

      // POSITIVE PRECONDITION — with nothing bound to Alice, "Bob did not
      // inherit it" is true of an empty store.
      expect(supabase.compsBlockFor('session-alice')?.arv, 'PRECONDITION: nothing bound to Alice')
        .toBe(450000);

      // Bob never set an ARV. His flip must not inherit Alice's.
      const openaiB = makeFakeOpenAI([runFlip(), say('Numbers.')]);
      const appB = buildApp(config, {
        openai: openaiB.client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      const reply = await chat(appB, 'run the flip numbers', 'session-bob');

      expect(supabase.compsBlockFor('session-bob')?.arv, "Alice's ARV leaked into Bob's session")
        .toBeUndefined();
      const flip = toolResults(openaiB.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown>; error?: string } | undefined;
      // NO GUARD. `?.` yields undefined when the call was refused, and
      // undefined !== the leaked figure — so this passes on a refusal and
      // fails on a leak. The old `if (flip?.inputs_used)` wrapper made the
      // assertion DEAD: the guard refuses every time, so it never ran.
      expect(
        flip?.inputs_used?.after_repair_value,
        "Alice's ARV reached Bob's calculator",
      ).not.toBe(450000);
      expect(reply.output.replace(/[$,\s]/g, '')).not.toContain('450000');
      // Alice's own state is untouched by Bob's turn.
      expect(supabase.compsBlockFor('session-alice')!.arv).toBe(450000);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('set_manual_arv', () => {
    it('sets arvSource manual, clears the band, and does NOT inherit the old binding', async () => {
      // RE-POINTED for BUG-011. §8's original rule — subjectAddress "carried
      // from the existing block" — is superseded by the ruling: a manual ARV
      // is a FRESH statement, bound to the address in the current message or
      // to nothing. Inheritance is exactly the mechanism that produced the
      // 'manual entry' placeholder, so its absence is asserted, not assumed.
      const { app, supabase } = buildCompsApp({
        script: [
          setArv(400000, '123 Main St'), say('Stored for 123 Main St.'),
          setArv(450000), say('Using your ARV of $450,000.'),
        ],
      });
      await chat(app, 'use 400k as the ARV for 123 Main St', 's-manual');
      // PRECONDITION — the first statement bound to the real address.
      expect(supabase.compsBlockFor('s-manual')?.subjectAddress).toContain('123 Main');

      await chat(app, 'actually use 450k as the ARV', 's-manual');

      const block = supabase.compsBlockFor('s-manual')!;
      expect(block.arv).toBe(450000);
      expect(block.arvSource).toBe('manual');
      // §8: the dead fields are NULLED, not deleted — the block keeps its shape.
      for (const key of MANUAL_NULLED_KEYS) {
        expect(block[key], `${key} was not cleared by set_manual_arv`).toBeNull();
      }
      // THE FRESH-STATEMENT RULE. The new message named no property, so the
      // new block is unbound — null, not the old address, and never the
      // placeholder. (Member-visible consequence, worth knowing: re-stating a
      // number without re-stating the address drops the binding, and the echo
      // stops naming the property.)
      expect(
        block.subjectAddress,
        'the re-stated ARV inherited the previous binding — fresh statements must not',
      ).toBeNull();
    });

    it('rejects non-positive and non-finite values rather than storing them', async () => {
      // POSITIVE PRECONDITION: prove the happy path first, otherwise "did not
      // store a bad value" is satisfied by a tool that stores nothing ever.
      const ok = buildCompsApp({
        script: [
          { toolCalls: [{ id: 'ok', name: 'set_manual_arv', args: { arv: 450000 } }] },
          say('Using $450,000.'),
        ],
      });
      await chat(ok.app, 'use 450k as the ARV', 's-manual-ok');
      expect(ok.supabase.compsBlockFor('s-manual-ok')?.arv, 'a VALID manual ARV was not stored either')
        .toBe(450000);

      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { app, supabase, openai } = buildCompsApp({
          script: [
            { toolCalls: [{ id: 'm', name: 'set_manual_arv', args: { arv: bad } }] },
            say('That ARV does not look right.'),
          ],
        });
        await chat(app, `use ${bad} as the ARV`, `s-bad-${String(bad)}`);

        const stored = supabase.compsBlockFor(`s-bad-${String(bad)}`)?.arv;
        expect(stored, `stored an invalid manual ARV: ${String(bad)}`).not.toBe(bad);
        expect(Number.isFinite(stored) && (stored as number) > 0 ? false : true).toBe(true);

        // The tool must have RUN and reported the rejection, not silently
        // no-op'd — the model needs to know to ask again.
        const result = toolResults(openai.calls).find(
          (r) => typeof r === 'object' && r !== null && 'error' in (r as object),
        ) as { error?: string } | undefined;
        expect(result?.error, `set_manual_arv(${String(bad)}) did not report an error`)
          .toBeTruthy();
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('state failures degrade, never block', () => {
    it('a state READ failure means no pre-fill, not a broken reply', async () => {
      // A bare "status 200 and non-empty output" would pass with the comps
      // feature entirely absent, so the real work still has to complete: the
      // explicitly-supplied ARV must reach the calculator despite the read
      // blowing up.
      const { app, openai } = buildCompsApp({
        script: [runFlip({ after_repair_value: 600000 }), say('Net profit is $120,000.')],
        supabase: { failStateReads: true },
      });
      const reply = await chat(app, 'run the flip numbers', 's-readfail');
      expect(reply.status, 'a state read failure returned an error to the member').toBe(200);

      const flip = toolResults(openai.calls).find(
        (r) => (r as { calculator?: string }).calculator === 'flip',
      ) as { inputs_used?: Record<string, unknown> } | undefined;
      expect(flip, 'the calculator never ran — the state read failure blocked the turn').toBeDefined();
      expect(flip!.inputs_used!.after_repair_value).toBe(600000);
    });

    it('a state WRITE failure still returns the comps', async () => {
      const { app, openai, spy } = buildCompsApp({
        script: [runComps('123 Main St'), say('Here are the comps.')],
        provider: { subject: SUBJECT_A, comps: FRESH_COMPS },
        supabase: { failStateWrites: true },
      });
      const reply = await chat(app, 'run comps on 123 Main St', 's-writefail');
      expect(reply.status).toBe(200);

      // The comps must actually have been fetched and rendered — otherwise this
      // is just asserting the server did not crash.
      expect(spy.callCount, 'the provider was never reached').toBeGreaterThan(0);
      // The discriminator used to be the ARV appearing in the payload ('403').
      // With no ARV, look for the rendered block itself.
      const comps = toolResults(openai.calls).find(
        (r) => typeof r === 'object' && r !== null
          && typeof (r as { rendered_block?: unknown }).rendered_block === 'string'
          && (r as { rendered_block: string }).rendered_block.length > 200,
      );
      expect(comps, 'no comps result reached the model despite a write-only failure').toBeDefined();
    });
  });
});
