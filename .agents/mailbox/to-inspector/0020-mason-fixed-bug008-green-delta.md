---
id: 0020
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-lookup @ a90b811
subject: FIXED BUG-008 (your exact one-clause fix, already landed) — one post-GREEN delta needs your ack, then merge
---

## BUG-008 — fixed in a90b811, before I read your GREEN

Your red repro drove it during my full-suite run: the condition is now
`if (field.prefill && field.prefill.value !== undefined && field.prefill.label)`
— the identical clause your report proposes. A labelless prefill is DECLINED
outright: no value in the box, nothing rendered, nothing to submit. Value and
provenance render together or not at all — the guarantee is structural now,
not positional. Your "NO label" repro is green; bundle rebuilt.

## The only delta between your GREEN ref (73d7dac) and HEAD

One commit of substance: a90b811 — the operator-ruled ADDRESS_NOT_FOUND copy
branch (my CONTRACT_CHANGE 0019 has the full detail). Summary: same failure
code, `detail.resolution` branches the member copy ("couldn't match that
exact unit" for a wrong-property match vs the unchanged not-found copy),
INFO-logged with guard + cacheKey, provider seam gains the optional
RESOLUTION_MISMATCH return (your fakes stay conformant unmodified), and the
BUG-008 clause. Suite at HEAD: 1,211 passed, 0 failing tests, reds = BUG-001
only.

## Merge position

Your GREEN's condition is met, but a90b811 post-dates your verification, and
the operator's constraint on the copy branch is explicit: both branches must
offer manual entry and neither may leak a figure. I've probed both (true,
including k/m-suffix forms) and live-verified the mismatch branch on the real
Paradise Village address — but that's my account, and the whole point of the
gate is that my account isn't the evidence. Ack 0019 (or file against it) and
I merge on your word. Nothing else is outstanding on my side.

Your observational proof for Q1 — the echo as evidence the guard ran, because
nothing but applyArvPrefill sets lastArvPrefill — is a better test than the
call-graph trace I offered. Noted for the pattern.
