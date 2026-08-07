/**
 * Comps lookup — every threshold, weight, and constant, as named exports.
 *
 * CONTRACT.md §3 is the authority. Nothing outside this file may hardcode a
 * tuning value: a literal `0.25` in filter.ts is a bug INSPECTOR is entitled
 * to file. This is also what makes the algorithm auditable for the client —
 * one page answers "what counts as a comp?".
 */

/** Stamped on every outcome; bumping it triggers recompute-from-raw on cache hits. */
export const ALGO_VERSION = 2;

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

// --- ARV (CONTRACT §5.5) -----------------------------------------------------

/** Fraction trimmed from EACH end of the sorted ppsf list when n >= 5. */
export const TRIM_FRACTION = 0.15;

/** ARV / low / high are rounded to the nearest multiple of this. */
export const ARV_ROUND_TO = 1000;

/**
 * minComps 6 -> 5 is FORCED, not chosen (CONTRACT §14.4): with MAX_COMPS_KEPT
 * at 5, `n >= 6` is unreachable and every run would return medium-or-low
 * forever. Applied even though the ARV surface is currently disabled, so the
 * code carries no threshold that contradicts the cap.
 */
export const CONF_HIGH = {
  minComps: 5,
  maxCv: 0.15,
  maxMedianDistanceMi: 0.75,
  maxMedianAgeMonths: 6,
} as const;

export const CONF_MEDIUM = {
  minComps: 4,
  maxCv: 0.25,
} as const;

// --- Cache (CONTRACT §7) -----------------------------------------------------

export const CACHE_TTL_DAYS = 14;

// --- Provider + cost guards (CONTRACT §3, §6) --------------------------------

/** Per Apify run. Their runs bill real money on the client's quota. */
export const PROVIDER_TIMEOUT_MS = 90_000;

/** Transient failures only (timeout / 5xx / network). 4xx retries are always 0. */
export const PROVIDER_MAX_RETRIES = 1;

/** Env-overridable defaults; the live values come from AppConfig. */
export const COMPS_RUNS_PER_SESSION_PER_HOUR = 5;
export const COMPS_DAILY_RUN_CAP = 50;

// --- Shared math constants ---------------------------------------------------

/**
 * The ONLY days<->months conversion used anywhere in this feature. Pinned so
 * "older than 12 months" means the same thing in filter, score, and test.
 */
export const DAYS_PER_MONTH = 30.44;

/** Haversine earth radius, miles. */
export const EARTH_RADIUS_MI = 3958.8;
