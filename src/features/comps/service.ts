/**
 * runComps() — the ONLY place async I/O and pure logic meet (CONTRACT §2).
 *
 * Shape of the orchestration:
 *   normalize → cache lookup → (recompute-from-raw | provider) → pure
 *   pipeline (filter → rank → arv) → cache write → CompsOutcome
 *
 * Everything falls out as a discriminated union; nothing user-facing is ever
 * thrown from here. Provider exceptions are caught and mapped to failure
 * codes; the failure MESSAGE is minted from format.ts's FAILURE_COPY table so
 * the service and the chat can never disagree on wording.
 *
 * The provider arrives through the AppDeps seam (CONTRACT §6) — this module
 * NEVER constructs one, which is what keeps every path here drivable offline.
 */
import { randomUUID } from 'node:crypto';
import {
  ALGO_VERSION,
  DETAIL_CACHE_TTL_DAYS,
  DETAIL_MIN_REMAINING_MS,
  MIN_COMPS_TO_COMPUTE,
  PROVIDER_MAX_RETRIES,
  PROVIDER_TIMEOUT_MS,
  RADIUS_TIERS_MI,
} from './config.js';
import { attachDetails, detailBatchFor } from './detail.js';
import { FAILURE_COPY } from './format.js';
import { selectTiers } from './filter.js';
import { cacheKey, hasUnitDesignator, normalizeAddress } from './normalize.js';
import { rankComps } from './rank.js';
import type { DetailCacheLike } from './cache/detailCache.js';
import type {
  CompDetail,
  CompsFailure,
  CompsFailureCode,
  CompsOutcome,
  CompsResult,
  RawComp,
  SubjectProperty,
} from './types.js';
import {
  ProviderHttpError,
  ProviderNetworkError,
  ProviderTimeoutError,
  type DetailBatchItem,
  type PropertyDataProvider,
} from './providers/types.js';

/** Minimal logger seam matching src/server/logger.ts; info is optional (Fastify has it, the console fallback may not). */
interface LoggerLike {
  warn(obj: Record<string, unknown>, msg: string): void;
  info?(obj: Record<string, unknown>, msg: string): void;
}

/**
 * What the service needs from the cache — implemented by cache/compsCache.ts.
 * Raw payloads are stored SEPARATELY from the computed result so an
 * ALGO_VERSION bump recomputes from raw instead of re-billing Apify
 * (CONTRACT §7 — the single most important cost decision in the feature).
 */
export interface CompsCacheLike {
  get(key: string): Promise<CachedComps | null>;
  set(entry: CachedComps): Promise<void>;
}

export interface CachedComps {
  cacheKey: string;
  normalizedAddress: string;
  rawSubject: SubjectProperty | null;
  rawComps: RawComp[];
  result: CompsOutcome | null;
  algoVersion: number;
  provider: string;
  expiresAt: string; // ISO
}

/**
 * Daily spend guard (CONTRACT §3/§9/§14.14): counts LOOKUPS THAT TOUCH
 * APIFY — one unit per provider-hitting lookup, no matter how many actor
 * runs it spawns (up to 3 with detail: subject + search + one batched
 * detail). Lookups served entirely from cache are free; a cache-hit lookup
 * needing only a live detail batch consumes one unit, and a denial there
 * degrades to comps-without-detail, never RATE_LIMITED. In-memory by design:
 * it resets on deploy, which can only ever UNDER-count (spend a little more
 * than the cap), never block a member wrongly. Injectable so tests drive it
 * deterministically.
 */
export interface RunBudgetLike {
  /** True if a provider run may start now; false ⇒ RATE_LIMITED. */
  tryConsume(now: Date): boolean;
}

export function createDailyRunBudget(dailyCap: number): RunBudgetLike {
  let day = '';
  let used = 0;
  return {
    tryConsume(now: Date): boolean {
      const today = now.toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= dailyCap) return false;
      used += 1;
      return true;
    },
  };
}

