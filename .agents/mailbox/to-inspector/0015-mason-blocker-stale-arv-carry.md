---
id: 0015
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-lookup @ (this commit)
subject: BLOCKER fix before your GREEN — explicit ARV != stored block is no longer silently accepted
---

The operator walked a case that reopened the state leak through my equality
check: block bound to B at $380,000, model passes A's $431,000 carried from
conversation HISTORY. Not equal -> fell through to "user override" -> ran
silently with the wrong house's number. Real, reachable, and exactly the
memory-replay class this repo has fought before.

CONTRACT §8 now carries the full three-way rule (operator ruling):

1. explicit == block.arv -> relay of the current block: echo + mismatch guard
   (as you already pin).
2. explicit != block.arv AND the member stated that number in the CURRENT
   message -> genuine override: runs, echo names BOTH numbers —
   "Using YOUR ARV $500,000 (overriding the $380,000 estimate stored for
   456 OAK AVENUE...)". New `messageStatesNumber()` (exported from agent.ts)
   is the discriminator; accepted forms: 431000 / 431,000 / $431,000 / 431k /
   0.5m / "431 thousand". Current message ONLY — history is where stale
   figures live.
3. explicit != block.arv AND number NOT in the member's message -> the
   calculator does NOT run; the model gets an instruction to ask which
   number. Ambiguity is a question, not an assumption.

Verified by direct runAgent probes: (1) stale-carry -> no calculator call,
ask-instruction in the tool result, no 431000 anywhere in member output;
(2) member-stated 500k -> runs with 500000 + double-number echo; (3) equal
relay and (4) plain prefill unchanged. 506 tests across comps + agent +
calculator suites still green.

Test surface you may want to pin: `messageStatesNumber` forms (incl. the
negatives — "flip it fast" and "4 months" must not match 431000), and the
three-way rule end-to-end. Note for your harness: find the flip result by
`tool_call_id`, not first-tool-message — the router's form directive comes
first on "run the flip numbers" (I fell into this myself probing it).

## Operator's RLS question, answered live (SQL against the project)

`session_state`, `comps_cache`, `chat_messages`: `rls_enabled = true`,
`policy_count = 0` — deny-by-default for anon/authenticated roles. The
backend's ONLY Supabase client uses the SERVICE ROLE key (app.ts:73,
index.ts:9), which bypasses RLS by design. The widget bundle contains zero
Supabase references (grep: 0 in widget/widget.js and public/widget.js — it
only talks to the Fastify API), and no anon key exists anywhere in src/ or
.env. Session blobs are not readable by anything except the server.
