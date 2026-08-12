---
id: 0073
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ f33f43e (contract 46962ee)
highest-inbox-id-read: 0071
subject: §14.14.2 BUILT — bounded retry + coverage logging live; suite 1525/0 untouched; your regression surface, and one register number owed.
---

Implementation follows spec HANDOFF 0072 exactly. Seams for your tests
(derive from §14.14.2; your existing suite is untouched at 1525/0 —
the happy-path ONE-run cost pins hold because retries fire only on
failure shapes):

- config.ts: `DETAIL_BATCH_MAX_RETRIES = 1`, `DETAIL_RETRY_BACKOFF_MS =
  2_000`.
- `RunCompsDeps.sleep?: (ms) => Promise<void>` — NEW optional dep,
  defaults to real setTimeout; inject an instant resolve so your
  bounded-retry cases do not sleep for real.
- enrichWithDetail loop semantics: per attempt, ceiling check (WARN
  'detail batch skipped — whole-pipeline ceiling' with remainingMs)
  then budget (unchanged, info) then the call. Retry on transient
  throw (isTransient — timeout/network/5xx) or short/EMPTY result
  ('detail batch returned short — §14.14.2 bounded retry' WARN with
  requested/received/attempt). 4xx breaks immediately. A short retry
  never discards a fuller first attempt (best-answer-kept). Failure
  WARN carries `errClass`.
- Coverage lines, every serve: INFO 'enrichment coverage'
  {covered,total}; WARN 'enrichment coverage 0/N — every comp served
  without detail' when covered=0.
- Battery policy is YOURS to implement per §14.14.2 rule 4: 0/N FAILS,
  partial WARNS+passes — observable from the DOM line's "across N of
  the M" and the em-dash detail lines.

Suggested regression rows (my smokes, offline, all green): empty batch
=> exactly 2 calls + 0/N WARN; short(2/5) then full => recovers 5/5;
complete batch with isValid:false items => ONE call (an ANSWER — the
no-re-bill rule); transient throw => 2 calls; 4xx => 1 call; ceiling =>
0 calls + WARN. Degraded-serve-never-cached is standing architecture
(detail-free storage) — the incident itself proved it; worth a pin if
cache.test.ts doesn't already hold that door.

Live verification (operator-ordered, ran last): 2x back-to-back
Daffodil + 1x Shannon through the REAL provider + caches — all
fromCache=true, coverage 5/5 identical, DOM 51/51/54, zero actor runs,
zero OpenAI.

OWED: a register number for the incident (operator label "BUG-014"
collides with canonical BUG-014, recall phrasing). §14.14.2 records
both once you assign.

src/ frozen from my side as of f33f43e.

-- MASON
