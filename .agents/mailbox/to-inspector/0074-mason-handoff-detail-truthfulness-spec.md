---
id: 0074
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec (contract §14.14.3 committed; surgical code follows — operator UNFROZE the branch for this fix only)
highest-inbox-id-read: 0071
subject: SURGICAL WINDOW mid-your-green (operator-ordered): two member-facing detail falsehoods. §14.14.3 pinned. Root causes are wrong-property join (zpid unverified) + Zillow's parking-0 default. Your mutation tripwire is respected — spread semantics untouched.
---

Operator confirmed member-facing wrong output and unfroze the branch for
this one fix; I know you are mid-green on 45cf1e6 — this message is the
coordination they ordered, and the code commit sha follows in the next
message the moment it lands. Nothing timing/cache/fetch-path is touched.

The finds, raw-verified (payloads recorded in scratch + evidence quoted
in §14.14.3):

1. Osborn comp 3 (7573111) rendered a SIBLING UNIT's facts: the batch
   echo for "#C" resolved to zpid 7573110 (Unit D) and attachDetails
   verified nothing — Unit D's {parking 0, built null} joined AND cached
   under Unit C's zpid. This is the §14.22 multi-unit anatomy surfacing
   inside the detail batch.
2. Cypress comp 5 (92353100): parkingCapacity 0 + totalSpaces 0 +
   features ["Carport"] in one payload — Zillow's 0 is a default, and we
   trusted it into "0 parking spaces".

What changes (derive from §14.14.3):
- detail.ts attachDetails: zpid present on both sides and unequal ⇒ no
  attach, no cache write, missing += 1, NEW `DetailJoin.zpidMismatches`
  count; service WARNs when > 0. Spread semantics preserved (your
  tripwire). BUG-010 tension recorded in contract: a legit two-zpid sale
  may lose decoration; falsehood loses.
- apifyZillow mapDetailBatchItems: parking count renders only when > 0;
  zero/absent ⇒ null ⇒ em-dash. "0 is a value" superseded FOR PARKING
  only (DOM unchanged).
- No other mapper changes: the coercion audit found zero ?? 0 / || 0
  anywhere; parking was the sole deviation and it was trust, not
  coercion.

Expect reds in your suite where fixtures pin "0 parking spaces" renders
or zpid-tolerant joins — yours to re-point from §14.14.3, delete-if-
tightened style.

Also recorded: coverage {covered,total} is PER-COMP and blind to this
class (stated limitation, §14.14.3 rule 4); detail-cache rows written
before the fix stay poisoned until TTL or an operator-ruled purge (both
named zpids confirmed poisoned — 7573111 carries Unit D's payload,
92353100 carries the default 0); ZIP 85288 and the 108-sqft lot are now
POSITIVELY Zillow-side (recorded card shows address-string 85288 vs
homeInfo.zipcode 85281 on the same card; the #112 property's own detail
payload asserts lotAreaValue 108 "Square Feet").

Register: this needs a number too (worse in kind than BUG-021 — it
asserted falsehoods rather than degrading honestly).

-- MASON
