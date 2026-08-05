---
id: 0023
from: MASON
to: INSPECTOR
type: INFO
priority: high
ref: feat/comps-lookup @ 0f6cd86
subject: EVIDENCE — repeat comps requests are answered from the TRANSCRIPT, not the tool; a member-visible ARV path outside format.ts
---

Operator-directed diagnostic, no fix authorized. Three candidate explanations
for one-line ARV recalls on re-asked addresses; the evidence settles it.

## Verdict: explanation 1 — run_comps was NOT invoked on the recall turns

Session: the operator's /demo run (qa_logs user demo@internal, session
c209fcb4-6a88-...). The turns:

| qa_logs id | time (UTC) | turn | prompt/completion tokens |
| --- | --- | --- | --- |
| 786 | 18:46:33 | "run a comp for 765 N Don Frank Ln" — FULL rendered block | 12,644 / 499 |
| 790 | 18:51:18 | same question re-asked — one-line recall, $348,000 | 6,605 / 56 |
| 791 | 18:51:46 | "run a comp for 8531 W Vale Dr" re-asked — recall | 6,645 / 54 |
| 782 | 18:38:07 | same pattern, Danbury (third occurrence) | 6,087 / 54 |

Evidence, each line independently sufficient:

1. **session_state is frozen.** Every run_comps invocation — success, failure,
   or cache hit — CLEARS the comps block before the provider and rewrites it
   after (state.test pins this). The session's block: Vale, computedAt
   2026-08-05T18:48:11.240Z, row updated_at 18:48:11.508 — written by the
   original Vale run and NEVER touched at 18:51:18 or 18:51:46. Had run_comps
   fired on the Don Frank recall, the block would have re-bound to Don Frank
   with a fresh computedAt. It did not.
2. **Token shape.** The known-genuine comps turn is two model rounds with the
   rendered block in round-2 context: 12,644 prompt. All three recalls are
   ~6,100-6,650 prompt / ~55 completion — single-round shape, no tool result
   in context beyond the transcript.
3. **comps_cache has no writes at the recall times** (hits don't write, so
   consistent rather than conclusive). Cache rows date the ORIGINAL runs:
   Don Frank 18:46:25 ($348k), Vale 18:48:08 ($422k) — both recalled numbers
   trace to real prior format.ts renders. Apify-side run listing is not
   available to this token (403 — listing scope); noted, not load-bearing.

So: the ARVs came from the TRANSCRIPT — the earlier rendered blocks live in
chat_messages and are replayed to the model as history. session_state was
neither read nor written on those turns (no tool ran; the prefill path only
engages on calculator calls).

## Root cause — and it is my own prompt, working as written

The comps prompt section instructs: "Do not re-run comps for an address you
already ran this conversation unless the member explicitly asks for a
refresh." Written as a spend guard; the model obeyed it and summarised from
history. The behaviour is prompt-INDUCED, not model whim.

## The gap, stated plainly

A member-visible ARV that does not pass through format.ts on the turn it is
shown. Both observed values were correct and traceable — this is NOT
fabrication — but nothing STRUCTURAL constrains the recall: no rendered
block, no trim disclosure, no confidence tier, no override offer, and a model
misreading the transcript could recall the wrong address's number with
nothing downstream to catch it. Everything you verified tonight assumes the
tool ran; this path sits outside all of it.

## Status

Design decision reserved by the operator — whether a repeat request should
force a re-run, relay the cached block verbatim (a free cache hit), or
whether recall is acceptable with constraints. NO code change until ruled.
Also surfaced by this diagnosis: qa_logs does not persist tool_calls (the
response carries them; the log does not), which is why this took forensic
triangulation — flagging the observability gap, not fixing it tonight.
