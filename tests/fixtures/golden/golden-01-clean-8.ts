/**
 * GOLDEN 01 — clean case: 8 tight comps, tight spread, `high` confidence.
 *
 * ===========================================================================
 * ALL EXPECTED VALUES BELOW WERE COMPUTED BY HAND FROM CONTRACT.md §5.
 * Nothing here was read out of an implementation. Verify the arithmetic, not
 * the code. If the code disagrees with this file, one of them is wrong and the
 * conversation is worth having.
 * ===========================================================================
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
 * STEP 1 — hard filters (CONTRACT §5.3). Every comp passes all eleven:
 *   status SOLD · sold 30–120 days ago (≤ 12 mo) · sqft present
 *   sqft band = 2000 ± 25%  =>  [1500, 2500]; all eight are inside
 *   |Δbeds| ≤ 1 (comps are 2/3/4 against subject 3)
 *   |Δbaths| ≤ 1 (comps are 2/2.5/3 against subject 2)
 *   all SFR · all within 0.28 mi of a 0.5 mi tier · all prices > 0
 *   lots 5,200–8,000 vs 5 × 6,000 = 30,000 ceiling
 *   NON_ARMS_LENGTH: candidate median $/sqft (n = 8, even)
 *     = mean of middle two of [190,195,198,200,202,205,208,215]
 *     = (200 + 202) / 2 = 201  ->  threshold = 0.4 × 201 = 80.4
 *     min $/sqft is 190 > 80.4, so nothing is rejected.
 *   => 8 kept.
 *
 * STEP 2 — radius tier (CONTRACT §5.3). 8 kept at 0.5 mi ≥ MIN_COMPS_FOR_TIER
 *   (5), so the pass STOPS at the first tier. radiusTierMi = 0.5.
 *   8 kept also sits exactly on MAX_COMPS_KEPT = 8, so the cap drops nothing
 *   and the ARV does not depend on the ranked order.
 *
 * STEP 3 — $/sqft, per comp, against the COMP's living area (not the
 * subject's, not the lot):
 *   G1-C1  400,000 / 2,000 = 200
 *   G1-C2  409,500 / 2,100 = 195
 *   G1-C3  342,000 / 1,800 = 190
 *   G1-C4  376,200 / 1,900 = 198
 *   G1-C5  344,000 / 1,600 = 215
 *   G1-C6  358,750 / 1,750 = 205
 *   G1-C7  468,000 / 2,250 = 208
 *   G1-C8  444,400 / 2,200 = 202
 *
 * STEP 4 — trim (CONTRACT §5.5).
 *   n = 8; n ≥ 5, so trimCount = max(1, floor(8 × 0.15))
 *                             = max(1, floor(1.2)) = max(1, 1) = 1
 *   SORT first: [190, 195, 198, 200, 202, 205, 208, 215]
 *   drop 1 from each end -> trimmedOut = 190 (low), 215 (high)
 *   used = [195, 198, 200, 202, 205, 208]        (6 values)
 *
 * STEP 5 — ARV.
 *   sum(used) = 195+198+200+202+205+208 = 1,208
 *   arvPerSqft = 1,208 / 6 = 201.333333…
 *   arv_raw    = 201.333333… × 2,000 = 402,666.6667
 *   arv        = round(402,666.6667 / 1,000) × 1,000
 *              = round(402.6666667) × 1,000 = 403 × 1,000 = 403,000
 *
 * STEP 6 — spread. SAMPLE standard deviation, n−1 denominator (§5.5).
 *   deviations from 201.333333:
 *     195 -> −6.333333  sq 40.111111
 *     198 -> −3.333333  sq 11.111111
 *     200 -> −1.333333  sq  1.777778
 *     202 -> +0.666667  sq  0.444444
 *     205 -> +3.666667  sq 13.444444
 *     208 -> +6.666667  sq 44.444444
 *   Σd² = 111.333333
 *   sample variance = 111.333333 / (6 − 1) = 22.2666667
 *   sd = √22.2666667 = 4.7187570
 *   cv = 4.7187570 / 201.333333 = 0.0234375
 *
 *   NOTE — the band CANNOT catch a population-vs-sample sd bug here, and that
 *   is exactly the sort of thing rounding hides. Population sd would be
 *   √(111.333333 / 6) = 4.3076157, and 4.3076157 × 2,000 = 8,615.23, which
 *   rounds to the SAME $9,000 band. So `sd` and `cv` are asserted directly.
 *
 * STEP 7 — band (§5.5): arv ∓ round(sd × subjectSqft / 1,000) × 1,000.
 *   sd × 2,000 = 4.7187570 × 2,000 = 9,437.514
 *   round(9.437514) × 1,000 = 9 × 1,000 = 9,000
 *   arvLow  = 403,000 − 9,000 = 394,000
 *   arvHigh = 403,000 + 9,000 = 412,000
 *
 *   THE $1,000 TRAP. The band offset is rounded on its own and applied to the
 *   ALREADY-ROUNDED arv. Rounding the raw endpoint instead —
 *   round((402,666.67 − 9,437.51) / 1,000) × 1,000 = round(393.229) × 1,000 —
 *   gives 393,000. One thousand dollars, no error, nobody notices.
 *   (arvHigh happens to agree at 412,000 under both, so `arvLow` is the
 *   discriminating assertion.)
 *
 * STEP 8 — confidence (§5.5). `high` needs all four:
 *   compsUsed ≥ 6      kept 8, post-trim 6 — ≥ 6 under EITHER reading of
 *                      `compsUsed`, so this case is immune to TEST_PLAN §8 Q1.
 *   cv ≤ 0.15          0.0234 ✓
 *   median distance ≤ 0.75 mi
 *                      distances (pure-latitude offsets, so haversine is
 *                      exactly R·Δlat: 3958.8 × π/180 = 69.09409447 mi/deg):
 *                        ±0.0010° -> 0.0690941  (×2)
 *                        ±0.0020° -> 0.1381882  (×2)
 *                        ±0.0030° -> 0.2072823  (×2)
 *                        ±0.0040° -> 0.2763764  (×2)
 *                      median of 8 = (0.1381882 + 0.2072823) / 2 = 0.1727352 ✓
 *   median age ≤ 6 mo  monthsAgo = days / 30.44:
 *                        30 d -> 0.9855453 (×2)
 *                        60 d -> 1.9710907 (×2)
 *                        90 d -> 2.9566360 (×2)
 *                       120 d -> 3.9421814 (×2)
 *                      median of 8 = (1.9710907 + 2.9566360) / 2 = 2.4638634 ✓
 *   => confidence = 'high'
 *
 * ---------------------------------------------------------------------------
 * WHY THE FIXTURE ORDER IS SHUFFLED
 * The comps are listed in $/sqft order [200, 195, 190, 198, 215, 205, 208, 202]
 * — deliberately NOT sorted. An implementation that trims the first and last
 * elements of the array it was handed, rather than of the sorted array, drops
 * 200 and 202 instead of 190 and 215 and lands on $404,000. If the fixture were
 * sorted, that bug would pass this case.
 * ---------------------------------------------------------------------------
 */
