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
}

export interface FakeSupabase {
  client: SupabaseClient;
  /** Every insert payload, keyed by table. */
  inserts: Array<{ table: string; payload: any }>;
  /** Every .order(column, opts) call, in order — lets tests pin sort determinism. */
  orderCalls: Array<{ table: string; column: string; opts: any }>;
}

export function makeFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const inserts: Array<{ table: string; payload: any }> = [];
  const orderCalls: Array<{ table: string; column: string; opts: any }> = [];
  const history = options.history ?? [];

  const client = {
    from(table: string) {
      // getHistory orders descending then reverses, so feed it reversed.
      const rows = table === 'chat_messages' ? [...history].reverse() : [];
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: (column: string, opts: any) => {
          orderCalls.push({ table, column, opts });
          return chain;
        },
        limit: () => chain,
        // Thenable: `await supabase.from(t).select()...` resolves here.
        then: (resolve: (v: any) => unknown) => resolve({ data: rows, error: null }),
        insert: (payload: any) => {
          inserts.push({ table, payload });
          return options.insertRejects
            ? Promise.reject(new Error('supabase unavailable'))
            : Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
    rpc: async () => ({
      data: options.matchDocuments ?? [],
      error: null,
    }),
  };

  return { client: client as unknown as SupabaseClient, inserts, orderCalls };
}

/** Let detached (fire-and-forget) promises settle and any unhandled rejection surface. */
export async function flushDetached(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}
