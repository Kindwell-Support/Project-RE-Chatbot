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
  selectTiers,
} from '../../src/features/comps/filter.js';
import {
  EARTH_RADIUS_MI,
  DAYS_PER_MONTH,
  MAX_COMP_AGE_MONTHS,
  SQFT_TOLERANCE,
  RADIUS_TIERS_MI,
  RECENCY_TIERS_MONTHS,
  MIN_COMPS_FOR_TIER,
  NON_ARMS_LENGTH_PPSF_FRACTION,
} from '../../src/features/comps/config.js';
import type { PropertyType, RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['filter', 'config'] as const;

const NOW = new Date('2025-07-15T00:00:00.000Z');

/**
 * The outer recency bound. `applyHardFilters` gained `maxAgeMonths` in v2
 * (§14.1) — the recency gate is TIERED now, not flat. Unit cases that are
 * not about recency pass the widest rung so the age gate never fires and
 * the rule under test is the only thing that can reject.
 */
const WIDE_AGE = 12;

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
function reasonFor(
  overrides: Partial<RawComp>,
  radiusMi = 3.0,
  maxAgeMonths = WIDE_AGE,
): string | null {
  const { kept, rejected } = applyHardFilters(SUBJECT, [validComp(overrides)], radiusMi, maxAgeMonths, NOW);
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
      const { kept, rejected } = applyHardFilters(SUBJECT, [validComp()], 2.0, WIDE_AGE, NOW);
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
      // v2 (§14.1): SQFT_TOLERANCE tightened 0.25 -> 0.20.
      // subject 2,000 ± 20% -> [1600, 2400]. "Outside" the band rejects, so
      // sitting exactly on the edge is kept.
      const lo = SUBJECT.livingArea! * (1 - SQFT_TOLERANCE); // 1600
      const hi = SUBJECT.livingArea! * (1 + SQFT_TOLERANCE); // 2400
      expect(SQFT_TOLERANCE, 'the v2 tolerance is 0.20, not 0.25').toBe(0.2);
      expect(lo).toBe(1600);
      expect(hi).toBe(2400);
      expect(reasonFor({ livingArea: 1600 }), 'exactly -20% must be kept').toBeNull();
      expect(reasonFor({ livingArea: 2400 }), 'exactly +20% must be kept').toBeNull();
      expect(reasonFor({ livingArea: 1599 })).toBe('SQFT_OUT_OF_RANGE');
      expect(reasonFor({ livingArea: 2401 })).toBe('SQFT_OUT_OF_RANGE');

      // The OLD v1 edges are now comfortably outside the band. If the tolerance
      // were silently reverted these two would flip to null and nothing else in
      // the file would notice.
      expect(reasonFor({ livingArea: 1500 }), 'the v1 -25% edge is still being kept')
        .toBe('SQFT_OUT_OF_RANGE');
      expect(reasonFor({ livingArea: 2500 }), 'the v1 +25% edge is still being kept')
        .toBe('SQFT_OUT_OF_RANGE');
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
      expect(applyHardFilters(noBeds, [validComp({ beds: 9 })], 2.0, WIDE_AGE, NOW).kept).toHaveLength(1);
      const noBaths = { ...SUBJECT, baths: null };
      expect(applyHardFilters(noBaths, [validComp({ baths: 9 })], 2.0, WIDE_AGE, NOW).kept).toHaveLength(1);
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
      const { kept, rejected } = applyHardFilters(otherSubject, comps, 2.0, WIDE_AGE, NOW);
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

    it('RETIRED rule 11 — LOT_ANOMALY is never emitted, at any lot size', () => {
      // v2 (§14.1): the hard lot gate is REMOVED. Lot became a soft SCORING
      // term (§14.3) because a hard gate decimates thin markets. The
      // `RejectReason` union keeps the member so cached v1 results still type,
      // but nothing may produce it.
      //
      // This is the inversion of the old case. It used to prove 30,001 sqft
      // rejects; it now proves it does NOT — and that the reason is gone from
      // the vocabulary rather than merely from this one path.
      const oldCeiling = SUBJECT.lotSize! * 5; // 30,000 — the v1 gate
      expect(oldCeiling).toBe(30000);

      for (const lotSize of [100, 6000, 30000, 30001, 60000, 9_000_000]) {
        expect(
          reasonFor({ lotSize }),
          `a lot of ${lotSize} sqft was rejected — the v2 lot gate is supposed to be gone`,
        ).toBeNull();
      }
    });

    it('RETIRED rule 11 — no lot size anywhere in a mixed set produces the reason', () => {
      // The loop above proves it one comp at a time. A gate can also be
      // reintroduced only on the multi-comp path (e.g. relative to a set
      // median), so sweep a whole set too.
      const comps = [100, 6000, 30000, 30001, 500_000, 9_000_000].map((lotSize, i) =>
        validComp({ zpid: `L${i}`, lotSize, lat: latAt(0.05 * i) }),
      );
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 3.0, WIDE_AGE, NOW);

      // POSITIVE PRECONDITION — every comp is otherwise valid, so all six must
      // survive. Without this, "no LOT_ANOMALY" is satisfied by rejecting them
      // all for some other reason.
      expect(kept, 'a comp was dropped for something other than its lot').toHaveLength(6);
      expect(rejected.map((r) => r.reason), 'LOT_ANOMALY came back').not.toContain('LOT_ANOMALY');
    });

    it('a null lot on either side is still harmless', () => {
      expect(reasonFor({ lotSize: null })).toBeNull();
      const noLot = { ...SUBJECT, lotSize: null };
      expect(applyHardFilters(noLot, [validComp({ lotSize: 9_000_000 })], 2.0, WIDE_AGE, NOW).kept)
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

      // Rule 11's slot in the ladder is now empty (§14.1), so a monstrous lot
      // no longer competes for the reason at all — the next rule down wins.
      expect(
        reasonFor({ soldPrice: null, lotSize: 9_000_000 }),
        'missing price no longer wins the reason',
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
      // Was 'lot anomaly before future-dated'. With rule 11 retired there is
      // nothing earlier to fire, so rule 12 now takes it — the clearest
      // single proof that the lot gate is gone from the LADDER and not just
      // from its own test.
      expect(
        reasonFor({ soldDate: daysAgo(-1), lotSize: 9_000_000 }),
        'a 9,000,000 sqft lot still pre-empts the future-date reason',
      ).toBe('FUTURE_SOLD_DATE');
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
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
      expect(kept.map((c) => c.zpid)).not.toContain('FUTURE');
      expect(kept).toHaveLength(4);
      expect(rejected.find((r) => r.comp.zpid === 'FUTURE')!.reason).toBe('FUTURE_SOLD_DATE');
    });

    it('every rejection carries a reason and the original comp', () => {
      // Distinct PRICES, not just distinct zpids. With A and C identical on
      // price/sqft/date/coords they are one sale, `candidateMedianPpsf`
      // dedupes them (§5.3 #10), and the median collapses onto B's absurd
      // $4,000/sqft — which then rejects C as NON_ARMS_LENGTH. Correct
      // behaviour, wrong fixture.
      const comps = [
        validComp({ zpid: 'A', soldPrice: 405000, status: 'FOR_SALE' }),
        validComp({ zpid: 'B', soldPrice: 410000, livingArea: 100 }),
        validComp({ zpid: 'C', soldPrice: 400000 }),
      ];
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
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
      const survives = applyHardFilters(SUBJECT, at([80, 190, 200, 210]), 2.0, WIDE_AGE, NOW);
      expect(survives.kept).toHaveLength(4);

      const rejects = applyHardFilters(SUBJECT, at([70, 190, 200, 210]), 2.0, WIDE_AGE, NOW);
      expect(rejects.kept).toHaveLength(3);
      expect(rejects.rejected[0].reason).toBe('NON_ARMS_LENGTH');
      expect(NON_ARMS_LENGTH_PPSF_FRACTION * 195).toBe(78);
    });

    it('a $1 family transfer is rejected and cannot drag the ARV down', () => {
      const comps = at([190, 200, 210]);
      comps.push(validComp({ zpid: 'GIFT', soldPrice: 1, livingArea: 2000 }));
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
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
      const { kept, rejected } = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
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
      const { kept } = applyHardFilters(SUBJECT, withNulls, 2.0, WIDE_AGE, NOW);
      expect(kept.map((c) => c.zpid)).toContain('GIFT');
    });

    it('is order-independent — shuffling the input changes nothing', () => {
      const comps = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'TEAR1', soldPrice: 1_000_000, livingArea: 1000 }),
        validComp({ zpid: 'GIFT', soldPrice: 160_000, livingArea: 2000 }),
      ];
      const forward = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
      const backward = applyHardFilters(SUBJECT, [...comps].reverse(), 2.0, WIDE_AGE, NOW);
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
      //
      // GIFT is placed INSIDE the tightest rung so distance can never be what
      // rejects it — otherwise the case degenerates into "rule 8 fires before
      // rule 10", which is a rule-ordering fact, not radius independence.
      //
      // candidate ppsf (all inputs, deduped) = [70, 190, 200, 205, 210]
      //   -> median 200 -> threshold 0.4 x 200 = 80, and $70/sqft is below it.
      // The candidate set is defined over INPUT comps, so widening the radius
      // cannot move that threshold by a cent.
      const comps = [
        ...at([190, 200, 210]),
        validComp({ zpid: 'GIFT', soldPrice: 140_000, livingArea: 2000, lat: latAt(0.2) }),
        validComp({ zpid: 'FAR', soldPrice: 410_000, livingArea: 2000, lat: latAt(2.5) }),
      ];
      const runs = RADIUS_TIERS_MI.map((r) => applyHardFilters(SUBJECT, comps, r, WIDE_AGE, NOW));
      expect(RADIUS_TIERS_MI, 'the v2 ladder is two rungs').toEqual([1.0, 3.0]);
      expect(NON_ARMS_LENGTH_PPSF_FRACTION * 200).toBe(80);

      // POSITIVE PRECONDITION — the radius genuinely changes the outcome for
      // SOMETHING. Without FAR moving, "the same at every tier" is satisfied by
      // a filter that ignores the radius entirely.
      expect(runs[0].kept.map((c) => c.zpid), 'FAR was admitted at the 1.0 mi rung')
        .not.toContain('FAR');
      expect(runs[1].kept.map((c) => c.zpid), 'FAR was still excluded at the 3.0 mi rung')
        .toContain('FAR');

      // ...and yet GIFT's verdict is identical at both. The same house cannot
      // be arms-length at one mile and a family transfer at three.
      for (const [i, run] of runs.entries()) {
        expect(
          run.rejected.find((x) => x.comp.zpid === 'GIFT')?.reason,
          `GIFT's verdict changed at the ${RADIUS_TIERS_MI[i]} mi rung`,
        ).toBe('NON_ARMS_LENGTH');
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('selectTiers — the v2 two-dimensional ladder', () => {
    /**
     * §14.2 pins ONE ordered ladder of six rungs, stopping at the first that
     * yields >= MIN_COMPS_FOR_TIER (5):
     *
     *   1.0 mi / 3 mo  ->  1.0 mi / 6 mo  ->  1.0 mi / 12 mo
     *                  ->  3.0 mi / 3 mo  ->  3.0 mi / 6 mo  ->  3.0 mi / 12 mo
     *
     * RECENCY WIDENS BEFORE RADIUS. That ordering is a pinned design decision,
     * not an implementation detail, and it is the single thing here most likely
     * to be "corrected" later by someone who finds radius-first more natural —
     * so it gets a case whose two orderings give visibly different answers.
     *
     * NOTE ON FIXTURES. `dedupeSales` now runs inside the walker (BUG-010), and
     * it matches on price + living area + sold date + coordinates. Comps that
     * are identical on those four collapse into one. Every helper below
     * therefore varies price per index — otherwise `nearby(5, 0.3)` would be a
     * single comp wearing five zpids and every count in this block would be
     * wrong for a reason that has nothing to do with tiers.
     */
    const AGE_5_MONTHS = 152;  // 152 / 30.44 = 4.9934 mo — inside 6, outside 3
    const AGE_9_MONTHS = 274;  // 274 / 30.44 = 9.0013 mo — inside 12, outside 6

    /** `n` distinct valid sales at `miles` due north, optionally aged. */
    const at = (n: number, miles: number, opts: { from?: number; days?: number } = {}) => {
      const from = opts.from ?? 0;
      return Array.from({ length: n }, (_, i) =>
        validComp({
          zpid: `N${from + i}`,
          lat: latAt(miles),
          lng: -122.3,
          // distinct SALE, not merely a distinct id — see the note above
          soldPrice: 400000 + (from + i) * 1000,
          ...(opts.days === undefined ? {} : { soldDate: daysAgo(opts.days) }),
        }),
      );
    };

    const rung = (r: { radiusTierMi: number; recencyTierMonths: number }) =>
      `${r.radiusTierMi} mi / ${r.recencyTierMonths} mo`;

    it('the ladder constants are the v2 ones, and both ascend', () => {
      expect(RADIUS_TIERS_MI, 'the radius ladder is not the v2 [1.0, 3.0]').toEqual([1.0, 3.0]);
      expect(RECENCY_TIERS_MONTHS, 'the recency ladder is not [3, 6, 12]').toEqual([3, 6, 12]);
      expect(MIN_COMPS_FOR_TIER).toBe(5);
      // The outer recency rung IS the 12-month wall — §14.1 keeps it as the
      // outer bound. If they drift apart, either a rung is unreachable or the
      // wall is being breached.
      expect(RECENCY_TIERS_MONTHS[RECENCY_TIERS_MONTHS.length - 1]).toBe(MAX_COMP_AGE_MONTHS);
      for (const ladder of [RADIUS_TIERS_MI, RECENCY_TIERS_MONTHS]) {
        for (let i = 1; i < ladder.length; i++) {
          expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
        }
      }
    });

    it('rung 1: five fresh comps inside a mile stop the walk immediately', () => {
      const r = selectTiers(SUBJECT, at(5, 0.3), NOW);
      expect(r.kept, 'the five distinct sales did not all survive').toHaveLength(5);
      expect(rung(r), 'the walk did not stop at the first rung').toBe('1 mi / 3 mo');
    });

    it('rung 2: a short first rung widens RECENCY, and the radius stays at 1.0', () => {
      // 4 fresh + 1 five-month-old, all inside a mile.
      //   1.0/3 -> 4  (short)
      //   1.0/6 -> 5  STOP
      const comps = [...at(4, 0.3), ...at(1, 0.3, { from: 4, days: AGE_5_MONTHS })];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(r.kept).toHaveLength(5);
      expect(rung(r)).toBe('1 mi / 6 mo');
      expect(r.radiusTierMi, 'the radius widened when recency had room left').toBe(1.0);
    });

    it('rung 3: two short rungs reach 12 months before the radius moves at all', () => {
      const comps = [...at(4, 0.3), ...at(1, 0.3, { from: 4, days: AGE_9_MONTHS })];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(r.kept).toHaveLength(5);
      expect(rung(r)).toBe('1 mi / 12 mo');
    });

    it('THE ORDER PROOF — recency widens before radius, and the two answers differ', () => {
      // Constructed so the two possible orderings do not merely relabel the
      // tier, they return DIFFERENT COMPS:
      //
      //   4 fresh inside a mile
      //   1 five-month-old inside a mile
      //   3 fresh at 2.5 mi
      //
      // Recency-first:  1.0/3 -> 4 short;  1.0/6 -> 5  STOP.
      //                 The three distant comps are TOO_FAR and never used.
      // Radius-first:   1.0/3 -> 4 short;  3.0/3 -> 7  STOP.
      //                 A completely different comp set and a different ARV.
      const comps = [
        ...at(4, 0.3),
        ...at(1, 0.3, { from: 4, days: AGE_5_MONTHS }),
        ...at(3, 2.5, { from: 5 }),
      ];
      const r = selectTiers(SUBJECT, comps, NOW);

      expect(rung(r), 'the ladder widened RADIUS before exhausting recency').toBe('1 mi / 6 mo');
      expect(r.kept, 'the distant comps were pulled in').toHaveLength(5);

      const keptIds = r.kept.map((c) => c.zpid).sort();
      expect(keptIds, 'the five-month-old comp inside a mile was not used')
        .toEqual(['N0', 'N1', 'N2', 'N3', 'N4']);
      for (const far of ['N5', 'N6', 'N7']) {
        const rej = r.rejected.find((x) => x.comp.zpid === far);
        expect(rej, `${far} at 2.5 mi is neither kept nor rejected`).toBeDefined();
        expect(rej!.reason, `${far} at 2.5 mi was admitted at a 1.0 mi rung`).toBe('TOO_FAR');
      }
    });

    it('rung 4: the radius DOES widen once all three recency rungs are short', () => {
      // 4 fresh inside a mile, 2 fresh at 2.5 mi, nothing old.
      //   1.0/3, 1.0/6, 1.0/12 -> 4 each (age never helps: everything is fresh)
      //   3.0/3                -> 6  STOP
      const comps = [...at(4, 0.3), ...at(2, 2.5, { from: 4 })];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(r.kept).toHaveLength(6);
      // Recency RESETS to the tightest rung when the radius steps out. A walker
      // that carried 12 months across would report 3.0/12 here and overstate
      // how far it had to reach.
      expect(rung(r), 'recency did not reset when the radius widened').toBe('3 mi / 3 mo');
    });

    it('EXACTLY 5 does not escalate — the test is >=, not >', () => {
      // `kept > MIN_COMPS_FOR_TIER` would widen past a perfectly good rung and
      // pull in weaker comps that then move the ARV, with nothing in the output
      // saying it happened.
      const comps = [...at(5, 0.3), ...at(3, 2.5, { from: 5 })];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(r.kept).toHaveLength(5);
      expect(rung(r)).toBe('1 mi / 3 mo');
      expect(r.kept.map((c) => c.zpid), 'a distant comp was pulled in at rung 1')
        .not.toContain('N5');
    });

    it('a thin market reports the LAST rung tried, not where the comps were', () => {
      // Three comps all within 0.21 mi and all fresh. Every rung keeps the same
      // three, so the walk exhausts the ladder. Reporting 1.0/3 would tell the
      // member we found three comps close by and recent; the truth is we
      // searched three miles and a full year and still only found three.
      const r = selectTiers(SUBJECT, at(3, 0.2), NOW);
      expect(r.kept).toHaveLength(3);
      expect(rung(r), 'a thin market is being reported as a tight search').toBe('3 mi / 12 mo');
    });

    it('four comps and nothing further out falls through to the final rung', () => {
      const r = selectTiers(SUBJECT, at(4, 0.3), NOW);
      expect(r.kept).toHaveLength(4);
      expect(rung(r)).toBe('3 mi / 12 mo');
    });

    it('the rejected list comes from the FINAL rung only', () => {
      // A comp that was TOO_FAR at 1.0 mi but is kept at 3.0 must not appear in
      // `rejected` — otherwise the rendered table shows one comp as both used
      // and rejected, which is the kind of detail that destroys trust in the
      // whole block.
      const comps = [...at(2, 0.3), ...at(4, 2.5, { from: 2 })];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(rung(r)).toBe('3 mi / 3 mo');
      expect(r.kept, 'precondition: the wider rung did not admit the distant comps')
        .toHaveLength(6);
      expect(r.rejected, 'a rejection from an earlier rung leaked through').toHaveLength(0);
      const keptIds = new Set(r.kept.map((c) => c.zpid));
      for (const rej of r.rejected) {
        expect(keptIds.has(rej.comp.zpid), `${rej.comp.zpid} is both kept and rejected`).toBe(false);
      }
    });

    it('re-runs the FULL filter pass at each rung, not just the distance check', () => {
      // FARNEAR proves the pass genuinely re-runs: TOO_FAR at every 1.0 rung,
      // kept once the radius reaches 3.0. FARSOLD proves the non-distance rules
      // are still applied at that final rung rather than being skipped once the
      // radius stops being the binding constraint.
      const comps = [
        ...at(3, 0.2),
        validComp({ zpid: 'FARNEAR', lat: latAt(2.5), soldPrice: 411000 }),
        validComp({ zpid: 'FARSOLD', lat: latAt(2.5), soldPrice: 412000, status: 'FOR_SALE' }),
      ];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(rung(r)).toBe('3 mi / 12 mo');
      expect(r.kept.map((c) => c.zpid), 'the 2.5 mi comp was never re-tested at 3.0')
        .toContain('FARNEAR');
      expect(r.kept).toHaveLength(4);
      expect(
        r.rejected.find((x) => x.comp.zpid === 'FARSOLD')!.reason,
        'an unsold listing survived once distance stopped being the binding rule',
      ).toBe('NOT_SOLD');
    });

    it('kept + rejected accounts for every input comp at the final rung', () => {
      const comps = [
        ...at(3, 0.2),
        validComp({ zpid: 'X1', soldPrice: 401500, status: 'FOR_SALE' }),
        validComp({ zpid: 'X2', soldPrice: 402500, livingArea: 100 }),
        validComp({ zpid: 'X3', soldPrice: 403500, lat: latAt(9) }),
      ];
      const r = selectTiers(SUBJECT, comps, NOW);
      expect(r.kept.length + r.rejected.length).toBe(comps.length);
      expect(r.rejected.find((x) => x.comp.zpid === 'X3')!.reason).toBe('TOO_FAR');
      expect(r.rejected.find((x) => x.comp.zpid === 'X2')!.reason).toBe('SQFT_OUT_OF_RANGE');
    });

    it('an empty input yields zero kept at the final rung, not a crash', () => {
      const r = selectTiers(SUBJECT, [], NOW);
      expect(r.kept).toHaveLength(0);
      expect(r.rejected).toHaveLength(0);
      expect(r.radiusTierMi).toBe(RADIUS_TIERS_MI[RADIUS_TIERS_MI.length - 1]);
      expect(r.recencyTierMonths).toBe(RECENCY_TIERS_MONTHS[RECENCY_TIERS_MONTHS.length - 1]);
    });

    it('every one of the six rungs is REACHABLE — none is dead code', () => {
      // A ladder rung that no input can ever land on is a rung that was never
      // tested. Each fixture below is built to stop on exactly one rung, and
      // together they must cover all six in the pinned order.
      const cases: Array<[string, RawComp[]]> = [
        ['1 mi / 3 mo', at(5, 0.3)],
        ['1 mi / 6 mo', [...at(4, 0.3), ...at(1, 0.3, { from: 4, days: AGE_5_MONTHS })]],
        ['1 mi / 12 mo', [...at(4, 0.3), ...at(1, 0.3, { from: 4, days: AGE_9_MONTHS })]],
        ['3 mi / 3 mo', [...at(4, 0.3), ...at(1, 2.5, { from: 4 })]],
        ['3 mi / 6 mo', [...at(4, 0.3), ...at(1, 2.5, { from: 4, days: AGE_5_MONTHS })]],
        ['3 mi / 12 mo', [...at(4, 0.3), ...at(1, 2.5, { from: 4, days: AGE_9_MONTHS })]],
      ];
      const landed = cases.map(([, comps]) => rung(selectTiers(SUBJECT, comps, NOW)));
      expect(landed, 'a rung is unreachable, or the walk order is not §14.2')
        .toEqual(cases.map(([want]) => want));
    });
  });

  // =========================================================================
  // BUG-006 — FAILS ON PURPOSE. This is the repro; reported in mailbox 0011.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('BUG-006: a same-day sale is rejected as future-dated', () => {
    // The mapped fixtures carry `soldDate` as a full timestamp preserving the
    // sale's LOCAL midnight — "2026-08-05T07:00:00.000Z" for Phoenix (UTC-7,
    // no DST). §4 says `soldDate` is an ISO *date*, and every piece of
    // arithmetic downstream assumes date-only.
    //
    // Rule 12 rejects `soldDate` strictly after `now`. So between 00:00Z and
    // 07:00Z a sale that closed TODAY in the client's own market is "in the
    // future" and silently disappears — with a reason that reads perfectly
    // plausible in the rejection table.
    const soldTodayPhoenix = '2026-08-05T07:00:00.000Z';

    /** Identical to the subject in every filterable way — only rule 12 can fire. */
    const twin = validComp({
      zpid: 'TWIN', soldDate: soldTodayPhoenix,
      beds: SUBJECT.beds, baths: SUBJECT.baths, livingArea: SUBJECT.livingArea,
      lotSize: SUBJECT.lotSize, propertyType: SUBJECT.propertyType,
      lat: SUBJECT.lat, lng: SUBJECT.lng,
    });

    const reasonAt = (nowIso: string) => {
      const { kept, rejected } = applyHardFilters(SUBJECT, [twin], 2.0, WIDE_AGE, new Date(nowIso));
      return kept.length ? null : rejected[0].reason;
    };

    it('is kept regardless of what hour of the UTC day the lookup runs', () => {
      // The freshest comps are the most valuable ones, and 00:00-07:00 UTC is
      // 5pm-midnight in Phoenix — prime usage hours in the client's market.
      expect(reasonAt('2026-08-05T18:00:00.000Z'), 'evening UTC').toBeNull();
      expect(reasonAt('2026-08-05T07:01:00.000Z'), 'just after 07:00Z').toBeNull();
      expect(reasonAt('2026-08-05T06:59:00.000Z'), 'just before 07:00Z').toBeNull();
      expect(reasonAt('2026-08-05T02:00:00.000Z'), 'early UTC').toBeNull();
    });

    it('the same address does not return different comps depending on the hour', () => {
      // Nondeterminism is the compounding harm: results are cached for 14 days,
      // so whichever comp set happens to be computed first gets frozen in.
      const hours = ['2026-08-05T02:00:00.000Z', '2026-08-05T12:00:00.000Z', '2026-08-05T23:00:00.000Z'];
      const outcomes = hours.map(reasonAt);
      expect(
        new Set(outcomes).size,
        `the same comp is kept at some hours and rejected at others: ${JSON.stringify(
          Object.fromEntries(hours.map((h, i) => [h, outcomes[i]])),
        )}`,
      ).toBe(1);
    });

    it('the root cause: soldDate should be a date, not a timestamp', () => {
      // With the contract's own date-only form the whole class disappears —
      // `.toISOString().slice(0, 10)` in the adapter is the entire fix.
      const dateOnly = validComp({ ...twin, soldDate: '2026-08-05' });
      for (const nowIso of ['2026-08-05T02:00:00.000Z', '2026-08-05T23:00:00.000Z']) {
        const { kept } = applyHardFilters(SUBJECT, [dateOnly], 2.0, WIDE_AGE, new Date(nowIso));
        expect(kept, `date-only form failed at ${nowIso}`).toHaveLength(1);
      }
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the injected clock', () => {
    it('nothing reads the real date — moving `now` moves the staleness wall', () => {
      const comp = validComp({ soldDate: '2024-08-01' });
      // 2024-08-01 is 348 days before 2025-07-15 -> 11.43 months -> kept.
      expect(applyHardFilters(SUBJECT, [comp], 2.0, WIDE_AGE, NOW).kept).toHaveLength(1);
      // Same comp, clock moved forward a year -> 713 days -> 23.4 months -> stale.
      const later = new Date('2026-07-15T00:00:00.000Z');
      expect(applyHardFilters(SUBJECT, [comp], 2.0, WIDE_AGE, later).rejected[0].reason)
        .toBe('STALE_SALE');
    });

    it('is deterministic — the same inputs give the same result every call', () => {
      const comps = [validComp({ zpid: 'A' }), validComp({ zpid: 'B', status: 'PENDING' })];
      const a = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
      const b = applyHardFilters(SUBJECT, comps, 2.0, WIDE_AGE, NOW);
      expect(a.kept.map((c) => c.zpid)).toEqual(b.kept.map((c) => c.zpid));
      expect(a.rejected.map((r) => r.reason)).toEqual(b.rejected.map((r) => r.reason));
    });
  });
});
