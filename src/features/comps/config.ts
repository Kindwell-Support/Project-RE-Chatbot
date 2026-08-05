/**
 * Comps lookup — every threshold, weight, and constant, as named exports.
 *
 * CONTRACT.md §3 is the authority. Nothing outside this file may hardcode a
 * tuning value: a literal `0.25` in filter.ts is a bug INSPECTOR is entitled
 * to file. This is also what makes the algorithm auditable for the client —
 * one page answers "what counts as a comp?".
 */

/** Stamped on every outcome; bumping it triggers recompute-from-raw on cache hits. */
export const ALGO_VERSION = 1;

// --- Hard filters (CONTRACT §5.3) -------------------------------------------

/** Sold longer ago than this is not a comp. */
export const MAX_COMP_AGE_MONTHS = 12;

/** Comp livingArea must be within subject ± this fraction. */
export const SQFT_TOLERANCE = 0.25;

export const MAX_BED_DIFF = 1;
export const MAX_BATH_DIFF = 1;

/**
 * Search radii in miles, tried in order; stop at the first tier yielding at
 * least MIN_COMPS_FOR_TIER survivors, else settle for the last tier's outcome.
 */
export const RADIUS_TIERS_MI: readonly number[] = [0.5, 1.0, 2.0];
export const MIN_COMPS_FOR_TIER = 5;

/** Below this many survivors the whole run fails as TOO_FEW_COMPS. */
export const MIN_COMPS_TO_COMPUTE = 3;

/** After ranking, keep at most this many. */
export const MAX_COMPS_KEPT = 8;

/**
 * Likely non-arms-length (family transfer, partial interest, distress deed):
 * $/sqft below this fraction of the candidate set's median $/sqft.
 */
export const NON_ARMS_LENGTH_PPSF_FRACTION = 0.4;

/** Comp lot more than this multiple of subject lot = rural/assemblage anomaly. */
export const LOT_ANOMALY_MULTIPLE = 5;

// --- Scoring (CONTRACT §5.4; weights sum to 100) -----------------------------

export const WEIGHT_DISTANCE = 40;
export const WEIGHT_SQFT = 30;
export const WEIGHT_RECENCY = 20;
export const WEIGHT_BEDBATH = 10;

/** Distance at which the distance component saturates. */
export const DISTANCE_NORM_MI = 1.0;

/** Age at which the recency component saturates. */
export const RECENCY_NORM_MONTHS = 12;

// --- ARV (CONTRACT §5.5) -----------------------------------------------------

/** Fraction trimmed from EACH end of the sorted ppsf list when n >= 5. */
export const TRIM_FRACTION = 0.15;

/** ARV / low / high are rounded to the nearest multiple of this. */
export const ARV_ROUND_TO = 1000;

export const CONF_HIGH = {
  minComps: 6,
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
