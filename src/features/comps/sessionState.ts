/**
 * session_state store (CONTRACT §8) — the structured side of conversation
 * memory. chat_messages stays the model's transcript; this carries the
 * machine-readable comps block that pre-fills Flip/BRRRR.
 *
 * Safety-by-construction properties, all enforced HERE:
 *  - session_id is the chat_messages identifier, verbatim. No new identity.
 *  - `state` is ONE jsonb blob; the comps block lives whole at `state.comps`
 *    and is replaced atomically by upsert — there is no observable state
 *    where `arv` is set but `subjectAddress` isn't.
 *  - Every operation swallows-and-warns: a state failure degrades to
 *    no-prefill (the calculator asks for the ARV as it always did). It never
 *    blocks a reply.
 *
 * Pinned call shapes (CONTRACT §8; INSPECTOR's double narrows to exactly
 * these):
 *   read   .from('session_state').select('state').eq('session_id', id).maybeSingle()
 *   write  .from('session_state').upsert({ session_id, state, updated_at })
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompsStateBlock, SessionStateStore } from './tools.js';

interface LoggerLike {
  warn(obj: Record<string, unknown>, msg: string): void;
}

const consoleWarn: LoggerLike = {
  warn: (obj, msg) => console.warn(msg, obj),
};

function isCompsStateBlock(value: unknown): value is CompsStateBlock {
  if (typeof value !== 'object' || value === null) return false;
  const block = value as Record<string, unknown>;
  return (
    typeof block.arv === 'number' &&
    Number.isFinite(block.arv) &&
    block.arv > 0 &&
    typeof block.subjectAddress === 'string' &&
    block.subjectAddress.length > 0 &&
    (block.arvSource === 'comps' || block.arvSource === 'manual')
  );
}

export function createSessionStateStore(
  supabase: SupabaseClient,
  logger: LoggerLike = consoleWarn,
): SessionStateStore {
  async function readState(sessionId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase
      .from('session_state')
      .select('state')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    const state = (data as { state?: unknown } | null)?.state;
    return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
  }

  async function writeState(sessionId: string, state: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.from('session_state').upsert({
      session_id: sessionId,
      state,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  return {
    async getCompsBlock(sessionId: string): Promise<CompsStateBlock | null> {
      try {
        const state = await readState(sessionId);
        // Malformed blocks (partial writes from a future bug, hand-edited
        // rows) read as absent rather than half-trusted: a pre-fill from a
        // corrupt block is a silently wrong deal analysis.
        return isCompsStateBlock(state.comps) ? state.comps : null;
      } catch (err) {
        logger.warn({ err, sessionId }, 'session_state read failed — continuing WITHOUT ARV pre-fill');
        return null;
      }
    },

    async setCompsBlock(sessionId: string, block: CompsStateBlock): Promise<void> {
      try {
        const state = await readState(sessionId);
        await writeState(sessionId, { ...state, comps: block });
      } catch (err) {
        logger.warn({ err, sessionId }, 'session_state write failed — ARV will NOT pre-fill later turns');
      }
    },

    async clearCompsBlock(sessionId: string): Promise<void> {
      try {
        const state = await readState(sessionId);
        if (!('comps' in state)) return;
        delete state.comps;
        await writeState(sessionId, state);
      } catch (err) {
        // A failed CLEAR is the one state failure that could leave a STALE
        // ARV behind before a new run — louder wording on purpose.
        logger.warn(
          { err, sessionId },
          'session_state CLEAR failed — a stale comps ARV may survive; pre-fill echo is the safety net',
        );
      }
    },
  };
}
