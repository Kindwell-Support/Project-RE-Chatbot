/**
 * GOLDEN 06 — order of operations: the non-arms-length median is taken over the
 * CANDIDATE set, before the other filters run.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5.3 #10.
 * ===========================================================================
 *
 * CONTRACT §5.3 rule 10 is precise, and the precision is load-bearing:
 *
 *   "ppsf < NON_ARMS_LENGTH_PPSF_FRACTION × median ppsf of the CANDIDATE SET
 *    (all input comps with computable ppsf — soldPrice > 0 and livingArea > 0 —
 *    REGARDLESS OF OTHER FILTERS)"
 *
 * Computing that median over the survivors of rules 1–9 instead is the obvious,
 * natural, tidier-looking implementation. It is also wrong, and this fixture is
 * built so the two orderings disagree by $60,000 with no error on either path.
 *
 * The scenario is ordinary: a street of $190–210/sqft houses, two small
 * teardown-lot sales at $1,000–1,200/sqft (out of the sqft band, so they never
 * become comps — but they ARE real sales and they DO count toward the
 * candidate median), and one $160,000 transfer between family members.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * v2 (CONTRACT §14, ALGO_VERSION 2). The arithmetic below the divider is the
 * v1 derivation and is SUPERSEDED — kept only as the record of what changed.
 * The authoritative hand-derivation for every v2 value in this file is
 * `V2-RECOMPUTE.md` in this directory, which walks the new ladder, the 20%
 * band, the cap at 5, the five-term score and the rebased confidence.
 * ---------------------------------------------------------------------------
 * ---------------------------------------------------------------------------
 * STEP 1 — $/sqft for every input comp (all six have computable $/sqft):
 *   G6-A  400,000 / 2,000 =  200
 *   G6-B  420,000 / 2,000 =  210
 *   G6-C  380,000 / 2,000 =  190
 *   G6-D  1,000,000 / 1,000 = 1000   (1,000 sqft cottage on a teardown lot)
 *   G6-E  1,440,000 / 1,200 = 1200   (same story, next street over)
 *   G6-F  160,000 / 2,000 =   80     (grandmother -> grandson)
 *
 * STEP 2 — rules 1–9. D and E fail rule 4:
 *   sqft band = 2,000 ± 25% = [1500, 2500]; 1,000 and 1,200 are outside
 *   -> SQFT_OUT_OF_RANGE (they pass rules 1–3 first: SOLD, recent, sqft present)
 *   A, B, C and F pass rules 1–9 untouched.
 *
 * STEP 3 — rule 10, THE CONTRACT WAY (candidate set = all six):
 *   sorted [80, 190, 200, 210, 1000, 1200], n = 6 (even)
 *   median = mean of the middle two = (200 + 210) / 2 = 205
 *   threshold = 0.4 × 205 = 82
 *   G6-F at 80 < 82  ->  NON_ARMS_LENGTH. Rejected.
 *   => kept = A, B, C
 *
 * STEP 3' — rule 10, THE WRONG WAY (median over rule-1–9 survivors only):
 *   survivors are A, B, C, F -> sorted [80, 190, 200, 210], n = 4 (even)
 *   median = (190 + 200) / 2 = 195
 *   threshold = 0.4 × 195 = 78
 *   G6-F at 80 >= 78  ->  survives. Not rejected.
 *   => kept = A, B, C, F
 *
 *   Note the mechanism: excluding D and E drags the median DOWN, which drags
 *   the threshold down, which lets the family transfer through. The bug is
 *   self-concealing — the more junk you filter out first, the lower the bar
 *   for what counts as a real sale.
 *
 * STEP 4 — what each ordering produces.
 *   Contract:  ppsf [190, 200, 210], n = 3 -> trimCount 0
 *              mean = 600 / 3 = 200 -> ARV = 200 × 2,000 = $400,000
 *   Wrong way: ppsf [80, 190, 200, 210], n = 4 -> trimCount 0
 *              mean = 680 / 4 = 170 -> ARV = 170 × 2,000 = $340,000
 *
 *   $60,000. No warning, no error, no missing field. The $1 family transfer
 *   quietly takes 15% off the house.
 *
 * STEP 5 — radius tier. 3 kept, never reaches 5, so 0.5 -> 1.0 -> 2.0 and the
 *   2.0 outcome is used. radiusTierMi = 2.0. (D, E and F fail for reasons
 *   unrelated to distance, so no tier ever rescues them.)
 *
 * STEP 6 — spread and confidence.
 *   used [190, 200, 210]; mean 200; deviations −10, 0, +10; Σd² = 200
 *   sample variance = 200 / 2 = 100; sd = 10; cv = 10 / 200 = 0.05
 *   band: 10 × 2,000 = 20,000 -> arvLow 380,000 / arvHigh 420,000
 *   compsUsed = 3 either way -> 'low'. Immune to TEST_PLAN §8 Q1.
 * ---------------------------------------------------------------------------
 */
