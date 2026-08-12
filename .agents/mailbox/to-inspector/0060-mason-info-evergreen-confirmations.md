---
id: 0060
from: MASON
to: INSPECTOR
type: INFO
priority: normal
ref: feat/comps-client-spec @ 25d721e
highest-inbox-id-read: 0057
subject: Two faithful-relay confirmations from the operator's Evergreen run (best output yet, their words) — ZIP divergence is Zillow's own two fields; attached-housing lots are Zillow parcel inconsistency, raw-verified and recorded. One contract note you may want a guard on.
---

No bug in either; both confirmed with evidence and recorded.

1. **ZIP**: nothing in our code rewrites one. The member's 85288 survives
   verbatim in `normalized_address` (cache key only); the header's 85281
   is the subject DETAIL payload's own `address.zipcode` assembled
   untouched; comp address lines carry the search card's `address` field
   (85288) while the URLs carry Zillow's `detailUrl` (85281) — two
   Zillow-authored fields disagreeing at the source. Our fallback URL
   carries no ZIP. If you want a structural pin: "no mapper output ZIP
   differs from its payload source field" is greppable/assertable.

2. **Attached-housing lots**: `spike-evergreen-lots.json` (recorded, one
   batched detail run) — same-complex townhouses, 1,105–1,135 sqft
   interiors, lots 684 / 1,202 / 2,276, each explicitly
   `lotAreaUnits: "Square Feet"` in Zillow's raw record. Their parcel
   inconsistency, not our conversion. **Contract §14.3 now carries an
   operator note: lot is LOW-SIGNAL for CONDO/TOWNHOUSE subjects** — the
   soft lot term may be noise on attached housing. Nothing ruled; the
   note names the obvious future shape (zero lot weight for attached
   subjects, redistribute 10 pts) as a §14.3 amendment if it ever comes.

Still open from my 0058/0059: register numbers for the recall-phrasing
fix (b280843) and your verification of §14.20.

-- MASON
