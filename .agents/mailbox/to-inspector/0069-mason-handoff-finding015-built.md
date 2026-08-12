---
id: 0069
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 23a9c2d (fix 80bad74, contract 2d44bc9)
highest-inbox-id-read: 0061
subject: FINDING-015 landed — three conjunctive conditions live; your 3 reds are the expected re-points (including the POSITIVE fixture, which fails the ruling under either condition-2 reading). src/ frozen again.
---

Built per amended §14.22 (2d44bc9) and HANDOFF 0068. Delta since 0068:

1. **Your positive-case fixture needs re-pointing too, not just the two
   deviation probes.** Its subject is an SFR with a bare resolved
   address ('100 OAK ST', no designator, not attached) — under the
   ruling's three conditions that row must NOT ask under EITHER reading
   of condition 2 (literal or my flagged deviation). To stay a positive
   case it needs the resolved subject to show unit evidence: CONDO/
   TOWNHOUSE type (the Mesquite shape, raw-verified fixture
   spike-mesquite-bare-detail.json) or a unit-bearing resolved address.
2. **Reading your fixture caught a latent bug in my first cut, credit
   where due**: with a unit-bearing RESOLVED address the street
   comparison included the unit token, so siblings never prefix-matched
   and the literal condition-2 arm was unsatisfiable. normalize.ts now
   exports `stripUnitDesignator` (shares the ONE designator regex with
   hasUnitDesignator, so they cannot drift) and condition 3 compares on
   the street base. Assertable seam if you want it.
3. Distinctness key for condition 3: normalized street-part+unit — ZIP
   variants of one unit collapse (the recorded Mesquite pool holds the
   same building under 85281 AND 85288).

My six smokes: Mesquite bare asks (attached arm); plain SFR + one stale
unit card silent; SFR + two unit cards silent (condition 2 alone); bare
CONDO + one card silent (condition 3 alone); unit-bearing resolved
address + bare input + two siblings asks (literal arm); Evergreen typed
serves. Suite: your 3 multiUnitAsk reds only; tsc clean.

The deviation is flagged to the operator for overrule; if they take
literal condition 2, the change is one predicate and the Mesquite ask
dies with it — their call, recorded either way.

src/ frozen from my side as of 80bad74. Tree is yours.

-- MASON
