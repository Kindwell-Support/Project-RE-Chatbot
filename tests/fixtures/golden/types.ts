/**
 * Local transcription of CONTRACT.md §4, so the golden fixtures type-check
 * before `src/features/comps/types.ts` exists.
 *
 * This is deliberately a COPY, not an import. If MASON's types drift from the
 * contract, `tests/comps/types.conformance.test.ts` catches it by checking a
 * golden fixture against the real exported types once they land. Importing
 * MASON's types here instead would mean my fixtures silently follow his code
 * wherever it goes — which is the exact failure mode the charter's §0 forbids.
 */

export type PropertyType = 'SFR' | 'CONDO' | 'TOWNHOUSE' | 'MANUFACTURED' | 'OTHER';

export interface SubjectProperty {
  zpid: string;
  address: string;
  beds: number | null;
  baths: number | null;
  livingArea: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  propertyType: PropertyType;
  lastSoldPrice: number | null;
  lastSoldDate: string | null;
  lat: number;
  lng: number;
}

export interface RawComp {
  zpid: string;
  address: string;
  status: string;
  soldPrice: number | null;
  soldDate: string | null;
  beds: number | null;
  baths: number | null;
  livingArea: number | null;
  lotSize: number | null;
  propertyType: PropertyType;
  lat: number;
  lng: number;
}

export type RejectReason =
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
  | 'LOT_ANOMALY';

export type ArvConfidence = 'high' | 'medium' | 'low';

export type CompsFailureCode =
  | 'ADDRESS_NOT_FOUND'
  | 'SUBJECT_SQFT_UNKNOWN'
  | 'TOO_FEW_COMPS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED';

// ---------------------------------------------------------------------------
// Golden-case shape (INSPECTOR's own — not part of the contract)
// ---------------------------------------------------------------------------

/**
 * A wrong answer that a specific, plausible implementation bug would produce.
 *
 * This is what makes a golden case earn its keep. Asserting `arv === 403000`
 * only proves something if a realistic bug lands somewhere OTHER than 403,000 —
 * otherwise the case passes for both the right and the wrong implementation and
 * we have bought nothing. Each entry names the bug and the number it yields, so
 * a failure message can say which one you probably wrote.
 */
export interface WrongAnswer {
  /** The bug, in one line. */
  bug: string;
  /** The ARV that bug produces, in dollars. */
  arv: number;
}

export interface GoldenExpectation {
  /** Discriminated the same way `CompsOutcome` is. */
  ok: boolean;

  // --- success shape ---------------------------------------------------
  /** Comps surviving the hard filters at the final tier. */
  compsKept?: number;
  /** zpids of the kept set, as a SET — ranked ORDER is asserted in rank.test.ts, not here. */
  keptZpids?: string[];
  /** Per CONTRACT §5.3: final-tier rejections only. */
  rejected?: Array<{ zpid: string; reason: RejectReason }>;
  radiusTierMi?: number;
  /** §14.2 — the recency rung the ladder stopped on. */
  recencyTierMonths?: number;

  /** `n >= 5 ? max(1, floor(n * 0.15)) : 0` — per end. */
  trimCount?: number;
  /** $/sqft that survive the trim, ascending. */
  usedPpsf?: number[];
  /** $/sqft removed by the trim, with which end they came off. */
  trimmedOutPpsf?: Array<{ pricePerSqft: number; end: 'low' | 'high' }>;

  arvPerSqft?: number;
  arv?: number;
  arvLow?: number;
  arvHigh?: number;
  /** SAMPLE standard deviation (n−1) of the trimmed $/sqft. */
  sd?: number;
  cv?: number;
  /**
   * `null` means "cannot be pinned from the contract as written" — see
   * TEST_PLAN.md §8 Q1. Never assert a `null` expectation; leave the test
   * parked and say so out loud.
   */
  confidence?: ArvConfidence | null;

  // --- failure shape ---------------------------------------------------
  code?: CompsFailureCode;
  detail?: { kept?: number; needed?: number; radiusTierMi?: number };

  /** Tolerance for the irrational values (sd, cv, distances). */
  epsilon?: number;
}

export interface GoldenCase {
  id: string;
  title: string;
  /** Injected clock. Nothing pure may call `Date.now()` (CONTRACT §13). */
  now: Date;
  subject: SubjectProperty;
  comps: RawComp[];
  expected: GoldenExpectation;
  /** Bugs this case is specifically built to catch. */
  wrongAnswers: WrongAnswer[];
}
