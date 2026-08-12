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
 * RE-POINTED onto the shipped seams (HANDOFF 0045). The module path I guessed
 * was right; the function names were not, and I said so in the file when I
 * wrote them. Every expected VALUE below is unchanged — those were derived,
 * and derived values do not move to meet an implementation.
 *
 * Two structural improvements in the build worth naming, because they make
 * cases of mine unnecessary rather than passing:
 *
 *   - there is no `pool` parameter. The candidate pool cannot reach the
 *     aggregate path BY CONSTRUCTION — the only sources are the dedicated
 *     fetch and its cached raw. My CASE 1 asserted a call that could not be
 *     skipped; it now asserts the call is made with the right arguments,
 *     which is what remains falsifiable.
 *   - DOM reads `result.comps[].detail` only and is structurally unable to
 *     see the aggregate set, so "DOM is not the neighbourhood figure" is a
 *     property of the wiring rather than of the arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { haversineMiles } from '../../src/features/comps/filter.js';
import {
  MAX_COMPS_KEPT,
  NEIGHBORHOOD_RESULTS_LIMIT,
  NEIGHBORHOOD_RADIUS_MI,
  NEIGHBORHOOD_WINDOW_MONTHS,
} from '../../src/features/comps/config.js';
import {
  computeNeighborhoodAggregates,
  isWindowTruncated,
  TRUNCATION_DETECT_FRACTION,
} from '../../src/features/comps/aggregates.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { runComps } from '../../src/features/comps/service.js';
import { golden01 } from '../fixtures/golden/index.js';
import type {
  NeighborhoodAggregates, RawComp, ScoredComp, SubjectProperty,
} from '../../src/features/comps/types.js';

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

type Sale = RawComp;
const sale = (o: Partial<RawComp> & { zpid: string }): RawComp => ({
  address: `${o.zpid} Test St, Phoenix, AZ`, status: 'SOLD',
  soldPrice: 400_000, soldDate: iso(30),
  livingArea: 2000, lotSize: 6000, beds: 3, baths: 2,
  propertyType: 'SFR', lat: latAt(0.2), lng: LNG0, detailUrl: null, ...o,
});

const SUBJECT: SubjectProperty = {
  ...golden01.subject, address: '123 MAIN STREET, PHOENIX, AZ', lat: LAT0, lng: LNG0,
};
const NOW = new Date();

/** Displayed comps carrying detail, for the DOM half. */
const displayed = (doms: Array<number | null>): ScoredComp[] =>
  doms.map((d, i) => ({
    comp: sale({ zpid: `D${i}` }),
    distanceMi: 0.1, monthsAgo: 1, pricePerSqft: 200, score: 10,
    parts: { distance: 1, sqft: 1, recency: 1, bedbath: 1, lot: 1 },
    ...(d === null ? {} : {
      detail: {
        daysOnMarket: d, parkingSpaces: 2, yearBuilt: 1990,
        architecturalStyle: null, propertyCondition: null,
      },
    }),
  }));

/** compute() with the fixture defaults, so cases read as data. */
const agg = (sales: RawComp[], doms: Array<number | null> = [20, 25, 30, 25, 30]) =>
  computeNeighborhoodAggregates(sales, SUBJECT, displayed(doms), NOW);

/** A full CompsResult with the neighbourhood section attached, for render cases. */
const renderWith = (neighborhood: NeighborhoodAggregates | null | undefined) =>
  String(renderCompsForChat({
    ok: true, algoVersion: 3, runId: 'r', subject: SUBJECT,
    radiusTierMi: 1.0, recencyTierMonths: 3,
    comps: displayed([20, 25, 30, 25, 30]), rejected: [],
    fromCache: false, provider: 'stub',
    ...(neighborhood === undefined ? {} : { neighborhood }),
  } as never) ?? '');

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
  // 3..358 days: a genuine twelve months. An earlier version stepped by 3 and
  // spanned 297, which failed its own >300 precondition — the precondition
  // caught my fixture, which is what it is for.
  sale({ zpid: `A${i}`, soldDate: iso(3 + Math.round(i * 3.6)), soldPrice: 380_000 + i * 500 }),
);

