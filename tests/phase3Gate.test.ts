/**
 * Phase 3 S3 — the preHandler gate and POST /auth.
 *
 * The gate is a PRODUCTION property: production-config instances here, while
 * every pre-existing suite exercises the dev posture (which is the Phase 1/2
 * behaviour, unchanged — that those 1800 tests stayed green IS the dev-path
 * evidence).
 *
 * Wrong-subject discipline: the deny cases assert the REASON (S1's and S2's
 * contracts composing without collapse), and the ACCEPT CONTROL — a valid
 * token reaching a real handler and producing an email:<verified> owner — is
 * what keeps the 401 wall from being satisfied by a server that rejects
 * everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp, AUTH_EXEMPT_PATHS, AUTH_ENTRY_PATH } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { mintToken, TOKEN_TTL_MS } from '../src/server/sessionToken.js';
import { chatRecord, makeChatsSupabase } from './helpers/chatsFakes.js';
import type { CourseAccessLookup } from '../src/server/ghl.js';

const SIGNING_KEY = 'phase3-gate-signing-key-0123456789-abcdefgh';
const OWNER_EMAIL = 'member@example.com';
const CHAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const PROD_ENV = {
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
  NODE_ENV: 'production',
  SESSION_SIGNING_KEY: SIGNING_KEY,
} as NodeJS.ProcessEnv;

function prodApp(opts: { lookup?: CourseAccessLookup; seed?: ReturnType<typeof chatRecord>[] } = {}) {
  const fake = makeChatsSupabase(opts.seed ?? []);
  const ghlClient = {
    lookupCourseAccess: vi.fn(async () => opts.lookup ?? ({ ok: true, found: true, values: ['Project Flip'] } as CourseAccessLookup)),
    verifyFieldId: vi.fn(async () => 'verified' as const),
    stats: () => ({ lookups: 0, failures: 0 }),
  };
  const app = buildApp(loadConfig(PROD_ENV), { supabase: fake.client as never, ghlClient });
  return { app, fake, ghlClient };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const validToken = () => mintToken(OWNER_EMAIL, SIGNING_KEY, Date.now());

describe('S3 — default-on: the exemption list is exactly the ruled four', () => {
  it('the exemption DATA is exactly three paths (plus the OPTIONS method in the hook)', () => {
    // INSPECTOR's exactness pin: adding a fifth exemption must be a
    // deliberate change HERE, never a quiet edit elsewhere.
    expect([...AUTH_EXEMPT_PATHS]).toEqual(['/', '/health', '/widget.js']);
    expect(AUTH_ENTRY_PATH, '/auth is the front door, not a list entry').toBe('/auth');
  });

  it('every exempt path answers WITHOUT a token in production', async () => {
    const { app } = prodApp();
    for (const path of AUTH_EXEMPT_PATHS) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode, `${path} was gated`).not.toBe(401);
    }
    await app.close();
  });

  it('OPTIONS preflights pass ungated — they carry no credentials by design', async () => {
    const { app } = prodApp();
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/chat',
      headers: { origin: 'https://preacademy.app.clientclub.net' },
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('the metered surface 401s without a token: /chat, /history, /chats, and /demo', async () => {
    const { app } = prodApp();
    const cases: Array<[string, string]> = [
      ['POST', '/chat'],
      ['GET', `/history?session_id=${CHAT_A}`],
      ['GET', '/chats'],
      ['POST', '/chats'],
      ['PATCH', `/chats/${CHAT_A}`],
      ['DELETE', `/chats/${CHAT_A}`],
      ['GET', '/demo'], // NOT exempt, by ruling
    ];
    for (const [method, url] of cases) {
      const res = await app.inject({ method: method as never, url });
      expect(res.statusCode, `${method} ${url} was reachable without a session`).toBe(401);
      expect(res.json().reason).toBe('missing_token');
    }
    await app.close();
  });

  it('FINDING-037: EVERY registered route is exempt or gated — derived, not listed', async () => {
    // The route set comes from the app itself (onRoute accessor), so a route
    // added tomorrow lands in this sweep by construction — the explicit-list
    // form of this claim narrowed silently when a route landed unlisted.
    const { app } = prodApp();
    await app.ready();
    const routes = (app as never as { registeredRoutes: Array<{ method: string; url: string }> })
      .registeredRoutes;
    expect(routes.length, 'the accessor observed nothing — it must precede registration').toBeGreaterThan(5);
    // Precondition: the accessor really sees the metered surface.
    expect(routes.some((r) => r.url === '/chat' && r.method === 'POST')).toBe(true);
    expect(routes.some((r) => r.url === '/chats/:id')).toBe(true);

    for (const r of routes) {
      if (r.method === 'OPTIONS') continue; // ruled exempt
      const concrete = r.url.replace(/:[^/]+/g, CHAT_A);
      const res = await app.inject({ method: r.method as never, url: concrete });
      const exempt =
        (AUTH_EXEMPT_PATHS as readonly string[]).includes(r.url) || r.url === AUTH_ENTRY_PATH;
      if (exempt) {
        expect(res.statusCode, `${r.method} ${r.url} is exempt but answered 401`).not.toBe(401);
      } else {
        expect(res.statusCode, `${r.method} ${r.url} is REACHABLE without a session`).toBe(401);
      }
    }
    await app.close();
  });

  it('a route that DOES NOT EXIST is also gated — the gate outranks routing knowledge', async () => {
    // By-construction evidence: the hook is app-level, so even an unmatched
    // URL never reveals whether a route exists to an unauthenticated caller.
    const { app } = prodApp();
    const res = await app.inject({ method: 'GET', url: '/some-future-route' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('x-james-owner is NOT a credential in production — the structural dev-only test', async () => {
    const { app } = prodApp();
    const res = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: { 'x-james-owner': 'device:11111111-1111-4111-8111-111111111111' },
    });
    expect(res.statusCode, 'a client-asserted owner passed the production gate').toBe(401);
    await app.close();
  });
});

describe('S3 — 401 reasons: the S2 contract, end to end, leaking nothing', () => {
  it('expired vs bad_signature vs malformed are distinct on the wire', async () => {
    const { app } = prodApp();
    const expired = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer(mintToken(OWNER_EMAIL, SIGNING_KEY, Date.now() - TOKEN_TTL_MS - 1000)),
    });
    const forged = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer(validToken().slice(0, -4) + 'AAAA'),
    });
    const malformed = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer('not-a-token'),
    });

    expect(expired.json()).toEqual({ error: 'Not authorized.', reason: 'expired' });
    expect(forged.json()).toEqual({ error: 'Not authorized.', reason: 'bad_signature' });
    expect(malformed.json()).toEqual({ error: 'Not authorized.', reason: 'malformed' });
    await app.close();
  });

  it('the 401 body never varies by whether the email exists in GHL — no probe oracle', async () => {
    // Two tokens naming an existing and a nonexistent member, both with a
    // broken signature: byte-identical rejections, and GHL is never called.
    const { app, ghlClient } = prodApp();
    const real = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer(mintToken('adrianroa2015@gmail.com', 'wrong-key-0123456789-abcdefghijklmn', Date.now())),
    });
    const fake = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer(mintToken('nobody@example.com', 'wrong-key-0123456789-abcdefghijklmn', Date.now())),
    });

    expect(real.body).toBe(fake.body);
    expect(real.body).not.toContain('adrianroa2015');
    expect(ghlClient.lookupCourseAccess, 'a preHandler rejection consulted GHL').not.toHaveBeenCalled();
    await app.close();
  });

  it('COMPOSITION: expired token (401) and retired member (403) stay distinguishable end to end', async () => {
    const { app } = prodApp({ lookup: { ok: true, found: true, values: ['Retired Member'] } });
    const expired = await app.inject({
      method: 'GET',
      url: '/chats',
      headers: bearer(mintToken(OWNER_EMAIL, SIGNING_KEY, Date.now() - TOKEN_TTL_MS - 1000)),
    });
    const retired = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: 'abel@investslo.com' },
    });

    expect(expired.statusCode).toBe(401);
    expect(expired.json().reason).toBe('expired');
    expect(retired.statusCode).toBe(403);
    expect(retired.json().reason).toBe('denied');
    await app.close();
  });
});

describe('S3 — POST /auth: the front door', () => {
  it('allow -> a token bound to the verified (lowercased) email, which then reaches handlers', async () => {
    // THE ACCEPT CONTROL for the whole gate: without this, every 401 above is
    // satisfied by a server that rejects everything.
    const { app, fake } = prodApp();
    const auth = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: 'Member@Example.COM' },
    });
    expect(auth.statusCode).toBe(200);
    const { token, email } = auth.json();
    expect(email).toBe(OWNER_EMAIL);

    // The token opens the gate AND the owner is email:<verified> — observed
    // through a real write: the chats row the send self-heals.
    const chat = await app.inject({
      method: 'POST',
      url: '/chats',
      headers: bearer(token),
      payload: { title: 'first chat' },
    });
    expect(chat.statusCode, 'a fresh token did not open the gate').toBe(201);
    expect(fake.rows[0]?.owner_key, 'the owner is not the verified email').toBe(
      `email:${OWNER_EMAIL}`,
    );
    await app.close();
  });

  it('denied (retired) -> 403 reason denied; no token minted', async () => {
    const { app } = prodApp({ lookup: { ok: true, found: true, values: ['Retired Member'] } });
    const res = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: 'abel@investslo.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('denied');
    expect(res.json().token).toBeUndefined();
    await app.close();
  });

  it('blank field -> the same denied reason (deny-by-design, a GHL data question)', async () => {
    const { app } = prodApp({ lookup: { ok: true, found: true, values: [] } });
    const res = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: 'jooliefl@gmail.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('denied');
    await app.close();
  });

  it('not found -> 403 reason not_found (ruled member-facing case, distinct from denied)', async () => {
    const { app } = prodApp({ lookup: { ok: true, found: false } });
    const res = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: 'stranger@example.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('not_found');
    await app.close();
  });

  it('GHL failure -> 503 lookup_failed, retry-shaped, NEVER a token (fail closed)', async () => {
    const { app } = prodApp({ lookup: { ok: false, detail: 'search HTTP 503' } });
    const res = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: OWNER_EMAIL },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().reason).toBe('lookup_failed');
    expect(res.json().token).toBeUndefined();
    await app.close();
  });

  it('junk emails 400 before GHL is ever consulted', async () => {
    const { app, ghlClient } = prodApp();
    for (const email of [undefined, '', 'not-an-email', 'a@b', 42]) {
      const res = await app.inject({ method: 'POST', url: AUTH_ENTRY_PATH, payload: { email } });
      expect(res.statusCode, JSON.stringify(email)).toBe(400);
    }
    expect(ghlClient.lookupCourseAccess).not.toHaveBeenCalled();
    await app.close();
  });

  it('/auth itself needs no token — the front door is reachable while locked out', async () => {
    const { app } = prodApp();
    const res = await app.inject({
      method: 'POST',
      url: AUTH_ENTRY_PATH,
      payload: { email: OWNER_EMAIL },
    });
    expect(res.statusCode, 'the gate locked its own front door').toBe(200);
    await app.close();
  });
});

describe('BUG-039 — /history is owner-scoped: Bob cannot read Alice', () => {
  const ALICE = 'alice@example.com';
  const BOB = 'bob@example.com';
  const ALICE_CHAT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function historyApp() {
    const fake = makeChatsSupabase([
      chatRecord({ id: ALICE_CHAT, owner_key: `email:${ALICE}` }),
    ]);
    fake.messages.push(
      { session_id: ALICE_CHAT, role: 'user', content: 'ALICE-PRIVATE-QUESTION' },
      { session_id: ALICE_CHAT, role: 'assistant', content: 'ALICE-PRIVATE-ANSWER' },
    );
    const app = buildApp(loadConfig(PROD_ENV), { supabase: fake.client as never });
    return { app, fake };
  }

  it('ACCEPT CONTROL: Alice reads her own transcript', async () => {
    // Without this, a route that 404s everything satisfies every security
    // assertion below.
    const { app } = historyApp();
    const res = await app.inject({
      method: 'GET',
      url: `/history?session_id=${ALICE_CHAT}`,
      headers: bearer(mintToken(ALICE, SIGNING_KEY, Date.now())),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((m: { content: string }) => m.content)).toEqual([
      'ALICE-PRIVATE-QUESTION',
      'ALICE-PRIVATE-ANSWER',
    ]);
    await app.close();
  });

  it('BOB, fully verified, reading ALICE\'S chat id -> 404, byte-identical to not-found', async () => {
    const { app } = historyApp();
    const bob = await app.inject({
      method: 'GET',
      url: `/history?session_id=${ALICE_CHAT}`,
      headers: bearer(mintToken(BOB, SIGNING_KEY, Date.now())),
    });
    const nonexistent = await app.inject({
      method: 'GET',
      url: '/history?session_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      headers: bearer(mintToken(BOB, SIGNING_KEY, Date.now())),
    });

    expect(bob.statusCode, "Bob read Alice's transcript").toBe(404);
    expect(bob.body, 'the not-owner 404 differs from the not-found 404 — existence leaks').toBe(
      nonexistent.body,
    );
    expect(bob.body).not.toContain('ALICE');
    await app.close();
  });

  it('a ROWLESS id answers 404 even to a valid member — no provable owner, no content', async () => {
    // The 611 legacy sessions and any invented id: returning content for a
    // row-less id would reopen the exact hole. The widget never fetches
    // /history for ids outside its own /chats list, so no real path breaks.
    const { app, fake } = historyApp();
    fake.messages.push({ session_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'user', content: 'legacy orphan line' });
    const res = await app.inject({
      method: 'GET',
      url: '/history?session_id=cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      headers: bearer(mintToken(ALICE, SIGNING_KEY, Date.now())),
    });
    expect(res.statusCode, 'a row-less transcript was served').toBe(404);
    await app.close();
  });

  it('an ARCHIVED chat answers 404 to its own owner — matching the mutation neighbours', async () => {
    const fake = makeChatsSupabase([
      chatRecord({ id: ALICE_CHAT, owner_key: `email:${ALICE}`, archived_at: '2026-08-01T00:00:00.000Z' }),
    ]);
    const app = buildApp(loadConfig(PROD_ENV), { supabase: fake.client as never });
    const res = await app.inject({
      method: 'GET',
      url: `/history?session_id=${ALICE_CHAT}`,
      headers: bearer(mintToken(ALICE, SIGNING_KEY, Date.now())),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('DEV, uncredentialed, keeps the Phase 1/2 posture — deliberate, dev-only by construction', async () => {
    // In production this branch is unreachable: the preHandler admits only
    // tokened requests and a token always resolves an owner. Pinned so the
    // posture is a decision on record, not an accident.
    const fake = makeChatsSupabase([
      chatRecord({ id: ALICE_CHAT, owner_key: `email:${ALICE}` }),
    ]);
    fake.messages.push({ session_id: ALICE_CHAT, role: 'user', content: 'dev read' });
    const devApp = buildApp(
      loadConfig({ ...PROD_ENV, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      { supabase: fake.client as never },
    );
    const res = await devApp.inject({ method: 'GET', url: `/history?session_id=${ALICE_CHAT}` });
    expect(res.statusCode).toBe(200);
    await devApp.close();
  });

  it('a CREDENTIALED dev request is scoped — the check is identity-keyed, not env-keyed', async () => {
    const { } = {};
    const fake = makeChatsSupabase([
      chatRecord({ id: ALICE_CHAT, owner_key: `email:${ALICE}` }),
    ]);
    fake.messages.push({ session_id: ALICE_CHAT, role: 'user', content: 'ALICE-PRIVATE-QUESTION' });
    const devApp = buildApp(
      loadConfig({ ...PROD_ENV, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      { supabase: fake.client as never },
    );
    const res = await devApp.inject({
      method: 'GET',
      url: `/history?session_id=${ALICE_CHAT}`,
      headers: bearer(mintToken(BOB, SIGNING_KEY, Date.now())),
    });
    expect(res.statusCode, 'a dev token read across owners').toBe(404);
    await devApp.close();
  });
});

describe('BUG-040 — NODE_ENV cannot silently disable the gate', () => {
  const gateProbe = async (nodeEnv: string | undefined) => {
    const env: Record<string, string> = {
      ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
      OPENAI_API_KEY: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
      SESSION_SIGNING_KEY: SIGNING_KEY,
    };
    if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
    const config = loadConfig(env as NodeJS.ProcessEnv);
    const app = buildApp(config, { supabase: makeChatsSupabase([]).client as never });
    const res = await app.inject({ method: 'GET', url: '/chats' });
    await app.close();
    return { config, status: res.statusCode };
  };

  it("INSPECTOR's two bypasses, dead: 'Production' and 'production ' leave the gate ACTIVE", async () => {
    // The discriminator is the status: 401 = the gate blocked; anything the
    // handler produced (200/503) = the gate was silently OFF.
    for (const variant of ['Production', 'production ']) {
      const { config, status } = await gateProbe(variant);
      expect(config.isProduction, `${JSON.stringify(variant)} resolved non-production`).toBe(true);
      expect(status, `${JSON.stringify(variant)} let the handler run`).toBe(401);
    }
  });

  it('case/whitespace variants, empty, unset, and garbage ALL leave the gate ACTIVE', async () => {
    for (const variant of ['PRODUCTION', 'PrOdUcTiOn', '  production  ', '', undefined, 'staging', 'prod', 'dev-ish']) {
      const { config, status } = await gateProbe(variant);
      expect(config.isProduction, `${JSON.stringify(variant)} resolved non-production — fail-open`).toBe(true);
      expect(status, `${JSON.stringify(variant)} let the handler run`).toBe(401);
    }
  });

  it("only explicit 'development' and 'test' (normalized) turn the gate off", async () => {
    for (const variant of ['development', 'test', ' TEST ', 'Development']) {
      const { config, status } = await gateProbe(variant);
      expect(config.isProduction, `${JSON.stringify(variant)} stayed production`).toBe(false);
      expect(status, `${JSON.stringify(variant)} was gated in dev`).not.toBe(401);
    }
  });

  it("the demo-page default uses the RESOLVED env: 'Production ' no longer enables it", async () => {
    const sloppy = loadConfig({
      OPENAI_API_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k',
      SESSION_SIGNING_KEY: SIGNING_KEY, NODE_ENV: 'Production ',
    } as NodeJS.ProcessEnv);
    expect(sloppy.enableDemoPage, 'a sloppy NODE_ENV enabled the public demo page').toBe(false);
    expect(sloppy.resolvedEnv).toBe('production');
    expect(sloppy.nodeEnvRaw).toBe('Production ');
  });
});

describe('S3 — dev posture is Phase 1/2, unchanged', () => {
  it('non-production: device headers still work and nothing 401s', async () => {
    // The 1800 pre-existing green tests are the broad evidence; this is the
    // explicit pin that the fallback is the DEV path, not an accident.
    const fake = makeChatsSupabase([
      chatRecord({ id: CHAT_A, owner_key: 'device:11111111-1111-4111-8111-111111111111' }),
    ]);
    const devApp = buildApp(
      loadConfig({ NODE_ENV: 'test', ...PROD_ENV, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      { supabase: fake.client as never },
    );
    const res = await devApp.inject({
      method: 'GET',
      url: '/chats',
      headers: { 'x-james-owner': 'device:11111111-1111-4111-8111-111111111111' },
    });
    expect(res.statusCode).toBe(200);
    await devApp.close();
  });

  it('a VALID TOKEN also works in dev — S4 exercises the real flow locally', async () => {
    const fake = makeChatsSupabase([]);
    const devApp = buildApp(
      loadConfig({ NODE_ENV: 'test', ...PROD_ENV, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      { supabase: fake.client as never },
    );
    const res = await devApp.inject({
      method: 'POST',
      url: '/chats',
      headers: bearer(validToken()),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(fake.rows[0]?.owner_key).toBe(`email:${OWNER_EMAIL}`);
    await devApp.close();
  });

  it('token OUTRANKS a stray device header — an asserted owner never shadows a verified one', async () => {
    const fake = makeChatsSupabase([]);
    const devApp = buildApp(
      loadConfig({ NODE_ENV: 'test', ...PROD_ENV, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      { supabase: fake.client as never },
    );
    const res = await devApp.inject({
      method: 'POST',
      url: '/chats',
      headers: {
        ...bearer(validToken()),
        'x-james-owner': 'device:22222222-2222-4222-8222-222222222222',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(fake.rows[0]?.owner_key, 'the asserted owner shadowed the verified one').toBe(
      `email:${OWNER_EMAIL}`,
    );
    await devApp.close();
  });
});
