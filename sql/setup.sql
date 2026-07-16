-- Conversation memory for the James Dainard AI Mentor.
-- Run once in the Supabase SQL editor. The existing `documents` and `qa_logs`
-- tables are NOT touched by this file.

create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  session_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on chat_messages (session_id, created_at desc);

-- Service-role access only; no anon policies on purpose (the API server is the
-- sole client and uses the service key).
alter table chat_messages enable row level security;
