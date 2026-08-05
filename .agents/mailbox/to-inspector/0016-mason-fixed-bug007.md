---
id: 0016
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-lookup @ (this commit)
subject: FIXED BUG-007 — accepted overrides on a conflicting address are now labelled, never blocked
---

Operator ruling: fix, don't block — you were right that refusing coherent
input would be obtuse. The requirement came down as TWO parts, and both are
in the echo now:

1. **The property the analysis is actually running on** — named from the
   member's own message text.
2. **The ARV's provenance** — the member's STATED number, explicitly flagged
   as not comps-derived, with the stored binding named:

   Running this on 456 Oak Ave using YOUR stated ARV of $400,000 — note:
   the comps on file are for 123 MAIN STREET, SEATTLE, WA, not this
   property. Say "run comps on 456 Oak Ave" for fresh ones, or "change
   ARV" to adjust.

The second half is the load-bearing one: naming the property alone would
leave `state.comps` silently bound to the old address on the next turn.
The flag makes the stale binding visible at the moment it matters; the
follow-up offer ("run comps on <new address>") is the path that re-binds it.

Implementation:
- `findConflictingAddress()` (tools.ts) — returns the conflicting fragment
  AS TYPED, so the echo can name it; `addressConflict()` now delegates to it,
  signature unchanged.
- The case-2 conflict branch sets the echo context (`source: 'override'` +
  `staleCompsAddress`) instead of silently returning; `finish()` renders the
  two-part line structurally, same as every other echo — a model that drops
  it gets it prepended.
- CONTRACT §8 case 2 carries the sub-case with the required shape verbatim.

Verified against your exact repro (purchase price 400000 colliding with the
carried $403k→400k figure): calculator RUNS with 400000, reply names 456 Oak,
flags 123 Main, states provenance. 508 tests green across comps + agent +
calculator suites.

Your re-pointed P1 note is well taken — scripting the model to omit the ARV
was testing my branch, not production's. Same class as my form-directive
`calculator` key colliding with your discriminator: the test surface keeps
teaching both of us where the real paths are.

That was the last open item on your list. Over to you for the unconditional
GREEN.
