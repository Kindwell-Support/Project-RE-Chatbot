/**
 * GOLDEN 02 — outlier case: 6 comps, one new build at 3× the neighbourhood
 * $/sqft. The trim must neutralise it.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5.
 * ===========================================================================
 *
 * This is the case the whole trimmed-mean design exists for. G2-C2 is a
 * gut-and-rebuild that sold at $600/sqft on a street where everything else
 * trades at $180–210. It is a genuine, arms-length, recent, nearby, same-type
 * sale — it passes every one of the eleven hard filters, and it SHOULD. The
 * only thing standing between it and a $530,000 ARV on a $405,000 house is the
 * trim.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * STEP 1 — hard filters. All six pass.
 *   sqft band [1500, 2500]: 2100, 1600, 1900, 2200, 2000, 1800 — all inside
 *   beds 2–4 vs subject 3; baths 2–2.5 vs subject 2 — all within ±1
 *   sold 210–270 days ago; the 12-month wall is 12 × 30.44 = 365.28 days
 *   lots 5,000–7,000 vs the 5 × 6,000 = 30,000 ceiling
 *   NON_ARMS_LENGTH: candidate median (n = 6, even) = mean of the middle two
 *     of [180, 195, 200, 205, 210, 600] = (200 + 205) / 2 = 202.5
 *     threshold = 0.4 × 202.5 = 81; min $/sqft is 180 > 81 -> nothing rejected.
 *     Note the outlier RAISES the median slightly and still rejects nobody.
 *   => 6 kept.
 *
 * STEP 2 — radius tier. 6 ≥ MIN_COMPS_FOR_TIER (5) -> stop at 0.5 mi.
 *
 * STEP 3 — $/sqft against each comp's own living area:
 *   G2-C1  420,000 / 2,100 = 200
 *   G2-C2  960,000 / 1,600 = 600   <- the new build
 *   G2-C3  342,000 / 1,900 = 180
 *   G2-C4  462,000 / 2,200 = 210
 *   G2-C5  390,000 / 2,000 = 195
 *   G2-C6  369,000 / 1,800 = 205
 *
 * STEP 4 — trim.
 *   n = 6; trimCount = max(1, floor(6 × 0.15)) = max(1, floor(0.9))
 *                    = max(1, 0) = 1
 *   ^ this is the max() doing the work. floor(0.9) is 0; without the max(),
 *     n = 6 would not trim at all and the outlier would go straight through.
 *   SORT: [180, 195, 200, 205, 210, 600]
 *   drop one from each end -> trimmedOut = 180 (low), 600 (high)
 *   used = [195, 200, 205, 210]                (4 values)
 *
 * STEP 5 — ARV.
 *   sum(used) = 195 + 200 + 205 + 210 = 810
 *   arvPerSqft = 810 / 4 = 202.5
 *   arv_raw    = 202.5 × 2,000 = 405,000
 *   arv        = round(405.000) × 1,000 = 405,000
 *
 *   WITH vs WITHOUT the trim — the number this case exists to prove:
 *     untrimmed mean = (180+195+200+205+210+600) / 6 = 1,590 / 6 = 265
 *     untrimmed ARV  = 265 × 2,000 = 530,000
 *   $530,000 against $405,000. A $125,000 error, delivered with no warning,
 *   on a house that is worth the smaller number.
 *
 * STEP 6 — spread (sample, n−1).
 *   used mean 202.5; deviations −7.5, −2.5, +2.5, +7.5
 *   squares 56.25, 6.25, 6.25, 56.25  ->  Σd² = 125
 *   sample variance = 125 / (4 − 1) = 41.6666667
 *   sd = √41.6666667 = 6.4549722
 *   cv = 6.4549722 / 202.5 = 0.0318764
 *
 * STEP 7 — band.
 *   sd × 2,000 = 12,909.944 -> round(12.909944) × 1,000 = 13,000
 *   arvLow  = 405,000 − 13,000 = 392,000
 *   arvHigh = 405,000 + 13,000 = 418,000
 *
 * STEP 8 — confidence.
 *   monthsAgo = days / 30.44:
 *     210 d -> 6.8988173    220 d -> 7.2273325    240 d -> 7.8843626
 *     250 d -> 8.2128778    260 d -> 8.5413929    270 d -> 8.8699080
 *   median of 6 = (7.8843626 + 8.2128778) / 2 = 8.0486202 months.
 *   That is > 6, so `high` fails its median-age clause outright — which makes
 *   this case immune to TEST_PLAN §8 Q1 (`compsUsed` = 4 post-trim or 6 kept;
 *   both clear the `medium` bar of 4, and `high` is already out).
 *   medium: compsUsed ≥ 4 ✓ and cv 0.0318764 ≤ 0.25 ✓
 *   => confidence = 'medium'
 *
 * ---------------------------------------------------------------------------
 * Fixture order is [200, 600, 180, 210, 195, 205] — not sorted, so trimming
 * the array as given (dropping 200 and 205) leaves [600, 180, 210, 195],
 * mean 296.25, ARV $592,500 -> $593,000. Wrong in the loudest possible way,
 * which is the good outcome.
 * ---------------------------------------------------------------------------
 */
