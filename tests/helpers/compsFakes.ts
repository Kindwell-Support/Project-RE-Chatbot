/**
 * Fakes for the comps feature: a provider spy and a Supabase double that knows
 * about `session_state` and `comps_cache`.
 *
 * Same principle as `tests/helpers/fakes.ts` — fake at the CLIENT boundary, let
 * the real service, agent loop and tool runners execute. No `vi.mock`.
 *
 * ---------------------------------------------------------------------------
 * PINNED SUPABASE CALL SHAPES — CONTRACT §8, resolved by BLOCKED-0008.
 *
 *   read   .from('session_state').select('state').eq('session_id', id).maybeSingle()
 *   write  .from('session_state').upsert({ session_id, state, updated_at })
 *
 * The double was permissive while these were unknown. It is now NARROW on
 * purpose: any other shape against `session_state` THROWS with a message
 * naming the pinned one.
 *
 * That is the whole point. A double that quietly absorbs `.single()`,
 * `.update().eq()` or `.insert()` would let a genuine wiring bug pass a green
 * suite — which is the exact class of failure this repo has already shipped
 * once (the frozen $148,466: an untestable seam and a silent default).
 *
 * `state` is ONE jsonb column. The comps block lives at `state.comps` and is
 * written whole or not at all, so atomicity comes from the schema rather than
 * from discipline. The tests assert the guarantee holds anyway.
 * ---------------------------------------------------------------------------
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ProviderTimeoutError,
  ProviderHttpError,
  ProviderNetworkError,
} from '../../src/features/comps/providers/types.js';
import { mapDetailBatchItems } from '../../src/features/comps/providers/apifyZillow.js';

// ===========================================================================
// Provider spy — CONTRACT §6
// ===========================================================================

export interface ProviderCall {
  method: 'lookupSubject' | 'fetchSoldComps' | 'fetchDetailBatch' | 'fetchNeighborhoodSales';
  arg: string;
  radiusMi?: number;
  /** fetchNeighborhoodSales only — the §14.16 window, asserted by CASE 1. */
  windowMonths?: number;
  /** fetchDetailBatch only — the addresses the batch was asked for. */
  addresses?: string[];
}

export type ProviderFailure =
  | { kind: 'timeout' }
  | { kind: 'http'; status: number }
  | { kind: 'network' }
  | { kind: 'malformed' };

export interface ProviderSpyOptions {
  name?: string;
  /** Returned by lookupSubject. `null` means ADDRESS_NOT_FOUND. */
  subject?: unknown | null;
  /** Returned by fetchSoldComps. */
  comps?: unknown[];
  /**
   * Model the REAL search actor's cap (§14.6 / the Sierra Vista pool).
   *
   * Zillow returns the NEWEST `resultsLimit` sales for the box. Without a
   * server-side window that is "the newest N regardless of age" — which in a
   * dense market is an eleven-day pool. WITH a window the server bounds the
   * set first, so the cap bites on a set that already spans the window.
   *
   * A spy that ignores this returns whatever it was handed and cannot
   * distinguish a windowed fetch from an unwindowed one — which would let the
   * pool-depth cases pass against the unfixed build. Standing lesson from the
   * provider-error fake: a double that diverges from the real semantics does
   * not just miss bugs, it hides them.
   */
  truncateTo?: number;
  /** Throw on lookupSubject instead of returning. */
  failSubject?: ProviderFailure;
  /** Throw on fetchSoldComps instead of returning. */
  failComps?: ProviderFailure;
  /** Fail only the first N calls, then succeed — for retry-policy tests. */
  failFirstNCalls?: number;
  /** Resolve after this many ms, to exercise concurrency. */
  delayMs?: number;

  // --- §14.14 detail enrichment -------------------------------------------
  /**
   * Raw detail-scraper items, keyed by the address the batch will be asked
   * for. The spy echoes `addressOrUrlFromInput` verbatim like the real actor
   * and returns them SHUFFLED by default, because the recorded actor does
   * (input 1,2,3,4,5 -> 1,4,5,2,3) and a spy that preserves order would let
   * an index join pass every service-level test.
   */
  detailItems?: Record<string, Record<string, unknown>>;
  /** Throw on fetchDetailBatch — the whole-run detail failure. */
  failDetail?: ProviderFailure;
  /** Return items in input order instead of shuffled. Only for order-agnostic cases. */
  detailInOrder?: boolean;
  /** Resolve fetchDetailBatch after this many ms — for the 90s ceiling. */
  detailDelayMs?: number;
  /** Omit `fetchDetailBatch` entirely, as a provider that predates the slice. */
  noDetailSupport?: boolean;

