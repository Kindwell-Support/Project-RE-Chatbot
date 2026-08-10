/**
 * PER-COMP DETAIL ENRICHMENT — CONTRACT §14.14. Written BEFORE the build,
 * from the contract and the two recorded spike payloads, so the guarantees
 * are pinned by evidence rather than by whatever the adapter happens to do.
 *
 * THE NEW SURFACE, and why it is the dangerous one. Every failure this module
 * has handled so far was total: the provider worked or it didn't, and the
 * member got comps or an honest refusal. Detail enrichment is the first
 * PARTIAL failure surface in the feature — a comp can have perfect search
 * data and a failed detail lookup, and the correct outcome is neither
 * "success" nor "failure" but a comp that renders em-dashes on three columns
 * and counts fully everywhere else.
 *
 * THE JOIN IS THE OTHER ONE, and it is worse because it is invisible. The
 * batch returns items OUT of input order — recorded, 1,2,3,4,5 back as
 * 1,4,5,2,3. An adapter that matches by index produces five comps wearing
 * each other's year built and parking counts. Every field is populated, every
 * number is real, nothing is null, no error is raised, and the table is
 * simply wrong about which house is which. §14.14 rule 1 calls index-matching
 * a bug "regardless of passing tests", so the fixture below is deliberately
 * shuffled and the assertions are per-address, never per-position.
 *
 * COST. §14.14 rule 6 pins 3 actor runs per lookup (subject + search + ONE
 * batched detail). Rule 2 says the batch is bounded by MAX_COMPS_KEPT and
 * runs AFTER ranking and dedupe — get that wrong and it is ~40 runs. These
 * are asserted by provider CALL COUNT, never by timing, because the client's
 * Apify quota is what is actually at stake.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { MAX_COMPS_KEPT, PROVIDER_TIMEOUT_MS } from '../../src/features/comps/config.js';
import { mapDetailBatchItems } from '../../src/features/comps/providers/apifyZillow.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { runComps } from '../../src/features/comps/service.js';
import { golden01 } from '../fixtures/golden/index.js';
import type { CompDetail } from '../../src/features/comps/types.js';
import { attachDetails } from '../../src/features/comps/detail.js';
import type { ScoredComp } from '../../src/features/comps/types.js';

const MODS = ['detail', 'cache/detailCache'] as const;

/**
 * A ScoredComp carrying only what the join reads: the address (the key) and
 * the zpid (the cache key). Everything else is filler — asserting on scoring
 * here would couple this file to rank.test.ts's subject.
 */
function comp(address: string, zpid: string): ScoredComp {
  return {
    comp: {
      zpid, address, status: 'SOLD', soldPrice: 400000, soldDate: '2026-06-01',
      beds: 3, baths: 2, livingArea: 2000, lotSize: 6000,
      propertyType: 'SFR', lat: 33.4, lng: -112.0, detailUrl: null,
    },
    distanceMi: 0.1, monthsAgo: 2, pricePerSqft: 200, score: 10,
    parts: { distance: 3, sqft: 2, recency: 3, bedbath: 1, lot: 1 },
  };
}

/** The join, expressed as address -> detail, so assertions read per-property. */
const joinByAddress = (
  comps: ScoredComp[],
  raw: RawDetailItem[],
  cached: Record<string, ReturnType<typeof mapDetailBatchItems>[number]['detail']> = {},
) => {
  const out = attachDetails(comps, cached as never, mapDetailBatchItems(raw as never));
  return {
    ...out,
    detailFor: (address: string) =>
      out.comps.find((c) => c.comp.address === address)?.detail,
  };
};

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '..', 'src', 'features', 'comps', '__fixtures__');

interface RawDetailItem {
  addressOrUrlFromInput: string;
  zpid: number | null;
  isValid: boolean;
  invalidReason: string | null;
  daysOnZillow: number | null;
  yearBuilt: number | null;
  resoFacts?: { parkingCapacity?: number | null; architecturalStyle?: string | null } | null;
  parking?: { totalSpaces?: number | null } | null;
}

