/**
 * GOLDEN 04 — boundary case, REPURPOSED for v2: both ±20% band edges, and the
 * `>= 5` rung stop, in one fixture.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5/§14.
 * ===========================================================================
 *
 * The v1 version of this case existed for the trim flip at n = 5 (`>= 5` vs
 * `> 5`, a one-character bug worth $4,000). The trim is retired (§14.8), so
 * the fixture is repurposed around the two v2 boundaries its data happens to
 * sit on — deliberately kept, because data that straddles boundaries is
 * expensive to design and this set already does:
 *
 *   1. THE BAND EDGES. Subject 2,000 sqft, band = ±20% => [1600, 2400].
 *      G4-C2 is 1,600 sqft — EXACTLY −20%. G4-C4 is 2,400 — EXACTLY +20%.
 *      The rule rejects OUTSIDE the band, so both must be KEPT. An
 *      implementation that writes `<` for `<=` rejects both, and the damage
 *      is not subtle here: see the counterfactual below. (One dollar — well,
 *      one FOOT — outside, 1,599 and 2,401, is pinned in filter.test.ts, as
 *      is the rejection of the old v1 edges 1,500 and 2,500.)
 *
 *   2. THE RUNG STOP. The walk reaches exactly 5 kept at rung 2 and must
 *      STOP: `kept >= MIN_COMPS_FOR_TIER`, not `>`. Writing `>` widens the
 *      search with nothing in the output saying so.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * v2 (CONTRACT §14, ALGO_VERSION 3). Header rewritten as the v2 derivation;
 * the retired trim/ARV steps are recorded in V2-RECOMPUTE.md.
 * ---------------------------------------------------------------------------
 *
 * STEP 1 — hard filters. All five pass.
 *   sqft band [1600, 2400]: 2000, 1600, 2100, 2400, 1900 — C2 and C4 exactly
 *     on the edges, kept (inclusive).
 *   beds 2-4 vs subject 3; baths 2-3 vs subject 2 — within ±1
 *   NON_ARMS_LENGTH: candidate median (n = 5, odd) of
 *     [150, 190, 200, 210, 260] = 200 -> threshold 0.4 × 200 = 80
 *     the lowest comp is $150/sqft, above 80, so the $150 comp is NOT a
 *     family transfer — it is a genuine tired sale and must be kept. (If it
 *     were filtered, n drops to 4 and the rung walk below changes. Deliberate.)
 *
 * STEP 2 — the LADDER (§14.2). Ages against 2025-07-15:
 *   G4-C1  2025-06-15   30 d = 0.9855 mo
 *   G4-C2  2025-05-16   60 d = 1.9711 mo
 *   G4-C3  2025-04-16   90 d = 2.9566 mo
 *   G4-C4  2025-03-17  120 d = 3.9422 mo   <- outside 3 months
 *   G4-C5  2025-02-15  150 d = 4.9277 mo   <- outside 3 months
 *
 *   rung 1 (1.0/3) -> C1, C2, C3 = 3, short
 *   rung 2 (1.0/6) -> all 5.  5 >= 5 -> STOP.
 *   => radiusTierMi = 1.0, recencyTierMonths = 6, kept = all five.
 *
 * STEP 3 — $/sqft against each comp's own living area:
 *   G4-C1  400,000 / 2,000 = 200
 *   G4-C2  240,000 / 1,600 = 150
 *   G4-C3  441,000 / 2,100 = 210
 *   G4-C4  624,000 / 2,400 = 260
 *   G4-C5  361,000 / 1,900 = 190
 *
 * THE COUNTERFACTUAL that makes the band edges golden-level rather than a
 * unit detail. Under an EXCLUSIVE band (`<` for `<=`), C2 and C4 reject
 * SQFT_OUT_OF_RANGE and the walk becomes:
 *   1.0/3 -> C1, C3 = 2    1.0/6 -> C1, C3, C5 = 3    1.0/12 -> 3
 *   3.0/3 -> 2             3.0/6 -> 3                 3.0/12 -> 3
 *   exhausted -> reports 3.0/12 with THREE comps.
 * So the bug does not shave an edge case off a table — it turns a five-comp
 * answer found close and recent into a three-comp answer reported as a wide,
 * year-deep search. kept 5 vs 3, rung 1.0/6 vs 3.0/12: loudly discriminable,
 * and golden.test.ts asserts both halves.
 *
 * STEPS 4+ — RETIRED with `arv.ts` (§14.8): the trim flip this case was named
 *   for, the $400,000 ARV and the $404,000 no-trim-at-5 wrong answer. Recorded
 *   in V2-RECOMPUTE.md. `expected.arv` and friends remain in the object below
 *   but nothing asserts them.
  */
import type { ArvConfidence, GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G4-SUBJ',
  address: '3410 WEST BIRCH COURT, EVERETT, WA 98201',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1988,
  propertyType: 'SFR',
  lastSoldPrice: 301000,
  lastSoldDate: '2018-02-14',
  lat: 47.6,
  lng: -122.3,
};