import type { GoldenCase, RawComp, SubjectProperty } from './types.js';

const subject: SubjectProperty = {
  zpid: 'G1-SUBJ',
  address: '1200 NORTH MAIN STREET, SEATTLE, WA 98101',
  beds: 3,
  baths: 2,
  livingArea: 2000,
  lotSize: 6000,
  yearBuilt: 1998,
  propertyType: 'SFR',
  lastSoldPrice: 310000,
  lastSoldDate: '2016-04-02',
  lat: 47.6,
  lng: -122.3,
};

// lat offsets from 47.6 are pure-latitude, so distance = 69.09409447 × Δlat°
// exactly. lng is held at -122.3 throughout so the arithmetic stays checkable.
const comps: RawComp[] = [
  {
    zpid: 'G1-C1', address: '1204 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 406000, soldDate: '2025-06-15', // 30 d
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6200, // $/sqft 203
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G1-C2', address: '1208 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 411600, soldDate: '2025-05-16', // 60 d
    beds: 4, baths: 2.5, livingArea: 2100, lotSize: 7000, // $/sqft 196
    propertyType: 'SFR', lat: 47.599, lng: -122.3, // 0.0690941 mi
  },
  {
    zpid: 'G1-C3', address: '1212 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 338400, soldDate: '2025-04-16', // 90 d
    beds: 3, baths: 2, livingArea: 1800, lotSize: 5800, // $/sqft 188  <- trimmed (low)
    propertyType: 'SFR', lat: 47.602, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G1-C4', address: '1216 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 376200, soldDate: '2025-03-17', // 120 d
    beds: 3, baths: 2, livingArea: 1900, lotSize: 6400, // $/sqft 198
    propertyType: 'SFR', lat: 47.598, lng: -122.3, // 0.1381882 mi
  },
  {
    zpid: 'G1-C5', address: '1220 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 348800, soldDate: '2025-06-15', // 30 d
    beds: 2, baths: 2, livingArea: 1600, lotSize: 5200, // $/sqft 218  <- trimmed (high)
    propertyType: 'SFR', lat: 47.603, lng: -122.3, // 0.2072823 mi
  },
  {
    zpid: 'G1-C6', address: '1224 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 365750, soldDate: '2025-05-16', // 60 d
    beds: 3, baths: 3, livingArea: 1750, lotSize: 6800, // $/sqft 209
    propertyType: 'SFR', lat: 47.597, lng: -122.3, // 0.2072823 mi
  },
  {
    zpid: 'G1-C7', address: '1228 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 468000, soldDate: '2025-04-16', // 90 d
    beds: 4, baths: 3, livingArea: 2250, lotSize: 8000, // $/sqft 208
    propertyType: 'SFR', lat: 47.604, lng: -122.3, // 0.2763764 mi
  },
  {
    zpid: 'G1-C8', address: '1232 NORTH MAIN STREET', status: 'SOLD',
    soldPrice: 444400, soldDate: '2025-03-17', // 120 d
    beds: 3, baths: 2.5, livingArea: 2200, lotSize: 7200, // $/sqft 202
    propertyType: 'SFR', lat: 47.596, lng: -122.3, // 0.2763764 mi
  },
];

