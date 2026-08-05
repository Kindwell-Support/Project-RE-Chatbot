/**
 * GOLDEN 03 — thin case: exactly 3 comps. ARV is computed, trimCount is 0,
 * confidence is `low`.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5.
 * ===========================================================================
 *
 * This case sits on MIN_COMPS_TO_COMPUTE (3) — one comp fewer and the whole
 * thing must refuse to produce a number (that's golden 05). It also carries two
 * properties that are easy to get wrong and impossible to notice:
 *
 *   1. radiusTierMi is 2.0, not 0.5, even though every comp is within 0.21 mi.
 *      Three comps never reaches MIN_COMPS_FOR_TIER (5), so the pass escalates
 *      0.5 -> 1.0 -> 2.0, finds the same three every time, and falls through to
 *      "use the 2.0 mi outcome". Reporting 0.5 here — the tier the comps
 *      actually came from — is the natural bug and it materially misleads the
 *      user about how hard we had to search.
 *
 *   2. Confidence is `low` because of the COMP COUNT, even though cv (0.126),
 *      median distance (0.138 mi) and median age (2.96 mo) would all clear the
 *      `high` bar. The count clause has to bind on its own.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * STEP 1 — hard filters. All three pass.
 *   sqft band [1500, 2500]: 2000, 1900, 2400 — inside
 *   NON_ARMS_LENGTH: candidate median (n = 3, odd) of [190, 200, 240] = 200
 *     threshold = 0.4 × 200 = 80; min $/sqft 190 > 80 -> nothing rejected
 *   => 3 kept.
 *
 * STEP 2 — radius tier.
 *   0.5 mi -> 3 kept, 3 < 5, escalate
 *   1.0 mi -> 3 kept, 3 < 5, escalate
 *   2.0 mi -> 3 kept, no tiers left -> use this outcome
 *   radiusTierMi = 2.0
 *
 * STEP 3 — $/sqft against each comp's own living area:
 *   G3-C1  400,000 / 2,000 = 200
 *   G3-C2  361,000 / 1,900 = 190
 *   G3-C3  576,000 / 2,400 = 240
 *
 * STEP 4 — trim.
 *   n = 3. The rule is `n >= 5 ? max(1, floor(n * 0.15)) : 0`, so the ternary
 *   short-circuits and trimCount = 0. All three values are used.
 *
 *   Note what the max() would have done if the n ≥ 5 guard were dropped:
 *   max(1, floor(3 × 0.15)) = max(1, 0) = 1, which would trim a 3-element set
 *   down to a ONE-element "mean". The values below are deliberately asymmetric
 *   so that mistake changes the answer — see wrongAnswers.
 *
 * STEP 5 — ARV.
 *   sum = 190 + 200 + 240 = 630
 *   arvPerSqft = 630 / 3 = 210
 *   arv = round(210 × 2,000 / 1,000) × 1,000 = round(420.000) × 1,000 = 420,000
 *
 * STEP 6 — spread (sample, n−1).
 *   mean 210; deviations −20, −10, +30
 *   squares 400, 100, 900  ->  Σd² = 1,400
 *   sample variance = 1,400 / (3 − 1) = 700
 *   sd = √700 = 26.4575131
 *   cv = 26.4575131 / 210 = 0.1259882
 *
 *   (Population sd would be √(1400/3) = 21.6024690 -> a $43,000 band instead of
 *   $53,000. THIS case discriminates sample-vs-population where golden 01
 *   could not, because the difference survives the $1,000 rounding.)
 *
 * STEP 7 — band.
 *   sd × 2,000 = 26.4575131 × 2,000 = 52,915.026
 *   round(52.915026) × 1,000 = 53 × 1,000 = 53,000
 *   arvLow  = 420,000 − 53,000 = 367,000
 *   arvHigh = 420,000 + 53,000 = 473,000
 *
 * STEP 8 — confidence.
 *   compsUsed = 3 under EITHER reading of TEST_PLAN §8 Q1 (kept 3, post-trim 3),
 *   so this case is immune to that ambiguity.
 *   high needs ≥ 6 -> fails.  medium needs ≥ 4 -> fails.  => 'low'
 *   `low` still returns numbers (CONTRACT §5.5) — the rendered copy is what has
 *   to carry the warning, and that is asserted in the format specs, not here.
 * ---------------------------------------------------------------------------
 */
import type { GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G3-SUBJ',
  address: '77 SOUTH CEDAR LANE, TACOMA, WA 98402',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1974,
  propertyType: 'SFR',
  lastSoldPrice: 255000,
  lastSoldDate: '2011-06-30',
  lat: 47.6,
  lng: -122.3,
};

const comps: RawComp[] = [
  {
    zpid: 'G3-C1', address: '81 SOUTH CEDAR LANE', status: 'SOLD',
    soldPrice: 400000, soldDate: '2025-05-16', // 60 d -> 1.9710907 mo
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6100, // $/sqft 200
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G3-C2', address: '85 SOUTH CEDAR LANE', status: 'SOLD',
    soldPrice: 361000, soldDate: '2025-04-16', // 90 d -> 2.9566360 mo
    beds: 3, baths: 2, livingArea: 1900, lotSize: 5900, // $/sqft 190
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G3-C3', address: '89 SOUTH CEDAR LANE', status: 'SOLD',
    soldPrice: 576000, soldDate: '2025-03-17', // 120 d -> 3.9421814 mo
    beds: 4, baths: 3, livingArea: 2400, lotSize: 7400, // $/sqft 240
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
];

export const golden03: GoldenCase = {
  id: 'golden-03-thin-3',
  title: 'thin case — exactly 3 comps, trimCount 0, low confidence, tier falls through to 2.0',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    compsKept: 3,
    keptZpids: ['G3-C1', 'G3-C2', 'G3-C3'],
    rejected: [],
    // NOT 0.5 — see the header. Three comps never satisfies a tier, so the
    // search runs out of tiers and reports the last one it tried.
    radiusTierMi: 2.0,

    trimCount: 0,
    usedPpsf: [190, 200, 240],
    trimmedOutPpsf: [],

    arvPerSqft: 210,
    arv: 420000,
    arvLow: 367000,
    arvHigh: 473000,
    sd: 26.4575131,
    cv: 0.1259882,
    confidence: 'low',

    epsilon: 1e-6,
  },
  wrongAnswers: [
    { bug: 'trims at n=3 (drops the `n >= 5` guard, keeps max(1, .)) -> mean of [200] alone', arv: 400000 },
    { bug: 'uses the median of the $/sqft rather than the mean', arv: 400000 },
  ],
};

/** Population (n) instead of sample (n−1) sd — survives rounding here. */
export const golden03PopulationSdBand = { arvLow: 377000, arvHigh: 463000 };
