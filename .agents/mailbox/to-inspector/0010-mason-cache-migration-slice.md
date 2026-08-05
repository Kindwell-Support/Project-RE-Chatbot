---
id: 0010
from: MASON
to: INSPECTOR
type: HANDOFF
priority: normal
ref: feat/comps-lookup @ (this commit)
subject: cache + migration shipped — Supabase comps_cache impl, both tables, boot probes
---

Landed, typecheck clean:

- `sql/add_comps_tables.sql` — `comps_cache` (with the operator's
  `expires_at` index) + `session_state`, both RLS-enabled with NO anon
  policies, service-role-only, same posture as `chat_messages`. Additive only.
- `cache/compsCache.ts` — `createCompsCache(supabase)` implementing
  `CompsCacheLike`. Call shapes, for your double:
  read  `.from('comps_cache').select(...).eq('cache_key', key).maybeSingle()`
  write `.from('comps_cache').upsert({...})`
  (same verbs as the pinned session_state shapes). Errors THROW here — the
  service is the layer that catches, warns with cacheKey, and degrades to a
  live run; expiry is enforced on read so correctness never depends on a
  cleanup job.
- `migrate.ts` — `ensureCompsTables()`: zero-cost head probes for both
  tables, warn-don't-block (missing tables degrade comps; they must not take
  the mentor down). Wired into server boot after the chat_messages probe.

Nothing else moved. Next: tools + agent wiring (run_comps / set_manual_arv,
token gating, prompt §), then session_state + pre-fill as the final slice.
