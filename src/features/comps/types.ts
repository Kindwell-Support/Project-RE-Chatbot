/**
 * Comps lookup + ARV — shared types.
 *
 * Everything here is contract-bound: .agents/CONTRACT.md §4 is the authority,
 * and INSPECTOR's tests import these signatures directly. Outcomes are
 * discriminated unions on `ok`, never thrown errors, at the service boundary —
 * a failed comps run is a first-class result the chat renders, not an
 * exception the model improvises around.
 */

export interface CompsRequest {
  address: string;
  sessionId: string;
}

/**
 * OTHER is deliberately a black hole: it never matches anything, including
 * another OTHER (CONTRACT §5.3.7). Two "unknown" property types being treated
 * as comparable is exactly the kind of silent garbage-in this exists to stop.
 */
export type PropertyType = 'SFR' | 'CONDO' | 'TOWNHOUSE' | 'MANUFACTURED' | 'OTHER';

export interface SubjectProperty {
  zpid: string;
  address: string;
  beds: number | null;
  baths: number | null;
  /** sqft. null or <= 0 is a hard stop (SUBJECT_SQFT_UNKNOWN) — no ARV math. */
  livingArea: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  propertyType: PropertyType;
  lastSoldPrice: number | null;
  /** ISO date string. */
  lastSoldDate: string | null;
  lat: number;
  lng: number;
}

export interface RawComp {
  zpid: string;
  address: string;
  status: string;
  soldPrice: number | null;
  /** ISO date string. */
  soldDate: string | null;
  beds: number | null;
  baths: number | null;
  livingArea: number | null;
  lotSize: number | null;
  propertyType: PropertyType;
  lat: number;
  lng: number;
  /**
   * Zillow listing URL. LOAD-BEARING (CONTRACT §14.9): the client waived
   * style/condition/quality matching in writing and named this link as the
   * member's substitute for evaluating them. A null here is a real
   * degradation and renders as an explicit notice, never a silent omission.
   */
  detailUrl: string | null;
}

/**
 * Machine-readable rejection reasons, one per hard filter, in CONTRACT §5.3
 * order. A comp failing several rules carries only the FIRST — the order is
 * part of the contract, so tests can assert exact reasons deterministically.
 */
export type RejectReason =
  /**
   * Rule 0 (BUG-004): the comp IS the subject (same zpid). A recently-sold
   * subject sits inside its own search box and is a perfect comp by
   * construction — score 0, uncappable — anchoring the "market" ARV to the
   * member's own purchase price. Checked before everything so the rendered
   * table says "your property, excluded" rather than hiding it.
   */
  | 'SUBJECT_PROPERTY'
  | 'NOT_SOLD'
  | 'STALE_SALE'
  | 'SQFT_MISSING'
  | 'SQFT_OUT_OF_RANGE'
  | 'BEDS_DIFF'
  | 'BATHS_DIFF'
  | 'TYPE_MISMATCH'
  | 'TOO_FAR'
  | 'PRICE_MISSING'
  | 'NON_ARMS_LENGTH'
  | 'LOT_ANOMALY'
  /** Rule 12 (BUG-003): dated after `now` — a sale that hasn't happened is not a comp. */
  | 'FUTURE_SOLD_DATE'
  /**
   * BUG-010: the same sale carried under two zpids with different address
   * formatting. Not a hard-filter rule — applied AFTER filtering, between
   * gates and ranking, so it only ever drops a comp that would otherwise have
   * been KEPT. Reported like any other drop so the member can see it.
   */
  | 'DUPLICATE_SALE';

export interface RejectedComp {
  comp: RawComp;
  reason: RejectReason;
}

/**
 * Per-comp facts from the DETAIL scraper (CONTRACT §14.14) — fetched AFTER
 * ranking, for the final kept set only, in ONE batched run. Enrichment is
 * decoration: a missing/failed detail never fails a comps run, it renders
 * em-dashes. Cached by zpid with its own longer TTL, separate from the comps
 * result.
 */