export interface RunCompsDeps {
  provider: PropertyDataProvider;
  cache?: CompsCacheLike;
  /** Zpid-keyed detail cache (§14.14 rule 4). Absent ⇒ every serve re-fetches detail live (within budget/ceiling). */
  detailCache?: DetailCacheLike;
  budget?: RunBudgetLike;
  logger?: LoggerLike;
  /** Injectable clock — pure code below never reads it directly. */
  now?: () => Date;
}

/**
 * Retry policy (CONTRACT §3/§6), enforced at the provider SEAM so it is
 * uniform for every implementation and offline-assertable by spy count:
 * ONE retry on transient failures (timeout / 5xx / network), ZERO on 4xx —
 * a 4xx re-sent is the same bill for the same mistake, and it scales with
 * every mistyped address forever.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof ProviderTimeoutError || err instanceof ProviderNetworkError) return true;
  if (err instanceof ProviderHttpError) return err.status >= 500;
  return false;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= PROVIDER_MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

function failure(code: CompsFailureCode, detail?: CompsFailure['detail']): CompsFailure {
  return {
    ok: false,
    algoVersion: ALGO_VERSION,
    code,
    message: FAILURE_COPY[code](detail),
    ...(detail ? { detail } : {}),
  };
}

/**
 * The pure back half, shared by the live path and the recompute-from-raw
 * path — one implementation, so a cached recompute can never drift from a
 * live run on the same data.
 */
function computeFromRaw(subject: SubjectProperty, comps: RawComp[], now: Date, provider: string, fromCache: boolean): CompsOutcome {
  if ((subject.livingArea ?? 0) <= 0) return failure('SUBJECT_SQFT_UNKNOWN');

  const tier = selectTiers(subject, comps, now);
  if (tier.kept.length < MIN_COMPS_TO_COMPUTE) {
    // Operator ruling: when nothing was kept AND the fetched pool holds zero
    // comps of the subject's type, "the market is thin" is a claim we cannot
    // make — we know we didn't find the right pool (recorded: a condo
    // subject against a 39-comp pool of SFRs and mobile homes). Same code,
    // branched copy; the honesty guarantees don't move.
    const sameTypeInPool = comps.filter((c) => c.propertyType === subject.propertyType).length;
    return failure('TOO_FEW_COMPS', {
      kept: tier.kept.length,
      needed: MIN_COMPS_TO_COMPUTE,
      radiusTierMi: tier.radiusTierMi,
      ...(tier.kept.length === 0 && sameTypeInPool === 0 && comps.length > 0
        ? { pool: 'no_type_match' as const }
        : {}),
    });
  }

  const ranked = rankComps(subject, tier.kept, now);
  return {
    ok: true,
    algoVersion: ALGO_VERSION,
    runId: randomUUID(),
    subject,
    radiusTierMi: tier.radiusTierMi,
    recencyTierMonths: tier.recencyTierMonths,
    comps: ranked,
    rejected: tier.rejected,
    fromCache,
    provider,
  };
}

