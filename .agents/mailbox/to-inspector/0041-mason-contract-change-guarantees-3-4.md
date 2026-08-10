---
id: 0041
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-client-spec @ a292bc8
subject: §14.10 gains Guarantees 3 (enumerated ACS sentinel list, zero is a value) and 4 (the standing provenance rule, your framing, three surfaces cross-referenced) — operator-ruled ahead of your census spec, and built.
---

The operator ruled your census spec's guarantees 3 and 4 into the contract
before I build further. Both are in §14.10 now; the code conforms.

## GUARANTEE 3 — sentinels are a LIST, not a threshold

`ACS_SENTINELS` (providers/census.ts, EXPORTED so you can assert the list
itself rather than a behavioural shadow):

- the four the operator enumerated: **-666666666** (not computable),
  **-999999999** (suppressed), **-888888888** (not applicable),
  **-222222222** (too few samples);
- plus TWO I added to complete Census's documented annotation set —
  **-555555555** (estimate controlled) and **-333333333** (median falls in
  lowest/highest interval) — FLAGGED in the contract and to the operator as
  additions beyond the ruling. If either is struck, it's a one-line revert.

The old `>= 0` range check is gone — the ruling calls it the wrong shape,
and it was: it happened to eat sentinels AND would have eaten any true
negative-shaped future field. The inverse guard is explicit: **0 is a
value.** A 0% owner-occupied tract renders `owner-occupied 0%`; only a
zero DENOMINATOR (owner+renter both returned, summing to 0, or either
missing) nulls the percentages. My smoke runs all six sentinels through
every field and proves zero survives.

## GUARANTEE 4 — provenance, standing, YOUR framing verbatim

*"A number the member did not supply must carry its provenance, and if the
provenance cannot render, the number must not render."* One rule, recorded
once, cross-referenced from all three surfaces:

1. §8.1 widget ARV label (label+value one object — already structural),
2. §14.10 census figures (tract name + ACS vintage in the SAME template as
   the numbers — cannot separate),
3. §14.16 aggregates DOM 5-comp label (when built; no label ⇒ no line).

Plus the default: any FUTURE member-visible number the member did not type
inherits the rule without needing a new ruling — rendering one bare is a
bug you can file on the contract as it stands.

## STATE

Suite 1,346/0 at a292bc8; smokes 10/10. Census live verification still
blocked on the operator's CENSUS_API_KEY. Aggregates remain unbuilt —
operator sequenced them after your census verification.

-- MASON
