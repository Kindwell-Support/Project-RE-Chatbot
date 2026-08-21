/**
 * THE COLD ENRICHMENT RUN — BUG-021's done-when. Operator-authorized, ONE run.
 *
 * Double-gated: RUN_LIVE_TESTS=1 AND RUN_COLD_ENRICHMENT=1. Two flags because
 * this one bills FOUR actor runs (subject, search, hood, detail) against the
 * client's quota and writes real rows to the shared prod Supabase project
 * fcaabusbifitsovlpjdy — there is no separate dev project, which is why the
 * plan is a fresh address rather than deleting the BUG-021 forensic rows.
 *
 *   RUN_LIVE_TESTS=1 RUN_COLD_ENRICHMENT=1 npx vitest run tests/comps/coldEnrichment.live.test.ts
 *
 * WHY A HARNESS AND NOT JUST A LOOKUP. MASON's three runs all rode cache: zero
 * actor runs, so the retry path was never reached and coverage told us nothing
 * about headroom. Coverage alone still would not: a 5/5 landing with 400ms of
 * margin reports identically to one landing with 40s, and only one of those is
 * healthy. So every measurement point is captured at an INJECTABLE seam and
 * nothing in src/ is touched:
 *
 *   provider wrapper -> per-stage start/end, the FRONT HALF the stores cannot show
 *   injected now()   -> elapsed at every ceiling evaluation
 *   capturing logger -> branch taken, remainingMs, attempt, coverage counts
 *   REAL supabase    -> durable rows as evidence, and the true write path
 *
 * OUTCOMES, defined before the run so the result cannot be talked into a pass:
 *   PASS      5/5, coverage INFO fired, remainingMs at detail start >= 2x floor
 *   NEAR-MISS 5/5 but remainingMs < 2x floor — a FINDING, not a pass
 *   FAIL      0/N or a ceiling skip, with branch and remainingMs named
 *   INVALID   subject did not resolve, or the batch never ran because detail
 *             was already warm (asserted directly, never inferred from coverage)
 *
 * WHAT THIS RUN DOES NOT ESTABLISH: it drives runComps directly, so it writes no
 * qa_logs row and proves nothing about whether DigitalOcean captures the new
 * WARNs. That is a separate open question and this file must not be cited for it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../../src/config.js';
import { runComps } from '../../src/features/comps/service.js';
import { ApifyZillowProvider } from '../../src/features/comps/providers/apifyZillow.js';
import { createCompsCache } from '../../src/features/comps/cache/compsCache.js';
import { createDetailCache } from '../../src/features/comps/cache/detailCache.js';
import { DETAIL_MIN_REMAINING_MS, PROVIDER_TIMEOUT_MS, MAX_COMPS_KEPT } from '../../src/features/comps/config.js';

const enabled = process.env.RUN_LIVE_TESTS === '1' && process.env.RUN_COLD_ENRICHMENT === '1';

/**
 * Maryvale primary. Chosen for COLDNESS, not for load: the operator's density
 * hypothesis missed twice (Cypress at 604 candidates came back lighter than
 * Daffodil; Osborn, a Scottsdale condo, was heaviest at 754 and still enriched
 * 5/5), so tract uniformity is not the lever. Verified cold by query before the
 * run: zero comps_cache rows matching 85033/MARYVALE/51ST AVE.
 */
// VERIFIED TO RESOLVE before spending: zpid 7720636, SFR, 1,984 sqft, 4bd/3ba.
// Subject resolution is the binary failure (a non-resolving address returns a
// null, not a measurement); comp density is a gradient the 1mi->3mi ladder can
// absorb. Optimised for the former. Cold confirmed by query: zero comps_cache
// rows matching 51ST AVENUE, 85031 or 85033.
const ADDRESS = process.env.COLD_ADDRESS ?? '4547 N 51st Ave, Phoenix, AZ 85031';

interface StageTiming { stage: string; startMs: number; endMs: number; ms: number; ok: boolean; note?: string }