export async function runComps(rawAddress: string, deps: RunCompsDeps): Promise<CompsOutcome> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger;
  // The whole-pipeline clock (§14.14 rule 5): the detail batch only gets what
  // remains of PROVIDER_TIMEOUT_MS after everything before it.
  const startedAtMs = now().getTime();
  const normalized = normalizeAddress(rawAddress);
  if (!normalized) return failure('ADDRESS_NOT_FOUND');
  const key = cacheKey(normalized);

  // --- Cache -----------------------------------------------------------
  // Failures here degrade to a live run — a broken cache must cost money,
  // never block a member. Logged loudly either way (cache key, NEVER the
  // raw address, at this level — CONTRACT §3).
  let cached: CachedComps | null = null;
  if (deps.cache) {
    try {
      cached = await deps.cache.get(key);
    } catch (err) {
      logger?.warn({ err, cacheKey: key }, 'comps cache read failed — falling through to live run');
    }
  }

  if (cached && Date.parse(cached.expiresAt) > now().getTime()) {
    // Fresh hit with current algo: serve as-is (plus detail enrichment —
    // detail is attached on EVERY serve and never stored in comps_cache).
    if (cached.result && cached.algoVersion === ALGO_VERSION) {
      if (!cached.result.ok) return cached.result;
      return enrichWithDetail({ ...cached.result, fromCache: true }, deps, key, now, startedAtMs, false);
    }
    // Raw payload cached under an older algo: recompute WITHOUT re-billing.
    if (cached.rawSubject) {
      const recomputed = computeFromRaw(cached.rawSubject, cached.rawComps, now(), cached.provider, true);
      await writeCache(deps, logger, {
        ...cached,
        result: recomputed,
        algoVersion: ALGO_VERSION,
      });
      return recomputed.ok ? enrichWithDetail(recomputed, deps, key, now, startedAtMs, false) : recomputed;
    }
  }

  // --- Provider --------------------------------------------------------
  if (deps.budget && !deps.budget.tryConsume(now())) return failure('RATE_LIMITED');

  let subject: SubjectProperty | null;
  let comps: RawComp[];
  try {
    const looked = await withRetry(() => deps.provider.lookupSubject(rawAddress));
    if (looked === null) return failure('ADDRESS_NOT_FOUND', { resolution: 'not_found' });
    if ('miss' in looked) {
      // Operator ruling: same code, branched copy — and COUNTED. If this
      // fires often in production, SUBJECT_RESOLUTION_MISMATCH earns its own
      // code properly, with tests. cacheKey, never the raw address.
      logger?.info?.(
        { cacheKey: key, guard: looked.guard },
        'comps subject resolution mismatch — provider returned a different property',
      );
      // inputHasUnit branches the copy: "double-check the unit number" is
      // only sayable when the member actually typed one.
      return failure('ADDRESS_NOT_FOUND', {
        resolution: 'unit_mismatch',
        inputHasUnit: hasUnitDesignator(rawAddress),
      });
    }
    subject = looked;
    // One fetch at the WIDEST tier; the pure tier logic narrows from there.
    // Fetching per-tier would triple the bill for thin markets — the exact
    // case where money is being wasted on a likely failure.
    comps = await withRetry(() =>
      deps.provider.fetchSoldComps(subject as SubjectProperty, RADIUS_TIERS_MI[RADIUS_TIERS_MI.length - 1]),
    );
  } catch (err) {
    if (err instanceof ProviderTimeoutError) return failure('PROVIDER_TIMEOUT');
    if (
      err instanceof ProviderHttpError ||
      err instanceof ProviderNetworkError ||
      err instanceof SyntaxError // a provider leaking malformed-body JSON errors is a transport failure, not our bug
    ) {
      logger?.warn({ err: err.message, cacheKey: key }, 'comps provider error');
      return failure('PROVIDER_ERROR');
    }
    throw err; // programmer error — let it surface, do not dress it as a provider issue
  }

  const outcome = computeFromRaw(subject, comps, now(), deps.provider.name, false);

  // The cache stores the DETAIL-FREE result on purpose (§14.14 rule 4):
  // detail lives in its own zpid-keyed cache with a longer TTL and is
  // re-attached on every serve, so the two lifetimes never entangle.
  await writeCache(deps, logger, {
    cacheKey: key,
    normalizedAddress: normalized,
    rawSubject: subject,
    rawComps: comps,
    result: outcome,
    algoVersion: ALGO_VERSION,
    provider: deps.provider.name,
    expiresAt: new Date(now().getTime() + CACHE_TTL_MS).toISOString(),
  });

  return outcome.ok ? enrichWithDetail(outcome, deps, key, now, startedAtMs, true) : outcome;
}

