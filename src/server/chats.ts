/**
 * The `chats` store (Phase 1 multi-chat). Data access only — every function
 * takes the owner key resolved by ownerKey.ts and scopes its WHERE to it.
 *
 * chats.id IS the session_id posted to /chat, so chat_messages and
 * session_state isolate per chat with no schema change and no change to
 * src/agent/ (ruling R1).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type OpenAI from 'openai';
import type { Logger } from './logger.js';
import { consoleLogger } from './logger.js';

export interface ChatRow {
  id: string;
  title: string | null;
  created_at: string;
  last_message_at: string;
}

/** The columns every read path returns — never owner_key, which is a credential. */
const CHAT_COLUMNS = 'id, title, created_at, last_message_at';

/** Sidebar page size. A member with more than this has older chats below the fold. */
export const CHAT_LIST_LIMIT = 50;

/**
 * C1: the most ACTIVE chats one owner_key may hold. Deliberately equal to
 * CHAT_LIST_LIMIT so a member can never own a chat that is not listable.
 * Archived rows do not count. Forgeable by minting a new device key, which is
 * the point: this bounds accidents and single-key loops, not a determined
 * attacker (IP limits are Phase 3).
 */
export const MAX_ACTIVE_CHATS = CHAT_LIST_LIMIT;

/** Raised when a create would exceed MAX_ACTIVE_CHATS. Handlers map it to 409. */
export class ChatLimitError extends Error {
  constructor() {
    super('active chat limit reached');
    this.name = 'ChatLimitError';
  }
}

/** Titles are member-editable free text; cap the stored length. */
export const MAX_TITLE_LENGTH = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A non-uuid id can never match a row, and handing it to Postgres raises
 * `invalid input syntax for type uuid` — a 500 for what is really a 404.
 */
export function isChatId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Trim + collapse + cap. Returns null when the input is not a usable title. */
export function normalizeTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

