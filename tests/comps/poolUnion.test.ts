/**
 * THE UNION — folding the cached 1-mile aggregate payload into the comps
 * candidate pool. Specced BEFORE the build, from the operator's brief.
 *
 * WHY IT IS FREE AND WHY IT WORKS. Both payloads are already on the cache row.
 * The aggregate fetch is 1 mi / 12 mo and, unlike the 3-mile comps search, it
 * comes back EXHAUSTED rather than capped — so within a mile it is a complete
 * twelve-month universe. That is exactly the region the 500-cap displaces
 * first, because the cap fills with the newest sales across three miles.
 *
 * THE RISKS, in the operator's priority order, and what makes each invisible:
 *
 *   1. DEDUPE. The payloads overlap BY CONSTRUCTION — every in-mile sale the
 *      comps search did return is also in the aggregate set. BUG-010 was one
 *      duplicate pair occasionally; this is guaranteed overlap at scale. A
 *      double-counted sale looks like two comps.
 *   2. TRUSTED-SOURCE SHORTCUT. If aggregate-sourced sales skip any gate, the
 *      output shows a plausible comp that should never have been there. So the
 *      cases below assert the REJECTION REASON, not merely absence — a sale
 *      dropped for the wrong reason, or dropped silently, is not evidence the
 *      gates ran.
 *   3. PARTIAL DATA. The aggregate payload is a different query; a sale
 *      missing sqft or type must die at the normal gates.
 *   4. THE LABEL. Within a mile the union may now be COMPLETE while beyond a
 *      mile is still capped. `searchTruncated` is one boolean over two
 *      regions, and no assertion on the comp set can catch it lying.
 *   5. THE VERSION. Both raws are sound here, unlike the 40-cap case — so this
 *      bump must RECOMPUTE, and the refetch floor must NOT move with it.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { runComps } from '../../src/features/comps/service.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { normalizeAddress, cacheKey } from '../../src/features/comps/normalize.js';
import {
  ALGO_VERSION,
  RAW_REFETCH_BELOW_VERSION,
  CACHE_TTL_DAYS,
  MAX_COMPS_KEPT,
} from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type {
  CachedComps, CompsCacheLike,
} from '../../src/features/comps/service.js';
import type { RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['service', 'filter'] as const;

const NOW = new Date('2026-08-11T12:00:00.000Z');
const now = () => NOW;
const DAY = 86_400_000;
const iso = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 10);

const MI_PER_DEG = (3958.8 * Math.PI) / 180;
const SUBJECT: SubjectProperty = {
  ...golden01.subject, address: '1 TEST ST, PHOENIX, AZ', lat: 33.45, lng: -112.05,
};
const latAt = (mi: number) => SUBJECT.lat + mi / MI_PER_DEG;

const ADDRESS = '1 Test St, Phoenix AZ';
const KEY = cacheKey(normalizeAddress(ADDRESS));
const expires = new Date(NOW.getTime() + CACHE_TTL_DAYS * DAY).toISOString();

const sale = (o: Partial<RawComp> & { zpid: string }): RawComp => ({
  address: `${o.zpid} Test St, Phoenix, AZ`, status: 'SOLD',
  soldPrice: 400_000, soldDate: iso(30),
  livingArea: 2000, lotSize: 6000, beds: 3, baths: 2,
  propertyType: 'SFR', lat: latAt(0.3), lng: SUBJECT.lng, detailUrl: null, ...o,
});

/**
 * DRIVEN COLD, THROUGH THE PROVIDER — and the first version of this file was
 * not, which is why it is worth explaining.
 *
 * I originally seeded a cache row carrying both raw payloads, on the strength
 * of "the payload is already on the row". Probed before trusting it: the run
 * came back `ok=false, TOO_FEW_COMPS, zero candidates, zero provider calls`.
 * A row at the CURRENT version is served as a hit, and the recompute-from-raw
 * path is the dormant one — with RAW_REFETCH_BELOW_VERSION and ALGO_VERSION
 * both at 4, no row can be stale (recompute) and sound (no refetch) at once.
 * So the pipeline never ran and every dedupe case passed having asserted
 * nothing.
 *
 * The union's primary path needs no cache: a cold lookup fetches BOTH payloads
 * anyway, so the union happens in memory. That is exercisable today, it is the
 * path most lookups take, and it does not depend on a version bump landing
 * first. The cache-warm variant is a separate concern and is gated below.
 */
