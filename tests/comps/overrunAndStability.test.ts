/**
 * The four remaining characterizations before GREEN, all offline.
 *
 *   1. OVERRUN — what a detail batch that cannot finish actually does. Never
 *      characterized; the 30s-batch regime says it is reachable.
 *   2. SELF-HEALING on the overrun path, not just the skip path. The handover
 *      line is "ask again", so it has to hold for every degraded shape.
 *   3. TRUNCATION DETERMINISM — same address twice, same five comps, same
 *      order. A correctness property, not a performance one.
 *   4. The rendered "N candidate(s) rejected" must count the pool actually
 *      EVALUATED. Printing a pre-truncation number would be a falsehood in
 *      member-facing copy — the same class as BUG-022.
 */
import { describe, it, expect } from 'vitest';
import { pendingSlice, sliceNote } from '../helpers/compsGate.js';
import { runComps } from '../../src/features/comps/service.js';
import { renderCompsForChat } from '../../src/features/comps/format.js';
import { makeProviderSpy } from '../helpers/compsFakes.js';
import { ALGO_VERSION, MAX_COMPS_KEPT } from '../../src/features/comps/config.js';
import { golden01 } from '../fixtures/golden/index.js';
import type { CachedComps, RawComp, SubjectProperty } from '../../src/features/comps/types.js';

const MODS = ['service', 'detail'] as const;
const NOW = new Date(golden01.now);
const ADDRESS = '1646 N DAFFODIL ST, TEMPE, AZ';
const SUBJECT = golden01.subject as SubjectProperty;
const COMPS = golden01.comps as RawComp[];

const bank = (comps: RawComp[]) =>
  Object.fromEntries(
    comps.map((c, i) => [
      c.address,
      { zpid: c.zpid, isValid: true, daysOnZillow: 30 + i, yearBuilt: 1995, resoFacts: { parkingCapacity: 2 } },
    ]),
  );

function memCache(seed?: CachedComps) {
  const rows = new Map<string, CachedComps>();
  if (seed) rows.set(seed.cacheKey, seed);
  return {
    rows,
    cache: {
      async get(k: string) { return rows.get(k) ?? null; },
      async set(e: CachedComps) { rows.set(e.cacheKey, e); },
    },
  };
}
const coveredCount = (o: { ok: boolean; comps?: Array<{ detail?: unknown }> }) =>
  (o.comps ?? []).filter((c) => c.detail !== undefined).length;

