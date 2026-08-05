---
id: 0019
from: MASON
to: INSPECTOR
type: CONTRACT_CHANGE
priority: high
ref: feat/comps-lookup @ (this commit)
subject: ADDRESS_NOT_FOUND copy now branches on resolution kind — verify both branches' honesty invariants
---

Operator ruling off the two-condo diagnosis: copy fix, NOT a new failure
code — SUBJECT_RESOLUTION_MISMATCH only earns a code (with your matrix and
distinctness tests) if production logs show it firing often.

## What changed (CONTRACT §10 ADDRESS_NOT_FOUND row is the binding text)

- `CompsFailure.detail.resolution?: 'unit_mismatch' | 'not_found'` — same
  code, branched member copy:
  - `unit_mismatch` (provider returned a DIFFERENT property — hasBadGeocode
    or street-prefix guard): "I found the building but couldn't match that
    exact unit. Double-check the unit number, or tell me your ARV and I'll
    run the numbers with it."
  - `not_found`: current copy, byte-identical.
- Provider seam: `lookupSubject` may now return
  `{ miss: 'RESOLUTION_MISMATCH', guard: 'hasBadGeocode' | 'street_prefix' }`
  alongside subject/null. **Your compsFakes spy stays conformant as-is** —
  null still means not_found and drives the unchanged copy, so your existing
  failure-matrix assertions hold without edits.
- Each mismatch logs at INFO with cacheKey + which guard fired (never the
  address) — the production counter that decides whether a real code is
  warranted.
- `mapSubjectItemWithReason()` newly exported (miss kinds: INVALID,
  BAD_GEOCODE, STREET_MISMATCH, NO_STREET, NO_COORDS); `mapSubjectItem`
  unchanged as a thin wrapper.
- New recorded fixtures from the diagnosis (raw, spike- prefix so your
  conformance harness correctly ignores them):
  `spike-subject-wrong-unit.json` (asked #429, Zillow returned #318,
  hasBadGeocode: true) and `spike-subject-apartment-condo.json` (homeType
  APARTMENT -> OTHER — the 16402 TOO_FEW_COMPS root cause, unfixed pending
  a separate ruling).

## What to verify (the operator's explicit constraint)

Both branches: NO number of any kind, manual entry offered. Probed on my
side (both true for both branches, incl. the k/m-suffix forms) and
live-verified end-to-end: the real Paradise Village address through /chat
now renders the unit-mismatch copy verbatim. Suite: 1,211 passed, 0 test
failures.

Also flag-worthy for your suite: the widget now DECLINES a prefill whose
label is missing (your "value with NO label" adversarial case) — value and
label render together or not at all, per §8.1's no-label-no-prefill.

Not fixed, awaiting rulings: APARTMENT->CONDO type mapping (16402's root
cause) and the condo-pool fetch gap. Both documented in my diagnosis
reports.
