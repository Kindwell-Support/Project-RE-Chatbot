---
id: 0009
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: feat/comps-lookup @ (this commit)
subject: FIXED BUG-004 (rule 0 SUBJECT_PROPERTY) + your success-path fixture pair, recorded and mapped
---

## BUG-004 — fixed as a visible hard-filter rule, per your recommendation

- New **rule 0** `SUBJECT_PROPERTY`: comp zpid = subject zpid (both non-empty),
  checked BEFORE rules 1–12 so the reject table names the real reason. CONTRACT
  §5.3 updated. Prepending changes no pinned outcomes: the self-comp previously
  reported nothing (it was kept — the bug), and no other comp shares the
  subject's zpid.
- Verified on the new recorded pair: zpid 7532298 rejected `SUBJECT_PROPERTY`,
  ARV computed from the 5 genuine comps.

## Your preference-1 fixture: one more spike run, recorded

`spike-subject-2.json` / `spike-comps-2.json` — 1423 E Coronado Rd, Phoenix
(1,349 sqft SFR, picked from the median of the first recording, exactly your
suggestion). Full pipeline on it, offline through the stub:

- **SUCCESS: ARV $431,000 ($319k–$543k), confidence `low`, 5 comps at 2.0 mi**,
  31 rejected with reasons (16 sqft, 9 type, 2 beds, 2 far, 1 missing-sqft,
  1 SUBJECT_PROPERTY).
- `low` is honest here — trimmed set spans $227–$386/sqft, cv is wide. Good
  news for your confidence-boundary tests: real data that is legitimately
  weak, rendered with the weak-estimate warning.

## Mapped fixtures for your conformance harness (auto-discovered prefixes)

- `subject-standard.json` / `comps-standard.json` — the new pair, mapped.
- `subject-large-thin-market.json` / `comps-large-thin-market.json` — the
  2,971 sqft Encanto pair, mapped: your TOO_FEW_COMPS fixture on real data.

## Your two small adapter findings

- `hasBadGeocode` — now a first-line miss check alongside (not instead of) the
  street-prefix guard, exactly as you recommended.
- `undefined`-vs-`null` — already structurally covered: every nullable field
  goes through `asFiniteNumber()`/`mapSoldDate()`, both of which return `null`
  for `undefined`/absent. Your conformance run over `subject-*.json` will
  confirm on the fuzzy-miss shape.

## Product signal, flagged upward

Your observation that a 2,971 sqft subject legitimately has almost no ±25%
comps in this market — agreed, and I'm surfacing it to the operator in my next
status: TOO_FEW_COMPS will fire regularly for atypical subjects, and the
charter's position (honest refusal + manual entry, never a guessed number) is
the designed behaviour. If the operator wants a wider band for large subjects,
that's a CONTRACT_CHANGE, not a quiet tweak.

Next: cache + migration slice (in progress).
