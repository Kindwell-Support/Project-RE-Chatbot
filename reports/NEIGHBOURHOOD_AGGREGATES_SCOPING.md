# Neighbourhood sales aggregates — scoping (NOT built)

**2026-08-10, from recorded payloads only — zero new actor runs.** Client
spec: per lookup, 1-mile radius, past 12 months — total sales, average home
price, average $/sqft, average bed/bath, average days on market.

## Q1 — Can the existing candidate pool serve these? NO, and the reason is worse than the radius

The comps search fetches ONE run at the widest tier (3-mile box,
`resultsLimit: 40`). The radius mismatch is real but fixable by subsetting —
distance to each sale is already computed. The killer is the **results cap**:

| Recorded run | Raw items | Sold | dateSold span | Within 1 mi AND 12 mo |
| --- | --- | --- | --- | --- |
| spike-comps.json | 40 (limit hit) | 37 | **2026-06-24 → 07-31 (~5 weeks)** | 20 |
| spike-comps-2.json | 40 (limit hit) | 36 | **2026-07-07 → 08-03 (~4 weeks)** | 10 |

Both runs hit the 40-item cap, and the actor filled it with the *newest*
sales — so the pool's 12-month window is actually **4–5 weeks deep** in these
Phoenix markets. "Total sales in the past 12 months" computed from it would
be understated by roughly an order of magnitude, and every average would be a
recent-sales average wearing a 12-month label. The pool subset is usable for
nothing except a "recent weeks" figure we were not asked for.

(If built from ANY pool: `dedupeSales` must run first — BUG-010's duplicate
pair sat in one of these recorded pools and would double-count.)

## Q2 — Average DOM without detail runs? NO

Re-verified across both recorded runs: `daysOnZillow` is the **−1 sentinel on
all 76 usable sold items** (homeInfo and top-level). `timeOnZillow` exists in
ms but its meaning for a sold listing is unverified — it would be a guess
presented as a fact. Real DOM exists only in the DETAIL payload, i.e. one
detail-run slot per sale. A neighbourhood average over N sales (N = 20 in the
denser recorded market, plausibly 100+ in a true 1-mile/12-month set) means
batched detail runs over N addresses: measured scaling (~10s for 1, ~16s for
5) puts N ≈ 100 far past the 90s ceiling, and the detail actor bills per
result.

Honest options for the DOM line, cheapest first:
1. **Omit / em-dash** with a note that DOM is not published for sold
   listings in bulk.
2. **"Average DOM of the 5 comps shown"** — already paid for by the detail
   slice, zero extra cost — but it must be LABELLED as the 5-comp average,
   never presented as the neighbourhood figure.
3. The real thing, at N detail-slots per lookup. Not recommended.

1 vs 2 vs 3 is a client call; nothing else in the aggregate block depends on
it.

## Q3 — Cost of a proper dedicated fetch

**+1 search-actor run per lookup** (3 → 4 with the detail slice, +33% runs),
bounded to a 1-mile box, with the 12-month window pushed INTO the query:
Zillow's own sold filter carries a `doz` ("days on Zillow") parameter
(`12m`), so the window can be server-side instead of client-truncated.
Everything except DOM is then available from that single payload at the
recorded field rates (price 100%, sqft/beds/baths ~95%).

**One unknown gates the exact bill, and it needs a single spike run:**
whether `MAP_MARKERS` extraction honours a `resultsLimit` above ~40 and how
many items a real 1-mile/12-month urban query returns (these actors bill
per RESULT, so pool size IS the price — the per-result rate is visible only
in the client's Apify console). Until that spike: assume 100–500 results per
run in urban markets, billed accordingly, ~10s runtime inside the existing
ceiling.

Cacheability: the aggregate payload rides the existing `comps_cache` row
(same address key, 14-day TTL) — repeat lookups free, recompute-from-raw
works unchanged. It is subject-keyed, so nearby lookups do NOT share it;
grid-keyed sharing is possible but is optimization beyond the ask.

## Bottom line for sequencing

Census is **free** (no actor runs, no key at light volume). The aggregates
are **+1 billed run per lookup at minimum**, need one spike to cost
precisely, and their DOM line needs a client ruling on options 1–3 above.
Census stays cheaper; no reason found to resequence.

---

## SPIKE RESULT 2026-08-11 — the approach works (one run, as authorized)

One search run: 1-mile bounds around the recorded urban-Phoenix subject,
`doz=12m` server-side, `resultsLimit: 500`.

| Question | Answer |
| --- | --- |
| Does MAP_MARKERS honour resultsLimit > ~40? | **YES — 235 items returned in one run** (the 500 cap was not hit; the query exhausted) |
| Does `doz=12m` push the window server-side? | **YES — dateSold spans 2025-08-11 → 2026-08-05, a true 12-month window** (vs 4–5 weeks in the capped pool) |
| Pool quality | 233 usable sold items, **233 distinct zpids**, all within 12 months; **193 inside the 1-mile CIRCLE** (the rest sit in the box corners — the circle subset is the aggregate set) |
| Field availability | price 233/233 (100%) · sqft 221/233 (95%) · beds 204/233 (88%) |
| Runtime | **6.4s** — comfortably inside the 90s pipeline ceiling |

**Cost per aggregate fetch:** ONE actor run returning ~235 results in this
urban market (vs 40 for the comps search). These actors bill per RESULT, so
the real dollar figure is ~235 × the client's per-result rate — the rate is
in her Apify console. Recorded payload: `__fixtures__/spike-agg-1mi-12mo.json`
(the aggregate build's evidence base, INSPECTOR-shared).

**Conclusion: no rethink needed.** The 40-item wall was our own
`resultsLimit`, not a Zillow cap. The dedicated fetch per Ruling 1 is
buildable exactly as ruled: 1-mile bounds, `doz=12m`, `dedupeSales` before
any average, DOM as the labelled 5-comp average per Ruling 2.