export interface CompDetail {
  /** Real daysOnZillow from the detail payload — the search payload's −1 sentinel never reaches here. */
  daysOnMarket: number | null;
  /** resoFacts.parkingCapacity, falling back to parking.totalSpaces. 0 is a value, not a null. */
  parkingSpaces: number | null;
  yearBuilt: number | null;
  /**
   * OBTAINABLE BUT NOT RENDERED (operator directive): the client waived
   * style/condition as MATCHING criteria, which is not the same as declining
   * to SEE them. Captured so a display ruling is a render change, not a
   * re-scrape — format.ts must not emit them until that ruling exists.
   */
  architecturalStyle: string | null;
  propertyCondition: string | null;
}

export interface ScoredComp {
  comp: RawComp;
  distanceMi: number;
  monthsAgo: number;
  pricePerSqft: number;
  /** 0–100, lower is better. */
  score: number;
  /** The five weighted components, exposed so a score is auditable, not a black box. */
  parts: {
    distance: number;
    sqft: number;
    recency: number;
    bedbath: number;
    /** Soft lot term (CONTRACT §14.3); 0 when either lot is unknown. */
    lot: number;
  };
  /**
   * Detail enrichment (§14.14). OPTIONAL and attached only by the service's
   * enrichment step — the pure filter/rank pipeline never sets it, and a
   * comp without it renders em-dash detail fields. Never cached inside the
   * comps result (enrichment re-attaches on every serve from the zpid cache).
   */
  detail?: CompDetail;
}

/**
 * Neighbourhood demographics (CONTRACT §14.10) — US Census ACS 5-year, keyed
 * off the subject's tract. Decoration like detail: never blocks a comps run.
 * Every figure is from the API or arithmetic on returned counts (the tenure
 * percentages) — never inferred. ACS suppression sentinels (large negatives)
 * map to null and render as em-dashes.
 */
export interface Demographics {
  /** 11-digit census tract GEOID (state+county+tract) — the cache key. */
  tractGeoid: string;
  /** Display name from the geocoder, e.g. "Census Tract 1117". */
  tractName: string;
  /** ACS 5-year vintage the figures come from. */
  acsYear: number;
  medianHouseholdIncome: number | null;
  medianAge: number | null;
  /** 0–100, computed from RETURNED B25003 tenure counts; null when counts are missing/zero. */
  ownerOccupiedPct: number | null;
  renterOccupiedPct: number | null;
}

/**
 * Neighbourhood sales aggregates (CONTRACT §14.16/.1) — computed from a
 * DEDICATED 1-mile, 12-month fetch (never the candidate pool, whose window
 * is weeks deep under its results cap), deduped BEFORE any average.
 * Decoration: never blocks a comps run; computed per serve from cached raw,
 * never stored.
 */
export interface NeighborhoodAggregates {
  /** Geography half of the Guarantee-4 label. */
  radiusMi: number;
  /** Window half of the label. */
  windowMonths: number;
  /** Deduped sale count inside the circle and window. 0 is a real figure. */
  totalSales: number;
  avgSoldPrice: number | null;
  /** Mean of per-sale $/sqft (mean of ratios, not ratio of means). */
  avgPricePerSqft: number | null;
  avgBeds: number | null;
  avgBaths: number | null;
  /**
   * The span the fetch ACTUALLY covered — what the window-truncation tests
   * assert on, because a truncated window still produces plausible figures.
   */
  earliestSaleDate: string | null;
  latestSaleDate: string | null;
  /**
   * True when the dedicated fetch returned its results limit — the
   * cap-detection invariant (INSPECTOR's CASE 3): count == cap means there
   * is almost certainly older data we did not get, and the render MUST NOT
   * carry a 12-month label. It labels the actual span instead. Silence
   * beats a mislabelled average.
   */
  windowTruncated: boolean;
  /**
   * Ruling 2: mean daysOnMarket over the DISPLAYED comps carrying one —
   * never the neighbourhood pool. Renders ONLY inside its load-bearing
   * label; null when no displayed comp has a DOM.
   */
  avgDomOfDisplayedComps: number | null;
  /** How many displayed comps carried a DOM — the label names N of M. */
  domCompCount: number;
}

