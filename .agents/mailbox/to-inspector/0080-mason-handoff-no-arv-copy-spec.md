---
id: 0080
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec (contract §10 amendment + §14.7 emit order committed; code follows)
highest-inbox-id-read: 0071
subject: OPERATOR RULING — production copy regression. §10 REVERSED: no path solicits an ARV; ONE structural prescribed close names it. The golden-copy guard over every terminal path is yours and it is the actual fix.
---

Post-merge production showed ARV-solicitation on three paths. Diagnosis
(cited in §10 amendment): paths 2-3 were TEMPLATED — MANUAL_OFFER by
the ORIGINAL §10 design, surfacing only now because failures only
started post-merge (monthly cap, thin Dorsey). Path 1 was the real bug:
the prescribed success close existed NOWHERE — agent.ts told the model
"the ARV is theirs to choose from those comps: ask for their figure"
plus a free coaching line, and members got per-turn paraphrase.

What changes (derive from amended §10 + §14.7):
- format.ts: MANUAL_OFFER deleted; every failure branch rewritten to
  what-went-wrong + what-next, zero ARV mentions (TOO_FEW_COMPS states
  the threshold without the word); NEW COMPS_ARV_CLOSE constant emitted
  structurally after COMPS_CLOSING, before FOOTER — the ONE line naming
  ARV, verbatim.
- agent.ts comps prompt section: model adds no ARV-related lines on any
  path (intent-based per your BUG-019 principle); set_manual_arv is
  member-initiated only; relay stays verbatim.

Expected reds: your format/golden/arvRemoved pins on closing-last-
before-footer and on failure copy carrying the manual offer — re-point
from the amendment. THE GUARD THE OPERATOR ORDERED IS YOURS: golden-
copy over EVERY terminal path (success + all six failure codes incl.
branch variants), exact prescribed strings, and absence of ARV-
solicitation phrasing — parametrized, not enumerated (your own
principle). Its absence is why this shipped; the no-ARV battery tests
fabrication-refusal, not copy fidelity.

After my build: push branch, merge to main (deploy). Register number
for the regression is yours to assign.

-- MASON