import type { GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G6-SUBJ',
  address: '640 NORTHWEST ALDER PLACE, SEATTLE, WA 98107',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1953,
  propertyType: 'SFR',
  lastSoldPrice: 262000,
  lastSoldDate: '2012-03-08',
  lat: 47.6,
  lng: -122.3,
};

const comps: RawComp[] = [
  {
    zpid: 'G6-A', address: '644 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 350000, soldDate: '2025-05-16', // 60 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000, // $/sqft 175
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G6-B', address: '648 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 380000, soldDate: '2025-04-16', // 90 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6200, // $/sqft 205
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G6-C', address: '652 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 410000, soldDate: '2025-03-17', // 120 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 5800, // $/sqft 190
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
  {
    // Never a comp — 1,000 sqft is outside the band. But it is a real sale with
    // a real $/sqft, so it belongs in the candidate median.
    zpid: 'G6-D', address: '656 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 1000000, soldDate: '2025-05-16', // 60 d
    beds: 2, baths: 1, livingArea: 1000, lotSize: 6400, // $/sqft 1000
    propertyType: 'SFR', lat: 47.599, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G6-E', address: '660 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 1440000, soldDate: '2025-04-16', // 90 d
    beds: 2, baths: 2, livingArea: 1200, lotSize: 6600, // $/sqft 1200
    propertyType: 'SFR', lat: 47.598, lng: -122.3, // 0.1381882 mi
  },
  {
    // The transfer. Passes rules 1–9 completely — right size, right beds, right
    // type, sold three weeks ago, next door. Only rule 10 stands between it and
    // a $60,000 haircut on the ARV.
    zpid: 'G6-F', address: '664 NORTHWEST ALDER PLACE', status: 'SOLD',
    soldPrice: 156000, soldDate: '2025-06-15', // 30 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6100, // $/sqft 78
    propertyType: 'SFR', lat: 47.597, lng: -122.3, // 0.2072823 mi
  },
];

export const golden06: GoldenCase = {
  id: 'golden-06-non-arms-length-order',
  title: 'order of operations — candidate median rejects the family transfer; post-filter median does not',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    compsKept: 3,
    keptZpids: ['G6-A', 'G6-B', 'G6-C'],
    rejected: [
      { zpid: 'G6-D', reason: 'SQFT_OUT_OF_RANGE' },
      { zpid: 'G6-E', reason: 'SQFT_OUT_OF_RANGE' },
      { zpid: 'G6-F', reason: 'NON_ARMS_LENGTH' },
    ],
    radiusTierMi: 3.0,
    recencyTierMonths: 12,

    trimCount: 0,
    usedPpsf: [175, 190, 205],
    trimmedOutPpsf: [],

    arvPerSqft: 190,
    arv: 380000,
    arvLow: 350000,
    arvHigh: 410000,
    sd: 15,
    cv: 0.0789474,
    confidence: 'low',

    epsilon: 1e-9,
  },
  wrongAnswers: [
    {
      bug: 'candidate median taken over rule-1-9 survivors only (median 195, threshold 78) — transfer survives',
      arv: 324000,
    },
  ],
};

/**
 * A third ordering worth pinning, because it fails in the opposite direction
 * and is just as silent: using the MEAN of the candidate set instead of the
 * median.
 *
 *   mean([80, 190, 200, 210, 1000, 1200]) = 2,880 / 6 = 480
 *   threshold = 0.4 × 480 = 192
 *   -> G6-F (80) rejected, and so is G6-C (190 < 192)
 *   -> only A and B survive -> 2 kept -> TOO_FEW_COMPS, no ARV at all
 *
 * The two teardown sales are exactly why the contract says median: a mean is
 * hostage to them, a median is not. Here that difference is the gap between a
 * correct $400,000 and refusing to answer.
 */
export const golden06MeanInsteadOfMedian = {
  threshold: 192,
  outcome: 'TOO_FEW_COMPS' as const,
  keptZpids: ['G6-A', 'G6-B'],
};
