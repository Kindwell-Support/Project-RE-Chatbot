# Golden dataset — comps lookup + ARV

Seven fixtures whose expected values were computed **by hand from
`.agents/CONTRACT.md` §5**, before the implementation existed and without
reading it.

That last part is the entire point. A test written by running the code and
pasting the output proves only that the code does what the code does — and it
looks exactly like coverage while proving nothing. Every number in these files
can be re-derived with a calculator from the arithmetic written into the file
header. If the implementation disagrees with one of them, **do not update the
fixture until you have re-done that arithmetic and found it wrong.**

## How to audit a case in five minutes

Open any `golden-NN-*.ts`. The header walks the contract's pipeline in order:

1. **Hard filters** — which of the eleven rules each comp hits, and why the
   others pass. Reasons are first-match, per CONTRACT §5.3.
2. **Radius tier** — which of `[0.5, 1.0, 2.0]` was settled on and whether the
   search stopped or ran out of tiers.
3. **$/sqft** — `soldPrice / livingArea`, per comp, against *that comp's* living
   area. Written out as division you can check.
4. **Trim** — `n >= 5 ? max(1, floor(n × 0.15)) : 0`, the sorted array, and
   which values came off which end.
5. **ARV** — the sum, the mean, the multiplication by subject sqft, the rounding.
6. **Spread** — deviations, squares, Σd², the `n−1` division, the square root.
7. **Band** — `arv ∓ round(sd × subjectSqft / 1000) × 1000`.
8. **Confidence** — every clause of the `high` / `medium` test, evaluated.

Then check `wrongAnswers`. Those are the numbers specific, plausible bugs
produce on this data. A case where a realistic bug lands on the *correct* answer
is a case that buys nothing — where that happens it is stated explicitly rather
than hidden (see `golden01UndetectedByThisCase`).

## Constants used, all from CONTRACT §3

```
SQFT_TOLERANCE 0.25   MAX_BED_DIFF 1   MAX_BATH_DIFF 1   MAX_COMP_AGE_MONTHS 12
RADIUS_TIERS_MI [0.5, 1.0, 2.0]   MIN_COMPS_FOR_TIER 5   MIN_COMPS_TO_COMPUTE 3
MAX_COMPS_KEPT 8   NON_ARMS_LENGTH_PPSF_FRACTION 0.4   LOT_ANOMALY_MULTIPLE 5
TRIM_FRACTION 0.15   ARV_ROUND_TO 1000   DAYS_PER_MONTH 30.44
EARTH_RADIUS_MI 3958.8
```

## Two arithmetic conventions that make the cases checkable

**Distances are pure-latitude offsets.** Every comp shares the subject's
longitude (`-122.3`), and with `Δlng = 0` the haversine formula collapses to
exactly `R × Δlat_radians`. So:

```
3958.8 × π / 180 = 69.09409447 miles per degree of latitude

Δlat 0.0010°  ->  0.0690941 mi
Δlat 0.0020°  ->  0.1381882 mi
Δlat 0.0030°  ->  0.2072823 mi
Δlat 0.0040°  ->  0.2763764 mi
```

No approximation, no `cos(lat)` term, nothing to argue about. (Longitude
behaviour and the km-vs-mi and euclidean-vs-haversine traps are covered
separately in the `filter` unit specs, where they belong.)

**Ages are whole days against a midnight-UTC clock.** `now` is
`2025-07-15T00:00:00.000Z` in every case and `soldDate` is a date-only ISO
string, so the day count is exact:

```
monthsAgo = days / 30.44

 30 d -> 0.9855453     60 d -> 1.9710907     90 d -> 2.9566360
120 d -> 3.9421814    150 d -> 4.9277267    210 d -> 6.8988173
240 d -> 7.8843626    250 d -> 8.2128778    400 d -> 13.1406044
```

Worth internalising: 12 months is `12 × 30.44 = 365.28` **days**, so a comp sold
exactly 365 days ago is *not* stale. That is a consequence of the contract, not
an accident, and the filter specs pin both sides of it.

## The `compsUsed` ambiguity — resolved, but not in the contract

`ArvResult.compsUsed` is not defined in CONTRACT.md as either the kept count or
the post-trim count, and at n = 5 and n = 6 the two readings give different
confidence tiers. MASON ruled (mailbox `0003-mason-slice2-filter-rank-arv.md`):
**`compsUsed` is the kept / ranked count.**

Cases 01, 02, 03, 05 and 06 hold under **either** reading, so they were never
exposed. Case 04 cannot be — sitting on that boundary is its purpose — so it
asserts `medium` per the ruling, and the rejected reading (`low`) stays recorded
in `golden04ConfidenceByReading`.

The ruling lives in a mailbox message; the contract text is still ambiguous on
its face. An amendment to CONTRACT.md §4 has been requested. Until it lands, the
header comment in `golden-04-boundary-5.ts` is the only written explanation of
why that case is `medium` and not `low`.

## Files

| File | What it pins |
| --- | --- |
| `golden-01-clean-8.ts` | 8 comps, `trimCount` 1, `high` confidence; sorted-vs-unsorted trim, $/sqft denominator, and the `arvLow` rounding trap |
| `golden-02-outlier-6.ts` | 6 comps, one at 3× $/sqft; the trim earning its place ($405k vs $530k untrimmed) |
| `golden-03-thin-3.ts` | exactly 3 comps; `trimCount` 0, `low` confidence, tier falling through to 2.0, sample-vs-population sd |
| `golden-04-boundary-5.ts` | exactly 5 comps; `>= 5` vs `> 5` ($400k vs $404k) and the tier that must *not* escalate |
| `golden-05-too-few-2.ts` | 2 comps and 0 comps; no ARV, no `NaN`, no `$0`, manual entry offered |
| `golden-06-non-arms-length-order.ts` | candidate median before other filters ($400k vs $340k), and median-vs-mean |
| `types.ts` | local transcription of CONTRACT §4 — a copy, deliberately not an import |
| `index.ts` | `GOLDEN_CASES` and friends for table-driven suites |

## Rules for editing this directory

1. Changing an expected value requires redoing the arithmetic in the header and
   updating both. A number without its derivation is not a golden case.
2. Never import from `src/features/comps/` here. `types.ts` is a hand copy on
   purpose; if MASON's types drift from the contract, the conformance spec is
   what should catch it, not a silent recompile.
3. If a fixture stops discriminating a bug it used to catch, say so in the file
   (as `golden-01` does) rather than deleting the case.
