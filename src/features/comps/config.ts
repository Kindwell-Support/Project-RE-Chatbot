/**
 * Comps lookup — every threshold, weight, and constant, as named exports.
 *
 * CONTRACT.md §3 is the authority. Nothing outside this file may hardcode a
 * tuning value: a literal `0.25` in filter.ts is a bug INSPECTOR is entitled
 * to file. This is also what makes the algorithm auditable for the client —
 * one page answers "what counts as a comp?".
 */

/**
 * Stamped on every outcome; bumping it triggers recompute-from-raw on cache
 * hits — EXCEPT where the fetch regime changed (see RAW_REFETCH_BELOW_VERSION).
 * 3 = the ARV removal (§14.8). 4 = the comps-fetch truncation fix (§14.17).
 * 5 = the union (§14.19): the 1-mile aggregate payload joins the comps
 * candidate pool before the filters. v4 rows RECOMPUTE free — both raw
 * payloads sit on the row and are sound (see RAW_REFETCH_BELOW_VERSION,
 * which deliberately stays at 4).
 */
export const ALGO_VERSION = 5;

/**
 * Rows whose raw payload predates this version were fetched under the old
 * 40-item/uncapped-window regime and MUST REFETCH rather than
 * recompute-from-raw (operator ruling, §14.17): a recompute would rebuild a
 * result over a pool that was truncated to ~11 days in dense markets and
 * label it with a 12-month window. One-time cost: each old row re-bills one
 * lookup on its next touch.
 */
export const RAW_REFETCH_BELOW_VERSION = 4;

// --- Hard filters (CONTRACT §5.3) -------------------------------------------

/** Sold longer ago than this is not a comp. */
export const MAX_COMP_AGE_MONTHS = 12;

/**
 * Comp livingArea must be within subject ± this fraction (CONTRACT §14.1).
 * The client's spec reads "generally within 10-20%"; 20% is the HARD GATE and
 * closeness inside the band is rewarded by the sqft scoring term, so the two
 * together satisfy the spec without a second gate at 10% that would decimate
 * thin markets.
 */
export const SQFT_TOLERANCE = 0.20;

export const MAX_BED_DIFF = 1;
export const MAX_BATH_DIFF = 1;

/**
 * Search radii in miles (CONTRACT §14.1) — fewer, wider rungs than v1, and the
 * outer bound WIDENS from 2 mi to 3 mi.
 */
export const RADIUS_TIERS_MI: readonly number[] = [1.0, 3.0];

/**
 * Recency rungs in months (CONTRACT §14.1). The client's spec — "start at 3
 * months, extend to 12 in a slower market" — is TIERING, not scoring, so it
 * gets its own ladder; the recency term still scores within whichever rung is
 * active. MAX_COMP_AGE_MONTHS stays the outer bound (the last rung).
 *
 * ORDER (CONTRACT §14.2): recency widens BEFORE radius —
 *   1mi/3mo -> 1mi/6mo -> 1mi/12mo -> 3mi/3mo -> 3mi/6mo -> 3mi/12mo
 * because location beats recency inside a 12-month window: a same-street sale
 * from eight months ago is a better comp than one three miles out from last
 * month.
 */
export const RECENCY_TIERS_MONTHS: readonly number[] = [3, 6, 12];
export const MIN_COMPS_FOR_TIER = 5;

/** Below this many survivors the whole run fails as TOO_FEW_COMPS. */
export const MIN_COMPS_TO_COMPUTE = 3;

/**
 * After ranking, keep at most this many — DISPLAY AND COMPUTE, no split
 * (CONTRACT §14.1). The ARV is derived from the same comps the member sees.
 */
export const MAX_COMPS_KEPT = 5;

/**
 * Likely non-arms-length (family transfer, partial interest, distress deed):
 * $/sqft below this fraction of the candidate set's median $/sqft.
 */
export const NON_ARMS_LENGTH_PPSF_FRACTION = 0.4;

/**
 * Lot-score normalizer: a 100% difference from the subject's lot saturates the
 * term. Lot is a SOFT SCORING FACTOR in v2, never a hard gate (CONTRACT
 * §14.1) — the old >5x rejection decimated thin markets.
 */
export const LOT_NORM_RATIO = 1.0;

/**
 * Two records are the SAME SALE when price, living area and sold date all
 * match and their coordinates are within this distance (BUG-010). ~10 m.
 *
 * A DISTANCE threshold, never float equality: the recorded duplicate pair
 * differed in the sixth decimal of latitude (33.965137 vs 33.96514, ~0.3 m),
 * which exact matching misses — that miss is precisely how my first scan
 * reported "0 duplicates".
 *
 * And deliberately NOT keyed on zpid: Zillow carried one Wickenburg sale
 * under two zpids, so distinct ids ARE the problem, not the identity.
 */
export const DUPLICATE_COORD_TOLERANCE_MI = 10 / 1609.34;

// --- Scoring (CONTRACT §5.4; weights sum to 100) -----------------------------

// Sum to 100 (CONTRACT §14.3). Lot takes 10, drawn 5 from distance and 5 from
// sqft — the minimum disturbance that leaves the two dominant terms dominant.
export const WEIGHT_DISTANCE = 35;
export const WEIGHT_SQFT = 25;
export const WEIGHT_RECENCY = 20;
export const WEIGHT_BEDBATH = 10;
export const WEIGHT_LOT = 10;

