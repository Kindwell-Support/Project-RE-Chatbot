---
id: 0003
from: MASON
to: INSPECTOR
type: HANDOFF
priority: normal
ref: feat/comps-lookup @ fb5ffc5
subject: Slice 2 shipped — filter, rank, arv (the whole decision core, pure)
---

Files landed, typecheck clean:

- `src/features/comps/filter.ts` — `haversineMiles`, `monthsBetween`,
  `median`, `applyHardFilters`, `selectRadiusTier`. Also exports `median` and
  `monthsBetween` (not in the contract's §4 list but useful to you; treat as
  stable).
- `src/features/comps/rank.ts` — `scoreComp`, `rankComps`.
- `src/features/comps/arv.ts` — `pricePerSqft`, `trimmedMean`, `calculateArv`.

Semantics you'll want to pin (all smoke-verified end-to-end already):

- Reason order is exactly CONTRACT §5.3: a comp that is both stale AND missing
  sqft reports `STALE_SALE`.
- `NON_ARMS_LENGTH` median is over the candidate set (any comp with computable
  ppsf, pre-filter), so it's radius- and order-independent.
- Bed/bath nulls never reject and score as 0 diff; unknown comp sqft saturates
  the sqft score component instead.
- `TYPE_MISMATCH`: `OTHER` matches nothing, including another `OTHER`.
- `selectRadiusTier` reruns the FULL pass per tier and reports the final
  tier's rejected list only.
- Rank ties: score asc → distance asc → zpid asc (localeCompare).
- `calculateArv` maps trimmed ppsf values back to zpids by sorting on
  (ppsf, zpid) — duplicates stay deterministic. `compsUsed` = kept/ranked
  count (the charter's `n = ppsf.length`), NOT the post-trim count; cv/sd are
  over the trimmed set; confidence medians are over the full ranked set.
- Two deliberate throws in `calculateArv` (unknown subject sqft, zero comps):
  programmer-error guards — service.ts gates both failure codes before calling.
  They are TypeErrors, not part of the outcome union.

Interesting numeric fixture from my smoke run, if you want a golden test:
subject 1600 sqft, comps at $/sqft {246.875, 250, 248.48, 253.03, 253.33,
259.26} → trim drops 246.875 (low) + 259.26 (high), ARV $402,000, band
$398k–$406k, confidence `high`.

Next: slice 3 — `format.ts` + `service.ts` + `providers/{types,stub}.ts`,
plus the starter fixtures in `__fixtures__/`.
