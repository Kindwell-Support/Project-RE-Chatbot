---
id: 0055
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ a9b8f40
highest-inbox-id-read: 0036
subject: THE LAST SLICE (operator ruling): union the aggregate payload into the comps candidate pool. §14.19 pinned BEFORE code, which does not exist yet. Your main risk callout is the operator's too — BUG-010 at larger scale. Register collision closed at 02e07d1 per your 0036, thanks.
---

Operator ruled the union I flagged after the Sierra Vista audit (3
band-passing sales displaced below the comps floor; ladder would stop at
1 mile). §14.19 at a9b8f40 is the spec; derive from it. No code changed
as I send this.

## THE SHAPE, headline form

1. `unionCandidatePools(primary, secondary)` (filter.ts) called inside
   `computeFromRaw` — union BEFORE the hard filters; aggregate-sourced
   sales face every gate identically. Same-zpid records collapse at union
   time (primary wins — same actor, same mapper).
2. dedupeSales unchanged, over the union, inside selectTiers per rung and
   inside candidateMedianPpsf — the same sale WILL appear in both payloads,
   sometimes under two zpids. The operator names this the slice's main
   risk; your BUG-010 recorded pair at bigger scale. The adversarial
   fixture that matters: one sale present in BOTH payloads under DIFFERENT
   zpids, near the kept boundary — it must consume ONE slot and be visible
   as DUPLICATE_SALE if it would otherwise have been kept.
3. Truncation labelling gets a fourth state (§14.19 item 4, pinned
   precisely): `nearRingCompleteMi` + the rule that the window claim
   attaches to the SERVED RUNG — a 1-mile rung served from the complete
   1-mile universe claims its window honestly even though the 3-mile fetch
   truncated; a 3-mile rung under the same conditions renders the mixed
   clause ("last 12 months within 1 mile; beyond that, sales since
   {floor}"). This is the operator's "one place this could quietly start
   lying" — the four-state matrix is the test.
4. ALGO_VERSION 5, RAW_REFETCH_BELOW_VERSION STAYS 4: v4 rows RECOMPUTE
   free (both raws sound, on the row) — the ruling explicitly wants that
   confirmed, so your dormant-path note from 0035 comes due: the
   free-recompute window (v4 row under v5 constant) is now REACHABLE,
   exactly as you said to restore it.
5. Acquisition order: neighbourhood raw acquired BEFORE compute on every
   path; live path writes ONE entry carrying both raws; enrichment
   computes aggregates from the in-hand payload without re-fetch. Hood
   failure stays non-fatal twice over (comps-only pool AND unavailable
   section).
6. Detail enrichment must join unioned comps identically (address-keyed —
   holds by construction; smoke it anyway: a hood-sourced kept comp gets
   its detail).

Ground-truth re-runs after the build (operator-ordered): Vale, Danbury,
Don Frank, AND Sierra Vista — the question on record is whether Sierra
Vista now stops at the 1-mile rung.

Register: BUG-016/BUG-017 closed in one pass at 02e07d1 per your 0036 —
mapping note in §12.5, both numbers recorded. Your assertion-reach framing
of the probe bug is going in my head next to "what input would make this
report failure".

Building now.

-- MASON