/** `2026-07-30` -> `Jul 30` — the member-visible form §14.18 pins. */
const monthDay = (iso: string): string => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};

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
    it('CASE 1: a DEDICATED fetch happens, with (1.0 mi, 12 months)', async () => {
      // Re-pointed: the pool cannot reach this path by construction, so what
      // remains falsifiable is that the call is made and carries the right
      // window. A wrong window here is the bug wearing the right shape.
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: golden01.comps.map((c, i) => ({
          ...c, soldDate: iso(20 + i * 5), lat: latAt(0.1), lng: LNG0,
        })),
        neighborhoodSales: AGG,
        noDetailSupport: true,
      });
      const out = await runComps('123 Main St, Phoenix AZ', { provider: spy.provider as never });
      expect(out.ok, 'the lookup failed — nothing to assert about').toBe(true);

      const calls = spy.calls.filter((c) => c.method === 'fetchNeighborhoodSales');
      expect(calls.length, 'no dedicated neighbourhood fetch happened').toBe(1);
      expect(calls[0].radiusMi, 'the aggregate radius is not 1 mile').toBe(NEIGHBORHOOD_RADIUS_MI);
      expect(calls[0].windowMonths, 'the window was not requested as 12 months server-side')
        .toBe(NEIGHBORHOOD_WINDOW_MONTHS);
      expect(NEIGHBORHOOD_RADIUS_MI).toBe(1.0);
      expect(NEIGHBORHOOD_WINDOW_MONTHS).toBe(12);
    });

    it('CASE 2: the set SPANS twelve months — a reused pool collapses to four weeks', () => {
      // PRECONDITION on the FIXTURES, so the discriminator stays real: the
      // pool is four weeks deep and the aggregate is a year. If they ever
      // converge this case says so instead of passing quietly.
      expect(spanDays(POOL), 'the pool fixture is not four weeks deep').toBeLessThan(35);
      expect(spanDays(AGG), 'the aggregate fixture is not twelve months deep')
        .toBeGreaterThan(300);

      const out = agg(AGG);
      const span = spanDays([
        { soldDate: out.earliestSaleDate }, { soldDate: out.latestSaleDate },
      ]);
      expect(
        span,
        'the aggregate spans only weeks — the candidate pool was averaged and ' +
          'labelled as twelve months, which is the bug this slice exists to avoid',
      ).toBeGreaterThan(300);

      // The same computation over the POOL is what a reused-pool build produces.
      const collapsed = agg(POOL);
      expect(
        spanDays([{ soldDate: collapsed.earliestSaleDate }, { soldDate: collapsed.latestSaleDate }]),
        'the pool fixture no longer collapses — the two implementations are ' +
          'no longer distinguishable by the data they used',
      ).toBeLessThan(35);
    });

    it('CASE 3: the truncation predicate is a 90% BAND, not an exact at-limit test', () => {
      // RE-POINTED. I specced exact at-limit detection; the shipped predicate
      // is `count >= limit * TRUNCATION_DETECT_FRACTION`. MASON chose the band
      // because a real fetch returned 499 of 500 — exact detection missed the
      // truncation by ONE ITEM, and the cost of missing is the 12-month lie.
      //
      // The asymmetry is the design, so it is asserted as an asymmetry. A
      // false positive costs an honest span label on a fetch that happened to
      // exhaust near the cap; a false negative costs a member being told a
      // one-month pool is a year of history. Those are not comparable, and the
      // threshold sits BELOW the limit so the cheap error is the one made.
      expect(TRUNCATION_DETECT_FRACTION, 'the band is not below the limit — at 1.0 ' +
        'the predicate errs toward the expensive mistake').toBeLessThan(1);

      const L = NEIGHBORHOOD_RESULTS_LIMIT;
      const threshold = Math.ceil(L * TRUNCATION_DETECT_FRACTION);

      for (const n of [L, L - 1, 499, threshold]) {
        expect(isWindowTruncated(n, L), `${n} of ${L} was not flagged truncated`).toBe(true);
      }
      for (const n of [threshold - 1, Math.floor(L / 2), 0]) {
        expect(isWindowTruncated(n, L), `${n} of ${L} was flagged truncated`).toBe(false);
      }
    });

    it('CASE 3b: a truncated fetch RENDERS THE ACTUAL SPAN, never a 12-month claim', () => {
      // The direction that matters to the member. Our own resultsLimit hitting
      // would otherwise produce a four-week average wearing a 12-month label —
      // the same bug the dedicated fetch exists to prevent, at a different cap.
      const truncated = Array.from({ length: NEIGHBORHOOD_RESULTS_LIMIT }, (_, i) =>
        sale({ zpid: `T${i}`, soldDate: iso(1 + (i % 28)), soldPrice: 400_000 + i }));
      const out = agg(truncated);
      expect(out.windowTruncated, 'a full-limit fetch was not flagged truncated').toBe(true);

      const text = renderWith(out);
      expect(text.length, 'nothing rendered').toBeGreaterThan(0);
      expect(
        text.toLowerCase(),
        'a truncated window was labelled as twelve months — the member reads a ' +
          'four-week average as a year of market history',
      ).not.toMatch(/past 12 months|last 12 months|past year|twelve months/);
      // ...and the honest alternative IS present: the real span.
      expect(
        text,
        'the truncated render names no window at all — silence about the window ' +
          'is better than a wrong label, but the actual span is better than both',
        // §14.18 renders this clause's date as `Mon D, YYYY` too. The window
        // clause is a VARIABLE of the template, so the reflow reformatted it
        // rather than dropping it — which is the guarantee, and it survived.
      ).toContain(monthDay(String(out.earliestSaleDate ?? '')));
    });

    it('CASE 3c: an UNtruncated fetch DOES carry the 12-month label', () => {
      // The control. Without it, 3b passes for a build that never labels the
      // window at all, which would be a different bug wearing this test's pass.
      const out = agg(AGG);
      expect(out.windowTruncated, 'the control fixture is itself truncated').toBe(false);
      expect(
        renderWith(out).toLowerCase(),
        'an honest 12-month window is not being labelled as one',
      ).toMatch(/12 months|past year/);
    });
  });

  // =========================================================================
  // dedupeSales BEFORE any average.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('dedupe runs before the average', () => {
    it('a duplicated sale is counted ONCE, and the shift is unambiguous', () => {
      // The operator's point is the test-design point: a duplicate in 100
      // shifts the mean slightly, and a shift indistinguishable from rounding
      // is not a discriminator. Ten ordinary sales against ten copies of one
      // extreme sale — deduped and un-deduped differ by a figure nobody can
      // call rounding.
      const ordinary = Array.from({ length: 10 }, (_, i) =>
        sale({ zpid: `O${i}`, soldPrice: 400_000, soldDate: iso(10 + i * 20) }));
      const dupes = Array.from({ length: 10 }, (_, i) =>
        sale({
          zpid: `DUP${i}`, address: `830 ${i === 0 ? '' : 'W '}America St, Phoenix, AZ`,
          soldPrice: 2_000_000, soldDate: iso(15), livingArea: 2000,
        }));

      const out = agg([...ordinary, ...dupes]);

      // The COUNT says dedupe ran; the AVERAGE says it ran BEFORE the arithmetic.
      expect(out.totalSales, 'the duplicates were counted as distinct sales').toBe(11);
      // deduped   = (10 x 400,000 + 2,000,000) / 11 = 545,454.55 -> 545,455
      // un-deduped = (10 x 400,000 + 10 x 2,000,000) / 20 = 1,200,000
      expect(out.avgSoldPrice, 'the average was taken before dedupe').toBe(545_455);
      expect(out.avgSoldPrice, 'the un-deduped mean').not.toBe(1_200_000);
    });

    it('the REAL recording contains a duplicate pair — dedupe is not fixture-only', () => {
      // MASON reports the recorded 1-mile set carries a genuine BUG-010 pair.
      // Verified here rather than taken: the deduped total must be strictly
      // below the count of in-circle, in-window sold items.
      const inWindow = SPIKE
        .map((i) => {
          const hi = (i.hdpData as { homeInfo?: Record<string, unknown> })?.homeInfo ?? {};
          const ll = i.latLong as { latitude?: number; longitude?: number } | undefined;
          if (typeof ll?.latitude !== 'number' || typeof hi.dateSold !== 'number') return null;
          return sale({
            zpid: String(i.zpid ?? `x${Math.random()}`),
            address: String(i.address ?? ''),
            soldPrice: typeof i.price === 'number' ? i.price : null,
            soldDate: new Date(hi.dateSold as number).toISOString().slice(0, 10),
            livingArea: typeof i.area === 'number' ? i.area : null,
            lat: ll.latitude, lng: ll.longitude as number,
          });
        })
        .filter((x): x is RawComp => x !== null);
      expect(inWindow.length, 'the recording no longer parses').toBeGreaterThan(150);

      const centre: SubjectProperty = {
        ...SUBJECT,
        lat: (Math.min(...inWindow.map((s) => s.lat)) + Math.max(...inWindow.map((s) => s.lat))) / 2,
        lng: (Math.min(...inWindow.map((s) => s.lng)) + Math.max(...inWindow.map((s) => s.lng))) / 2,
      };
      const inCircle = inWindow.filter(
        (s) => haversineMiles(centre.lat, centre.lng, s.lat, s.lng) <= NEIGHBORHOOD_RADIUS_MI,
      );
      const out = computeNeighborhoodAggregates(inCircle, centre, displayed([25]), new Date('2026-08-11'));

      expect(inCircle.length, 'no in-circle sales parsed').toBeGreaterThan(100);
      expect(
        out.totalSales,
        'the deduped total equals the raw in-circle count — either the recording ' +
          'no longer contains a duplicate pair, or dedupe is not running on it',
      ).toBeLessThan(inCircle.length);
    });
  });

  // =========================================================================
  // The circle, not the box.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the aggregate set is the CIRCLE, not the bounding box', () => {
    it('a sale in the box corner is excluded', () => {
      // Zillow's mapBounds is a BOX. Its corners sit at sqrt(2) = 1.414 mi, so
      // a box average quietly includes sales 41% further out than the "1 mile"
      // it claims — ~18% of the recorded set.
      const inside = Array.from({ length: 5 }, (_, i) =>
        sale({ zpid: `IN${i}`, lat: latAt(0.5), soldPrice: 400_000, soldDate: iso(20 + i) }));
      const corner = Array.from({ length: 5 }, (_, i) =>
        sale({ zpid: `CORNER${i}`, lat: latAt(1.3), soldPrice: 900_000, soldDate: iso(20 + i) }));

      const out = agg([...inside, ...corner]);
      expect(out.totalSales, 'box-corner sales were averaged into a 1-mile figure').toBe(5);
      expect(out.avgSoldPrice, 'the corner prices moved the average').toBe(400_000);
    });

    it('a sale EXACTLY on the radius is kept — the boundary is inclusive', () => {
      const out = agg([
        sale({ zpid: 'EDGE', lat: latAt(1.0), soldDate: iso(20) }),
        sale({ zpid: 'NEAR', lat: latAt(0.1), soldDate: iso(21) }),
      ]);
      expect(out.totalSales, 'the comparison is < rather than <=').toBe(2);
    });
  });

  // =========================================================================
  // DOM — the label is the guarantee (§14.16 RULING 2, §14.10 Guarantee 4).
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the DOM figure is LABELLED as the comps average', () => {
    it('DOM comes ONLY from the displayed comps, never the aggregate set', () => {
      // Structural in the build — `computeNeighborhoodAggregates` reads
      // `displayedComps[].detail` and cannot see the aggregate pool. Asserted
      // anyway: the aggregate set here is large and its own DOM would differ.
      const out = agg(AGG, [10, 20, 30]);
      expect(out.avgDomOfDisplayedComps, '(10+20+30)/3 = 20').toBe(20);
      expect(out.domCompCount, 'the label needs the count it is averaging').toBe(3);
    });

    it('the rendered line says how many comps it averaged, and is not a neighbourhood figure', () => {
      const out = agg(AGG, [20, 25, 30, 25, 30]);
      expect(out.avgDomOfDisplayedComps, '(20+25+30+25+30)/5 = 26').toBe(26);

      const text = renderWith(out);
      expect(text, 'the DOM figure did not render at all').toMatch(/26/);
      // Scope to the NEIGHBOURHOOD section. Every per-comp detail row also
      // carries "days on market", so an unscoped, case-insensitive search
      // grabs a comp row and asserts against the wrong subject — finding #4
      // in this plan's own list, caught here by the test failing on a comp
      // line rather than the section line.
      const section = text.slice(text.indexOf('**Neighborhood sales**'));
      expect(section.startsWith('**Neighborhood sales**'), 'no neighbourhood section rendered')
        .toBe(true);
      const domLine = section.split('\n').find((l) => /^Days on market:/.test(l)) ?? '';
      expect(domLine.length, 'no days-on-market line in the neighbourhood section')
        .toBeGreaterThan(0);
      expect(
        domLine.toLowerCase(),
        'the DOM line does not say it is the average of the comps shown — a ' +
          'five-property figure reading as a neighbourhood statistic is the ' +
          'unlabelled pre-filled ARV, one surface over',
      ).toMatch(/\b5\b|five|comps? (shown|above)|comp average/);
      // POSITIVE, not a token ban. The line legitimately contains the word
      // "neighborhood" — in the phrase "not a neighborhood figure", which is
      // the disclaimer itself. Banning the token would fail the copy that
      // does exactly what §14.16 demands. This is the first mistake I made on
      // this project (a `\barv\b` ban failing an instruction that said the
      // tool does NOT produce an ARV), reproduced by me at the end of it:
      // assert the SUBSTANCE, never the vocabulary.
      expect(
        domLine.toLowerCase(),
        'the DOM line does not disclaim being a neighbourhood figure',
      ).toMatch(/not a neighbou?rhood figure/);
      expect(
        domLine.toLowerCase(),
        'the DOM line CLAIMS to be a neighbourhood or area-wide average',
      ).not.toMatch(/neighbou?rhood (average|figure of|dom)|across the (neighbou?rhood|area)|area average/);
    });

    it('with NO comp detail the VALUE goes to an em-dash and the label stays', () => {
      // RE-POINTED, and my original framing was wrong. I assumed a zero count
      // meant the label could not render, so the line had to vanish. It can
      // render — it reads "across 0 of the 5 comps shown above", which is a
      // true and useful statement — and §14.5 then says the missing VALUE is
      // an explicit em-dash rather than an omission.
      //
      // The two rules compose: §14.16 governs the LABEL, §14.5 governs the
      // VALUE. What must never happen is a value without its label, and that
      // is what this now asserts in both directions.
      const out = agg(AGG, [null, null, null]);
      expect(out.avgDomOfDisplayedComps, 'nothing to average').toBeNull();
      expect(out.domCompCount).toBe(0);

      const text = renderWith(out);
      const section = text.slice(text.indexOf('**Neighborhood sales**'));
      const domLine = section.split('\n').find((l) => /^Days on market:/.test(l)) ?? '';

      expect(domLine.length, 'the DOM line vanished entirely').toBeGreaterThan(0);
      expect(domLine, 'a missing DOM rendered as something other than the null marker')
        .toMatch(/Days on market: —/);
      expect(domLine, 'the label was dropped along with the value').toMatch(/comps shown/);
      expect(domLine, 'a zero count was hidden rather than stated').toMatch(/across 0 /);
      // The rest of the aggregates survive — one missing figure is not a failed run.
      expect(section, 'the other aggregates were lost with the DOM value')
        .toMatch(String(out.totalSales));
    });

    it('THE INVARIANT ACROSS BOTH STATES: a DOM value never appears without its label', () => {
      // The guarantee §14.16 actually protects, stated once over both shapes.
      // COLLECTED rather than branched: `if (/Days on market: \d/)` is false
      // for the null-DOM state, so an assertion inside it is dead on that
      // state — my own sweep caught it, again. Collecting also buys the
      // precondition that at least one state produced a figure to check.
      const lines: string[] = [];
      for (const doms of [[20, 25, 30, 25, 30], [null, null, null], [15]]) {
        const out = agg(AGG, doms as Array<number | null>);
        const text = renderWith(out);
        const section = text.slice(text.indexOf('**Neighborhood sales**'));
        const domLine = section.split('\n').find((l) => /^Days on market:/.test(l)) ?? '';
        expect(domLine.length, `no DOM line for ${JSON.stringify(doms)}`).toBeGreaterThan(0);
        lines.push(domLine);
      }

      const withFigure = lines.filter((l) => /Days on market: \d/.test(l));
      expect(withFigure.length, 'no state produced a DOM figure — nothing to check')
        .toBeGreaterThan(0);
      for (const line of withFigure) {
        expect(line, `a DOM figure rendered with no comp-count label: ${line}`)
          .toMatch(/comps shown/);
        expect(line.toLowerCase(), `the DOM figure reads as a neighbourhood statistic: ${line}`)
          .toMatch(/not a neighbou?rhood figure/);
      }
    });
  });

  // =========================================================================
  // Guarantee 4 + non-fatal failure + cost.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('provenance, failure and cost', () => {
    it('the block names its geography and its window', () => {
      const text = renderWith(agg(AGG));
      expect(text.toLowerCase(), 'the block names no geography').toMatch(/1 mile|1 mi/);
      expect(text.toLowerCase(), 'the block names no window').toMatch(/12 months|past year/);
    });

    it('a FAILED aggregate fetch renders the comps without the block', async () => {
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: golden01.comps.map((c, i) => ({
          ...c, soldDate: iso(20 + i * 5), lat: latAt(0.1), lng: LNG0,
        })),
        failNeighborhood: { kind: 'timeout' },
        noDetailSupport: true,
      });
      const out = await runComps('123 Main St, Phoenix AZ', { provider: spy.provider as never });

      expect(out.ok, 'a NEIGHBOURHOOD failure failed the whole comps run').toBe(true);
      if (out.ok) {
        expect(out.comps.length, 'the comps themselves were lost').toBeGreaterThanOrEqual(3);
        const text = String(renderCompsForChat(out as never) ?? '');
        expect(text.length, 'nothing rendered').toBeGreaterThan(200);
      }
    });

    it('COST: the aggregate adds exactly ONE actor run', async () => {
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: golden01.comps.map((c, i) => ({
          ...c, soldDate: iso(20 + i * 5), lat: latAt(0.1), lng: LNG0,
        })),
        neighborhoodSales: AGG,
        noDetailSupport: true,
      });
      await runComps('123 Main St, Phoenix AZ', { provider: spy.provider as never });
      const runs = spy.calls.filter((c) => c.method === 'fetchNeighborhoodSales').length;
      expect(
        runs,
        `${runs} aggregate runs — §14.16 pins ONE. A per-sale run over ~193 ` +
          'sales is the failure this bound exists to catch, and it would not ' +
          'look wrong in any output.',
      ).toBe(1);
    });
  });
});
