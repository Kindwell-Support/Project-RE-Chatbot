-- Calculation library: every completed calculator run, filed under the
-- property name the member gave it.
--
-- One row per run — re-running a saved calculation with changes creates a NEW
-- row (the client's history requirement), it never edits the old one. Rows are
-- written by the server only, from the same executeTool path that runs the
-- calculator, so a typed "run a flip on ..." and a form submission are saved
-- identically.
--
-- owner_key is the same identity the chats table uses ('email:<verified>' in
-- production), so a member's library follows them across devices. chat_id is
-- the conversation the run happened in, for "open the chat"; no foreign key,
-- for the same reason chat_messages has none (rows can predate a chats row).
create table if not exists calculations (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  chat_id uuid,
  -- 'comps' = a dated comps snapshot, filed by address (client ruling). An
  -- existing table gets it from sql/calculations_add_comps.sql.
  calculator text not null check (calculator in ('flip', 'brrrr', 'land_purchase', 'comps')),
  property_name text not null check (char_length(property_name) between 1 and 120),
  -- The arguments the calculator ran on (property_name included) — what a
  -- "run again" form is pre-filled from.
  inputs jsonb not null,
  -- The full tool result: inputs_used, defaults_applied, outputs, and the
  -- BRRRR projection / land formula cells. What the library detail view shows.
  result jsonb not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- The library listing: one owner's active entries, newest first.
create index if not exists calculations_owner_active_idx
  on calculations (owner_key, created_at desc) where archived_at is null;

-- Same posture as chats / chat_messages: RLS on, NO anon policies. The backend
-- uses the service role key, which bypasses RLS; nothing client-side ever
-- talks to this table directly.
alter table calculations enable row level security;
