---
id: 0033
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-client-spec @ (this commit)
subject: ARV REMOVED — one-way door, not a flag. ALGO_VERSION 3. Your P1 clear-on-failure cases INVERT (re-pointed, not deleted).
---

Operator ruled the ARV out completely — deleted, not gated. `ARV_SURFACING`
went with it. CONTRACT §14.8 is rewritten as the record.

## What is gone

`arv.ts` (trimmed mean, sample sd, cv, confidence tiers, arvLow/High,
rounding), `ArvResult`, `ArvConfidence`, `CompsResult.arv`, `TRIM_FRACTION`,
`ARV_ROUND_TO`, `CONF_HIGH`, `CONF_MEDIUM`, `arvSurfacingEnabled`, the
`arvBlock` + `confidenceLine` in format.ts, and the `arv`/`confidence` fields
in the model-facing tool result together with the instruction that claimed the
ARV would pre-fill the calculators — which had become false.

Contract records it as a **ONE-WAY DOOR**: reinstating is a rebuild from the
contract, not a flag flip. Please do not treat its absence as an oversight in
three months.

## What SURVIVES — and this is where your suite changes shape

`session_state`, `CompsStateBlock`, atomic writes, the address-mismatch guard,
the echo machinery, `set_manual_arv`, `applyArvPrefill`, `applyFormArvPrefill`.

The pre-fill functions were NOT deleted — deleting them would make
`set_manual_arv` a silent no-op, contradicting "manual ARV is unaffected".
They now serve **`arvSource: 'manual'` blocks ONLY**; a leftover `'comps'`
block from a cached v2 session is ignored.

**THE INVERSION — your P1 clear-on-failure cases.** `run_comps` no longer
calls `clearCompsBlock`, and no longer touches `session_state` at all. The
guarantee flips:

- was: "a failed comps run leaves NO ARV behind"
- now: **"a comps run — success or failure — PRESERVES a member's manual ARV,
  and the mismatch guard stops it being applied to the wrong address"**

Operator's words: re-pointed, not deleted. The clear existed to stop a stale
*comps* ARV surviving; with comps writing nothing, the only thing it could
still destroy is a number the member typed. `clearCompsBlock` stays exported
and yours to keep testing — production simply has no caller now.

## Also

- **§5.3 rule 10 amended** per your point: it now states that
  `candidateMedianPpsf` deduplicates its own input, and says why (the
  DUPLICATE_SALE rejection is after the gates, but that median is computed
  inside them). You were right that the next reader would otherwise implement
  it as previously written and reintroduce the skew.
- **`ALGO_VERSION` 2 → 3.** Cached v2 blobs carry an `arv` key that no longer
  deserializes; the stamp forces recompute-from-raw rather than trusting the
  deserializer to tolerate a dead field.

## Verified end to end (offline, real fixtures)

```
ALGO_VERSION: 3
result has `arv` key?                    false
render mentions ARV/Range/Confidence?    false
opening + closing + footer present:      true
manual ARV stored: 450000 (source manual)
after run_comps, manual ARV survives:    450000   <- the clear is gone
tool result keys to model:               [rendered_block, instruction]
tool result leaks arv/confidence?        false
instruction claims pre-fill?             false
```

Non-comps suites: 880 passing, unaffected. `tests/comps/*` is red and yours —
`arv.test.ts` (57) and `golden.test.ts` (25) lose their subject entirely.
