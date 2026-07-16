import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../server/logger.js';
import { consoleLogger } from '../server/logger.js';

export interface RetrievedChunk {
  id: string | number;
  content: string;
  similarity: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  embeddingTokens: number;
  /** Rows examined before duplicate collapsing (RPC scan window, or rows fetched on the fallback path). */
  rawCount: number;
  /** rawCount / distinct — how many copies of each passage the table currently holds. */
  duplicationRatio: number;
  /** Which path served the query: the deduping RPC or the legacy over-fetch fallback. */
  source: 'match_documents_distinct' | 'match_documents_fallback';
}

/**
 * WHY THIS FILE IS DEFENSIVE — the `documents` table receives duplicate rows
 * DAILY: the client's n8n ingestion workflow re-embeds the same files on five
 * schedule triggers with no dedupe (being fixed at source, in n8n — ingestion
 * is not this repo's to build or repair). Duplication measured at ~8 copies
 * per chunk and GROWING BY ONE PER DAY until that fix lands.
 *
 * A fixed over-fetch constant is therefore a clock, not a constant: 30 rows
 * yielded 4 distinct at 8x, would yield ~2 at 16x and 1 — the original bug,
 * fully restored — at 30x. So:
 *
 *  1. Preferred path: the ADDITIVE `match_documents_distinct` RPC dedupes in
 *     SQL (DISTINCT ON a normalized content hash), O(1) in the duplication
 *     ratio, and reports scan stats. The scan window escalates if distinct
 *     results run short. (`match_documents` itself is never modified — the
 *     n8n workflow depends on it.)
 *  2. Fallback path (RPC absent, e.g. an environment without the migration):
 *     legacy over-fetch + client-side collapse.
 *  3. Either way the duplication ratio is computed per retrieval and a
 *     logger.error fires below DUPLICATION_ALARM_RATIO. The degradation was
 *     invisible for months; it must never be silent again.
 */
const OVERFETCH_FACTOR = 6;
const INITIAL_SCAN_COUNT = 200;
const MAX_SCAN_COUNT = 2000;
const SCAN_ESCALATION_FACTOR = 4;
/** distinct/fetched below this ⇒ the table's duplication is eating the retrieval budget. */
export const DUPLICATION_ALARM_RATIO = 0.3;

function normalizeForDedupe(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function dedupeChunks(chunks: RetrievedChunk[], limit: number): RetrievedChunk[] {
  const seen = new Set<string>();
  const out: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const key = normalizeForDedupe(chunk.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
    if (out.length >= limit) break;
  }
  return out;
}

function toChunk(row: Record<string, unknown>): RetrievedChunk {
  return {
    id: (row.id ?? row.document_id ?? '') as string | number,
    content: String(row.content ?? row.text ?? row.chunk ?? ''),
    similarity: Number(row.similarity ?? row.score ?? 0),
  };
}

/** Postgres/PostgREST "function not found" — the only error that may trigger the fallback. */
function isMissingFunctionError(message: string): boolean {
  return /could not find|does not exist|not find the function|pgrst202/i.test(message);
}

export function alarmOnDuplication(
  logger: Logger,
  query: string,
  fetched: number,
  distinct: number,
): number {
  const ratio = fetched === 0 ? 1 : distinct / fetched;
  if (fetched > 0 && ratio < DUPLICATION_ALARM_RATIO) {
    logger.error(
      { fetched, distinct, ratio: Number(ratio.toFixed(3)), query },
      `documents-table duplication alarm: ${fetched} rows scanned -> only ${distinct} distinct ` +
        `(ratio ${ratio.toFixed(3)} < ${DUPLICATION_ALARM_RATIO}). The n8n re-ingestion is still ` +
        'adding daily copies; retrieval quality degrades as this ratio falls. De-dupe the table.',
    );
  }
  return ratio;
}

export async function searchKnowledgeBase(
  openai: OpenAI,
  supabase: SupabaseClient,
  config: AppConfig,
  query: string,
  logger: Logger = consoleLogger,
): Promise<RetrievalResult> {
  const embeddingResponse = await openai.embeddings.create({
    model: config.embeddingModel,
    input: query,
  });
  const embedding = embeddingResponse.data[0].embedding;
  const embeddingTokens = embeddingResponse.usage?.total_tokens ?? 0;

  // --- Preferred path: SQL-side dedupe, adaptive scan window ------------------
  let scanCount = INITIAL_SCAN_COUNT;
  let missingFunction = false;
  for (;;) {
    const { data, error } = await supabase.rpc('match_documents_distinct', {
      query_embedding: embedding,
      match_count: config.matchCount,
      filter: {},
      scan_count: scanCount,
    });
    if (error) {
      if (isMissingFunctionError(error.message)) {
        missingFunction = true;
        logger.error(
          { error: error.message },
          'match_documents_distinct RPC missing — falling back to legacy over-fetch. ' +
            'Apply the add_match_documents_distinct migration.',
        );
        break;
      }
      throw new Error(`match_documents_distinct RPC failed: ${error.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    const scanned = rows.length > 0 ? Number(rows[0].scanned ?? 0) : 0;
    const distinctScanned = rows.length > 0 ? Number(rows[0].distinct_scanned ?? rows.length) : 0;

    // Escalate the window while we're short of matchCount distinct and the
    // window can still grow. (If scanned < scanCount the index gave us all it
    // will; escalating can still surface more with a bigger limit, so retry
    // until the cap either way — one extra round-trip at worst.)
    if (rows.length < config.matchCount && scanCount < MAX_SCAN_COUNT && scanned > 0) {
      scanCount = Math.min(scanCount * SCAN_ESCALATION_FACTOR, MAX_SCAN_COUNT);
      continue;
    }

    // Belt-and-braces: SQL already deduped; this only catches normalization gaps.
    const chunks = dedupeChunks(rows.map(toChunk), config.matchCount);
    const duplicationRatio = alarmOnDuplication(logger, query, scanned, distinctScanned);
    return {
      chunks,
      embeddingTokens,
      rawCount: scanned,
      duplicationRatio,
      source: 'match_documents_distinct',
    };
  }

  // --- Fallback path: legacy RPC + client-side collapse -----------------------
  if (!missingFunction) throw new Error('unreachable');
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: embedding,
    match_count: config.matchCount * OVERFETCH_FACTOR,
    filter: {},
  });
  if (error) {
    throw new Error(`match_documents RPC failed: ${error.message}`);
  }
  const raw = (Array.isArray(data) ? data : []).map(toChunk);
  const distinctAll = dedupeChunks(raw, raw.length);
  const chunks = distinctAll.slice(0, config.matchCount);
  const duplicationRatio = alarmOnDuplication(logger, query, raw.length, distinctAll.length);
  return {
    chunks,
    embeddingTokens,
    rawCount: raw.length,
    duplicationRatio,
    source: 'match_documents_fallback',
  };
}

export function formatChunksForModel(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'No matching passages found in the knowledge base for this query.';
  }
  return chunks
    .map((chunk, index) => `[Passage ${index + 1} | similarity ${chunk.similarity.toFixed(3)}]\n${chunk.content}`)
    .join('\n\n---\n\n');
}
