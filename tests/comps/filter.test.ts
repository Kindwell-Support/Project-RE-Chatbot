/**
 * Hard filters, distance, and radius tiers — CONTRACT §5.3.
 *
 * Two things are being protected here. The obvious one is that a bad comp
 * doesn't reach the ARV. The less obvious one is that the REASON is right:
 * the rendered chat block shows why each comp was dropped, and that list is
 * what lets a human check the estimate rather than take it on faith. A comp
 * rejected for the wrong stated reason makes the table quietly dishonest even
 * when the number is correct.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import {
  haversineMiles,
  monthsBetween,
  median,
  applyHardFilters,
  selectRadiusTier,
} from '../../src/features/comps/filter.js';
import {
  EARTH_RADIUS_MI,
  DAYS_PER_MONTH,
  MAX_COMP_AGE_MONTHS,
  SQFT_TOLERANCE,
  LOT_ANOMALY_MULTIPLE,
  RADIUS_TIERS_MI,
  MIN_COMPS_FOR_TIER,
  NON_ARMS_LENGTH_PPSF_FRACTION,
} from '../../src/features/comps/config.js';
import type { PropertyType, RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['filter', 'config'] as const;

const NOW = new Date('2025-07-15T00:00:00.000Z');

/**
 * Miles per degree of latitude. With Δlng = 0 the haversine formula collapses
 * to exactly R·Δlat_radians, so every distance in this file is hand-checkable:
 *   3958.8 × π / 180 = 69.09409447
 */
const MI_PER_DEG_LAT = (EARTH_RADIUS_MI * Math.PI) / 180;

const SUBJECT: SubjectProperty = {
  zpid: 'SUBJ', address: '1 TEST STREET', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 47.6, lng: -122.3,
};

/** A comp that passes every one of the eleven rules. Mutate one field per test. */
function validComp(overrides: Partial<RawComp> = {}): RawComp {
  return {
    zpid: 'C1', address: '2 TEST STREET', status: 'SOLD',
    soldPrice: 400000, soldDate: '2025-05-16', // 60 days before NOW
    beds: 3, baths: 2, livingArea: 2000, lotSize: 6000,
    propertyType: 'SFR', lat: 47.601, lng: -122.3, // 0.0690941 mi
    ...overrides,
  };
}

/** Latitude that sits exactly `miles` due north of the subject. */
const latAt = (miles: number) => SUBJECT.lat + miles / MI_PER_DEG_LAT;

/** Date string exactly `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Run one comp through the filters at a generous radius; return its reason or null. */
function reasonFor(overrides: Partial<RawComp>, radiusMi = 2.0): string | null {
  const { kept, rejected } = applyHardFilters(SUBJECT, [validComp(overrides)], radiusMi, NOW);
  if (kept.length) return null;
  return rejected[0].reason;
}