const loadFixture = (name: string): RawDetailItem[] =>
  JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as RawDetailItem[];

const BATCH5 = loadFixture('spike-detail-batch5.json');
const MIXED = loadFixture('spike-detail-batch-mixed.json');

describe(`per-comp detail enrichment${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // The recorded evidence itself. If the fixtures ever stop showing what
  // §14.14 was written from, every rule below loses its ground and the
  // failure should say so HERE rather than as a confusing miss downstream.
  // =========================================================================
  describe('the recorded spike still says what the contract claims it says', () => {
    it('the batch fixture carries five valid items, each with a join key', () => {
      expect(BATCH5).toHaveLength(5);
      for (const item of BATCH5) {
        expect(typeof item.addressOrUrlFromInput, 'an item has no join key').toBe('string');
        expect(item.addressOrUrlFromInput.length).toBeGreaterThan(0);
        expect(item.isValid).toBe(true);
      }
      // Join keys are UNIQUE — the whole join depends on it.
      expect(new Set(BATCH5.map((i) => i.addressOrUrlFromInput)).size).toBe(5);
    });

    it('daysOnZillow is a REAL value here, not the search payload -1 sentinel', () => {
      // §14.6 recorded daysOnZillow as -1 on 73/73 SEARCH comps — a sentinel,
      // not a value, and the reason DOM was originally "not buildable". The
      // DETAIL payload is where the real number lives, and that difference is
      // the entire justification for the extra actor run.
      const dom = BATCH5.map((i) => i.daysOnZillow);
      expect(dom, 'the -1 sentinel reached the detail fixture').not.toContain(-1);
      for (const d of dom) {
        expect(typeof d, 'a detail item has no daysOnZillow').toBe('number');
        expect(d as number).toBeGreaterThanOrEqual(0);
      }
    });

    it('the mixed fixture proves per-item failure: one invalid, the rest intact', () => {
      // The evidence behind rule 3. Without this shape, "partial failure is
      // non-fatal" would be an aspiration rather than a property of the actor.
      expect(MIXED).toHaveLength(3);
      const bad = MIXED.filter((i) => !i.isValid);
      const good = MIXED.filter((i) => i.isValid);
      expect(bad, 'the mixed fixture has no invalid item to test with').toHaveLength(1);
      expect(good, 'the good items did not survive alongside it').toHaveLength(2);
      expect(bad[0].invalidReason, 'the invalid item carries no reason').toBeTruthy();
      // The key is ABSENT on an invalid item, not present-and-null. Worth
      // pinning precisely: `?? null` and `=== null` behave differently here,
      // and the mapper has to tolerate the absent shape the actor really sends.
      expect(bad[0].zpid ?? null, 'an invalid item carries a zpid').toBeNull();
      for (const g of good) {
        expect(g.zpid, 'a good item lost its zpid to its neighbour failing').toBeTruthy();
        expect(g.daysOnZillow).not.toBeNull();
      }
    });

    it('parking has TWO sources and they agree in the recording', () => {
      // §14.14 / types.ts: resoFacts.parkingCapacity, falling back to
      // parking.totalSpaces. Recorded so a future payload where they DISAGREE
      // is a visible change rather than a silent preference.
      for (const item of BATCH5) {
        const primary = item.resoFacts?.parkingCapacity ?? null;
        const fallback = item.parking?.totalSpaces ?? null;
        if (primary !== null && fallback !== null) {
          expect(
            primary,
            `${item.addressOrUrlFromInput}: parking sources disagree — the ` +
              'fallback order now changes the rendered number',
          ).toBe(fallback);
        }
      }
      // ...and at least one is present, or the field is untestable.
      const withParking = BATCH5.filter(
        (i) => (i.resoFacts?.parkingCapacity ?? i.parking?.totalSpaces ?? null) !== null,
      );
      expect(withParking.length, 'no item carries parking at all').toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // RULE 1 — the join. THE most important case in this file.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the join is BY KEY, never by position', () => {
    it('an OUT-OF-ORDER batch maps every field to the right comp', () => {
      // The recorded reordering, reproduced exactly: input 1,2,3,4,5 returns
      // as 1,4,5,2,3. Under an index join, comps 2/3/4/5 silently swap their
      // year built and parking — and the output looks perfect.
      const comps = BATCH5.map((i, n) => comp(i.addressOrUrlFromInput, `Z${n}`));
      const returned = [BATCH5[0], BATCH5[3], BATCH5[4], BATCH5[1], BATCH5[2]];

      // PRECONDITION: the fixture is genuinely shuffled. If input and returned
      // order ever coincide, an index join passes this test and the case
      // silently stops discriminating.
      expect(
        returned.map((i) => i.addressOrUrlFromInput),
        'the fixture is no longer out of order — this case cannot catch an index join',
      ).not.toEqual(comps.map((c) => c.comp.address));

      const { detailFor, missing } = joinByAddress(comps, returned);
      expect(missing, 'a comp went unjoined in a fully-valid batch').toBe(0);

      for (const source of BATCH5) {
        const got = detailFor(source.addressOrUrlFromInput);
        expect(got, `no detail joined for ${source.addressOrUrlFromInput}`).toBeDefined();
        expect(
          got!.yearBuilt,
          `${source.addressOrUrlFromInput} got another property's yearBuilt — ` +
            'this is the index-join bug, and nothing about it looks broken downstream',
        ).toBe(source.yearBuilt);
        expect(got!.daysOnMarket, `${source.addressOrUrlFromInput}: wrong DOM`)
          .toBe(source.daysOnZillow);
        expect(got!.parkingSpaces, `${source.addressOrUrlFromInput}: wrong parking`)
          .toBe(source.resoFacts?.parkingCapacity ?? source.parking?.totalSpaces ?? null);
      }
    });

    it('an item the batch never returned joins to NOTHING, not to a neighbour', () => {
      // The silent-shift failure: drop one item and an index join slides every
      // later comp up by one. Every comp still gets detail; four of them get
      // the wrong detail.
      const comps = BATCH5.map((i, n) => comp(i.addressOrUrlFromInput, `Z${n}`));
      const returned = BATCH5.filter((_, idx) => idx !== 1); // the actor dropped #2

      const { detailFor, missing } = joinByAddress(comps, returned);

      expect(
        detailFor(BATCH5[1].addressOrUrlFromInput),
        'a comp with no returned item was given a neighbour detail',
      ).toBeUndefined();
      expect(missing, 'the unjoined comp was not counted as missing').toBe(1);
      // ...and every OTHER comp still got its own, not a shifted one.
      for (const source of BATCH5.filter((_, idx) => idx !== 1)) {
        expect(detailFor(source.addressOrUrlFromInput)?.yearBuilt).toBe(source.yearBuilt);
      }
    });

    it('an item returned for an address nobody asked for is ignored', () => {
      // Defensive: the actor echoing an unexpected key must not create a comp
      // or overwrite one. Failure direction is "no detail", never "wrong comp".
      const comps = [comp(BATCH5[0].addressOrUrlFromInput, 'Z0')];
      const returned = [
        { ...BATCH5[1], addressOrUrlFromInput: '999 Nobody Asked Ln, Phoenix, AZ' },
        BATCH5[0],
      ];

      const { detailFor, comps: out } = joinByAddress(comps, returned);
      expect(out, 'an unrequested item created a comp').toHaveLength(1);
      expect(
        detailFor(BATCH5[0].addressOrUrlFromInput)!.yearBuilt,
        'the unrequested item overwrote the real one',
      ).toBe(BATCH5[0].yearBuilt);
    });

    it('a re-formatted echo still joins — without ever crossing properties', () => {
      // The join tolerates §5.1 normalization on both sides, which is right:
      // an actor that changes "St," to "Street" should not cost the member
      // their detail. The risk it introduces is the one worth pinning — five
      // distinct comps must still land on five distinct details.
      const comps = BATCH5.map((i, n) => comp(i.addressOrUrlFromInput, `Z${n}`));
      const reformatted = BATCH5.map((i) => ({
        ...i,
        addressOrUrlFromInput: i.addressOrUrlFromInput.toUpperCase().replace(/,/g, ' '),
      }));

      const { detailFor, missing } = joinByAddress(comps, reformatted);
      expect(missing, 'a re-formatted echo lost its comp entirely').toBe(0);
      for (const source of BATCH5) {
        expect(
          detailFor(source.addressOrUrlFromInput)!.yearBuilt,
          `${source.addressOrUrlFromInput}: normalization crossed two properties`,
        ).toBe(source.yearBuilt);
      }
    });

    it('THE CACHE WINS, and it is keyed by the COMP zpid', () => {
      // Precedence rule 1. A cached detail must pre-empt the batch — that is
      // the cost lever — and it must be looked up by the comp's OWN zpid, not
      // the batch item's, which can differ (BUG-010: one sale, two zpids).
      const comps = [comp(BATCH5[0].addressOrUrlFromInput, 'CACHED-ZPID')];
      const cached = {
        'CACHED-ZPID': {
          daysOnMarket: 7, parkingSpaces: 1, yearBuilt: 1899,
          architecturalStyle: null, propertyCondition: null,
        },
      };
      const out = attachDetails(comps, cached as never, mapDetailBatchItems(BATCH5 as never));
      const got = out.comps[0].detail;

      expect(got!.yearBuilt, 'the batch overwrote a cached detail').toBe(1899);
      expect(
        out.fetched,
        'a cache HIT was written back to the cache — that is a pointless write ' +
          'and it re-stamps the TTL of an entry nobody refreshed',
      ).toHaveLength(0);
    });

    it('the cache-write set is keyed by the COMP zpid, not the batch item zpid', () => {
      // The BUG-010 lesson applied to caching: the batch item can carry a
      // different zpid for the same sale. Writing the item's zpid would store
      // a key no future lookup ever probes — a cache that silently never hits.
      const comps = [comp(BATCH5[0].addressOrUrlFromInput, 'COMP-ZPID')];
      const out = attachDetails(comps, {}, mapDetailBatchItems([BATCH5[0]] as never));

      expect(out.fetched, 'nothing was queued for the cache').toHaveLength(1);
      expect(
        out.fetched[0].zpid,
        'the cache key is the BATCH item zpid — future lookups probe the comp zpid ' +
          'and will never hit it',
      ).toBe('COMP-ZPID');
      expect(String(out.fetched[0].zpid)).not.toBe(String(BATCH5[0].zpid));
    });
  });

  // =========================================================================
  // RULE 3 — partial failure. The new surface.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('a failed detail item is non-fatal', () => {
    it('an invalid item yields NO detail while its neighbours keep theirs', () => {
      const comps = MIXED.map((i, n) => comp(i.addressOrUrlFromInput, `M${n}`));
      const { detailFor, missing } = joinByAddress(comps, MIXED);

      const bad = MIXED.find((i) => !i.isValid)!;
      const good = MIXED.filter((i) => i.isValid);

      // PRECONDITION — the good items must actually have joined, or "the bad
      // one is absent" is true of a join that returned nothing at all.
      for (const g of good) {
        expect(
          detailFor(g.addressOrUrlFromInput)?.yearBuilt,
          `${g.addressOrUrlFromInput} lost its detail because a SIBLING failed`,
        ).toBe(g.yearBuilt);
      }

      const badDetail = detailFor(bad.addressOrUrlFromInput);
      if (badDetail !== undefined) {
        // Present-but-empty is an acceptable shape; present-with-values is not.
        expect(badDetail.daysOnMarket, 'an INVALID item produced a DOM').toBeNull();
        expect(badDetail.yearBuilt, 'an INVALID item produced a yearBuilt').toBeNull();
        expect(badDetail.parkingSpaces, 'an INVALID item produced parking').toBeNull();
      }
      expect(missing, 'the failed item was not counted as missing').toBe(1);
    });

    it('a FAILED item is never queued for the cache', () => {
      // Caching a failure with the detail TTL — which is deliberately LONG,
      // because property facts barely change — would pin the em-dashes in
      // place for every future lookup of that comp. A transient actor miss
      // must not become a durable one.
      const comps = MIXED.map((i, n) => comp(i.addressOrUrlFromInput, `M${n}`));
      const out = attachDetails(comps, {}, mapDetailBatchItems(MIXED as never));
      const bad = MIXED.find((i) => !i.isValid)!;
      const badIndex = MIXED.indexOf(bad);

      expect(out.fetched.length, 'nothing was queued at all').toBeGreaterThan(0);
      expect(
        out.fetched.map((f) => f.zpid),
        'a FAILED lookup was written to the long-TTL cache',
      ).not.toContain(`M${badIndex}`);
    });

    it('an item valid but missing a single field nulls THAT field only', () => {
      // Partial-within-partial. A detail payload with no parkingCapacity and
      // no parking.totalSpaces must null parking and keep DOM and yearBuilt —
      // otherwise one absent column costs the member two good ones.
      const sparse = {
        ...BATCH5[0],
        resoFacts: { ...(BATCH5[0].resoFacts ?? {}), parkingCapacity: null },
        parking: null,
      };
      const got = joinByAddress([comp(sparse.addressOrUrlFromInput, 'S0')], [sparse])
        .detailFor(sparse.addressOrUrlFromInput);

      expect(got, 'a sparse item did not join at all').toBeDefined();
      expect(got!.parkingSpaces, 'the missing field did not null').toBeNull();
      expect(got!.daysOnMarket, 'a present field was nulled alongside the absent one')
        .toBe(BATCH5[0].daysOnZillow);
      expect(got!.yearBuilt).toBe(BATCH5[0].yearBuilt);
    });

    it('parking ZERO is a value, not an absence', () => {
      // types.ts says so explicitly, and it is the classic falsy bug: `||`
      // instead of `??` turns "no parking spaces" into "we don't know", which
      // is a materially different thing to tell someone buying a rental.
      const noParking = {
        ...BATCH5[0],
        resoFacts: { ...(BATCH5[0].resoFacts ?? {}), parkingCapacity: 0 },
        parking: { totalSpaces: 0 },
      };
      expect(
        joinByAddress([comp(noParking.addressOrUrlFromInput, 'P0')], [noParking])
          .detailFor(noParking.addressOrUrlFromInput)!.parkingSpaces,
        'zero parking spaces was treated as unknown',
      ).toBe(0);
    });

    it('a ZERO from the FALLBACK source is also a value', () => {
      // The same falsy trap one level down: `resoFacts.parkingCapacity ??
      // parking.totalSpaces` is correct, but written with `||` the primary's
      // legitimate 0 silently defers to the fallback.
      const zeroPrimary = {
        ...BATCH5[0],
        resoFacts: { ...(BATCH5[0].resoFacts ?? {}), parkingCapacity: 0 },
        parking: { totalSpaces: 4 },
      };
      expect(
        joinByAddress([comp(zeroPrimary.addressOrUrlFromInput, 'P1')], [zeroPrimary])
          .detailFor(zeroPrimary.addressOrUrlFromInput)!.parkingSpaces,
        'a primary value of 0 fell through to the fallback',
      ).toBe(0);
    });

    it('parking falls back to parking.totalSpaces when resoFacts has none', () => {
      const fallbackOnly = {
        ...BATCH5[0],
        resoFacts: { ...(BATCH5[0].resoFacts ?? {}), parkingCapacity: null },
        parking: { totalSpaces: 3 },
      };
      expect(
        joinByAddress([comp(fallbackOnly.addressOrUrlFromInput, 'P2')], [fallbackOnly])
          .detailFor(fallbackOnly.addressOrUrlFromInput)!.parkingSpaces,
      ).toBe(3);
    });

    it('the -1 DOM sentinel is nulled, never rendered as a number', () => {
      // If a search-shaped payload ever reaches the detail path, "-1 days on
      // market" is worse than no answer: it is a confident wrong fact.
      const sentinel = { ...BATCH5[0], daysOnZillow: -1 };
      expect(
        joinByAddress([comp(sentinel.addressOrUrlFromInput, 'D0')], [sentinel])
          .detailFor(sentinel.addressOrUrlFromInput)!.daysOnMarket,
        'the -1 sentinel was carried through as a real DOM',
      ).toBeNull();
      // ...but a genuine 0 (listed and sold same day) survives.
      const sameDay = { ...BATCH5[0], daysOnZillow: 0 };
      expect(
        joinByAddress([comp(sameDay.addressOrUrlFromInput, 'D1')], [sameDay])
          .detailFor(sameDay.addressOrUrlFromInput)!.daysOnMarket,
        'a same-day sale was treated as the sentinel',
      ).toBe(0);
    });

    it('an item with NO join key is dropped, never attached by position', () => {
      // §14.14 rule 1 taken to its conclusion: an unjoinable item is useless,
      // and the only way to "use" it is positionally, which is the banned bug.
      const keyless = { ...BATCH5[1], addressOrUrlFromInput: '' };
      const comps = [comp(BATCH5[0].addressOrUrlFromInput, 'K0')];
      const { detailFor } = joinByAddress(comps, [keyless, BATCH5[0]]);
      expect(
        detailFor(BATCH5[0].addressOrUrlFromInput)!.yearBuilt,
        'a keyless item was attached to the first comp by position',
      ).toBe(BATCH5[0].yearBuilt);
    });
  });

  // =========================================================================
  // RULE 2 + 6 — cost, measured in provider CALLS.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the join scales with the CAP, not with the pool', () => {
    it('joining never enriches more comps than it was handed', () => {
      // Rule 2's observable half at this layer: `attachDetails` is a pure
      // join, so it can only ever enrich the comps given to it. The service
      // is what must hand it the post-rank set; that is asserted end-to-end
      // in the service suite by PROVIDER CALL COUNT (3 runs per lookup, never
      // ~40), which is the assertion the client's quota actually rides on.
      const comps = BATCH5.slice(0, 3).map((i, n) => comp(i.addressOrUrlFromInput, `Z${n}`));
      const out = attachDetails(comps, {}, mapDetailBatchItems(BATCH5 as never));
      expect(out.comps, 'the join invented comps from spare batch items').toHaveLength(3);
      expect(out.fetched.length, 'more details were cached than there were comps')
        .toBeLessThanOrEqual(3);
    });

    it('MAX_COMPS_KEPT is what bounds a full batch — asserted as a relationship', () => {
      // "≤ 5" and "≤ MAX_COMPS_KEPT" are the same assertion today and diverge
      // the moment the cap moves. §14.14 rule 2 pins the RELATIONSHIP, so a
      // literal 5 here would go quiet exactly when the cap changed.
      const comps = BATCH5.map((i, n) => comp(i.addressOrUrlFromInput, `Z${n}`));
      expect(comps.length, 'the recorded batch no longer matches the cap')
        .toBeLessThanOrEqual(MAX_COMPS_KEPT);
      const out = attachDetails(comps, {}, mapDetailBatchItems(BATCH5 as never));
      expect(out.fetched.length).toBeLessThanOrEqual(MAX_COMPS_KEPT);
    });
  });
  // =========================================================================
  // RULES 4, 5, 6 — the cost surface, measured end-to-end by PROVIDER CALL
  // COUNT. Never by timing: the client's Apify quota is what is at stake, and
  // a timing assertion would be flaky about the one thing that costs money.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('cost: three actor runs per lookup, never forty', () => {
    const ADDRESS = '123 Main St, Seattle WA';
    const SUBJECT = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
    const FRESH = golden01.comps.map((c, i) => ({
      ...c,
      soldDate: new Date(Date.now() - (20 + i * 5) * 86_400_000).toISOString().slice(0, 10),
    }));

    /** Detail items keyed by the addresses the kept comps will carry. */
    const detailBank = () =>
      Object.fromEntries(
        golden01.comps.map((c, i) => [
          c.address,
          {
            zpid: `D${i}`, isValid: true, daysOnZillow: 20 + i, yearBuilt: 1990 + i,
            resoFacts: { parkingCapacity: 2 },
          },
        ]),
      );

    function memoryDetailCache(seed: Record<string, CompDetail> = {}) {
      const store: Record<string, CompDetail> = { ...seed };
      let reads = 0;
      let writes = 0;
      return {
        get reads() { return reads; },
        get writes() { return writes; },
        get size() { return Object.keys(store).length; },
        cache: {
          async getMany(zpids: string[]) {
            reads += 1;
            return Object.fromEntries(
              zpids.filter((z) => store[z] !== undefined).map((z) => [z, store[z]]),
            );
          },
          async setMany(entries: Array<{ zpid: string; detail: CompDetail }>) {
            writes += 1;
            for (const e of entries) store[e.zpid] = e.detail;
          },
        },
      };
    }

    it('a cold lookup costs exactly THREE runs: subject + search + ONE batched detail', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const out = await runComps(ADDRESS, { provider: spy.provider as never });

      expect(out.ok, 'the lookup failed — a failed run proves nothing about cost').toBe(true);
      expect(spy.subjectCalls, 'subject lookups').toBe(1);
      expect(spy.compsCalls, 'search runs').toBe(1);
      expect(
        spy.detailCalls,
        `${spy.detailCalls} detail runs — §14.14 rule 6 pins ONE batched run. ` +
          'Per-comp runs are the ~40-runs-per-lookup failure.',
      ).toBe(1);
      expect(spy.callCount, 'total actor runs per lookup').toBe(3);
    });

    it('the ONE detail run carries the FINAL kept set, not the fetched pool', async () => {
      // Rule 2, observed at the seam that spends money. The pool here is
      // golden01's eight comps; the kept-and-ranked set is five.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const out = await runComps(ADDRESS, { provider: spy.provider as never });
      if (!out.ok) throw new Error('lookup failed');

      const batch = spy.calls.find((c) => c.method === 'fetchDetailBatch')?.addresses ?? [];
      expect(batch.length, 'the batch is empty').toBeGreaterThan(0);
      expect(
        batch.length,
        `the batch carried ${batch.length} addresses against a pool of ${FRESH.length} — ` +
          'detail is running before ranking',
      ).toBeLessThanOrEqual(MAX_COMPS_KEPT);
      expect(batch.length, 'the batch does not match the kept set').toBe(out.comps.length);
      // ...and they are the SAME addresses, not merely the same count.
      expect([...batch].sort()).toEqual(out.comps.map((c) => c.comp.address).sort());
    });

    it('a WARM detail cache means ZERO detail runs — the main cost lever', async () => {
      // Rule 4. Property facts barely change and nearby lookups share comps,
      // so this is where the quota is actually saved. A detail cache that is
      // written but never read would look identical in every other test.
      const first = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const dc = memoryDetailCache();

      const cold = await runComps(ADDRESS, {
        provider: first.provider as never, detailCache: dc.cache as never,
      });
      expect(cold.ok).toBe(true);
      expect(first.detailCalls, 'PRECONDITION: the cold run never fetched detail').toBe(1);
      expect(dc.writes, 'the cold run cached nothing — nothing to hit later').toBeGreaterThan(0);
      expect(dc.size, 'the cache is empty after a successful enrich').toBeGreaterThan(0);

      // Second lookup, fresh provider (so counts are unambiguous), same cache.
      const second = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const warm = await runComps(ADDRESS, {
        provider: second.provider as never, detailCache: dc.cache as never,
      });
      expect(warm.ok).toBe(true);
      expect(
        second.detailCalls,
        'a warm detail cache still re-billed the detail actor — rule 4 buys nothing',
      ).toBe(0);

      // And the details actually SURVIVED the round trip rather than the run
      // simply skipping enrichment.
      if (warm.ok) {
        const enriched = warm.comps.filter((c) => c.detail !== undefined);
        expect(enriched.length, 'the warm run served no detail at all').toBe(warm.comps.length);
        expect(typeof enriched[0].detail!.yearBuilt).toBe('number');
      }
    });

    it('a detail failure renders comps WITHOUT detail — never a failed lookup', async () => {
      // Rule 3 at the whole-run level. Enrichment is decoration; a decoration
      // that can fail the thing it decorates is worse than no decoration.
      const spy = makeProviderSpy({
        subject: SUBJECT, comps: FRESH, failDetail: { kind: 'timeout' },
      });
      const out = await runComps(ADDRESS, { provider: spy.provider as never });

      expect(out.ok, 'a DETAIL failure failed the whole comps run').toBe(true);
      if (out.ok) {
        expect(out.comps.length, 'the comps themselves were lost').toBeGreaterThanOrEqual(3);
        for (const c of out.comps) {
          expect(c.detail, 'a failed detail batch still attached detail').toBeUndefined();
        }
      }
    });

    it('a provider with no detail support at all still returns comps', async () => {
      // The stub provider, and any deployment that predates the slice.
      // `fetchDetailBatch` is optional on the interface, so absence must be a
      // no-op rather than a crash.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: FRESH, noDetailSupport: true });
      const out = await runComps(ADDRESS, { provider: spy.provider as never });
      expect(out.ok).toBe(true);
      expect(spy.callCount, 'a provider without detail support cost more than two runs').toBe(2);
    });

    it('THE 90s CEILING: with no time left, detail is skipped and comps still render', async () => {
      // Rule 5 — the ceiling is the WHOLE pipeline, not the detail run. The
      // clock is injected, so this asserts the DECISION rather than racing it:
      // by the time enrichment is reached, less than DETAIL_MIN_REMAINING_MS
      // of the 90s budget is left.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const t0 = Date.now();
      let reads = 0;
      const now = () => new Date(t0 + (++reads > 2 ? PROVIDER_TIMEOUT_MS - 1_000 : 0));

      const out = await runComps(ADDRESS, { provider: spy.provider as never, now });

      expect(out.ok, 'breaching the ceiling failed the run instead of degrading').toBe(true);
      expect(
        spy.detailCalls,
        'the detail batch ran with under DETAIL_MIN_REMAINING_MS left — the ceiling ' +
          'is being applied to the detail run alone, not the whole pipeline',
      ).toBe(0);
      if (out.ok) {
        expect(out.comps.length, 'the comps were lost along with the detail')
          .toBeGreaterThanOrEqual(3);
      }
    });

    it('CONTROL: with time on the clock the same lookup DOES enrich', async () => {
      // Without this, the ceiling case above passes for a build that never
      // enriches at all.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: FRESH, detailItems: detailBank() });
      const t0 = Date.now();
      const out = await runComps(ADDRESS, {
        provider: spy.provider as never, now: () => new Date(t0),
      });
      expect(out.ok).toBe(true);
      expect(spy.detailCalls, 'enrichment never happens even with a full budget').toBe(1);
      if (out.ok) {
        expect(
          out.comps.some((c) => c.detail !== undefined),
          'no comp came back enriched',
        ).toBe(true);
      }
    });
  });
});
