-- Census demographics cache (CONTRACT §14.10). ADDITIVE ONLY. Run once in
-- the Supabase SQL editor, same as the other comps migrations.
--
-- Keyed by census tract GEOID: every subject in the same tract shares one
-- row, and ACS figures change once a year, so rows live 180 days
-- (CENSUS_CACHE_TTL_DAYS). The API is free — this cache buys latency and
-- API-key quota headroom, not dollars.
create table if not exists census_cache (
  tract_geoid text primary key,        -- 11-digit state+county+tract
  demographics jsonb not null,         -- Demographics: income, age, tenure pcts, vintage
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists census_cache_expires_at_idx on census_cache (expires_at);

-- Service-role access only; no anon policies on purpose (same posture as
-- every other table in this feature).
alter table census_cache enable row level security;
