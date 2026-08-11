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
/**
 * BUG-016 — the old probe here used `select('*', { head: true, count:
 * 'exact' })`, and a HEAD request CANNOT report a missing table: PostgREST
 * has no response body to carry the error, the status comes back 204, and
 * supabase-js surfaces `error: null`. Measured against the live DB: a
 * table that has never existed probes identically to a real one (204/null
 * vs 206/null). The probe therefore printed "table exists" for every name
 * it was ever asked about, and reported success while three migrations
 * were missing in production — a check that cannot fail is worse than no
 * check.
 *
 * The probe is now a GET (`select(...).limit(0)`), which genuinely
 * discriminates (missing table ⇒ PGRST205/404; missing column ⇒ 42703),
 * and it demands POSITIVE evidence: only an errorless response with an
 * array body counts as "exists". It also probes the COLUMNS that later
 * migrations added to existing tables — a present table with a missing
 * column is the worst failure mode of all, because writes naming that
 * column fail and take the WHOLE row's caching down with them
 * (comps_cache.raw_neighborhood did exactly this: every comps_cache upsert
 * failed, so nothing cached and every lookup billed Apify in full).
 */
export async function ensureCompsTables(supabase: SupabaseClient): Promise<boolean> {
  let ok = true;
  const checks: ReadonlyArray<{ table: string; column?: string; sqlFile: string; degradation: string }> = [
    {
      table: 'comps_cache',
      sqlFile: 'sql/add_comps_tables.sql',
      degradation: 'no comps caching (every run bills Apify)',
    },
    {
      table: 'comps_cache',
      column: 'raw_neighborhood',
      sqlFile: 'sql/add_comps_cache_neighborhood.sql',
      degradation:
        'EVERY comps_cache write fails (the upsert names this column), so NOTHING caches and every lookup bills Apify in full',
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
    {
      table: 'census_cache',
      sqlFile: 'sql/add_census_cache.sql',
      degradation: 'no demographics caching (every lookup re-queries the Census API)',
    },
  ];
  for (const { table, column, sqlFile, degradation } of checks) {
    const target = column ? `${table}.${column}` : table;
    const { data, error } = await supabase.from(table).select(column ?? '*').limit(0);
    // Positive evidence only: no error AND an array body. Anything else —
    // including shapes we did not anticipate — reports as NOT VERIFIED, so
    // this check can never silently pass again.
    if (!error && Array.isArray(data)) {
      console.log(`[migrate] ${target} verified`);
      continue;
    }
    ok = false;
    const detail = error ? `${error.code ?? ''} ${error.message ?? ''}`.trim() : `unexpected response shape`;
    console.warn(
      `[migrate] ${target} NOT VERIFIED (${detail}). Run ${sqlFile} in the Supabase SQL editor. ` +
        `Until then: ${degradation}.`,
    );
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
