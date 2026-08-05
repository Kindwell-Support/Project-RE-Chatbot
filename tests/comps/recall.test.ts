/**
 * THE RECALL PATH — a member-visible ARV that never passes through format.ts.
 *
 * MASON's 0023 established, forensically, that a re-asked address is answered
 * from the TRANSCRIPT: no `run_comps` invocation, `session_state` untouched,
 * single-round token shape. The prompt tells the model not to re-run an address
 * it already ran, and the model obeys by summarising history.
 *
 * Everything I verified tonight assumes the tool ran. The rendered block, the
 * trim disclosure, the confidence tier, the override offer, the data-only
 * guarantee in `format.ts` — all of it hangs off a tool call that, on these
 * turns, does not happen. This path sits outside all of it.
 *
 * His evidence shows the two observed recalls were CORRECT. That is two
 * observations, not a guarantee, and "it was right twice" is exactly the
 * standard this suite exists to refuse. The question the operator's ruling
 * actually turns on is different and unanswered:
 *
 *     can the recall path produce the WRONG address's number?
 *
 * That is the wrong-house bug — the one this whole module's state design was
 * built to prevent — reopened on a path with no guard on it at all.
 *
 * No fix is authorised. These tests CHARACTERISE the hazard so the ruling is
 * made against evidence rather than against two lucky samples.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import { makeCompsSupabase, makeProviderSpy } from '../helpers/compsFakes.js';
import { golden01 } from '../fixtures/golden/index.js';
import { SYSTEM_PROMPT } from '../../src/agent/systemPrompt.js';

const MODS = ['service', 'tools'] as const;

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

const FRESH = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (30 + i * 10) * 86_400_000).toISOString().slice(0, 10),
}));

/** Subject A: 2,000 sqft -> $403,000. Subject B: 1,800 sqft -> $362,000. */
const SUBJ_A = { ...golden01.subject, address: '765 N DON FRANK LANE, PHOENIX, AZ 85004' };
const SUBJ_B = {
  ...golden01.subject, zpid: 'B', address: '8531 W VALE DRIVE, PHOENIX, AZ 85037',
  livingArea: 1800,
};

const say = (content: string): FakeCompletion => ({ content });
const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: `rc-${address.slice(0, 5)}`, name: 'run_comps', args: { address } }],
});

