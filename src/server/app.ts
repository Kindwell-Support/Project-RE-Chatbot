import Fastify, { type FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { runAgent, type SeedToolCall } from '../agent/agent.js';
import { isCalculatorKey } from '../agent/formSchema.js';
import {
  buildFormSubmission,
  describeSubmission,
  FormValidationError,
} from '../agent/formSubmission.js';
import { getHistory, appendExchange } from './memory.js';
import { logExchange } from './logging.js';
import { OWNER_KEY_HEADER, OwnerKeyError, resolveOwnerKey } from './ownerKey.js';
import {
  archiveChat,
  ChatLimitError,
  createChat,
  findChatById,
  generateChatTitle,
  isChatId,
  listChats,
  normalizeTitle,
  renameChat,
  touchChat,
} from './chats.js';
import type { PropertyDataProvider } from '../features/comps/providers/types.js';
import { ApifyZillowProvider } from '../features/comps/providers/apifyZillow.js';
import { createCompsCache } from '../features/comps/cache/compsCache.js';
import { createDetailCache, type DetailCacheLike } from '../features/comps/cache/detailCache.js';
import { createCensusCache, type CensusCacheLike } from '../features/comps/cache/censusCache.js';
import { CensusAcsProvider, type DemographicsProviderLike } from '../features/comps/providers/census.js';
import { createDailyRunBudget, type CompsCacheLike, type RunBudgetLike } from '../features/comps/service.js';
import { createSessionStateStore } from '../features/comps/sessionState.js';
import type { SessionStateStore } from '../features/comps/tools.js';

interface FormSubmissionBody {
  calculator?: string;
  values?: Record<string, unknown>;
}

interface ChatBody {
  message?: string;
  session_id?: string;
  member_email?: string;
  /** Inline calculator form submission — an alternative to typing the numbers. */
  form_submission?: FormSubmissionBody;
}

interface HistoryQuery {
  session_id?: string;
}

export interface AppDeps {
  openai?: OpenAI;
  supabase?: SupabaseClient;
  /**
   * Comps data provider (CONTRACT §6 seam, BLOCKED-0008). Tests inject a fake
   * here exactly like the two clients above; production leaves it undefined
   * and buildApp constructs the Apify provider lazily — never at module
   * scope, so importing the app can never touch the network.
   */
  propertyProvider?: PropertyDataProvider;
  /** Census demographics provider (§14.10) — same seam pattern; tests inject a fake, production builds from CENSUS_API_KEY. */
  censusProvider?: DemographicsProviderLike;
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
  // Same lazy pattern as the two clients above (CONTRACT §6): constructed on
  // first use, never at module scope. Returns undefined without a token —
  // the comps tools are gated out of TOOL_DEFINITIONS in that case, so
  // nothing downstream ever calls a missing provider.
  let propertyProvider = deps.propertyProvider;
  const getPropertyProvider = (): PropertyDataProvider | undefined =>
    (propertyProvider ??= config.apifyToken
      ? new ApifyZillowProvider(config.apifyToken)
      : undefined);
  let compsCache: CompsCacheLike | undefined;
  const getCompsCache = () => (compsCache ??= createCompsCache(getSupabase()));
  let detailCache: DetailCacheLike | undefined;
  const getDetailCache = () => (detailCache ??= createDetailCache(getSupabase()));
  // Same gate pattern as the Apify token (§14.10): no CENSUS_API_KEY ⇒ no
  // provider ⇒ demographics never attempted and no section rendered.
  let censusProvider = deps.censusProvider;
  const getCensusProvider = (): DemographicsProviderLike | undefined =>
    (censusProvider ??= config.censusApiKey ? new CensusAcsProvider(config.censusApiKey) : undefined);
  let censusCache: CensusCacheLike | undefined;
  const getCensusCache = () => (censusCache ??= createCensusCache(getSupabase()));
  let sessionStateStore: SessionStateStore | undefined;
  const getSessionStateStore = () => (sessionStateStore ??= createSessionStateStore(getSupabase()));
  // One budget per app instance: the daily Apify spend cap. In-memory (resets
  // on deploy), which can only under-count — it can never wrongly lock a
  // member out.
  const compsBudget: RunBudgetLike = createDailyRunBudget(config.compsDailyRunCap);

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
      // GET/PATCH/DELETE joined POST with the /chats routes (Phase 1
      // multi-chat). Without them the browser blocks rename and delete at the
      // preflight and the sidebar looks broken with a healthy server. The
      // owner-key header must be allow-listed for the same reason: a custom
      // header makes every /chats call a preflighted request.
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', `content-type, ${OWNER_KEY_HEADER}`);
      reply.header('Access-Control-Max-Age', '86400');
      reply.code(204).send();
    }
  });

  // --- Routes ---------------------------------------------------------------

  // The bare domain is the first thing anyone opens after a deploy. Without
  // this it answered `Route GET:/ not found`, which reads like a broken app
  // when the service is in fact healthy. Say what this is and where to look.
  app.get('/', async (_request, reply) => {
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return {
      // Internal API root (explicitly not member-facing, see the note below), so
      // it keeps the legacy service name — the "Ask James" rename covers the
      // member-facing surfaces (widget header, /demo title + heading + meta).
      service: 'James Dainard AI Mentor API',
      status: 'ok',
      note: 'This is the API, not a member-facing page. The chat UI is the widget embedded in the ProjectRE Academy lesson (GHL).',
      endpoints: {
        health: 'GET /health',
        chat: 'POST /chat  { message, session_id, member_email? }',
        history: 'GET /history?session_id=...',
        widget: 'GET /widget.js',
        demo: config.enableDemoPage
          ? 'GET /demo — the widget hosted here for testing'
          : 'GET /demo — disabled; set ENABLE_DEMO_PAGE=true to enable',
      },
    };
  });

  app.get('/health', async () => ({ status: 'ok' }));

  // Serve the widget bundle so no separate CDN is strictly required.
  app.get('/widget.js', async (_request, reply) => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const bundle = await readFile(path.resolve(here, '../../public/widget.js'));
      reply.header('Content-Type', 'application/javascript; charset=utf-8');
      // 'no-cache' means REVALIDATE, not "never cache": the live host already
      // answers If-Modified-Since with 304, so this costs one conditional
      // round trip per page load and nothing else. Three consecutive
      // frontend-heavy phases behind a 5-minute edge+browser cache would have
      // QA reporting stale bundles as bugs.
      reply.header('Cache-Control', 'no-cache');
      return reply.send(bundle);
    } catch {
      reply.code(404);
      return { error: 'widget bundle not built — run `npm run build:widget`' };
    }
  });

  // /demo — the widget hosted on the API's own origin, so the bot can be seen
  // and exercised without a GHL page. Same-origin fetches need no CORS, so the
  // allow-list stays untouched. Gated: on outside production, or via
  // ENABLE_DEMO_PAGE=true (note /chat itself is already publicly callable —
  // CORS only constrains browsers — so this page adds no new exposure).
  if (config.enableDemoPage) {
    app.get('/demo', async (_request, reply) => {
      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ask James — Demo</title>
  <meta name="description" content="Ask James — deal-underwriting mentor for real estate investors. Internal demo of the ProjectRE Academy chat widget.">
  <meta name="robots" content="noindex, nofollow">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0A0A0B">
  <meta property="og:title" content="Ask James">
  <meta property="og:description" content="Deal-underwriting mentor for real estate investors.">
  <style>
    html, body { height: 100%; }
    body { margin: 0; background: #0A0A0B; color: #F5F5F7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 28px 16px 40px; box-sizing: border-box;
      display: flex; flex-direction: column; min-height: 100%; }
    .eyebrow { color: rgba(245,245,247,0.38); font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase; margin: 0 0 6px; }
    h1 { color: #F5F5F7; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 4px; }
    p { color: rgba(245,245,247,0.62); font-size: 13px; margin: 0 0 18px; }
    #james-bot { height: 680px; flex: 0 0 auto; }
    @media (max-width: 520px) { #james-bot { height: 78vh; } }
  </style>
</head>
<body>
  <div class="wrap">
    <p class="eyebrow">Internal demo · not a member-facing URL</p>
    <h1>Ask James</h1>
    <p>The same widget that embeds in the GHL lesson page, hosted here for testing.</p>
    <div id="james-bot"></div>
  </div>
  <!-- Cache-busted: /widget.js is cached for 5 minutes, which is right for
       members but wrong for a page whose whole job is showing current code. -->
  <script src="/widget.js?v=${Date.now()}"></script>
  <script>
    window.createJamesBot({ apiUrl: '', target: '#james-bot', memberEmail: 'demo@internal' });
  </script>
</body>
</html>`);
    });
  }

  // Conversation history for a session, so the widget can repaint the chat
  // after a reload or a GHL lesson swap (memory is server-side; without this
  // the bot remembers what the member can no longer see).
  //
  // Exposure note: this reads out what /chat already grants anyone holding the
  // session id — that id is a random UUID in the member's own localStorage and
  // is the existing bearer of that conversation. Same class, not a new one.
  app.get<{ Querystring: HistoryQuery }>('/history', async (request, reply) => {
    const sessionId = request.query?.session_id;
    if (!sessionId || typeof sessionId !== 'string') {
      reply.code(400);
      return { error: 'session_id is required' };
    }
    const history = await getHistory(getSupabase(), sessionId, request.log);
    return { messages: history };
  });

  // --- /chats (Phase 1 multi-chat) -----------------------------------------
  //
  // Every handler resolves its owner through resolveOwnerKey (ruling R3) and
  // scopes its WHERE to that owner. A chat belonging to someone else answers
  // 404 and never 403: a 403 confirms the id exists, which turns the response
  // code into an enumeration oracle.
  //
  // Chat ids ARE session ids, so these routes carry the same exposure class as
  // /chat and /history — holding the id is holding the conversation. What is
  // new is the LISTING, and that is exactly why it is keyed on an unguessable
  // device key rather than on the client-asserted member_email.

  /** Map an unusable owner key to 400 once, so every handler reads the same. */
  const ownerOr400 = (request: { headers: Record<string, string | string[] | undefined> }, reply: {
    code: (n: number) => unknown;
  }): string | null => {
    try {
      return resolveOwnerKey(request);
    } catch (err) {
      if (err instanceof OwnerKeyError) {
        reply.code(400);
        return null;
      }
      throw err;
    }
  };

  app.get('/chats', async (request, reply) => {
    const ownerKey = ownerOr400(request, reply);
    if (!ownerKey) return { error: `${OWNER_KEY_HEADER} header is required` };
    try {
      // R6: a PURE READ. The create-if-empty branch is gone — a safe verb does
      // not write, and the server cannot see localStorage, so it could never
      // know whether a legacy session was about to be adopted. Both first-chat
      // decisions now live client-side where they can see each other; an empty
      // list is answered with an ephemeral placeholder, not a row.
      return await listChats(getSupabase(), ownerKey);
    } catch (err) {
      request.log.error({ err }, 'chats list failed');
      reply.code(503);
      return { error: 'Chat list is unavailable right now.' };
    }
  });

  app.post<{ Body: { title?: unknown } }>('/chats', async (request, reply) => {
    const ownerKey = ownerOr400(request, reply);
    if (!ownerKey) return { error: `${OWNER_KEY_HEADER} header is required` };
    const body = request.body ?? {};
    // No client-supplied id: that option existed only for W1 legacy adoption.
    // With ids always server-generated a primary-key collision is
    // unreachable, so the 23505 branch that used to sit here is gone too —
    // dead code that reads as live is the same class as a stale comment.
    try {
      const chat = await createChat(getSupabase(), ownerKey, {
        title: normalizeTitle(body.title),
      });
      reply.code(201);
      return chat;
    } catch (err) {
      if (err instanceof ChatLimitError) {
        reply.code(409);
        return { error: 'You have reached the maximum number of chats. Delete one to make room.' };
      }
      request.log.error({ err }, 'chat create failed');
      reply.code(503);
      return { error: 'Could not create a chat right now.' };
    }
  });

  app.patch<{ Params: { id: string }; Body: { title?: unknown } }>(
    '/chats/:id',
    async (request, reply) => {
      const ownerKey = ownerOr400(request, reply);
      if (!ownerKey) return { error: `${OWNER_KEY_HEADER} header is required` };
      const title = normalizeTitle(request.body?.title);
      if (!title) {
        reply.code(400);
        return { error: 'title is required' };
      }
      // A malformed id can match nothing; answering 404 here keeps Postgres
      // from raising `invalid input syntax for type uuid` as a 500.
      if (!isChatId(request.params.id)) {
        reply.code(404);
        return { error: 'Chat not found.' };
      }
      try {
        const chat = await renameChat(getSupabase(), ownerKey, request.params.id, title);
        if (!chat) {
          reply.code(404);
          return { error: 'Chat not found.' };
        }
        return chat;
      } catch (err) {
        request.log.error({ err }, 'chat rename failed');
        reply.code(503);
        return { error: 'Could not rename that chat right now.' };
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/chats/:id', async (request, reply) => {
    const ownerKey = ownerOr400(request, reply);
    if (!ownerKey) return { error: `${OWNER_KEY_HEADER} header is required` };
    if (!isChatId(request.params.id)) {
      reply.code(404);
      return { error: 'Chat not found.' };
    }
    try {
      // SOFT (R4): chat_messages and session_state rows survive untouched.
      const archived = await archiveChat(getSupabase(), ownerKey, request.params.id);
      if (!archived) {
        reply.code(404);
        return { error: 'Chat not found.' };
      }
      reply.code(204);
      return null;
    } catch (err) {
      request.log.error({ err }, 'chat delete failed');
      reply.code(503);
      return { error: 'Could not delete that chat right now.' };
    }
  });

  app.post<{ Body: ChatBody }>('/chat', async (request, reply) => {
    const { message, session_id, member_email, form_submission } = request.body ?? {};

    if (!session_id || typeof session_id !== 'string') {
      reply.code(400);
      return { error: 'session_id is required' };
    }

    // A form submission carries the numbers instead of a typed message, so it
    // supplies its own transcript line. Everything downstream — agent, memory,
    // qa_logs — is identical to the typed path from here on.
    let seedToolCall: SeedToolCall | undefined;
    let userMessage: string;

    if (form_submission) {
      const { calculator, values } = form_submission;
      if (!isCalculatorKey(calculator)) {
        reply.code(400);
        return {
          error: `Unknown calculator "${String(calculator)}". Valid: flip, brrrr, land_purchase.`,
        };
      }
      try {
        const built = buildFormSubmission(calculator, values ?? {});
        seedToolCall = { name: built.tool, args: built.args };
        userMessage = describeSubmission(built.form, built.args);
      } catch (err) {
        if (err instanceof FormValidationError) {
          reply.code(400);
          return { error: err.message, fields: err.fields };
        }
        throw err;
      }
    } else {
      if (!message || typeof message !== 'string' || !message.trim()) {
        reply.code(400);
        return { error: 'message is required' };
      }
      userMessage = message.trim();
    }

    const sb = getSupabase();

    // The owner key is optional on /chat and read through the SAME seam as
    // everywhere else (R3) — a client predating this deploy still gets a
    // working conversation, it just cannot self-heal its chats row.
    let ownerKey: string | undefined;
    try {
      ownerKey = resolveOwnerKey(request);
    } catch {
      ownerKey = undefined;
    }

    // BUG-016 billing hole, RULED: an archived chat answers 404 and never
    // enters the agent loop — no OpenAI call, no Apify call. A member who
    // deleted a chat cannot spend on it, and neither can anyone else holding
    // its id. Placed BEFORE getOpenAI/getHistory so nothing chargeable has
    // happened yet.
    //
    // A lookup FAILURE (the chats table not yet applied) must not 404 every
    // member, so an unknown answer proceeds exactly as before.
    try {
      const existing = await findChatById(sb, session_id);
      if (existing && existing.archived_at) {
        request.log.info({ chatId: session_id }, 'POST /chat on an archived chat — refused before the agent loop');
        reply.code(404);
        return { error: 'That chat is no longer available.' };
      }
    } catch (err) {
      request.log.warn({ err }, 'chat archived-state lookup failed — proceeding');
    }

    const oa = getOpenAI();

    const history = await getHistory(sb, session_id, request.log);

    let result;
    try {
      result = await runAgent(oa, sb, config, history, userMessage, {
        seedToolCall,
        comps: {
          sessionId: session_id,
          provider: getPropertyProvider(),
          cache: getCompsCache(),
          detailCache: getDetailCache(),
          censusProvider: getCensusProvider(),
          censusCache: getCensusCache(),
          budget: compsBudget,
          stateStore: getSessionStateStore(),
          logger: request.log,
        },
      });
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
    await appendExchange(sb, session_id, userMessage, result.output, request.log);

    // qa_logs is observability, not correctness — nothing reads it back, so it
    // stays detached. The .catch() is the call-site guarantee that an unhandled
    // rejection can never terminate the process on Node 15+.
    void logExchange(
      sb,
      {
        userId: member_email && member_email !== 'unknown' ? member_email : session_id,
        question: userMessage,
        answer: result.output,
        retrievedChunkIds: result.retrievedChunkIds,
        similarityScores: result.similarityScores,
        tokenUsage: result.usage,
        toolCalls: result.toolCalls,
      },
      request.log,
    ).catch((err) => {
      request.log.warn({ err }, 'qa_logs write failed — reply already sent');
    });

    // Sidebar ordering and titles (Phase 1 multi-chat). Both are DETACHED for
    // the same reason qa_logs is: nothing reads them back this turn, and a
    // member's answer must never wait on cosmetics.
    //
    void touchChat(sb, session_id, ownerKey, request.log).then(() => {
      // A title is generated ONCE, from the first exchange — `history` was
      // read BEFORE this turn, so an empty one means this was it. The write
      // itself is conditional on title IS NULL, so this cannot overwrite a
      // rename or race a second turn.
      if (history.length > 0) return;
      return generateChatTitle(sb, oa, session_id, userMessage, result.output, request.log);
    });

    // `tool_calls` is trace evidence: which tools actually fired, in order.
    // Proves a BRRRR answer came from brrrr_calculator rather than being
    // replayed from a prior flip — the old build's memory-replay bug.
    // `render_form` is the transport for the form directive. The decision is
    // made deterministically in calculatorIntent.ts before the model's first
    // turn — the router decides, the response carries it, the widget renders.
    // The model cannot suppress it.
    return {
      output: result.output,
      tool_calls: result.toolCalls.map((t) => t.name),
      ...(result.renderForm ? { render_form: result.renderForm } : {}),
      // Form submissions have no typed message, so the widget echoes this —
      // the same line stored in memory, so a later /history replay matches.
      ...(form_submission ? { user_message: userMessage } : {}),
    };
  });

  return app;
}
