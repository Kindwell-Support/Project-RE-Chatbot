-- Multi-chat, Phase 1 (feat/multi-chat).
--
-- chats.id IS the session_id posted to /chat. chat_messages and session_state
-- are already keyed on session_id verbatim, so message history AND comps
-- session context (subject property, ARV pre-fill) isolate per chat by
-- construction — neither table gains a column, and src/agent/ is untouched.
--
-- owner_key stays TEXT and unconstrained by design. Phase 1 writes
-- 'device:<uuid>' (an unguessable client-generated key in localStorage, which
-- preserves today's exposure posture: member_email is client-asserted and
-- 'unknown' on 18.3% of turns, so listing by email would let anyone enumerate
-- another member's chats by guessing an address). Phase 3 REWRITES THESE
-- VALUES IN PLACE to 'email:<verified-addr>' on first successful auth per
-- device — so do not narrow the type and do not add a check constraint.
--
-- No FK from chat_messages: 611 pre-existing orphan session ids predate this
-- table and a foreign key would either reject them or demand a backfill.
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  archived_at timestamptz
);

-- The only listing query: owner's active chats, newest activity first.
-- Partial index — archived rows are excluded from every read path (delete is
-- soft: chat_messages and session_state rows are left intact).
create index if not exists chats_owner_active_idx
  on chats (owner_key, last_message_at desc) where archived_at is null;

-- Phase 1 remediation. Set TRUE only on a row that materialised from a W1
-- legacy adoption — a session that already carried messages when its first
-- chat row was written. It is SERVER-INFERRED (from the pre-turn history
-- length), never client-asserted, because a self-declared flag would simply
-- be omitted by anyone planting a session id.
--
-- PURPOSE CHANGED (operator ruling, N1): all three phases now ship together,
-- so owner_key is 'email:<verified-addr>' from the first write and there is
-- no Phase 3 rewrite pass for this flag to gate. It is now an AUDIT column —
-- the only record of which rows were written over a session that already held
-- a transcript. Kept deliberately: the inference is cheap, and which rows
-- those were is unknowable retroactively.
alter table chats add column if not exists adopted_legacy boolean not null
  default false;

-- Same posture as chat_messages / comps_cache / session_state: RLS on, NO anon
-- policies on purpose. The backend's only Supabase client is the SERVICE ROLE
-- key, which bypasses RLS; the anon key appears nowhere in this path. An anon
-- policy here would make owner_key a client-enforced boundary instead of a
-- server-enforced one.
alter table chats enable row level security;