  // --- §14.16 neighbourhood aggregates -------------------------------------
  /** Returned by fetchNeighborhoodSales — the DEDICATED 1mi/12mo fetch. */
  neighborhoodSales?: unknown[];
  /** Throw on fetchNeighborhoodSales — the aggregate-only failure. */
  failNeighborhood?: ProviderFailure;
  /** Omit `fetchNeighborhoodSales`, as a provider predating the slice. */
  noNeighborhoodSupport?: boolean;
}

export interface ProviderSpy {
  provider: unknown;
  /** Every call, in order. The unit of assertion for all cache tests. */
  calls: ProviderCall[];
  /** lookupSubject + fetchSoldComps combined — "did we hit the provider at all". */
  readonly callCount: number;
  readonly subjectCalls: number;
  /** §14.14 rule 6: must be exactly 1 per lookup, never one-per-comp. */
  readonly detailCalls: number;
  readonly compsCalls: number;
  reset(): void;
}

/**
 * Throws the REAL error classes from `providers/types.ts`, not look-alikes.
 *
 * The first version of this fabricated errors by setting `.name` on a plain
 * `Error`. Every retry test then failed — and the failure looked exactly like
 * "retry is not implemented". It wasn't: the service maps errors by
 * `instanceof`, so a hand-rolled look-alike is simply an unknown error and
 * falls through the transient check.
 *
 * Same lesson as narrowing the Supabase double, from the other direction: a
 * fake that diverges from the real contract doesn't just miss bugs, it invents
 * them. Importing the real classes is what makes the retry assertions mean
 * anything.
 */
function providerError(f: ProviderFailure): Error {
  switch (f.kind) {
    case 'timeout':
      return new ProviderTimeoutError('spy', 90_000);
    case 'http':
      return new ProviderHttpError('spy', f.status);
    case 'network':
      return new ProviderNetworkError('spy', new Error('socket hang up'));
    case 'malformed':
      // NOT a provider error class on purpose: a malformed JSON body surfaces
      // as a SyntaxError from the parse, and the service has to cope with an
      // error type it did not define.
      return new SyntaxError('Unexpected token < in JSON at position 0');
  }
}

export function makeProviderSpy(options: ProviderSpyOptions = {}): ProviderSpy {
  const calls: ProviderCall[] = [];
  let failuresRemaining = options.failFirstNCalls ?? Infinity;

  const maybeDelay = async () => {
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
  };

  const detailProvider = options.noDetailSupport
    ? {}
    : {
        async fetchDetailBatch(addresses: string[]) {
          calls.push({ method: 'fetchDetailBatch', arg: addresses.join('|'), addresses: [...addresses] });
          if (options.detailDelayMs) await new Promise((r) => setTimeout(r, options.detailDelayMs));
          if (options.failDetail && failuresRemaining > 0) {
            failuresRemaining--;
            throw providerError(options.failDetail);
          }
          const bank = options.detailItems ?? {};
          const items = addresses
            .filter((a) => bank[a] !== undefined)
            .map((a) => ({ ...bank[a], addressOrUrlFromInput: a }));
          // OUT OF ORDER by default — see the note on `detailItems`.
          if (options.detailInOrder || items.length < 3) return mapDetailBatchItems(items);
          const shuffled = [items[0], ...items.slice(3), ...items.slice(1, 3)];
          return mapDetailBatchItems(shuffled);
        },
      };

  const neighborhoodProvider = options.noNeighborhoodSupport
    ? {}
    : {
        async fetchNeighborhoodSales(
          subject: { address?: string },
          radiusMi: number,
          windowMonths: number,
        ) {
          calls.push({
            method: 'fetchNeighborhoodSales', arg: subject?.address ?? '', radiusMi, windowMonths,
          });
          if (options.failNeighborhood && failuresRemaining > 0) {
            failuresRemaining--;
            throw providerError(options.failNeighborhood);
          }
          return options.neighborhoodSales ?? [];
        },
      };

  const provider = {
    name: options.name ?? 'spy',
    ...detailProvider,
    ...neighborhoodProvider,

    async lookupSubject(normalizedAddress: string) {
      calls.push({ method: 'lookupSubject', arg: normalizedAddress });
      await maybeDelay();
      if (options.failSubject && failuresRemaining > 0) {
        failuresRemaining--;
        throw providerError(options.failSubject);
      }
      return options.subject === undefined ? null : options.subject;
    },

    async fetchSoldComps(subject: { address?: string }, radiusMi: number, windowMonths?: number) {
      // windowMonths is recorded even while the production signature lacks it:
      // the truncation fix adds it, and a spy that drops the argument cannot
      // tell "the fetch is unwindowed" from "the fetch is windowed and I did
      // not look".
      calls.push({
        method: 'fetchSoldComps', arg: subject?.address ?? '', radiusMi, windowMonths,
      });
      await maybeDelay();
      if (options.failComps && failuresRemaining > 0) {
        failuresRemaining--;
        throw providerError(options.failComps);
      }
      const all = (options.comps ?? []) as Array<{ soldDate?: string | null }>;
      if (options.truncateTo === undefined) return all;

      // Newest-first, then cut — the actor's own behaviour.
      const byNewest = [...all].sort(
        (a, b) => Date.parse(b.soldDate ?? '') - Date.parse(a.soldDate ?? ''),
      );
      if (windowMonths === undefined) return byNewest.slice(0, options.truncateTo);

      // A windowed query bounds the set server-side BEFORE the cap applies.
      const cutoff = Date.now() - windowMonths * 30.44 * 86_400_000;
      return byNewest
        .filter((c) => Date.parse(c.soldDate ?? '') >= cutoff)
        .slice(0, options.truncateTo);
    },
  };

  return {
    provider,
    calls,
    get callCount() {
      return calls.length;
    },
    get subjectCalls() {
      return calls.filter((c) => c.method === 'lookupSubject').length;
    },
    get detailCalls() {
      return calls.filter((c) => c.method === 'fetchDetailBatch').length;
    },
    get compsCalls() {
      return calls.filter((c) => c.method === 'fetchSoldComps').length;
    },
    reset() {
      calls.length = 0;
      failuresRemaining = options.failFirstNCalls ?? Infinity;
    },
  };
}

