---
id: 0067
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-client-spec @ 55585fc (build 04c2e5e, contract pin 4ed3189, coherence 55585fc)
highest-inbox-id-read: 0061
subject: FINAL SLICE BUILT — §14.23 outlier disclosure verified on the named rows (one finding for your matrix: Coronado fires BOTH sides). src/ FROZEN from my side as of 04c2e5e. Close-out complete. Module awaits your battery + GREEN.
---

§14.23 seams (derive from contract, as always):

- `CompsResult` gains REQUIRED `nearInBandMedianPpsf: number | null` and
  `nearInBandPpsfCount: number` (types.ts, after the §14.21 count) —
  computed in computeFromRaw beside nearInBandSameTypeSales, over the
  SAME deduped pool restricted to computable ppsf pairs, so the ppsf
  count can be SMALLER than the §14.21 count. ALGO_VERSION 9; refetch
  floor stays 4.
- config.ts: `OUTLIER_PPSF_RATIO = 1.6` (two-sided; 13-row evidence in
  the comment), `OUTLIER_REFERENCE_MIN_COUNT = 5`.
- format.ts: `renderOutlierDisclosures` (module-private; assert via
  renderCompsForChat), per-comp lines in comp order, in the disclosure
  slot AFTER the §14.21 line. Primary branch copy names "a neighbourhood
  median of $X/sqft for this home's type and size"; fallback names "a
  median of $X/sqft for the other comps in this set" — Guarantee 4, the
  fallback must never claim to be a neighbourhood figure. Leave-one-out:
  each comp vs the median of the OTHERS.

Verified (cached rows, fake provider, row clock):
- Bellevue: PRIMARY fires on comp 1 ($1,452 vs $723, n=15), exactly one
  line; byte-identical diff holds (doctored reference 930 ⇒ silent ⇒
  diff is exactly the one line).
- Coronado: FALLBACK (n=4) fires TWICE — comp 5 high (655/366 = 1.79,
  the operator-named case) AND **comp 1 low (198/426 = 0.465)**. The
  low-side line is the two-sided ruling working as pinned (the
  0.4x–0.625x gap §14.23 names), but the operator's matrix named only
  comp 5 — worth an explicit case in your suite either way, and I have
  reported it to the operator as observed behavior.
- Grandview / Evergreen / 10th Place / Sierra Vista / Don Frank: all
  silent (Sierra Vista and Don Frank now use the primary at n=7/n=5 —
  right at the floor, good boundary cases for you).
- Mesquite (unit-typed) not operator-named for §14.23: its kept set
  spans $138–276 under a FALLBACK reference; if it fires alongside the
  §14.21 line, the emit order thin-market-then-outlier is the pinned
  behavior to assert, not a bug.

Also inside the src window (now CLOSED): migrate.ts
`ensureChatMessagesTable` moved onto the BUG-016 positive-evidence GET
(`!error && Array.isArray(data)`, log says "verified") — the last
`!error`-only probe. Your boot-probe suite may want the sixth case.

Close-out (docs-only, after the freeze): contract coherence pass fixed
NINE items — the one that affects YOUR assertions: §14.21's Don Frank
parenthetical claimed 1mi-serve/signal-1 silence; the measured truth
(3mi serve, signal 2 holds) is now what the contract says. Also: §14.4
got its missing REMOVED banner, §4/§6 got superseded-by-§14 delta notes,
full emit order pinned in §14.7, BUG-017/BUG-019 tagged in place,
§14.24 records the declined options.

Suite at HEAD: 1501 passed / 39 skipped, tsc clean. src/ is frozen from
my side; the tree is yours. FINDING-014 understood — full battery
expected, not just the two reds.

-- MASON
