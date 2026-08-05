/**
 * Golden dataset, run against the real pure pipeline.
 *
 * Every expected value here comes from `tests/fixtures/golden/`, where it was
 * computed by hand from CONTRACT.md §5 before any implementation existed. Read
 * the header of the fixture file, not this file, to check the arithmetic.
 *
 * This is the suite that decides whether the ARV is right. Everything else in
 * the comps test plan is about honesty, cost, and plumbing; this one is about
 * whether the number a member gets handed is the number the contract says they
 * should get.
 *
 * Layer: pure functions only — `selectRadiusTier` -> `rankComps` ->
 * `calculateArv`, per CONTRACT §4. No provider, no service, no network.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import {
  GOLDEN_SUCCESS_CASES,
  GOLDEN_FAILURE_CASES,
  GOLDEN_CASES,
  GOLDEN_SUMMARY,
  golden01,
  golden02,
  golden02UntrimmedArv,
  golden03,
  golden04,
  golden04ConfidenceByReading,
  golden06,
  golden06MeanInsteadOfMedian,
  type GoldenCase,
} from '../fixtures/golden/index.js';

import { selectRadiusTier } from '../../src/features/comps/filter.js';
import { rankComps } from '../../src/features/comps/rank.js';
import { calculateArv } from '../../src/features/comps/arv.js';
import { MIN_COMPS_TO_COMPUTE } from '../../src/features/comps/config.js';

const MODS = ['filter', 'rank', 'arv', 'config'] as const;

/** Filter -> rank -> ARV, exactly the order CONTRACT §5 specifies. */
function runPipeline(gc: GoldenCase) {
  const tier = selectRadiusTier(gc.subject, gc.comps as never, gc.now);
  const ranked = rankComps(gc.subject as never, tier.kept, gc.now);
  return { tier, ranked };
}

