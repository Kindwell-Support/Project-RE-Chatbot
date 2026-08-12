/**
 * BUG-018 and its class — numbers that reach a member with decimals they
 * should not have.
 *
 * THE BUG. Two shapes in the pool, and they arrive by different routes:
 *   - acreage conversion:  2.2314 acres x 43,560 = 97,199.784
 *   - float artifact on a sqft-NATIVE value: 15682.000000000002
 * The second is the one that matters for the sweep at the bottom, because it
 * proves the payload itself carries artifacts. It is not something our
 * conversion introduced and it is therefore not confined to the fields we
 * convert.
 *
 * TWO ROUNDING SITES, deliberately. The mapper fixes new fetches; the render
 * fixes the cached rows already carrying fractional lots, which live until the
 * 14-day TTL turns them over. Only the render-side one protects a member
 * today, so it is tested against a cached row rather than a fresh fetch.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import { scoreComp, rankComps } from '../../src/features/comps/rank.js';
import { computeNeighborhoodAggregates } from '../../src/features/comps/aggregates.js';
import { selectTiers } from '../../src/features/comps/filter.js';
import { ALGO_VERSION } from '../../src/features/comps/config.js';
import { golden01, type GoldenCase } from '../fixtures/golden/index.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

/** Same shape as format.test.ts: a real CompsResult through the real pipeline. */
function resultFor(gc: GoldenCase) {
  const tier = selectTiers(gc.subject as never, gc.comps as never, gc.now);
  return {
    ok: true as const,
    algoVersion: ALGO_VERSION,
    runId: 'run-fixed-for-determinism',
    subject: gc.subject,
    radiusTierMi: tier.radiusTierMi,
    recencyTierMonths: tier.recencyTierMonths,
    comps: rankComps(gc.subject as never, tier.kept, gc.now),
    rejected: tier.rejected,
    fromCache: false,
    provider: 'stub',
  };
}

const MODS = ['format', 'providers/apifyZillow'] as const;

/** 43,560 sqft to the acre — the definition, not the constant under test. */
const SQFT_PER_ACRE = 43_560;

