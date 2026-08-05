/**
 * ARV arithmetic — CONTRACT §5.5.
 *
 * The golden dataset (`golden.test.ts`) checks whole realistic scenarios. This
 * file goes after the individual arithmetic operations at their edges, where
 * the realistic scenarios can't reach: the trim count across every n, rounding
 * on exact halves, the sample-vs-population denominator, and the confidence
 * thresholds hit exactly rather than approached.
 *
 * Expected values are derived from §5.5 with a calculator. Where a boundary
 * needs an ugly constant to be hit exactly, the constant is written as the
 * expression that derives it rather than as a magic literal.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { pricePerSqft, trimmedMean, calculateArv } from '../../src/features/comps/arv.js';
import {
  TRIM_FRACTION,
  ARV_ROUND_TO,
  MAX_COMPS_KEPT,
  CONF_HIGH,
  CONF_MEDIUM,
} from '../../src/features/comps/config.js';
import type { ScoredComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['arv', 'config'] as const;

const SUBJECT: SubjectProperty = {
  zpid: 'S', address: '1 TEST STREET', beds: 3, baths: 2,
  livingArea: 2000, lotSize: 6000, yearBuilt: 1990, propertyType: 'SFR',
  lastSoldPrice: null, lastSoldDate: null, lat: 47.6, lng: -122.3,
};

/** Minimal ScoredComp carrying a chosen $/sqft. calculateArv reads only these. */
function scored(
  pricePerSqftValue: number,
  i: number,
  distanceMi = 0.1,
  monthsAgo = 1,
): ScoredComp {
  return {
    comp: {
      zpid: `C${String(i).padStart(2, '0')}`, address: `${i} TEST STREET`, status: 'SOLD',
      soldPrice: Math.round(pricePerSqftValue * 2000), soldDate: '2025-06-15',
      beds: 3, baths: 2, livingArea: 2000, lotSize: 6000,
      propertyType: 'SFR', lat: 47.6, lng: -122.3,
    },
    distanceMi,
    monthsAgo,
    pricePerSqft: pricePerSqftValue,
    score: 10,
    parts: { distance: 4, sqft: 3, recency: 2, bedbath: 1 },
  };
}

const scoredSet = (values: number[], distanceMi?: number, monthsAgo?: number) =>
  values.map((v, i) => scored(v, i + 1, distanceMi, monthsAgo));