export interface CompsResult {
  ok: true;
  algoVersion: number;
  /** crypto.randomUUID(), minted in the service layer only — pure code stays clock/RNG-free. */
  runId: string;
  subject: SubjectProperty;
  radiusTierMi: number;
  /** Which recency rung produced this set (CONTRACT §14.2). */
  recencyTierMonths: number;
  /**
   * §14.17: true when the comps fetch returned at/near its results limit —
   * the pool is almost certainly missing older sales, so the header must
   * not claim the recency window; it labels the actual covered span.
   */
  searchTruncated: boolean;
  /** Oldest soldDate in the COMPS-FETCH pool — the honest window label when truncated. */
  searchEarliestSoldDate: string | null;
  /**
   * §14.19: the radius fully covered by the unioned aggregate payload
   * (NEIGHBORHOOD_RADIUS_MI when it is present and itself un-truncated),
   * else null. The window claim attaches to the SERVED RUNG: a rung at or
   * inside this radius claims its window honestly even when the wider
   * comps fetch truncated.
   */
  nearRingCompleteMi: number | null;
  /**
   * §14.21: deduped count of SOLD, in-sqft-band, same-mapped-type sales
   * within 1 mile and 12 months, over the UNION pool. REQUIRED so a result
   * without it is unrepresentable — the thin-market disclosure's second
   * trigger signal, and the count the disclosure copy quotes. Never
   * affects selection or ranking (the comp set is byte-identical whether
   * or not the disclosure fires).
   */
  nearInBandSameTypeSales: number;
  /**
   * §14.23: median $/sqft over the same deduped near in-band same-type
   * pool, restricted to sales with a computable ppsf (soldPrice > 0 and
   * livingArea > 0) — the price-outlier disclosure's PRIMARY reference.
   * Null when no sale in the pool carries a usable pair. REQUIRED so the
   * flag-holds-but-no-block state is unrepresentable. Never affects
   * selection or ranking.
   */
  nearInBandMedianPpsf: number | null;
  /**
   * §14.23: how many sales back that median. Can be SMALLER than
   * `nearInBandSameTypeSales` (a counted sale without a usable price/sqft
   * pair carries no ppsf). Below OUTLIER_REFERENCE_MIN_COUNT the renderer
   * falls back to the kept set's leave-one-out median.
   */
  nearInBandPpsfCount: number;
  comps: ScoredComp[];
  rejected: RejectedComp[];
  fromCache: boolean;
  provider: string;
  /**
   * §14.10 three-state field: ABSENT = demographics never attempted (no
   * CENSUS_API_KEY configured — no section renders; an unconfigured feature
   * is not a failure); NULL = attempted and failed/unresolvable — the
   * section renders its "unavailable" line; PRESENT = the tract's figures.
   * Attached by the service on every serve, never stored in comps_cache.
   */
  demographics?: Demographics | null;
  /**
   * §14.16.1, same three states: ABSENT = provider lacks the optional
   * fetch (no section); NULL = attempted and failed/skipped (unavailable
   * line); PRESENT = the aggregates. Attached per serve, never stored.
   */
  neighborhood?: NeighborhoodAggregates | null;
}

export type CompsFailureCode =
  | 'ADDRESS_NOT_FOUND'
  | 'SUBJECT_SQFT_UNKNOWN'
  | 'TOO_FEW_COMPS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED';

export interface CompsFailure {
  ok: false;
  algoVersion: number;
  code: CompsFailureCode;
  /** Plain English; always ends by offering manual ARV entry. Never carries a number. */
  message: string;
  detail?: {
    kept?: number;
    needed?: number;
    radiusTierMi?: number;
    /**
     * ADDRESS_NOT_FOUND only (operator ruling: one code, branched copy):
     * 'unit_mismatch' = Zillow resolved a DIFFERENT property than named
     * (wrong unit, hasBadGeocode) — the address may be real; 'not_found' =
     * a genuine empty/invalid result. Branches the member copy; if
     * unit_mismatch proves frequent in production logs, it earns its own
     * code properly, with tests.
     */
    resolution?: 'unit_mismatch' | 'not_found';
    /**
     * unit_mismatch only: did the member's RAW input contain a unit
     * designator (#, unit, apt, suite)? Branches the copy — "double-check
     * the unit number" is only sayable when they typed one.
     */
    inputHasUnit?: boolean;
    /**
     * TOO_FEW_COMPS only (operator ruling): 'no_type_match' = the kept set
     * is EMPTY and the fetched pool contains ZERO comps of the subject's
     * property type — we didn't find the right pool, which is not the same
     * truth as "the market is thin". Branches the member copy; the code and
     * the no-number/manual-entry guarantees are unchanged.
     */
    pool?: 'no_type_match';
  };
}

export type CompsOutcome = CompsResult | CompsFailure;
