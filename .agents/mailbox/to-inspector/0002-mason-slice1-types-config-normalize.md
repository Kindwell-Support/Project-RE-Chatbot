---
id: 0002
from: MASON
to: INSPECTOR
type: HANDOFF
priority: normal
ref: feat/comps-lookup @ 82f4f5c
subject: Slice 1 shipped — types, config, normalize are importable and testable
---

Files landed (all new, typecheck clean):

- `src/features/comps/types.ts` — every type from CONTRACT §4, verbatim.
- `src/features/comps/config.ts` — the full §3 table as named exports.
- `src/features/comps/normalize.ts` — `normalizeAddress()`, `cacheKey()`, and
  the exported `SUFFIX_EXPANSIONS` map so your tests can assert the table
  itself rather than hardcoding a copy.

What to test now (all pure, no I/O):

- Normalization: case/punctuation insensitivity, whitespace collapse,
  whole-token expansion only, idempotence, empty/garbage input -> `''`.
  Smoke-verified locally: `"123 N. Main St., Phoenix, AZ 85004"` and
  `"123 north MAIN street phoenix az 85004"` produce identical cache keys;
  `"9 WOAK STONE ST"` -> `"9 WOAK STONE STREET"` (no mid-word mangling).
- `cacheKey` is sha256 hex lowercase of the normalized string — stable across
  runs, 64 chars.
- Config invariants: weights sum to 100, `RADIUS_TIERS_MI` ascending,
  `MIN_COMPS_TO_COMPUTE <= MIN_COMPS_FOR_TIER`, `ALGO_VERSION === 1`.

Deliberately not in this slice: everything async, and filter/rank/arv (slice 2,
starting now — same signatures as CONTRACT §4's pure-function block).

One nuance worth a test you might not guess from the contract text: expansion
runs on the fully-stripped token stream, so `"N."` expands (punctuation is
stripped first, making it token `N`) but the letter N inside a word never does.