describe(`the transcript-recall path${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe('the prompt instruction that induces it', () => {
    it('the system prompt tells the model not to re-run an address', () => {
      // Root cause, pinned. This is a deliberate spend guard, not a defect —
      // but it is the mechanism, and if it is ever reworded the hazard below
      // changes shape. Pinning it means the ruling and the instruction cannot
      // drift apart silently.
      expect(
        SYSTEM_PROMPT.toLowerCase(),
        'the no-re-run instruction is gone — 0023\'s root cause has changed',
      ).toMatch(/do not re-?run|already ran/);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the hazard, characterised', () => {
    /** Run comps on A then B in one session; return the model call log. */
    async function runTwoAddresses(sessionId: string) {
      const supabase = makeCompsSupabase({});

      const a = buildApp(config, {
        openai: makeFakeOpenAI([
          runComps('765 N Don Frank Ln'),
          // The model relays the rendered block, as §9 instructs. This is what
          // lands in chat_messages and is replayed as history.
          say('Here are the comps for 765 N Don Frank Ln — ARV $403,000 (range $394,000–$412,000).'),
        ]).client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({ subject: SUBJ_A, comps: FRESH }).provider,
      } as never);
      await a.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'run a comp for 765 N Don Frank Ln', session_id: sessionId },
      });
      await a.close();

      const b = buildApp(config, {
        openai: makeFakeOpenAI([
          runComps('8531 W Vale Dr'),
          say('Here are the comps for 8531 W Vale Dr — ARV $362,000 (range $353,000–$371,000).'),
        ]).client,
        supabase: supabase.client,
        propertyProvider: makeProviderSpy({ subject: SUBJ_B, comps: FRESH }).provider,
      } as never);
      await b.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'run a comp for 8531 W Vale Dr', session_id: sessionId },
      });
      await b.close();

      return { supabase };
    }

    it('after two addresses, BOTH ARVs sit in the history the model is replayed', async () => {
      // The precondition for a mis-recall. If only one number were ever in
      // context there would be nothing to confuse.
      const { supabase } = await runTwoAddresses('recall-hazard');

      const history = supabase.inserts
        .filter((i) => i.table === 'chat_messages')
        .flatMap((i) => (Array.isArray(i.payload) ? i.payload : [i.payload]))
        .map((r) => String((r as { content?: string }).content ?? ''))
        .join('\n');

      expect(history, "A's ARV is not in the transcript").toContain('403,000');
      expect(history, "B's ARV is not in the transcript").toContain('362,000');

      // ...and nothing in the transcript marks which one is CURRENT. That is
      // the whole hazard: two numbers, no recency signal, and on a recall turn
      // no tool and no state read to arbitrate between them.
      expect(history).toContain('765 N Don Frank Ln');
      expect(history).toContain('8531 W Vale Dr');
    });

    it('session_state binds ONLY the most recent address — the earlier one is unrecoverable', async () => {
      // The structural asymmetry that makes a mis-recall unfixable downstream.
      // State knows B. A's number exists only as prose in the transcript, with
      // no binding, no confidence, and no provenance the code can check.
      const { supabase } = await runTwoAddresses('recall-binding');
      const block = supabase.compsBlockFor('recall-binding');

      expect(block, 'no block was bound at all').toBeDefined();
      expect(block!.arv, 'state should bind the LATEST run').toBe(362000);
      expect(block!.subjectAddress).toContain('8531 W VALE');

      // So if the model recalls A's $403,000, nothing in state disagrees with
      // it — because state is not consulted on a turn where no calculator runs.
      expect(block!.arv, "A's ARV is not in state to be checked against").not.toBe(403000);
    });

    it('a recall turn runs NO tool, so no guard in this module engages', async () => {
      // MASON's finding, reproduced at the seam rather than from qa_logs
      // forensics: a turn where the model answers from history touches nothing.
      const { supabase } = await runTwoAddresses('recall-notool');

      const spy = makeProviderSpy({ subject: SUBJ_A, comps: FRESH });
      const writesBefore = supabase.stateWrites.length;
      const openai = makeFakeOpenAI([
        // The model answers from history, exactly as the prompt instructs.
        say('You ran that one already — 765 N Don Frank Ln came back at about $403,000.'),
      ]);
      const app = buildApp(config, {
        openai: openai.client, supabase: supabase.client, propertyProvider: spy.provider,
      } as never);
      const res = await app.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'run a comp for 765 N Don Frank Ln', session_id: 'recall-notool' },
      });
      await app.close();

      const body = res.json();
      expect(body.output).toContain('403,000');

      // The three things that would normally protect that number, all absent.
      expect(spy.callCount, 'the provider was hit — this is not the recall path').toBe(0);
      expect(
        supabase.stateWrites.length,
        'state was rewritten — the comps block would have re-bound',
      ).toBe(writesBefore);
      expect(
        (body.tool_calls ?? []).length,
        'a tool ran — format.ts would have rendered this',
      ).toBe(0);

      // And the number reached the member with no rendered block around it:
      // no trim disclosure, no confidence tier, no override offer, no
      // disclaimer footer.
      const out = String(body.output);
      expect(out.toLowerCase()).not.toMatch(/not a formal appraisal|automated estimate/);
      expect(out.toLowerCase()).not.toMatch(/confidence/);
    });

    it('THE HAZARD: state still binds B while the member is told A\'s number', async () => {
      // The specific configuration a ruling has to account for. The member asks
      // about Don Frank and is told $403,000 from history; state is bound to
      // Vale at $362,000. If they now say "run the flip numbers", the pre-fill
      // supplies $362,000 — a DIFFERENT number for the property they were just
      // discussing, from a path that believes it is being helpful.
      const { supabase } = await runTwoAddresses('recall-divergence');

      const openai = makeFakeOpenAI([
        say('You ran 765 N Don Frank Ln already — it came back around $403,000.'),
      ]);
      const app = buildApp(config, {
        openai: openai.client, supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      const res = await app.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'what was the ARV on Don Frank again?', session_id: 'recall-divergence' },
      });
      await app.close();

      expect(String(res.json().output)).toContain('403,000');
      // State disagrees with what the member was just told, and nothing
      // reconciles the two.
      expect(supabase.compsBlockFor('recall-divergence')!.arv).toBe(362000);
    });
  });
});
