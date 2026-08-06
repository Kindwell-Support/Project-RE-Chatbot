/**
 * RAG retrieval tests.
 *
 * Two properties matter most here:
 *  1. The embedding-model pin — ada-002 is also 1536-dim, so the wrong model
 *     returns silently WRONG results, not an error.
 *  2. Duplication defense — the client's n8n ingestion re-embeds the corpus
 *     daily (no dedupe at source yet), so the documents table holds ~8 copies
 *     of everything and gains one more per day. A fixed over-fetch constant
 *     rots as the ratio grows; retrieval must adapt AND alarm.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  searchKnowledgeBase,
  formatChunksForModel,
  dedupeChunks,
  alarmOnDuplication,
  DUPLICATION_ALARM_RATIO,
} from '../src/agent/retrieval.js';
import { loadConfig, assertRuntimeConfig, REQUIRED_EMBEDDING_MODEL } from '../src/config.js';
import { MissingRequiredInputError, runFlipTool } from '../src/agent/toolRunners.js';
import type { Logger } from '../src/server/logger.js';
import type OpenAI from 'openai';

const config = loadConfig({
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

function makeLoggerSpy(): { logger: Logger; errors: Array<{ obj: any; msg: string }> } {
  const errors: Array<{ obj: any; msg: string }> = [];
  return {
    logger: {
      warn: () => {},
      error: (obj, msg) => errors.push({ obj, msg }),
    },
    errors,
  };
}

interface DistinctRow {
  id: number;
  content: string;
  similarity: number;
  scanned: number;
  distinct_scanned: number;
}

/**
 * Spy clients. `distinctResponses` are consumed one per match_documents_distinct
 * call (last one repeats); `legacyRows` serve the fallback match_documents path;
 * `distinctError` makes the new RPC fail with that message.
 */
function makeSpyClients(opts: {
  distinctResponses?: DistinctRow[][];
  legacyRows?: Array<{ id: number | string; content: string; similarity: number }>;
  distinctError?: string;
}) {
  const embedCalls: Array<Record<string, any>> = [];
  const rpcCalls: Array<{ fn: string; params: Record<string, any> }> = [];
  let distinctCallIndex = 0;

  const openai = {
    embeddings: {
      create: async (params: Record<string, any>) => {
        embedCalls.push(params);
        return {
          data: [{ embedding: new Array(1536).fill(0.01) }],
          usage: { total_tokens: 7 },
        };
      },
    },
  } as unknown as OpenAI;

  const supabase = {
    rpc: async (fn: string, params: Record<string, any>) => {
      rpcCalls.push({ fn, params });
      if (fn === 'match_documents_distinct') {
        if (opts.distinctError) return { data: null, error: { message: opts.distinctError } };
        const responses = opts.distinctResponses ?? [[]];
        const response = responses[Math.min(distinctCallIndex, responses.length - 1)];
        distinctCallIndex++;
        return { data: response, error: null };
      }
      return { data: opts.legacyRows ?? [], error: null };
    },
  } as any;

  return { openai, supabase, embedCalls, rpcCalls };
}

const FIVE_DISTINCT: DistinctRow[] = [
  { id: 1, content: 'A buy box is your written criteria.', similarity: 0.91, scanned: 200, distinct_scanned: 40 },
  { id: 2, content: 'Stick to the box; discipline beats deal fever.', similarity: 0.84, scanned: 200, distinct_scanned: 40 },
  { id: 3, content: 'Walk away when it does not pencil.', similarity: 0.8, scanned: 200, distinct_scanned: 40 },
  { id: 4, content: 'Know your exit before you enter.', similarity: 0.78, scanned: 200, distinct_scanned: 40 },
  { id: 5, content: 'Comps decide the ARV, not hope.', similarity: 0.75, scanned: 200, distinct_scanned: 40 },
];

