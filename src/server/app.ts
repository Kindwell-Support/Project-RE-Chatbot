import Fastify, { type FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { runAgent } from '../agent/agent.js';
import { getHistory, appendExchange } from './memory.js';
import { logExchange } from './logging.js';

interface ChatBody {
  message?: string;
  session_id?: string;
  member_email?: string;
}

export interface AppDeps {
  openai?: OpenAI;
  supabase?: SupabaseClient;
}

/**
 * Build the Fastify app. Clients are created lazily so the app can be built
 * (and CORS tested) without live credentials.
 */
export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  let openai = deps.openai;
  let supabase = deps.supabase;
  // Transient 429s/5xx from OpenAI otherwise surface to the member as
  // "The mentor is temporarily unavailable". Observed intermittently under
  // back-to-back load. The SDK default is 2 retries with backoff; 4 with a
  // bounded timeout keeps a slow round-trip from hanging the request forever.
  const getOpenAI = () =>
    (openai ??= new OpenAI({
      apiKey: config.openaiApiKey,
      maxRetries: 4,
      timeout: 60_000,
    }));
  const getSupabase = () =>
    (supabase ??= createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false },
    }));

  // --- CORS -----------------------------------------------------------------
  // Explicit, allow-listed. Never "*" — the widget runs on the GHL membership
  // domain only. The old build's preflight 500 left the widget with no input
  // box, so OPTIONS is handled explicitly and always returns 204 for allowed
  // origins.
  const isAllowedOrigin = (origin: string | undefined): origin is string =>
    !!origin && config.allowedOrigins.includes(origin);

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (isAllowedOrigin(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'content-type');
      reply.header('Access-Control-Max-Age', '86400');
      reply.code(204).send();
    }
  });

  // --- Routes ---------------------------------------------------------------
  app.get('/health', async () => ({ status: 'ok' }));

  // Serve the widget bundle so no separate CDN is strictly required.
  app.get('/widget.js', async (_request, reply) => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bundle = await readFile(path.resolve(here, '../../public/widget.js'));
      reply.header('Content-Type', 'application/javascript; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=300');
      return reply.send(bundle);
    } catch {
      reply.code(404);
      return { error: 'widget bundle not built — run `npm run build:widget`' };
    }
  });

  app.post<{ Body: ChatBody }>('/chat', async (request, reply) => {
    const { message, session_id, member_email } = request.body ?? {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      reply.code(400);
      return { error: 'message is required' };
    }
    if (!session_id || typeof session_id !== 'string') {
      reply.code(400);
      return { error: 'session_id is required' };
    }

    const oa = getOpenAI();
    const sb = getSupabase();

    const history = await getHistory(sb, session_id, request.log);

    let result;
    try {
      result = await runAgent(oa, sb, config, history, message.trim());
    } catch (err) {
      // request.log is silenced under NODE_ENV=test, which made live-test 502s
      // undiagnosable — the reason was swallowed entirely. Always surface the
      // cause server-side; the member-facing message stays generic.
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      request.log.error({ err }, 'agent run failed');
      if (process.env.NODE_ENV === 'test') console.error('[agent run failed]', detail);
      reply.code(502);
      return {
        error: 'The mentor is temporarily unavailable. Please try again.',
        detail: process.env.NODE_ENV === 'production' ? undefined : detail,
      };
    }

    // Memory is AWAITED, logging is not — they are not the same kind of write.
    //
    // chat_messages is load-bearing for correctness: the next turn reads it back.
    // Detaching it creates a read-your-own-writes race — a fast follow-up loads
    // history before this insert lands and the agent forgets the conversation.
    // (Observed: a restart-and-continue lost the deal the member had just given.)
    // appendExchange swallows its own errors, so awaiting cannot fail the reply;
    // it only costs one insert round-trip.
    await appendExchange(sb, session_id, message.trim(), result.output, request.log);

    // qa_logs is observability, not correctness — nothing reads it back, so it
    // stays detached. The .catch() is the call-site guarantee that an unhandled
    // rejection can never terminate the process on Node 15+.
    void logExchange(
      sb,
      {
        userId: member_email && member_email !== 'unknown' ? member_email : session_id,
        question: message.trim(),
        answer: result.output,
        retrievedChunkIds: result.retrievedChunkIds,
        similarityScores: result.similarityScores,
        tokenUsage: result.usage,
      },
      request.log,
    ).catch((err) => {
      request.log.warn({ err }, 'qa_logs write failed — reply already sent');
    });

    // `tool_calls` is trace evidence: which tools actually fired, in order.
    // Proves a BRRRR answer came from brrrr_calculator rather than being
    // replayed from a prior flip — the old build's memory-replay bug.
    return {
      output: result.output,
      tool_calls: result.toolCalls.map((t) => t.name),
    };
  });

  return app;
}