describe(`ARV arithmetic${sliceNote(...MODS)}`, () => {
  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('pricePerSqft', () => {
    it.each([
      [400000, 2000, 200],
      [342000, 1800, 190],
      [468000, 2250, 208],
      [1, 2, 0.5],
    ])('%d / %d = %d', (price, area, expected) => {
      expect(pricePerSqft(price, area)).toBeCloseTo(expected, 9);
    });

    it('does not round — the trim and the mean need full precision', () => {
      // 100,000 / 3 = 33,333.333… Rounding here would compound through the
      // mean and shift the ARV by more than the $1,000 quantum on a real set.
      expect(pricePerSqft(100000, 3)).toBeCloseTo(33333.3333333333, 6);
      expect(Number.isInteger(pricePerSqft(100000, 3))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // The trim count. CONTRACT §5.5:
  //   trimCount = n >= 5 ? max(1, floor(n * TRIM_FRACTION)) : 0
  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('trimmedMean — trimCount across n', () => {
    // Values are 10, 20, 30 … so `used` and `trimmedOut` are readable by eye
    // and the mean of an arithmetic run is (first + last) / 2.
    const run = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 10);

    it.each([
      // n,  n*0.15, floor, trimCount, used length, expected mean
      [3, 0.45, 0, 0, 3, 20],
      [4, 0.6, 0, 0, 4, 25],
      [5, 0.75, 0, 1, 3, 30], // max(1,0) — the flip
      [6, 0.9, 0, 1, 4, 35], // max(1,0) still carrying it
      [7, 1.05, 1, 1, 5, 40], // floor takes over, same answer
      [8, 1.2, 1, 1, 6, 45],
      [13, 1.95, 1, 1, 11, 70],
      [14, 2.1, 2, 2, 10, 75], // the second flip: max() stops binding
      [20, 3.0, 3, 3, 14, 105],
    ])(
      'n=%d: %d -> floor %d -> trimCount %d, %d values used, mean %d',
      (n, _product, _floor, trimCount, usedLen, expectedMean) => {
        const r = trimmedMean(run(n));
        expect(r.used).toHaveLength(usedLen);
        expect(r.trimmedOut).toHaveLength(trimCount * 2);
        expect(r.mean).toBeCloseTo(expectedMean, 9);
        expect(r.used.length + r.trimmedOut.length, 'used + trimmed must partition the input').toBe(n);
      },
    );

    it('n=5 is the flip, and it is worth $4,000 on a real house', () => {
      // Restated at the unit level because it is the single highest-value
      // assertion in the suite. `n > 5` here silently returns the untrimmed
      // mean and every downstream number stays plausible.
      expect(trimmedMean([150, 190, 200, 210, 260]).mean).toBe(200);
      expect(trimmedMean([150, 190, 200, 210, 260]).mean, 'no trim at n=5').not.toBe(202);
      expect(trimmedMean([10, 20, 30, 40, 50]).trimmedOut.sort((a, b) => a - b)).toEqual([10, 50]);
    });

    it('n=4 does NOT trim — one comp short of the flip', () => {
      expect(trimmedMean([10, 20, 30, 40]).trimmedOut).toEqual([]);
      expect(trimmedMean([10, 20, 30, 40]).mean).toBe(25);
    });

    it('floor(n * TRIM_FRACTION) is not bitten by binary floating point', () => {
      // 0.15 has no exact binary representation, so n*0.15 can in principle
      // land a hair under an integer and floor() one lower than the rational
      // answer. It does not, for any n up to well past MAX_COMPS_KEPT — pinned
      // so a future change to TRIM_FRACTION cannot introduce it unnoticed.
      for (let n = 1; n <= 200; n++) {
        expect(
          Math.floor(n * TRIM_FRACTION),
          `floor(${n} * ${TRIM_FRACTION}) disagrees with exact rational arithmetic`,
        ).toBe(Math.floor((n * 15) / 100));
      }
    });

    it('only n = 3..8 is reachable through the pipeline, so trimCount is only ever 0 or 1', () => {
      // MAX_COMPS_KEPT caps the ranked set at 8 and MIN_COMPS_TO_COMPUTE floors
      // it at 3. The n=14 -> trimCount 2 branch above is real but unreachable
      // in production; it is tested because trimmedMean is exported and may be
      // reused, not because a member can hit it.
      for (let n = 3; n <= MAX_COMPS_KEPT; n++) {
        const t = trimmedMean(Array.from({ length: n }, (_, i) => i + 1)).trimmedOut.length / 2;
        expect(t, `n=${n}`).toBeLessThanOrEqual(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('trimmedMean — sorting and partitioning', () => {
    it('sorts before trimming — input order cannot change the answer', () => {
      const values = [200, 195, 190, 198, 215, 205, 208, 202];
      const shuffles = [
        values,
        [...values].reverse(),
        [215, 190, 202, 198, 205, 200, 208, 195],
        [...values].sort((a, b) => a - b),
      ];
      const means = shuffles.map((s) => trimmedMean(s).mean);
      for (const m of means) expect(m).toBeCloseTo(means[0], 12);
      // And it is the SORTED extremes that come off, not the array's ends.
      expect(trimmedMean(values).trimmedOut.sort((a, b) => a - b)).toEqual([190, 215]);
    });

    it('does not mutate the caller\'s array', () => {
      const input = [50, 10, 40, 20, 30];
      const copy = [...input];
      trimmedMean(input);
      expect(input, 'trimmedMean sorted its argument in place').toEqual(copy);
    });

    it('handles duplicates without losing count', () => {
      const r = trimmedMean([200, 200, 200, 200, 200]);
      expect(r.mean).toBe(200);
      expect(r.used).toHaveLength(3);
      expect(r.trimmedOut).toEqual([200, 200]);
    });

    it('trims duplicated extremes one at a time, not by value', () => {
      // [10, 10, 30, 50, 50]: trimCount 1 removes ONE 10 and ONE 50.
      // A "remove all values equal to min/max" implementation returns 30.
      const r = trimmedMean([10, 10, 30, 50, 50]);
      expect(r.used).toEqual([10, 30, 50]);
      expect(r.mean).toBeCloseTo(30, 9);
      expect(r.trimmedOut.sort((a, b) => a - b)).toEqual([10, 50]);
    });

    it('a single value is its own mean, untrimmed', () => {
      const r = trimmedMean([207]);
      expect(r.mean).toBe(207);
      expect(r.used).toEqual([207]);
      expect(r.trimmedOut).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // The degenerate-input edges (TEST_PLAN §8 Q2). `calculateArv` guards them
  // properly; the two smaller exported helpers do not. Both gaps are currently
  // unreachable through the service, so they are reported as BUG-002 (minor)
  // and pinned here rather than failed.
  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('degenerate inputs', () => {
    it('THE GUARD THAT MATTERS: calculateArv throws rather than returning NaN', () => {
      // This is the assertion protecting the user. Everything below it is about
      // depth of defence; this one is the defence.
      expect(() => calculateArv(SUBJECT, [])).toThrow(/zero comps/i);
      expect(() => calculateArv({ ...SUBJECT, livingArea: null }, scoredSet([190, 200, 210])))
        .toThrow(/subject sqft/i);
      expect(() => calculateArv({ ...SUBJECT, livingArea: 0 }, scoredSet([190, 200, 210])))
        .toThrow(/subject sqft/i);
    });

    it('the guards throw BEFORE producing a partial result', () => {
      // A guard that throws after computing is still a guard, but a guard that
      // throws after WRITING is not. Nothing here is stateful today; this pins
      // that a caller cannot observe a half-built ArvResult.
      let observed: unknown;
      try {
        observed = calculateArv(SUBJECT, []);
      } catch {
        observed = undefined;
      }
      expect(observed).toBeUndefined();
    });

    /**
     * KNOWN GAP — BUG-002, minor. Pinned to today's behaviour, not to what it
     * ought to be, so the suite stays green while the gap is open.
     *
     * `trimmedMean([])` returns `{ mean: NaN }` and `pricePerSqft(x, 0)`
     * returns `Infinity`. Neither is reachable through the service: the count
     * gate rejects below 3 comps, and hard-filter rules 3 and 9 drop comps with
     * a missing sqft or price before any $/sqft is taken.
     *
     * So the defence is real — but it is POSITIONAL, not structural. It holds
     * because of who calls these today. The moment `trimmedMean` is reused
     * (rental comps, a recompute-from-cached-raw path that skips the gate) the
     * NaN is one call away from a rendered "$NaN" or a coerced "$0 ARV".
     *
     * If these start failing because MASON added throws, that is the fix
     * landing — update this block, don't revert it.
     */
    it('KNOWN GAP (BUG-002): trimmedMean([]) returns NaN instead of throwing', () => {
      const r = trimmedMean([]);
      expect(Number.isNaN(r.mean)).toBe(true);
      expect(r.used).toEqual([]);
      expect(r.trimmedOut).toEqual([]);
    });

    it('KNOWN GAP (BUG-002): pricePerSqft(x, 0) returns Infinity instead of throwing', () => {
      expect(pricePerSqft(400000, 0)).toBe(Infinity);
      // Infinity is especially nasty for rule 10: `Infinity < 0.4 * median` is
      // false, so a divide-by-zero comp would never be rejected as
      // non-arms-length — it would sail through and poison the mean.
      expect(Infinity < 0.4 * 205).toBe(false);
    });

    it('pricePerSqft handles the non-degenerate edges cleanly', () => {
      expect(pricePerSqft(0, 2000)).toBe(0);
      expect(Number.isFinite(pricePerSqft(1, 1e9))).toBe(true);
      expect(pricePerSqft(1e9, 1)).toBe(1e9);
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('calculateArv — rounding', () => {
    it('rounds to the nearest $1,000, half UP', () => {
      // mean 201.25 x 2,000 = 402,500 -> 402.5 -> 403 -> $403,000.
      // Banker's rounding would give 402 (402 is even) -> $402,000.
      const r = calculateArv(SUBJECT, scoredSet([201.25, 201.25, 201.25]));
      expect(r.arvPerSqft).toBeCloseTo(201.25, 9);
      expect(r.arv).toBe(403000);
      expect(r.arv, "banker's rounding was used").not.toBe(402000);
    });

    it('rounds the band offset half UP too', () => {
      // [195.75, 200, 204.25]: mean 200, deviations ±4.25, Sd2 = 36.125,
      // sample variance 36.125/2 = 18.0625, sd = 4.25 exactly.
      // 4.25 x 2,000 = 8,500 -> 8.5 -> 9 -> $9,000 band.
      // Banker's would give 8 -> $8,000.
      const r = calculateArv(SUBJECT, scoredSet([195.75, 200, 204.25]));
      expect(r.sd).toBeCloseTo(4.25, 9);
      expect(r.arv).toBe(400000);
      expect(r.arv - r.arvLow).toBe(9000);
      expect(r.arv - r.arvLow, "banker's rounding on the band").not.toBe(8000);
    });

    it('derives the band from the ROUNDED arv, not the raw one', () => {
      // [200.7, 201.4, 202.1]: mean 201.4, sd 0.7 exactly.
      //   arvRaw = 201.4 x 2,000 = 402,800  ->  arv = $403,000
      //   offset = round(0.7 x 2,000 / 1,000) x 1,000 = round(1.4) x 1,000 = $1,000
      //   arvLow = 403,000 - 1,000 = $402,000                     <- contract
      //   round((402,800 - 1,400)/1,000) x 1,000 = $401,000       <- the bug
      const r = calculateArv(SUBJECT, scoredSet([200.7, 201.4, 202.1]));
      expect(r.sd).toBeCloseTo(0.7, 9);
      expect(r.arv).toBe(403000);
      expect(r.arvLow).toBe(402000);
      expect(r.arvLow, 'band was rounded off the raw endpoint').not.toBe(401000);
      expect(r.arvHigh).toBe(404000);
    });

    it('the band is symmetric about arv by construction', () => {
      for (const set of [
        [190, 200, 210],
        [195.75, 200, 204.25],
        [150, 190, 200, 210, 260],
        [180, 195, 200, 205, 210, 600],
      ]) {
        const r = calculateArv(SUBJECT, scoredSet(set));
        expect(r.arv - r.arvLow, `asymmetric band for ${set}`).toBe(r.arvHigh - r.arv);
      }
    });

    it('every rounded output is an exact multiple of ARV_ROUND_TO', () => {
      for (const set of [[190, 200, 210], [201.25, 201.25, 201.25], [150, 190, 200, 210, 260]]) {
        const r = calculateArv(SUBJECT, scoredSet(set));
        expect(r.arv % ARV_ROUND_TO).toBe(0);
        expect(r.arvLow % ARV_ROUND_TO).toBe(0);
        expect(r.arvHigh % ARV_ROUND_TO).toBe(0);
      }
    });

    it('a zero-spread set produces a zero-width band, not a missing one', () => {
      const r = calculateArv(SUBJECT, scoredSet([200, 200, 200]));
      expect(r.sd).toBe(0);
      expect(r.cv).toBe(0);
      expect(r.arv).toBe(400000);
      expect(r.arvLow).toBe(400000);
      expect(r.arvHigh).toBe(400000);
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('calculateArv — spread', () => {
    it('sd is the SAMPLE deviation (n-1) of the TRIMMED set', () => {
      // [190, 200, 240]: mean 210, Sd2 = 400 + 100 + 900 = 1,400
      //   sample     1,400 / 2 = 700     -> sd 26.4575131
      //   population 1,400 / 3 = 466.667 -> sd 21.6024690
      const r = calculateArv(SUBJECT, scoredSet([190, 200, 240]));
      expect(r.sd).toBeCloseTo(26.4575131106, 8);
      expect(r.sd, 'population (n) denominator was used').not.toBeCloseTo(21.602469, 5);
    });

    it('sd ignores the trimmed-out values', () => {
      // n=5, trimCount 1. The extremes 150 and 260 are removed BEFORE the
      // spread is computed. Including them gives a far wider band.
      const r = calculateArv(SUBJECT, scoredSet([150, 190, 200, 210, 260]));
      // used [190, 200, 210]: Sd2 = 200, sample variance 100, sd 10.
      expect(r.sd).toBeCloseTo(10, 9);
      // Over all five: mean 202, Sd2 = 2704+144+4+64+3364 = 6280,
      // sample variance 1570, sd 39.62 -> a $79,000 band instead of $20,000.
      expect(r.sd, 'sd was computed over the untrimmed set').not.toBeCloseTo(39.6232, 3);
      expect(r.arvHigh - r.arvLow).toBe(40000);
    });

    it('cv is sd / arvPerSqft, not sd / arv', () => {
      const r = calculateArv(SUBJECT, scoredSet([190, 200, 240]));
      expect(r.cv).toBeCloseTo(26.4575131106 / 210, 9);
      // sd / arv would be ~6.3e-5 — a number that clears every cv threshold
      // and would make every result look 'high' confidence.
      expect(r.cv).toBeGreaterThan(0.1);
    });

    it('sd is 0, not NaN, when fewer than two values survive the trim', () => {
      // Unreachable through the service, but the guard has to exist: with a
      // single value the n-1 denominator is zero.
      const r = calculateArv(SUBJECT, scoredSet([207]));
      expect(r.sd).toBe(0);
      expect(Number.isNaN(r.cv), 'cv is NaN — 0/x must be 0').toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('calculateArv — confidence boundaries', () => {
    // `high` needs compsUsed >= 6 AND cv <= 0.15 AND median distance <= 0.75
    // AND median age <= 6. Each clause is pushed to its exact edge in turn,
    // with the other three held comfortably inside.

    /**
     * Six comps trimmed to four symmetric values [m-a, m-a, m+a, m+a].
     * Sample sd = 2a/sqrt(3), so to land cv exactly on a target:
     *   cv = sd/m = 2a / (m*sqrt(3))  =>  a = cv * m * sqrt(3) / 2
     * Written as the derivation rather than a magic decimal.
     */
    function sixWithCv(targetCv: number, m = 200, distanceMi = 0.1, monthsAgo = 1) {
      const a = (targetCv * m * Math.sqrt(3)) / 2;
      // Outer two get trimmed; the inner four carry the spread.
      return scoredSet([m - 100, m - a, m - a, m + a, m + a, m + 100], distanceMi, monthsAgo);
    }

    it('cv exactly at CONF_HIGH.maxCv (0.15) is still high — the comparison is <=', () => {
      const r = calculateArv(SUBJECT, sixWithCv(CONF_HIGH.maxCv));
      expect(r.cv).toBeCloseTo(0.15, 12);
      expect(r.compsUsed).toBe(6);
      expect(r.confidence).toBe('high');
    });

    it('cv a hair above 0.15 drops to medium', () => {
      const r = calculateArv(SUBJECT, sixWithCv(CONF_HIGH.maxCv * (1 + 1e-9)));
      expect(r.cv).toBeGreaterThan(0.15);
      expect(r.confidence).toBe('medium');
    });

    it('cv exactly at CONF_MEDIUM.maxCv (0.25) is still medium', () => {
      const r = calculateArv(SUBJECT, sixWithCv(CONF_MEDIUM.maxCv));
      expect(r.cv).toBeCloseTo(0.25, 12);
      expect(r.confidence).toBe('medium');
    });

    it('cv a hair above 0.25 drops to low', () => {
      const r = calculateArv(SUBJECT, sixWithCv(CONF_MEDIUM.maxCv * (1 + 1e-9)));
      expect(r.cv).toBeGreaterThan(0.25);
      expect(r.confidence).toBe('low');
    });

    it('median distance exactly 0.75 mi is still high; a hair beyond is not', () => {
      const at = calculateArv(SUBJECT, sixWithCv(0.02, 200, CONF_HIGH.maxMedianDistanceMi, 1));
      expect(at.confidence).toBe('high');
      const beyond = calculateArv(
        SUBJECT,
        sixWithCv(0.02, 200, CONF_HIGH.maxMedianDistanceMi + 1e-9, 1),
      );
      expect(beyond.confidence).toBe('medium');
    });

    it('median age exactly 6 months is still high; a hair beyond is not', () => {
      const at = calculateArv(SUBJECT, sixWithCv(0.02, 200, 0.1, CONF_HIGH.maxMedianAgeMonths));
      expect(at.confidence).toBe('high');
      const beyond = calculateArv(
        SUBJECT,
        sixWithCv(0.02, 200, 0.1, CONF_HIGH.maxMedianAgeMonths + 1e-9),
      );
      expect(beyond.confidence).toBe('medium');
    });

    it('compsUsed is the kept count and 6 is the exact bar (MASON ruling, mailbox 0003)', () => {
      const six = calculateArv(SUBJECT, scoredSet([190, 198, 200, 202, 205, 212]));
      expect(six.compsUsed).toBe(6); // 6 kept, 4 averaged after the trim
      expect(six.confidence).toBe('high');

      const five = calculateArv(SUBJECT, scoredSet([190, 198, 200, 202, 205]));
      expect(five.compsUsed).toBe(5);
      expect(five.confidence, 'five comps must not reach high').toBe('medium');
    });

    it('compsUsed 4 is the medium bar; 3 is low regardless of how tight the spread is', () => {
      const four = calculateArv(SUBJECT, scoredSet([199, 200, 200, 201]));
      expect(four.compsUsed).toBe(4);
      expect(four.confidence).toBe('medium');

      // Three identical comps: cv is 0, distance and age are perfect. Still
      // low, because three sales is not a market read.
      const three = calculateArv(SUBJECT, scoredSet([200, 200, 200]));
      expect(three.compsUsed).toBe(3);
      expect(three.cv).toBe(0);
      expect(three.confidence).toBe('low');
    });

    it('every high-confidence clause can veto on its own', () => {
      const clauses: Array<[string, ScoredComp[]]> = [
        ['cv', sixWithCv(0.2, 200, 0.1, 1)],
        ['median distance', sixWithCv(0.02, 200, 5, 1)],
        ['median age', sixWithCv(0.02, 200, 0.1, 11)],
      ];
      for (const [name, set] of clauses) {
        expect(calculateArv(SUBJECT, set).confidence, `${name} failed to veto high`).not.toBe(
          'high',
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('calculateArv — trimmedOut reporting', () => {
    it('reports which comp came off which end, by zpid', () => {
      // The rendered chat block shows this so a human can see what was
      // discounted and why. Reporting the wrong zpid makes the table lie even
      // though the ARV is right.
      const set = scoredSet([150, 190, 200, 210, 260]);
      const r = calculateArv(SUBJECT, set);
      expect(r.trimmedOut).toHaveLength(2);

      const low = r.trimmedOut.find((t) => t.end === 'low')!;
      const high = r.trimmedOut.find((t) => t.end === 'high')!;
      expect(low.pricePerSqft).toBe(150);
      expect(high.pricePerSqft).toBe(260);
      // zpids were assigned in input order: 150 -> C01, 260 -> C05.
      expect(low.zpid).toBe('C01');
      expect(high.zpid).toBe('C05');
    });

    it('is empty when nothing is trimmed', () => {
      expect(calculateArv(SUBJECT, scoredSet([190, 200, 210])).trimmedOut).toEqual([]);
    });

    it('stays deterministic when the extremes are duplicated', () => {
      // Two comps tie at the low end. Whichever is reported, it must be the
      // same one on every run — the rendered block has to be reproducible.
      const set = scoredSet([150, 150, 200, 210, 260]);
      const a = calculateArv(SUBJECT, set).trimmedOut;
      const b = calculateArv(SUBJECT, set).trimmedOut;
      expect(a).toEqual(b);
      expect(a.find((t) => t.end === 'low')!.pricePerSqft).toBe(150);
    });
  });

  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('no degenerate value ever escapes', () => {
    const SETS = [
      [200, 200, 200], [190, 200, 240], [150, 190, 200, 210, 260],
      [180, 195, 200, 205, 210, 600], [0.01, 0.02, 0.03],
      [1e6, 1e6, 1e6], [199.999999, 200, 200.000001],
    ];

    it.each(SETS)('%j produces only finite numbers', (...values) => {
      const r = calculateArv(SUBJECT, scoredSet(values as number[]));
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'number') {
          expect(Number.isNaN(v), `${k} is NaN`).toBe(false);
          expect(Number.isFinite(v), `${k} is ${v}`).toBe(true);
        }
      }
      expect(r.arv).toBeGreaterThanOrEqual(0);
      expect(r.arvLow).toBeLessThanOrEqual(r.arv);
      expect(r.arvHigh).toBeGreaterThanOrEqual(r.arv);
    });
  });
});
