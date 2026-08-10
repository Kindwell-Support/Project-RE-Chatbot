/**
 * GOLDEN 04 — boundary case: exactly 5 comps, where trimCount flips from 0 to 1.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5.
 * ===========================================================================
 *
 * This is the single most important case in the set, and the reason is worth
 * spelling out.
 *
 *   trimCount = n >= 5 ? max(1, floor(n * 0.15)) : 0
 *
 * At n = 5 that reads max(1, floor(0.75)) = max(1, 0) = 1. Write `n > 5`
 * instead of `n >= 5` — a single character — and trimCount becomes 0. The
 * feature does not crash. It does not warn. It returns $404,000 instead of
 * $400,000, and both of those are a perfectly believable price for the house.
 * Nothing anywhere downstream can tell them apart. The only thing that ever
 * catches it is a test that knew the answer in advance.
 *
 * It also pins the radius tier's OTHER edge: exactly 5 comps at 0.5 mi is
 * exactly MIN_COMPS_FOR_TIER, so the search must STOP. Escalating here would
 * quietly widen the search to a mile and pull in comps that shouldn't count.
 *
 * Subject: 2,000 sqft, 3 bed / 2 bath, SFR, lot 6,000. `now` = 2025-07-15Z.
 *
 * ---------------------------------------------------------------------------
 * STEP 1 — hard filters. All five pass.
 *   sqft band [1500, 2500]: 2000, 1600, 2100, 2400, 1900 — inside
 *   beds 2–4 vs subject 3; baths 2–3 vs subject 2 — within ±1
 *   sold 30–150 days ago, all well inside the 365.28-day wall
 *   NON_ARMS_LENGTH: candidate median (n = 5, odd) of
 *     [150, 190, 200, 210, 260] = 200 -> threshold 0.4 × 200 = 80
 *     the lowest comp is $150/sqft, comfortably above 80, so the $150 comp is
 *     NOT a family transfer — it is a genuine tired sale, and it must reach the
 *     trim rather than being filtered out. (If it were filtered, n would drop to
 *     4, trimCount to 0, and the answer would change. This is deliberate.)
 *   => 5 kept.
 *
 * STEP 2 — radius tier.
 *   0.5 mi -> 5 kept. 5 >= MIN_COMPS_FOR_TIER (5) -> STOP.
 *   radiusTierMi = 0.5. This is the "must NOT escalate" half of the tier rule;
 *   golden 03 is the "must fall through" half.
 *
 * STEP 3 — $/sqft against each comp's own living area:
 *   G4-C1  400,000 / 2,000 = 200
 *   G4-C2  240,000 / 1,600 = 150
 *   G4-C3  441,000 / 2,100 = 210
 *   G4-C4  624,000 / 2,400 = 260
 *   G4-C5  361,000 / 1,900 = 190
 *
 * STEP 4 — trim. THE FLIP.
 *   n = 5; 5 >= 5, so trimCount = max(1, floor(5 × 0.15))
 *                              = max(1, floor(0.75)) = max(1, 0) = 1
 *   SORT: [150, 190, 200, 210, 260]
 *   drop one from each end -> trimmedOut = 150 (low), 260 (high)
 *   used = [190, 200, 210]                     (3 values)
 *
 * STEP 5 — ARV.
 *   sum(used) = 190 + 200 + 210 = 600
 *   arvPerSqft = 600 / 3 = 200
 *   arv = round(200 × 2,000 / 1,000) × 1,000 = round(400.000) × 1,000 = 400,000
 *
 *   THE OFF-BY-ONE, PRICED:
 *     trimCount 0 -> mean of all five = (150+190+200+210+260) / 5
 *                                     = 1,010 / 5 = 202
 *                 -> ARV = 202 × 2,000 = $404,000
 *   $4,000 apart. Both plausible. One is right.
 *
 * STEP 6 — spread (sample, n−1).
 *   used mean 200; deviations −10, 0, +10
 *   squares 100, 0, 100  ->  Σd² = 200
 *   sample variance = 200 / (3 − 1) = 100
 *   sd = √100 = 10
 *   cv = 10 / 200 = 0.05
 *
 * STEP 7 — band.
 *   sd × 2,000 = 20,000 -> round(20.000) × 1,000 = 20,000
 *   arvLow  = 400,000 − 20,000 = 380,000
 *   arvHigh = 400,000 + 20,000 = 420,000
 *
 * STEP 8 — confidence. RESOLVED by MASON, mailbox 0003 (slice 2 handoff):
 *   "`compsUsed` = kept/ranked count, NOT the post-trim count."
 *
 *   This was the one case that could not be made neutral to that ambiguity,
 *   because being on the boundary is its whole purpose:
 *
 *     ruling  — compsUsed = kept count = 5
 *       high needs ≥ 6 -> no. medium needs ≥ 4 and cv ≤ 0.25 -> 5 ✓, 0.05 ✓
 *       => 'medium'                                        <- asserted
 *     rejected — compsUsed = post-trim count = 3
 *       high needs ≥ 6 -> no. medium needs ≥ 4 -> no.
 *       => 'low'
 *
 *   The ruling arrived in a mailbox message, not in CONTRACT.md, so the
 *   contract text is still ambiguous on its face. Asking MASON to amend §4 —
 *   see TEST_PLAN.md §8 Q1. Until he does, this comment is the only written
 *   record of why 'medium' and not 'low', which is exactly the fragility worth
 *   fixing.
 * ---------------------------------------------------------------------------
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
