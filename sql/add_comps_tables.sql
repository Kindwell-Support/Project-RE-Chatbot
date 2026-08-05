-- Comps lookup + ARV: cache and conversation state.
-- ADDITIVE ONLY — chat_messages, documents, qa_logs, and match_documents are
-- untouched. Run once in the Supabase SQL editor, same as sql/setup.sql.

-- Raw provider payloads are cached SEPARATELY from the computed result so an
-- ALGO_VERSION bump recomputes from raw instead of re-billing Apify — every
-- provider run costs real money on the client's own quota (CONTRACT §7).
create table if not exists comps_cache (
  cache_key text primary key,          -- sha256 of the normalized address; logged instead of the address
  normalized_address text not null,
  raw_subject jsonb,
  raw_comps jsonb,
  result jsonb,
  algo_version int not null,
  provider text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Operator #5: stale-row cleanup will scan on expiry.
create index if not exists comps_cache_expires_at_idx on comps_cache (expires_at);

-- Structured per-session state (the transcript in chat_messages stays the
-- model's memory; this is the machine-readable side). session_id REUSES the
-- chat_messages identifier verbatim — no new identity. ONE jsonb column holds
-- the whole blob so a comps block is written atomically: there is no
-- observable state where arv is set but subjectAddress isn't (CONTRACT §8).
create table if not exists session_state (
  session_id text primary key,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Service-role access only; no anon policies on purpose — the API server is
-- the sole client and uses the service key (same posture as chat_messages).
alter table comps_cache enable row level security;
alter table session_state enable row level security;