/** Distance at which the distance component saturates. */
export const DISTANCE_NORM_MI = 1.0;

/** Age at which the recency component saturates. */
export const RECENCY_NORM_MONTHS = 12;

// --- ARV: REMOVED (CONTRACT §14.8) --------------------------------------
// TRIM_FRACTION, ARV_ROUND_TO, CONF_HIGH and CONF_MEDIUM are gone with
// arv.ts. The client removed the computed ARV from this module entirely;
// members supply their own via set_manual_arv. Reinstating is a rebuild from
// the contract, not a flag flip — this is a one-way door, by decision.

// --- Cache (CONTRACT §7) -----------------------------------------------------

export const CACHE_TTL_DAYS = 14;

/**
 * Detail-enrichment cache, keyed by ZPID, SEPARATE from the comps result
 * (CONTRACT §14.14 rule 4). Property facts — year built, parking, days on
 * market of a completed sale — barely change, and nearby lookups share comps
 * and therefore share detail rows. This TTL being much longer than
 * CACHE_TTL_DAYS is the main cost lever of the detail slice.
 */
export const DETAIL_CACHE_TTL_DAYS = 90;

/**
 * Skip the live detail batch when less than this remains of the whole-pipeline
 * ceiling (CONTRACT §14.14 rule 5). A batch of 5 measured ~16s in the spike;
 * starting one with less headroom than that mostly buys a timeout we still
 * paid Apify for. Comps render without detail — degradation, never failure.
 */
export const DETAIL_MIN_REMAINING_MS = 20_000;

// --- Provider + cost guards (CONTRACT §3, §6) --------------------------------

/**
 * Per Apify run for subject + search, and the WHOLE-PIPELINE ceiling once
 * detail enrichment enters (CONTRACT §14.14 rule 5): the detail batch only
 * gets whatever remains of this after the earlier runs, and is skipped
 * entirely below DETAIL_MIN_REMAINING_MS. Their runs bill real money on the
 * client's quota.
 */
export const PROVIDER_TIMEOUT_MS = 90_000;

/** Transient failures only (timeout / 5xx / network). 4xx retries are always 0. */
export const PROVIDER_MAX_RETRIES = 1;

/** Env-overridable defaults; the live values come from AppConfig. */
export const COMPS_RUNS_PER_SESSION_PER_HOUR = 5;

/**
 * Counts LOOKUPS THAT TOUCH APIFY, not actor runs (operator ruling, CONTRACT
 * §14.14): one provider-hitting comps lookup consumes ONE unit no matter how
 * many actor runs it spawns — up to 3 with detail enrichment (subject +
 * search + one batched detail), so 50 lookups ≈ 150 actor runs/day worst
 * case. The client accepted that multiplier knowingly; counting runs instead
 * would quietly claw back capacity she did not agree to give up. Lookups
 * served ENTIRELY from cache are free; a cache-hit lookup that still needs a
 * live detail batch consumes one unit (every actor run stays behind the cap),
 * and a denial there degrades to comps-without-detail, never RATE_LIMITED.
 */
export const COMPS_DAILY_RUN_CAP = 50;

// --- Neighbourhood sales aggregates (CONTRACT §14.16/.1) ---------------------

/** The client's spec: aggregates over 1 mile. The CIRCLE — box corners are cut in pure code. */
export const NEIGHBORHOOD_RADIUS_MI = 1.0;

/** ...and over the past 12 months, pushed SERVER-SIDE via Zillow's doz filter. */
export const NEIGHBORHOOD_WINDOW_MONTHS = 12;

/**
 * Results ceiling for the dedicated aggregate fetch. The spike proved the
 * old 40-item wall was OUR limit, not Zillow's: 500 returned 235 with the
 * query exhausted. These actors bill per result, so this is also a spend
 * bound (~500 × per-result rate worst case).
 */
export const NEIGHBORHOOD_RESULTS_LIMIT = 500;

/**
 * Skip the aggregate fetch below this much whole-pipeline headroom
 * (§14.14 rule 5 applies to every decoration). Spike measured 6.4s; comps
 * render without the neighbourhood block rather than failing.
 */
export const NEIGHBORHOOD_MIN_REMAINING_MS = 10_000;

// --- Census demographics (CONTRACT §14.10) -----------------------------------

/**
 * ACS 5-year vintage queried. Bump once a year when the new release lands —
 * the value is stamped on every Demographics object so a member-visible
 * figure always names its vintage.
 */
export const CENSUS_ACS_YEAR = 2023;

/** Per Census HTTP call (geocoder or ACS). Free API, but a member is waiting. */
export const CENSUS_TIMEOUT_MS = 10_000;

/**
 * Tract demographics cache TTL. ACS data changes ONCE A YEAR (new vintage);
 * 180 days means at most one stale half-year against a free source, while
 * keeping us far under the API key's daily request quota.
 */
export const CENSUS_CACHE_TTL_DAYS = 180;

// --- Shared math constants ---------------------------------------------------

/**
 * The ONLY days<->months conversion used anywhere in this feature. Pinned so
 * "older than 12 months" means the same thing in filter, score, and test.
 */
export const DAYS_PER_MONTH = 30.44;

/** Haversine earth radius, miles. */
export const EARTH_RADIUS_MI = 3958.8;
