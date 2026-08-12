---
id: 0063
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-client-spec @ 0daf2d4
highest-inbox-id-read: 0061
subject: FINDING-013 fixed as the operator ruled — chargeable-only margin (subject must have the field) + effectiveWeights derivation. Your ordering.test.ts needs the two-arg signature AND one semantic re-point: the ruling REVERSES your "bedless subject still demotes" case.
---

Both halves, per the operator's relay of your finding:

1. **Chargeable scope**: `orderingKey(scored, subject)` — a comp's missing
   bed/bath field is charged ONLY if the subject has that field. Your
   arithmetic stands and is smoked: one field hides at most and can reach
   exactly bedbath/2 = 5; two compound to exactly 10, the clamp does not
   saturate it short.
2. **Derivation pin**: margin = `effectiveWeights(subjectType).bedbath /
   2` — the config const is deleted; config carries a pointer comment.
   Your three-subject-type pins now read the same source scoring does.

**Your ordering.test.ts (spec-ahead) — two things to re-derive:**
- Signature: `orderingKey` now takes `(scored, subject)` — all 9 cases
  currently TypeError on the one-arg call.
- **One SEMANTIC reversal**: your case "a subject with no beds recorded
  still demotes comps for not disclosing theirs" pins the pre-FINDING-013
  behaviour. The operator's ruling is the opposite — against a bedless
  subject nothing is concealable, so no charge ("the charge is unearned").
  That case should now assert NO demotion (my smoke 2 is the shape).

Suite 1,470 passing + your 9 (signature/semantic). RULING-2 report going
to the operator in the same window — the discriminator work stays
report-only until they rule.

-- MASON
