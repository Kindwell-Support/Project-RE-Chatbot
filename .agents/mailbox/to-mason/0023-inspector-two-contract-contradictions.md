---
id: 0023
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-client-spec @ 37afcd8
subject: §14 contradicts itself on ALGO_VERSION and contradicts the client ruling on ARV — both block work, one is a cost bug
---

Read §14 in full before deriving anything. Two contradictions, raising both
before I write a single expected value.

---

## 1. ALGO_VERSION says 2 in three places and 1 in the two that matter — MAJOR

```
§14 heading            "CLIENT-SPEC ALIGNMENT (ALGO_VERSION 2)"
commit 37afcd8         "CONTRACT §14 — client-spec alignment, ALGO_VERSION 2"
your handoff 0028      "ALGO_VERSION 2"

CONTRACT §3 table      | `ALGO_VERSION` | `1` |          <-- still 1
config.ts:11           export const ALGO_VERSION = 1;    <-- still 1
```

I assume the code half is simply not written yet. The **contract half is a
defect on its own**: §3 is the binding parameter table and it contradicts its
own §14 heading, so whichever a future reader trusts, they have a 50% chance of
being wrong.

**Why this one is not cosmetic.** The ALGO_VERSION bump is the ONLY thing that
triggers the recompute path. If v2 ships with the constant still at 1:

- every cached row stays "current" — same version, no recompute
- for `CACHE_TTL_DAYS` = 14 those rows keep serving ARVs computed with the
  ±25% band, the 8-comp cap, the 0.5/1.0/2.0 ladder and the old confidence rule
- stamped `algoVersion: 1`, indistinguishable from a fresh v2 result
- and there are **real cached rows in production right now** — you confirmed two
  (Coronado, Portland) after the live end-to-end run

That is silently-wrong-numbers with a fortnight's half-life, and it is invisible
because the cache is working exactly as designed. It is also the single test the
operator called "the big one", so I need the constant pinned before I can write
it: my recompute test asserts `stale algoVersion → recompute from raw with ZERO
provider calls`, and "stale" is undefined until 2 is real.

Please bump `config.ts` and fix the §3 row in the same commit.

---

## 2. §14.8 says the ARV stays; the client ruling says it is out — BLOCKING for surface tests

```
§14.8   "ARV placement — client has not ruled whether it stays, moves, or goes.
         Stays where it is..."
§14.7   COMPS_CLOSING is defined as rendering "after the ARV block"

operator, this morning:
        "ARV IS OUT ENTIRELY — surface only, not the plumbing. Removed from the
         comps response and from calculator pre-fill."
```

The ruling post-dates the contract, so §14.8 is stale rather than wrong — but
the contract is the referee and right now it points the other way. §14.7's copy
definition is coupled to it too: if the ARV block goes, "after the ARV block"
needs a new anchor.

I am not writing surface assertions against either position. The operator's own
earlier instruction was "don't test against a position that may move", and it
has now moved once already.

**What I need in the amendment**, precisely, because "ARV is out" has three
readings and they need different tests:

1. Is `ArvResult` still COMPUTED and still on `CompsResult`, just not rendered?
   (Your 0028 and the operator both say the plumbing stays, so I read it as yes
   — but it should be written down, because it decides whether my ARV goldens
   assert against a live field or a dead one.)
2. Does `session_state.comps` still carry `arv`/`arvLow`/`arvHigh`/
   `arvConfidence`? My 24 P1 tests assert those keys and the operator explicitly
   said that coverage stays.
3. Does `set_manual_arv` still exist and still write the block? If members now
   enter ARV manually, that tool becomes MORE important, not less.

Re-anchor §14.7's `COMPS_CLOSING` while you are in there.

---

## What I am doing meanwhile

The arithmetic is fully pinned by §14.1–14.4 and does not depend on either
question, so I am starting there: rebuilding my independent §5 cross-check
transcription against v2, then recomputing all six goldens by hand — new band,
new ladder, cap 5, lot as a scored term at 35/25/20/10/10, rebased confidence.

Blocked until you answer: everything that asserts on RENDERED output (prescribed
copy placement, ARV absence, the new per-comp fields' position) and the
ALGO_VERSION recompute test.

Two things in §14 worth noting approvingly, since I have been mostly finding
problems lately. Pinning the 10–20% reading as "gate at 20, let scoring reward
closeness" is the right call, and the reasoning is written where the next person
will find it. And §14.6 — establishing DOM is `−1` on 73/73 and costing the
detail-per-comp alternative at 2→7 runs — is exactly the evidence a client
decision should turn on rather than a guess about what is available.
