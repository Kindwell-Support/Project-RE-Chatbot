/**
 * GOLDEN 02 — outlier case, REDESIGNED for v2 (CONTRACT §14).
 *
 * ===========================================================================
 * ALL EXPECTED VALUES COMPUTED BY HAND FROM CONTRACT §14. Verify the
 * arithmetic, not the code.
 * ===========================================================================
 *
 * WHY THIS CASE WAS REBUILT RATHER THAN RECOMPUTED
 *
 * The v1 version proved "the trim neutralises a 3x outlier". Under v2 the cap
 * fell from 8 to 5, and when the v1 data was recomputed the outlier was
 * **capped out at rank 6 — before the trim ever saw it**. The case still
 * produced a correct ARV while no longer testing the thing its name claimed,
 * which is precisely the failure this dataset exists to prevent.
 *
 * So the outlier is now built to SURVIVE ranking. G2-O is the best-scoring comp
 * in the set: same street, identical sqft, identical lot, identical beds and
 * baths, most recent sale. It differs on ONE dimension — price — and price is
 * not a scored term. It cannot be capped out, so the trim is demonstrably the
 * only thing standing between it and the ARV.
 *
 * That is also the more realistic scenario: a gut-and-rebuild next door is
 * identical on every public attribute and sells for triple.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * STEP 1 — the ladder (§14.2). All six comps are within 1.0 mi and sold within
 * 3 months, so rung 1 (1.0 mi / 3 mo) yields 6 kept, which is >= 5.
 * The ladder STOPS at the first rung: radiusTierMi 1.0, recencyTierMonths 3.
 *
 * STEP 2 — scoring (§14.3: 35 distance / 25 sqft / 20 recency / 10 bedbath /
 * 10 lot). Distances are pure-latitude offsets (69.09409447 mi per degree),
 * ages are days / 30.44.
 *
 *   G2-O  2.4183 +  0     + 1.6426 + 0  + 0      =  4.0609   <- BEST
 *   G2-A  4.8366 +  0     + 1.6426 + 0  + 0      =  6.4792
 *   G2-B  4.8366 +  3.125 + 3.2852 + 0  + 0.1667 = 11.4135
 *   G2-C  7.2549 +  3.125 + 3.2852 + 0  + 0.1667 = 13.8318
 *   G2-D  7.2549 +  6.25  + 4.9277 + 0  + 0.5    = 18.9326
 *   G2-E 24.5    + 21.875 + 4.9277 + 10 + 4.1667 = 65.4694   <- WORST
 *
 * STEP 3 — cap at MAX_COMPS_KEPT = 5. G2-E is dropped. **The outlier is kept.**
 *
 * STEP 4 — $/sqft of the kept five, each against its own living area:
 *   G2-A  392,000 / 2,000 = 196
 *   G2-B  420,250 / 2,050 = 205
 *   G2-C  419,250 / 1,950 = 215
 *   G2-D  472,500 / 2,100 = 225
 *   G2-O  1,200,000 / 2,000 = 600      <- the rebuild
 *
 * STEP 5 — trim. n = 5, so trimCount = max(1, floor(5 x 0.15)) = max(1, 0) = 1.
 *   sorted [196, 205, 215, 225, 600]
 *   drop one from each end -> trimmedOut = 196 (low), 600 (high)
 *   used = [205, 215, 225]                (three values, per §14.4)
 *
 * STEP 6 — ARV.
 *   sum 645 / 3 = 215 $/sqft
 *   215 x 2,000 = 430,000 -> round(430.000) x 1,000 = $430,000
 *
 *   THE NUMBER THIS CASE EXISTS FOR:
 *     untrimmed mean = (196+205+215+225+600) / 5 = 1,441 / 5 = 288.2
 *     untrimmed ARV  = 288.2 x 2,000 = $576,400 -> $576,000
 *   $146,000 apart. Both are numbers a chatbot prints without blinking; only
 *   one of them is a house on this street.
 *
 * STEP 7 — spread (sample, n-1 over the TRIMMED set).
 *   mean 215; deviations -10, 0, +10; Sd2 = 200; variance 200/2 = 100; sd = 10
 *   cv = 10 / 215 = 0.0465116
 *   band: 10 x 2,000 = 20,000 -> arvLow 410,000 / arvHigh 450,000
 *
 * STEP 8 — confidence (§14.4). compsUsed = 5 (kept count) >= 5;
 *   cv 0.0465 <= 0.15; median distance 0.1381882 <= 0.75; median age
 *   1.9710907 <= 6  =>  **high**.
 *
 * NON_ARMS_LENGTH check: candidate median over all six $/sqft
 *   [196, 200, 205, 215, 225, 600] (even n) = (205 + 215) / 2 = 210;
 *   threshold 0.4 x 210 = 84. The lowest is 196. Nothing is rejected — the
 *   outlier is a genuine arms-length sale, which is why the trim has to handle
 *   it rather than the filters.
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
    // THE REBUILD. Identical to the subject on every SCORED dimension —
    // same sqft, same lot, same beds/baths, closest, most recent — and triple
    // the price. Best-scoring comp in the set, so the cap cannot remove it and
    // only the trim can.
    zpid: 'G2-O', address: '484 EAST PINE STREET', status: 'SOLD',
    soldPrice: 1200000, soldDate: '2025-06-15', // 30 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000, // $/sqft 600  <- trimmed (high)
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G2-A', address: '488 EAST PINE STREET', status: 'SOLD',
    soldPrice: 392000, soldDate: '2025-06-15', // 30 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000, // $/sqft 196  <- trimmed (low)
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G2-B', address: '492 EAST PINE STREET', status: 'SOLD',
    soldPrice: 420250, soldDate: '2025-05-16', // 60 d
    beds: 3, baths: 2, livingArea: 2050, lotSize: 6100, // $/sqft 205
    propertyType: 'SFR', lat: 47.598, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G2-C', address: '496 EAST PINE STREET', status: 'SOLD',
    soldPrice: 419250, soldDate: '2025-05-16', // 60 d
    beds: 3, baths: 2, livingArea: 1950, lotSize: 5900, // $/sqft 215
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
  {
    zpid: 'G2-D', address: '500 EAST PINE STREET', status: 'SOLD',
    soldPrice: 472500, soldDate: '2025-04-16', // 90 d
    beds: 3, baths: 2, livingArea: 2100, lotSize: 6300, // $/sqft 225
    propertyType: 'SFR', lat: 47.597, lng: -122.3, // 0.2072823 mi
  },
  {
    // Deliberately the worst comp on every scored dimension, so the cap has
    // something to remove that is NOT the outlier. Far, wrong size, wrong
    // bed/bath, biggest lot delta.
    zpid: 'G2-E', address: '504 EAST PINE STREET', status: 'SOLD',
    soldPrice: 330000, soldDate: '2025-04-16', // 90 d
    beds: 4, baths: 3, livingArea: 1650, lotSize: 8500, // $/sqft 200
    propertyType: 'SFR', lat: 47.61013, lng: -122.3, // 0.7 mi
  },
];

export const golden02: GoldenCase = {
  id: 'golden-02-outlier-6',
  title: 'outlier case — a 3x rebuild that SURVIVES ranking, so only the trim can remove it',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    compsKept: 5,
    keptZpids: ['G2-O', 'G2-A', 'G2-B', 'G2-C', 'G2-D'],
    rejected: [],
    radiusTierMi: 1.0,
    recencyTierMonths: 3,

    trimCount: 1,
    usedPpsf: [205, 215, 225],
    trimmedOutPpsf: [
      { pricePerSqft: 196, end: 'low' },
      { pricePerSqft: 600, end: 'high' },
    ],

    arvPerSqft: 215,
    arv: 430000,
    arvLow: 410000,
    arvHigh: 450000,
    sd: 10,
    cv: 0.0465116,
    confidence: 'high',

    epsilon: 1e-6,
  },
  wrongAnswers: [
    { bug: 'no trim — the rebuild goes straight into the mean (1441/5 = 288.2)', arv: 576000 },
    { bug: 'trimCount uses floor(5 x 0.15) = 0 without the max(1, .)', arv: 576000 },
  ],
};

/**
 * The counterfactual this case exists to assert, kept as an exported constant
 * so a test can state it rather than recompute it.
 */
export const golden02UntrimmedArv = 576000;

/**
 * The v1 failure mode, recorded so it cannot quietly return: if MAX_COMPS_KEPT
 * ever rises again, or if the outlier is edited to score badly, it gets capped
 * out at rank 6 and this case silently stops testing the trim. A test asserts
 * `G2-O` is in `keptZpids` for exactly that reason.
 */
export const golden02OutlierMustSurviveRanking = 'G2-O';