describe(`BUG-018 — computed numerics render whole${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the two shapes in the pool', () => {
    it('the acreage conversion lands on a whole sqft', () => {
      // Hand-computed from the definition, NOT read back from the mapper:
      // 2.2314 x 43,560 = 97,199.784, which rounds to 97,200.
      const exact = 2.2314 * SQFT_PER_ACRE;
      expect(exact, 'the arithmetic this case is built on has moved')
        .toBeCloseTo(97_199.784, 3);
      expect(Math.round(exact), 'the expected whole value is not 97,200').toBe(97_200);
    });

    it('a sqft-native float artifact rounds to the value it is pretending not to be', () => {
      // 15682.000000000002 is not a measurement. It is 15,682 that went
      // through a float somewhere upstream, and it renders as
      // "15,682.000000000002 sqft lot" — which reads as false precision about
      // a parcel, on a screen whose whole job is looking authoritative.
      expect(Math.round(15_682.000_000_000_002)).toBe(15_682);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the RENDER-side guard, which is the one protecting members today', () => {
    /** golden01 with a fractional lot on the first comp — i.e. a cached row. */
    const withLot = (lotSize: number | null) => {
      const base = resultFor(golden01) as { comps: Array<{ comp: RawComp }> };
      return String(
        renderCompsForChat({
          ...base,
          comps: base.comps.map((c, i) =>
            i === 0 ? { ...c, comp: { ...c.comp, lotSize } } : c,
          ),
        } as never),
      );
    };

    /** The one rendered line for the comp we altered, so a sibling cannot satisfy this. */
    const lotLine = (text: string) =>
      text.split('\n').find((l) => l.includes('sqft lot')) ?? '';

    it('a CACHED row carrying a fractional lot still renders whole', () => {
      // The case the mapper fix cannot reach: this row is already in Supabase
      // with 97,199.784 on it and will be for up to 14 days.
      const line = lotLine(withLot(97_199.784));
      expect(line, 'no lot line rendered at all').not.toBe('');
      expect(
        line,
        'a cached fractional lot reached the member. The mapper fix only ' +
          'covers new fetches; every row already in the cache renders through ' +
          'this path until the TTL turns it over.',
      ).toContain('97,200 sqft lot');
      expect(line, 'the fraction survived into the rendered line').not.toMatch(/\.\d/);
    });

    it('the float-artifact shape renders whole too', () => {
      const line = lotLine(withLot(15_682.000_000_000_002));
      expect(line, 'the artifact reached the member').toContain('15,682 sqft lot');
      expect(line, 'a decimal tail survived').not.toMatch(/\.\d/);
    });

    it('a NULL lot still renders the em-dash marker, never 0', () => {
      // The rounding must not have introduced a `?? 0` on the way. §14.5: the
      // em dash means "we do not know", and 0 is a claim — a parcel with no
      // land, which is a different and confident falsehood.
      const line = lotLine(withLot(null));
      expect(line, 'no lot line rendered').not.toBe('');
      expect(line, 'an unknown lot rendered as a number').toContain('— sqft lot');
      expect(line, 'a null lot became 0 sqft').not.toMatch(/\b0 sqft lot/);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))(
    'THE CLASS SWEEP — every other number that could carry a tail',
    () => {
      // The operator's instruction, and the reason it is worth doing: a
      // three-decimal artifact is glaring on a lot size and invisible on a
      // distance. Each computed numeric is checked at its RENDER, because
      // that is where a member meets it.
      const text = () => String(renderCompsForChat(resultFor(golden01) as never));

      it('$/sqft renders whole — it is a ratio, so it almost never divides evenly', () => {
        // THE FIXTURE CANNOT TEST THIS, which took two attempts to notice.
        // golden01 is built from round numbers — every comp divides exactly —
        // so a "no decimals in the output" assertion over it passes whether
        // the formatter rounds or not. The precondition failed and said so
        // rather than letting the case run vacuously.
        //
        // So the ratio is injected: $406,001 over 1,777 sqft = 228.4749...,
        // which has no clean decimal expansion and cannot round away by luck.
        const base = resultFor(golden01) as { comps: Array<{ comp: RawComp }> };
        const awkward = {
          ...base,
          comps: base.comps.map((c, i) =>
            i === 0
              ? { ...c, comp: { ...c.comp, soldPrice: 406_001, livingArea: 1_777 } }
              : c,
          ),
        };
        const scored = scoreComp(
          golden01.subject as SubjectProperty,
          awkward.comps[0].comp,
          new Date(golden01.now),
        );
        expect(
          scored.pricePerSqft === null || Number.isInteger(scored.pricePerSqft),
          'the injected ratio divides evenly after all — pick another',
        ).toBe(false);

        const rows = String(renderCompsForChat(awkward as never))
          .split('\n')
          .filter((l) => /\$[\d,]+\/sqft/.test(l));
        expect(rows.length, 'no $/sqft rendered — nothing swept').toBeGreaterThanOrEqual(3);
        for (const r of rows) {
          expect(r, `a $/sqft carries decimals: ${r}`).not.toMatch(/\$[\d,]+\.\d+\/sqft/);
        }
      });

      it('distance renders at a fixed 2dp — never a raw haversine tail', () => {
        const t = text();
        const rows = t.split('\n').filter((l) => /mi away/.test(l));
        expect(rows.length, 'no distance rendered — nothing swept').toBeGreaterThanOrEqual(3);
        for (const r of rows) {
          expect(r, `a distance is not at 2dp: ${r}`).toMatch(/\d+\.\d{2} mi away/);
          expect(r, `a distance carries a longer tail: ${r}`).not.toMatch(/\d\.\d{3,} mi/);
        }
      });

      it('the aggregate averages are means of ratios and still render whole', () => {
        const sales: RawComp[] = [1, 2, 3].map((i) => ({
          zpid: `A${i}`, address: `${i} Ave`, status: 'SOLD',
          soldPrice: 400_000 + i, soldDate: '2026-06-0' + i,
          beds: 3, baths: 2, livingArea: 1_777 + i, lotSize: 6_000,
          propertyType: 'SFR', lat: 33.4, lng: -111.9,
        }));
        const agg = computeNeighborhoodAggregates(
          sales, { lat: 33.4, lng: -111.9 } as never, [], new Date('2026-06-15'),
        );
        for (const [k, v] of Object.entries(agg ?? {})) {
          if (typeof v !== 'number') continue;
          if (k === 'avgBeds' || k === 'avgBaths') {
            // Deliberately 1dp: "3.2 bd" is a real average and rounding it to
            // 3 would destroy the only signal the figure carries.
            expect(
              Math.round(v * 10) / 10,
              `${k} carries more than one decimal`,
            ).toBe(v);
            continue;
          }
          expect(Number.isInteger(v), `${k} renders a fractional ${v}`).toBe(true);
        }
      });

      it('SWEEP RESULT: livingArea is protected, but INCIDENTALLY — worth knowing', () => {
        // I filed this as BUG-020 and it is refuted. Recording the refutation
        // rather than deleting it, because the reason is load-bearing and the
        // next person to sweep will have the same suspicion.
        //
        // The suspicion was reasonable: livingArea is sqft-native, arrives by
        // the same two mapper routes as the lot, and is rounded at NEITHER —
        // not at apifyZillow.ts:169/214, not at format.ts:173/280.
        //
        // It is safe anyway, because num() renders through toLocaleString,
        // whose default maximumFractionDigits is 3. That absorbs the
        // 15682.000000000002 artifact shape completely. The LOT needed a real
        // fix because its other shape — acreage conversion — lands at exactly
        // three decimals (97,199.784) and slips under that default intact.
        // livingArea has no conversion path, so it cannot produce one.
        //
        // The protection is therefore a side effect of a formatter default,
        // not a guard. If num() ever gains explicit fraction digits, or a
        // sqft value acquires a conversion, this becomes real with no test
        // between it and a member. That is what this case is for.
        const base = resultFor(golden01) as { comps: Array<{ comp: RawComp }> };
        const render = (livingArea: number) =>
          String(renderCompsForChat({
            ...base,
            comps: base.comps.map((c, i) =>
              i === 0 ? { ...c, comp: { ...c.comp, livingArea } } : c,
            ),
          } as never)).split('\n').find((l) => l.includes('sqft ·')) ?? '';

        expect(render(1_777.000_000_000_002), 'the float artifact reached the member')
          .toContain('1,777 sqft');
        // The shape that WOULD get through, asserted so the limit is explicit
        // rather than implied: three decimals survive toLocaleString.
        expect(
          render(1_777.784),
          'toLocaleString stopped passing 3 decimals through — if that is a ' +
            'deliberate change then livingArea is now guarded by design and ' +
            'this case should say so; if it is accidental, the lot fix may be ' +
            'redundant at the render',
        ).toContain('1,777.784 sqft');
      });
    },
  );
});
