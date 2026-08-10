/**
 * Auto-migration: creates the chat_messages table if it doesn't exist.
 * Uses Supabase's built-in pg_catalog to check, and falls back to just
 * trying the insert and letting the server start either way.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Same zero-cost existence probe for the comps tables (sql/add_comps_tables.sql).
 * Missing tables warn loudly but never block boot: the comps feature degrades
 * (cache misses -> live runs; state writes warn) rather than taking the whole
 * mentor down with it.
 */
export async function ensureCompsTables(supabase: SupabaseClient): Promise<boolean> {
  let ok = true;
  const tables: ReadonlyArray<{ table: string; sqlFile: string; degradation: string }> = [
    {
      table: 'comps_cache',
      sqlFile: 'sql/add_comps_tables.sql',
      degradation: 'no comps caching (every run bills Apify)',
    },
    {
      table: 'session_state',
      sqlFile: 'sql/add_comps_tables.sql',
      degradation: 'no ARV pre-fill',
    },
    {
      table: 'comps_detail_cache',
      sqlFile: 'sql/add_comps_detail_cache.sql',
      degradation: 'no detail caching (every lookup re-runs the detail batch)',
    },
  ];
  for (const { table, sqlFile, degradation } of tables) {
    const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(0);
    if (error) {
      ok = false;
      console.warn(
        `[migrate] ${table} table not found. Run ${sqlFile} in the Supabase SQL editor. ` +
          `Comps will work but degrade: ${degradation}.`,
      );
    } else {
      console.log(`[migrate] ${table} table exists`);
    }
  }
  return ok;
}

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