describe(`overrun, self-healing and stability${sliceNote(...MODS)}`, () => {
  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('1 + 2 — the overrun path and its recovery', () => {
    /** A provider whose detail batch always throws a timeout, as an overrun does. */
    const overrunSpy = () => {
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, detailItems: bank(COMPS) });
      const inner = spy.provider as unknown as Record<string, unknown>;
      inner.fetchDetailBatch = async () => {
        const err = new Error('socket hang up');
        (err as Error & { code?: string }).code = 'ETIMEDOUT';
        throw err;
      };
      return spy;
    };

    it('a batch that cannot finish DEGRADES the serve — it never fails it', () => {
      // The characterization. An overrun is a throw at the provider seam, and
      // the answer must be comps-without-detail rather than a failed lookup:
      // enrichment is decoration (rule 3) and the member still needs the
      // sold prices, which were already in hand before the batch started.
      const spy = overrunSpy();
      return runComps(ADDRESS, { provider: spy.provider as never, now: () => NOW } as never).then(
        (out) => {
          expect(out.ok, 'an overrunning detail batch failed the whole comps run').toBe(true);
          if (!out.ok) return;
          expect(out.comps.length, 'the comps themselves were lost').toBe(MAX_COMPS_KEPT);
          expect(coveredCount(out), 'detail attached despite the batch throwing').toBe(0);
        },
      );
    });

    it('a PARTIAL return reports its real coverage — no comp wears a neighbour detail', () => {
      // The interaction the operator flagged with BUG-022: if an overrun
      // returns some items, per-comp coverage must count only the comps that
      // genuinely got their OWN detail. A partial that reported 5/5 would be
      // the wrong-property failure wearing a coverage number.
      const partial = Object.fromEntries(Object.entries(bank(COMPS)).slice(0, 2));
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, detailItems: partial } as never);
      return runComps(ADDRESS, { provider: spy.provider as never, now: () => NOW } as never).then(
        (out) => {
          expect(out.ok).toBe(true);
          if (!out.ok) return;
          const covered = coveredCount(out);
          expect(covered, 'a partial batch reported FULL coverage').toBeLessThan(out.comps.length);
          expect(covered, 'a partial batch reported NO coverage — the case is vacuous')
            .toBeGreaterThan(0);
        },
      );
    });

    it('SELF-HEALING holds on the OVERRUN path, not just the skip path', () => {
      // The handover line is "ask again", and it must be true for every
      // degraded shape rather than only the one Daffodil happened to take.
      // Confirmed rather than inferred, per instruction: run 1 overruns, run 2
      // serves the SAME cached row and recovers to full coverage with no
      // second comps fetch.
      const { cache } = memCache();
      const first = overrunSpy();
      return runComps(ADDRESS, { provider: first.provider as never, cache, now: () => NOW } as never)
        .then((a) => {
          expect(a.ok).toBe(true);
          expect(coveredCount(a as never), 'precondition: run 1 was not degraded').toBe(0);

          const second = makeProviderSpy({ subject: SUBJECT, comps: COMPS, detailItems: bank(COMPS) });
          return runComps(ADDRESS, {
            provider: second.provider as never, cache, now: () => NOW,
          } as never).then((b) => {
            expect(b.ok).toBe(true);
            if (!b.ok) return;
            expect(
              coveredCount(b),
              'the re-serve did NOT recover. The handover remedy is "ask again", ' +
                'which is only true because the row is stored detail-free and ' +
                'enrichment re-attaches per serve.',
            ).toBe(b.comps.length);
            expect(
              second.compsCalls,
              'the recovery re-fetched the comps search — the row should serve ' +
                'from cache and only the detail batch should be live',
            ).toBe(0);
          });
        });
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('3 — the served set is deterministic', () => {
    it('the same address twice yields the same five comps in the same order', () => {
      // Scoped small, as instructed: the expected result is stability. It is
      // worth pinning anyway because the search returns near its 500 cap, and
      // if truncation were unordered the scored pool would differ run to run
      // and the top-5 would wander on an unchanged address.
      const runOnce = () => {
        const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
        return runComps(ADDRESS, { provider: spy.provider as never, now: () => NOW } as never);
      };
      return Promise.all([runOnce(), runOnce()]).then(([a, b]) => {
        expect(a.ok && b.ok, 'a run failed; nothing to compare').toBe(true);
        if (!a.ok || !b.ok) return;
        expect(
          b.comps.map((c) => c.comp.zpid),
          'the same address produced a DIFFERENT set or order on the second run',
        ).toEqual(a.comps.map((c) => c.comp.zpid));
      });
    });
  });

  // =========================================================================
  describe.skipIf(pendingSlice(...MODS))('4 — the rejected count describes the pool EVALUATED', () => {
    it('the rendered count equals the rejections actually recorded', () => {
      // The copy check. If the block printed a pre-truncation candidate count
      // while scoring a truncated pool, the number would be a falsehood in
      // member-facing text — BUG-022's class, one surface over.
      const spy = makeProviderSpy({ subject: SUBJECT, comps: COMPS, noDetailSupport: true });
      return runComps(ADDRESS, { provider: spy.provider as never, now: () => NOW } as never).then(
        (out) => {
          expect(out.ok).toBe(true);
          if (!out.ok) return;
          const text = String(renderCompsForChat(out as never));
          const m = /\((\d+) candidate\(s\) rejected\)/.exec(text);
          expect(m, 'the rejected-count line did not render').not.toBeNull();
          expect(
            Number(m?.[1]),
            'the printed count does not match the rejections the pipeline ' +
              'recorded, so it is describing a pool that was never evaluated',
          ).toBe(out.rejected.length);
          // And every rejection names a comp that was really in the pool.
          expect(
            out.rejected.length + out.comps.length,
            'kept + rejected exceeds the candidates supplied — the count ' +
              'includes properties the pipeline never saw',
          ).toBeLessThanOrEqual(COMPS.length);
        },
      );
    });
  });
});
