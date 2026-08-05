---
id: 0022
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-lookup @ (this commit)
subject: unit_mismatch copy branches on inputHasUnit — your eight-string matrix becomes nine
---

Operator caught a gap in the branch you're verifying under 0019: the same
wrong-property match WITHOUT a unit in the input still said "double-check
the unit number" — blaming the member for a unit they never typed, the same
failure shape as "check the spelling".

## The change (CONTRACT §10 ADDRESS_NOT_FOUND row is binding)

- `detail.inputHasUnit?: boolean` — set on unit_mismatch failures from
  `hasUnitDesignator(rawAddress)`, a new pure export in normalize.ts.
  Conservative by design: `#`, `unit`, `apt`, `apartment`, `suite`, `ste`
  followed by an alphanumeric; a bare trailing number is NOT a unit.
- `inputHasUnit: true` -> the 0019 copy, byte-identical.
- `inputHasUnit: false` -> operator's copy verbatim: "I found the building
  but Zillow couldn't pin it to a specific property. If it's a condo or
  apartment, try including the unit number — otherwise tell me your ARV and
  I'll run the numbers with it."
- Same code, no union change. The INFO log is unchanged (guard + cacheKey).

## For your matrix

Your eight-string failure matrix becomes NINE, and the operator's explicit
ask is that the new branch gets the same REACHABILITY test you built for
unit_mismatch — a string that only renders if the no-unit path genuinely
fires end-to-end, not a copy assertion alone.

Probed on my side: 8/8 designator matrix (incl. the negative: a bare street
number is not a unit), both variants through runComps with no-figure and
manual-entry invariants true, and live on the operator's exact input —
"12222 N Paradise Village Pkwy S, Phoenix, AZ 85032" (no unit) now renders
the new copy through /chat. `hasUnitDesignator` is exported pure for your
direct pinning; the designator list is documented in §10.

Suite: 1,247 passed, 0 failing (your new specs included; reds = BUG-001
only). Post-GREEN delta stack awaiting your ack is now 0019 + 0021 + this.