const DETAIL_CACHE_TTL_MS = DETAIL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Detail enrichment (§14.14) — decoration, never a dependency: every exit
 * from this function returns a servable CompsResult, and no throw escapes.
 *
 * Order: zpid cache → (ceiling check → budget check → ONE live batch for the
 * misses) → pure join → cache write for what the batch bought.
 *
 * Deviations pinned in the contract:
 *  - NO retry on the detail batch (unlike the subject/search seam policy):
 *    a retry doubles the bill for decoration and eats the pipeline ceiling;
 *    the degradation path (em-dashes) is the retry.
 *  - `budgetConsumed` distinguishes the live path (this lookup already
 *    consumed its cap unit — detail rides inside it) from cache-hit paths
 *    (a live detail batch is this lookup's FIRST actor run, so it consumes
 *    the unit; denial ⇒ skip, never RATE_LIMITED).
 */
async function enrichWithDetail(
  result: CompsResult,
  deps: RunCompsDeps,
  key: string,
  now: () => Date,
  startedAtMs: number,
  budgetConsumed: boolean,
): Promise<CompsResult> {
  if (result.comps.length === 0) return result;
  const logger = deps.logger;

  let cachedDetails: Record<string, CompDetail> = {};
  if (deps.detailCache) {
    try {
      cachedDetails = await deps.detailCache.getMany(
        result.comps.map((c) => c.comp.zpid).filter((z) => z.length > 0),
        now(),
      );
    } catch (err) {
      logger?.warn({ err, cacheKey: key }, 'detail cache read failed — enriching without it');
    }
  }

  const missing = result.comps.filter((c) => !cachedDetails[c.comp.zpid]);
  let items: DetailBatchItem[] = [];
  if (missing.length > 0 && deps.provider.fetchDetailBatch) {
    const remainingMs = PROVIDER_TIMEOUT_MS - (now().getTime() - startedAtMs);
    if (remainingMs < DETAIL_MIN_REMAINING_MS) {
      logger?.info?.(
        { cacheKey: key, remainingMs },
        'detail batch skipped — whole-pipeline ceiling; comps render without detail',
      );
    } else if (!budgetConsumed && deps.budget && !deps.budget.tryConsume(now())) {
      logger?.info?.({ cacheKey: key }, 'detail batch skipped — daily cap; comps render without detail');
    } else {
      try {
        // Batch size = the final kept set — already capped through ranking,
        // and clamped again by detailBatchFor (§14.14 rule 2: bounded by
        // MAX_COMPS_KEPT, never an independent constant).
        items = await deps.provider.fetchDetailBatch(
          detailBatchFor(missing.map((c) => c.comp.address)),
          { timeoutMs: remainingMs },
        );
      } catch (err) {
        logger?.warn(
          { err: err instanceof Error ? err.message : String(err), cacheKey: key },
          'detail batch failed — comps render without detail',
        );
      }
    }
  }

  const join = attachDetails(result.comps, cachedDetails, items);
  if (join.fetched.length > 0 && deps.detailCache) {
    try {
      await deps.detailCache.setMany(
        join.fetched,
        new Date(now().getTime() + DETAIL_CACHE_TTL_MS).toISOString(),
      );
    } catch (err) {
      logger?.warn({ err, cacheKey: key }, 'detail cache write failed — details served uncached');
    }
  }
  if (join.missing > 0) {
    // Count only — §14.14 rule 3 says which comps failed is visible to US,
    // and the em-dashes say it to the member; raw addresses stay out of logs.
    logger?.info?.({ cacheKey: key, missing: join.missing }, 'comps served with missing detail fields');
  }
  return { ...result, comps: join.comps };
}

import { CACHE_TTL_DAYS } from './config.js';
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

async function writeCache(deps: RunCompsDeps, logger: LoggerLike | undefined, entry: CachedComps): Promise<void> {
  if (!deps.cache) return;
  try {
    await deps.cache.set(entry);
  } catch (err) {
    logger?.warn({ err, cacheKey: entry.cacheKey }, 'comps cache write failed — result served uncached');
  }
}
