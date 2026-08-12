/**
 * Comp scoring and ranking — CONTRACT §5.4.
 *
 * Lower is better. That inversion is the whole risk in this file: a reversed
 * comparator still returns eight comps, still produces a confident ARV, and
 * still renders a table that looks right — built from the eight WORST comps
 * the filters let through. There is no symptom. The only defence is asserting
 * which comps come back.
 *
 * v2 (CONTRACT §14.3). Lot is reinstated as a SOFT term, taking 10 points
 * drawn 5 from distance and 5 from sqft, so the two dominant terms stay
 * dominant. The sqft normaliser follows SQFT_TOLERANCE down from 0.25 to 0.20,
 * which makes the term steeper, not just smaller — a 200 sqft difference on a
 * 2,000 sqft subject went from 6.0 points to 12.5.
 *
 *   distance = min(distanceMi / 1.0, 1)                    * 35   (was 40)
 *   sqft     = min(|cSqft - sSqft| / sSqft / 0.20, 1)      * 25   (was 30 / 0.25)
 *   recency  = min(max(monthsAgo, 0) / 12, 1)              * 20   (unchanged)
 *   bedbath  = min((|dBeds| + |dBaths|) / 2, 1)            * 10   (unchanged)
 *   lot      = min(|cLot - sLot| / sLot / 1.0, 1)          * 10   (NEW)
 *
 * A null lot on either side scores 0, exactly as null beds/baths do: unknown
 * is not a penalty.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { scoreComp, rankComps } from '../../src/features/comps/rank.js';
import {
  EARTH_RADIUS_MI,
  DAYS_PER_MONTH,
  WEIGHT_DISTANCE,
  WEIGHT_SQFT,
  WEIGHT_RECENCY,
  WEIGHT_BEDBATH,
  WEIGHT_LOT,
  SQFT_TOLERANCE,
  LOT_NORM_RATIO,
  DISTANCE_NORM_MI,
  RECENCY_NORM_MONTHS,
  MAX_COMPS_KEPT,
} from '../../src/features/comps/config.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['rank', 'config'] as const;

const NOW = new Date('2025-07-15T00:00:00.000Z');
const MI_PER_DEG_LAT = (EARTH_RADIUS_MI * Math.PI) / 180; // 69.09409447

const SUBJECT: SubjectProperty = {
  zpid: 'SUBJ', address: '1 TEST STREET', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 47.6, lng: -122.3,
};

const latAt = (miles: number) => SUBJECT.lat + miles / MI_PER_DEG_LAT;
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

function comp(overrides: Partial<RawComp> = {}): RawComp {
  return {
    zpid: 'C1', address: '2 TEST STREET', status: 'SOLD',
    soldPrice: 400000, soldDate: daysAgo(0),
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000,
    propertyType: 'SFR', lat: SUBJECT.lat, lng: SUBJECT.lng,
    ...overrides,
  };
}

describe(`comp scoring and ranking${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the weights', () => {
    it('sum to exactly 100', () => {
      // A re-weighting that forgets one term makes every score smaller and
      // every comparison against a fixed threshold wrong.
      // Five terms now, not four. Summing the old four gives 90 — a re-weighting
      // that forgets the new term makes every score smaller and every
      // comparison against a fixed threshold wrong.
      expect(WEIGHT_DISTANCE + WEIGHT_SQFT + WEIGHT_RECENCY + WEIGHT_BEDBATH + WEIGHT_LOT)
        .toBe(100);
      expect([WEIGHT_DISTANCE, WEIGHT_SQFT, WEIGHT_RECENCY, WEIGHT_BEDBATH, WEIGHT_LOT])
        .toEqual([35, 25, 20, 10, 10]);
    });

    it('lot was funded 5 from distance and 5 from sqft, not from the light terms', () => {
      // §14.3 pins WHERE the 10 points came from. Taking them from recency or
      // bedbath instead would still sum to 100 and still pass the case above,
      // while quietly changing what the ranking optimises for.
      expect(WEIGHT_DISTANCE, 'distance did not give up its 5').toBe(40 - 5);
      expect(WEIGHT_SQFT, 'sqft did not give up its 5').toBe(30 - 5);
      expect(WEIGHT_RECENCY, 'recency was raided').toBe(20);
      expect(WEIGHT_BEDBATH, 'bedbath was raided').toBe(10);
    });

    it('distance is still the heaviest and the two dominant terms stay dominant', () => {
      expect(WEIGHT_DISTANCE).toBeGreaterThan(WEIGHT_SQFT);
      expect(WEIGHT_SQFT).toBeGreaterThan(WEIGHT_RECENCY);
      expect(WEIGHT_RECENCY).toBeGreaterThan(WEIGHT_BEDBATH);
      expect(WEIGHT_BEDBATH, 'lot and bedbath are deliberately equal').toBe(WEIGHT_LOT);
      expect(
        WEIGHT_DISTANCE + WEIGHT_SQFT,
        'distance + sqft no longer carry the majority of the score',
      ).toBeGreaterThan(50);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('scoreComp — the endpoints', () => {
    it('an identical comp next door sold today scores 0', () => {
      const s = scoreComp(SUBJECT, comp(), NOW);
      expect(s.score).toBeCloseTo(0, 9);
      expect(s.parts).toEqual({ distance: 0, sqft: 0, recency: 0, bedbath: 0, lot: 0 });
      expect(s.distanceMi).toBe(0);
      expect(s.monthsAgo).toBeCloseTo(0, 9);
    });

    it('a maximally bad comp scores exactly 100, not more', () => {
      // Every term saturates. Without the min() clamps this comp scores far
      // past 100 and one dimension dominates the whole ranking.
      // lotSize must saturate too, or this comp tops out at 90 and the case
      // silently stops testing the clamp it is named for.
      const s = scoreComp(
        SUBJECT,
        comp({
          lat: latAt(5), livingArea: 5000, soldDate: daysAgo(3650),
          beds: 9, baths: 9, lotSize: 24000,
        }),
        NOW,
      );
      expect(s.score).toBeCloseTo(100, 9);
      expect(s.parts.distance).toBeCloseTo(35, 9);
      expect(s.parts.sqft).toBeCloseTo(25, 9);
      expect(s.parts.recency).toBeCloseTo(20, 9);
      expect(s.parts.bedbath).toBeCloseTo(10, 9);
      expect(s.parts.lot).toBeCloseTo(10, 9);
    });

    it('parts always sum to score', () => {
      const cases = [
        comp(),
        comp({ lat: latAt(0.3) }),
        comp({ livingArea: 2350, beds: 4 }),
        comp({ soldDate: daysAgo(200), baths: 3 }),
        comp({ lat: latAt(5), livingArea: 9999, soldDate: daysAgo(9999), beds: 0, baths: 0 }),
      ];
      for (const c of cases) {
        const s = scoreComp(SUBJECT, c, NOW);
        const sum = s.parts.distance + s.parts.sqft + s.parts.recency + s.parts.bedbath;
        expect(s.score).toBeCloseTo(sum, 9);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('scoreComp — each clamp holds independently', () => {
    it('distance clamps at DISTANCE_NORM_MI (1.0 mi)', () => {
      expect(scoreComp(SUBJECT, comp({ lat: latAt(0.5) }), NOW).parts.distance)
        .toBeCloseTo(17.5, 8); // 0.5/1.0 × 35
      expect(scoreComp(SUBJECT, comp({ lat: latAt(1.0) }), NOW).parts.distance)
        .toBeCloseTo(35, 8);
      // 5 miles is not 175 points.
      const far = scoreComp(SUBJECT, comp({ lat: latAt(5) }), NOW);
      expect(far.parts.distance).toBeCloseTo(35, 9);
      expect(far.parts.distance, 'distance clamp missing').not.toBeGreaterThan(35.000001);
      expect(DISTANCE_NORM_MI).toBe(1.0);
    });

    it('sqft clamps at the ±20% band edge, and the normaliser followed the gate', () => {
      // |Δ| / sSqft / 0.20. At Δ = 400 on 2,000 that is 0.20/0.20 = 1 -> 25.
      expect(SQFT_TOLERANCE, 'the scoring normaliser must track the hard gate').toBe(0.2);
      expect(scoreComp(SUBJECT, comp({ livingArea: 2400 }), NOW).parts.sqft).toBeCloseTo(25, 9);
      expect(scoreComp(SUBJECT, comp({ livingArea: 1600 }), NOW).parts.sqft).toBeCloseTo(25, 9);
      // Δ = 200 -> 0.10/0.20 = 0.5 -> 12.5.
      expect(scoreComp(SUBJECT, comp({ livingArea: 2200 }), NOW).parts.sqft).toBeCloseTo(12.5, 9);
      expect(scoreComp(SUBJECT, comp({ livingArea: 1800 }), NOW).parts.sqft).toBeCloseTo(12.5, 9);
      // Beyond the band (only reachable by calling scoreComp directly) clamps.
      expect(scoreComp(SUBJECT, comp({ livingArea: 6000 }), NOW).parts.sqft).toBeCloseTo(25, 9);

      // THE STEEPNESS CHANGE, pinned. If the weight dropped to 25 but the
      // normaliser stayed at 0.25, this comp would score 200/2000/0.25 × 25 =
      // 10 rather than 12.5 — a plausible half-migration that every other
      // assertion in this block would still pass.
      expect(
        scoreComp(SUBJECT, comp({ livingArea: 2200 }), NOW).parts.sqft,
        'the sqft normaliser is still 0.25 while the weight moved to 25',
      ).not.toBeCloseTo(10, 6);
    });

    it('sqft is symmetric — a comp 200 sqft over scores like one 200 under', () => {
      const over = scoreComp(SUBJECT, comp({ livingArea: 2200 }), NOW).parts.sqft;
      const under = scoreComp(SUBJECT, comp({ livingArea: 1800 }), NOW).parts.sqft;
      expect(over).toBeCloseTo(under, 12);
    });

    it('NEW — lot clamps at a 100% difference and is symmetric', () => {
      // |Δlot| / sLot / LOT_NORM_RATIO, clamped at 1, × 10. Subject lot 6,000.
      expect(LOT_NORM_RATIO).toBe(1.0);
      expect(scoreComp(SUBJECT, comp({ lotSize: 6000 }), NOW).parts.lot).toBeCloseTo(0, 9);
      expect(scoreComp(SUBJECT, comp({ lotSize: 9000 }), NOW).parts.lot).toBeCloseTo(5, 9);
      expect(scoreComp(SUBJECT, comp({ lotSize: 3000 }), NOW).parts.lot).toBeCloseTo(5, 9);
      expect(scoreComp(SUBJECT, comp({ lotSize: 12000 }), NOW).parts.lot).toBeCloseTo(10, 9);
      // The v1 hard gate rejected anything past 5x. Scoring must CLAMP there,
      // not keep climbing — a 30,000 sqft lot is 4x over and would otherwise
      // contribute 40 points on its own and dominate the whole ranking.
      expect(scoreComp(SUBJECT, comp({ lotSize: 30000 }), NOW).parts.lot).toBeCloseTo(10, 9);
      expect(scoreComp(SUBJECT, comp({ lotSize: 9_000_000 }), NOW).parts.lot).toBeCloseTo(10, 9);
    });

    it('NEW — a null lot on either side contributes 0, not a penalty', () => {
      // §14.3, matching the null beds/baths rule: unknown is not different.
      // Lot is the field Zillow omits most often; penalising its absence would
      // push every incompletely-reported comp out of a set of five.
      expect(scoreComp(SUBJECT, comp({ lotSize: null }), NOW).parts.lot).toBe(0);
      const noLot = { ...SUBJECT, lotSize: null };
      expect(scoreComp(noLot, comp({ lotSize: 9_000_000 }), NOW).parts.lot).toBe(0);
      expect(scoreComp(noLot, comp({ lotSize: null }), NOW).parts.lot).toBe(0);
    });

    it('recency clamps at RECENCY_NORM_MONTHS (12)', () => {
      // 12 months = 365.28 days, so 365.28 days is the saturation point.
      const sixMonths = scoreComp(SUBJECT, comp({ soldDate: daysAgo(183) }), NOW);
      // 183 / 30.44 = 6.0118 months -> 6.0118/12 × 20 = 10.0197
      expect(sixMonths.parts.recency).toBeCloseTo(10.019706, 5);
      const old = scoreComp(SUBJECT, comp({ soldDate: daysAgo(3650) }), NOW);
      expect(old.parts.recency).toBeCloseTo(20, 9);
      expect(RECENCY_NORM_MONTHS).toBe(12);
    });

    it('bedbath clamps at a combined difference of 2', () => {
      // (|Δbeds| + |Δbaths|) / 2, clamped at 1, × 10.
      expect(scoreComp(SUBJECT, comp({ beds: 4 }), NOW).parts.bedbath).toBeCloseTo(5, 9); // 1/2
      expect(scoreComp(SUBJECT, comp({ baths: 2.5 }), NOW).parts.bedbath).toBeCloseTo(2.5, 9); // .5/2
      expect(scoreComp(SUBJECT, comp({ beds: 4, baths: 3 }), NOW).parts.bedbath).toBeCloseTo(10, 9); // 2/2
      // A wildly different comp does not score 45 points here.
      expect(scoreComp(SUBJECT, comp({ beds: 9, baths: 9 }), NOW).parts.bedbath).toBeCloseTo(10, 9);
    });

    it('a null bed or bath count contributes 0, not a penalty', () => {
      // Matching the filter's rule: a null is unknown, not different. Scoring
      // it as a large difference would push every comp with unreported
      // bathrooms to the bottom of the ranking and out of the top 8.
      expect(scoreComp(SUBJECT, comp({ beds: null }), NOW).parts.bedbath).toBe(0);
      expect(scoreComp(SUBJECT, comp({ baths: null }), NOW).parts.bedbath).toBe(0);
      expect(scoreComp(SUBJECT, comp({ beds: null, baths: null }), NOW).parts.bedbath).toBe(0);
      const noBeds = { ...SUBJECT, beds: null };
      expect(scoreComp(noBeds, comp({ beds: 9 }), NOW).parts.bedbath).toBe(0);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('scoreComp — a hand-computed composite', () => {
    it('scores a realistic comp at 33.7324792', () => {
      // Recomputed by hand for v2. distance 0.25 mi, 2,200 sqft, 7,500 sqft
      // lot, sold 91 days ago, 4 beds, 2 baths:
      //   distance = min(0.25 / 1.0, 1)            × 35 = 0.25  × 35 =  8.75
      //   sqft     = min(200/2000/0.20, 1)         × 25 = 0.5   × 25 = 12.5
      //   recency  = min((91/30.44)/12, 1)         × 20
      //            = (2.98948752/12) × 20 = 0.24912396 × 20     =  4.9824792
      //   bedbath  = min((1 + 0)/2, 1)             × 10 = 0.5   × 10 =  5
      //   lot      = min(1500/6000/1.0, 1)         × 10 = 0.25  × 10 =  2.5
      //   score    = 8.75 + 12.5 + 4.9824792 + 5 + 2.5       = 33.7324792
      //
      // Under v1 the same comp scored 31.9824792. Note the sqft term went UP
      // (12 -> 12.5) even though its weight went DOWN, because the normaliser
      // tightened with the gate. That is the sort of interaction a
      // proportional "scale the old answer" migration gets wrong.
      const s = scoreComp(
        SUBJECT,
        comp({
          lat: latAt(0.25), livingArea: 2200, soldDate: daysAgo(91),
          beds: 4, baths: 2, lotSize: 7500,
        }),
        NOW,
      );
      expect(s.parts.distance).toBeCloseTo(8.75, 8);
      expect(s.parts.sqft).toBeCloseTo(12.5, 9);
      expect(s.parts.recency).toBeCloseTo(4.9824792, 6);
      expect(s.parts.bedbath).toBeCloseTo(5, 9);
      expect(s.parts.lot).toBeCloseTo(2.5, 9);
      expect(s.score).toBeCloseTo(33.7324792, 6);
      expect(s.score, 'this is still the v1 answer').not.toBeCloseTo(31.9824792, 6);
      expect(s.monthsAgo).toBeCloseTo(91 / DAYS_PER_MONTH, 9);
      expect(s.distanceMi).toBeCloseTo(0.25, 8);
    });

    it('carries the comp\'s own $/sqft through', () => {
      const s = scoreComp(SUBJECT, comp({ soldPrice: 468000, livingArea: 2250 }), NOW);
      expect(s.pricePerSqft).toBeCloseTo(208, 9); // 468,000 / 2,250
      expect(s.pricePerSqft, 'computed against the subject sqft').not.toBeCloseTo(234, 3);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('rankComps — sort direction', () => {
    it('sorts ASCENDING — the best comp is first', () => {
      const comps = [
        comp({ zpid: 'FAR', lat: latAt(0.9) }),
        comp({ zpid: 'NEAR', lat: latAt(0.05) }),
        comp({ zpid: 'MID', lat: latAt(0.4) }),
      ];
      const ranked = rankComps(SUBJECT, comps, NOW);
      expect(ranked.map((r) => r.comp.zpid)).toEqual(['NEAR', 'MID', 'FAR']);
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i - 1].score);
      }
    });

    it('REGRESSION: an inverted sort would return the WORST comps and still look fine', () => {
      // 12 comps at increasing distance. The cap keeps 5 (§14.1, down from 8).
      // Ascending keeps the five nearest; descending keeps the five farthest —
      // same count, same shape, completely different ARV, and nothing in the
      // output differs. The cap getting smaller makes this WORSE, not better:
      // each wrong comp is now 20% of the answer.
      const comps = Array.from({ length: 12 }, (_, i) =>
        comp({ zpid: `D${String(i).padStart(2, '0')}`, lat: latAt(0.05 * (i + 1)) }),
      );
      const ranked = rankComps(SUBJECT, comps, NOW);
      expect(ranked).toHaveLength(MAX_COMPS_KEPT);
      expect(ranked.map((r) => r.comp.zpid)).toEqual([
        'D00', 'D01', 'D02', 'D03', 'D04',
      ]);
      // The seven dropped are the seven worst, not the seven best.
      const keptIds = new Set(ranked.map((r) => r.comp.zpid));
      expect(keptIds.has('D11'), 'the farthest comp survived the cap').toBe(false);
      expect(keptIds.has('D00'), 'the nearest comp was dropped').toBe(true);
    });

    it('the cap keeps the best MAX_COMPS_KEPT, not the first ones in the array', () => {
      // Input order deliberately puts the worst comps first. A `slice(0, 5)`
      // applied before sorting keeps exactly the wrong five.
      const comps = [
        ...Array.from({ length: 6 }, (_, i) => comp({ zpid: `BAD${i}`, lat: latAt(0.9) })),
        ...Array.from({ length: 5 }, (_, i) => comp({ zpid: `GOOD${i}`, lat: latAt(0.05) })),
      ];
      const ranked = rankComps(SUBJECT, comps, NOW);
      expect(ranked).toHaveLength(MAX_COMPS_KEPT);
      const good = ranked.filter((r) => r.comp.zpid.startsWith('GOOD'));
      expect(good, 'the five good comps must all survive the cap').toHaveLength(5);
      expect(
        ranked.map((r) => r.comp.zpid).filter((z) => z.startsWith('BAD')),
        'a worse comp took a slot from a better one',
      ).toHaveLength(0);
    });

    it('returns everything when there are fewer than MAX_COMPS_KEPT', () => {
      const comps = Array.from({ length: 3 }, (_, i) => comp({ zpid: `C${i}` }));
      expect(rankComps(SUBJECT, comps, NOW)).toHaveLength(3);
      expect(rankComps(SUBJECT, [], NOW)).toHaveLength(0);
    });

    it('MAX_COMPS_KEPT is 5 — display AND compute, no split', () => {
      // §14.1: down from 8. The ARV is computed from the same five the member
      // sees, so this constant is the whole sample size, not a display limit.
      expect(MAX_COMPS_KEPT).toBe(5);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('rankComps — determinism and tie-breaks', () => {
    it('identical comps are ordered by zpid ascending', () => {
      // The realistic tie: the same house listed twice, or two identical units.
      // Scores and distances are equal, so zpid is the only thing left. Fed in
      // reverse so a stable-sort-of-the-input would fail.
      const comps = [
        comp({ zpid: 'ZZZ' }),
        comp({ zpid: 'MMM' }),
        comp({ zpid: 'AAA' }),
      ];
      const ranked = rankComps(SUBJECT, comps, NOW);
      expect(ranked.map((r) => r.comp.zpid)).toEqual(['AAA', 'MMM', 'ZZZ']);
      expect(new Set(ranked.map((r) => r.score)).size, 'these were meant to tie').toBe(1);
    });

    it('zpid ordering is string ordering, applied consistently', () => {
      const comps = ['100', '20', '3'].map((z) => comp({ zpid: z }));
      const ranked = rankComps(SUBJECT, comps, NOW);
      // localeCompare on numeric strings gives '100' < '20' < '3'. Whatever the
      // ordering is, it must be total and stable — asserted here so a switch
      // to numeric comparison is a visible decision rather than a silent drift
      // in which comps get capped.
      expect(ranked.map((r) => r.comp.zpid)).toEqual(['100', '20', '3']);
    });

    it('shuffling the input never changes the output order', () => {
      // The property that matters more than any single tie-break rule: two
      // identical requests must render the same table. A cached result and a
      // fresh one have to agree.
      const base = [
        comp({ zpid: 'A', lat: latAt(0.1) }),
        comp({ zpid: 'B', lat: latAt(0.1) }),
        comp({ zpid: 'C', livingArea: 2250 }),
        comp({ zpid: 'D', soldDate: daysAgo(90) }),
        comp({ zpid: 'E', beds: 4 }),
        comp({ zpid: 'F' }),
      ];
      const expected = rankComps(SUBJECT, base, NOW).map((r) => r.comp.zpid);
      const shuffles = [
        [...base].reverse(),
        [base[3], base[0], base[5], base[2], base[4], base[1]],
        [base[2], base[4], base[1], base[5], base[3], base[0]],
      ];
      for (const s of shuffles) {
        expect(rankComps(SUBJECT, s, NOW).map((r) => r.comp.zpid)).toEqual(expected);
      }
    });

    it('does not mutate the array it was given', () => {
      const comps = [
        comp({ zpid: 'C', lat: latAt(0.9) }),
        comp({ zpid: 'A', lat: latAt(0.1) }),
      ];
      const order = comps.map((c) => c.zpid);
      rankComps(SUBJECT, comps, NOW);
      expect(comps.map((c) => c.zpid), 'rankComps sorted its argument in place').toEqual(order);
    });

    /**
     * NOTE on the distance tie-break (score asc -> distanceMi asc -> zpid asc).
     *
     * The middle rule is close to unreachable from real coordinates: an exact
     * score tie between two comps at DIFFERENT distances would require the
     * non-distance terms to differ by exactly the distance difference, and
     * haversine distances are not exact binary fractions. In practice a score
     * tie means the distances are equal too, and zpid decides.
     *
     * So the property actually worth guaranteeing is the one asserted above —
     * total, shuffle-independent ordering — rather than a synthetic tie that
     * cannot occur.
     */
    it('ordering is total: no two ranked comps compare equal on all three keys', () => {
      const comps = Array.from({ length: 8 }, (_, i) =>
        comp({ zpid: `T${i}`, lat: latAt(0.1 * (i % 3)) }),
      );
      const ranked = rankComps(SUBJECT, comps, NOW);
      const seen = new Set(
        ranked.map((r) => `${r.score}|${r.distanceMi}|${r.comp.zpid}`),
      );
      expect(seen.size).toBe(ranked.length);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('no degenerate scores', () => {
    it('every field is finite across a wide sweep', () => {
      const comps = [
        comp({ beds: null, baths: null, lotSize: null }),
        comp({ livingArea: 1, soldPrice: 1 }),
        comp({ lat: 90, lng: 180 }),
        comp({ soldDate: daysAgo(0) }),
        comp({ soldDate: daysAgo(365) }),
      ];
      for (const c of comps) {
        const s = scoreComp(SUBJECT, c, NOW);
        for (const [k, v] of Object.entries({ ...s.parts, score: s.score, distanceMi: s.distanceMi })) {
          expect(Number.isFinite(v), `${k} is ${v} for ${c.zpid}`).toBe(true);
        }
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // =========================================================================
  // BUG-003 — the scoring half of the fix (CONTRACT §0 #5, §5.4).
  //
  // The rejection half is rule 12 `FUTURE_SOLD_DATE` and belongs to the filter
  // layer — asserted in `filter.test.ts`. `rankComps` is only ever handed comps
  // that already passed the filters, so it cannot and should not exclude
  // anything; what it must guarantee is that §5.4's stated 0–100 range holds
  // no matter what reaches it.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('BUG-003: the recency clamp', () => {
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString().slice(0, 10);

    it('the recency term never goes below 0', () => {
      // Unclamped, monthsAgo for a sale dated tomorrow is -1/30.44 = -0.0328521:
      //   recency = min(-0.0328521 / 12, 1) × 20 = -0.0547525
      // min() clamps the TOP of the range; max(monthsAgo, 0) clamps the bottom.
      const future = scoreComp(SUBJECT, comp({ soldDate: tomorrow }), NOW);
      expect(
        future.parts.recency,
        'recency went negative — a sale that has not happened scores better than one that has',
      ).toBe(0);
      expect(future.score).toBeGreaterThanOrEqual(0);
    });

    it('but monthsAgo itself stays RAW and negative — the evidence is preserved', () => {
      // §5.4 is explicit that the clamp lives in the term, not the field. A
      // negative monthsAgo is the visible trace of bad provider data; silently
      // flooring it to 0 would hide the thing rule 12 exists to catch.
      const future = scoreComp(SUBJECT, comp({ soldDate: tomorrow }), NOW);
      expect(future.monthsAgo).toBeLessThan(0);
      expect(future.monthsAgo).toBeCloseTo(-1 / DAYS_PER_MONTH, 9);
    });

    it('a future-dated comp can no longer undercut a comp sold today', () => {
      // Pre-fix, the future comp scored -0.0547 and sorted ahead of a flawless
      // comp at 0. Clamped, the worst it can do is tie.
      const future = scoreComp(SUBJECT, comp({ soldDate: tomorrow }), NOW);
      const today = scoreComp(SUBJECT, comp({ soldDate: daysAgo(0) }), NOW);
      expect(future.score).toBeGreaterThanOrEqual(today.score);
      expect(future.score).toBeGreaterThanOrEqual(0);
    });

    it('no comp, however malformed, can score outside 0-100', () => {
      const nasty = [
        comp({ soldDate: tomorrow }),
        comp({ soldDate: new Date(NOW.getTime() + 400 * 86_400_000).toISOString().slice(0, 10) }),
        comp({ soldDate: daysAgo(9999), lat: latAt(50), livingArea: 1, beds: 99, baths: 99 }),
      ];
      for (const c of nasty) {
        const s = scoreComp(SUBJECT, c, NOW);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
        for (const [k, v] of Object.entries(s.parts)) {
          expect(v, `parts.${k} is ${v}`).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
  // =========================================================================
  // BUG-002, RE-POINTED. `arv.ts` is deleted, so the `trimmedMean` half of the
  // guard retires with its function — deleted code cannot regress. But
  // `pricePerSqft` was not deleted, it MOVED: it is now computed inline in
  // `scoreComp` (rank.ts:35), and every division in this function is a place
  // NaN or Infinity can re-enter. An unguarded division is one bad payload
  // away from being live, and `scoreComp` is exported standalone.
  //
  // Note the guard changed SHAPE as well as address. The old helpers threw;
  // the inline version degrades to 0 (price) or saturates the term (sqft).
  // Both are defensible, so these cases assert the GUARANTEE — always finite,
  // always inside 0-100 — rather than the mechanism, which is MASON's to pick.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('BUG-002 — degenerate inputs never produce NaN or Infinity', () => {
    const DEGENERATE: Array<[string, Partial<RawComp>]> = [
      ['null price', { soldPrice: null }],
      ['zero price', { soldPrice: 0 }],
      ['negative price', { soldPrice: -1 }],
      ['null sqft', { livingArea: null }],
      ['zero sqft', { livingArea: 0 }],
      ['negative sqft', { livingArea: -100 }],
      ['zero price AND zero sqft', { soldPrice: 0, livingArea: 0 }],
      ['null lot', { lotSize: null }],
      ['zero lot', { lotSize: 0 }],
      ['absurd sqft', { livingArea: 1e9 }],
      ['absurd price', { soldPrice: 1e15 }],
    ];

    it.each(DEGENERATE)('comp side: %s stays finite and in range', (_name, over) => {
      const s = scoreComp(SUBJECT, comp(over), NOW);
      expect(Number.isFinite(s.pricePerSqft), 'pricePerSqft is NaN or Infinity').toBe(true);
      expect(Number.isFinite(s.score), 'score is NaN or Infinity').toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      for (const [k, v] of Object.entries(s.parts)) {
        expect(Number.isFinite(v), `parts.${k} is NaN or Infinity`).toBe(true);
        expect(v, `parts.${k} is negative`).toBeGreaterThanOrEqual(0);
      }
    });

    it('subject side: a zero or null subject sqft divides by zero if unguarded', () => {
      // The division that is easiest to miss, because every realistic subject
      // has a sqft: |cSqft - sSqft| / sSqft. With sSqft = 0 that is x/0.
      for (const livingArea of [0, null, -100]) {
        const s = scoreComp({ ...SUBJECT, livingArea }, comp(), NOW);
        expect(Number.isFinite(s.score), `subject sqft ${livingArea} produced ${s.score}`).toBe(true);
        expect(s.parts.sqft, 'unknown subject sqft must SATURATE, not vanish')
          .toBeCloseTo(WEIGHT_SQFT, 9);
      }
    });

    it('subject side: a zero or null subject lot divides by zero if unguarded', () => {
      for (const lotSize of [0, null, -100]) {
        const s = scoreComp({ ...SUBJECT, lotSize }, comp({ lotSize: 50000 }), NOW);
        expect(Number.isFinite(s.score), `subject lot ${lotSize} produced ${s.score}`).toBe(true);
        // Unlike sqft, an unknown LOT scores 0 — §14.3 says unknown is not a
        // penalty. The two divisions resolve their unknowns in OPPOSITE
        // directions, which is exactly the kind of asymmetry that gets
        // "tidied up" into consistency by a later reader.
        expect(s.parts.lot, 'an unknown lot became a penalty').toBe(0);
      }
    });

    it('BUG-003 — a future-dated comp scores a NON-NEGATIVE recency term', () => {
      // The defensive half. min() alone capped only the top of the range, so a
      // future date scored negative and sorted AHEAD of flawless comps: bad
      // data promoted, not merely tolerated. Rule 12 rejects these at the
      // filter, but scoreComp is exported and must hold on its own.
      const future = scoreComp(SUBJECT, comp({ soldDate: daysAgo(-400) }), NOW);
      expect(future.monthsAgo, 'precondition: this comp is not actually future-dated')
        .toBeLessThan(0);
      expect(future.parts.recency, 'a future sale earned a NEGATIVE recency score').toBe(0);
      expect(future.score).toBeGreaterThanOrEqual(0);

      // ...and it must not outrank a perfect comp.
      const perfect = scoreComp(SUBJECT, comp(), NOW);
      expect(
        future.score,
        'a future-dated comp scores better than an identical one sold today',
      ).toBeGreaterThanOrEqual(perfect.score);
    });

    it('an empty comp list ranks to an empty array, not a crash', () => {
      expect(rankComps(SUBJECT, [], NOW)).toEqual([]);
    });
  });
});
