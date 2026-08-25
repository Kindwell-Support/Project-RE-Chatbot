/**
 * §14.14.2 — enrichment reliability. BUG-021 (the operator's slice label
 * "BUG-014"; see BUGS.md for the collision).
 *
 * WRITTEN FROM THE CONTRACT, deliberately before opening the implementation
 * and before reading MASON's suggested rows in 0073. A suggestion list from
 * the author of the code under test is the fastest way to inherit its blind
 * spots — the same reason expected values are hand-derived here rather than
 * read back from the build.
 *
 * The five ruled guarantees, as pinned:
 *   1. bounded retry — ONE, after an explicit backoff, only while headroom
 *      still clears the floor; on transient THROW or EMPTY/SHORT result;
 *      NEVER on 4xx; and a complete batch carrying isValid:false items is an
 *      ANSWER, not a short batch
 *   2. coverage INFO on every serve; WARN when covered = 0 and total > 0;
 *      ceiling skip WARNs and carries remainingMs
 *   3. no swallowed exceptions — every catch WARNs with error class + cacheKey
 *   4. battery policy: 0/N fails, partial warns, observable from the render
 *   5. degraded results are never cached
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { runComps } from '../../src/features/comps/service.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import {
  DETAIL_BATCH_MAX_RETRIES,
  DETAIL_RETRY_BACKOFF_MS,
  DETAIL_MIN_REMAINING_MS,
  PROVIDER_TIMEOUT_MS,
  ALGO_VERSION,
} from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';
import type { CachedComps, RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['service', 'detail'] as const;

// The fixture's own clock. Dating this to the incident (2026-08-12) put every
// golden comp outside the recency ladder, so all six cases failed ok:false —
// a dead run, not a finding about enrichment.
const NOW = new Date(golden01.now);
const ADDRESS = '1646 N DAFFODIL ST, MESA, AZ';
const SUBJECT = golden01.subject as SubjectProperty;
const COMPS = golden01.comps as RawComp[];

/** Collects every log line so the contract's logging rules are assertable. */
function makeLogger() {
  const lines: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (obj: unknown, msg?: unknown) =>
    lines.push({
      level,
      obj: (typeof obj === 'object' && obj !== null ? obj : {}) as Record<string, unknown>,
      msg: String(msg ?? (typeof obj === 'string' ? obj : '')),
    });
  return { lines, info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
}

/** An in-memory comps_cache that records EVERY row written, in order. */
function makeRecordingCache(seed?: CachedComps) {
  const rows = new Map<string, CachedComps>();
  if (seed) rows.set(seed.cacheKey, seed);
  const writes: CachedComps[] = [];
  return {
    rows,
    writes,
    cache: {
      async get(k: string) {
        return rows.get(k) ?? null;
      },
      async set(e: CachedComps) {
        // Snapshot at write time. Storing the live object would let a later
        // mutation rewrite history and hide exactly the bug this file hunts.
        writes.push(JSON.parse(JSON.stringify(e)) as CachedComps);
        rows.set(e.cacheKey, e);
      },
    },
  };
}

const detailBank = (comps: RawComp[]) =>
  Object.fromEntries(
    comps.map((c, i) => [
      c.address,
      { zpid: c.zpid, isValid: true, daysOnZillow: 40 + i, yearBuilt: 1998, resoFacts: { parkingCapacity: 2 } },
    ]),
  );

describe(`§14.14.2 enrichment reliability${sliceNote(...MODS)}`, () => {
  // =========================================================================
  // RULE 5 — "degraded results are NOT cached", attacked rather than accepted.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))(
    'RULE 5 — no comps row may EVER be written with detail attached',
    () => {
      /**
       * THE CLAIM UNDER ATTACK: "degraded-payload caching is structurally
       * impossible." The evidence offered was that run 2 self-healed, which
       * shows it did not happen once — not that it cannot.
       *
       * WHAT I FOUND. The live path is ordered correctly (compute, write,
       * then enrich), but it is not the only write. `enrichWithNeighborhood`
       * re-upserts the SAME entry object after `enrichWithDetail` has already
       * run, to persist the neighbourhood raw:
       *
       *     entry.rawNeighborhood = rawSales;
       *     await deps.cache.set(entry);
       *
       * On the cache-HIT path the entry is the cached row itself and the
       * result handed to enrichment is `{ ...cached.result }` — a fresh top
       * level whose `.comps` is the SAME ARRAY REFERENCE. So the only thing
       * standing between a post-enrichment write and a frozen degraded result
       * is that `attachDetails` spreads instead of mutating.
       *
       * That is a convention, not a structure. It holds today. One in-place
       * `scored.detail = …` anywhere on the detail path and every serve that
       * also fetches neighbourhood raw would persist enrichment into the comps
       * row — freezing whatever coverage that serve happened to get, which is
       * precisely the failure §14.14.2 rule 5 says cannot occur.
       *
       * So the cases below assert the PROPERTY over every write, on both
       * paths, rather than asserting the ordering of the live one.
       */
      const assertNoDetailInAnyWrite = (writes: CachedComps[]) => {
        expect(writes.length, 'nothing was written — the case proves nothing').toBeGreaterThan(0);
        for (const [i, w] of writes.entries()) {
          const comps = (w.result as { comps?: Array<Record<string, unknown>> } | null)?.comps ?? [];
          for (const c of comps) {
            expect(
              Object.prototype.hasOwnProperty.call(c, 'detail'),
              `write #${i + 1} persisted a comps row whose result carries detail. ` +
                '§14.14.2 rule 5: the row is stored DETAIL-FREE so enrichment ' +
                're-attaches per serve — that is the only reason run 2 could ' +
                'self-heal from run 1. Freezing coverage into the row makes a ' +
                '0/N permanent for the whole 14-day TTL.',
            ).toBe(false);
          }
        }
      };

      it('the LIVE path writes detail-free even when enrichment succeeds 5/5', async () => {
        const { cache, writes } = makeRecordingCache();
        const spy = makeProviderSpy({
          subject: SUBJECT,
          comps: COMPS,
          detailItems: detailBank(COMPS),
        });
        const out = await runComps(ADDRESS, {
          provider: spy.provider as never,
          cache,
          now: () => NOW,
        } as never);
        expect(out.ok, 'the run failed; nothing to conclude about its writes').toBe(true);
        if (!out.ok) return;
        // PRECONDITION: enrichment actually attached, or "no detail in the
        // write" is true because there was no detail anywhere.
        expect(
          out.comps.filter((c) => (c as { detail?: unknown }).detail !== undefined).length,
          'no comp was enriched, so this case cannot detect a detail-carrying write',
        ).toBeGreaterThan(0);
        assertNoDetailInAnyWrite(writes);
      });

      it('the CACHE-HIT path re-upsert cannot freeze enrichment into the row', async () => {
        // The dangerous one. Here the entry handed to enrichAll IS the cached
        // row, and the neighbourhood re-upsert happens AFTER detail attaches.
        const seed: CachedComps = {
          cacheKey: 'seed',
          normalizedAddress: ADDRESS,
          rawSubject: SUBJECT as never,
          rawComps: COMPS as never,
          rawNeighborhood: null, // forces the live neighbourhood fetch + re-upsert
          result: null,
          algoVersion: ALGO_VERSION,
          provider: 'stub',
          expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
        } as CachedComps;
        const { cache, writes } = makeRecordingCache(seed);
        const spy = makeProviderSpy({
          subject: SUBJECT,
          comps: COMPS,
          detailItems: detailBank(COMPS),
          neighborhoodSales: COMPS,
        } as never);

        const out = await runComps(ADDRESS, {
          provider: spy.provider as never,
          cache,
          now: () => NOW,
        } as never);
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(
          out.comps.filter((c) => (c as { detail?: unknown }).detail !== undefined).length,
          'nothing enriched on the hit path — the re-upsert had no detail to freeze',
        ).toBeGreaterThan(0);
        assertNoDetailInAnyWrite(writes);
      });

      it('THE TRIPWIRE: enrichment must not MUTATE the comps it is handed', async () => {
        // The property the invariant actually rests on, asserted directly so a
        // future in-place attach fails HERE with the reason, rather than
        // silently turning the neighbourhood re-upsert into a degraded-cache
        // writer three call frames away.
        const seed: CachedComps = {
          cacheKey: 'seed',
          normalizedAddress: ADDRESS,
          rawSubject: SUBJECT as never,
          rawComps: COMPS as never,
          rawNeighborhood: null,
          result: null,
          algoVersion: ALGO_VERSION,
          provider: 'stub',
          expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
        } as CachedComps;
        const { cache, rows } = makeRecordingCache(seed);
        const spy = makeProviderSpy({
          subject: SUBJECT,
          comps: COMPS,
          detailItems: detailBank(COMPS),
          neighborhoodSales: COMPS,
        } as never);
        await runComps(ADDRESS, { provider: spy.provider as never, cache, now: () => NOW } as never);

        const stored = rows.get('seed');
        const storedComps =
          (stored?.result as { comps?: Array<Record<string, unknown>> } | null)?.comps ?? [];
        for (const c of storedComps) {
          expect(
            Object.prototype.hasOwnProperty.call(c, 'detail'),
            'the IN-MEMORY cached row gained detail after the serve. attachDetails ' +
              'is mutating the comps in place instead of spreading, so the ' +
              'neighbourhood re-upsert now persists enrichment — rule 5 is broken ' +
              'by a change three call frames from the write.',
          ).toBe(false);
        }
      });
    },
  );

  // =========================================================================
  // RULE 1 — the bounded retry, and the two things it must NOT retry.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('RULE 1 — bounded retry', () => {
    it('the constants are the ruled ones', () => {
      expect(DETAIL_BATCH_MAX_RETRIES, 'more than ONE retry re-bills the client').toBe(1);
      expect(DETAIL_RETRY_BACKOFF_MS, 'the backoff is not the ruled 2s').toBe(2_000);
    });

    it('a COMPLETE batch carrying isValid:false items is an ANSWER, not a short batch', () => {
      // The expensive mistake this clause exists to prevent: Zillow has
      // already said these addresses are invalid, and retrying re-bills to be
      // told the same thing. "Short" is about COUNT, never about validity.
      const bank = Object.fromEntries(
        COMPS.map((c) => [c.address, { zpid: c.zpid, isValid: false, invalidReason: 'not found' }]),
      );
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, detailItems: bank } as never);
      return runComps(ADDRESS, { provider: spy.provider as never, now: () => NOW } as never).then(
        (out) => {
          expect(out.ok, 'an all-invalid detail batch failed the comps run — rule 3').toBe(true);
          expect(
            spy.detailCalls,
            'a complete batch of isValid:false items was RETRIED. Those addresses ' +
              'were answered, not dropped; the retry re-bills for the same answer.',
          ).toBe(1);
        },
      );
    });
  });

  // =========================================================================
  // RULE 2 — coverage logging, and the ceiling branch specifically.
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('RULE 2 — coverage is never silent', () => {
    it('a served result logs coverage INFO with counts and NO addresses (§3)', async () => {
      const logger = makeLogger();
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: COMPS,
        detailItems: detailBank(COMPS),
      });
      await runComps(ADDRESS, {
        provider: spy.provider as never,
        now: () => NOW,
        logger,
      } as never);

      const coverage = logger.lines.filter((l) => /cover/i.test(l.msg) || 'covered' in l.obj);
      expect(coverage.length, 'no coverage line was logged on a served result').toBeGreaterThan(0);
      const line = coverage[0];
      expect(line.obj, 'the coverage line carries no covered count').toHaveProperty('covered');
      expect(line.obj, 'the coverage line carries no total').toHaveProperty('total');
      // §3: counts only. An address in an info log is a privacy regression.
      const blob = JSON.stringify(logger.lines.filter((l) => l.level === 'info'));
      for (const c of COMPS.slice(0, 3)) {
        expect(
          blob.includes(c.address),
          `a comp ADDRESS reached an info log (${c.address}) — §3 pins counts only`,
        ).toBe(false);
      }
    });

    it('0/N WARNs — a zero coverage can never again be silent', async () => {
      const logger = makeLogger();
      // Provider capable of detail, but every item unusable ⇒ covered = 0.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, detailItems: {} } as never);
      const out = await runComps(ADDRESS, {
        provider: spy.provider as never,
        now: () => NOW,
        logger,
      } as never);
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(
        out.comps.every((c) => (c as { detail?: unknown }).detail === undefined),
        'precondition: something enriched, so this is not a 0/N',
      ).toBe(true);
      expect(
        logger.lines.some((l) => l.level === 'warn'),
        'a 0/N enrichment produced no WARN. That silence IS BUG-021: the ' +
          'incident was unrecoverable precisely because a zero coverage ' +
          'looked identical to a healthy run in the logs.',
      ).toBe(true);
    });

    it('THE CEILING BRANCH: near-zero headroom WARNs and carries remainingMs', async () => {
      // The branch MASON could not distinguish from a transient failure, and
      // the one the retry cannot help — the retry re-checks the ceiling, so if
      // it was a ceiling skip the retry is a no-op and only the WARN changed.
      // Which makes the WARN the entire fix for this branch, and worth
      // attacking directly.
      const logger = makeLogger();
      const spy = makeProviderSpy({
        subject: SUBJECT,
        comps: COMPS,
        detailItems: detailBank(COMPS),
      });
      // A clock already past the point where DETAIL_MIN_REMAINING_MS can be
      // met: the pipeline "started" long enough ago that headroom is gone.
      let calls = 0;
      const now = () => {
        calls += 1;
        // First reads build the pipeline; later reads are deep into the budget.
        return new Date(NOW.getTime() + (calls > 2 ? PROVIDER_TIMEOUT_MS - 1_000 : 0));
      };
      const out = await runComps(ADDRESS, {
        provider: spy.provider as never,
        now,
        logger,
      } as never);

      expect(out.ok, 'the ceiling skip failed the whole run — enrichment is decoration').toBe(true);
      // SCOPED TO THE DETAIL LINE. A loose /ceiling/ matcher is satisfied by
      // the NEIGHBOURHOOD skip, which also carries remainingMs and also fires
      // here — so the case would have passed while saying nothing about the
      // branch under test. Wrong-subject assertion, same shape as the DOM row
      // slicer that once matched a sibling comp's line.
      const ceiling = logger.lines.filter(
        (l) => /detail batch skipped/i.test(l.msg) && 'remainingMs' in l.obj,
      );
      expect(
        ceiling.length,
        'no line carried remainingMs for a ceiling skip. §14.14.2 rule 2 ' +
          'upgrades this to a WARN with remainingMs precisely so the next ' +
          'occurrence is distinguishable from a transient failure — which is ' +
          'the discrimination BUG-021 could not make after the fact.',
      ).toBeGreaterThan(0);
      expect(
        ceiling.some((l) => l.level === 'warn'),
        'the ceiling skip logged at INFO. It produces a 0/N, and rule 2 ' +
          'upgrades it to WARN for that reason.',
      ).toBe(true);
      expect(
        typeof ceiling[0].obj.remainingMs,
        'remainingMs is not a number, so the margin cannot be read from the log',
      ).toBe('number');
      // `attempt` distinguishes a first-pass skip from one on the retry, which
      // is the whole diagnostic point: BUG-021 could not tell a ceiling skip
      // from a transient failure, and a ceiling skip at attempt 0 means the
      // retry never ran at all.
      expect(
        ceiling[0].obj,
        'the ceiling WARN carries no attempt number — a reader cannot tell ' +
          'whether the retry ran and also hit the ceiling, or never ran',
      ).toHaveProperty('attempt');
      // And the run still served: enrichment is decoration (rule 3).
      if (out.ok) {
        expect(
          out.comps.length,
          'the ceiling skip cost the member their comps — it must degrade to ' +
            'comps-without-detail, never to a failed run',
        ).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