/** Active chats for one owner, newest activity first. Archived rows excluded (R4). */
export async function listChats(
  supabase: SupabaseClient,
  ownerKey: string,
  limit = CHAT_LIST_LIMIT,
): Promise<ChatRow[]> {
  const { data, error } = await supabase
    .from('chats')
    .select(CHAT_COLUMNS)
    .eq('owner_key', ownerKey)
    .is('archived_at', null)
    .order('last_message_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ChatRow[];
}

/**
 * How many ACTIVE chats this owner holds, counted up to the cap + 1 — enough
 * to answer "are they at the limit?" without reading a whole table.
 */
export async function countActiveChats(supabase: SupabaseClient, ownerKey: string): Promise<number> {
  const { data, error } = await supabase
    .from('chats')
    .select('id')
    .eq('owner_key', ownerKey)
    .is('archived_at', null)
    .limit(MAX_ACTIVE_CHATS + 1);
  if (error) throw error;
  return ((data ?? []) as unknown[]).length;
}

/**
 * One chat by id, WITHOUT an owner filter — the ownership question is what it
 * answers. Its only caller is the "0 rows updated" branch of touchChat and the
 * archived check on /chat, both of which need to tell "absent" apart from
 * "exists, not yours" and "archived".
 */
export async function findChatById(
  supabase: SupabaseClient,
  chatId: string,
): Promise<{ id: string; owner_key: string; archived_at: string | null } | null> {
  if (!isChatId(chatId)) return null;
  const { data, error } = await supabase
    .from('chats')
    .select('id, owner_key, archived_at')
    .eq('id', chatId)
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; owner_key: string; archived_at: string | null }>;
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Create a chat. `id` is honoured only for legacy adoption; a collision cannot
 * overwrite anything — the primary key rejects it and the caller surfaces 409.
 *
 * NOTE (R6): the widget no longer calls this on any path. First-chat decisions
 * are client-side placeholders now, and the row materialises through
 * touchChat's self-heal on first send. This stays as the explicit API and is
 * capped identically, so the two creation paths cannot diverge.
 */
export async function createChat(
  supabase: SupabaseClient,
  ownerKey: string,
  options: { id?: string; title?: string | null; adoptedLegacy?: boolean } = {},
): Promise<ChatRow> {
  if ((await countActiveChats(supabase, ownerKey)) >= MAX_ACTIVE_CHATS) throw new ChatLimitError();
  const row: Record<string, unknown> = { owner_key: ownerKey };
  if (options.id) row.id = options.id;
  if (options.title) row.title = options.title;
  if (options.adoptedLegacy) row.adopted_legacy = true;
  const { data, error } = await supabase.from('chats').insert(row).select(CHAT_COLUMNS).single();
  if (error) throw error;
  return data as unknown as ChatRow;
}

/**
 * Rename. Scoped to the owner, so a chat belonging to someone else simply
 * does not match — the handler answers 404, never 403: confirming existence
 * would make chat ids enumerable by response code.
 */
export async function renameChat(
  supabase: SupabaseClient,
  ownerKey: string,
  chatId: string,
  title: string,
): Promise<ChatRow | null> {
  const { data, error } = await supabase
    .from('chats')
    .update({ title })
    .eq('id', chatId)
    .eq('owner_key', ownerKey)
    .is('archived_at', null)
    .select(CHAT_COLUMNS);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ChatRow[];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * SOFT delete (R4): stamp archived_at and drop out of every read path.
 * chat_messages and session_state rows are deliberately left intact — the
 * transcript and the comps context are recoverable, and Phase 3 inherits
 * them.
 */
export async function archiveChat(
  supabase: SupabaseClient,
  ownerKey: string,
  chatId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chats')
    .update({ archived_at: now.toISOString() })
    .eq('id', chatId)
    .eq('owner_key', ownerKey)
    .is('archived_at', null)
    .select('id');
  if (error) throw error;
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * Bump last_message_at after a completed turn so the sidebar orders by real
 * activity. Fire-and-forget at the call site: it runs AFTER the reply is
 * sent and can never delay or fail a member's answer.
 *
 * The insert-if-absent branch needs an owner and only fires when the caller
 * supplied one. It NEVER updates owner_key on an existing row — ownership is
 * established once, at creation, and a later /chat call cannot move a chat
 * between owners.
 */
export async function touchChat(
  supabase: SupabaseClient,
  chatId: string,
  ownerKey: string | undefined,
  logger: Logger = consoleLogger,
  now: Date = new Date(),
  options: { hadPriorHistory?: boolean } = {},
): Promise<void> {
  if (!isChatId(chatId)) return;
  // BUG-016: without an owner there is no way to scope the write, and an
  // unscoped update is exactly the defect — a /chat call with someone else's
  // chat id reordering their sidebar. No owner, no write.
  if (!ownerKey) return;
  try {
    const stamp = now.toISOString();
    const { data, error } = await supabase
      .from('chats')
      .update({ last_message_at: stamp })
      .eq('id', chatId)
      .eq('owner_key', ownerKey)
      .is('archived_at', null)
      .select('id');
    if (error) throw error;
    if (((data ?? []) as unknown[]).length > 0) return;

    // THE TRAP (BUG-016): now that the update is owner- and archive-filtered,
    // "0 rows changed" no longer means "no such row". It also means "exists,
    // not yours" and "exists, archived" — and inserting on either of those
    // collides on the primary key. Only a lookup that finds NOTHING AT ALL
    // justifies the self-heal.
    const existing = await findChatById(supabase, chatId);
    if (existing) return;

    // C1 applies here too. After R6 this is the only path that creates rows in
    // practice, so capping POST /chats alone would be a cap that enforces
    // nothing.
    if ((await countActiveChats(supabase, ownerKey)) >= MAX_ACTIVE_CHATS) {
      logger.warn(
        { chatId, limit: MAX_ACTIVE_CHATS },
        'active chat limit reached — conversation continues, no sidebar row created',
      );
      return;
    }

    const { error: insertError } = await supabase.from('chats').insert({
      id: chatId,
      owner_key: ownerKey,
      last_message_at: stamp,
      // adopted_legacy is SERVER-INFERRED, never client-asserted: a
      // self-declared flag would simply be omitted by whoever planted the
      // session id, and Phase 3 would then migrate that row into their
      // verified account.
      //
      // WHAT THIS FLAG ACTUALLY MEANS — read before adding a caller: it means
      // "this session ALREADY HAD HISTORY when its first chat row was
      // written". It does NOT mean "was adopted". W1 legacy adoption is the
      // usual way those coincide, but INSPECTOR proved they can come apart:
      // a NEW chat whose first write is skipped (the C1 cap, a transient
      // insert failure) acquires history and is then flagged on turn 2.
      //
      // PURPOSE CHANGED (operator ruling, N1): all three phases now ship
      // together, so owner_key is 'email:<verified>' from the very first
      // write and there is no Phase 3 rewrite pass for this flag to gate.
      // That retires the failure the flag was defending against — a
      // false positive no longer costs a member a real chat — and demotes
      // it to an AUDIT column. Keep it, keep the inference: it is the only
      // record of which rows were written over a session that already had
      // a transcript, which is exactly what an audit of the migration will
      // want. Do not read it as "adopted" in any new code.
      adopted_legacy: options.hadPriorHistory === true,
    });
    if (insertError) throw insertError;
  } catch (err) {
    // Ordering is a nicety; the conversation itself is already persisted.
    logger.warn({ err, chatId }, 'chats last_message_at update failed — sidebar order may lag');
  }
}

/** First user message, trimmed to 40 chars — the never-fails title source. */
export function fallbackTitle(firstUserMessage: string): string {
  const clean = String(firstUserMessage ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!clean) return 'New chat';
  return clean.length <= 40 ? clean : clean.slice(0, 40).trimEnd();
}

/**
 * Title generation (fire-and-forget, never blocks, never regenerates).
 *
 * Runs once, after the FIRST completed assistant turn. The update is
 * conditional on `title IS NULL`, so a concurrent second turn — or a member
 * who renamed the chat while the model was thinking — cannot be overwritten:
 * "never regenerate" is enforced by the WHERE clause, not by call-site
 * discipline.
 */
export async function generateChatTitle(
  supabase: SupabaseClient,
  openai: OpenAI,
  chatId: string,
  firstUserMessage: string,
  firstAssistantMessage: string,
  logger: Logger = consoleLogger,
): Promise<void> {
  if (!isChatId(chatId)) return;
  // The fallback is computed FIRST and is always usable, so no failure path
  // leaves a chat permanently unnamed.
  let title = fallbackTitle(firstUserMessage);
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 24,
      messages: [
        {
          role: 'system',
          content:
            'Title this real-estate chat in at most 6 words. Plain words only: no quotation ' +
            'marks, no trailing period, no prefix like Chat about. Reply with the title alone.',
        },
        {
          role: 'user',
          content:
            'Member: ' +
            firstUserMessage.slice(0, 500) +
            '\n\nJames: ' +
            firstAssistantMessage.slice(0, 500),
        },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? '';
    const stripped = raw.replace(/^[\s"']+/, '').replace(/[\s"'.]+$/, '');
    const generated = normalizeTitle(stripped);
    if (generated) title = generated.split(' ').slice(0, 6).join(' ');
  } catch (err) {
    logger.warn({ err, chatId }, 'chat title generation failed — falling back to the first message');
  }
  try {
    const { error } = await supabase
      .from('chats')
      .update({ title })
      .eq('id', chatId)
      .is('title', null);
    if (error) throw error;
  } catch (err) {
    logger.warn({ err, chatId }, 'chat title write failed — chat stays "New chat"');
  }
}