export const golden01: GoldenCase = {
  id: 'golden-01-clean-8',
  title: 'clean case — 8 tight comps, trimCount 1, high confidence',
  now: new Date('2025-07-15T00:00:00.000Z'),
  subject,
  comps,
  expected: {
    ok: true,
    // v2: rung 1 (1.0 mi / 3 mo) yields 6; C4 and C8 are STALE at 3 months.
    // The cap at 5 then drops C7, the worst-scoring survivor.
    compsKept: 5,
    keptZpids: ['G1-C1', 'G1-C2', 'G1-C3', 'G1-C5', 'G1-C6'],
    rejected: [
      { zpid: 'G1-C4', reason: 'STALE_SALE' },
      { zpid: 'G1-C8', reason: 'STALE_SALE' },
    ],
    radiusTierMi: 1.0,
    recencyTierMonths: 3,

    trimCount: 1,
    usedPpsf: [196, 203, 209],
    trimmedOutPpsf: [
      { pricePerSqft: 188, end: 'low' },
      { pricePerSqft: 218, end: 'high' },
    ],

    arvPerSqft: 608 / 3, // 202.666666…
    arv: 405000,
    arvLow: 392000,
    arvHigh: 418000,
    sd: 6.5064071,
    cv: 0.0321041,
    confidence: 'high',

    epsilon: 1e-6,
  },
  wrongAnswers: [
    // Re-derived for v2 against the kept FIVE (C1 203, C2 196, C3 188, C6 209,
    // C5 218). The v1 list was invalidated by the re-spread — one entry
    // ("trims by soldPrice") had drifted onto 405,000, the CORRECT v2 answer,
    // which would have silently gutted the case. The dataset self-check caught
    // it, which is the reason that check exists.
    // unsorted trim: [203,196,188,209,218] -> drop ends -> [196,188,209]
    //   -> 593/3 = 197.66667 -> $395,333 -> $395,000
    { bug: 'trims the first/last element of the UNSORTED array', arv: 395000 },
    // by price: min 338,400 (C3) and max 411,600 (C2) removed
    //   -> [203, 218, 209] -> 630/3 = 210 -> $420,000
    { bug: 'trims by soldPrice instead of $/sqft', arv: 420000 },
    // vs subject sqft: [169.2, 174.4, 182.875, 203, 205.8] -> [174.4, 182.875, 203]
    //   -> 560.275/3 = 186.75833 -> $373,517 -> $374,000
    { bug: '$/sqft computed against SUBJECT sqft instead of comp sqft', arv: 374000 },
  ],
};

/**
 * WHAT THIS CASE DOES *NOT* CATCH — stated so nobody mistakes it for total
 * coverage.
 *
 * Skipping the trim entirely lands on the same answer here:
 *   mean of all 8 = 1,613 / 8 = 201.625 -> × 2,000 = 403,250 -> $403,000.
 * Identical to the correct result, because rounding to the nearest $1,000
 * swallows the $250 difference. So golden 01 cannot tell a trimming
 * implementation from a non-trimming one.
 *
 * That is precisely why golden 04 exists: at n = 5 the same bug moves the
 * answer from $400,000 to $404,000, well clear of the rounding.
 */
export const golden01UndetectedByThisCase = [
  'trim skipped entirely (mean of all 8 = 201.625 -> $403,250 -> $403,000, same after rounding)',
  'population sd instead of sample sd (band rounds to $9,000 either way — asserted via `sd`/`cv` directly)',
] as const;
