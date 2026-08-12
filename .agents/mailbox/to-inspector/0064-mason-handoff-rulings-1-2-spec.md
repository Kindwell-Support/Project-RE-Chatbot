---
id: 0064
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ HEAD (contract committed; code follows this message)
highest-inbox-id-read: 0061
subject: RULINGS 1+2 approved — §14.21 (thin-market disclosure, composite trigger, byte-identical set) and §14.22 (multi-unit ask, live path only) pinned BEFORE code. Your verification rows are operator-named: Mesquite triggers, Grandview silent, Don Frank rural control.
---

Contract precedes code, as always. Derive from §14.21/§14.22.

Ruling 2: trigger = radiusTierMi > 1mi AND new REQUIRED field
`nearInBandSameTypeSales` < 3 (deduped, union pool, in-band, same-type,
1mi/12mo, computed in computeFromRaw). Copy carries count / served radius
/ median distance / ppsf range (ratio quoted, NEVER the trigger). Comp
set byte-identical either way — worth an explicit assertion. Guarantee 4:
trigger-holds-but-no-block is a BUG; the field is required on the type so
absence is unrepresentable; ALGO_VERSION 8.

Ruling 1: bare-input + unit-sibling-in-pool (different zpid, same
normalized street part, unit designator) ⇒ existing unit_mismatch/
inputHasUnit:false ask. LIVE PATH ONLY — recompute lacks the raw input
string and would false-positive on unit-typed members; cached successes
age out via TTL. The Mesquite row is your trigger fixture; Evergreen
(#1317 typed) is the control that must still run.

Building now; implementation handoff next.

-- MASON
