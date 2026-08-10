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
 * v2 (CONTRACT §14, ALGO_VERSION 3). REWRITTEN, not annotated. The header used
 * to carry the v1 derivation under a "SUPERSEDED, see V2-RECOMPUTE.md" note.
 * That was honest but it broke the method this whole dataset runs on — "read
 * the header, not the test, to check the arithmetic" is worthless when the
 * numbers in front of you describe a previous version of the data. The
 * retired ARV steps are recorded in V2-RECOMPUTE.md; what remains is what the
 * module still produces.
 * ---------------------------------------------------------------------------
 *
 * STEP 1 — hard filters (§5.3, as amended by §14.1). All eight comps:
 *   status SOLD · sqft present · prices > 0 · all SFR · all within 0.28 mi
 *   sqft band = 2000 ± 20%  =>  [1600, 2400]   (v1 was ±25% => [1500, 2500])
 *     sizes 2000, 2100, 1800, 1900, 1600, 1750, 2250, 2200 — all inside.
 *     G1-C5 at 1,600 sits EXACTLY on the low edge and is kept: the rule
 *     rejects OUTSIDE the band, so the edge is inclusive.
 *   |Δbeds| ≤ 1, |Δbaths| ≤ 1
 *   rule 11 LOT_ANOMALY is REMOVED in v2 — lot is a soft scoring term now, so
 *     the 5,200–8,000 lots are scored, not gated.
 *   rule 10 NON_ARMS_LENGTH: candidate median $/sqft over all eight (deduped;
 *     all eight are distinct sales), n = 8, even:
 *       sorted [188, 196, 198, 202, 203, 208, 209, 218]
 *       median = (202 + 203) / 2 = 202.5  ->  threshold = 0.4 × 202.5 = 81
 *       min $/sqft is 188 > 81, so nothing is rejected.
 *
 * STEP 2 — the LADDER (§14.2), which is where v2 differs most. Two gates now,
 *   walked as one ordered list, recency widening before radius:
 *     1.0/3  ->  1.0/6  ->  1.0/12  ->  3.0/3  ->  3.0/6  ->  3.0/12
 *
 *   Ages against now = 2025-07-15, months = days / 30.44:
 *     G1-C1  2025-06-15    30 d = 0.9855 mo
 *     G1-C2  2025-05-16    60 d = 1.9711 mo
 *     G1-C3  2025-04-16    90 d = 2.9566 mo
 *     G1-C4  2025-03-17   120 d = 3.9422 mo   <- outside 3 months
 *     G1-C5  2025-06-15    30 d = 0.9855 mo
 *     G1-C6  2025-05-16    60 d = 1.9711 mo
 *     G1-C7  2025-04-16    90 d = 2.9566 mo
 *     G1-C8  2025-03-17   120 d = 3.9422 mo   <- outside 3 months
 *
 *   rung 1 (1.0 mi / 3 mo) keeps SIX — C4 and C8 fall out as STALE_SALE.
 *   6 ≥ MIN_COMPS_FOR_TIER (5), so the walk STOPS here.
 *   => radiusTierMi = 1.0, recencyTierMonths = 3, rejected = C4, C8.
 *
 * STEP 3 — $/sqft, per comp, against the COMP's own living area (not the
 *   subject's, not the lot). This is now the only derived figure the member is
 *   shown, so it is the one that has to be right:
 *   G1-C1  406,000 / 2,000 = 203
 *   G1-C2  411,600 / 2,100 = 196
 *   G1-C3  338,400 / 1,800 = 188
 *   G1-C4  376,200 / 1,900 = 198
 *   G1-C5  348,800 / 1,600 = 218
 *   G1-C6  365,750 / 1,750 = 209
 *   G1-C7  468,000 / 2,250 = 208
 *   G1-C8  444,400 / 2,200 = 202
 *
 *   Against the SUBJECT's 2,000 sqft these would read 203, 205.8, 169.2,
 *   188.1, 174.4, 182.875, 234 and 222.2 — different for six of the eight, so
 *   the wrong denominator is visible here rather than hidden by coincidence.
 *
 * STEP 4 — the cap (§14.1: MAX_COMPS_KEPT 8 -> 5). Six survive the rung and
 *   the cap keeps five, dropping G1-C7 as the worst-scoring survivor. This is
 *   new in v2: under the old cap of 8 nothing was dropped and the ranked order
 *   could not affect the outcome. It can now.
 *   => the member sees C1, C2, C3, C5, C6.
 *
 * STEPS 5-8 — RETIRED. Trim, trimmed mean, sample sd, cv, arvLow/arvHigh and
 *   the confidence tier are gone with `arv.ts` (§14.8, a one-way door). The v1
 *   arithmetic for them, including the $1,000 band-rounding trap and the
 *   population-vs-sample sd note, is kept in V2-RECOMPUTE.md as the record of
 *   what this case used to prove. `expected.arv` and friends remain in the
 *   object below but nothing asserts them.
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
