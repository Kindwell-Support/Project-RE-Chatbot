/**
 * GOLDEN 05 — failure case: 2 usable comps. No ARV, under any circumstance.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5 / §10.
 * ===========================================================================
 *
 * The honesty contract, as a fixture. Four comps come back from the provider;
 * two of them are real, recent, arms-length sales of comparable houses. Two
 * comps is genuinely enough to compute an average — that is the danger. The
 * arithmetic is available and it is wrong to use it, so the feature has to
 * decline something it is perfectly capable of doing.
 *
 * If the pipeline ever computes before it checks the count, this returns
 * mean(200, 210) = 205 -> $410,000, which reads exactly like a real answer.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * STEP 1 — hard filters, first-matching reason per CONTRACT §5.3:
 *   $/sqft for the comps that have one, in the same form as the other
 *   fixtures so the header table can be checked against the data:
 *   G5-C1  400,000 / 2,000 = 200
 *   G5-C2  441,000 / 2,100 = 210
 *   G5-C4  380,000 / 1,900 = 200
 *   (G5-C3 has no price, so no $/sqft — it is excluded from the rule-10
 *   candidate median entirely, not counted as a zero.)
 *
 *   G5-C1  SOLD, 60 d, 2,000 sqft, 0.069 mi   -> KEPT   ($/sqft 200)
 *   G5-C2  SOLD, 90 d, 2,100 sqft, 0.138 mi   -> KEPT   ($/sqft 210)
 *   G5-C3  status 'FOR_SALE'                  -> NOT_SOLD (rule 1)
 *          It also has a null soldDate, which would trip STALE_SALE (rule 2)
 *          and a null soldPrice, which would trip PRICE_MISSING (rule 9). The
 *          FIRST matching rule wins, so the reason must be NOT_SOLD.
 *   G5-C4  SOLD 2024-06-10 = 400 days before `now`
 *          400 / 30.44 = 13.1406 months > MAX_COMP_AGE_MONTHS (12)
 *                                            -> STALE_SALE (rule 2)
 *
 *   NON_ARMS_LENGTH candidate median is taken over every comp with a computable
 *   $/sqft, regardless of the other filters (§5.3 rule 10) — that is C1 (200),
 *   C2 (210) and C4 (200); C3 has a null soldPrice so it has no $/sqft and is
 *   excluded from the median entirely. Median of [200, 200, 210] = 200,
 *   threshold 0.4 × 200 = 80. Neither survivor is anywhere near it.
 *
 * STEP 2 — radius tier. C3 and C4 fail for reasons that have nothing to do with
 *   distance, so widening the search cannot rescue them:
 *     0.5 mi -> 2 kept, 2 < 5, escalate
 *     1.0 mi -> 2 kept, 2 < 5, escalate
 *     2.0 mi -> 2 kept, out of tiers -> use this outcome
 *   radiusTierMi = 2.0
 *
 * STEP 3 — the gate. 2 < MIN_COMPS_TO_COMPUTE (3).
 *   => { ok: false, code: 'TOO_FEW_COMPS', algoVersion: 1,
 *        detail: { kept: 2, needed: 3, radiusTierMi: 2.0 } }
 *
 * WHAT MUST NOT HAPPEN, in order of how badly it ends:
 *   - an ARV of $410,000 from the two survivors
 *   - an `arv` field of 0, or null, or NaN, rendered as "$0" / "$NaN"
 *   - a thrown error instead of a CompsFailure
 *   - copy that reports the shortage without offering manual ARV entry (§10)
 *   - `algoVersion` missing because it is only stamped on success (§13 says
 *     every outcome, success or failure)
 * ---------------------------------------------------------------------------
 */
import type { GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G5-SUBJ',
  address: '9 EAST QUARRY ROAD, OMAK, WA 98841',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1969,
  propertyType: 'SFR',
  lastSoldPrice: 198000,
  lastSoldDate: '2009-11-05',
  lat: 47.6,
  lng: -122.3,
};

const comps: RawComp[] = [
  {
    zpid: 'G5-C1', address: '13 EAST QUARRY ROAD', status: 'SOLD',
    soldPrice: 400000, soldDate: '2025-05-16', // 60 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6100, // $/sqft 200
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G5-C2', address: '17 EAST QUARRY ROAD', status: 'SOLD',
    soldPrice: 441000, soldDate: '2025-04-16', // 90 d
    beds: 3, baths: 2.5, livingArea: 2100, lotSize: 6400, // $/sqft 210
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    // Still on the market. Trips three rules; must report the first one.
    zpid: 'G5-C3', address: '21 EAST QUARRY ROAD', status: 'FOR_SALE',
    soldPrice: null, soldDate: null,
    beds: 3, baths: 2, livingArea: 1950, lotSize: 6000,
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
  {
    // Sold 400 days ago — 13.14 months against a 12-month wall.
    zpid: 'G5-C4', address: '25 EAST QUARRY ROAD', status: 'SOLD',
    soldPrice: 380000, soldDate: '2024-06-10', // 400 d -> 13.1406 mo
    beds: 3, baths: 2, livingArea: 1900, lotSize: 5900, // $/sqft 200
    propertyType: 'SFR', lat: 47.599, lng: -122.3, // 0.0690941 mi
  },
];

export const golden05: GoldenCase = {
  id: 'golden-05-too-few-2',
  title: 'failure case — 2 usable comps, no ARV, TOO_FEW_COMPS with manual entry offered',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: false,
    code: 'TOO_FEW_COMPS',
    detail: { kept: 2, needed: 3, radiusTierMi: 3.0 },
    compsKept: 2,
    radiusTierMi: 3.0,
    recencyTierMonths: 12,
    rejected: [
      { zpid: 'G5-C3', reason: 'NOT_SOLD' },
      { zpid: 'G5-C4', reason: 'STALE_SALE' },
    ],
  },
  wrongAnswers: [
    { bug: 'computes the ARV before checking the count — mean(200, 210) = 205', arv: 410000 },
  ],
};

/**
 * Zero comps: the same gate, one step further out, and the one that produces
 * `NaN` rather than a wrong number if `mean([])` is ever reached.
 *
 * `mean([])` is `0/0` = NaN. NaN renders as "$NaN" if you are lucky and
 * coerces to 0 — "your ARV is $0" — if you are not. Neither is acceptable and
 * both are one missing guard away.
 */
export const golden05Empty: GoldenCase = {
  id: 'golden-05b-empty',
  title: 'failure case — provider returns zero comps, no NaN escapes',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps: [],
  expected: {
    ok: false,
    code: 'TOO_FEW_COMPS',
    detail: { kept: 0, needed: 3, radiusTierMi: 3.0 },
    compsKept: 0,
    radiusTierMi: 3.0,
    recencyTierMonths: 12,
    rejected: [],
  },
  wrongAnswers: [
    { bug: 'mean([]) = NaN reaching the output and coercing to 0', arv: 0 },
  ],
};