const comps: RawComp[] = [
  {
    zpid: 'G4-C1', address: '3414 WEST BIRCH COURT', status: 'SOLD',
    soldPrice: 400000, soldDate: '2025-06-15', // 30 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6100, // $/sqft 200
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    // Tired, dated, sold as-is — genuinely cheap, NOT a family transfer.
    // 150 is well above the 80 non-arms-length threshold, so it survives the
    // filters and gets removed by the trim instead. That distinction is the
    // whole design: filters reject fake sales, the trim discounts real extremes.
    zpid: 'G4-C2', address: '3418 WEST BIRCH COURT', status: 'SOLD',
    soldPrice: 240000, soldDate: '2025-05-16', // 60 d
    beds: 2, baths: 2, livingArea: 1600, lotSize: 5400, // $/sqft 150  <- trimmed (low)
    propertyType: 'SFR', lat: 47.599, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G4-C3', address: '3422 WEST BIRCH COURT', status: 'SOLD',
    soldPrice: 441000, soldDate: '2025-04-16', // 90 d
    beds: 3, baths: 2.5, livingArea: 2100, lotSize: 6600, // $/sqft 210
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G4-C4', address: '3426 WEST BIRCH COURT', status: 'SOLD',
    soldPrice: 624000, soldDate: '2025-03-17', // 120 d
    beds: 4, baths: 3, livingArea: 2400, lotSize: 7800, // $/sqft 260  <- trimmed (high)
    propertyType: 'SFR', lat: 47.598, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G4-C5', address: '3430 WEST BIRCH COURT', status: 'SOLD',
    soldPrice: 361000, soldDate: '2025-02-15', // 150 d
    beds: 3, baths: 2, livingArea: 1900, lotSize: 5800, // $/sqft 190
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
];

export const golden04: GoldenCase = {
  id: 'golden-04-boundary-5',
  title: 'boundary case — exactly 5 comps, trimCount flips to 1, tier must NOT escalate',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    compsKept: 5,
    keptZpids: ['G4-C1', 'G4-C2', 'G4-C3', 'G4-C4', 'G4-C5'],
    rejected: [],
    // v2 (§14.2). The v1 expectation here was `radiusTierMi: 0.5` — a rung
    // that no longer exists; the ladder is [1.0, 3.0] x [3, 6, 12] now.
    //
    // Re-derived by hand against NOW = 2025-07-15, DAYS_PER_MONTH = 30.44:
    //   C1 2025-06-15   30 d = 0.9855 mo
    //   C2 2025-05-16   60 d = 1.9711 mo
    //   C3 2025-04-16   90 d = 2.9567 mo
    //   C4 2025-03-17  120 d = 3.9422 mo   <- outside 3 months
    //   C5 2025-02-15  150 d = 4.9277 mo   <- outside 3 months
    //
    //   rung 1  (1.0 mi /  3 mo) -> 3 kept, short of MIN_COMPS_FOR_TIER
    //   rung 2  (1.0 mi /  6 mo) -> 5 kept, STOP
    //
    // So this case now also pins the FIRST recency widening, and it still
    // lands on exactly 5: `kept >= 5` stops here, `kept > 5` would step out to
    // 12 months and silently widen the search.
    radiusTierMi: 1.0,
    recencyTierMonths: 6,

    trimCount: 1,
    usedPpsf: [190, 200, 210],
    trimmedOutPpsf: [
      { pricePerSqft: 150, end: 'low' },
      { pricePerSqft: 260, end: 'high' },
    ],

    arvPerSqft: 200,
    arv: 400000,
    arvLow: 380000,
    arvHigh: 420000,
    sd: 10,
    cv: 0.05,
    // `compsUsed` = kept count (5), per MASON's ruling in mailbox 0003.
    // 5 >= 4 and cv 0.05 <= 0.25 -> medium. Under the rejected post-trim
    // reading this would be 'low'; see golden04ConfidenceByReading.
    confidence: 'medium',

    epsilon: 1e-9,
  },
  wrongAnswers: [
    { bug: '`n > 5` instead of `n >= 5` — no trim at n=5 (mean of all 5 = 202)', arv: 404000 },
    { bug: 'trims the first/last element of the UNSORTED array (drops 200 and 190)', arv: 413000 },
  ],
};

/**
 * Both readings of `compsUsed`, kept on the record after the ruling.
 *
 * MASON chose the kept-count reading (mailbox 0003), so `expected.confidence`
 * is 'medium'. The rejected reading stays written down for two reasons: the
 * contract text still permits it, and a future refactor that quietly switches
 * to counting post-trim values would turn this case from 'medium' to 'low'
 * with no other visible symptom. A confidence tier is what tells an investor
 * how much weight to put on the number — it deserves a named alternative, not
 * a deleted one.
 */
export const golden04ConfidenceByReading: Record<
  'compsUsed-is-kept-count' | 'compsUsed-is-post-trim-count',
  ArvConfidence
> = {
  'compsUsed-is-kept-count': 'medium', // 5 >= 4, cv 0.05 <= 0.25
  'compsUsed-is-post-trim-count': 'low', // 3 < 4
};
