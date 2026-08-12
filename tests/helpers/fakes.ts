/**
 * Fake OpenAI / Supabase clients injected at the client boundary via
 * buildApp(config, deps). No vi.mock, no network, no API keys — the real
 * agent loop, router, and tool runners all execute.
 */
import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeCompletion {
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function buildCompletion(spec: FakeCompletion) {
  return {
    usage: spec.usage ?? {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
    choices: [
      {
        index: 0,
        finish_reason: spec.toolCalls?.length ? 'tool_calls' : 'stop',
        message: {
          role: 'assistant',
          content: spec.content ?? null,
          tool_calls: spec.toolCalls?.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        },
      },
    ],
  };
}

export interface FakeOpenAI {
  client: OpenAI;
  /** Params of every chat.completions.create call, in order. */
  calls: Array<Record<string, any>>;
  embeddingCalls: number;
}

/**
 * @param script one canned completion per round, consumed in order.
 */
export function makeFakeOpenAI(script: FakeCompletion[]): FakeOpenAI {
  const calls: Array<Record<string, any>> = [];
  const state = { embeddingCalls: 0 };
  let round = 0;

  const client = {
    chat: {
      completions: {
        create: async (params: Record<string, any>) => {
          calls.push(params);
          const spec = script[round] ?? script[script.length - 1];
          round++;
          return buildCompletion(spec);
        },
      },
    },
    embeddings: {
      create: async () => {
        state.embeddingCalls++;
        return {
          data: [{ embedding: new Array(1536).fill(0.01) }],
          usage: { total_tokens: 7 },
        };
      },
    },
  };

  return {
    client: client as unknown as OpenAI,
    calls,
    get embeddingCalls() {
      return state.embeddingCalls;
    },
  };
}

export interface FakeSupabaseOptions {
  /** Rows returned by the chat_messages history select. */
  history?: Array<{ role: string; content: string }>;
  /** When true, every insert rejects (simulates Supabase being down). */
  insertRejects?: boolean;
  /** Rows returned by the match_documents RPC. */
  matchDocuments?: Array<{ id: string | number; content: string; similarity: number }>;
  /**
   * Seed `session_state` rows, keyed by session id. The value is the whole
   * `state` jsonb column, so a comps/ARV block goes at `{ comps: {...} }`.
   *
   * Absent ⇒ the table reads empty, which is a REAL empty result
   * (`{ data: null }`), not a thrown call. See the note on the chain below.
   */
  sessionState?: Record<string, Record<string, unknown>>;
}

export interface FakeSupabase {
  client: SupabaseClient;
  /** Every insert payload, keyed by table. */
  inserts: Array<{ table: string; payload: any }>;
  /** Every `session_state` upsert, in order. */
  stateWrites: Array<{ sessionId: string; state: Record<string, unknown> | null }>;
  /** The comps/ARV block currently stored for a session, if any. */
  compsBlockFor(sessionId: string): Record<string, any> | undefined;
  /** Every .order(column, opts) call, in order — lets tests pin sort determinism. */
  orderCalls: Array<{ table: string; column: string; opts: any }>;
}

export function makeFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const inserts: Array<{ table: string; payload: any }> = [];
  const orderCalls: Array<{ table: string; column: string; opts: any }> = [];
  const stateWrites: Array<{ sessionId: string; state: Record<string, unknown> | null }> = [];
  const history = options.history ?? [];
  const sessionState: Record<string, Record<string, unknown>> = { ...(options.sessionState ?? {}) };
  /**
   * Turns written by appendExchange, per session — so the NEXT read sees them.
   *
   * FINDING-014. This used to be a fixed seed: `history` was whatever the test
   * supplied, inserts were recorded for assertion and then thrown away, and a
   * second turn in the same session therefore read EMPTY history. Every
   * multi-turn case in the live battery was running against a model with no
   * memory of turn one — including the recall cases, whose entire subject is
   * memory.
   *
   * It surfaced because two new cases failed with the model asking for an
   * address it had been given one turn earlier. The older multi-turn cases had
   * been passing throughout, because their assertions are all of the form
   * "every figure quoted must be legitimate" and a model with no history
   * quotes no figures. Vacuous and green, which is FINDING-007's shape.
   *
   * Seeded `history` still applies and comes FIRST, so tests that hand-build a
   * transcript keep working; appended turns follow in insertion order.
   */
  const appended: Record<string, Array<{ role: string; content: string }>> = {};

  const client = {
    from(table: string) {
      // getHistory orders descending then reverses, so feed it reversed.
      // Resolved lazily: the real query filters by session_id via .eq(), and
      // that call happens AFTER from(). Flattening every session's turns here
      // would have leaked one conversation into another — a worse bug than
      // the empty history it replaces, and one the session-isolation case
      // would have caught only if it asserted on content rather than on
      // absence.
      const historyRows = () =>
        table === 'chat_messages'
          ? [...history, ...(eqSessionId ? appended[eqSessionId] ?? [] : Object.values(appended).flat())]
              .reverse()
          : [];
      // `session_state` reads filter by session id, so the chain has to
      // remember which one was asked for (CONTRACT §8:
      //   read  .select('state').eq('session_id', id).maybeSingle()
      //   write .upsert({ session_id, state, updated_at })).
      let eqSessionId: string | undefined;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: any) => {
          if (column === 'session_id') eqSessionId = String(value);
          return chain;
        },
        order: (column: string, opts: any) => {
          orderCalls.push({ table, column, opts });
          return chain;
        },
        limit: () => chain,
        // Thenable: `await supabase.from(t).select()...` resolves here.
        then: (resolve: (v: any) => unknown) => resolve({ data: historyRows(), error: null }),
        insert: (payload: any) => {
          inserts.push({ table, payload });
          if (options.insertRejects) {
            return Promise.reject(new Error('supabase unavailable'));
          }
          // FINDING-014: feed appended turns back into the history read, so a
          // multi-turn test exercises a model that can actually see turn one.
          // Guarded on insertRejects so the "Supabase is down" cases still
          // model a session that never persists.
          if (table === 'chat_messages') {
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              const id = String(row?.session_id ?? '');
              if (!id || (row?.role !== 'user' && row?.role !== 'assistant')) continue;
              (appended[id] ??= []).push({ role: row.role, content: String(row.content ?? '') });
            }
          }
          return Promise.resolve({ data: null, error: null });
        },
        /**
         * The single-row read the ARV pre-fill depends on.
         *
         * This used to be ABSENT, and its absence was invisible: the call
         * threw `maybeSingle is not a function`, `createSessionStateStore`
         * caught it and logged "continuing WITHOUT ARV pre-fill", and every
         * test still passed — because degrading is the correct behaviour on a
         * read failure. So three suites exercised the DEGRADED path while
         * their names claimed the pre-fill one. Returning a real empty result
         * is the difference between "no ARV stored" and "the database broke".
         */
        maybeSingle: async () => {
          if (table !== 'session_state') return { data: null, error: null };
          const state = eqSessionId === undefined ? undefined : sessionState[eqSessionId];
          return { data: state === undefined ? null : { state }, error: null };
        },
        upsert: (payload: any) => {
          if (table === 'session_state') {
            const id = String(payload?.session_id ?? '');
            const state = (payload?.state ?? null) as Record<string, unknown> | null;
            stateWrites.push({ sessionId: id, state });
            if (state === null) delete sessionState[id];
            else sessionState[id] = state;
          } else {
            inserts.push({ table, payload });
          }
          return options.insertRejects
            ? Promise.reject(new Error('supabase unavailable'))
            : Promise.resolve({ data: null, error: null });
        },
      };
      // ---------------------------------------------------------------
      // THE GUARD. A missing method on this chain used to be SILENT: the
      // property read `undefined`, the call threw TypeError deep inside the
      // store, the store caught it and degraded, and the suite stayed green
      // while testing the degraded path. `maybeSingle` and `upsert` were both
      // absent for the whole life of the ARV pre-fill and nothing noticed.
      //
      // A Proxy converts that class of gap from silent to loud. Symbols pass
      // through untouched (`await` probes `Symbol.toPrimitive` and friends,
      // and `then` is a real method above), so only a genuine unknown
      // BUILDER call trips it.
      // ---------------------------------------------------------------
      return new Proxy(chain, {
        get(target, prop, receiver) {
          if (typeof prop === 'symbol' || prop in target) {
            return Reflect.get(target, prop, receiver);
          }
          throw new Error(
            `makeFakeSupabase: unstubbed Supabase call .${String(prop)}() on table ` +
              `'${table}'. The double is deliberately narrow — add the method here ` +
              'so the shape stays pinned, rather than letting the caller degrade ' +
              'through a TypeError and pass anyway.',
          );
        },
      });
    },
    rpc: async () => ({
      data: options.matchDocuments ?? [],
      error: null,
    }),
  };

  return {
    client: client as unknown as SupabaseClient,
    inserts,
    orderCalls,
    stateWrites,
    compsBlockFor(sessionId: string) {
      const block = sessionState[sessionId]?.comps;
      return block === undefined || block === null
        ? undefined
        : (block as Record<string, any>);
    },
  };
}

/** Let detached (fire-and-forget) promises settle and any unhandled rejection surface. */
export async function flushDetached(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}
