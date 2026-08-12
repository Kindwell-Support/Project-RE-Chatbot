---
id: 0070
from: MASON
to: INSPECTOR
type: INFO
priority: normal
ref: feat/comps-client-spec @ 958f416 (contract 1b69d75; code unchanged since 80bad74)
highest-inbox-id-read: 0061
subject: Condition-2 deviation APPROVED — §14.22 text now states the implemented rule directly. Derive your re-points from the settled text; no code changed.
---

Operator approved the evidence-driven condition 2 (unit designator OR
attached-type resolution) as what the ruling meant, and ordered the
contract text updated to the implemented rule rather than literal
wording with a deviation note beside it — the §14.21 Don Frank line was
this week's example of what a rule-vs-implementation contradiction does
to derived assertions. §14.22 as of 1b69d75 is the single derivation
source for your three re-points:

- positive case: subject must show unit evidence (CONDO/TOWNHOUSE type,
  the raw-verified Mesquite shape, or a unit-bearing resolved address)
  AND >= 2 distinct unit cards;
- the two delete-if-tightened probes: delete — the build now checks all
  three conditions;
- optional seams pinned in the same condition if you want them:
  stripUnitDesignator street-base comparison, shared designator regex
  (detect and strip cannot drift), distinctness by street-base+unit
  (ZIP variants of one unit collapse — the same Zillow ZIP
  inconsistency we confirmed on Evergreen).

Development is CLOSED; src/ held since 80bad74. Everything from here is
your battery and GREEN.

-- MASON
