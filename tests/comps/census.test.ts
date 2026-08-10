/**
 * CENSUS DEMOGRAPHICS — CONTRACT §14.10, guarantees 1–4.
 *
 * Re-pointed onto the shipped seams (`providers/census.ts`) and onto the REAL
 * recordings rather than my hand-built fixture, which is now unused. Expected
 * values are hand-derived from the recording below, not read out of the
 * implementation.
 *
 *   spike-census-acs.json — Phoenix tract 04013111700, REAL:
 *     income 93333 · age 37.9 · total 2296 · owner 1427 · renter 869
 *     ownerOccupiedPct  = 1427/2296 = 0.62151568 → ×1000 = 621.51568 → 622 → 62.2
 *     renterOccupiedPct =  869/2296 = 0.37848432 → ×1000 = 378.48432 → 378 → 37.8
 *     (62.2 + 37.8 = 100.0, and 1427 + 869 = 2296 matches the returned total —
 *      the denominator is the SUM of the two counts, not the returned total,
 *      and this recording cannot tell those apart. See the case that can.)
 *
 *   spike-census-acs-sentinel.json — Phoenix tract 04013061017, REAL:
 *     income -666666666 · age 39.5 · total 0 · owner 0 · renter 0
 *     A live sentinel AND a zero denominator in one real tract. This is the
 *     answer to "does a sentinel actually occur" — it does, in Phoenix, in the
 *     client's own market.
 *
 * WHY THE SENTINEL CLASS IS THE ONE THAT BITES. ACS does not omit unavailable
 * values; it returns them as negatives in the same numeric field. Pass one
 * through and the member reads "median household income −$666,666,666";
 * coalesce it with `|| 0` and they read "$0", a real-looking figure claiming a
 * neighbourhood has no income. This is the THIRD appearance of the class after
 * `daysOnZillow: -1` and the detail DOM.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import {
  ACS_SENTINELS,
  ACS_VARIABLES,
  mapDemographicsFromAcs,
  mapTractFromGeocoder,
  type TractRef,
} from '../../src/features/comps/providers/census.js';

const MODS = ['providers/census'] as const;

const FIX = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'features', 'comps', '__fixtures__',
);
const load = (n: string) => JSON.parse(readFileSync(resolve(FIX, n), 'utf8'));

const REAL = load('spike-census-acs.json') as string[][];
const REAL_SENTINEL = load('spike-census-acs-sentinel.json') as string[][];
const GEOCODE = load('spike-census-geocode.json');

const TRACT: TractRef = { geoid: '04013111700', name: 'Census Tract 1117' } as TractRef;

/** Build an ACS body from a header→value map, so cases read as data. */
const body = (cols: Record<string, string | number>): string[][] => [
  Object.keys(cols),
  Object.values(cols).map(String),
];

const ALL = [
  ACS_VARIABLES.medianHouseholdIncome,
  ACS_VARIABLES.medianAge,
  ACS_VARIABLES.tenureOwner,
  ACS_VARIABLES.tenureRenter,
];

