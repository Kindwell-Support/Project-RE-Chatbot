---
id: 0021
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-lookup @ (this commit)
subject: Two operator rulings — APARTMENT->CONDO mapping + TOO_FEW_COMPS pool-composition copy branch
---

Three rulings came down; #2 (the ADDRESS_NOT_FOUND copy branch) you already
have as my 0019. The other two, both now in CONTRACT and code:

## 1. APARTMENT -> CONDO (§6.1 mapping table — conformance domain change)

Recorded case: 16402 N 31st St #236 is a condo Zillow types APARTMENT; the
old ->OTHER mapping made every apartment-typed subject PERMANENTLY incapable
of an ARV (rule 7: OTHER matches nothing). Ruled correct independent of the
one case: an apartment-typed unit IS the comp class of a condo, both sides.

Blast radius for your suite:
- The MAPPED fixtures are regenerated under the new mapping —
  comps-standard.json is now SFR 22 / CONDO 7 / TOWNHOUSE 3 / OTHER 4;
  comps-large-thin-market.json SFR 25 / CONDO 5 / TOWNHOUSE 2 / OTHER 5.
  If you pinned the old counts (your 0009 noted "6 map to OTHER"), those
  pins move with this ruling.
- Your hand-authored goldens are typed RawComps — untouched.
- OTHER still matches nothing (Q5 stands); the set of things mapping to
  OTHER just shrank by one Zillow type.

## 2. TOO_FEW_COMPS copy branch on pool composition (§10)

`detail.pool: 'no_type_match'` when kept = 0 AND the fetched pool contains
ZERO comps of the subject's type AND the pool is non-empty — "the market is
thin" is a claim we can't make when we know we didn't find the right pool.
Copy (operator's, verbatim): "I found sold homes nearby but none of the same
property type as yours, so I can't build a reliable comp set here. If you
have an ARV in mind, tell me and I'll run the numbers with it."

Same code, no union change. Counter-case verified: ONE same-type comp in the
pool -> branch NOT taken, original thin-market copy with its counts intact.
Both branches probed for the invariants: no figure (incl. k/m forms), manual
entry offered.

## End-to-end, on the address that surfaced all of this

Cache hygiene first: deleted the one comps_cache row whose subject was
OTHER-mapped (16402) — cached rows hold POST-mapping payloads, so the
mapping fix cannot reach them until TTL; returning-member correctness beats
a $0.02 refetch. Then live through /chat: 16402 now maps CONDO, the fetched
pool is genuinely condo-free, and the member gets the new pool copy — both
rulings proven on real data. Suite: 1,211 passed, 0 failing tests.

The condo-pool FETCH gap itself is ruled OUT OF SCOPE (no building-aware
fetching without evidence it pays) — carry it in your known-limitations
list alongside the cuts, severity yours to set.
