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
  ATTACHED_SUBJECT_TYPES,
  RAW_REFETCH_BELOW_VERSION,
  CENSUS_CACHE_TTL_DAYS,
  CENSUS_TIMEOUT_MS,
  DETAIL_CACHE_TTL_DAYS,
  DETAIL_BATCH_MAX_RETRIES,
  DETAIL_MIN_REMAINING_MS,
  DETAIL_RETRY_BACKOFF_MS,
  MAX_COMP_AGE_MONTHS,
  MIN_COMPS_TO_COMPUTE,
  SQFT_TOLERANCE,
  NEIGHBORHOOD_MIN_REMAINING_MS,
  NEIGHBORHOOD_RADIUS_MI,
  NEIGHBORHOOD_RESULTS_LIMIT,
  NEIGHBORHOOD_WINDOW_MONTHS,
  PROVIDER_MAX_RETRIES,
  PROVIDER_TIMEOUT_MS,
  RADIUS_TIERS_MI,
} from './config.js';
import { computeNeighborhoodAggregates, isWindowTruncated } from './aggregates.js';
import { attachDetails, detailBatchFor } from './detail.js';
import { SEARCH_RESULTS_LIMIT } from './providers/apifyZillow.js';
import { FAILURE_COPY } from './format.js';
import { dedupeSales, haversineMiles, median, monthsBetween, selectTiers, unionCandidatePools } from './filter.js';
import { cacheKey, hasUnitDesignator, normalizeAddress, stripUnitDesignator } from './normalize.js';
import { rankComps } from './rank.js';
import type { CensusCacheLike } from './cache/censusCache.js';
import type { DetailCacheLike } from './cache/detailCache.js';
import type { DemographicsProviderLike } from './providers/census.js';
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
  /**
   * Raw neighbourhood-sales payload (§14.16.1), riding the same row and
   * TTL. Nullable: rows predating the column fetch live ONCE on next touch
   * and cache. Aggregates are computed per serve from this — never stored.
   */
  rawNeighborhood?: RawComp[] | null;
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
  /**
   * Census demographics (§14.10). Provider absent ⇒ demographics never
   * attempted, no section renders (the CENSUS_API_KEY gate). Cache absent ⇒
   * every serve re-queries the (free) Census API.
   */
  censusProvider?: DemographicsProviderLike;
  censusCache?: CensusCacheLike;
  budget?: RunBudgetLike;
  logger?: LoggerLike;
  /** Injectable clock — pure code below never reads it directly. */
  now?: () => Date;
  /**
   * Injectable delay for the §14.14.2 retry backoff — defaults to a real
   * setTimeout; tests inject an instant resolve so the bounded-retry cases
   * do not sleep for real.
   */
  sleep?: (ms: number) => Promise<void>;
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
function computeFromRaw(
  subject: SubjectProperty,
  comps: RawComp[],
  neighborhoodSales: RawComp[] | null,
  now: Date,
  provider: string,
  fromCache: boolean,
): CompsOutcome {
  if ((subject.livingArea ?? 0) <= 0) return failure('SUBJECT_SQFT_UNKNOWN');

  // §14.19: the exhausted 1-mile aggregate payload joins the pool BEFORE
  // the filters — unioned sales face every gate identically, and
  // dedupeSales (inside selectTiers and candidateMedianPpsf) owns the
  // heavy cross-payload overlap, visibly.
  const pool = unionCandidatePools(comps, neighborhoodSales);
  const tier = selectTiers(subject, pool, now);
  if (tier.kept.length < MIN_COMPS_TO_COMPUTE) {
    // Operator ruling: when nothing was kept AND the fetched pool holds zero
    // comps of the subject's type, "the market is thin" is a claim we cannot
    // make — we know we didn't find the right pool (recorded: a condo
    // subject against a 39-comp pool of SFRs and mobile homes). Same code,
    // branched copy; the honesty guarantees don't move.
    // The "fetched pool" for the copy branch is the UNION — a same-type
    // comp arriving through the aggregate payload is still a right-pool
    // signal.
    const sameTypeInPool = pool.filter((c) => c.propertyType === subject.propertyType).length;
    return failure('TOO_FEW_COMPS', {
      kept: tier.kept.length,
      needed: MIN_COMPS_TO_COMPUTE,
      radiusTierMi: tier.radiusTierMi,
      ...(tier.kept.length === 0 && sameTypeInPool === 0 && pool.length > 0
        ? { pool: 'no_type_match' as const }
        : {}),
    });
  }

  const ranked = rankComps(subject, tier.kept, now);
  // §14.21: the thin-market disclosure's second signal — deduped count of
  // sold, in-band, same-type sales within 1 mile / 12 months over the
  // UNION pool. Pure arithmetic on the pool; NEVER feeds selection or
  // ranking (the comp set is byte-identical whether the disclosure fires).
  const subjectSqft = subject.livingArea ?? 0;
  const nearInBand = pool.filter((c) => {
    if (c.status.toUpperCase() !== 'SOLD' || !c.soldDate) return false;
    const m = monthsBetween(c.soldDate, now);
    if (m < 0 || m > MAX_COMP_AGE_MONTHS) return false;
    if (c.propertyType !== subject.propertyType) return false;
    const s = c.livingArea ?? 0;
    if (!(s > 0) || !(subjectSqft > 0) || Math.abs(s - subjectSqft) / subjectSqft > SQFT_TOLERANCE) return false;
    return haversineMiles(subject.lat, subject.lng, c.lat, c.lng) <= NEIGHBORHOOD_RADIUS_MI;
  });
  const nearInBandKept = dedupeSales(nearInBand).kept;
  const nearInBandSameTypeSales = nearInBandKept.length;
  // §14.23: the same pool pointed at prices — the outlier disclosure's
  // primary reference. The ppsf sample can be smaller than the count above
  // (a counted sale without a usable price/sqft pair carries no ppsf).
  // Like the count, this NEVER feeds selection or ranking.
  const nearPpsf = nearInBandKept
    .filter((c) => (c.soldPrice ?? 0) > 0 && (c.livingArea ?? 0) > 0)
    .map((c) => (c.soldPrice as number) / (c.livingArea as number));
  const nearInBandMedianPpsf = nearPpsf.length > 0 ? median(nearPpsf) : null;
  const nearInBandPpsfCount = nearPpsf.length;
  // §14.17 truncation honesty: flags describe the COMPS FETCH (the union's
  // 1-mile portion legitimately extends earlier — nearRingCompleteMi is
  // what says so). isWindowTruncated's slack covers the raw→mapped skip.
  const soldDates = comps.map((c) => c.soldDate).filter((d): d is string => d !== null).sort();
  return {
    ok: true,
    algoVersion: ALGO_VERSION,
    runId: randomUUID(),
    subject,
    radiusTierMi: tier.radiusTierMi,
    recencyTierMonths: tier.recencyTierMonths,
    searchTruncated: isWindowTruncated(comps.length, SEARCH_RESULTS_LIMIT),
    searchEarliestSoldDate: soldDates.length > 0 ? soldDates[0] : null,
    // §14.19: the aggregate payload, when present and itself un-truncated,
    // is a COMPLETE 1-mile/12-month universe — rungs at or inside that
    // radius claim their window honestly regardless of the wider fetch.
    nearRingCompleteMi:
      neighborhoodSales !== null &&
      neighborhoodSales.length > 0 &&
      !isWindowTruncated(neighborhoodSales.length, NEIGHBORHOOD_RESULTS_LIMIT)
        ? NEIGHBORHOOD_RADIUS_MI
        : null,
    nearInBandSameTypeSales,
    nearInBandMedianPpsf,
    nearInBandPpsfCount,
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
      return enrichAll({ ...cached.result, fromCache: true }, deps, key, now, startedAtMs, false, cached);
    }
    // Raw payload cached under an older algo: recompute WITHOUT re-billing —
    // UNLESS the raw predates the §14.17 fetch regime
    // (RAW_REFETCH_BELOW_VERSION): payloads fetched under the 40-item
    // uncapped-window search are ~days deep in dense markets, and a
    // recompute would rebuild a result over that truncated pool and label
    // it with a 12-month window. Those rows fall through to a REFETCH
    // (operator ruling; one-time cost per old row).
    if (cached.rawSubject && cached.algoVersion >= RAW_REFETCH_BELOW_VERSION) {
      // §14.19: the recompute unions BOTH raw payloads from the row — this
      // is exactly why v4 rows recompute rather than refetch (both raws are
      // sound and already paid for).
      const recomputed = computeFromRaw(
        cached.rawSubject,
        cached.rawComps,
        cached.rawNeighborhood ?? null,
        now(),
        cached.provider,
        true,
      );
      const updated: CachedComps = {
        ...cached,
        result: recomputed,
        algoVersion: ALGO_VERSION,
      };
      await writeCache(deps, logger, updated);
      return recomputed.ok ? enrichAll(recomputed, deps, key, now, startedAtMs, false, updated) : recomputed;
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
      // §14.17: widest radius AND the full recency window, both explicit at
      // the seam that spends money — one fetch serves every rung client-side.
      deps.provider.fetchSoldComps(
        subject as SubjectProperty,
        RADIUS_TIERS_MI[RADIUS_TIERS_MI.length - 1],
        MAX_COMP_AGE_MONTHS,
      ),
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

  // §14.19 item 6: the neighbourhood payload is acquired BEFORE compute —
  // it joins the candidate pool, so it can no longer wait for the
  // enrichment stage on the live path. Ceiling rule as in enrichment; NO
  // retry (pinned); failure is NON-FATAL twice over — the pool degrades to
  // comps-only AND the aggregates section renders unavailable. The lookup's
  // budget unit was consumed at the provider stage above.
  let neighborhoodSales: RawComp[] | null = null;
  if (deps.provider.fetchNeighborhoodSales) {
    const remainingMs = PROVIDER_TIMEOUT_MS - (now().getTime() - startedAtMs);
    if (remainingMs < NEIGHBORHOOD_MIN_REMAINING_MS) {
      logger?.info?.({ cacheKey: key, remainingMs }, 'neighborhood fetch skipped — whole-pipeline ceiling');
    } else {
      try {
        neighborhoodSales = await deps.provider.fetchNeighborhoodSales(
          subject,
          NEIGHBORHOOD_RADIUS_MI,
          NEIGHBORHOOD_WINDOW_MONTHS,
          { timeoutMs: remainingMs },
        );
      } catch (err) {
        logger?.warn(
          { err: err instanceof Error ? err.message : String(err), cacheKey: key },
          'neighborhood fetch failed — pool stays comps-only; section renders unavailable',
        );
      }
    }
  }

  // §14.22 (RULING 1 + FINDING-015, live path only): a BARE multi-unit
  // address must ASK for the unit, not silently run one unit of the
  // complex. THREE conjunctive conditions — the original build's
  // one-sibling test let a plain SFR with one stale unit-bearing pool
  // card receive an ask it could not satisfy (INSPECTOR's demonstrated
  // failure). Live-path-only is deliberate — recompute has no raw input
  // string (normalization strips "#"), so detection there would
  // false-positive on unit-typed members.
  if (!hasUnitDesignator(rawAddress)) {
    // Condition 2: the RESOLVED subject shows unit evidence — a unit
    // designator, OR an attached-type resolution. The attached-type arm
    // is a flagged deviation from the ruling's literal text (§14.22):
    // the raw-verified Mesquite card (spike-mesquite-bare-detail.json)
    // carries NO unit in any field yet IS a silently-picked 804-sqft
    // CONDO. An SFR/MANUFACTURED resolution is a whole property —
    // nothing ambiguous to ask about, regardless of the pool.
    const resolvedShowsUnitEvidence =
      hasUnitDesignator(subject.address) || ATTACHED_SUBJECT_TYPES.includes(subject.propertyType);
    // Condition 3: >= 2 DISTINCT unit cards at the subject's street —
    // distinct by normalized street-part+unit (ZIP variants of one unit
    // collapse), different zpid. One lone unit-bearing card is not
    // evidence of a multi-unit building; it is the stale-card false
    // positive this condition exists to block.
    // Street BASE, unit stripped: a resolved address carrying its unit must
    // still prefix-match its sibling cards (stripUnitDesignator shares the
    // designator regex with hasUnitDesignator).
    const subjectStreet = normalizeAddress(stripUnitDesignator(subject.address.split(',')[0]));
    const distinctUnitCards = new Set(
      unionCandidatePools(comps, neighborhoodSales)
        .filter(
          (c) =>
            c.zpid !== subject.zpid &&
            normalizeAddress(c.address.split(',')[0]).startsWith(subjectStreet) &&
            hasUnitDesignator(c.address),
        )
        .map((c) => normalizeAddress(c.address.split(',')[0])),
    );
    if (resolvedShowsUnitEvidence && distinctUnitCards.size >= 2) {
      logger?.info?.(
        { cacheKey: key, guard: 'multi_unit_bare_address' },
        'bare address resolves to one unit of a multi-unit building — asking for the unit',
      );
      const ask = failure('ADDRESS_NOT_FOUND', { resolution: 'unit_mismatch', inputHasUnit: false });
      // Cached WITHOUT raw payloads, deliberately: detection is live-only,
      // so a future ALGO bump recomputing from raw would flip this ask into
      // a silently-served unit. No rawSubject ⇒ a bump refetches instead,
      // and the detection runs again. Repeat bare-address lookups inside
      // the TTL still serve this cached ask at zero cost.
      await writeCache(deps, logger, {
        cacheKey: key,
        normalizedAddress: normalized,
        rawSubject: null,
        rawComps: [],
        rawNeighborhood: null,
        result: ask,
        algoVersion: ALGO_VERSION,
        provider: deps.provider.name,
        expiresAt: new Date(now().getTime() + CACHE_TTL_MS).toISOString(),
      });
      return ask;
    }
  }

  const outcome = computeFromRaw(subject, comps, neighborhoodSales, now(), deps.provider.name, false);

  // The cache stores the DETAIL-FREE result on purpose (§14.14 rule 4):
  // detail lives in its own zpid-keyed cache with a longer TTL and is
  // re-attached on every serve. Since §14.19 the neighbourhood RAW rides
  // the SAME initial write — one entry, both payloads; the enrichment step
  // finds it in hand and neither re-fetches nor re-upserts on this path.
  const entry: CachedComps = {
    cacheKey: key,
    normalizedAddress: normalized,
    rawSubject: subject,
    rawComps: comps,
    rawNeighborhood: neighborhoodSales,
    result: outcome,
    algoVersion: ALGO_VERSION,
    provider: deps.provider.name,
    expiresAt: new Date(now().getTime() + CACHE_TTL_MS).toISOString(),
  };
  await writeCache(deps, logger, entry);

  return outcome.ok ? enrichAll(outcome, deps, key, now, startedAtMs, true, entry) : outcome;
}

const DETAIL_CACHE_TTL_MS = DETAIL_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const CENSUS_CACHE_TTL_MS = CENSUS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * ONE cap unit per Apify-touching lookup, SHARED across the decoration
 * fetches (§14.16.1): on cache-hit paths whichever billed fetch fires
 * first consumes the unit and the rest ride it. Mutable token, threaded.
 */
interface BudgetState {
  consumed: boolean;
}

/**
 * The full post-compute decoration chain: detail (§14.14) → neighbourhood
 * aggregates (§14.16.1, needs the detail-enriched comps for the DOM line)
 * → demographics (§14.10, free, last so billed fetches see the most
 * ceiling headroom).
 */
async function enrichAll(
  result: CompsResult,
  deps: RunCompsDeps,
  key: string,
  now: () => Date,
  startedAtMs: number,
  budgetConsumed: boolean,
  entry: CachedComps | null,
): Promise<CompsResult> {
  const budgetState: BudgetState = { consumed: budgetConsumed };
  const withDetail = await enrichWithDetail(result, deps, key, now, startedAtMs, budgetState);
  const withNeighborhood = await enrichWithNeighborhood(withDetail, deps, key, now, startedAtMs, budgetState, entry);
  return enrichWithDemographics(withNeighborhood, deps, key, now, startedAtMs);
}

/**
 * Neighbourhood aggregates (§14.16.1) — decoration, never a dependency.
 * Raw sales come from the comps_cache row when present (zero spend); a
 * live fetch is ONE actor run behind the shared budget unit and the
 * pipeline ceiling, with NO retry (pinned: the unavailable line is the
 * retry). The computed aggregates are never stored — only the raw payload
 * is, back onto the same row.
 */
async function enrichWithNeighborhood(
  result: CompsResult,
  deps: RunCompsDeps,
  key: string,
  now: () => Date,
  startedAtMs: number,
  budgetState: BudgetState,
  entry: CachedComps | null,
): Promise<CompsResult> {
  if (!deps.provider.fetchNeighborhoodSales) return result; // incapable ⇒ absent ⇒ no section
  const logger = deps.logger;

  let rawSales = entry?.rawNeighborhood ?? null;
  if (!rawSales) {
    const remainingMs = PROVIDER_TIMEOUT_MS - (now().getTime() - startedAtMs);
    if (remainingMs < NEIGHBORHOOD_MIN_REMAINING_MS) {
      logger?.info?.(
        { cacheKey: key, remainingMs },
        'neighborhood fetch skipped — whole-pipeline ceiling; comps render without the section',
      );
      return { ...result, neighborhood: null };
    }
    if (!budgetState.consumed && deps.budget && !deps.budget.tryConsume(now())) {
      logger?.info?.({ cacheKey: key }, 'neighborhood fetch skipped — daily cap; comps render without the section');
      return { ...result, neighborhood: null };
    }
    budgetState.consumed = true;
    try {
      rawSales = await deps.provider.fetchNeighborhoodSales(
        result.subject,
        NEIGHBORHOOD_RADIUS_MI,
        NEIGHBORHOOD_WINDOW_MONTHS,
        { timeoutMs: remainingMs },
      );
    } catch (err) {
      logger?.warn(
        { err: err instanceof Error ? err.message : String(err), cacheKey: key },
        'neighborhood fetch failed — comps render without the section',
      );
      return { ...result, neighborhood: null };
    }
    if (deps.cache && entry) {
      try {
        entry.rawNeighborhood = rawSales;
        await deps.cache.set(entry);
      } catch (err) {
        logger?.warn({ err, cacheKey: key }, 'neighborhood raw cache write failed — served uncached');
      }
    }
  }

  return {
    ...result,
    neighborhood: computeNeighborhoodAggregates(rawSales, result.subject, result.comps, now()),
  };
}

/**
 * Census demographics (§14.10) — decoration, never a dependency, and free:
 * no budget interaction at all. Three-state outcome on the result:
 * `demographics` stays ABSENT when no provider is configured (no section
 * renders), becomes NULL on any failure (the section renders "unavailable"),
 * and carries the tract figures on success. Tract resolution runs per serve
 * (free, fast); the ACS figures come from the tract-keyed cache when they
 * can — they change once a year.
 */
async function enrichWithDemographics(
  result: CompsResult,
  deps: RunCompsDeps,
  key: string,
  now: () => Date,
  startedAtMs: number,
): Promise<CompsResult> {
  const provider = deps.censusProvider;
  if (!provider) return result;
  const logger = deps.logger;

  // The §14.14 rule-5 ceiling covers the WHOLE pipeline, demographics
  // included: clamp each Census call to the remaining headroom and give up
  // (non-fatally) when none is left.
  const remainingMs = PROVIDER_TIMEOUT_MS - (now().getTime() - startedAtMs);
  if (remainingMs <= 0) {
    logger?.info?.({ cacheKey: key }, 'demographics skipped — whole-pipeline ceiling');
    return { ...result, demographics: null };
  }
  const timeoutMs = Math.min(CENSUS_TIMEOUT_MS, remainingMs);

  try {
    const tract = await provider.resolveTract(result.subject.lat, result.subject.lng, { timeoutMs });
    if (!tract) {
      logger?.info?.({ cacheKey: key }, 'demographics unavailable — coordinates resolved to no census tract');
      return { ...result, demographics: null };
    }

    if (deps.censusCache) {
      try {
        const cached = await deps.censusCache.get(tract.geoid, now());
        if (cached) return { ...result, demographics: cached };
      } catch (err) {
        logger?.warn({ err, cacheKey: key }, 'census cache read failed — querying live');
      }
    }

    const demographics = await provider.fetchDemographics(tract, {
      timeoutMs,
      // BUG-013: the domain floor's finding surfaces HERE, at WARN, with the
      // raw value and the tract. The member sees an em-dash; this line is
      // how we learn Census grew a seventh annotation value.
      onUnrecognized: (anomaly) =>
        logger?.warn(
          { variable: anomaly.variable, value: anomaly.value, tractGeoid: anomaly.tractGeoid },
          'unrecognised negative ACS value — rendered unavailable; possible new Census annotation',
        ),
    });
    if (deps.censusCache) {
      try {
        await deps.censusCache.set(
          tract.geoid,
          demographics,
          new Date(now().getTime() + CENSUS_CACHE_TTL_MS).toISOString(),
        );
      } catch (err) {
        logger?.warn({ err, cacheKey: key }, 'census cache write failed — demographics served uncached');
      }
    }
    return { ...result, demographics };
  } catch (err) {
    // Every Census failure — timeout, HTTP, network, parse — degrades to the
    // "unavailable" line (§14.10). NO retry: free API, decorative data; the
    // rendered line is the retry.
    logger?.warn(
      { err: err instanceof Error ? err.message : String(err), cacheKey: key },
      'census lookup failed — demographics unavailable',
    );
    return { ...result, demographics: null };
  }
}

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
 *  - `budgetState` is the SHARED lookup unit (§14.16.1): on the live path
 *    it starts consumed (the provider stage paid); on cache-hit paths the
 *    first billed decoration fetch consumes it and later ones ride it.
 *    Denial ⇒ skip, never RATE_LIMITED.
 */
async function enrichWithDetail(
  result: CompsResult,
  deps: RunCompsDeps,
  key: string,
  now: () => Date,
  startedAtMs: number,
  budgetState: BudgetState,
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
    // Batch size = the final kept set — already capped through ranking, and
    // clamped again by detailBatchFor (§14.14 rule 2: bounded by
    // MAX_COMPS_KEPT, never an independent constant).
    const addresses = detailBatchFor(missing.map((c) => c.comp.address));
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    // §14.14.2: ONE bounded retry on transient throw or EMPTY/SHORT batch
    // (fewer TOTAL items than addresses asked — the actor dropped work). A
    // complete batch carrying isValid:false items is an ANSWER: retrying it
    // re-bills for addresses Zillow already said are invalid. Every attempt
    // re-checks the ceiling — the retry never eats it.
    for (let attempt = 0; attempt <= DETAIL_BATCH_MAX_RETRIES; attempt++) {
      const remainingMs = PROVIDER_TIMEOUT_MS - (now().getTime() - startedAtMs);
      if (remainingMs < DETAIL_MIN_REMAINING_MS) {
        // WARN, not info (§14.14.2 rule 2): this branch produces a 0/N and
        // was one of the two silent candidates in the Daffodil incident.
        logger?.warn(
          { cacheKey: key, remainingMs, attempt },
          'detail batch skipped — whole-pipeline ceiling; comps render without detail',
        );
        break;
      }
      if (!budgetState.consumed && deps.budget && !deps.budget.tryConsume(now())) {
        logger?.info?.({ cacheKey: key }, 'detail batch skipped — daily cap; comps render without detail');
        break;
      }
      budgetState.consumed = true;
      try {
        const got = await deps.provider.fetchDetailBatch(addresses, { timeoutMs: remainingMs });
        // Keep the best answer seen — a short retry never discards a fuller
        // first attempt.
        if (got.length > items.length) items = got;
        if (got.length >= addresses.length) break;
        logger?.warn(
          { cacheKey: key, requested: addresses.length, received: got.length, attempt },
          'detail batch returned short — §14.14.2 bounded retry',
        );
      } catch (err) {
        // §14.14.2 rule 3: no swallowed exceptions — class + message, always.
        logger?.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            errClass: err instanceof Error ? err.constructor.name : typeof err,
            cacheKey: key,
            attempt,
          },
          'detail batch failed — comps render without detail',
        );
        if (!isTransient(err)) break; // 4xx / non-transient: same bill for the same mistake
      }
      if (attempt < DETAIL_BATCH_MAX_RETRIES) await sleep(DETAIL_RETRY_BACKOFF_MS);
    }
  }

  const join = attachDetails(result.comps, cachedDetails, items);
  if (join.zpidMismatches > 0) {
    // §14.14.3 rule 1: a batch item answered the comp's address with a
    // DIFFERENT property's zpid — rejected at the join, loudly. Counts
    // only; addresses stay out of logs (§3).
    logger?.warn(
      { cacheKey: key, zpidMismatches: join.zpidMismatches },
      'detail batch items rejected — zpid contradicts the comp (wrong-property payload)',
    );
  }
  // §14.14.2 rule 2: coverage on EVERY served result — INFO always, WARN on
  // 0/N. The line the Daffodil incident never got to write.
  {
    const covered = join.comps.filter((c) => c.detail !== undefined).length;
    const total = join.comps.length;
    if (covered === 0 && total > 0) {
      logger?.warn({ cacheKey: key, covered, total }, 'enrichment coverage 0/N — every comp served without detail');
    } else {
      logger?.info?.({ cacheKey: key, covered, total }, 'enrichment coverage');
    }
  }
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