describe(`census demographics${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the recording still says what §14.10 was written from', () => {
    it('the real tract carries the values the derivation below assumes', () => {
      const [headers, values] = REAL;
      const at = (n: string) => values[headers.indexOf(n)];
      expect(at(ACS_VARIABLES.medianHouseholdIncome)).toBe('93333');
      expect(at(ACS_VARIABLES.medianAge)).toBe('37.9');
      expect(at(ACS_VARIABLES.tenureOwner)).toBe('1427');
      expect(at(ACS_VARIABLES.tenureRenter)).toBe('869');
    });

    it('a REAL Phoenix tract returns a sentinel — this is not a fixture assumption', () => {
      const [headers, values] = REAL_SENTINEL;
      const income = Number(values[headers.indexOf(ACS_VARIABLES.medianHouseholdIncome)]);
      expect(ACS_SENTINELS.has(income), `${income} is not in the enumerated set`).toBe(true);
      expect(income).toBe(-666666666);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 3 — suppressed values are unavailable, never zero', () => {
    it('all SIX enumerated sentinels are present, as a set not a threshold', () => {
      // The operator's ruling: a partial enumeration is the same failure as a
      // threshold. Asserted as an exact set so adding one is a visible decision
      // and dropping one is a failure.
      expect([...ACS_SENTINELS].sort((a, b) => a - b)).toEqual([
        -999999999, -888888888, -666666666, -555555555, -333333333, -222222222,
      ].sort((a, b) => a - b));
    });

    it.each([...ACS_SENTINELS])('sentinel %i nulls EVERY numeric field it appears in', (s) => {
      const out = mapDemographicsFromAcs(
        body(Object.fromEntries(ALL.map((v) => [v, s]))), TRACT,
      );
      expect(out.medianHouseholdIncome, `income survived sentinel ${s}`).toBeNull();
      expect(out.medianAge, `age survived sentinel ${s}`).toBeNull();
      expect(out.ownerOccupiedPct, `owner% survived sentinel ${s}`).toBeNull();
      expect(out.renterOccupiedPct, `renter% survived sentinel ${s}`).toBeNull();
    });

    it.each([...ACS_SENTINELS])('sentinel %i is never coalesced to ZERO', (s) => {
      // `?? 0` / `|| 0` renders "$0" — a measured-looking claim that a
      // neighbourhood has no income. Worse than a dash, because it is legible.
      const out = mapDemographicsFromAcs(
        body(Object.fromEntries(ALL.map((v) => [v, s]))), TRACT,
      );
      // UNGUARDED, and my own dead-guard sweep is why. This was
      // `if (typeof v === 'number') expect(v).not.toBe(0)` — false for every
      // field precisely when the mapper is CORRECT (all sentinels null), so
      // the assertion never ran. The exact pattern I documented, in a test I
      // had just written. Asserting null directly subsumes "not zero" and
      // cannot go dead.
      expect(
        [out.medianHouseholdIncome, out.medianAge, out.ownerOccupiedPct, out.renterOccupiedPct],
        `sentinel ${s} produced a figure — if any is 0 the member reads a measured ` +
          'claim that a neighbourhood has no income or nobody owns their home',
      ).toEqual([null, null, null, null]);
    });

    it('THE INVERSE: a genuine 0 count is a value, not an absence', () => {
      // An all-rental tract really is 0% owner-occupied. A "drop anything <= 0"
      // filter eats it and reports unavailable for a fact we actually have.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 0,
        [ACS_VARIABLES.tenureRenter]: 250,
      }), TRACT);
      expect(out.ownerOccupiedPct, 'a real 0% was discarded as if it were a sentinel').toBe(0);
      expect(out.renterOccupiedPct).toBe(100);
    });

    it('the REAL sentinel tract: income nulls, age survives, both percentages null', () => {
      // Hand-derived from spike-census-acs-sentinel.json. One real tract
      // exercising the sentinel AND the zero-denominator guard together —
      // and proving a sibling field is not collateral damage.
      const out = mapDemographicsFromAcs(REAL_SENTINEL, TRACT);
      expect(out.medianHouseholdIncome, 'the -666666666 reached the member').toBeNull();
      expect(out.medianAge, 'a GOOD field was nulled because a sibling was suppressed')
        .toBe(39.5);
      expect(out.ownerOccupiedPct, '0/0 produced a percentage').toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });

    it('a zero DENOMINATOR yields null, never NaN and never 0', () => {
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 0,
        [ACS_VARIABLES.tenureRenter]: 0,
      }), TRACT);
      expect(out.ownerOccupiedPct).toBeNull();
      expect(Number.isNaN(out.ownerOccupiedPct as number), '0/0 rendered as NaN').toBe(false);
    });

    it('an ABSENT column is null — never zero, never invented', () => {
      const out = mapDemographicsFromAcs(body({}), TRACT);
      expect(out.medianHouseholdIncome).toBeNull();
      expect(out.medianAge).toBeNull();
      expect(out.ownerOccupiedPct).toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 2 — arithmetic on returned counts, never inference', () => {
    it('the real tract computes both percentages to the hand-derived figures', () => {
      const out = mapDemographicsFromAcs(REAL, TRACT);
      expect(out.medianHouseholdIncome).toBe(93333);
      expect(out.medianAge).toBe(37.9);
      expect(out.ownerOccupiedPct, '1427/2296 = 62.2 to 1dp').toBe(62.2);
      expect(out.renterOccupiedPct, '869/2296 = 37.8 to 1dp').toBe(37.8);
    });

    it('a percentage needs BOTH counts — one suppressed nulls both', () => {
      // The inference boundary. With only the owner count returned, a
      // percentage can still be computed against the returned TOTAL — and that
      // is inference, because the total counts households the tenure split does
      // not. Both counts or neither.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 1427,
        [ACS_VARIABLES.tenureRenter]: -666666666,
        [ACS_VARIABLES.tenureTotal ?? 'B25003_001E']: 2296,
      }), TRACT);
      expect(
        out.ownerOccupiedPct,
        'a percentage was computed against the returned TOTAL while the renter ' +
          'count was suppressed — that denominator was not measured for this split',
      ).toBeNull();
      expect(out.renterOccupiedPct).toBeNull();
    });

    it('the denominator is the SUM of the two counts, not the returned total', () => {
      // The recording cannot distinguish these (1427 + 869 = 2296 exactly), so
      // this case makes them disagree. A total that exceeds the split is
      // ordinary — it counts households the tenure variables do not classify.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: 300,
        [ACS_VARIABLES.tenureRenter]: 100,
        [ACS_VARIABLES.tenureTotal ?? 'B25003_001E']: 500,
      }), TRACT);
      expect(out.ownerOccupiedPct, '300/400 = 75; against the total it would read 60').toBe(75);
      expect(out.renterOccupiedPct).toBe(25);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('columns are located BY NAME, never by position', () => {
    it('a re-ordered ACS response maps every field correctly', () => {
      // The detail-batch lesson, in a second place. ACS is array-of-arrays: a
      // positional read produces a full set of real-looking numbers with the
      // income in the age column, and nothing about it looks broken.
      const ordered = mapDemographicsFromAcs(REAL, TRACT);
      const [headers, values] = REAL;
      const idx = headers.map((_h, i) => i).reverse();
      const shuffled: string[][] = [idx.map((i) => headers[i]), idx.map((i) => values[i])];

      expect(shuffled[0], 'the fixture is not actually re-ordered').not.toEqual(headers);
      const out = mapDemographicsFromAcs(shuffled, TRACT);
      expect(out.medianHouseholdIncome, 'a positional read put another column in income')
        .toBe(ordered.medianHouseholdIncome);
      expect(out.medianAge).toBe(ordered.medianAge);
      expect(out.ownerOccupiedPct).toBe(ordered.ownerOccupiedPct);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('guarantee 4 — geography and vintage', () => {
    it('the tract resolves from the geocoder recording, with a checkable name', () => {
      const tract = mapTractFromGeocoder(GEOCODE);
      expect(tract, 'the recorded geocoder response did not resolve a tract').not.toBeNull();
      expect(tract!.geoid, 'the GEOID is not the recorded tract').toBe('04013111700');
      expect(String(tract!.name), 'the tract has no member-checkable name').toContain('1117');
    });

    it('a geocoder response with NO tract resolves to null, never a nearby one', () => {
      // A tract is a few thousand people. Falling back to a neighbouring tract
      // is the wrong-house bug in demographic clothing — invisible, confident,
      // and about someone's actual property.
      expect(mapTractFromGeocoder({ result: { geographies: {} } })).toBeNull();
      expect(mapTractFromGeocoder({})).toBeNull();
      expect(mapTractFromGeocoder(null)).toBeNull();
    });

    it('the mapped result carries its vintage', () => {
      const out = mapDemographicsFromAcs(REAL, TRACT);
      expect(out.acsYear, 'no ACS vintage on the figures').toBeTypeOf('number');
      expect(out.acsYear, 'the vintage is not a plausible ACS year').toBeGreaterThan(2015);
      expect(out.tractGeoid, 'no geography on the figures').toBe('04013111700');
    });
  });
  // =========================================================================
  // BUG-013 — the enumerated set has no floor under it.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('an UNLISTED negative is still not a figure', () => {
    it('a negative that is not an enumerated sentinel must not render', () => {
      // §14.10: "suppression sentinels (large negatives) AND ANYTHING
      // NON-FINITE/NEGATIVE map to null". `acsNumber` only rejects the six
      // listed values, so -5 passes through as a figure.
      //
      // The enumeration is the right PRIMARY mechanism and the operator ruled
      // so — a threshold alone silently absorbs a seventh annotation value the
      // day Census adds one, and masks genuinely bad data as if it were
      // suppression. But removing the floor entirely leaves nothing between a
      // malformed payload and the member. None of these four measures can be
      // negative: not an income, not an age, not a household count.
      for (const bad of [-5, -1, -100, -12345]) {
        const out = mapDemographicsFromAcs(body({
          [ACS_VARIABLES.medianHouseholdIncome]: bad,
          [ACS_VARIABLES.medianAge]: bad,
        }), TRACT);
        expect(out.medianHouseholdIncome, `median income rendered as ${bad}`).toBeNull();
        expect(out.medianAge, `median age rendered as ${bad}`).toBeNull();
      }
    });

    it('a negative COUNT must not produce a percentage over 100', () => {
      // The sharpest consequence, because the arithmetic launders it. A
      // negative owner count makes the denominator smaller than the renter
      // count, and the member is shown "renter-occupied 150%" — visibly
      // impossible, rendered as a measured fact, with a real tract name and a
      // real ACS vintage beside it lending it authority.
      const out = mapDemographicsFromAcs(body({
        [ACS_VARIABLES.tenureOwner]: -50,
        [ACS_VARIABLES.tenureRenter]: 150,
      }), TRACT);
      expect(out.ownerOccupiedPct, 'a negative tenure percentage reached the member').toBeNull();
      expect(out.renterOccupiedPct, 'a tenure percentage over 100% reached the member').toBeNull();
    });
  });
});