import type { GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G2-SUBJ',
  address: '480 EAST PINE STREET, SEATTLE, WA 98122',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1962,
  propertyType: 'SFR',
  lastSoldPrice: 289000,
  lastSoldDate: '2014-08-19',
  lat: 47.6,
  lng: -122.3,
};

const comps: RawComp[] = [
  {
    zpid: 'G2-C1', address: '484 EAST PINE STREET', status: 'SOLD',
    soldPrice: 420000, soldDate: '2024-12-17', // 210 d
    beds: 3, baths: 2, livingArea: 2100, lotSize: 6200, // $/sqft 200
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    // The new build. Torn to studs, rebuilt, sold at triple the street's rate.
    // Passes every hard filter — correctly. The trim is what saves us.
    zpid: 'G2-C2', address: '488 EAST PINE STREET', status: 'SOLD',
    soldPrice: 960000, soldDate: '2024-12-07', // 220 d
    beds: 3, baths: 2, livingArea: 1600, lotSize: 5000, // $/sqft 600  <- trimmed (high)
    propertyType: 'SFR', lat: 47.599, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G2-C3', address: '492 EAST PINE STREET', status: 'SOLD',
    soldPrice: 342000, soldDate: '2024-11-17', // 240 d
    beds: 3, baths: 2, livingArea: 1900, lotSize: 6400, // $/sqft 180  <- trimmed (low)
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G2-C4', address: '496 EAST PINE STREET', status: 'SOLD',
    soldPrice: 462000, soldDate: '2024-11-07', // 250 d
    beds: 4, baths: 2.5, livingArea: 2200, lotSize: 7000, // $/sqft 210
    propertyType: 'SFR', lat: 47.598, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G2-C5', address: '500 EAST PINE STREET', status: 'SOLD',
    soldPrice: 390000, soldDate: '2024-10-28', // 260 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000, // $/sqft 195
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
  {
    zpid: 'G2-C6', address: '504 EAST PINE STREET', status: 'SOLD',
    soldPrice: 369000, soldDate: '2024-10-18', // 270 d
    beds: 2, baths: 2, livingArea: 1800, lotSize: 5600, // $/sqft 205
    propertyType: 'SFR', lat: 47.597, lng: -122.3, // 0.2072823 mi
  },
];

export const golden02: GoldenCase = {
  id: 'golden-02-outlier-6',
  title: 'outlier case — 6 comps, one at 3x $/sqft, trim must neutralise it',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    compsKept: 6,
    keptZpids: ['G2-C1', 'G2-C2', 'G2-C3', 'G2-C4', 'G2-C5', 'G2-C6'],
    rejected: [],
    radiusTierMi: 0.5,

    trimCount: 1,
    usedPpsf: [195, 200, 205, 210],
    trimmedOutPpsf: [
      { pricePerSqft: 180, end: 'low' },
      { pricePerSqft: 600, end: 'high' },
    ],

    arvPerSqft: 202.5,
    arv: 405000,
    arvLow: 392000,
    arvHigh: 418000,
    sd: 6.4549722,
    cv: 0.0318764,
    confidence: 'medium',

    epsilon: 1e-6,
  },
  wrongAnswers: [
    { bug: 'no trim — outlier goes straight into the mean (1590/6 = 265)', arv: 530000 },
    { bug: 'trimCount uses floor(6 x 0.15) = 0 without the max(1, .)', arv: 530000 },
    { bug: 'trims the first/last element of the UNSORTED array', arv: 593000 },
  ],
};

/**
 * The assertion that gives this case its teeth, stated plainly:
 *
 *   ARV computed WITH the outlier included  = $530,000
 *   ARV computed with the trim doing its job = $405,000
 *
 * Both are numbers a chatbot would print without blinking. Only one of them is
 * a house on this street. A test that merely asserts `arv === 405000` proves
 * the trim ran; asserting the $530,000 counterfactual separately proves the
 * trim MATTERED on this data, which is what stops the case rotting into a
 * tautology if the fixture is ever edited.
 */
export const golden02UntrimmedArv = 530000;