function coldRun(comps: RawComp[], aggregate: RawComp[], extra: Record<string, unknown> = {}) {
  const spy = makeProviderSpy({
    subject: SUBJECT,
    comps,
    neighborhoodSales: aggregate,
    noDetailSupport: true,
    ...extra,
  });
  return { spy, run: () => runComps(ADDRESS, { provider: spy.provider as never, now }) };
}


/**
 * THE PRECONDITION EVERY CASE IN THIS FILE NEEDS.
 *
 * Probed before trusting a single green: with the union unbuilt, an
 * aggregate-only sale never reaches the pool. Every dedupe case here supplies
 * filler in BOTH payloads so the run succeeds — which means the comps payload
 * alone satisfies them, the duplicate never arrives, and "no duplicate in the
 * kept set" passes having proven nothing.
 *
 * So each case plants a MARKER: an aggregate-only sale, clean on every gate,
 * close and recent enough that it cannot be filtered out for any other reason.
 * If the marker is absent from the kept set the union did not run, and the
 * case fails HERE with that message rather than passing on an empty premise.
 *
 * This is the difference between a spec that is waiting for a build and a spec
 * that is green regardless of it.
 */
const MARKER = 'UNION-MARKER';
const marker = () => sale({
  zpid: MARKER, address: '9 Union Marker Way, Phoenix, AZ',
  lat: latAt(0.04), soldDate: iso(12), soldPrice: 405_000,
});

function expectUnionRan(out: { ok: boolean; comps?: Array<{ comp: RawComp }> }): void {
  expect(out.ok, 'the lookup failed outright — nothing to conclude').toBe(true);
  expect(
    (out.comps ?? []).map((c) => c.comp.zpid),
    'the aggregate-only marker never reached the kept set — the union is not ' +
      'wired, so every assertion below would pass on an empty premise',
  ).toContain(MARKER);
}

