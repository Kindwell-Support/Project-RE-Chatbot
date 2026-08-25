/**
 * FINDING-023 — the ARV instruction is emitted ONCE, structurally, and last.
 *
 * Production showed it twice, sandwiching the disclaimer:
 *
 *   "If you want to run deal numbers, you'll need to supply your own ARV
 *    based on these comps."          <- COMPS_ARV_CLOSE, structural
 *   [disclaimer]
 *   "If you want to analyze a deal using these comps, you'll need to
 *    determine your own ARV first."  <- the MODEL, paraphrasing
 *
 * The second string exists nowhere in the codebase. It was the model's one
 * permitted coaching line, paraphrasing the trailing clause of the run_comps
 * tool `instruction` — which arrives nearer the point of generation than the
 * system prompt's own prohibition on mentioning an ARV there, and therefore
 * won. Prescribed copy that lives in a prompt is a REQUEST, not a constraint.
 *
 * DELIBERATELY ITS OWN FILE. The obvious home is arvRemoved.test.ts, but that
 * file is also edited on fix/comps-copy-repoint; putting these here keeps the
 * two branches from colliding in one review, which the operator asked for
 * explicitly.
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
const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test-not-a-real-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
} as NodeJS.ProcessEnv);

const CLOSE = "If you want to run deal numbers, you'll need to supply your own ARV based on these comps.";

const SUBJECT_A = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
const FRESH = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(Date.now() - (20 + i * 5) * 86_400_000).toISOString().slice(0, 10),
}));

const say = (content: string): FakeCompletion => ({ content });
const runComps = (address: string): FakeCompletion => ({
  toolCalls: [{ id: 'rc1', name: 'run_comps', args: { address } }],
});

function build(script: FakeCompletion[], provider: ProviderSpyOptions = {}) {
  const openai = makeFakeOpenAI(script);
  const spy = makeProviderSpy(provider);
  const app = buildApp(config, {
    openai: openai.client,
    supabase: makeCompsSupabase({}).client,
    propertyProvider: spy.provider,
  } as never);
  return { app, openai };
}

const chat = (app: ReturnType<typeof buildApp>, message: string, session_id: string) =>
  app
    .inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message, session_id, member_email: 'member@example.com' },
    })
    .then((r) => ({ status: r.statusCode, body: r.statusCode < 500 ? r.json() : {} }));

/** Everything the model was shown for a given tool call id. */
function shownFor(calls: Array<Record<string, unknown>>, id: string): string[] {
  const out: string[] = [];
  for (const c of calls) {
    for (const m of (c.messages as Array<Record<string, unknown>>) ?? []) {
      if (m.role === 'tool' && m.tool_call_id === id) out.push(String(m.content));
    }
  }
  return out;
}

describe(`FINDING-023: one ARV instruction, structural and last${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('the tool instruction', () => {
    it('does NOT re-state that the member supplies an ARV', async () => {
      const { app, openai } = build([runComps('123 Main St'), say('ok')], {
        subject: SUBJECT_A,
        comps: FRESH,
      });
      await chat(app, 'run comps on 123 Main St', 'f023-instruction');

      const shown = shownFor(openai.calls, 'rc1');
      expect(shown.length, 'the run_comps result never reached the model').toBeGreaterThan(0);
      const instruction = String(
        (JSON.parse(shown[0]) as { instruction?: string }).instruction ?? '',
      ).toLowerCase();

      // PRECONDITION: the BUG-014 disclaimer survives, so the absences below
      // are not passing against an empty instruction.
      expect(instruction, 'the BUG-014 disclaimer went with the clause').toMatch(
        /not produce an arv/,
      );
      expect(
        instruction,
        'the instruction still tells the model the member supplies an ARV — the sentence that got paraphrased',
      ).not.toMatch(/supply|supplies|their own arv|wants deal numbers/);
      expect(
        instruction,
        'set_manual_arv is routed per tool result again instead of as a standing prompt rule',
      ).not.toMatch(/set_manual_arv/);
      await app.close();
    });
  });

  describe.skipIf(pendingSlice(...MODS))('the rendered block', () => {
    it('names an ARV exactly once, and only the footer follows it', async () => {
      // POSITION, not just presence: the member-visible duplicate appeared
      // AFTER the disclaimer, so a case that only checked "the close exists"
      // would have passed while production read wrong.
      const { app, openai } = build([runComps('123 Main St'), say('ok')], {
        subject: SUBJECT_A,
        comps: FRESH,
      });
      await chat(app, 'run comps on 123 Main St', 'f023-position');

      const shown = shownFor(openai.calls, 'rc1');
      expect(shown.length, 'the run_comps result never reached the model').toBeGreaterThan(0);
      const block = String(
        (JSON.parse(shown[0]) as { rendered_block?: string }).rendered_block ?? '',
      );
      expect(block.length, 'the rendered block is empty').toBeGreaterThan(200);

      const lines = block.split('\n').filter((line) => line.trim().length > 0);
      const arvLines = lines
        .map((line, i) => (/\barv\b/i.test(line) ? i : -1))
        .filter((i) => i !== -1);

      expect(arvLines, 'the block names an ARV more than once').toHaveLength(1);
      expect(lines[arvLines[0]].trim(), 'the ARV line is not the prescribed copy').toBe(CLOSE);

      const trailing = lines.slice(arvLines[0] + 1);
      expect(trailing.length, 'nothing follows the close — the footer is missing').toBe(1);
      expect(trailing[0], 'the line after the close is not the footer').toMatch(
        /not a formal appraisal/i,
      );
      await app.close();
    });
  });
});