describe.skipIf(!enabled)('COLD enrichment run — BUG-021 done-when', () => {
  const stages: StageTiming[] = [];
  const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  let t0 = 0;

  const logger = (() => {
    const at = (level: string) => (obj: unknown, msg?: unknown) =>
      logs.push({
        level,
        obj: (typeof obj === 'object' && obj !== null ? obj : {}) as Record<string, unknown>,
        msg: String(msg ?? (typeof obj === 'string' ? obj : '')),
      });
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') };
  })();

  /** Times every provider call without altering behaviour. */
  function timed<T extends object>(inner: T): T {
    return new Proxy(inner, {
      get(target, prop, recv) {
        const value = Reflect.get(target, prop, recv);
        if (typeof value !== 'function') return value;
        return async (...args: unknown[]) => {
          const startMs = Date.now();
          try {
            const out = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            const endMs = Date.now();
            stages.push({
              stage: String(prop), startMs, endMs, ms: endMs - startMs, ok: true,
              note: Array.isArray(out) ? `${out.length} items` : out === null ? 'null' : typeof out,
            });
            return out;
          } catch (err) {
            const endMs = Date.now();
            stages.push({
              stage: String(prop), startMs, endMs, ms: endMs - startMs, ok: false,
              note: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            });
            throw err;
          }
        };
      },
    });
  }

  let outcome: Awaited<ReturnType<typeof runComps>>;

  beforeAll(async () => {
    const config = loadConfig();
    expect(config.apifyToken, 'APIFY_TOKEN absent — this run cannot bill and cannot test').toBeTruthy();
    const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
    const provider = timed(new ApifyZillowProvider(config.apifyToken as string));

    t0 = Date.now();
    outcome = await runComps(ADDRESS, {
      provider: provider as never,
      cache: createCompsCache(supabase),
      detailCache: createDetailCache(supabase),
      logger,
      now: () => new Date(),
    } as never);

    // Durable artifact. The stores hold the rows; this holds the timing the
    // stores cannot express, and it is what makes the run reconstructable.
    const report = {
      address: ADDRESS,
      startedAt: new Date(t0).toISOString(),
      totalMs: Date.now() - t0,
      ok: outcome.ok,
      stages,
      logs,
      floor: DETAIL_MIN_REMAINING_MS,
      ceiling: PROVIDER_TIMEOUT_MS,
    };
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/COLD_ENRICHMENT_RUN.json', JSON.stringify(report, null, 2));
  }, 180_000);

  const stage = (name: string) => stages.find((s) => s.stage === name);

  it('INVALID GATE: the subject resolved and the detail batch actually RAN', () => {
    expect(outcome.ok, `the lookup failed outright: ${JSON.stringify(outcome)}`).toBe(true);
    // Asserted directly, never inferred from coverage: a warm detail cache
    // yields 5/5 with no batch, which would look like a pass and prove nothing.
    expect(
      stage('fetchDetailBatch'),
      'the detail batch never ran — detail was already warm (zpid-keyed, 90d, ' +
        'shared across nearby lookups) or the ceiling skipped it. Either way ' +
        'this run did not exercise the path it was authorized for.',
    ).toBeDefined();
  });

  it('FRONT HALF: elapsed at enrichment, measured — the number the stores cannot show', () => {
    const detail = stage('fetchDetailBatch');
    if (!detail) return;
    const elapsedAtDetail = detail.startMs - t0;
    const remainingAtDetail = PROVIDER_TIMEOUT_MS - elapsedAtDetail;
    // eslint-disable-next-line no-console
    console.log(
      `\nFRONT HALF  subject=${stage('fetchSubject')?.ms}ms  search=${stage('fetchSoldComps')?.ms}ms  ` +
        `hood=${stage('fetchNeighborhoodSales')?.ms ?? 'n/a'}ms\n` +
        `AT DETAIL   elapsed=${elapsedAtDetail}ms  remaining=${remainingAtDetail}ms  ` +
        `floor=${DETAIL_MIN_REMAINING_MS}ms\n` +
        `BATCH       ${detail.ms}ms (${detail.ok ? 'ok' : 'THREW'}) ${detail.note}\n`,
    );
    expect(
      remainingAtDetail,
      'enrichment began BELOW the floor, so the ceiling skip fired — record ' +
        'the front-half stage times from the report; this is the starvation case',
    ).toBeGreaterThan(DETAIL_MIN_REMAINING_MS);
  });

  it('COVERAGE: 5/5, and NEAR-MISS is reported as a finding rather than a pass', () => {
    if (!outcome.ok) return;
    const covered = outcome.comps.filter((c) => (c as { detail?: unknown }).detail !== undefined).length;
    const total = outcome.comps.length;
    expect(total, 'fewer comps than the cap — not the shape this run tests').toBe(MAX_COMPS_KEPT);
    expect(covered, `enrichment covered ${covered}/${total}`).toBe(total);

    const coverageLine = logs.find((l) => 'covered' in l.obj && 'total' in l.obj);
    expect(coverageLine, 'no coverage line logged — §14.14.2 rule 2 requires one on EVERY serve')
      .toBeDefined();

    const detail = stage('fetchDetailBatch');
    const remaining = detail ? PROVIDER_TIMEOUT_MS - (detail.startMs - t0) : 0;
    expect(
      remaining,
      `NEAR-MISS: 5/5 but enrichment started with only ${remaining}ms against a ` +
        `${DETAIL_MIN_REMAINING_MS}ms floor. Coverage alone would have reported ` +
        'this as a clean pass. Observed batches run 9.9s to 32.6s and the tail ' +
        "belongs to Apify's scheduling, so this margin is not reliably repeatable.",
    ).toBeGreaterThanOrEqual(2 * DETAIL_MIN_REMAINING_MS);
  });

  it('OVERRUN CHARACTERIZATION: what a batch that cannot finish actually does', () => {
    // The uncharacterized mode: started with less headroom than the batch
    // needs. Captured here from the real call rather than asserted — if this
    // run did not provoke it, it is characterized offline against the wrapped
    // provider instead, and this case records that it was not observed.
    const detail = stage('fetchDetailBatch');
    if (!detail) return;
    const remainingAtStart = PROVIDER_TIMEOUT_MS - (detail.startMs - t0);
    const overran = detail.ms > remainingAtStart;
    // eslint-disable-next-line no-console
    console.log(
      `OVERRUN     batch=${detail.ms}ms vs headroom=${remainingAtStart}ms -> ` +
        `${overran ? 'OVERRAN' : 'fit'}; threw=${!detail.ok}\n`,
    );
    if (overran) {
      expect(
        outcome.ok,
        'a batch that outran its headroom failed the whole comps run — ' +
          'enrichment is decoration and must degrade, never fail the serve',
      ).toBe(true);
    }
  });
});
