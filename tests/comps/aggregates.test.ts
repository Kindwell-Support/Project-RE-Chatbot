/**
 * NEIGHBOURHOOD SALES AGGREGATES — CONTRACT §14.16. Written BEFORE the build.
 *
 * THE WHOLE FILE EXISTS FOR ONE BUG, and it is invisible in the output. A
 * truncated 12-month window produces a smaller, younger, entirely plausible
 * average — right shape, right magnitude, wrong data. The recorded pool proves
 * the trap is real: both search runs hit the 40-result cap, so the pool's
 * "12 months" is four to five weeks deep. Averaging that and labelling it
 * "past 12 months" is a confident wrong fact no member could detect.
 *
 * So NOTHING here asserts the average. The three cases that can catch it
 * assert the CALL, the SPAN, and the CAP:
 *
 *   1. a SEPARATE provider call carrying doz=12m — reusing the candidate pool
 *      shows up as a MISSING CALL, not a wrong figure;
 *   2. the aggregate set SPANS the window — the fixture makes the pool four
 *      weeks deep and the aggregate twelve months, so an implementation that
 *      reuses the pool has its span collapse. This distinguishes the two
 *      implementations BY THE DATA THEY USED, which no assertion on the
 *      number can do;
 *   3. the CAP-DETECTION invariant — count == cap AND a young oldest sale
 *      means the window was truncated, and the figure must not carry a
 *      12-month label. Silence beats a mislabelled average.
 *
 * MODULE PATH ASSUMPTION, flagged in mailbox 0030. These gate on
 * `aggregates`; if the build lands elsewhere the gate never resolves and this
 * file skips FOREVER while reporting "pending MASON" — which already happened
 * once, when the census gate said `census` and the module shipped at
 * `providers/census`. Confirming the gate resolves is now a handoff step.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { haversineMiles } from '../../src/features/comps/filter.js';
import { MAX_COMPS_KEPT } from '../../src/features/comps/config.js';

const MODS = ['aggregates'] as const;

const FIX = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'src', 'features', 'comps', '__fixtures__',
);
const SPIKE = JSON.parse(readFileSync(resolve(FIX, 'spike-agg-1mi-12mo.json'), 'utf8')) as Array<
  Record<string, unknown>
>;

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

/** Miles per degree of latitude — pure-north offsets keep every distance hand-checkable. */
const MI_PER_DEG = (3958.8 * Math.PI) / 180;
const LAT0 = 33.4673;
const LNG0 = -112.051;
const latAt = (mi: number) => LAT0 + mi / MI_PER_DEG;

interface Sale {
  zpid: string; address: string; soldPrice: number | null; soldDate: string | null;
  livingArea: number | null; beds: number | null; baths: number | null;
  lat: number; lng: number;
}
const sale = (o: Partial<Sale> & { zpid: string }): Sale => ({
  address: `${o.zpid} Test St, Phoenix, AZ`, soldPrice: 400_000, soldDate: iso(30),
  livingArea: 2000, beds: 3, baths: 2, lat: latAt(0.2), lng: LNG0, ...o,
});

/**
 * THE POOL — what the candidate search returns: capped at 40, and because it
 * is the NEWEST 40 in a dense market, only four weeks deep.
 */
const POOL_CAP = 40;
const POOL: Sale[] = Array.from({ length: POOL_CAP }, (_, i) =>
  sale({ zpid: `P${i}`, soldDate: iso(1 + (i % 28)), soldPrice: 400_000 + i * 100 }),
);

/**
 * THE AGGREGATE SET — the dedicated fetch: a genuine twelve months, including
 * sales the pool can never contain because they are older than its 40th newest.
 */
const AGG: Sale[] = Array.from({ length: 100 }, (_, i) =>
  sale({ zpid: `A${i}`, soldDate: iso(3 + i * 3), soldPrice: 380_000 + i * 500 }),
);

const spanDays = (sales: Array<{ soldDate: string | null }>) => {
  const t = sales.map((s) => Date.parse(s.soldDate!)).filter((n) => !Number.isNaN(n));
  return (Math.max(...t) - Math.min(...t)) / DAY;
};

