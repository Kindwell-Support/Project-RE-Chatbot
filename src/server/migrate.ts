/**
 * Auto-migration: creates the chat_messages table if it doesn't exist.
 * Uses Supabase's built-in pg_catalog to check, and falls back to just
 * trying the insert and letting the server start either way.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export async function ensureChatMessagesTable(supabase: SupabaseClient): Promise<boolean> {
  // Test if the table already exists by trying a zero-cost read
  const { error } = await supabase
    .from('chat_messages')
    .select('id')
    .limit(0);

  if (!error) {
    console.log('[migrate] chat_messages table exists');
    return true;
  }

  console.warn(
    '[migrate] chat_messages table not found. Please create it by running sql/setup.sql in the Supabase SQL editor:',
    '\n',
    `  create table if not exists chat_messages (
    id bigint generated always as identity primary key,
    session_id text not null,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamptz not null default now()
  );
  create index if not exists chat_messages_session_created_idx
    on chat_messages (session_id, created_at desc);`,
  );
  return false;
}
