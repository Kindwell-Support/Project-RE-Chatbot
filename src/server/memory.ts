/**
 * Conversation memory persisted in Postgres (Supabase) keyed by session_id,
 * so history survives restarts. See sql/setup.sql for the chat_messages table.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatHistoryMessage } from '../agent/agent.js';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';

const MAX_TURNS = 15; // last ~15 exchanges (30 rows) go into context

export async function getHistory(
  supabase: SupabaseClient,
  sessionId: string,
  logger: Logger = consoleLogger,
): Promise<ChatHistoryMessage[]> {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(MAX_TURNS * 2);
    if (error) throw error;
    return (data ?? [])
      .reverse()
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({ role: row.role as 'user' | 'assistant', content: String(row.content) }));
  } catch (err) {
    // A history failure must never block a reply — but it must be visible:
    // silently returning [] looks identical to a brand-new session.
    logger.warn(
      { err, sessionId },
      'chat_messages history load failed — continuing with EMPTY history',
    );
    return [];
  }
}

export async function appendExchange(
  supabase: SupabaseClient,
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
  logger: Logger = consoleLogger,
): Promise<void> {
  try {
    const { error } = await supabase.from('chat_messages').insert([
      { session_id: sessionId, role: 'user', content: userMessage },
      { session_id: sessionId, role: 'assistant', content: assistantMessage },
    ]);
    if (error) throw error;
  } catch (err) {
    logger.warn(
      { err, sessionId },
      'chat_messages append failed — this turn will be missing from history',
    );
  }
}
