/**
 * THE RECALL PATH — closed by RULING 0024, and what that does and does not buy.
 *
 * MASON's 0023 established forensically that a re-asked address was answered
 * from the TRANSCRIPT: no `run_comps`, `session_state` untouched, single-round
 * token shape. Root cause was his own spend guard — "do not re-run comps for an
 * address you already ran" — which the model obeyed by summarising history.
 *
 * The operator ruled: repeat requests RE-RUN, served free from the cache, and
 * no comps request may ever be answered from memory. The prompt is flipped and
 * `qa_logs.tool_calls` now records what actually ran.
 *
 * WHAT THAT FIXES, AND WHAT IT DOESN'T. The path is closed by INSTRUCTION, not
 * by STRUCTURE. Nothing in the code prevents a model from answering a comps
 * question out of history; it is now told not to, in a prompt section this file
 * pins. So the residual risk is model compliance — and every other honesty
 * guarantee in this module is structural precisely because instructions are the
 * weaker kind. That asymmetry is worth stating rather than glossing.
 *
 * These tests therefore do two jobs:
 *
 *   1. Pin the ruling — the re-run instruction, the no-memory rule, and a
 *      regression guard against the old spend guard coming back. One of these
 *      replaces a FALSE pin of mine that a real change walked straight past.
 *   2. Characterise what a NON-COMPLIANT turn produces, by scripting the model
 *      to recall. Those cases describe the residual risk the ruling accepts:
 *      no rendered block, no confidence, no disclaimer, and state bound to a
 *      different address than the one the member was just told about.
 *
 * The live question — whether the real model now re-runs, and whether a recall
 * could ever return the WRONG address's number — is in the gated battery.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';
import { makeFakeOpenAI, type FakeCompletion } from '../helpers/fakes.js';
import { makeCompsSupabase, makeProviderSpy } from '../helpers/compsFakes.js';
import { golden01 } from '../fixtures/golden/index.js';

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
  describe.skipIf(pendingSlice(...MODS))('the prompt instruction — RULING 0024', () => {
    /**
     * The comps section of the system prompt AS ACTUALLY SENT to the model.
     *
     * Captured through the seam rather than imported: `compsPromptSection` is
     * private, and what matters is the text the model receives, not the text a
     * helper returns.
     *
     * MY EARLIER PIN HERE WAS FALSE. It asserted `SYSTEM_PROMPT` matched
     * /do not re-?run|already ran/ and passed — but it was matching
     * `systemPrompt.ts:117`, "Do not re-run the tool", which is the CALCULATOR
     * follow-up rule and is still correct. The comps instruction lives in
     * `agent.ts` and had been flipped by ruling 0024 underneath it. The test
     * would have passed whatever happened to the instruction it claimed to pin.
     *
     * Third instance tonight of an assertion passing on the wrong thing, and
     * the first one in my own work that a real change walked straight past. The
     * fix is to scope to the section that owns the rule.
     */
    async function compsSectionAsSent(): Promise<string> {
      const openai = makeFakeOpenAI([say('hi')]);
      const supabase = makeCompsSupabase({});
      const app = buildApp(config, {
        openai: openai.client, supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await app.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'hello', session_id: 'prompt-pin' },
      });
      await app.close();

      const system = String(
        ((openai.calls[0].messages as Array<Record<string, unknown>>) ?? [])
          .find((m) => m.role === 'system')?.content ?? '',
      );
      const start = system.indexOf('## Comps and ARV');
      expect(start, 'the comps prompt section is not being sent to the model').toBeGreaterThan(-1);
      const rest = system.slice(start + 1);
      const nextHeading = rest.indexOf('\n## ');
      return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    }

    it('instructs a RE-RUN on a repeat address, per the ruling', async () => {
      const comps = (await compsSectionAsSent()).toLowerCase();
      expect(comps, 'the repeat-address instruction is missing').toMatch(/already ran/);
      expect(comps, 'the model is not told to call run_comps again').toMatch(/again/);
    });

    it('forbids answering a comps request from memory', async () => {
      // The guarantee that replaces the structural gap: if every ARV must come
      // from a run_comps result in THIS turn, the transcript-recall path is
      // closed by instruction rather than left to the model's discretion.
      const comps = (await compsSectionAsSent()).toLowerCase();
      expect(comps, 'nothing forbids summarising an earlier result').toMatch(
        /never answer .* summaris|summarising an earlier result|from memory/,
      );
      expect(comps, 'the this-turn requirement is missing').toMatch(/this turn/);
    });

    it('REGRESSION: the old "do not re-run" spend guard has NOT come back', async () => {
      // This is the assertion my false pin should have been. Scoped to the
      // comps section, so `systemPrompt.ts`'s legitimate calculator rule
      // ("Do not re-run the tool" for follow-ups) cannot satisfy it.
      const comps = (await compsSectionAsSent()).toLowerCase();
      expect(
        comps,
        'the "do not re-run comps" guard is back — it manufactures the ' +
          'transcript-recall path FINDING-004 documents',
      ).not.toMatch(/do not re-?run comps|don't re-?run comps|never re-?run comps/);
      // The word appears in the ruling's own explanation, so a bare
      // /do not re-run/ would false-positive. Assert the RULE, not the word.
      expect(comps).toMatch(/call run_comps again/);
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

    it('qa_logs now persists tool_calls — the forensics become one query', async () => {
      // The observability half of ruling 0024. FINDING-004 needed
      // session_state timestamps and token-shape triangulation to establish
      // that no tool ran; that is a diagnosis nobody repeats under pressure.
      // With this column the same question is a SELECT.
      const supabase = makeCompsSupabase({});
      const openai = makeFakeOpenAI([
        runComps('765 N Don Frank Ln'),
        say('Here are the comps — ARV $403,000.'),
      ]);
      const app = buildApp(config, {
        openai: openai.client, supabase: supabase.client,
        propertyProvider: makeProviderSpy({ subject: SUBJ_A, comps: FRESH }).provider,
      } as never);
      await app.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: {
          message: 'run a comp for 765 N Don Frank Ln',
          session_id: 'qa-toolcalls', member_email: 'member@example.com',
        },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await app.close();

      const qa = supabase.inserts.find((i) => i.table === 'qa_logs');
      expect(qa, 'nothing was written to qa_logs').toBeDefined();
      const calls = (qa!.payload as { tool_calls?: Array<Record<string, unknown>> }).tool_calls;

      expect(calls, 'qa_logs.tool_calls is not being written').toBeDefined();
      expect(Array.isArray(calls), 'tool_calls is not an array').toBe(true);
      const runCompsEntry = calls!.find((c) => c.name === 'run_comps');
      expect(runCompsEntry, 'a run_comps turn logged no run_comps call').toBeDefined();
      expect(runCompsEntry!.ok, 'the call outcome is not recorded').toBe(true);
      expect(runCompsEntry!.args, 'the call args are not recorded').toBeDefined();
    });

    it('a turn with NO tool call logs an empty tool_calls, not a missing one', async () => {
      // The distinction the whole diagnosis turned on. If a tool-free turn
      // wrote null or omitted the key, "no tool ran" and "we didn't log it"
      // would look identical in the table — and the next investigation lands
      // back in forensics.
      const supabase = makeCompsSupabase({});
      const openai = makeFakeOpenAI([say('You ran that one already — about $403,000.')]);
      const app = buildApp(config, {
        openai: openai.client, supabase: supabase.client,
        propertyProvider: makeProviderSpy({}).provider,
      } as never);
      await app.inject({
        method: 'POST', url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: {
          message: 'what was that ARV again?',
          session_id: 'qa-notool', member_email: 'member@example.com',
        },
      });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await app.close();

      const qa = supabase.inserts.find((i) => i.table === 'qa_logs');
      expect(qa, 'nothing was written to qa_logs').toBeDefined();
      const calls = (qa!.payload as { tool_calls?: unknown }).tool_calls;
      expect(calls, 'a tool-free turn is indistinguishable from an unlogged one')
        .toBeDefined();
      expect(Array.isArray(calls)).toBe(true);
      expect((calls as unknown[]).length, 'a tool-free turn logged a tool call').toBe(0);
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
