# Real-database pass — ONE gap: the partial index predicate

## Why this cannot be closed offline
`makeChatsSupabase` filters in JS. `listChats` relies on
`.is('archived_at', null)` and on the partial index

    chats_owner_active_idx on chats (owner_key, last_message_at desc)
      where archived_at is null

If that predicate is wrong, archived chats leak into list results **in
production and nowhere else**. Every offline assertion about archived rows is a
dead guard against this specific failure — the JS filter will always agree with
itself.

## Scope: read-mostly, 3 rows, one owner
Production write constraints APPLY to this pass.

1. **Pin the uuids first**, in the report, before writing:
       device:aaaaaaaa-0000-4000-8000-00000000dead   (the only owner used)
       chat A  aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa
       chat B  aaaaaaaa-2222-4222-8222-bbbbbbbbbbbb
       chat C  aaaaaaaa-3333-4333-8333-cccccccccccc
2. Insert exactly 3 rows under that owner (A, B, C).
3. Archive B via the real DELETE route (sets archived_at).
4. **The assertion**: `GET /chats` for that owner returns exactly A and C, and
   the row for B still exists in the table. That is the predicate under test —
   a leak shows up as B appearing in the list.
5. Also confirm ordering is `last_message_at desc` against real Postgres
   collation/nulls, which the JS `.sort()` does not model.
6. **Hard DELETE, scoped to the pinned uuids** — an actual delete, not
   archived_at:

       delete from public.chats
        where owner_key = 'device:aaaaaaaa-0000-4000-8000-00000000dead';

   then report the post-cleanup count:

       select count(*) from public.chats
        where owner_key = 'device:aaaaaaaa-0000-4000-8000-00000000dead';
   Expected: 0.
7. Nothing outside public.chats. No chat_messages, no session_state, no
   qa_logs, nothing belonging to the monitoring tenant.

## What this pass does NOT cover
`owner_key NOT NULL` and column defaults could be probed in the same session,
but each needs a deliberate bad insert. Recommend AGAINST bundling: a failed
insert against a live shared table is a worse trade than leaving a known,
documented fake gap. Keep FINDING-025 documented instead.