describe(`golden dataset — ARV correctness${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('filtering and tier selection', () => {
    for (const gc of GOLDEN_CASES) {
      it(`${gc.id}: keeps the right comps at the right radius tier`, () => {
        const { tier } = runPipeline(gc);

        // The tier is not cosmetic. Golden 03/05/06 keep fewer than
        // MIN_COMPS_FOR_TIER at every radius, so the search runs out of tiers
        // and must report 2.0 — the last one it TRIED, not the one the comps
        // happened to come from. Golden 04 sits on exactly 5 and must stop at
        // 0.5 rather than quietly widening the search to a mile.
        expect(tier.radiusTierMi, `wrong radius tier for ${gc.id}`).toBe(
          gc.expected.radiusTierMi,
        );

        expect(tier.kept).toHaveLength(gc.expected.compsKept!);

        if (gc.expected.keptZpids) {
          expect(tier.kept.map((c) => c.zpid).sort()).toEqual(
            [...gc.expected.keptZpids].sort(),
          );
        }

        if (gc.expected.rejected) {
          // Rejections carry a machine-readable reason and it must be the FIRST
          // matching rule in CONTRACT §5.3's order, not merely a true one.
          const got = tier.rejected
            .map((r) => `${r.comp.zpid}:${r.reason}`)
            .sort();
          const want = gc.expected.rejected
            .map((r) => `${r.zpid}:${r.reason}`)
            .sort();
          expect(got).toEqual(want);
        }
      });
    }
  });

  describe.skipIf(pendingSlice(...MODS))('ARV arithmetic', () => {
    for (const gc of GOLDEN_SUCCESS_CASES) {
      it(`${gc.id}: ${gc.title}`, () => {
        const { ranked } = runPipeline(gc);
        const e = gc.expected;
        const eps = e.epsilon ?? 1e-6;
        const arv = calculateArv(gc.subject as never, ranked);

        // --- the headline number -------------------------------------------
        expect(arv.arv, `ARV for ${gc.id}`).toBe(e.arv);

        // ...and it must not be any of the numbers a plausible bug produces.
        // Asserting equality alone would pass a case where the right and wrong
        // answers coincide; these make the discrimination explicit.
        for (const w of gc.wrongAnswers) {
          expect(arv.arv, `landed on the wrong answer for "${w.bug}"`).not.toBe(w.arv);
        }

        // --- the band ------------------------------------------------------
        // arvLow/High are derived from the ALREADY-ROUNDED arv (§5.5), not
        // re-rounded from the raw endpoint. Golden 01 discriminates: correct
        // 394,000 vs 393,000 for the re-rounded version.
        expect(arv.arvLow, `arvLow for ${gc.id}`).toBe(e.arvLow);
        expect(arv.arvHigh, `arvHigh for ${gc.id}`).toBe(e.arvHigh);
        expect(arv.arvHigh - arv.arv, 'band is not symmetric about arv').toBe(
          arv.arv - arv.arvLow,
        );

        // --- the intermediate values ---------------------------------------
        expect(arv.arvPerSqft).toBeCloseTo(e.arvPerSqft!, 6);

        // sd is SAMPLE (n-1). Rounding hides this in the band on some cases
        // (golden 01: sample and population both round to a $9,000 band), so
        // assert it directly rather than trusting the band to expose it.
        expect(Math.abs(arv.sd - e.sd!), `sd for ${gc.id}: got ${arv.sd}, want ${e.sd}`)
          .toBeLessThanOrEqual(eps);
        expect(Math.abs(arv.cv - e.cv!), `cv for ${gc.id}: got ${arv.cv}, want ${e.cv}`)
          .toBeLessThanOrEqual(eps);

        // --- the trim ------------------------------------------------------
        expect(
          arv.trimmedOut,
          `trimCount for ${gc.id} should be ${e.trimCount} per end`,
        ).toHaveLength(e.trimCount! * 2);

        const trimmed = arv.trimmedOut
          .map((t) => ({ pricePerSqft: t.pricePerSqft, end: t.end }))
          .sort((a, b) => a.pricePerSqft - b.pricePerSqft);
        expect(trimmed).toEqual(
          [...e.trimmedOutPpsf!].sort((a, b) => a.pricePerSqft - b.pricePerSqft),
        );

        // --- confidence ----------------------------------------------------
        expect(arv.confidence, `confidence for ${gc.id}`).toBe(e.confidence);

        // --- nothing degenerate ever escapes -------------------------------
        for (const [k, v] of Object.entries(arv)) {
          if (typeof v === 'number') {
            expect(Number.isFinite(v), `${gc.id}.${k} is ${v}`).toBe(true);
          }
        }
      });
    }
  });

  describe.skipIf(pendingSlice(...MODS))('cases that must NOT produce a number', () => {
    for (const gc of GOLDEN_FAILURE_CASES) {
      it(`${gc.id}: stops at the count gate`, () => {
        const { tier } = runPipeline(gc);

        // The gate itself. Two comps is enough data to compute an average —
        // that is exactly why this has to be refused rather than trusted.
        expect(tier.kept.length).toBeLessThan(MIN_COMPS_TO_COMPUTE);
        expect(tier.kept).toHaveLength(gc.expected.detail!.kept!);
        expect(tier.radiusTierMi).toBe(gc.expected.detail!.radiusTierMi);
      });
    }

    it('golden-05: the two survivors would have averaged to a believable $410,000', () => {
      // Not a bug hunt — a statement of the stakes. The refusal is load-bearing
      // precisely because the alternative looks like a real answer.
      const { tier } = runPipeline(GOLDEN_FAILURE_CASES[0]);
      const ppsf = tier.kept.map((c) => c.soldPrice! / c.livingArea!);
      const naive =
        Math.round((ppsf.reduce((a, b) => a + b, 0) / ppsf.length) * 2000 / 1000) * 1000;
      expect(naive).toBe(410000);
    });
  });

  // -------------------------------------------------------------------------
  // The counterfactuals. Each proves its fixture is doing work rather than
  // passing by coincidence.
  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('counterfactuals — the fixtures discriminate', () => {
    it('golden-02: the trim moves the answer by $125,000 on this data', () => {
      const { ranked } = runPipeline(golden02);
      const arv = calculateArv(golden02.subject as never, ranked);

      const all = ranked.map((r) => r.pricePerSqft);
      const untrimmedArv =
        Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 2000 / 1000) * 1000;

      expect(untrimmedArv, 'untrimmed control').toBe(golden02UntrimmedArv); // 530,000
      expect(arv.arv).toBe(405000);
      expect(untrimmedArv - arv.arv).toBe(125000);

      // And the trim removed the right one — the $600/sqft new build, off the
      // high end. A trim that dropped some other comp would still "trim".
      expect(arv.trimmedOut.map((t) => t.pricePerSqft).sort((a, b) => a - b)).toEqual([180, 600]);
      expect(arv.trimmedOut.find((t) => t.pricePerSqft === 600)!.end).toBe('high');
    });

    it('golden-04: n=5 trims — the `>= 5` vs `> 5` fork is $4,000 wide', () => {
      const { ranked } = runPipeline(golden04);
      const arv = calculateArv(golden04.subject as never, ranked);

      expect(ranked).toHaveLength(5);
      expect(arv.trimmedOut, 'trimCount is 0 at n=5 — `n > 5` was written').toHaveLength(2);
      expect(arv.arv).toBe(400000);
      expect(arv.arv, 'no-trim-at-5 answer').not.toBe(404000);
    });

    it('golden-06: the family transfer is rejected on the candidate median, not the post-filter one', () => {
      const { tier, ranked } = runPipeline(golden06);
      const arv = calculateArv(golden06.subject as never, ranked);

      expect(tier.rejected.find((r) => r.comp.zpid === 'G6-F')?.reason).toBe('NON_ARMS_LENGTH');
      expect(arv.arv).toBe(400000);
      // The $60,000 haircut the post-filter median would have allowed.
      expect(arv.arv, 'post-filter median let the $80/sqft transfer through').not.toBe(340000);
      // And the mean-instead-of-median variant, which over-rejects and would
      // have killed a legitimate comp down to TOO_FEW_COMPS.
      expect(tier.kept.map((c) => c.zpid).sort()).not.toEqual(
        [...golden06MeanInsteadOfMedian.keptZpids].sort(),
      );
    });

    it('golden-01: $/sqft uses each comp\'s own living area', () => {
      const { ranked } = runPipeline(golden01);
      // Directly, rather than only through the ARV: the per-comp $/sqft that
      // gets rendered into the chat table has to be right on its own, because
      // that table is what makes the estimate defensible to a human.
      const byZpid = Object.fromEntries(ranked.map((r) => [r.comp.zpid, r.pricePerSqft]));
      expect(byZpid['G1-C3']).toBeCloseTo(190, 9); // 342,000 / 1,800
      expect(byZpid['G1-C5']).toBeCloseTo(215, 9); // 344,000 / 1,600
      expect(byZpid['G1-C7']).toBeCloseTo(208, 9); // 468,000 / 2,250
      // Against the subject's 2,000 sqft these would be 171, 172 and 234.
      expect(byZpid['G1-C3']).not.toBeCloseTo(171, 3);
    });

    it('golden-03: sample sd (n-1), not population', () => {
      const { ranked } = runPipeline(golden03);
      const arv = calculateArv(golden03.subject as never, ranked);
      // used [190, 200, 240]: Σd² = 1,400.
      //   sample     1400/2 = 700       -> sd 26.4575131 -> band 53,000
      //   population 1400/3 = 466.667   -> sd 21.6024690 -> band 43,000
      // Unlike golden 01, the $10,000 gap survives the rounding here.
      expect(arv.sd).toBeCloseTo(26.4575131, 6);
      expect(arv.arvLow).toBe(367000);
      expect(arv.arvLow, 'population sd was used').not.toBe(377000);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('`compsUsed` is the kept count (MASON ruling, mailbox 0003)', () => {
    it('golden-04: 5 kept / 3 averaged reports 5 and lands on medium', () => {
      const { ranked } = runPipeline(golden04);
      const arv = calculateArv(golden04.subject as never, ranked);

      expect(arv.compsUsed, 'compsUsed should be the kept count, not post-trim').toBe(5);
      expect(arv.confidence).toBe(golden04ConfidenceByReading['compsUsed-is-kept-count']);
      // The reading that was rejected. Recorded because a later refactor that
      // switched to counting post-trim values would show no other symptom.
      expect(arv.confidence).not.toBe(
        golden04ConfidenceByReading['compsUsed-is-post-trim-count'],
      );
    });

    it('golden-02: 6 kept / 4 averaged reports 6 — the surprising half of the ruling', () => {
      const { ranked } = runPipeline(golden02);
      const arv = calculateArv(golden02.subject as never, ranked);
      expect(arv.compsUsed).toBe(6);
      // `high` still needs cv/distance/age; here median age 8.05 months blocks
      // it, so this stays medium for a reason unrelated to the count.
      expect(arv.confidence).toBe('medium');
    });
  });

  // -------------------------------------------------------------------------
  // Keep the fixture summary honest.
  // -------------------------------------------------------------------------
  describe('golden dataset self-check', () => {
    it('GOLDEN_SUMMARY matches the case files it summarises', () => {
      expect(GOLDEN_SUMMARY.map((s) => s.id)).toEqual(GOLDEN_CASES.map((c) => c.id));
      for (const s of GOLDEN_SUMMARY) {
        const gc = GOLDEN_CASES.find((c) => c.id === s.id)!;
        expect(gc.expected.compsKept, `${s.id} kept`).toBe(s.kept);
        expect(gc.expected.radiusTierMi, `${s.id} tier`).toBe(s.tier);
        if (s.arv !== null) expect(gc.expected.arv, `${s.id} arv`).toBe(s.arv);
        if (s.trimCount !== null) expect(gc.expected.trimCount, `${s.id} trimCount`).toBe(s.trimCount);
      }
    });

    it('every success case names at least one wrong answer, and none of them is the right one', () => {
      // A `wrongAnswers` entry equal to the correct ARV would make the
      // discrimination assertions above vacuous — and worse, would advertise
      // coverage the case does not have.
      for (const gc of GOLDEN_SUCCESS_CASES) {
        expect(gc.wrongAnswers.length, `${gc.id} claims no discriminated bug`).toBeGreaterThan(0);
        for (const w of gc.wrongAnswers) {
          expect(w.arv, `${gc.id}: "${w.bug}" produces the CORRECT answer`).not.toBe(gc.expected.arv);
        }
      }
    });

    it('the clock is injected everywhere — no fixture depends on the real date', () => {
      for (const gc of GOLDEN_CASES) {
        expect(gc.now.toISOString()).toBe('2025-07-15T00:00:00.000Z');
      }
    });
  });
});