describe('embedding model is pinned to text-embedding-3-small', () => {
  it('the constant and the config default agree', () => {
    expect(REQUIRED_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(config.embeddingModel).toBe('text-embedding-3-small');
  });

  it('the embed call uses exactly text-embedding-3-small', async () => {
    const { openai, supabase, embedCalls } = makeSpyClients({ distinctResponses: [FIVE_DISTINCT] });
    await searchKnowledgeBase(openai, supabase, config, 'how does James build a buy box?');
    expect(embedCalls).toHaveLength(1);
    expect(embedCalls[0].model).toBe('text-embedding-3-small');
    expect(embedCalls[0].input).toBe('how does James build a buy box?');
  });

  it('startup REJECTS ada-002 — the silent-wrong-results case (same 1536 dims)', () => {
    const bad = loadConfig({
      OPENAI_API_KEY: 'k',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      EMBEDDING_MODEL: 'text-embedding-ada-002',
    } as NodeJS.ProcessEnv);
    expect(() => assertRuntimeConfig(bad)).toThrow(/text-embedding-3-small/);
    expect(() => assertRuntimeConfig(bad)).toThrow(/silently wrong/i);
  });

  it('startup rejects text-embedding-3-large too', () => {
    const bad = loadConfig({
      OPENAI_API_KEY: 'k',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      EMBEDDING_MODEL: 'text-embedding-3-large',
    } as NodeJS.ProcessEnv);
    expect(() => assertRuntimeConfig(bad)).toThrow(/text-embedding-3-small/);
  });

  it('a valid config passes startup', () => {
    const ok = loadConfig({
      OPENAI_API_KEY: 'k',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    } as NodeJS.ProcessEnv);
    expect(() => assertRuntimeConfig(ok)).not.toThrow();
  });
});

describe('preferred path: match_documents_distinct RPC', () => {
  it('calls the ADDITIVE RPC with match_count, filter and a scan window', async () => {
    const { openai, supabase, rpcCalls } = makeSpyClients({ distinctResponses: [FIVE_DISTINCT] });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box');

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('match_documents_distinct');
    expect(rpcCalls[0].params).toMatchObject({ match_count: 5, filter: {} });
    expect(rpcCalls[0].params.scan_count).toBeGreaterThan(0);
    expect(rpcCalls[0].params.query_embedding).toHaveLength(1536);
    expect(result.source).toBe('match_documents_distinct');
    expect(result.chunks).toHaveLength(5);
    expect(result.chunks[0]).toMatchObject({ id: 1, similarity: 0.91 });
  });

  it('never calls match_documents when the distinct RPC works (n8n depends on it staying untouched)', async () => {
    const { openai, supabase, rpcCalls } = makeSpyClients({ distinctResponses: [FIVE_DISTINCT] });
    await searchKnowledgeBase(openai, supabase, config, 'buy box');
    expect(rpcCalls.map((c) => c.fn)).not.toContain('match_documents');
  });

  it('reports the duplication ratio from the RPC scan stats', async () => {
    const { openai, supabase } = makeSpyClients({ distinctResponses: [FIVE_DISTINCT] });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box');
    expect(result.rawCount).toBe(200);
    expect(result.duplicationRatio).toBeCloseTo(40 / 200, 10);
  });

  it('ESCALATES the scan window when distinct results run short (the constant-is-a-clock bug)', async () => {
    // First window: 200 rows scanned, only 2 distinct survive — duplication has
    // grown past what the initial window absorbs. A fixed constant would return
    // 2 chunks and shrink toward 1 as ingestion keeps duplicating; the window
    // must grow instead.
    const short: DistinctRow[] = [
      { id: 1, content: 'chunk one', similarity: 0.9, scanned: 200, distinct_scanned: 2 },
      { id: 2, content: 'chunk two', similarity: 0.8, scanned: 200, distinct_scanned: 2 },
    ];
    const { openai, supabase, rpcCalls } = makeSpyClients({
      distinctResponses: [short, FIVE_DISTINCT],
    });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box');

    expect(rpcCalls.length).toBeGreaterThanOrEqual(2);
    expect(rpcCalls[1].fn).toBe('match_documents_distinct');
    expect(rpcCalls[1].params.scan_count).toBeGreaterThan(rpcCalls[0].params.scan_count);
    expect(result.chunks).toHaveLength(5);
  });

  it('escalation is bounded — a pathological table cannot loop forever', async () => {
    const starved: DistinctRow[] = [
      { id: 1, content: 'the only chunk', similarity: 0.9, scanned: 2000, distinct_scanned: 1 },
    ];
    const { openai, supabase, rpcCalls } = makeSpyClients({
      distinctResponses: [starved],
    });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box');
    // Windows: 200 -> 800 -> 2000, then the cap stops it.
    expect(rpcCalls.length).toBeLessThanOrEqual(3);
    expect(Math.max(...rpcCalls.map((c) => c.params.scan_count))).toBeLessThanOrEqual(2000);
    expect(result.chunks).toHaveLength(1);
  });

  it('an unexpected RPC error surfaces — only a MISSING function triggers fallback', async () => {
    const { openai, supabase } = makeSpyClients({ distinctError: 'connection reset' });
    await expect(searchKnowledgeBase(openai, supabase, config, 'q')).rejects.toThrow(
      /match_documents_distinct RPC failed/,
    );
  });
});

describe('fallback path: distinct RPC missing (environment without the migration)', () => {
  const LEGACY_DUPES = [
    { id: 11214, content: 'Same passage.', similarity: 0.57 },
    { id: 8943, content: 'Same passage.', similarity: 0.57 },
    { id: 7450, content: 'Same passage.', similarity: 0.57 },
    { id: 301, content: 'A different passage.', similarity: 0.55 },
  ];

  it('falls back to match_documents + client-side collapse, and says so loudly', async () => {
    const { logger, errors } = makeLoggerSpy();
    const { openai, supabase, rpcCalls } = makeSpyClients({
      distinctError: 'Could not find the function public.match_documents_distinct',
      legacyRows: LEGACY_DUPES,
    });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box', logger);

    expect(rpcCalls.map((c) => c.fn)).toEqual(['match_documents_distinct', 'match_documents']);
    expect(result.source).toBe('match_documents_fallback');
    // Duplicates collapsed client-side.
    const contents = result.chunks.map((c) => c.content);
    expect(new Set(contents).size).toBe(contents.length);
    expect(result.chunks).toHaveLength(2);
    // The missing migration is reported, not silently absorbed.
    expect(errors.some((e) => /migration/i.test(e.msg))).toBe(true);
  });
});

describe('duplication alarm — the degradation must be LOUD', () => {
  it('fires logger.error below the threshold ratio', () => {
    const { logger, errors } = makeLoggerSpy();
    // 105 scanned -> 13 distinct is the live table today (ratio 0.124).
    const ratio = alarmOnDuplication(logger, 'buy box', 105, 13);
    expect(ratio).toBeCloseTo(13 / 105, 10);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toMatch(/duplication alarm/i);
    expect(errors[0].obj).toMatchObject({ fetched: 105, distinct: 13 });
  });

  it('stays quiet at a healthy ratio', () => {
    const { logger, errors } = makeLoggerSpy();
    alarmOnDuplication(logger, 'buy box', 100, 90);
    expect(errors).toHaveLength(0);
  });

  it('boundary: exactly the threshold does not fire; just below does', () => {
    const at = makeLoggerSpy();
    alarmOnDuplication(at.logger, 'q', 100, DUPLICATION_ALARM_RATIO * 100);
    expect(at.errors).toHaveLength(0);

    const below = makeLoggerSpy();
    alarmOnDuplication(below.logger, 'q', 100, DUPLICATION_ALARM_RATIO * 100 - 1);
    expect(below.errors).toHaveLength(1);
  });

  it('a heavily-duplicated retrieval through the full path triggers the alarm', async () => {
    const { logger, errors } = makeLoggerSpy();
    const dupHeavy: DistinctRow[] = [
      { id: 1, content: 'one', similarity: 0.9, scanned: 800, distinct_scanned: 5 },
      { id: 2, content: 'two', similarity: 0.8, scanned: 800, distinct_scanned: 5 },
      { id: 3, content: 'three', similarity: 0.7, scanned: 800, distinct_scanned: 5 },
      { id: 4, content: 'four', similarity: 0.6, scanned: 800, distinct_scanned: 5 },
      { id: 5, content: 'five', similarity: 0.5, scanned: 800, distinct_scanned: 5 },
    ];
    const { openai, supabase } = makeSpyClients({ distinctResponses: [dupHeavy] });
    const result = await searchKnowledgeBase(openai, supabase, config, 'buy box', logger);
    expect(result.duplicationRatio).toBeCloseTo(5 / 800, 10);
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toMatch(/duplication alarm/i);
  });

  it('zero-row retrieval does not divide by zero or false-alarm', () => {
    const { logger, errors } = makeLoggerSpy();
    const ratio = alarmOnDuplication(logger, 'q', 0, 0);
    expect(ratio).toBe(1);
    expect(errors).toHaveLength(0);
  });
});

describe('client-side dedupe (defense-in-depth behind the SQL dedupe)', () => {
  it('collapses on whitespace/case variation, not just exact equality', () => {
    const out = dedupeChunks(
      [
        { id: 1, content: 'A buy box is your criteria.', similarity: 0.9 },
        { id: 2, content: '  a  BUY   box is your criteria.  ', similarity: 0.9 },
        { id: 3, content: 'Something else entirely.', similarity: 0.8 },
      ],
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(1);
  });

  it('drops empty chunks rather than passing blanks to the model', () => {
    const out = dedupeChunks(
      [
        { id: 1, content: '   ', similarity: 0.9 },
        { id: 2, content: 'Real content.', similarity: 0.8 },
      ],
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
  });

  it('never returns more than the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      content: `chunk ${i}`,
      similarity: 1 - i / 100,
    }));
    expect(dedupeChunks(many, 5)).toHaveLength(5);
  });
});

