/**
 * PRIORITY 4 — cache and spend, asserted by PROVIDER-SPY CALL COUNT.
 *
 * Never by timing. A cache test that measures wall-clock is a flake generator
 * and proves nothing about billing; the only question that matters is "did we
 * call Apify, yes or no", and the spy answers it exactly.
 *
 * The single most valuable assertion in this file is the ALGO_VERSION
 * recompute: a cached entry with a stale algo version must be recomputed FROM
 * THE STORED RAW PAYLOAD with **zero** provider calls. Get it subtly wrong and
 * every algorithm tweak silently re-bills the client's entire cached corpus —
 * with no error, no log line, and no symptom except the invoice.
 *
 * Driven directly against `runComps(address, deps)` so the clock, cache and
 * budget are all injected and deterministic.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import {
  runComps,
  createDailyRunBudget,
  type CachedComps,
  type CompsCacheLike,
} from '../../src/features/comps/service.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { normalizeAddress, cacheKey } from '../../src/features/comps/normalize.js';
import {
  ALGO_VERSION,
  CACHE_TTL_DAYS,
  RAW_REFETCH_BELOW_VERSION,
} from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';

/**
 * NOTE on `noDetailSupport`. These cases are about the COMPS cache and count
 * provider calls to prove it. Detail enrichment (§14.14) adds a THIRD actor
 * run per lookup, and with no detail cache wired it re-runs even on a comps
 * hit — correct behaviour, since the comps cache deliberately stores the
 * detail-FREE result. Rather than let that noise inflate every count here,
 * these spies present as a provider that predates the slice. The detail
 * cache's own cost guarantees are asserted in detailEnrichment.test.ts,
 * including that a warm detail cache means ZERO detail runs.
 */
const MODS = ['service', 'cache/compsCache'] as const;

const NOW = new Date('2026-08-05T12:00:00.000Z');
const now = () => NOW;

const SUBJECT = { ...golden01.subject, address: '123 MAIN STREET, SEATTLE, WA 98101' };
/** golden01's $/sqft, re-dated against NOW so nothing is STALE_SALE. */
const COMPS = golden01.comps.map((c, i) => ({
  ...c,
  soldDate: new Date(NOW.getTime() - (30 + i * 10) * 86_400_000).toISOString().slice(0, 10),
}));

const ADDRESS = '123 Main St, Seattle WA';
const KEY = cacheKey(normalizeAddress(ADDRESS));

/** In-memory CompsCacheLike with its own call counters. */
function makeCache(seed?: CachedComps) {
  const rows = new Map<string, CachedComps>();
  if (seed) rows.set(seed.cacheKey, seed);
  const counts = { get: 0, set: 0 };
  const cache: CompsCacheLike = {
    async get(key) {
      counts.get++;
      return rows.get(key) ?? null;
    },
    async set(entry) {
      counts.set++;
      rows.set(entry.cacheKey, entry);
    },
  };
  return { cache, rows, counts };
}

/**
 * Substance, not phrasing. §10 requires every failure to end by inviting the
 * member to supply their own ARV; it does not dictate the words. The first
 * version of this matched /manual|supply|enter/ and failed on copy that reads
 * "If you already have an ARV in mind, just tell me" — which is a better
 * invitation than any of those. Asserting the wording would have made the
 * suite hostile to good writing, the same trap `tests/live.test.ts` calls out.
 */
function offersManualArv(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  const mentionsArv = t.includes('arv') || t.includes('after-repair') || t.includes('after repair');
  const invites = [
    'tell me', 'give me', 'your own', 'you have', 'already have',
    'manual', 'supply', 'enter', 'provide', 'with yours', 'with it',
  ].some((phrase) => t.includes(phrase));
  return mentionsArv && invites;
}

const iso = (offsetDays: number) =>
  new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString();