describe(`the aggregate payload unioned into the comps pool${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // 1. DEDUPE OVER THE UNION — the highest-risk item.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('dedupe over the union', () => {
    /**
     * The recorded BUG-010 shape, now guaranteed rather than occasional: one
     * sale, two zpids, two address spellings, identical price / sqft / date
     * and coordinates a metre apart. One copy in each payload.
     */
    const inComps = sale({
      zpid: '81990022', address: '830 America St, Phoenix, AZ',
      soldPrice: 360_000, livingArea: 1900, soldDate: iso(22), lat: latAt(0.05),
    });
    const inAggregate = sale({
      zpid: '2075961815', address: '830 W AMERICA Street, Phoenix, AZ',
      soldPrice: 360_000, livingArea: 1900, soldDate: iso(22), lat: latAt(0.050009),
    });

    it('the same sale in BOTH payloads is counted once', async () => {
      const others = Array.from({ length: 4 }, (_, i) =>
        sale({ zpid: `U${i}`, soldPrice: 402_000 + i * 1_000, lat: latAt(0.1 + i * 0.05) }));
      const { run } = coldRun([inComps, ...others], [inAggregate, ...others, marker()]);

      const out = await run();
      expectUnionRan(out);
      if (!out.ok) return;

      // PRECONDITION: the union really did draw from both payloads, or a
      // deduped count of 5 is just the comps payload arriving alone.
      expect(out.comps.length, 'nothing came back').toBeGreaterThan(0);

      const fingerprint = (c: { comp: RawComp }) =>
        `${c.comp.soldPrice}|${c.comp.livingArea}|${c.comp.soldDate}`;
      const prints = out.comps.map(fingerprint);
      expect(
        new Set(prints).size,
        'the same sale appears twice in the kept set — the union overlaps by ' +
          'construction, so this is BUG-010 guaranteed rather than occasional',
      ).toBe(prints.length);

      // And exactly one of the twins survived — dropping both loses a real sale.
      const twins = out.comps.filter(
        (c) => c.comp.zpid === '81990022' || c.comp.zpid === '2075961815');
      expect(twins, 'both halves of the pair were dropped').toHaveLength(1);
    });

    it('the duplicate is NAMED, not silently absorbed', async () => {
      // The member sees the rejection table. A sale that vanishes without a
      // reason is indistinguishable from one we never found.
      const others = Array.from({ length: 3 }, (_, i) =>
        sale({ zpid: `N${i}`, soldPrice: 401_000 + i * 1_000, lat: latAt(0.12 + i * 0.03) }));
      const { run } = coldRun([inComps, ...others], [inAggregate, marker()]);
      const out = await run();
      expectUnionRan(out);
      if (!out.ok) return;
      expect(
        out.rejected.some((r) => r.reason === 'DUPLICATE_SALE'),
        'the union dropped a duplicate without naming it DUPLICATE_SALE',
      ).toBe(true);
    });

    it('two DISTINCT sales that merely share a price both survive the union', async () => {
      // The inverse, and the worse failure: a dedupe key loose enough to merge
      // across payloads deletes real comps, and nothing in the output says so.
      const a = sale({ zpid: 'D1', soldPrice: 400_000, soldDate: iso(20), lat: latAt(0.1) });
      const b = sale({ zpid: 'D2', soldPrice: 400_000, soldDate: iso(80), lat: latAt(0.4) });
      // TWO others, not three: with D1, D2, the marker and three fillers the
      // set is SIX against a cap of five, and D2 — furthest and oldest — is
      // capped out rather than merged away. My fixture, not a dedupe bug; the
      // case would have read as a false positive for an over-loose key.
      const others = Array.from({ length: 2 }, (_, i) =>
        sale({ zpid: `N${i}`, soldPrice: 401_000 + i * 1_000, lat: latAt(0.12 + i * 0.03) }));
      const { run } = coldRun([a, ...others], [b, marker()]);

      const out = await run();
      expectUnionRan(out);
      if (!out.ok) return;
      const ids = out.comps.map((c) => c.comp.zpid);
      expect(ids, 'a genuine sale was merged away across payloads').toContain('D1');
      expect(ids, 'a genuine sale was merged away across payloads').toContain('D2');
    });
  });

  // =========================================================================
  // 2 + 3. NO TRUSTED-SOURCE SHORTCUT, and no partial-data admission.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('aggregate-sourced sales face every gate identically', () => {
    /** Enough clean in-comps sales that the run succeeds regardless. */
    const filler = Array.from({ length: 4 }, (_, i) =>
      sale({ zpid: `F${i}`, soldPrice: 400_000 + i * 1_000, lat: latAt(0.1 + i * 0.05) }));

    it.each([
      ['NOT_SOLD', { zpid: 'X-STATUS', status: 'FOR_SALE' }],
      ['SQFT_MISSING', { zpid: 'X-SQFT', livingArea: null }],
      ['SQFT_OUT_OF_RANGE', { zpid: 'X-BAND', livingArea: 900 }],
      ['TYPE_MISMATCH', { zpid: 'X-TYPE', propertyType: 'CONDO' as const }],
      ['PRICE_MISSING', { zpid: 'X-PRICE', soldPrice: null }],
      ['STALE_SALE', { zpid: 'X-OLD', soldDate: iso(400) }],
      ['FUTURE_SOLD_DATE', { zpid: 'X-FUTURE', soldDate: iso(-5) }],
    ])('an AGGREGATE-sourced sale is rejected %s, with the reason stated', async (reason, over) => {
      // Asserting the REASON, not absence. A trusted-source shortcut that
      // dropped these some other way — or admitted them — would be invisible
      // in the rendered output either way, and "not in the kept set" is
      // satisfied by both correct and incorrect handling.
      const bad = sale(over as Partial<RawComp> & { zpid: string });
      const { run } = coldRun(filler, [bad, marker()]);

      const out = await run();
      expectUnionRan(out);
      expect(out.ok, `the run failed instead of rejecting ${reason}`).toBe(true);
      if (!out.ok) return;

      expect(
        out.comps.map((c) => c.comp.zpid),
        `an aggregate-sourced sale that should be ${reason} reached the member`,
      ).not.toContain(bad.zpid);

      const verdict = out.rejected.find((r) => r.comp.zpid === bad.zpid);
      expect(
        verdict,
        `${bad.zpid} vanished from the audit trail — it was neither kept nor ` +
          'rejected, so nothing proves the gates ran on it at all',
      ).toBeDefined();
      expect(verdict!.reason, `wrong reason for ${bad.zpid}`).toBe(reason);
    });

    it('a unioned comp that REACHES the kept set is enriched like any other', async () => {
      // Detail is batched from the kept addresses. A unioned comp that the
      // batch never asks about renders em-dashes forever while its neighbours
      // carry data — a quiet second-class citizen.
      const aggOnly = sale({
        zpid: 'AGG-KEEP', address: '55 Aggregate Way, Phoenix, AZ', lat: latAt(0.02),
      });
      const { spy, run } = coldRun(filler, [aggOnly], {
        noDetailSupport: false,
        detailItems: {
          '55 Aggregate Way, Phoenix, AZ': {
            zpid: 'AGG-KEEP', isValid: true, daysOnZillow: 19, yearBuilt: 1998,
            resoFacts: { parkingCapacity: 2 },
          },
        },
      });

      const out = await run();
      if (!out.ok) return;

      const kept = out.comps.find((c) => c.comp.zpid === 'AGG-KEEP');
      expect(kept, 'the aggregate-sourced comp never reached the kept set').toBeDefined();

      const batch = spy.calls.find((c) => c.method === 'fetchDetailBatch')?.addresses ?? [];
      expect(
        batch,
        'the detail batch skipped the unioned comp — it would render em-dashes ' +
          'forever while its neighbours carry data',
      ).toContain('55 Aggregate Way, Phoenix, AZ');
      expect(kept!.detail?.yearBuilt, 'the unioned comp was not enriched').toBe(1998);
    });
  });

  // =========================================================================
  // 4. THE LABEL — the one place this can start lying.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the truncation label is scoped to the rung that answered', () => {
    it('a 1-MILE rung backed by the exhausted aggregate payload is NOT truncated', async () => {
      // The new lie. `searchTruncated` describes the 3-mile comps SEARCH,
      // which was capped. Within a mile the union is now COMPLETE, because
      // the aggregate fetch exhausted its query. If the result comes from a
      // 1.0-mi rung, calling it truncated understates data we actually have —
      // and the member is told older sales exceeded the limit when they did
      // not.
      const inMile = Array.from({ length: 6 }, (_, i) =>
        sale({ zpid: `M${i}`, soldPrice: 400_000 + i * 1_000, soldDate: iso(10 + i * 3), lat: latAt(0.2) }));
      const { run } = coldRun([], [...inMile, marker()]);

      const out = await run();
      expectUnionRan(out);
      if (!out.ok) return;

      expect(out.radiusTierMi, 'the ladder did not stop inside a mile').toBe(1.0);
      expect(
        out.searchTruncated,
        'a result answered entirely from the EXHAUSTED 1-mile payload is labelled ' +
          'truncated — the member is told older sales exceeded the data limit ' +
          'when within a mile they did not',
      ).toBe(false);
    });

    it('a 3-MILE rung is STILL truncated — the union does not launder the outer region', async () => {
      // The control, and the direction that matters more. The union completes
      // one mile; it says nothing about the two beyond it. A build that
      // cleared the flag whenever the aggregate payload was present would pass
      // the case above and start lying here.
      // A capped 3-mile comps payload (at the limit, so the truncation
      // predicate fires) with an EMPTY aggregate payload — nothing inside a
      // mile to complete anything.
      const bulk = Array.from({ length: 500 }, (_, i) =>
        sale({ zpid: `B${i}`, soldDate: iso(5 + (i % 20)), lat: latAt(2.2), soldPrice: 400_000 + i }));
      const { run } = coldRun(bulk, []);

      const out = await run();
      if (!out.ok) return;
      expect(
        out.searchTruncated,
        'a capped 3-mile search was cleared of its truncation flag — the union ' +
          'completes ONE mile and says nothing about the two beyond it',
      ).toBe(true);
    });
  });

  // =========================================================================
  // 5. THE VERSION — recompute, and the floor must NOT move.
  // =========================================================================
  describe('the union bump RECOMPUTES; the refetch floor stays put', () => {
    it('the refetch floor must NOT move with the bump', () => {
      // THE TRAP, and it is assertable today. If the floor tracks
      // ALGO_VERSION automatically, this bump silently re-bills every cached
      // row — the exact one-time cost §14.17 accepted for POISONED raw,
      // charged again for raw that is perfectly sound. The 40-cap generation
      // is the only poisoned one.
      expect(
        RAW_REFETCH_BELOW_VERSION,
        'the floor moved with the version bump. Raw fetched under §14.17 is ' +
          'sound and must not re-bill on every future algorithm change.',
      ).toBe(4);
      expect(ALGO_VERSION, 'the version went BELOW the floor — every row refetches forever')
        .toBeGreaterThanOrEqual(RAW_REFETCH_BELOW_VERSION);
    });

    it.skipIf(ALGO_VERSION <= RAW_REFETCH_BELOW_VERSION)(
      'a stale-but-sound row recomputes the union with ZERO provider calls',
      async () => {
        // GATED ON THE BUMP, because until ALGO_VERSION exceeds the floor there
        // is no such row: at 4/4 every cached row is either current (served
        // as-is) or below the floor (refetched). That is the dormant path I
        // recorded in cache.test.ts, and the union is exactly what makes it
        // live again — so this case turns itself on when the bump lands.
        const rows = new Map<string, CachedComps>();
        rows.set(KEY, {
          cacheKey: KEY, normalizedAddress: normalizeAddress(ADDRESS),
          rawSubject: SUBJECT as never,
          rawComps: Array.from({ length: 5 }, (_, i) =>
            sale({ zpid: `R${i}`, soldPrice: 400_000 + i * 1_000 })) as never,
          rawNeighborhood: Array.from({ length: 3 }, (_, i) =>
            sale({ zpid: `A${i}`, soldPrice: 410_000 + i * 1_000, lat: latAt(0.15) })) as never,
          result: null,
          algoVersion: RAW_REFETCH_BELOW_VERSION, // stale by version, sound by regime
          provider: 'stub',
          expiresAt: expires,
        } as CachedComps);
        const cache: CompsCacheLike = {
          async get(k) { return rows.get(k) ?? null; },
          async set(e) { rows.set(e.cacheKey, e); },
        };
        const spy = makeProviderSpy({
          subject: SUBJECT, comps: [], noDetailSupport: true, noNeighborhoodSupport: true,
        });

        const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
        expect(out.ok, 'the recompute produced no result').toBe(true);
        expect(
          spy.compsCalls + spy.subjectCalls,
          'the union bump refetched — both raw payloads are already on the row ' +
            'and sound, so this must be a free re-derivation',
        ).toBe(0);
      },
    );
  });

  describe.skipIf(pendingSlice(...MODS))('the union only ever ADDS', () => {
    it('never returns more than the display cap', async () => {
      const many = Array.from({ length: 30 }, (_, i) =>
        sale({ zpid: `P${i}`, soldPrice: 400_000 + i * 500, lat: latAt(0.1 + i * 0.01) }));
      const { spy, run } = coldRun(many.slice(0, 15), many.slice(15));
      const out = await run();
      if (!out.ok) return;
      expect(out.comps.length).toBeLessThanOrEqual(MAX_COMPS_KEPT);
    });
  });
  // =========================================================================
  // SIERRA VISTA — verifying the headline claim WITHOUT relying on the run
  // that produced it.
  // =========================================================================
  describe('the Sierra Vista result is structurally impossible without the union', () => {
    const FIX = resolve(
      dirname(fileURLToPath(import.meta.url)), '..', '..',
      'src', 'features', 'comps', '__fixtures__',
    );
    const COMPS_PAYLOAD = JSON.parse(
      readFileSync(resolve(FIX, 'spike-comps-3mi-doz12.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;

    const soldDates = () => COMPS_PAYLOAD
      .map((i) => (i.hdpData as { homeInfo?: { dateSold?: number } })?.homeInfo?.dateSold)
      .filter((d): d is number => typeof d === 'number' && d > 0)
      .map((ms) => new Date(ms).toISOString().slice(0, 10));

    it('WHAT I COULD NOT VERIFY, recorded as a limit rather than glossed', () => {
      // MASON reports the union moves Sierra Vista from a 3-mile rung to
      // 1mi/6mo, keeping 611 E Encanto (0.14 mi) and 2044 S Forest — "the
      // exact two displaced March sales the audit named".
      //
      // Neither address appears in ANY recorded fixture. The claim comes from
      // a live run, and the 1-mile aggregate payload that would contain those
      // sales was never recorded. So the specific observation is not
      // checkable offline, and I am not going to bill the client's Apify
      // quota to re-derive an anecdote.
      //
      // It is worth being precise about WHY this one matters more than the
      // Don Frank case did: the audit that predicted this result and the run
      // that confirmed it are both MASON's. That is a closed loop — not
      // dishonest, but not independent either, and it is exactly the kind of
      // evidence that feels strongest while proving least.
      //
      // What follows is the part of the claim that recorded data CAN settle.
      const named = COMPS_PAYLOAD.filter((i) =>
        /Encanto|Forest/i.test(String(i.address ?? '')));
      expect(
        named,
        'the named sales are now IN a recorded fixture — if a Sierra aggregate ' +
          'payload has been recorded, this case should be replaced by a direct ' +
          'check of the two addresses and their distances',
      ).toHaveLength(0);
    });

    it('the comps payload FLOOR is Apr-22 and holds ZERO March sales', () => {
      // The audit's premise, checked against the recording rather than taken
      // from the report. This is the Sierra cached comps row: 3 mi, doz=12m,
      // 499 items — and the 500-cap still bites, so its oldest sale is
      // 2026-04-22 rather than a year back.
      const dates = soldDates();
      expect(dates.length, 'the recording no longer parses').toBeGreaterThan(400);

      const floor = dates.slice().sort()[0];
      expect(floor, 'the recorded floor moved off Apr-22').toBe('2026-04-22');
      expect(
        dates.filter((d) => d.startsWith('2026-03')),
        'the comps payload now CONTAINS March sales — the inference below ' +
          'collapses, because a March comp could then arrive without the union',
      ).toHaveLength(0);
    });

    it('THEREFORE a March comp in the kept set can ONLY have come from the union', () => {
      // The inference the recorded data does support, and it is the load
      // -bearing half of MASON's claim even though it says nothing about the
      // two specific addresses.
      //
      // The comps fetch physically cannot return a March sale — its floor is
      // Apr-22, capped. So if the post-union kept set contains one, it entered
      // through the unioned 1-mile aggregate payload. There is no third
      // source. His result is therefore consistent with the recording AND
      // unreachable without the union, which is as far as offline evidence
      // goes and further than "his run says so".
      const dates = soldDates();
      const floorMs = Date.parse(dates.slice().sort()[0]);
      const marchMs = Date.parse('2026-03-31');
      expect(
        marchMs,
        'a March sale is no longer below the comps-payload floor',
      ).toBeLessThan(floorMs);

      // And the union path is live — proven here by the same marker the rest
      // of this file uses, so the inference rests on a demonstrated mechanism
      // rather than on the absence of an alternative.
      return (async () => {
        // THREE recent fillers, not four. With four, the top rung already had
        // five (filler + marker) and the ladder never descended to where a
        // 150-day sale is eligible — the case failed on my fixture rather than
        // on the build. Starve the 3-month rung so the 6-month one is the only
        // way to a full set, which is precisely Sierra Vista's shape.
        const filler = Array.from({ length: 3 }, (_, i) =>
          sale({ zpid: `SV${i}`, soldPrice: 400_000 + i * 1_000, lat: latAt(0.2) }));
        const older = sale({
          zpid: 'MARCH-SALE', address: '611 E Encanto Dr, Tempe, AZ',
          soldDate: iso(150), lat: latAt(0.14), soldPrice: 395_000,
        });
        const { run } = coldRun(filler, [older, marker()]);
        const out = await run();
        expectUnionRan(out);
        if (!out.ok) return;
        expect(
          out.comps.map((c) => c.comp.zpid),
          'a sale older than the comps floor did not survive the union into the ' +
            'kept set — the mechanism the Sierra result depends on is not working',
        ).toContain('MARCH-SALE');
        expect(out.recencyTierMonths, 'a 150-day sale should need the 6-month rung').toBe(6);
      })();
    });
  });

});
