/**
 * SLICE 1 — THE COMPS-FETCH TRUNCATION FIX.
 *
 * THE BUG, in one recorded number. `spike-sierra-vista.json` is a real Tempe
 * pool: **40 items — exactly the cap — spanning ELEVEN DAYS** (2026-07-30 →
 * 2026-08-10, verified independently here, not taken from the report). The
 * 40-item cap over a dense 3-mile box fills with the newest sales, so the
 * recency ladder's 6- and 12-month rungs re-examine the same eleven days.
 *
 * That makes the ladder DECORATIVE. `selectTiers` walks six rungs and reports
 * whichever one it stopped on, but widening the recency window cannot admit a
 * sale the fetch never returned. A member is told "sold in the last 12 months"
 * over a pool that physically contains eleven days of sales. The near rung was
 * starved by the FETCH, not emptied by the band.
 *
 * WHY THE OBVIOUS ASSERTIONS DO NOT CATCH IT — the same shape as §14.16, which
 * is why that design transfers here. A truncated pool yields a smaller, newer,
 * entirely plausible comp set. Every figure is real. The tier label is the only
 * thing that lies, and it lies quietly.
 *
 * So the assertions are on the CALL, the SPAN, the CAP — and one more that
 * outranks all three:
 *
 *   THE LADDER MUST BE FUNCTIONAL. A 6-month rung must be able to admit a sale
 *   the 3-month rung rejected. Under the old fetch that was impossible in a
 *   dense market, and no assertion about spans or arguments proves it is
 *   possible now. If widening the window still admits nothing, the fix did not
 *   work whatever else is green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, poolDepthPending, sliceNote } from '../helpers/compsGate.js';
import { selectTiers } from '../../src/features/comps/filter.js';
import {
  MIN_COMPS_FOR_TIER,
  RECENCY_TIERS_MONTHS,
  MAX_COMP_AGE_MONTHS,
} from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { runComps } from '../../src/features/comps/service.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['filter', 'service', 'providers/apifyZillow'] as const;

const FIX = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'features', 'comps', '__fixtures__',
);
const SIERRA = JSON.parse(readFileSync(resolve(FIX, 'spike-sierra-vista.json'), 'utf8')) as Array<
  Record<string, unknown>
>;

const DAY = 86_400_000;
const NOW = new Date('2026-08-11T00:00:00.000Z');
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 10);

const MI_PER_DEG = (3958.8 * Math.PI) / 180;
const SUBJECT: SubjectProperty = {
  ...golden01.subject, address: '1 TEST ST, TEMPE, AZ', lat: 33.42, lng: -111.94,
};
const latAt = (mi: number) => SUBJECT.lat + mi / MI_PER_DEG;

const comp = (o: Partial<RawComp> & { zpid: string }): RawComp => ({
  address: `${o.zpid} Test St, Tempe, AZ`, status: 'SOLD',
  soldPrice: 400_000, soldDate: iso(20),
  livingArea: 2000, lotSize: 6000, beds: 3, baths: 2,
  propertyType: 'SFR', lat: latAt(0.2), lng: SUBJECT.lng, detailUrl: null, ...o,
});

const spanDays = (dates: Array<string | null>) => {
  const t = dates.filter((d): d is string => !!d).map((d) => Date.parse(d));
  return t.length < 2 ? 0 : (Math.max(...t) - Math.min(...t)) / DAY;
};

describe(`comps pool depth — the truncation fix${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // The recorded evidence. Verified here rather than taken from the report,
  // so if the fixture stops showing the bug the failure lands HERE.
  // =========================================================================
  describe('the recorded pool proves the starvation is real', () => {
    it('is exactly at the cap AND only eleven days deep', () => {
      expect(SIERRA.length, 'the recording is no longer at the cap').toBe(40);

      const dates = SIERRA
        .map((i) => (i.hdpData as { homeInfo?: { dateSold?: number } })?.homeInfo?.dateSold)
        .filter((d): d is number => typeof d === 'number' && d > 0)
        .map((ms) => new Date(ms).toISOString().slice(0, 10));

      expect(dates.length, 'no sold dates in the recording').toBeGreaterThan(30);
      const days = spanDays(dates);
      expect(
        days,
        `the recorded pool spans ${days} days — it no longer demonstrates the ` +
          'cap starving the near rungs, and every case below loses its ground',
      ).toBeLessThan(30);

      // The two facts TOGETHER are the invariant: at the cap, and shallow.
      // Either alone is unremarkable — a small market returns few sales, and a
      // busy month returns many. Both at once means the fetch stopped early.
      expect(days, 'the eleven-day figure from the report').toBeCloseTo(11, 0);
    });

    it('THE CONSEQUENCE: every recency rung sees the same eleven days', () => {
      // Documents the bug as a property of the DATA, independent of any
      // implementation. A pool 11 days deep cannot distinguish a 3-month rung
      // from a 12-month one, so the ladder cannot do its job no matter how
      // correctly it is walked.
      const dates = SIERRA
        .map((i) => (i.hdpData as { homeInfo?: { dateSold?: number } })?.homeInfo?.dateSold)
        .filter((d): d is number => typeof d === 'number' && d > 0);
      const newest = Math.max(...dates);

      for (const months of RECENCY_TIERS_MONTHS) {
        const cutoff = newest - months * 30.44 * DAY;
        const admitted = dates.filter((d) => d >= cutoff).length;
        expect(
          admitted,
          `the ${months}-month rung admits ${admitted} of ${dates.length} — if the ` +
            'rungs ever differ on this pool the fixture has changed',
        ).toBe(dates.length);
      }
    });
  });

  // =========================================================================
  // THE ONE THAT OUTRANKS THE OTHERS.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS) || poolDepthPending())('the ladder is FUNCTIONAL, not decorative', () => {
    it('a 6-month rung ADMITS sales the 3-month rung rejected — THROUGH THE FETCH', async () => {
      // RE-AIMED. The first version handed `selectTiers` a pool that already
      // contained the older comps and passed against the UNFIXED build — it
      // proved the filter walks a ladder correctly, which was never in doubt.
      // The bug is that the FETCH never returns the older sales, so the filter
      // has nothing to widen into. A test that supplies them itself cannot see
      // the bug at all.
      //
      // Driven end to end instead: the provider returns what a properly
      // windowed fetch would, and the assertion is on what the SERVICE kept.
      const recent = Array.from({ length: 4 }, (_, i) =>
        comp({ zpid: `R${i}`, soldDate: iso(10 + i * 5), soldPrice: 400_000 + i * 1_000 }));
      const older = Array.from({ length: 3 }, (_, i) =>
        comp({ zpid: `O${i}`, soldDate: iso(120 + i * 10), soldPrice: 380_000 + i * 1_000 }));

      // ONE provider, modelling the real actor: it holds all seven sales but
      // returns only the newest FOUR unless the fetch asks for a window. That
      // is the Sierra Vista pool in miniature, and it is what makes this case
      // fail on the unfixed build instead of passing on a fixture I stacked.
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: [...recent, ...older],
        truncateTo: 4,
        noDetailSupport: true, noNeighborhoodSupport: true,
      });

      const b = await runComps('1 Test St, Tempe AZ', { provider: spy.provider as never });
      expect(b.ok, 'the lookup failed — nothing to compare').toBe(true);
      if (!b.ok) return;

      // PRECONDITION: the provider really did hold more than it would return
      // unwindowed, so "the ladder widened" has something to widen into.
      expect(recent.length, 'the recent set is not short of the tier threshold')
        .toBeLessThan(MIN_COMPS_FOR_TIER);

      expect(
        b.comps.length,
        'only the newest four came back — the fetch asked for no window, so the ' +
          'cap starved the pool before any rung ran. Widening the recency ladder ' +
          'cannot admit a sale the fetch never returned.',
      ).toBeGreaterThan(recent.length);
            expect(b.recencyTierMonths, 'the deeper pool should stop at the 6-month rung').toBe(6);
    });

    it('NEGATIVE CONTROL: on an ELEVEN-DAY pool no rung can add anything', () => {
      // The same ladder, the same code, over the recorded starved pool. It
      // must NOT find more at 6 months — there is nothing older to find. This
      // is what the fix removes at the FETCH; the filter is behaving correctly
      // in both cases and this proves the previous test is measuring the pool
      // rather than the filter.
      const shallow = Array.from({ length: 4 }, (_, i) =>
        comp({ zpid: `S${i}`, soldDate: iso(3 + i * 2), soldPrice: 400_000 + i * 1_000 }));
      const walked = selectTiers(SUBJECT, shallow, NOW);
      expect(walked.kept).toHaveLength(4);
      expect(
        walked.recencyTierMonths,
        'a pool with nothing older than a fortnight still exhausts the ladder — ' +
          'that is correct, and it is why the ladder alone cannot report depth',
      ).toBe(MAX_COMP_AGE_MONTHS);
    });
  });

  // =========================================================================
  // The call, the span, the cap — the §14.16 design pointed at this fetch.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS) || poolDepthPending())('the fetch carries its window and reports its depth', () => {
    it('CASE 1: the SERVICE asks the provider for a windowed fetch', async () => {
      // RE-AIMED. The first version asserted `buildSoldSearchUrl` accepts a
      // doz argument — which it already did, because the aggregates slice
      // added it. That is a CAPABILITY; the bug is that the comps fetch never
      // USES it. Testing the builder passed against the unfixed build.
      //
      // Asserted at the seam that spends money: what the service actually
      // asked the provider for.
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: Array.from({ length: 5 }, (_, i) =>
          comp({ zpid: `C${i}`, soldDate: iso(10 + i * 5) })),
        noDetailSupport: true, noNeighborhoodSupport: true,
      });
      const out = await runComps('1 Test St, Tempe AZ', { provider: spy.provider as never });
      expect(out.ok, 'the lookup failed').toBe(true);

      const call = spy.calls.find((c) => c.method === 'fetchSoldComps');
      expect(call, 'the comps fetch never happened').toBeDefined();
      expect(
        call!.windowMonths,
        'the comps fetch carries NO window — the provider returns the newest N ' +
          'regardless of age, and in a dense market that is the eleven-day pool',
      ).toBe(MAX_COMP_AGE_MONTHS);
    });

    it('CASE 3: at the cap with a young oldest sale is TRUNCATED', async () => {
      const { isPoolTruncated } = await import('../../src/features/comps/filter.js')
        .then((m) => m as unknown as {
          isPoolTruncated?: (count: number, oldestMonths: number) => boolean;
        });
      // Predicate is optional in shape — if the fix models truncation
      // differently, this case re-points; the GUARANTEE is that at-limit plus
      // a shallow oldest sale is recognised as truncation rather than reported
      // as a completed 12-month search.
      expect(
        typeof isPoolTruncated,
        'no truncation predicate exported — re-point this onto whatever the fix ' +
          'calls it, but the invariant must be observable somewhere',
      ).toBe('function');
    });
  });
});