describe(`cache and spend, by provider call count${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('miss, then hit', () => {
    it('the first call hits the provider and the second does not', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache, counts } = makeCache();

      const first = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(first.ok, 'the first run did not succeed').toBe(true);
      const afterFirst = spy.callCount;
      expect(afterFirst, 'the first run never reached the provider').toBeGreaterThan(0);

      const second = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(second.ok).toBe(true);
      expect(spy.callCount, 'the second identical call re-billed Apify').toBe(afterFirst);
      expect(counts.set, 'nothing was written to the cache').toBeGreaterThan(0);
    });

    it('the cached result is the SAME COMP SET as the live one', async () => {
      // Re-pointed: there is no ARV to compare any more, so the cache identity
      // is the comp set and the tier that produced it. That is a stricter test
      // than the ARV was — two different comp sets can round to the same ARV,
      // but they cannot have the same zpids, prices and $/sqft.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      const live = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      const hit = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(live.ok && hit.ok).toBe(true);
      if (live.ok && hit.ok) {
        // POSITIVE PRECONDITION — two empty comp sets are trivially identical.
        expect(live.comps.length, 'the live run produced no comps to compare')
          .toBeGreaterThanOrEqual(3);

        const fingerprint = (r: typeof live) => r.comps.map(
          (c) => `${c.comp.zpid}|${c.comp.soldPrice}|${c.pricePerSqft.toFixed(6)}|${c.score.toFixed(9)}`,
        );
        expect(fingerprint(hit), 'the cache hit returned a different comp set')
          .toEqual(fingerprint(live));
        expect(hit.radiusTierMi).toBe(live.radiusTierMi);
        expect(hit.recencyTierMonths, 'the recency rung did not survive the round trip')
          .toBe(live.recencyTierMonths);
        expect(hit.subject.zpid).toBe(live.subject.zpid);

        expect(hit.fromCache, 'a cache hit is not flagged fromCache').toBe(true);
        expect(live.fromCache).toBe(false);
      }
    });

    it('a cache hit carries nothing ARV-shaped either', async () => {
      // The removal has to hold on BOTH sides of the cache. A pre-removal entry
      // shape that still round-trips an `arv` key would resurrect the number
      // for every session that hits a warm key.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      const hit = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(hit.ok && hit.fromCache, 'precondition: this was not a cache hit').toBe(true);
      for (const k of ['arv', 'arvLow', 'arvHigh', 'confidence', 'arvConfidence']) {
        expect(hit, `a cache hit still carries "${k}"`).not.toHaveProperty(k);
      }
    });

    it('address variants collapse to ONE provider run', async () => {
      // The cost-control payoff of §5.1 normalization, measured in Apify runs.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      for (const variant of [
        '123 Main St, Seattle WA',
        '123 MAIN STREET, SEATTLE WA',
        '123 main st., seattle wa',
        '  123   Main  St ,  Seattle   WA  ',
      ]) {
        await runComps(variant, { provider: spy.provider as never, cache, now });
      }
      expect(spy.subjectCalls, 'normalization failed to collapse four spellings').toBe(1);
    });

    it('genuinely different addresses do NOT share a cache entry', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      await runComps('123 Main St N, Seattle WA', { provider: spy.provider as never, cache, now });
      await runComps('123 Main St S, Seattle WA', { provider: spy.provider as never, cache, now });
      expect(spy.subjectCalls, 'North and South collapsed to one cache key').toBe(2);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('expiry', () => {
    it('an expired entry is treated as absent and refetches', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: SUBJECT as never,
        rawComps: COMPS as never,
        result: null,
        algoVersion: ALGO_VERSION,
        provider: 'stub',
        expiresAt: iso(-1), // yesterday
      });
      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok).toBe(true);
      expect(spy.callCount, 'an expired entry was served instead of refetched').toBeGreaterThan(0);
    });

    it('an entry inside the TTL is served without touching the provider', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      const billed = spy.callCount;

      // Same key, still well inside CACHE_TTL_DAYS.
      const later = new Date(NOW.getTime() + (CACHE_TTL_DAYS - 1) * 86_400_000);
      const out = await runComps(ADDRESS, {
        provider: spy.provider as never, cache, now: () => later,
      });
      expect(out.ok).toBe(true);
      expect(spy.callCount, 'a live entry was refetched inside its TTL').toBe(billed);
    });
  });

  // =========================================================================
  // THE COST TEST. §7: "Cache hit with stale algo_version ⇒ recompute from
  // raw, update result, DO NOT re-hit the provider."
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('ALGO_VERSION recompute', () => {
    it('a STALE-BUT-SOUND row recomputes from raw with ZERO provider calls', () => {
      // THE SENTINEL FLIPPED, and it flipped by firing rather than by anyone
      // remembering. It read: "if the floor and the version diverge, this path
      // is REACHABLE and needs its assertion back, with a row stamped between
      // 4 and 4." §14.19 took ALGO_VERSION to 5 and held the floor at 4, so
      // that window is now exactly one version wide — and the case failed with
      // its own instructions in the message.
      //
      // Verified rather than merely restored, per the operator: the path I
      // documented as unreachable now runs, so the assertion is on what it
      // DOES, not on the fact that it exists.
      expect(ALGO_VERSION, 'the recompute window closed again').toBeGreaterThan(
        RAW_REFETCH_BELOW_VERSION,
      );
      return (async () => {
        const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
        const { cache, rows } = makeCache({
          cacheKey: KEY,
          normalizedAddress: normalizeAddress(ADDRESS),
          rawSubject: SUBJECT as never,
          rawComps: COMPS as never,
          result: null,
          // Stale by version (< 5, so it recomputes) and sound by regime
          // (>= 4, so it must NOT refetch). Both true only in this window.
          algoVersion: RAW_REFETCH_BELOW_VERSION,
          provider: 'stub',
          expiresAt: iso(CACHE_TTL_DAYS),
        });

        const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });

        expect(out.ok, 'the recompute produced no result').toBe(true);
        expect(
          spy.subjectCalls + spy.compsCalls,
          'a stale-but-sound row was REFETCHED. Its raw came from the §14.17 ' +
            'regime and is trustworthy; re-billing it is the cost the floor ' +
            'exists to avoid, and at scale it is the entire cached corpus.',
        ).toBe(0);

        // It genuinely recomputed rather than serving the stored (null) result.
        if (out.ok) {
          expect(out.comps.length, 'nothing was derived from the raw payload')
            .toBeGreaterThanOrEqual(3);
          expect(out.algoVersion, 'the recomputed result was not re-stamped')
            .toBe(ALGO_VERSION);
        }

        // ...and the row is re-stamped, so the NEXT serve is a plain hit. A
        // recompute that forgot to re-stamp would recompute forever — free in
        // provider calls, but never converging.
        expect(rows.get(KEY)?.algoVersion, 'the row kept its stale version')
          .toBe(ALGO_VERSION);
      })();
    });

    it('CONSEQUENCE, stated so it is a decision: the whole corpus refetches once', async () => {
      // With the floor at the current version, every pre-existing cached row
      // is below it and refetches on its next serve. One Apify run per cached
      // address, once. That is the intended price of the fix — the alternative
      // is serving eleven-day pools labelled as a year — but it is a real
      // spend and it should be visible in a test rather than discovered on the
      // bill.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: SUBJECT as never,
        rawComps: COMPS as never,
        result: null,
        algoVersion: 1, // below the floor: poisoned 40-cap raw, must refetch
        provider: 'stub',
        expiresAt: iso(CACHE_TTL_DAYS),
      });

      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok).toBe(true);
      expect(spy.compsCalls, 'a v1 row did not refetch').toBe(1);

      // ...and ONCE. The refetched row is re-stamped, so the next serve is free.
      const spy2 = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const again = await runComps(ADDRESS, { provider: spy2.provider as never, cache, now });
      expect(again.ok).toBe(true);
      expect(
        spy2.compsCalls,
        'the refetched row was not re-stamped — every serve re-bills, forever, ' +
          'which turns a one-time migration cost into a permanent one',
      ).toBe(0);
    });

    it('the recomputed entry is stamped with the CURRENT algo version', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache, rows } = makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: SUBJECT as never,
        rawComps: COMPS as never,
        result: null,
        algoVersion: ALGO_VERSION - 1,
        provider: 'stub',
        expiresAt: iso(CACHE_TTL_DAYS),
      });
      await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(rows.get(KEY)!.algoVersion, 'a stale algoVersion survived the recompute')
        .toBe(ALGO_VERSION);
      // ...otherwise every subsequent call recomputes forever.
      const spy2 = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      await runComps(ADDRESS, { provider: spy2.provider as never, cache, now });
      expect(spy2.callCount).toBe(0);
    });

    it('a stale entry with NO raw payload must refetch rather than serve nothing', async () => {
      // Recompute-from-raw is only possible if raw was stored. An entry from
      // before raw-caching existed has to fall back to a live run.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: null,
        rawComps: [],
        result: null,
        algoVersion: ALGO_VERSION - 1,
        provider: 'stub',
        expiresAt: iso(CACHE_TTL_DAYS),
      });
      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok).toBe(true);
      expect(spy.callCount, 'served a stale entry with no raw payload to recompute from')
        .toBeGreaterThan(0);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('a broken cache costs money, never correctness', () => {
    it('a read failure degrades to a live run rather than an error', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const cache: CompsCacheLike = {
        async get() { throw new Error('supabase unavailable'); },
        async set() { /* fine */ },
      };
      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok, 'a cache read failure surfaced to the member').toBe(true);
      expect(spy.callCount).toBeGreaterThan(0);
    });

    it('a write failure still returns the result', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const cache: CompsCacheLike = {
        async get() { return null; },
        async set() { throw new Error('supabase unavailable'); },
      };
      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok, 'a cache write failure lost the result').toBe(true);
      if (out.ok) {
        // Re-pointed off the ARV: a cache WRITE failure must still return the
        // full comp set, not a degraded one.
        expect(out.comps.length, 'a cache write failure cost us the comps')
          .toBeGreaterThanOrEqual(3);
        expect(out.fromCache, 'a failed write was reported as a cache hit').toBe(false);
      }
    });

    it('runs at all with no cache injected', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const out = await runComps(ADDRESS, { provider: spy.provider as never, now });
      expect(out.ok).toBe(true);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the daily spend cap', () => {
    it('blocks a provider run once the cap is reached, BEFORE any provider work', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const budget = createDailyRunBudget(2);
      const opts = { provider: spy.provider as never, budget, now };

      await runComps('1 A St, Seattle WA', opts);
      await runComps('2 B St, Seattle WA', opts);
      const billedSoFar = spy.callCount;

      const blocked = await runComps('3 C St, Seattle WA', opts);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe('RATE_LIMITED');
      expect(
        spy.callCount,
        'the cap was checked AFTER the provider ran — it guards nothing',
      ).toBe(billedSoFar);
    });

    it('RATE_LIMITED copy carries no number and offers manual entry', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const budget = createDailyRunBudget(0);
      const out = await runComps(ADDRESS, { provider: spy.provider as never, budget, now });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.code).toBe('RATE_LIMITED');
        expect(out.message).not.toMatch(/\$\s?[\d,]*\d/);
        expect(
          offersManualArv(out.message),
          `RATE_LIMITED copy does not invite a manual ARV: ${out.message}`,
        ).toBe(true);
      }
      expect(spy.callCount).toBe(0);
    });

    it('a CACHE HIT does not consume the daily cap (change log #9)', async () => {
      // The cap guards Apify spend. A hit costs nothing, so charging for it
      // would lock a member out for re-reading one address at zero cost to
      // the client.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      const budget = createDailyRunBudget(1);
      const opts = { provider: spy.provider as never, cache, budget, now };

      const first = await runComps(ADDRESS, opts);
      expect(first.ok).toBe(true);

      // The cap is now fully consumed by that one provider run. A repeat of the
      // SAME address is a cache hit and must still succeed.
      for (let i = 0; i < 3; i++) {
        const hit = await runComps(ADDRESS, opts);
        expect(hit.ok, `cache hit #${i + 1} was rate-limited`).toBe(true);
      }
      expect(spy.subjectCalls).toBe(1);
    });

    it('the cap resets on a new day', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const budget = createDailyRunBudget(1);
      const day1 = await runComps('1 A St', { provider: spy.provider as never, budget, now });
      expect(day1.ok).toBe(true);
      const blocked = await runComps('2 B St', { provider: spy.provider as never, budget, now });
      expect(blocked.ok).toBe(false);

      const tomorrow = new Date(NOW.getTime() + 86_400_000);
      const day2 = await runComps('3 C St', {
        provider: spy.provider as never, budget, now: () => tomorrow,
      });
      expect(day2.ok, 'the daily cap did not reset').toBe(true);
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('secret hygiene', () => {
    it('logs carry the cache key, never the raw address or a token', async () => {
      // CONTRACT §1: info logs use cacheKey, not the raw address. An address is
      // member PII and a token is the client's money.
      const lines: string[] = [];
      const logger = {
        info: (...a: unknown[]) => lines.push(a.map(String).join(' ')),
        warn: (...a: unknown[]) => lines.push(a.map(String).join(' ')),
        error: (...a: unknown[]) => lines.push(a.map(String).join(' ')),
      };
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();
      await runComps(ADDRESS, {
        provider: spy.provider as never, cache, logger: logger as never, now,
      });

      const all = lines.join('\n');
      expect(all, 'the raw address was logged').not.toContain('123 Main St, Seattle WA');
      expect(all).not.toMatch(/apify_api_|Bearer\s+\S+/i);
      expect(all).not.toContain(process.env.APIFY_TOKEN ?? '__NO_TOKEN_IN_ENV__');
    });
  });
  // =========================================================================
  // §14.16 raw_neighborhood — the aggregate raw rides the comps row, and the
  // COMPUTED aggregates are never stored (they recompute per serve from raw).
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('the aggregate raw rides the cached comps row', () => {
    it('a cached entry WITH raw neighbourhood costs ZERO provider runs', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = makeCache();

      // Cold: pays for everything, and stores the aggregate raw alongside.
      const cold = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(cold.ok, 'the cold run failed').toBe(true);
      const paid = spy.callCount;
      expect(paid, 'the cold run cost nothing — nothing to compare against')
        .toBeGreaterThan(0);

      // Warm: a full cache hit must add NOTHING, neighbourhood included.
      const warm = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(warm.ok).toBe(true);
      expect(
        spy.callCount - paid,
        'a warm serve re-fetched — the aggregate raw is not riding the cached row',
      ).toBe(0);
    });

    it('the COMPUTED aggregates are not stored — they recompute per serve', async () => {
      // §14.16: raw is cached, the averages are not. Storing them would mean a
      // cached row keeps serving figures computed under an older rule, which
      // is the ALGO_VERSION problem in a place the version stamp does not
      // reach.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache, rows } = makeCache();
      await runComps(ADDRESS, { provider: spy.provider as never, cache, now });

      const stored = JSON.stringify([...rows.values()]);
      expect(stored.length, 'nothing was cached').toBeGreaterThan(0);
      expect(
        stored,
        'a computed aggregate was stored on the cache row — it must be derived ' +
          'from raw on every serve, or a stale rule outlives its version stamp',
      ).not.toMatch(/"avgSoldPrice"|"avgPricePerSqft"|"totalSales"/);
    });
  });
  // =========================================================================
  // §14.17 — the one case the version stamp does NOT save us.
  //
  // A bump normally means "recompute from raw", free. But raw fetched under
  // the 40-item uncapped-window search is days deep in a dense market, so
  // recomputing over it just re-derives a starved answer and stamps it fresh.
  // Those rows must REFETCH.
  //
  // Both directions, because a floor that refetches everything forever would
  // be as wrong as one that refetches nothing — it would re-bill the entire
  // corpus on every future bump.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('RAW_REFETCH_BELOW_VERSION — poisoned raw refetches', () => {
    function plant(algoVersion: number) {
      return makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: SUBJECT as never,
        rawComps: COMPS as never,
        result: null,
        algoVersion,
        provider: 'stub',
        expiresAt: iso(CACHE_TTL_DAYS),
      });
    }

    it('a PRE-floor row REFETCHES — its raw came from the 40-cap regime', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = plant(RAW_REFETCH_BELOW_VERSION - 1);

      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok, 'the refetch produced no result').toBe(true);
      expect(
        spy.compsCalls,
        'a row whose raw predates the fetch fix was RECOMPUTED — that re-derives ' +
          'from a pool that is days deep and stamps it with the current version, ' +
          'which is the one case the stamp cannot catch',
      ).toBeGreaterThan(0);
    });

    it('an AT-floor row RECOMPUTES — zero provider calls', async () => {
      // The other direction, and the reason the floor is a floor rather than a
      // blanket refetch: raw fetched under §14.17 is trustworthy, so a future
      // ALGO_VERSION bump must still be free for it.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache } = plant(RAW_REFETCH_BELOW_VERSION);

      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });
      expect(out.ok).toBe(true);
      expect(
        spy.compsCalls,
        'a row at the floor was refetched — a version floor that re-bills every ' +
          'row forever is as wrong as one that never refetches',
      ).toBe(0);
      expect(spy.subjectCalls, 'the subject was re-billed too').toBe(0);
    });

    it('the floor is the version the fetch regime changed at', () => {
      // Pins the relationship rather than the number: the floor must be the
      // CURRENT algo version, because §14.17 is what changed the regime. If a
      // later bump moves ALGO_VERSION without moving the floor, rows fetched
      // under the good regime start refetching for no reason.
      expect(RAW_REFETCH_BELOW_VERSION).toBe(4);
      expect(
        RAW_REFETCH_BELOW_VERSION,
        'the floor drifted above the current algo version — every cached row ' +
          'now refetches, forever',
      ).toBeLessThanOrEqual(ALGO_VERSION);
    });
  });
});
