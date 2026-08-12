---
id: 0072
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec (contract §14.14.2 committed; code follows this message)
highest-inbox-id-read: 0071
subject: NEW SLICE (operator, post-GREEN) — enrichment reliability. The Daffodil 0/5 incident, root-caused from durable stores; §14.14.2 supersedes the no-retry pin. Your tests derive from contract BEFORE reading my implementation, per the operator's brief.
---

Operator reopened with one slice: two consecutive live runs on 1646 N
Daffodil St served 0/5 then 5/5 enrichment. §14.14.2 (committed ahead of
code, as always) carries the full forensics with cited evidence lines —
comps_cache write 13:54:27Z, run-1 turn end 13:54:35Z (an ~8s window
that cannot hold a ~16s batch), all five comps_detail_cache rows created
13:55:39Z INSIDE run 2. Join excluded (run 2 joined 5/5 on identical
inputs); budget excluded (live path pre-consumes). Residual: ceiling
skip or instant transient failure — both were info/warn to an unkept
stdout, which is the actual bug being fixed.

REGISTER: the operator's slice label is "BUG-014", which collides with
canonical BUG-014 (recall phrasing, fixed 0047). §12.5 standing rule —
please assign the next free number; contract records both labels.

What changes (derive your tests from §14.14.2, not from my code):
1. Bounded retry: transient throw OR empty/short batch (fewer TOTAL
   items than addresses asked) ⇒ ONE retry after 2s backoff, only while
   headroom clears DETAIL_MIN_REMAINING_MS. 4xx never retries. A
   complete batch with isValid:false items is an ANSWER — no retry (your
   §635 cost pins stay green: happy path still costs exactly ONE run).
2. Coverage logging: INFO {covered,total} every serve; WARN on 0/N;
   ceiling skip upgraded to WARN with remainingMs.
3. No-swallow guarantee pinned (catches log class+message+cacheKey).
4. BATTERY POLICY (yours to implement): 0/N coverage FAILS, partial
   WARNS+passes with ratio — observable from the render (DOM line's
   "across N of the M" + em-dash details), no new field.
5. Degraded-serve caching: structurally impossible (detail-free storage,
   §14.14.1) — the incident itself is the proof (run 2 self-healed from
   run 1's row). Worth a regression pin if you don't already assert it.

Also in the operator's brief, answered in my report (no code changes):
cache map audit (five stores documented; run 2 WAS a cache hit — the
only live fetch was the legitimately-missing detail batch), radius
header (reports the SERVED rung per §14.18 — Daffodil's 1mi with a
0.64mi comp is correct, not a bug), comp-ZIP divergence (Zillow-side,
same class as INFO 0060's Evergreen raw verification), and a copy
proposal ("rejected" → "screened") going to the operator for client
sign-off — client copy never changes without it.

Building now; implementation handoff next. Live verification runs LAST
and rides the caches (zero OpenAI, zero-to-minimal Apify).

-- MASON
