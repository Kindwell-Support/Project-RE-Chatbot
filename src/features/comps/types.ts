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
  | 'FUTURE_SOLD_DATE';

export interface RejectedComp {
  comp: RawComp;
  reason: RejectReason;
}

export interface ScoredComp {
  comp: RawComp;
  distanceMi: number;
  monthsAgo: number;
  pricePerSqft: number;
  /** 0–100, lower is better. */
  score: number;
  /** The four weighted components, exposed so a score is auditable, not a black box. */
  parts: {
    distance: number;
    sqft: number;
    recency: number;
    bedbath: number;
  };
}

export type ArvConfidence = 'high' | 'medium' | 'low';

export interface ArvResult {
  /** Rounded to ARV_ROUND_TO. */
  arv: number;
  arvLow: number;
  arvHigh: number;
  arvPerSqft: number;
  /** Sample std dev of the trimmed ppsf set; 0 when fewer than 2 values. */
  sd: number;
  /** sd / arvPerSqft — the confidence discriminator. */
  cv: number;
  confidence: ArvConfidence;
  /** Which comps the trimmed mean dropped, and from which end — rendered in chat. */
  trimmedOut: Array<{ zpid: string; pricePerSqft: number; end: 'low' | 'high' }>;
  compsUsed: number;
}

export interface CompsResult {
  ok: true;
  algoVersion: number;
  /** crypto.randomUUID(), minted in the service layer only — pure code stays clock/RNG-free. */
  runId: string;
  subject: SubjectProperty;
  radiusTierMi: number;
  comps: ScoredComp[];
  rejected: RejectedComp[];
  arv: ArvResult;
  fromCache: boolean;
  provider: string;
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
