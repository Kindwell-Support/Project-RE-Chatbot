/**
 * Golden dataset, run against the real pure pipeline.
 *
 * Every expected value here comes from `tests/fixtures/golden/`, where it was
 * computed by hand from CONTRACT.md before any implementation existed. Read the
 * header of the fixture file, not this file, to check the arithmetic.
 *
 * WHAT THIS SUITE IS NOW. It used to be the suite that decided whether the ARV
 * was right. There is no ARV (§14.8), so the question it answers has changed:
 * whether the right COMPS are chosen, at the right rung, with the right
 * rejection reasons, and each carrying its own correct $/sqft. That is now the
 * whole of what the member is handed, so it is the whole of what has to be
 * right — and unlike an ARV, every one of these values is one the member can
 * check against the public record themselves.
 *
 * The retired half is recorded in TEST_PLAN.md's ARV REMOVAL appendix and the
 * hand-derivations are kept in `tests/fixtures/golden/V2-RECOMPUTE.md`. They
 * are not deleted because they were wrong; their subject was removed.
 *
 * Layer: pure functions only — `selectTiers` -> `rankComps`, per CONTRACT §4.
 * No provider, no service, no network.
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
  golden03,
  golden06,
  golden06MeanInsteadOfMedian,
  type GoldenCase,
} from '../fixtures/golden/index.js';

import { selectTiers } from '../../src/features/comps/filter.js';
import { rankComps } from '../../src/features/comps/rank.js';
import { MIN_COMPS_TO_COMPUTE, MAX_COMPS_KEPT } from '../../src/features/comps/config.js';

const MODS = ['filter', 'rank', 'config'] as const;

/** Filter -> rank, exactly the order CONTRACT §5 specifies. */
function runPipeline(gc: GoldenCase) {
  const tier = selectTiers(gc.subject as never, gc.comps as never, gc.now);
  const ranked = rankComps(gc.subject as never, tier.kept, gc.now);
  return { tier, ranked };
}

