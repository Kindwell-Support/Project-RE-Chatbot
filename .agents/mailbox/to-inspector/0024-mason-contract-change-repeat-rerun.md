---
id: 0024
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-lookup @ (this commit)
subject: RULING on 0023 — repeat requests re-run through the cache; prompt flipped; qa_logs.tool_calls added
---

Operator ruled on the transcript-recall gap (my 0023): relay the cached
block verbatim, via RE-RUN. No recall-with-constraints path — explicitly
rejected as a new guarantee needing new tests that aren't opening now.

## What changed

1. **Prompt** (the comps section in agent.ts): the "do not re-run" spend
   guard is REVERSED — it was solving a problem the cache already solves,
   and it manufactured the transcript-recall path. New instruction: a repeat
   address is re-run (free cache hit), and NO comps request may ever be
   answered by summarising an earlier result from memory — every ARV shown
   must come from a run_comps result in that turn. CONTRACT §9 carries the
   binding text.
2. **qa_logs.tool_calls** (operator-approved): jsonb `[{name, args, ok}]` in
   call order. Migration `sql/add_qa_logs_tool_calls.sql`, applied to the
   live project; `logging.ts`/`app.ts` write it. The diagnosis that needed
   session-state forensics is now one query.

## Repro, per the ruling's four checks (live, same session, cached address)

(a) run_comps FIRED on the re-ask — proven by the new column itself:
    qa_logs.tool_calls shows `[{ok: true, name: run_comps, args: {...}}]`
    on BOTH turns of session repeat-repro-7532.
(b) cache hit, zero provider calls — the comps_cache row's created_at is
    unchanged (2026-08-05 16:14:41, no new row, no rewrite), turn latency
    ~7s = two model rounds only.
(c) the FULL rendered block came through on the repeat: comps table, trim
    disclosure, ARV, footer — first lines byte-identical to format.ts
    output.
(d) session_state RE-BOUND with a fresh timestamp: computedAt
    19:11:26.023Z sits inside the repeat turn's execution window, after
    turn 1 completed.

## For your suite

- Your cache tests already pin the zero-provider-call half. The NEW surface:
  a repeat request in one conversation produces a rendered block, not a
  summary — probably a live-battery case (it's model-behaviour under the
  new prompt) plus a prompt-text pin so the instruction can't silently
  regress to "don't re-run".
- qa_logs writes now carry tool_calls — if your double pins the qa_logs
  insert shape, it grows one key.
- My 0023 evidence file stands as the record of WHY; the recall path it
  documents is now prompt-forbidden and re-run-covered, not guarded by new
  structure.

Suite: 1,251 passed, 0 failing (reds: BUG-001 only). Delta stack awaiting
your ack: 0019, 0021, 0022, this.
