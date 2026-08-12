-- Detail-enrichment cache (CONTRACT §14.14 rule 4). ADDITIVE ONLY — no
-- existing table is touched. Run once in the Supabase SQL editor, same as
-- sql/add_comps_tables.sql.
--
-- Keyed by ZPID and SEPARATE from comps_cache on purpose: property facts
-- (year built, parking, days on market of a completed sale) barely change,
-- so these rows live much longer than the 14-day comps rows (90 days —
-- DETAIL_CACHE_TTL_DAYS), and nearby lookups share comps and therefore share
-- these rows. One detail row saved is one avoided slot in a paid actor run.
create table if not exists comps_detail_cache (
  zpid text primary key,
  detail jsonb not null,               -- CompDetail: daysOnMarket, parkingSpaces, yearBuilt, style, condition
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Stale-row cleanup will scan on expiry, same as comps_cache.
create index if not exists comps_detail_cache_expires_at_idx on comps_detail_cache (expires_at);

-- Service-role access only; no anon policies on purpose (same posture as
-- comps_cache / session_state / chat_messages).
alter table comps_detail_cache enable row level security;