describe('formatting', () => {
  it('zero matches is reported honestly, not as a fabricated answer', () => {
    expect(formatChunksForModel([])).toMatch(/No matching passages/i);
  });

  it('formats chunks with their similarity scores for the model', () => {
    const formatted = formatChunksForModel([
      { id: 1, content: 'A buy box is your written criteria.', similarity: 0.91 },
    ]);
    expect(formatted).toContain('0.910');
    expect(formatted).toContain('A buy box is your written criteria.');
  });
});

// ---------------------------------------------------------------------------
// FINDING-005 — a blank query is a schema violation, not a search.
//
// `search_knowledge_base` declares `required: ['query']`, but the call site
// coerced a missing one to `''` and `searchKnowledgeBase` embedded it
// unconditionally. An empty vector search returns arbitrary nearest passages,
// and the material-budget fallback instructs the model to quote ONLY dollar
// figures appearing in retrieved passages — so handed passages retrieved for
// no question at all, a compliant model quotes those figures as an answer.
// The instruction that normally prevents invention becomes the thing that
// launders it. An honesty hole, not hygiene.
//
// Verified to the same shape as BUG-009.
// ---------------------------------------------------------------------------
describe('FINDING-005: a blank query is rejected, never embedded', () => {
  const cfg = loadConfig({
    ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
    OPENAI_API_KEY: 'test-not-a-real-key',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-real-key',
  } as NodeJS.ProcessEnv);

  /** Spies on the embedding call — the thing that must NOT happen. */
  function spyingClients() {
    let embeddingCalls = 0;
    let rpcCalls = 0;
    const openai = {
      embeddings: {
        create: async () => {
          embeddingCalls++;
          return { data: [{ embedding: new Array(1536).fill(0.01) }], usage: { total_tokens: 7 } };
        },
      },
    } as never;
    const supabase = {
      rpc: async () => {
        rpcCalls++;
        return { data: [], error: null };
      },
    } as never;
    return { openai, supabase, counts: () => ({ embeddingCalls, rpcCalls }) };
  }

  const BLANKS: Array<[string, unknown]> = [
    ['empty string', ''],
    ['spaces', '   '],
    ['tab', '\t'],
    ['newline', '\n'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', {}],
  ];

  it.each(BLANKS)('%s is rejected, returns nothing, and never embeds', async (_label, value) => {
    const { openai, supabase, counts } = spyingClients();
    let threw: unknown;
    let returned: unknown;
    try {
      returned = await searchKnowledgeBase(openai, supabase, cfg, value as never);
    } catch (err) {
      threw = err;
    }

    expect(threw, `a blank query returned instead of throwing: ${JSON.stringify(returned)}`)
      .toBeDefined();
    expect(returned, 'a result set came back alongside the rejection').toBeUndefined();
    // The cost half: a rejected query must not spend an embedding call, and
    // must never reach the vector search.
    expect(counts().embeddingCalls, 'a blank query was embedded anyway').toBe(0);
    expect(counts().rpcCalls, 'a blank query reached the vector search').toBe(0);
  });

  it('rejects with the calculators\' error class, not a second convention', async () => {
    let err: unknown;
    try {
      const { openai, supabase } = spyingClients();
      await searchKnowledgeBase(openai, supabase, cfg, '' as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingRequiredInputError);
    expect((err as Error).message).toMatch(/query/);

    let calcErr: unknown;
    try {
      runFlipTool({});
    } catch (e) {
      calcErr = e;
    }
    expect(
      (err as object).constructor,
      'retrieval and the calculators reject with different classes',
    ).toBe((calcErr as object).constructor);
  });

  it('the guard fires BEFORE the embedding, not after', async () => {
    // Ordering is the whole point. A guard after the embed still spends the
    // call and, worse, would leave the vector search reachable on a refactor.
    const { openai, supabase, counts } = spyingClients();
    await expect(searchKnowledgeBase(openai, supabase, cfg, '   ' as never)).rejects.toThrow();
    expect(counts().embeddingCalls).toBe(0);
  });

  it('a REAL query still searches — the guard is a guard, not a blanket refusal', async () => {
    // Positive precondition. A function that threw on everything would satisfy
    // every assertion above.
    const { openai, supabase, counts } = spyingClients();
    const result = await searchKnowledgeBase(openai, supabase, cfg, 'how does James build a buy box?');
    expect(result).toBeDefined();
    expect(counts().embeddingCalls, 'a valid query did not embed').toBe(1);
  });
});
