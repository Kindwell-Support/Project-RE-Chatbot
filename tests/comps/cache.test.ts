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
import { ALGO_VERSION, CACHE_TTL_DAYS } from '../../src/features/comps/config.js';
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
    it('recomputes from the stored raw payload with ZERO provider calls', async () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      const { cache, counts } = makeCache({
        cacheKey: KEY,
        normalizedAddress: normalizeAddress(ADDRESS),
        rawSubject: SUBJECT as never,
        rawComps: COMPS as never,
        // A result computed by an OLDER algorithm — deliberately wrong now.
        // Re-pointed off the ARV: the stale marker is now a comp set that
        // could not possibly be the right answer. If the recompute is skipped
        // and the stored result is served, STALE-1 comes back and the assertion
        // below fails loudly instead of matching a plausible number.
        result: {
          ok: true, algoVersion: ALGO_VERSION - 1, runId: 'stale-run',
          subject: SUBJECT, radiusTierMi: 99, recencyTierMonths: 99,
          comps: [{ comp: { zpid: 'STALE-1' }, score: 0, pricePerSqft: 1 }],
          rejected: [], fromCache: true, provider: 'stub',
        } as never,
        algoVersion: ALGO_VERSION - 1,
        provider: 'stub',
        expiresAt: iso(CACHE_TTL_DAYS),
      });

      const out = await runComps(ADDRESS, { provider: spy.provider as never, cache, now });

      expect(
        spy.callCount,
        'an ALGO_VERSION bump re-billed Apify — this re-bills the ENTIRE cached corpus',
      ).toBe(0);
      expect(out.ok, 'the recompute did not produce a result').toBe(true);
      if (out.ok) {
        // Recomputed from raw with the CURRENT algorithm, not the stale result.
        expect(out.comps.map((c) => c.comp.zpid), 'the STALE result was served verbatim')
          .not.toContain('STALE-1');
        expect(out.comps.length, 'the recompute produced nothing').toBeGreaterThanOrEqual(3);
        expect(out.radiusTierMi, 'the stale tier came through').not.toBe(99);
        expect(out.recencyTierMonths).not.toBe(99);
        expect(out.algoVersion).toBe(ALGO_VERSION);
      }
      expect(counts.set, 'the recomputed result was not written back').toBeGreaterThan(0);
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
});
