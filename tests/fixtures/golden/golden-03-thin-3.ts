/**
 * GOLDEN 03 — thin case: exactly 3 comps. The n = 3 floor holds, and the
 * ladder reports the LAST rung it tried.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5/§14.
 * ===========================================================================
 *
 * This case sits on MIN_COMPS_TO_COMPUTE (3) — one comp fewer and the whole
 * thing must refuse to return a comp set (that's golden 05). It also carries a
 * property that is easy to get wrong and impossible to notice:
 *
 *   The reported rung is 3.0 mi / 12 mo even though every comp is within
 *   0.21 mi and none is older than four months. Three comps never reaches
 *   MIN_COMPS_FOR_TIER (5), so the walk exhausts all six rungs, finds the
 *   same three every time, and must report the LAST rung tried — the honest
 *   statement of how hard we searched — not the rung the comps happened to
 *   come from.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * v2 (CONTRACT §14, ALGO_VERSION 3). Header rewritten as the v2 derivation;
 * the retired ARV steps are recorded in V2-RECOMPUTE.md.
 * ---------------------------------------------------------------------------
 *
 * STEP 1 — hard filters. All three pass.
 *   sqft band = 2000 ± 20% => [1600, 2400]: sizes 2000, 1900, 2400 — inside,
 *     with G3-C3 at 2,400 sitting EXACTLY on the +20% edge. The rule rejects
 *     OUTSIDE the band, so the edge is kept (golden 04 carries both edges).
 *   NON_ARMS_LENGTH: candidate median (n = 3, odd) of [190, 200, 240] = 200
 *     threshold = 0.4 × 200 = 80; min $/sqft 190 > 80 -> nothing rejected
 *
 * STEP 2 — the LADDER (§14.2). Ages against 2025-07-15, months = days/30.44:
 *   G3-C1  2025-05-16   60 d = 1.9711 mo
 *   G3-C2  2025-04-16   90 d = 2.9566 mo
 *   G3-C3  2025-03-17  120 d = 3.9422 mo   <- outside 3 months
 *
 *   1.0/3 -> 2   1.0/6 -> 3   1.0/12 -> 3
 *   3.0/3 -> 2   3.0/6 -> 3   3.0/12 -> 3
 *   No rung reaches 5; the walk exhausts and the LAST rung's outcome is used.
 *   => radiusTierMi = 3.0, recencyTierMonths = 12, kept = C1, C2, C3.
 *   3 >= MIN_COMPS_TO_COMPUTE, so this is a SUCCESS.
 *
 * STEP 3 — $/sqft against each comp's own living area:
 *   G3-C1  400,000 / 2,000 = 200
 *   G3-C2  361,000 / 1,900 = 190
 *   G3-C3  576,000 / 2,400 = 240
 *
 *   The 240 is a fifth above its neighbours and it is SHOWN, not trimmed —
 *   there is no trim any more. The member sees the spread and judges it;
 *   that visibility is what replaced the confidence grade.
 *
 * STEPS 4-8 — RETIRED with `arv.ts` (§14.8): trim (this was the trimCount-0
 *   case), the $420,000 ARV, the sample-vs-population sd discriminator that
 *   only this case could catch, and the count-bound `low` confidence. All
 *   recorded in V2-RECOMPUTE.md. `expected.arv` and friends remain in the
 *   object below but nothing asserts them.
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
    radiusTierMi: 3.0,
    recencyTierMonths: 12,

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
