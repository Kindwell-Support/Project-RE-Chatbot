---
id: 0065
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 3f71353 (contract at 542abc7)
highest-inbox-id-read: 0061
subject: RULINGS 1+2 BUILT — §14.21 disclosure + §14.22 multi-unit ask, ALGO_VERSION 8. Operator-named rows verified on my side; one §14.5 catch worth a regression pin.
---

Build follows spec HANDOFF 0064 exactly. Seams you'll test against:

§14.21 (thin-market disclosure):
- `CompsResult.nearInBandSameTypeSales: number` — REQUIRED, after
  `nearRingCompleteMi` in types.ts. Computed in `computeFromRaw` over the
  UNION pool: `dedupeSales` kept count of SOLD, in-window (12mo), same
  mapped type, in-sqft-band, within `NEIGHBORHOOD_RADIUS_MI` of subject.
- `renderThinMarketDisclosure(result)` in format.ts (module-private; assert
  via `renderCompsForChat` output). Trigger: `radiusTierMi >
  NEIGHBORHOOD_RADIUS_MI && nearInBandSameTypeSales < MIN_COMPS_TO_COMPUTE`.
  Emits between the comps table and the neighbourhood section. Copy line
  starts `_A note on this set: only N comparable sale(s)…` and carries
  count / served radius / median comp distance (filter.ts `median`) / ppsf
  range. Ratio never triggers anything.
- ALGO_VERSION = 8 in config.ts (recompute-from-raw works; refetch floor
  unchanged at 4).

§14.22 (multi-unit ask):
- service.ts live path, after hood acquisition, before computeFromRaw:
  bare input (no unit designator) + union-pool sibling with different
  zpid, same normalized street part, and a unit designator ⇒ existing
  `ADDRESS_NOT_FOUND` / `resolution: 'unit_mismatch'` / `inputHasUnit:
  false` ask. LIVE PATH ONLY (recompute lacks the raw input string).
- The ask is cached with `rawSubject: null, rawComps: [],
  rawNeighborhood: null` — deliberate, worth an assertion: caching it
  WITH raws would let a future ALGO bump recompute the ask into a silent
  success. Bumps must refetch and re-run detection instead.

My verification on the operator's matrix (cached rows, fake provider,
row-created_at clock): Mesquite bare → ask; Mesquite unit-typed →
disclosure fires (rung 3mi, count 2, median 1.86mi, $138–$276 range as
rendered fact); Grandview silent (rung 1mi, count 47); Don Frank rural
control silent (rung 3mi — signal 1 true, count ≥ 3 holds signal 2);
Evergreen #1317-typed serves with no ask, no disclosure (rung 1mi, 53).

Byte-identical constraint verified structurally: rendered the Mesquite
result with the trigger live and with the count forced high — the diff
is EXACTLY the one disclosure line, nothing else moves.

REGRESSION PIN WORTH TAKING: that same check caught my first copy draft
using an em dash as punctuation ("…per square foot — weigh…") — a §14.5
violation, now a semicolon. A test asserting the DISCLOSURE LINE ITSELF
contains no U+2014 would hold the door; §14.5's null-marker exclusivity
is exactly the kind of rule a future copy edit re-breaks.

Suite at HEAD: 1500 passed / 39 skipped, tsc clean — including your
re-pointed ordering.test.ts and fakes.ts edits sitting uncommitted in
the tree (yours to commit; I touched src/** only).

-- MASON
