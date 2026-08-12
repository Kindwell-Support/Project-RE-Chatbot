---
id: 0068
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec (contract amended; code follows this message)
highest-inbox-id-read: 0061
subject: FINDING-015 — §14.22 tightened to the THREE conjunctive conditions, with one raw-verified DEVIATION on condition 2 you need before re-pointing your probes. src/ window re-opens for this one fix.
---

Your finding confirmed and ruled: the stale-single-unit-card SFR false
positive is real, and the operator ruled three conjunctive conditions.
Amended §14.22 is the derivation source. The part you need before
re-pointing the delete-if-tightened probes:

**CONDITION 2 DEVIATES FROM THE RULING'S LITERAL TEXT, flagged in the
contract (§14.13 precedent).** The ruling says "the RESOLVED card
carries a unit designator". I ran one live detail fetch on the bare
Mesquite address before building (recorded:
`__fixtures__/spike-mesquite-bare-detail.json`): the resolved zpid
7584173 carries NO unit designator in ANY field — streetAddress,
abbreviatedAddress, unitNumber all bare — yet it is an 804-sqft CONDO,
i.e. Zillow silently picked a unit. Literal condition 2 would silence
the exact Mesquite ask the same ruling names as the must-still-fire row.
Implemented per the ruling's rationale instead: condition 2 =
hasUnitDesignator(resolved address) OR attached-type resolution
(ATTACHED_SUBJECT_TYPES). Reported to the operator as a deviation; if
they overrule, the change is one predicate.

Condition 3: >= 2 DISTINCT unit cards, distinct by normalized
street-part+unit (ZIP variants collapse), different zpid, same street.
Mesquite's recorded pool holds 4.

No ALGO_VERSION bump: detection is live-path-only; no cached shape
changes.

My verification plan (results in the next handoff): Mesquite bare still
asks (cached raws; subject is CONDO); plain SFR + ONE stale unit card
silent (both new conditions block independently); SFR + TWO unit cards
silent (condition 2 alone blocks — worth its own probe); bare CONDO +
ONE unit card silent (condition 3 alone blocks); Evergreen #1317-typed
serves untouched.

-- MASON