describe(`neighbourhood sales aggregates${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // The recorded spike is the evidence §14.16 was ruled from. If it stops
  // saying what the ruling claims, every case below loses its ground.
  // =========================================================================
  describe('the spike recording still supports the ruling', () => {
    it('one run returned far more than the old 40-item wall', () => {
      expect(SPIKE.length, 'the recording no longer shows the cap being beaten')
        .toBeGreaterThan(200);
    });

    it('the window is a TRUE twelve months, not four weeks', () => {
      const dates = SPIKE
        .map((i) => (i.hdpData as { homeInfo?: { dateSold?: number } })?.homeInfo?.dateSold)
        .filter((d): d is number => typeof d === 'number' && d > 0);
      expect(dates.length, 'no sold dates in the recording').toBeGreaterThan(100);
      const days = (Math.max(...dates) - Math.min(...dates)) / DAY;
      expect(
        days,
        `the recorded span is ${Math.round(days)} days — doz=12m is no longer ` +
          'holding server-side, which is the premise of the whole ruling',
      ).toBeGreaterThan(300);
    });

    it('the BOX contains sales the CIRCLE does not — the exclusion is material', () => {
      // A 1-mile bounding box has corners at sqrt(2) = 1.414 mi. Averaging the
      // box silently includes sales up to 41% further out than the figure
      // claims. Verified independently from the recording rather than taken
      // from the report: with the centre estimated from the returned extent I
      // count 192 inside 1.0 mi against 235 items, which is the same finding
      // as the report's 193 of 233 (the difference is my estimated centre, not
      // a disagreement).
      const pts = SPIKE
        .map((i) => i.latLong as { latitude?: number; longitude?: number } | undefined)
        .filter((p): p is { latitude: number; longitude: number } =>
          typeof p?.latitude === 'number' && typeof p?.longitude === 'number');
      expect(pts.length).toBeGreaterThan(200);

      const lat = pts.map((p) => p.latitude);
      const lng = pts.map((p) => p.longitude);
      const cLat = (Math.min(...lat) + Math.max(...lat)) / 2;
      const cLng = (Math.min(...lng) + Math.max(...lng)) / 2;
      const inCircle = pts.filter((p) => haversineMiles(cLat, cLng, p.latitude, p.longitude) <= 1.0);

      expect(inCircle.length, 'nothing is inside the circle — the centre estimate is wrong')
        .toBeGreaterThan(100);
      expect(
        inCircle.length,
        'every returned sale is inside the circle, so this recording cannot ' +
          'demonstrate the box-corner problem any more',
      ).toBeLessThan(pts.length);
    });
  });

  // =========================================================================
  // 1 + 2 + 3 — the window. The reason this file exists.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the 12-month window is genuine, not truncated', () => {
    it('CASE 1: a SEPARATE fetch happens, and it carries the 12-month window', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      const calls: Array<{ radiusMi: number; months: number }> = [];
      const provider = {
        async fetchAreaSales(_lat: number, _lng: number, opts: { radiusMi: number; months: number }) {
          calls.push({ radiusMi: opts.radiusMi, months: opts.months });
          return AGG;
        },
      };

      await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );

      // Reusing the pool is a MISSING CALL, not a wrong number — which is why
      // this is asserted by call count rather than by output.
      expect(calls.length, 'no dedicated aggregate fetch happened — the pool was reused').toBe(1);
      expect(calls[0].months, 'the window was not requested as 12 months server-side').toBe(12);
      expect(calls[0].radiusMi, 'the aggregate radius is not 1 mile').toBe(1.0);
    });

    it('CASE 2: the set SPANS twelve months — a reused pool collapses to four weeks', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      // PRECONDITION on the FIXTURE, so the discriminator is real: the pool is
      // four weeks deep and the aggregate is a year. If these ever converge,
      // this case stops distinguishing the two implementations.
      expect(spanDays(POOL), 'the pool fixture is not four weeks deep').toBeLessThan(35);
      expect(spanDays(AGG), 'the aggregate fixture is not twelve months deep')
        .toBeGreaterThan(300);

      const provider = { async fetchAreaSales() { return AGG; } };
      const out = await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );

      expect(
        spanDays(out.salesUsed as never),
        'the aggregate spans only weeks — the candidate pool was averaged and ' +
          'labelled as twelve months, which is the bug this slice exists to avoid',
      ).toBeGreaterThan(300);
    });

    it('CASE 3: count == cap with a YOUNG oldest sale must not carry a 12-month label', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      // The signature of truncation: the provider returned exactly its limit,
      // and the oldest thing in it is recent. Both together mean there is
      // almost certainly older data we did not get.
      const provider = {
        limit: POOL_CAP,
        async fetchAreaSales() { return POOL; }, // 40 items, four weeks deep
      };
      const out = await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );

      expect(
        out.windowLabel ?? '',
        'a truncated set was labelled as twelve months — the member reads a ' +
          'four-week average as a year of market history',
      ).not.toMatch(/12 month|twelve month|past year/i);
      expect(out.truncated, 'truncation was not detected or not reported').toBe(true);
    });
  });

  // =========================================================================
  // dedupeSales BEFORE any average.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('dedupe runs before the average', () => {
    it('a duplicated sale is counted ONCE, and the shift is unambiguous', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      // The operator's point is the test-design point: a duplicate in 100
      // shifts the mean slightly, and a shift indistinguishable from rounding
      // is not a discriminator. So the fixture makes it large — ten copies of
      // one extreme sale against ten ordinary ones, where deduped and
      // un-deduped means differ by a figure nobody can call rounding.
      const ordinary = Array.from({ length: 10 }, (_, i) =>
        sale({ zpid: `O${i}`, soldPrice: 400_000, soldDate: iso(10 + i * 20) }));
      const twin = {
        zpid: 'DUP', soldPrice: 2_000_000, soldDate: iso(15), livingArea: 2000,
      };
      const dupes = Array.from({ length: 10 }, (_, i) =>
        sale({ ...twin, zpid: `DUP${i}`, address: `830 ${i === 0 ? '' : 'W '}America St, Phoenix, AZ` }));

      const provider = { async fetchAreaSales() { return [...ordinary, ...dupes]; } };
      const out = await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );

      // Assert the COUNT as well as the average — the count says dedupe ran,
      // the average says it ran BEFORE the arithmetic.
      expect(out.totalSales, 'the duplicates were counted as distinct sales').toBe(11);
      // deduped mean = (10x400,000 + 2,000,000) / 11 = 545,454.55
      // un-deduped   = (10x400,000 + 10x2,000,000) / 20 = 1,200,000
      expect(Math.round(out.avgPrice as number), 'the average was taken before dedupe')
        .toBe(545_455);
      expect(out.avgPrice, 'the un-deduped mean').not.toBe(1_200_000);
    });
  });

  // =========================================================================
  // The circle, not the box.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the aggregate set is the CIRCLE, not the bounding box', () => {
    it('a sale in the box corner is excluded', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      // Zillow's mapBounds is a BOX. Its corners sit at sqrt(2) = 1.414 mi, so
      // a box average quietly includes sales 41% further out than the "1 mile"
      // it claims — and in the recording that is ~18% of the returned set.
      const inside = Array.from({ length: 5 }, (_, i) =>
        sale({ zpid: `IN${i}`, lat: latAt(0.5), soldPrice: 400_000 }));
      const corner = Array.from({ length: 5 }, (_, i) =>
        sale({ zpid: `CORNER${i}`, lat: latAt(1.3), soldPrice: 900_000 }));

      const provider = { async fetchAreaSales() { return [...inside, ...corner]; } };
      const out = await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );

      expect(out.totalSales, 'box-corner sales were averaged into a 1-mile figure').toBe(5);
      expect(out.avgPrice, 'the corner prices moved the average').toBe(400_000);
      for (const s of out.salesUsed as Sale[]) {
        expect(
          haversineMiles(LAT0, LNG0, s.lat, s.lng),
          `${s.zpid} is outside the 1-mile circle`,
        ).toBeLessThanOrEqual(1.0);
      }
    });

    it('a sale EXACTLY on the radius is kept — the boundary is inclusive', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      const onEdge = [sale({ zpid: 'EDGE', lat: latAt(1.0) }), sale({ zpid: 'NEAR', lat: latAt(0.1) })];
      const provider = { async fetchAreaSales() { return onEdge; } };
      const out = await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );
      expect(out.totalSales, 'the comparison is < rather than <=').toBe(2);
    });
  });

  // =========================================================================
  // DOM — the label is the guarantee (§14.16 RULING 2, §14.10 Guarantee 4).
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the DOM figure is LABELLED as the 5-comp average', () => {
    it('the rendered line says five-comp average and never neighbourhood', async () => {
      const { renderNeighbourhoodBlock } = await import('../../src/features/comps/aggregates.js');
      const text = String(renderNeighbourhoodBlock({
        totalSales: 193, avgPrice: 432_100, avgPricePerSqft: 214, avgBeds: 3.2, avgBaths: 2.1,
        domFromComps: 26, compsUsedForDom: MAX_COMPS_KEPT,
        geography: 'within 1 mile of 123 Main St, Phoenix, AZ',
        windowLabel: 'sold in the past 12 months',
      } as never) ?? '');

      expect(text, 'the DOM figure did not render at all').toMatch(/26/);
      expect(
        text.toLowerCase(),
        'the DOM line does not say it is the average of the comps shown — a ' +
          'five-property figure reading as a neighbourhood statistic is the ' +
          'unlabelled pre-filled ARV, one surface over',
      ).toMatch(/5 comps|five comps|comps (shown|above)|comp average/);
      expect(
        text.toLowerCase().match(/days on market[^.\n]*/)?.[0] ?? '',
        'the DOM line presents as a NEIGHBOURHOOD figure',
      ).not.toMatch(/neighbourhood|neighborhood|area|within 1 mile/);
    });

    it('if the label cannot render, the LINE does not render', async () => {
      // Tested on its own, not inferred from the happy case. §14.16 makes this
      // non-negotiable: a bare DOM number beside genuine neighbourhood
      // aggregates reads as one of them.
      const { renderNeighbourhoodBlock } = await import('../../src/features/comps/aggregates.js');
      const text = String(renderNeighbourhoodBlock({
        totalSales: 193, avgPrice: 432_100, avgPricePerSqft: 214,
        domFromComps: 26, compsUsedForDom: null,
        geography: 'within 1 mile of 123 Main St, Phoenix, AZ',
        windowLabel: 'sold in the past 12 months',
      } as never) ?? '');

      expect(text.length, 'the whole block vanished — only the DOM line should')
        .toBeGreaterThan(0);
      expect(text, 'an unlabelled DOM figure rendered').not.toMatch(/\b26\b/);
      expect(text.toLowerCase(), 'the DOM line rendered without its label')
        .not.toMatch(/days on market/);
      // The rest of the block survives — one missing label is not a failed run.
      expect(text, 'the other aggregates were lost with the DOM line').toMatch(/432,100|432100/);
    });
  });

  // =========================================================================
  // Guarantee 4 + non-fatal failure + cost.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('provenance, failure and cost', () => {
    it('every figure names its geography and its window', async () => {
      const { renderNeighbourhoodBlock } = await import('../../src/features/comps/aggregates.js');
      const text = String(renderNeighbourhoodBlock({
        totalSales: 193, avgPrice: 432_100, avgPricePerSqft: 214,
        domFromComps: 26, compsUsedForDom: MAX_COMPS_KEPT,
        geography: 'within 1 mile of 123 Main St, Phoenix, AZ',
        windowLabel: 'sold in the past 12 months',
      } as never) ?? '');
      expect(text.toLowerCase(), 'the block names no geography').toMatch(/within 1 mile/);
      expect(text.toLowerCase(), 'the block names no window').toMatch(/12 months|past year/);
    });

    it('no geography or no window ⇒ the figures do not render', async () => {
      const { renderNeighbourhoodBlock } = await import('../../src/features/comps/aggregates.js');
      for (const missing of ['geography', 'windowLabel'] as const) {
        const text = String(renderNeighbourhoodBlock({
          totalSales: 193, avgPrice: 432_100, avgPricePerSqft: 214,
          domFromComps: 26, compsUsedForDom: MAX_COMPS_KEPT,
          geography: 'within 1 mile of 123 Main St, Phoenix, AZ',
          windowLabel: 'sold in the past 12 months',
          [missing]: null,
        } as never) ?? '');
        expect(text, `a figure rendered with no ${missing}`).not.toMatch(/432,100|432100/);
      }
    });

    it('a FAILED aggregate fetch renders the comps without the block', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      const provider = {
        async fetchAreaSales(): Promise<Sale[]> { throw new Error('actor timeout'); },
      };
      await expect(
        fetchNeighbourhoodAggregate({ lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never),
      ).resolves.toBeDefined();
    });

    it('COST: the aggregate adds exactly ONE actor run — four per lookup', async () => {
      const { fetchNeighbourhoodAggregate } = await import('../../src/features/comps/aggregates.js');
      let runs = 0;
      const provider = { async fetchAreaSales() { runs += 1; return AGG; } };
      await fetchNeighbourhoodAggregate(
        { lat: LAT0, lng: LNG0 }, { provider, pool: POOL } as never,
      );
      expect(
        runs,
        `${runs} aggregate runs — §14.16 pins ONE (subject + search + detail + ` +
          'aggregate = 4 per lookup). A per-sale run over 193 sales is the ' +
          'failure this bound exists to catch.',
      ).toBe(1);
    });
  });
});