// ===========================================================================
// Supabase double: chat_messages + qa_logs + session_state + comps_cache
// ===========================================================================

export interface StateWrite {
  sessionId: string;
  /** The state object as written. `null` when the row was cleared. */
  state: Record<string, unknown> | null;
  /** Monotonic sequence number, so ordering and atomicity are assertable. */
  seq: number;
  via: 'upsert' | 'update' | 'insert' | 'delete';
}

export interface CacheRow {
  cache_key: string;
  normalized_address?: string;
  raw_subject?: unknown;
  raw_comps?: unknown;
  result?: unknown;
  algo_version?: number;
  provider?: string;
  expires_at?: string;
}

export interface CompsSupabaseOptions {
  history?: Array<{ role: string; content: string }>;
  /** Pre-seeded session_state rows, by session_id. */
  sessionState?: Record<string, Record<string, unknown>>;
  /** Pre-seeded comps_cache rows, by cache_key. */
  compsCache?: Record<string, CacheRow>;
  /** Every session_state read rejects — degrade to no-prefill + warn. */
  failStateReads?: boolean;
  /** Every session_state write rejects — must not block the reply. */
  failStateWrites?: boolean;
  /** Every comps_cache read rejects — degrade to a live run. */
  failCacheReads?: boolean;
}

export interface CompsSupabase {
  client: SupabaseClient;
  /** Live view of session_state, by session_id. */
  state: Map<string, Record<string, unknown>>;
  /** Every state mutation, in order. */
  stateWrites: StateWrite[];
  /** Live view of comps_cache, by cache_key. */
  cache: Map<string, CacheRow>;
  /** Non-state inserts (chat_messages, qa_logs), as in tests/helpers/fakes.ts. */
  inserts: Array<{ table: string; payload: unknown }>;
  stateReads: number;
  cacheReads: number;
  /** The whole `state` jsonb column for a session. */
  stateFor(sessionId: string): Record<string, unknown> | undefined;
  /** `state.comps` — the CONTRACT §8 block, or undefined when absent/cleared. */
  compsBlockFor(sessionId: string): Record<string, unknown> | undefined;
}

/** `state.comps` as observed in a single write, or undefined if absent. */
export function compsBlockOf(write: StateWrite): Record<string, unknown> | undefined {
  const blob = write.state;
  if (!blob) return undefined;
  const comps = (blob as { comps?: unknown }).comps;
  return comps && typeof comps === 'object' ? (comps as Record<string, unknown>) : undefined;
}

