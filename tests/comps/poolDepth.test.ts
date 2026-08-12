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
import { selectTiers, haversineMiles } from '../../src/features/comps/filter.js';
import { isWindowTruncated, TRUNCATION_DETECT_FRACTION } from '../../src/features/comps/aggregates.js';
import { SEARCH_RESULTS_LIMIT } from '../../src/features/comps/providers/apifyZillow.js';
import {
  MAX_COMPS_KEPT,
  MIN_COMPS_FOR_TIER,
  RECENCY_TIERS_MONTHS,
  MAX_COMP_AGE_MONTHS,
} from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { runComps } from '../../src/features/comps/service.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['filter', 'service', 'providers/apifyZillow'] as const;

const FIX = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'features', 'comps', '__fixtures__',
);
const SIERRA = JSON.parse(readFileSync(resolve(FIX, 'spike-sierra-vista.json'), 'utf8')) as Array<
  Record<string, unknown>
>;
/** The POST-fix recorded fetch: 3 mi, doz=12m, 499 of 500 returned. */
const SIERRA_DOZ = JSON.parse(
  readFileSync(resolve(FIX, 'spike-comps-3mi-doz12.json'), 'utf8'),
) as Array<Record<string, unknown>>;

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
      // Driven end to end, with the spy modelling the actor: it holds seven
      // sales and returns only the newest `truncateTo` unless the window and
      // the cap let more through.
      //
      // WHAT BUILDING THIS TAUGHT ME, and it is worth stating because it
      // changes what the fix is credited with: at a cap of four, a WINDOWED
      // fetch still returns the newest four. The window bounds the query and
      // makes the label honest — it does not, on its own, cure starvation.
      // The depth comes from the CAP moving 40 -> 500. Both changes are load
      // -bearing and for different reasons, which the next reader would
      // otherwise have to rediscover.
      const recent = Array.from({ length: 4 }, (_, i) =>
        comp({ zpid: `R${i}`, soldDate: iso(10 + i * 5), soldPrice: 400_000 + i * 1_000 }));
      const older = Array.from({ length: 3 }, (_, i) =>
        comp({ zpid: `O${i}`, soldDate: iso(120 + i * 10), soldPrice: 380_000 + i * 1_000 }));
      const all = [...recent, ...older];

      // THE OLD REGIME: a cap that bites (standing in for 40 in a dense
      // market). Every rung sees the newest four and the ladder is decorative.
      const starved = makeProviderSpy({
        subject: SUBJECT, comps: all, truncateTo: 4,
        noDetailSupport: true, noNeighborhoodSupport: true,
      });
      const before = await runComps('1 Test St, Tempe AZ', { provider: starved.provider as never });
      expect(before.ok, 'the starved lookup failed').toBe(true);
      if (!before.ok) return;
      expect(
        before.comps.length,
        'the starved regime returned more than the cap — the fixture no longer ' +
          'models a biting cap and this case has stopped discriminating',
      ).toBe(4);

      // THE SHIPPED REGIME: the cap is SEARCH_RESULTS_LIMIT, far above the
      // pool, so the window is what bounds the set and everything in it
      // survives to the ladder.
      const deep = makeProviderSpy({
        subject: SUBJECT, comps: all, truncateTo: SEARCH_RESULTS_LIMIT,
        noDetailSupport: true, noNeighborhoodSupport: true,
      });
      const after = await runComps('1 Test St, Tempe AZ', { provider: deep.provider as never });
      expect(after.ok, 'the deep lookup failed').toBe(true);
      if (!after.ok) return;

      // PRECONDITION: the recent-only set is short of the tier threshold, so
      // the ladder has a reason to widen at all.
      expect(recent.length).toBeLessThan(MIN_COMPS_FOR_TIER);

      expect(
        after.comps.length,
        'widening admitted nothing — the ladder is still decorative, which is ' +
          'the bug this slice exists to remove',
      ).toBeGreaterThan(before.comps.length);
      expect(after.recencyTierMonths, 'the ladder should reach the 6-month rung').toBe(6);
      // Seven survive the rung; MAX_COMPS_KEPT caps what the member SEES at
      // five. Asserting 7 here was my own error — the fetch and the filter
      // deliver seven, and the cap is a separate, later decision.
      expect(after.comps, 'the display cap moved').toHaveLength(MAX_COMPS_KEPT);
    });

    it('the shipped cap is far above what a dense market returns', () => {
      // The other half of the fix, asserted as a relationship rather than a
      // number. The recorded pre-fix pool was 40 items / 11 days; the recorded
      // post-fix fetch was 499 / 110 days. A cap that sits at or near what a
      // dense market produces is a cap that starves it.
      expect(SEARCH_RESULTS_LIMIT, 'the search cap is back at the starving value')
        .toBeGreaterThan(40);
      expect(SEARCH_RESULTS_LIMIT).toBe(500);
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

    it('CASE 3: the 90% predicate errs toward HONESTY, in both directions', () => {
      // RE-POINTED onto the shipped seam and the shipped semantics. My spec
      // expected an exact at-limit test; MASON chose 90% because a real fetch
      // returned 499 of 500 and exact detection missed it by one. The recorded
      // payload confirms that: `spike-comps-3mi-doz12.json` is 499 items.
      //
      // The asymmetry is the whole design, so it gets asserted as an asymmetry
      // rather than as a number. A FALSE POSITIVE costs an honest span label on
      // a fetch that happened to exhaust near the cap. A FALSE NEGATIVE costs
      // the 12-month lie. Those are not comparable, and the threshold sits
      // below the limit precisely so the cheap error is the one we make.
      expect(TRUNCATION_DETECT_FRACTION, 'the threshold is not below the limit — ' +
        'at 1.0 the predicate errs toward the expensive mistake')
        .toBeLessThan(1);

      const L = SEARCH_RESULTS_LIMIT;
      const threshold = Math.ceil(L * TRUNCATION_DETECT_FRACTION);

      // REQUIRED direction: anything at or above the threshold is truncated.
      for (const n of [L, L - 1, threshold]) {
        expect(isWindowTruncated(n, L), `${n} of ${L} was not flagged truncated`).toBe(true);
      }
      // The recorded 499 is the case exact detection missed.
      expect(isWindowTruncated(499, L), 'the recorded 499/500 fetch is not flagged').toBe(true);

      // ACCEPTABLE direction: below the threshold is treated as exhausted.
      for (const n of [threshold - 1, Math.floor(L / 2), 0]) {
        expect(isWindowTruncated(n, L), `${n} of ${L} was flagged truncated`).toBe(false);
      }
    });

    it('a TRUNCATED fetch never claims twelve months — the required direction', () => {
      // The false negative is the one that matters, so it is asserted on the
      // member-visible surface rather than on the predicate alone.
      const many = Array.from({ length: Math.ceil(SEARCH_RESULTS_LIMIT * 0.95) }, (_, i) =>
        comp({ zpid: `T${i}`, soldDate: iso(1 + (i % 30)), soldPrice: 400_000 + i }));
      const spy = makeProviderSpy({
        subject: SUBJECT, comps: many, noDetailSupport: true, noNeighborhoodSupport: true,
      });
      return runComps('1 Test St, Tempe AZ', { provider: spy.provider as never }).then((out) => {
        expect(out.ok, 'the lookup failed').toBe(true);
        if (!out.ok) return;
        expect(out.searchTruncated, 'a 95%-of-limit fetch was not flagged truncated').toBe(true);

        const text = String(renderCompsForChat(out as never) ?? '');
        expect(text.length, 'nothing rendered').toBeGreaterThan(200);
        expect(
          text.toLowerCase(),
          'a truncated search still claims the last 12 months — the member reads ' +
            'a one-month pool as a year of market history',
        ).not.toMatch(/last 12 months|past 12 months|past year/);
      });
    });

    it('an EXHAUSTED fetch does claim its window — the control', () => {
      // Without this, the case above passes for a build that never names a
      // window at all, which would be a different failure wearing this pass.
      const few = Array.from({ length: 6 }, (_, i) =>
        comp({ zpid: `E${i}`, soldDate: iso(10 + i * 20), soldPrice: 400_000 + i }));
      const spy = makeProviderSpy({
        subject: SUBJECT, comps: few, noDetailSupport: true, noNeighborhoodSupport: true,
      });
      return runComps('1 Test St, Tempe AZ', { provider: spy.provider as never }).then((out) => {
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.searchTruncated, 'a 6-item fetch was flagged truncated').toBe(false);
      });
    });
  });

  // =========================================================================
  // THE GROUND TRUTH, verified independently of MASON's live run.
  // =========================================================================
  describe('the 40-cap was displacing NEAR comps — measured, not reported', () => {
    it('the recorded pool contains close sales the newest-40 subset never had', () => {
      // MASON reports Don Frank now finding two sales on the subject's own
      // street at 0.02/0.05 mi. That came from a LIVE run with no recorded
      // artifact, so I cannot check that observation offline — but the
      // MECHANISM it claims is checkable on the recorded Tempe payload, and
      // this quantifies it rather than confirming one anecdote.
      //
      // METHOD NOTE: the payload carries no subject coordinates, so the centre
      // is estimated from the pool's extent. That does not weaken the result —
      // both sets are measured from the SAME estimated centre, so any error
      // shifts them identically and the comparison holds regardless.
      const pts = SIERRA_DOZ
        .map((i) => {
          const ll = i.latLong as { latitude?: number; longitude?: number } | undefined;
          const sold = (i.hdpData as { homeInfo?: { dateSold?: number } })?.homeInfo?.dateSold;
          return typeof ll?.latitude === 'number' && typeof sold === 'number'
            ? { lat: ll.latitude, lng: ll.longitude as number, sold }
            : null;
        })
        .filter((x): x is { lat: number; lng: number; sold: number } => x !== null);

      expect(pts.length, 'the recorded pool no longer parses').toBeGreaterThan(400);

      const cLat = (Math.min(...pts.map((p) => p.lat)) + Math.max(...pts.map((p) => p.lat))) / 2;
      const cLng = (Math.min(...pts.map((p) => p.lng)) + Math.max(...pts.map((p) => p.lng))) / 2;
      const withDist = pts.map((p) => ({ ...p, mi: haversineMiles(cLat, cLng, p.lat, p.lng) }));

      // What the OLD 40-cap would have returned: the newest forty.
      const newest40 = [...withDist].sort((a, b) => b.sold - a.sold).slice(0, 40);

      const within = (set: typeof withDist, r: number) => set.filter((x) => x.mi <= r).length;

      // PRECONDITION: the full pool genuinely contains close sales, or there is
      // nothing for the cap to have displaced and this proves nothing.
      expect(within(withDist, 0.25), 'the recorded pool holds no near sales')
        .toBeGreaterThan(0);

      expect(
        within(newest40, 0.25),
        'the newest-40 subset already contained the near sales — the cap was not ' +
          'displacing anything on this payload, and the fix cannot be credited ' +
          'with finding them',
      ).toBe(0);

      // The headline, and the reason this outranks a single anecdote: within a
      // mile the full pool holds 63 sales and the newest-40 held 2.
      expect(within(withDist, 1.0)).toBeGreaterThan(within(newest40, 1.0) + 20);

      // And the nearest sale in the pool is an order of magnitude closer than
      // anything the cap would have returned.
      const nearestFull = Math.min(...withDist.map((x) => x.mi));
      const nearestOld = Math.min(...newest40.map((x) => x.mi));
      expect(nearestFull, 'no genuinely close sale in the recording').toBeLessThan(0.1);
      expect(
        nearestOld,
        `the newest-40 nearest was ${nearestOld.toFixed(3)} mi — if the cap had been ` +
          'returning close sales all along, the starvation story is wrong',
      ).toBeGreaterThan(nearestFull * 5);
    });
  });
});