describe(`hard filters, distance and tiers${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('haversineMiles', () => {
    it('is exact for a pure-latitude offset: 0.01 deg = 0.6909409 mi', () => {
      // Δlng = 0 makes haversine collapse to R·Δlat, with no cos() term and no
      // approximation. 3958.8 × π/180 × 0.01 = 0.69094094…
      const d = haversineMiles(47.6, -122.3, 47.61, -122.3);
      expect(d).toBeCloseTo(0.6909409447, 9);
      expect(d).toBeCloseTo(MI_PER_DEG_LAT * 0.01, 12);
    });

    it('a known ~1.0 mile pair comes back as 1.0', () => {
      // Δlat = 1 / 69.09409447 = 0.014473017 deg
      const d = haversineMiles(47.6, -122.3, 47.6 + 1 / MI_PER_DEG_LAT, -122.3);
      expect(d).toBeCloseTo(1.0, 9);
    });

    it('is MILES, not kilometres', () => {
      // The same 0.01 deg step is 1.1119 km. A metres/km radius constant makes
      // every radius tier ~1.6x too wide and silently pulls in comps from the
      // next neighbourhood.
      const d = haversineMiles(47.6, -122.3, 47.61, -122.3);
      expect(d).toBeLessThan(1);
      expect(d, 'result looks like kilometres').not.toBeCloseTo(1.1119, 3);
    });

    it('is haversine, not euclidean on raw degrees', () => {
      // At latitude 47.6 a degree of LONGITUDE is cos(47.6 deg) = 0.6743022 of
      // a degree of latitude. Euclidean distance on raw lat/lng makes them
      // equal, which stretches the east-west radius by ~48%.
      const northSouth = haversineMiles(47.6, -122.3, 47.61, -122.3);
      const eastWest = haversineMiles(47.6, -122.3, 47.6, -122.29);
      expect(eastWest).toBeLessThan(northSouth);
      // 0.6909409 × cos(47.6 deg) = 0.4659030 mi
      expect(eastWest).toBeCloseTo(northSouth * Math.cos((47.6 * Math.PI) / 180), 6);
      expect(eastWest).toBeCloseTo(0.465903, 5);
    });

    it('is symmetric and zero for identical points', () => {
      expect(haversineMiles(47.6, -122.3, 47.6, -122.3)).toBe(0);
      const ab = haversineMiles(47.6, -122.3, 47.65, -122.35);
      const ba = haversineMiles(47.65, -122.35, 47.6, -122.3);
      expect(ab).toBeCloseTo(ba, 12);
    });

    it('does not go the long way round the antimeridian', () => {
      // -179.99 and +179.99 are 0.02 deg apart, not 359.98. A naive
      // subtraction puts these two houses ~17,000 miles apart and every comp
      // in the Pacific gets rejected TOO_FAR.
      const d = haversineMiles(0, -179.99, 0, 179.99);
      expect(d).toBeLessThan(2);
      expect(d).toBeCloseTo(MI_PER_DEG_LAT * 0.02, 6);
    });

    it('handles the poles and the equator without NaN', () => {
      for (const [aLat, aLng, bLat, bLng] of [
        [90, 0, -90, 0], [0, 0, 0, 180], [90, 0, 90, 180], [0, 0, 0, 0],
      ]) {
        const d = haversineMiles(aLat, aLng, bLat, bLng);
        expect(Number.isFinite(d), `${aLat},${aLng} -> ${bLat},${bLng}`).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('monthsBetween', () => {
    it('is days / 30.44, so 12 months is 365.28 days', () => {
      expect(monthsBetween(daysAgo(30), NOW)).toBeCloseTo(30 / DAYS_PER_MONTH, 9);
      expect(monthsBetween(daysAgo(365), NOW)).toBeCloseTo(11.9908016, 6);
      expect(monthsBetween(daysAgo(366), NOW)).toBeCloseTo(12.0236531, 6);
      expect(MAX_COMP_AGE_MONTHS * DAYS_PER_MONTH).toBeCloseTo(365.28, 9);
    });

    it('is not calendar months', () => {
      // A calendar-month implementation puts 2024-07-15 -> 2025-07-15 at
      // exactly 12.0 and rejects it. The contract's 30.44-day month puts it at
      // 11.99 and keeps it.
      expect(monthsBetween('2024-07-15', NOW)).toBeLessThan(12);
      expect(monthsBetween('2024-07-15', NOW)).toBeCloseTo(11.9908016, 6);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('median', () => {
    it('odd n is the middle value', () => {
      expect(median([200, 190, 210])).toBe(200);
      expect(median([5])).toBe(5);
    });

    it('even n is the MEAN of the middle two, not the lower one', () => {
      expect(median([190, 200, 210, 220])).toBe(205);
      expect(median([200, 202])).toBe(201);
      // Picking the lower middle would give 200 and 200 respectively — and
      // would change the non-arms-length threshold on every even-sized set.
      expect(median([190, 200, 210, 220])).not.toBe(200);
    });

    it('does not depend on input order and does not mutate the input', () => {
      const input = [220, 190, 210, 200];
      const copy = [...input];
      expect(median(input)).toBe(205);
      expect(median([...input].reverse())).toBe(205);
      expect(input, 'median sorted its argument in place').toEqual(copy);
    });

    it('sorts numerically, not lexicographically', () => {
      // [9, 10, 100] sorted as strings is ["10","100","9"] -> median 100.
      expect(median([9, 10, 100])).toBe(10);
      expect(median([2, 10, 1])).toBe(2);
    });
  });

  // =========================================================================
  // Each rule in isolation. A single comp is passed, so the non-arms-length
  // median is that comp's own $/sqft and rule 10 can never fire by accident.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('each hard filter in isolation', () => {
    it('a fully valid comp is kept, with no rejection', () => {
      const { kept, rejected } = applyHardFilters(SUBJECT, [validComp()], 2.0, NOW);
      expect(kept).toHaveLength(1);
      expect(rejected).toHaveLength(0);
    });

    it('rule 1 NOT_SOLD — and status is case-insensitive', () => {
      expect(reasonFor({ status: 'FOR_SALE' })).toBe('NOT_SOLD');
      expect(reasonFor({ status: 'PENDING' })).toBe('NOT_SOLD');
      expect(reasonFor({ status: '' })).toBe('NOT_SOLD');
      for (const s of ['SOLD', 'sold', 'Sold', 'sOlD']) {
        expect(reasonFor({ status: s }), `status ${s} should be accepted`).toBeNull();
      }
    });

    it('rule 2 STALE_SALE — the wall is 365.28 days, not 365', () => {
      expect(reasonFor({ soldDate: daysAgo(365) }), '365 days is 11.99 months').toBeNull();
      expect(reasonFor({ soldDate: daysAgo(366) })).toBe('STALE_SALE');
      expect(reasonFor({ soldDate: daysAgo(400) })).toBe('STALE_SALE');
      expect(reasonFor({ soldDate: null })).toBe('STALE_SALE');
      expect(reasonFor({ soldDate: daysAgo(1) })).toBeNull();
    });

    it('rule 3 SQFT_MISSING — null, zero and negative', () => {
      expect(reasonFor({ livingArea: null })).toBe('SQFT_MISSING');
      expect(reasonFor({ livingArea: 0 })).toBe('SQFT_MISSING');
      expect(reasonFor({ livingArea: -100 })).toBe('SQFT_MISSING');
    });

    it('rule 4 SQFT_OUT_OF_RANGE — band edges are INCLUSIVE', () => {
      // subject 2,000 ± 25% -> [1500, 2500]. "Outside" the band rejects, so
      // sitting exactly on the edge is kept.
      const lo = SUBJECT.livingArea! * (1 - SQFT_TOLERANCE); // 1500
      const hi = SUBJECT.livingArea! * (1 + SQFT_TOLERANCE); // 2500
      expect(lo).toBe(1500);
      expect(hi).toBe(2500);
      expect(reasonFor({ livingArea: 1500 }), 'exactly -25% must be kept').toBeNull();
      expect(reasonFor({ livingArea: 2500 }), 'exactly +25% must be kept').toBeNull();
      expect(reasonFor({ livingArea: 1499 })).toBe('SQFT_OUT_OF_RANGE');
      expect(reasonFor({ livingArea: 2501 })).toBe('SQFT_OUT_OF_RANGE');
    });

    it('rule 5 BEDS_DIFF — |diff| > 1 rejects, exactly 1 is kept', () => {
      expect(reasonFor({ beds: 2 })).toBeNull(); // diff 1
      expect(reasonFor({ beds: 4 })).toBeNull(); // diff 1
      expect(reasonFor({ beds: 1 })).toBe('BEDS_DIFF'); // diff 2
      expect(reasonFor({ beds: 5 })).toBe('BEDS_DIFF'); // diff 2
    });

    it('rule 6 BATHS_DIFF — half baths land inside, 1.5 does not', () => {
      expect(reasonFor({ baths: 2.5 })).toBeNull(); // diff 0.5
      expect(reasonFor({ baths: 3 })).toBeNull(); // diff 1
      expect(reasonFor({ baths: 1 })).toBeNull(); // diff 1
      expect(reasonFor({ baths: 3.5 })).toBe('BATHS_DIFF'); // diff 1.5
      expect(reasonFor({ baths: 0.5 })).toBe('BATHS_DIFF'); // diff 1.5
    });

    it('rules 5/6 — a null on EITHER side never rejects', () => {
      // CONTRACT is explicit: "null on either side = no rejection". Treating
      // null as 0 would reject every comp with unreported bathrooms, which is
      // a large slice of real Zillow data.
      expect(reasonFor({ beds: null })).toBeNull();
      expect(reasonFor({ baths: null })).toBeNull();
      expect(reasonFor({ beds: null, baths: null })).toBeNull();

      const noBeds = { ...SUBJECT, beds: null };
      expect(applyHardFilters(noBeds, [validComp({ beds: 9 })], 2.0, NOW).kept).toHaveLength(1);
      const noBaths = { ...SUBJECT, baths: null };
      expect(applyHardFilters(noBaths, [validComp({ baths: 9 })], 2.0, NOW).kept).toHaveLength(1);
    });

    it('rule 7 TYPE_MISMATCH — including OTHER never matching OTHER', () => {
      expect(reasonFor({ propertyType: 'CONDO' })).toBe('TYPE_MISMATCH');
      expect(reasonFor({ propertyType: 'TOWNHOUSE' })).toBe('TYPE_MISMATCH');
      expect(reasonFor({ propertyType: 'MANUFACTURED' })).toBe('TYPE_MISMATCH');
      expect(reasonFor({ propertyType: 'SFR' })).toBeNull();
      // The counter-intuitive clause, per CONTRACT §5.3 #7.
      expect(reasonFor({ propertyType: 'OTHER' })).toBe('TYPE_MISMATCH');
    });

    it('rule 7 — an OTHER subject can never keep any comp, by design', () => {
      // Consequence of "OTHER never matches anything, including OTHER": a
      // subject Zillow types as OTHER always ends at TOO_FEW_COMPS. Confirmed
      // deliberate rather than a typo (TEST_PLAN §8 Q5).
      const otherSubject = { ...SUBJECT, propertyType: 'OTHER' as PropertyType };
      const everyType: PropertyType[] = ['SFR', 'CONDO', 'TOWNHOUSE', 'MANUFACTURED', 'OTHER'];
      const comps = everyType.map((t, i) => validComp({ zpid: `T${i}`, propertyType: t }));
      const { kept, rejected } = applyHardFilters(otherSubject, comps, 2.0, NOW);
      expect(kept).toHaveLength(0);
      expect(rejected.every((r) => r.reason === 'TYPE_MISMATCH')).toBe(true);
    });

    it('rule 8 TOO_FAR — measured against the ACTIVE tier radius', () => {
      const near = { lat: latAt(0.4), lng: -122.3 };
      const far = { lat: latAt(0.6), lng: -122.3 };
      expect(reasonFor(near, 0.5)).toBeNull();
      expect(reasonFor(far, 0.5)).toBe('TOO_FAR');
      // The same comp is fine once the tier widens — the rule is not absolute.
      expect(reasonFor(far, 1.0)).toBeNull();
    });

    it('rule 8 — the comparison is `>`, so exactly on the radius is kept', () => {
      // NOTE ON HOW THIS IS PROVEN. A lat/lng pair cannot be constructed to
      // sit at exactly 0.5 mi in floating point: latAt(0.5) round-trips
      // through asin(sin(x)) and comes back 0.50000000000020639 — 2e-13 over,
      // correctly rejected. So the `>` vs `>=` distinction is proven at the one
      // distance that IS exact, zero, where haversine returns a true 0.
      expect(haversineMiles(47.6, -122.3, 47.6, -122.3)).toBe(0);
      expect(reasonFor({ lat: 47.6, lng: -122.3 }, 0), '0 > 0 must be false').toBeNull();
      expect(reasonFor({ lat: latAt(1e-6), lng: -122.3 }, 0)).toBe('TOO_FAR');
    });

    it('rule 8 — just inside and just outside a 0.5 mi tier', () => {
      expect(reasonFor({ lat: latAt(0.4999), lng: -122.3 }, 0.5)).toBeNull();
      expect(reasonFor({ lat: latAt(0.5001), lng: -122.3 }, 0.5)).toBe('TOO_FAR');
    });

    it('rule 9 PRICE_MISSING — null, zero and negative', () => {
      expect(reasonFor({ soldPrice: null })).toBe('PRICE_MISSING');
      expect(reasonFor({ soldPrice: 0 })).toBe('PRICE_MISSING');
      expect(reasonFor({ soldPrice: -1 })).toBe('PRICE_MISSING');
    });

    it('rule 11 LOT_ANOMALY — exactly 5x is kept, beyond it is not', () => {
      const ceiling = SUBJECT.lotSize! * LOT_ANOMALY_MULTIPLE; // 30,000
      expect(ceiling).toBe(30000);
      expect(reasonFor({ lotSize: 30000 }), 'exactly 5x must be kept').toBeNull();
      expect(reasonFor({ lotSize: 30001 })).toBe('LOT_ANOMALY');
      expect(reasonFor({ lotSize: 100 }), 'a small lot is not an anomaly').toBeNull();
    });

    it('rule 11 — a null lot on either side never rejects', () => {
      expect(reasonFor({ lotSize: null })).toBeNull();
      const noLot = { ...SUBJECT, lotSize: null };
      expect(applyHardFilters(noLot, [validComp({ lotSize: 9_000_000 })], 2.0, NOW).kept)
        .toHaveLength(1);
    });

    it('rule 12 FUTURE_SOLD_DATE — a sale that has not happened is not a comp', () => {
      // BUG-003's rejection half. Rule 2 does NOT catch this: a future date is
      // not "more than 12 months old", so before rule 12 existed a comp dated
      // tomorrow passed every filter and then scored NEGATIVE, ranking ahead of
      // every genuine sale and surviving the cap unconditionally.
      // Zillow emits these — pending-close dates and timezone-shifted rows.
      expect(reasonFor({ soldDate: daysAgo(-1) })).toBe('FUTURE_SOLD_DATE');
      expect(reasonFor({ soldDate: daysAgo(-400) })).toBe('FUTURE_SOLD_DATE');
      // Sold TODAY is not the future — the comparison is strictly after `now`.
      expect(reasonFor({ soldDate: daysAgo(0) }), 'a sale dated today was rejected').toBeNull();
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('first-match reason ordering (CONTRACT §5.3)', () => {
    it('reports the FIRST failing rule, not any failing rule', () => {
      // Each case fails several rules at once. The reported reason has to be
      // the earliest in the contract's list, because that list is what the
      // rendered explanation is written against.
      expect(
        reasonFor({ status: 'FOR_SALE', soldDate: null, livingArea: null, soldPrice: null }),
        'unsold + stale + no sqft + no price',
      ).toBe('NOT_SOLD');

      expect(
        reasonFor({ soldDate: daysAgo(400), livingArea: null, soldPrice: null }),
        'stale + no sqft + no price',
      ).toBe('STALE_SALE');

      expect(
        reasonFor({ livingArea: null, soldPrice: null, propertyType: 'CONDO' }),
        'no sqft + no price + wrong type',
      ).toBe('SQFT_MISSING');

      expect(
        reasonFor({ livingArea: 900, beds: 9, propertyType: 'CONDO' }),
        'sqft out of range + beds + type',
      ).toBe('SQFT_OUT_OF_RANGE');

      expect(reasonFor({ beds: 9, baths: 9 }), 'beds before baths').toBe('BEDS_DIFF');

      expect(
        reasonFor({ baths: 9, propertyType: 'CONDO' }),
        'baths before type',
      ).toBe('BATHS_DIFF');

      expect(
        reasonFor({ propertyType: 'CONDO', lat: latAt(5) }, 1.0),
        'type before distance',
      ).toBe('TYPE_MISMATCH');

      expect(
        reasonFor({ lat: latAt(5), soldPrice: null }, 1.0),
        'distance before missing price',
      ).toBe('TOO_FAR');

      expect(
        reasonFor({ soldPrice: null, lotSize: 9_000_000 }),
        'missing price before lot anomaly',
      ).toBe('PRICE_MISSING');

      // Rule 12 is LAST, so anything earlier wins over a future date. This is
      // the ordering most likely to be got wrong, because "the sale hasn't
      // happened" feels like it should be reported first.
      expect(
        reasonFor({ soldDate: daysAgo(-1), status: 'FOR_SALE' }),
        'not-sold before future-dated',
      ).toBe('NOT_SOLD');
      expect(
        reasonFor({ soldDate: daysAgo(-1), livingArea: null }),
        'missing sqft before future-dated',
      ).toBe('SQFT_MISSING');
      expect(
        reasonFor({ soldDate: daysAgo(-1), lotSize: 9_000_000 }),
        'lot anomaly before future-dated',
      ).toBe('LOT_ANOMALY');
      // ...and with nothing earlier failing, rule 12 is what fires.
      expect(reasonFor({ soldDate: daysAgo(-1) })).toBe('FUTURE_SOLD_DATE');
    });

    it('a future-dated comp never reaches the ARV at all', () => {
      // The end-to-end statement of BUG-003: rule 12 excludes it, so the
      // negative-score promotion it used to get is unreachable by construction
      // rather than merely clamped.
      const comps = [
        validComp({ zpid: 'FUTURE', soldDate: daysAgo(-1), soldPrice: 1_200_000 }),
        ...Array.from({ length: 4 }, (_, i) =>
          validComp({ zpid: `REAL${i}`, lat: latAt(0.01 * i), soldDate: daysAgo(30) }),
        ),
      ];
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      expect(kept.map((c) => c.zpid)).not.toContain('FUTURE');
      expect(kept).toHaveLength(4);
      expect(rejected.find((r) => r.comp.zpid === 'FUTURE')!.reason).toBe('FUTURE_SOLD_DATE');
    });

    it('every rejection carries a reason and the original comp', () => {
      const comps = [
        validComp({ zpid: 'A', status: 'FOR_SALE' }),
        validComp({ zpid: 'B', livingArea: 100 }),
        validComp({ zpid: 'C' }),
      ];
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      expect(kept.map((c) => c.zpid)).toEqual(['C']);
      expect(rejected.map((r) => `${r.comp.zpid}:${r.reason}`)).toEqual([
        'A:NOT_SOLD',
        'B:SQFT_OUT_OF_RANGE',
      ]);
      // kept + rejected must account for every input — a silently dropped comp
      // is a comp that vanished from the audit trail.
      expect(kept.length + rejected.length).toBe(comps.length);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('rule 10 NON_ARMS_LENGTH — the candidate median', () => {
    /** Comps at chosen $/sqft, all otherwise valid, all 2,000 sqft. */
    const at = (ppsf: number[], sqft = 2000) =>
      ppsf.map((p, i) => validComp({ zpid: `P${i}`, soldPrice: p * sqft, livingArea: sqft }));

    it('rejects below 40% of the candidate median', () => {
      // median([80, 190, 200, 210]) = 195, threshold 78 -> 80 survives.
      // median([70, 190, 200, 210]) = 195, threshold 78 -> 70 is rejected.
      const survives = applyHardFilters(SUBJECT, at([80, 190, 200, 210]), 2.0, NOW);
      expect(survives.kept).toHaveLength(4);

      const rejects = applyHardFilters(SUBJECT, at([70, 190, 200, 210]), 2.0, NOW);
      expect(rejects.kept).toHaveLength(3);
      expect(rejects.rejected[0].reason).toBe('NON_ARMS_LENGTH');
      expect(NON_ARMS_LENGTH_PPSF_FRACTION * 195).toBe(78);
    });

    it('a $1 family transfer is rejected and cannot drag the ARV down', () => {
      const comps = at([190, 200, 210]);
      comps.push(validComp({ zpid: 'GIFT', soldPrice: 1, livingArea: 2000 }));
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      expect(kept.map((c) => c.zpid)).not.toContain('GIFT');
      expect(rejected.find((r) => r.comp.zpid === 'GIFT')!.reason).toBe('NON_ARMS_LENGTH');
    });

    it('the median is over the CANDIDATE set — comps rejected by other rules still count', () => {
      // Two teardown-lot sales at $1,000-1,200/sqft are outside the sqft band,
      // so they never become comps. They ARE real sales with a computable
      // $/sqft, so per CONTRACT §5.3 #10 they still set the median.
      //   candidate: [80, 190, 200, 210, 1000, 1200] -> median 205 -> thr 82
      //   post-filter only: [80, 190, 200, 210]      -> median 195 -> thr 78
      const comps = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'TEAR1', soldPrice: 1_000_000, livingArea: 1000 }), // out of band
        validComp({ zpid: 'TEAR2', soldPrice: 1_440_000, livingArea: 1200 }), // out of band
        validComp({ zpid: 'GIFT', soldPrice: 160_000, livingArea: 2000 }), // $80/sqft
      ];
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      expect(kept.map((c) => c.zpid).sort()).toEqual(['P0', 'P1', 'P2']);
      expect(rejected.find((r) => r.comp.zpid === 'GIFT')!.reason).toBe('NON_ARMS_LENGTH');
      expect(rejected.find((r) => r.comp.zpid === 'TEAR1')!.reason).toBe('SQFT_OUT_OF_RANGE');
    });

    it('comps with no computable $/sqft are excluded from the median entirely', () => {
      // A null price or a zero sqft yields no $/sqft. Including them as 0 would
      // drag the median down; including a zero-sqft comp as Infinity would drag
      // it up. Both change who gets rejected.
      const withNulls = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'NOPRICE', soldPrice: null }),
        validComp({ zpid: 'NOSQFT', livingArea: 0 }),
        validComp({ zpid: 'GIFT', soldPrice: 158_000, livingArea: 2000 }), // $79/sqft
      ];
      // candidate = [79, 190, 200, 210] -> median 195 -> threshold 78
      // 79 >= 78, so GIFT survives. If NOPRICE/NOSQFT were folded in as 0 the
      // median would move to 190 (threshold 76) — still surviving — but if
      // NOSQFT came in as Infinity the median becomes 205 (threshold 82) and
      // GIFT would be wrongly rejected.
      const { kept } = applyHardFilters(SUBJECT, withNulls, 2.0, NOW);
      expect(kept.map((c) => c.zpid)).toContain('GIFT');
    });

    it('is order-independent — shuffling the input changes nothing', () => {
      const comps = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'TEAR1', soldPrice: 1_000_000, livingArea: 1000 }),
        validComp({ zpid: 'GIFT', soldPrice: 160_000, livingArea: 2000 }),
      ];
      const forward = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      const backward = applyHardFilters(SUBJECT, [...comps].reverse(), 2.0, NOW);
      expect(forward.kept.map((c) => c.zpid).sort()).toEqual(
        backward.kept.map((c) => c.zpid).sort(),
      );
      expect(forward.rejected.map((r) => `${r.comp.zpid}:${r.reason}`).sort()).toEqual(
        backward.rejected.map((r) => `${r.comp.zpid}:${r.reason}`).sort(),
      );
    });

    it('is radius-independent — the same comps are rejected at every tier', () => {
      // The candidate set is "all INPUT comps", so widening the radius must not
      // move the threshold. If it did, the same house would be arms-length at
      // 0.5 mi and a family transfer at 2.0 mi.
      // candidate = [70, 190, 200, 210] -> median 195 -> threshold 78, and
      // $70/sqft is below it. (At $80/sqft it would SURVIVE — the threshold
      // here is 78, not the 82 of the golden-06 set, because that set has two
      // teardown sales pulling the median up. Worth stating: the same gift
      // price is arms-length or not depending on the rest of the street.)
      const comps = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'GIFT', soldPrice: 140_000, livingArea: 2000, lat: latAt(1.5) }),
      ];
      const reasons = RADIUS_TIERS_MI.map(
        (r) => applyHardFilters(SUBJECT, comps, r, NOW).rejected
          .find((x) => x.comp.zpid === 'GIFT')?.reason,
      );
      // At 0.5 and 1.0 mi it is TOO_FAR (rule 8 fires before rule 10);
      // at 2.0 mi distance passes and the non-arms-length rule takes over.
      expect(reasons[0]).toBe('TOO_FAR');
      expect(reasons[1]).toBe('TOO_FAR');
      expect(reasons[2]).toBe('NON_ARMS_LENGTH');
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('selectRadiusTier', () => {
    const nearby = (n: number, miles: number, from = 0) =>
      Array.from({ length: n }, (_, i) =>
        validComp({ zpid: `N${from + i}`, lat: latAt(miles), lng: -122.3 }),
      );

    it('4 inside 0.5 mi plus a 5th at 0.8 escalates to the 1.0 tier', () => {
      const comps = [...nearby(4, 0.3), ...nearby(1, 0.8, 4)];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(r.radiusTierMi).toBe(1.0);
      expect(r.kept).toHaveLength(5);
    });

    it('EXACTLY 5 inside 0.5 mi does NOT escalate', () => {
      // `kept >= MIN_COMPS_FOR_TIER` stops here. `kept > MIN_COMPS_FOR_TIER`
      // would widen the search to a mile and pull in weaker comps that then
      // move the ARV — with nothing in the output saying it happened.
      const comps = [...nearby(5, 0.3), ...nearby(3, 0.8, 5)];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(MIN_COMPS_FOR_TIER).toBe(5);
      expect(r.radiusTierMi).toBe(0.5);
      expect(r.kept).toHaveLength(5);
      expect(r.kept.map((c) => c.zpid)).not.toContain('N5');
    });

    it('4 inside 0.5 with nothing further out falls through to 2.0', () => {
      const r = selectRadiusTier(SUBJECT, nearby(4, 0.3), NOW);
      expect(r.radiusTierMi).toBe(2.0);
      expect(r.kept).toHaveLength(4);
    });

    it('a thin market reports the LAST tier tried, not where the comps were', () => {
      // Three comps all within 0.21 mi. Every tier keeps the same three, so the
      // search exhausts the ladder. Reporting 0.5 would tell the member we
      // found three comps in a tight radius; the truth is we searched two miles
      // and still only found three.
      const r = selectRadiusTier(SUBJECT, nearby(3, 0.2), NOW);
      expect(r.radiusTierMi).toBe(2.0);
      expect(r.kept).toHaveLength(3);
    });

    it('escalates all the way to 2.0 when 1.0 is still short', () => {
      const comps = [...nearby(2, 0.3), ...nearby(1, 0.8, 2), ...nearby(4, 1.5, 3)];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(r.radiusTierMi).toBe(2.0);
      expect(r.kept).toHaveLength(7);
    });

    it('reports the rejected list from the FINAL tier only', () => {
      // A comp that was TOO_FAR at 0.5 mi but is kept at 2.0 must not appear in
      // `rejected` — otherwise the rendered table shows a comp as both used and
      // rejected.
      const comps = [...nearby(2, 0.3), ...nearby(4, 1.5, 2)];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(r.radiusTierMi).toBe(2.0);
      expect(r.kept).toHaveLength(6);
      expect(r.rejected).toHaveLength(0);
      const keptIds = new Set(r.kept.map((c) => c.zpid));
      for (const rej of r.rejected) {
        expect(keptIds.has(rej.comp.zpid), `${rej.comp.zpid} is both kept and rejected`).toBe(false);
      }
    });

    it('re-runs the FULL filter pass at each tier, not just the distance check', () => {
      // A comp that is both far away AND unsold must still be reported
      // NOT_SOLD at the final tier — not TOO_FAR left over from an earlier
      // pass, and not silently kept once the radius grows.
      const comps = [
        ...nearby(3, 0.2),
        validComp({ zpid: 'FARSOLD', lat: latAt(1.5), status: 'FOR_SALE' }),
      ];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(r.radiusTierMi).toBe(2.0);
      expect(r.kept).toHaveLength(3);
      expect(r.rejected.find((x) => x.comp.zpid === 'FARSOLD')!.reason).toBe('NOT_SOLD');
    });

    it('kept + rejected accounts for every input comp at the final tier', () => {
      const comps = [
        ...nearby(3, 0.2),
        validComp({ zpid: 'X1', status: 'FOR_SALE' }),
        validComp({ zpid: 'X2', livingArea: 100 }),
        validComp({ zpid: 'X3', lat: latAt(9) }),
      ];
      const r = selectRadiusTier(SUBJECT, comps, NOW);
      expect(r.kept.length + r.rejected.length).toBe(comps.length);
      expect(r.rejected.find((x) => x.comp.zpid === 'X3')!.reason).toBe('TOO_FAR');
    });

    it('an empty input yields zero kept at the last tier, not a crash', () => {
      const r = selectRadiusTier(SUBJECT, [], NOW);
      expect(r.kept).toHaveLength(0);
      expect(r.rejected).toHaveLength(0);
      expect(r.radiusTierMi).toBe(RADIUS_TIERS_MI[RADIUS_TIERS_MI.length - 1]);
    });

    it('the tier ladder is exactly [0.5, 1.0, 2.0], ascending', () => {
      expect(RADIUS_TIERS_MI).toEqual([0.5, 1.0, 2.0]);
      for (let i = 1; i < RADIUS_TIERS_MI.length; i++) {
        expect(RADIUS_TIERS_MI[i]).toBeGreaterThan(RADIUS_TIERS_MI[i - 1]);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the injected clock', () => {
    it('nothing reads the real date — moving `now` moves the staleness wall', () => {
      const comp = validComp({ soldDate: '2024-08-01' });
      // 2024-08-01 is 348 days before 2025-07-15 -> 11.43 months -> kept.
      expect(applyHardFilters(SUBJECT, [comp], 2.0, NOW).kept).toHaveLength(1);
      // Same comp, clock moved forward a year -> 713 days -> 23.4 months -> stale.
      const later = new Date('2026-07-15T00:00:00.000Z');
      expect(applyHardFilters(SUBJECT, [comp], 2.0, later).rejected[0].reason).toBe('STALE_SALE');
    });

    it('is deterministic — the same inputs give the same result every call', () => {
      const comps = [validComp({ zpid: 'A' }), validComp({ zpid: 'B', status: 'PENDING' })];
      const a = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      const b = applyHardFilters(SUBJECT, comps, 2.0, NOW);
      expect(a.kept.map((c) => c.zpid)).toEqual(b.kept.map((c) => c.zpid));
      expect(a.rejected.map((r) => r.reason)).toEqual(b.rejected.map((r) => r.reason));
    });
  });
});
