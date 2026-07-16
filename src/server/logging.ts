/**
 * qa_logs writer. A logging failure must never block a reply.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TokenUsage } from '../agent/agent.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';

export interface QaLogEntry {
  userId: string;
  question: string;
  answer: string;
  retrievedChunkIds: Array<string | number>;
  similarityScores: number[];
  tokenUsage: TokenUsage;
}

/**
 * qa_logs is a named client deliverable, so a write failure must be non-blocking
 * but never invisible — Supabase could be down for a week and silence would look
 * identical to success.
 */
export async function logExchange(
  supabase: SupabaseClient,
  entry: QaLogEntry,
  logger: Logger = consoleLogger,
): Promise<void> {
  try {
    const { error } = await supabase.from('qa_logs').insert({
      user_id: entry.userId,
      question: entry.question,
      answer: entry.answer,
      retrieved_chunk_ids: entry.retrievedChunkIds,
      similarity_scores: entry.similarityScores,
      token_usage: entry.tokenUsage,
    });
    if (error) throw error;
  } catch (err) {
    logger.warn(
      { err, userId: entry.userId },
      'qa_logs insert failed — reply unaffected, this exchange was NOT logged',
    );
  }
}