describe(`golden dataset — comp selection correctness${sliceNote(...MODS)}`, () => {
  describe.skipIf(pendingSlice(...MODS))('filtering and tier selection', () => {
    for (const gc of GOLDEN_CASES) {
      it(`${gc.id}: keeps the right comps at the right rung`, () => {
        const { tier } = runPipeline(gc);

        // BOTH rungs, not just the radius (§14.2). A case that lands on the
        // right radius via the wrong recency window has searched a different
        // market than the fixture describes.
        expect(tier.radiusTierMi, `wrong radius rung for ${gc.id}`)
          .toBe(gc.expected.radiusTierMi);
        expect(tier.recencyTierMonths, `wrong recency rung for ${gc.id}`)
          .toBe(gc.expected.recencyTierMonths);

        // `compsKept` / `keptZpids` in the fixtures are the POST-CAP set —
        // what the member actually sees. `selectTiers` returns the pre-cap
        // survivors and `rankComps` applies MAX_COMPS_KEPT, so these are
        // asserted against `ranked`. Getting this wrong reads as an off-by-one
        // in the filters when it is really a layer confusion.
        const { ranked } = runPipeline(gc);
        expect(ranked).toHaveLength(gc.expected.compsKept!);
        expect(tier.kept.length, 'the cap removed comps that were never kept')
          .toBeGreaterThanOrEqual(ranked.length);

        if (gc.expected.keptZpids) {
          expect(ranked.map((r) => r.comp.zpid).sort()).toEqual(
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

    it('RETIRED rule 11 — no golden case produces LOT_ANOMALY any more', () => {
      // §14.1 removed the hard lot gate. Sweeping the whole dataset is the
      // cheapest place to catch it coming back on a path the unit tests miss.
      for (const gc of GOLDEN_CASES) {
        const { tier } = runPipeline(gc);
        expect(
          tier.rejected.map((r) => r.reason),
          `${gc.id} still emits LOT_ANOMALY`,
        ).not.toContain('LOT_ANOMALY');
      }
    });
  });

  describe.skipIf(pendingSlice(...MODS))('every kept comp carries its OWN correct $/sqft', () => {
    // This replaces "ARV arithmetic" as the load-bearing numeric section. The
    // per-comp $/sqft is now the only derived figure the member is shown, and
    // it is the one they will check first, because it is the one that makes
    // two differently-sized houses comparable.
    for (const gc of GOLDEN_SUCCESS_CASES) {
      it(`${gc.id}: $/sqft is price / that comp's OWN living area`, () => {
        const { ranked } = runPipeline(gc);
        expect(ranked.length, `nothing ranked for ${gc.id}`).toBeGreaterThan(0);

        for (const r of ranked) {
          const own = r.comp.soldPrice! / r.comp.livingArea!;
          expect(r.pricePerSqft, `${gc.id} / ${r.comp.zpid}`).toBeCloseTo(own, 9);
          expect(Number.isFinite(r.pricePerSqft)).toBe(true);

          // The classic wrong denominator: the SUBJECT's sqft. Only assert the
          // discriminator where the two actually differ, otherwise it is a
          // vacuous "not equal to itself" check.
          const bySubject = r.comp.soldPrice! / gc.subject.livingArea!;
          if (Math.abs(own - bySubject) > 0.5) {
            expect(
              r.pricePerSqft,
              `${gc.id} / ${r.comp.zpid}: $/sqft computed against the SUBJECT's sqft`,
            ).not.toBeCloseTo(bySubject, 3);
          }
        }
      });
    }

    it("golden-01: the three comps whose sizes differ most from the subject", () => {
      const { ranked } = runPipeline(golden01);
      const byZpid = Object.fromEntries(ranked.map((r) => [r.comp.zpid, r.pricePerSqft]));
      // Hand-checked against the fixture header.
      expect(byZpid['G1-C3']).toBeCloseTo(188, 9); // 338,400 / 1,800
      expect(byZpid['G1-C5']).toBeCloseTo(218, 9); // 348,800 / 1,600
      expect(byZpid['G1-C6']).toBeCloseTo(209, 9); // 365,750 / 1,750
      // Against the subject's 2,000 sqft these would be 169.2, 174.4 and 182.875.
      expect(byZpid['G1-C3']).not.toBeCloseTo(169.2, 3);
      expect(byZpid['G1-C5']).not.toBeCloseTo(174.4, 3);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('the cap is applied to the RANKED set', () => {
    for (const gc of GOLDEN_SUCCESS_CASES) {
      it(`${gc.id}: never more than MAX_COMPS_KEPT, best first`, () => {
        const { ranked } = runPipeline(gc);
        expect(ranked.length).toBeLessThanOrEqual(MAX_COMPS_KEPT);
        for (let i = 1; i < ranked.length; i++) {
          expect(
            ranked[i].score,
            `${gc.id}: comp ${i} scores better than comp ${i - 1} — the sort is inverted`,
          ).toBeGreaterThanOrEqual(ranked[i - 1].score);
        }
      });
    }
  });

  describe.skipIf(pendingSlice(...MODS))('cases that must NOT produce a comp set', () => {
    for (const gc of GOLDEN_FAILURE_CASES) {
      it(`${gc.id}: stops at the count gate`, () => {
        const { tier } = runPipeline(gc);

        // The gate itself. Two comps is enough data to compute an average —
        // that is exactly why this has to be refused rather than trusted.
        // Removing the ARV does not retire this: a two-row table presented as
        // "the comparable sales" is its own false confidence.
        expect(tier.kept.length).toBeLessThan(MIN_COMPS_TO_COMPUTE);
        expect(tier.kept).toHaveLength(gc.expected.detail!.kept!);
        expect(tier.radiusTierMi).toBe(gc.expected.detail!.radiusTierMi);
      });
    }

    it('golden-05: the two survivors would have averaged to a believable number', () => {
      // Not a bug hunt — a statement of the stakes, and it still stands. The
      // module no longer averages anything, but a MEMBER looking at two rows
      // will average them in their head, and $410,000 is exactly the sort of
      // answer that invites it. The refusal is load-bearing precisely because
      // the alternative looks like a real answer.
      const { tier } = runPipeline(GOLDEN_FAILURE_CASES[0]);
      const ppsf = tier.kept.map((c) => c.soldPrice! / c.livingArea!);
      const naive =
        Math.round((ppsf.reduce((a, b) => a + b, 0) / ppsf.length) * 2000 / 1000) * 1000;
      expect(naive).toBe(410000);
    });
  });

  // -------------------------------------------------------------------------
  // The counterfactuals that survive. Each proves its fixture is doing work
  // rather than passing by coincidence. The trim- and ARV-based ones retired
  // with their subject; these three are about FILTERING and RANKING, which is
  // the whole pipeline now.
  // -------------------------------------------------------------------------
  describe.skipIf(pendingSlice(...MODS))('counterfactuals — the fixtures discriminate', () => {
    it('golden-02: the outlier is KEPT and shown, not silently dropped', () => {
      // Re-pointed. This case used to prove the trim removed the $600/sqft new
      // build and moved the answer by $125,000. There is no trim, and that
      // changes what the case is FOR: the outlier now reaches the member, and
      // the honesty question is whether they can see it for what it is.
      //
      // It can, because the row carries its own $/sqft next to the others.
      // Worth stating plainly: removing the trim removed a silent correction
      // and replaced it with visible evidence. That is the better trade only
      // as long as the $/sqft column is right, which is why the section above
      // now carries the weight this one used to.
      const { tier, ranked } = runPipeline(golden02);
      const ppsf = ranked.map((r) => Math.round(r.pricePerSqft)).sort((a, b) => a - b);

      expect(tier.kept.length, 'golden 02 no longer keeps 6 before the cap').toBe(6);
      expect(ranked.length, 'the cap is not landing on 5').toBe(5);
      expect(
        ppsf[ppsf.length - 1] - ppsf[0],
        'the spread collapsed — this fixture no longer contains an outlier to test with',
      ).toBeGreaterThan(50);
    });

    it('golden-06: the family transfer is rejected on the CANDIDATE median', () => {
      // Survives intact — it was always a filter case, not an ARV case.
      const { tier } = runPipeline(golden06);

      expect(tier.rejected.find((r) => r.comp.zpid === 'G6-F')?.reason)
        .toBe('NON_ARMS_LENGTH');

      // The mean-instead-of-median variant over-rejects and would have killed a
      // legitimate comp down to TOO_FEW_COMPS. If the kept set ever matches
      // that variant's, the wrong central tendency is being used.
      expect(tier.kept.map((c) => c.zpid).sort()).not.toEqual(
        [...golden06MeanInsteadOfMedian.keptZpids].sort(),
      );
    });

    it('golden-03: a thin market still returns its three comps rather than nothing', () => {
      // The n=3 boundary. MIN_COMPS_TO_COMPUTE is 3, and the comparison is
      // `< 3` rejects — so exactly 3 must come back. An off-by-one here turns
      // every thin market into a failure, which is the market segment the
      // client's members work in most.
      const { tier, ranked } = runPipeline(golden03);
      expect(tier.kept, 'the n=3 boundary rejects instead of keeping').toHaveLength(3);
      expect(ranked).toHaveLength(3);
      expect(MIN_COMPS_TO_COMPUTE).toBe(3);
    });
  });

  describe.skipIf(pendingSlice(...MODS))('the summary table cannot rot', () => {
    it('GOLDEN_SUMMARY agrees with the cases it summarises', () => {
      // The at-a-glance table in index.ts is maintained by hand. A case edited
      // without its summary row is a fixture whose documentation lies.
      for (const row of GOLDEN_SUMMARY) {
        const gc = GOLDEN_CASES.find((c) => c.id === row.id);
        expect(gc, `GOLDEN_SUMMARY names a case that does not exist: ${row.id}`).toBeDefined();
        const kept = gc!.expected.ok ? gc!.expected.compsKept : gc!.expected.detail?.kept;
        expect(kept, `summary/kept mismatch for ${row.id}`).toBe(row.kept);
        expect(gc!.expected.radiusTierMi ?? gc!.expected.detail?.radiusTierMi,
          `summary/tier mismatch for ${row.id}`).toBe(row.tier);
      }
      expect(GOLDEN_SUMMARY.length, 'a case is missing from the summary')
        .toBe(GOLDEN_CASES.length);
    });
  });
});