export function makeCompsSupabase(options: CompsSupabaseOptions = {}): CompsSupabase {
  const state = new Map<string, Record<string, unknown>>(
    Object.entries(options.sessionState ?? {}).map(([k, v]) => [k, { ...v }]),
  );
  const cache = new Map<string, CacheRow>(Object.entries(options.compsCache ?? {}));
  const stateWrites: StateWrite[] = [];
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const counters = { stateReads: 0, cacheReads: 0, seq: 0 };
  const history = options.history ?? [];
  /**
   * FINDING-014, and this is the copy that MATTERS: the live battery builds on
   * makeCompsSupabase, not on fakes.ts's makeFakeSupabase. Both carried the
   * same defect — appendExchange's rows were recorded and discarded, so the
   * second turn of any session read EMPTY history and the model was asked to
   * remember a conversation it had never seen. Fixing only the other one is
   * exactly the near-miss worth writing down: the fix was real and reached
   * nothing the live cases exercise.
   */
  const appended: Record<string, Array<{ role: string; content: string }>> = {};

  /** Pull `session_id` / `cache_key` out of whatever .eq() chain was built. */
  interface Filters { [column: string]: unknown }

  /** Narrow guard — see the header. Only the §8-pinned shape is tolerated. */
  function pinnedOnly(table: string, method: string): void {
    if (table !== 'session_state') return;
    throw new Error(
      `[compsFakes] session_state was accessed with .${method}(), which is not the ` +
        `shape CONTRACT §8 pins.\n` +
        `  read   .from('session_state').select('state').eq('session_id', id).maybeSingle()\n` +
        `  write  .from('session_state').upsert({ session_id, state, updated_at })\n` +
        `If the contract changed, amend §8 first and then narrow this double to match — ` +
        `do not widen it to absorb the call.`,
    );
  }

  function tableChain(table: string) {
    const filters: Filters = {};
    let pendingRows: unknown[] | null = null;

    const rowsForTable = (): unknown[] => {
      if (table === 'chat_messages') {
        const id = filters.session_id as string | undefined;
        const turns = id === undefined
          ? Object.values(appended).flat()
          : appended[id] ?? [];
        // Scoped by session: flattening every conversation would leak one
        // into another, which is a worse failure than the empty history.
        return [...history, ...turns].reverse();
      }
      if (table === 'session_state') {
        counters.stateReads++;
        if (options.failStateReads) throw new Error('session_state read failed');
        const id = filters.session_id as string | undefined;
        if (id === undefined) return [...state.entries()].map(([k, v]) => ({ session_id: k, state: v }));
        const row = state.get(id);
        return row ? [{ session_id: id, state: row, updated_at: new Date(0).toISOString() }] : [];
      }
      if (table === 'comps_cache') {
        counters.cacheReads++;
        if (options.failCacheReads) throw new Error('comps_cache read failed');
        const key = filters.cache_key as string | undefined;
        if (key === undefined) return [...cache.values()];
        const row = cache.get(key);
        return row ? [row] : [];
      }
      return [];
    };

    const settle = (): Promise<{ data: unknown; error: unknown }> => {
      try {
        const rows = pendingRows ?? rowsForTable();
        return Promise.resolve({ data: rows, error: null });
      } catch (e) {
        return Promise.resolve({ data: null, error: { message: (e as Error).message } });
      }
    };

    const recordState = (payload: unknown, via: StateWrite['via']) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const r of rows) {
        const row = r as Record<string, unknown>;
        const sessionId = (row.session_id ?? filters.session_id) as string;
        // The state blob may arrive as `state` or be the row itself.
        const blob = (row.state ?? row) as Record<string, unknown> | null;
        if (via === 'delete' || blob === null) {
          state.delete(sessionId);
          stateWrites.push({ sessionId, state: null, seq: counters.seq++, via });
        } else {
          const next = { ...(blob as Record<string, unknown>) };
          delete (next as Record<string, unknown>).session_id;
          delete (next as Record<string, unknown>).updated_at;
          state.set(sessionId, next);
          stateWrites.push({ sessionId, state: { ...next }, seq: counters.seq++, via });
        }
      }
    };

    const recordCache = (payload: unknown) => {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const r of rows) {
        const row = r as CacheRow;
        if (row.cache_key) cache.set(row.cache_key, { ...cache.get(row.cache_key), ...row });
      }
    };

    const write = (payload: unknown, via: StateWrite['via']) => {
      if (table === 'session_state') {
        if (options.failStateWrites) return Promise.reject(new Error('session_state write failed'));
        recordState(payload, via);
        return Promise.resolve({ data: null, error: null });
      }
      if (table === 'comps_cache') {
        recordCache(payload);
        return Promise.resolve({ data: null, error: null });
      }
      inserts.push({ table, payload });
      if (table === 'chat_messages') {
        for (const row of (Array.isArray(payload) ? payload : [payload]) as Array<
          Record<string, unknown>
        >) {
          const id = String(row?.session_id ?? '');
          if (!id || (row?.role !== 'user' && row?.role !== 'assistant')) continue;
          (appended[id] ??= []).push({
            role: String(row.role), content: String(row.content ?? ''),
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    };

    const chain: Record<string, unknown> = {
      select: (cols?: string) => {
        if (table === 'session_state' && cols !== undefined && cols !== 'state') {
          throw new Error(
            `[compsFakes] session_state read selected "${cols}"; §8 pins .select('state').`,
          );
        }
        return chain;
      },
      eq: (column: string, value: unknown) => {
        if (table === 'session_state' && column !== 'session_id') {
          throw new Error(
            `[compsFakes] session_state filtered on "${column}"; §8 pins .eq('session_id', id).`,
          );
        }
        filters[column] = value;
        return chain;
      },
      in: () => chain,
      gt: () => chain,
      gte: () => chain,
      lt: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => {
        pinnedOnly(table, 'single');
        const { data, error } = await settle();
        const rows = (data as unknown[]) ?? [];
        return { data: rows[0] ?? null, error: error ?? (rows.length ? null : { code: 'PGRST116' }) };
      },
      maybeSingle: async () => {
        const { data, error } = await settle();
        const rows = (data as unknown[]) ?? [];
        return { data: rows[0] ?? null, error };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        pinnedOnly(table, 'then (awaited without maybeSingle)');
        return settle().then(resolve, reject);
      },
      insert: (payload: unknown) => {
        pinnedOnly(table, 'insert');
        return write(payload, 'insert');
      },
      upsert: (payload: unknown) => {
        if (table === 'session_state') {
          const rows = Array.isArray(payload) ? payload : [payload];
          for (const r of rows) {
            const row = r as Record<string, unknown>;
            if (!('session_id' in row) || !('state' in row)) {
              throw new Error(
                `[compsFakes] session_state upsert payload must carry { session_id, state }; ` +
                  `got keys [${Object.keys(row).join(', ')}].`,
              );
            }
          }
        }
        return write(payload, 'upsert');
      },
      update: (payload: unknown) => {
        pinnedOnly(table, 'update');
        const updateChain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return write(payload, 'update');
          },
          then: (resolve: (v: unknown) => unknown) => write(payload, 'update').then(resolve),
        };
        return updateChain;
      },
      delete: () => {
        pinnedOnly(table, 'delete');
        return {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return write({ session_id: value, state: null }, 'delete');
          },
        };
      },
    };
    void pendingRows;
    return chain;
  }

  const client = {
    from: (table: string) => tableChain(table),
    rpc: async () => ({ data: [], error: null }),
  };

  return {
    client: client as unknown as SupabaseClient,
    state,
    stateWrites,
    cache,
    inserts,
    get stateReads() {
      return counters.stateReads;
    },
    get cacheReads() {
      return counters.cacheReads;
    },
    stateFor(sessionId: string) {
      return state.get(sessionId);
    },
    compsBlockFor(sessionId: string) {
      const blob = state.get(sessionId);
      const comps = (blob as { comps?: unknown } | undefined)?.comps;
      return comps && typeof comps === 'object' ? (comps as Record<string, unknown>) : undefined;
    },
  };
}

/** `CompsStateBlock` fields, CONTRACT §8. */
export const COMPS_STATE_KEYS = [
  'subjectAddress', 'subjectSqft', 'subjectBeds', 'subjectBaths',
  'arv', 'arvLow', 'arvHigh', 'arvConfidence', 'arvSource', 'compsRunId', 'computedAt',
] as const;

/**
 * Fields that only exist inside a comps block. §8 makes the block atomic — it
 * is written whole or not at all — so seeing any of these without
 * `subjectAddress` means the atomicity guarantee broke.
 */
export const ARV_BEARING_KEYS = ['arv', 'arvLow', 'arvHigh', 'arvConfidence', 'arvSource'] as const;

/** Fields §8 says `set_manual_arv` nulls out (not deletes). */
export const MANUAL_NULLED_KEYS = ['arvLow', 'arvHigh', 'arvConfidence', 'compsRunId'] as const;
