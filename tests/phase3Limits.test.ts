/**
 * Phase 3 unconditional items — rate limits, per-member comps budget, message
 * cap, bodyLimit.
 *
 * Sizing discipline: the caps are env-configurable and these tests set TINY
 * ones, so each case drives a handful of requests rather than dozens — the
 * subject is the limiter wiring and its key choice, not the production
 * number. The load-bearing assignments (per-IP on /auth, per-email on /chat)
 * each carry the case that distinguishes them from the other key.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { mintToken } from '../src/server/sessionToken.js';
import { createFixedWindowLimiter } from '../src/server/rateLimit.js';
import { createMemberScopedBudget, createDailyRunBudget } from '../src/features/comps/service.js';
import { makeChatsSupabase } from './helpers/chatsFakes.js';
import { makeFakeOpenAI } from './helpers/fakes.js';
import type { CourseAccessLookup } from '../src/server/ghl.js';

const SIGNING_KEY = 'phase3-limits-signing-key-0123456789-abcdef';

const BASE_ENV = {
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
  NODE_ENV: 'production',
  SESSION_SIGNING_KEY: SIGNING_KEY,
} as Record<string, string>;

function appWith(envOverrides: Record<string, string> = {}) {
  const fake = makeChatsSupabase([]);
  const ghlClient = {
    lookupCourseAccess: vi.fn(
      async (): Promise<CourseAccessLookup> => ({ ok: true, found: true, values: ['Project Flip'] }),
    ),
    verifyFieldId: vi.fn(async () => 'verified' as const),
    stats: () => ({ lookups: 0, failures: 0 }),
  };
  const app = buildApp(loadConfig({ ...BASE_ENV, ...envOverrides } as NodeJS.ProcessEnv), {
    supabase: fake.client as never,
    ghlClient,
    openai: makeFakeOpenAI([{ content: 'a fast fake answer' }]).client as never,
  });
  return { app, ghlClient };
}

const token = (email: string) => mintToken(email, SIGNING_KEY, Date.now());

describe('the fixed-window limiter itself', () => {
  it('allows max, blocks max+1, and a new window resets', () => {
    const limiter = createFixedWindowLimiter(2, 60_000);
    const t0 = 1_000_000;
    expect(limiter.allow('k', t0)).toBe(true);
    expect(limiter.allow('k', t0 + 1)).toBe(true);
    expect(limiter.allow('k', t0 + 2), 'the cap did not bind').toBe(false);
    expect(limiter.allow('k', t0 + 60_001), 'the window did not reset').toBe(true);
  });

  it('keys are independent — one caller cannot exhaust another', () => {
    const limiter = createFixedWindowLimiter(1, 60_000);
    const t0 = 1_000_000;
    expect(limiter.allow('a', t0)).toBe(true);
    expect(limiter.allow('a', t0 + 1)).toBe(false);
    expect(limiter.allow('b', t0 + 2), 'key b was charged for key a').toBe(true);
  });
});

describe('/auth — per-IP is the load-bearing limit (the oracle sizing)', () => {
  it('the N+1th probe from ONE IP is 429 and NEVER reaches GHL — quota protection', async () => {
    const { app, ghlClient } = appWith({ AUTH_IP_LIMIT_PER_MIN: '2' });
    const probe = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/auth',
        payload: { email },
        remoteAddress: '203.0.113.7',
      });

    // DISTINCT EMAILS on every probe — the enumeration shape per-email cannot
    // bound, which is why per-IP is the load-bearing key here.
    expect((await probe('a1@example.com')).statusCode).toBe(200);
    expect((await probe('a2@example.com')).statusCode).toBe(200);
    const third = await probe('a3@example.com');

    expect(third.statusCode, 'the sweep was not bounded').toBe(429);
    expect(third.json().reason).toBe('rate_limited');
    expect(
      ghlClient.lookupCourseAccess.mock.calls.length,
      'the 429d probe still billed a GHL call — the quota protection is cosmetic',
    ).toBe(2);
    await app.close();
  });

  it('a different IP is unaffected — the limit is per-IP, not global', async () => {
    const { app } = appWith({ AUTH_IP_LIMIT_PER_MIN: '1' });
    const probe = (ip: string) =>
      app.inject({ method: 'POST', url: '/auth', payload: { email: 'x@example.com' }, remoteAddress: ip });

    expect((await probe('203.0.113.7')).statusCode).toBe(200);
    expect((await probe('203.0.113.7')).statusCode).toBe(429);
    expect((await probe('203.0.113.8')).statusCode, 'IP b was charged for IP a').toBe(200);
    await app.close();
  });
});

describe('BUG-043 — trustProxy: 1 resolves the real client, not the leftmost XFF', () => {
  // The hop count is the boundary between trusting the platform and trusting
  // the caller. The DISCRIMINATING property — the one that separates the fix
  // (:1, key = one hop from the right = real client) from the defect (:true,
  // key = leftmost = attacker-controlled): with the SAME spoofed leftmost but
  // a DIFFERENT real rightmost, :1 sees two distinct keys (second allowed)
  // while :true sees one shared spoof key (second throttled). Every spoof
  // case below is built that way and was confirmed to go RED under :true.
  const LB = '10.0.0.9';

  // At cap 1: two requests sharing `spoof` as the leftmost XFF entry but
  // carrying DIFFERENT real clients as the rightmost. Returns the second
  // status — 200 means the key followed the real client (fix), 429 means it
  // followed the shared spoof (defect).
  const secondStatusForSharedSpoof = async (spoof: string) => {
    const { app } = appWith({ AUTH_IP_LIMIT_PER_MIN: '1' });
    const hit = (real: string) =>
      app.inject({
        method: 'POST',
        url: '/auth',
        payload: { email: 'x@example.com' },
        headers: { 'x-forwarded-for': `${spoof}, ${real}` },
        remoteAddress: LB,
      });
    await hit('192.0.2.55');
    const second = await hit('192.0.2.66'); // same spoof, different real client
    await app.close();
    return second.statusCode;
  };

  it('SPOOF + LB append: the leftmost spoof is NOT the key (different real client passes)', async () => {
    expect(
      await secondStatusForSharedSpoof('198.51.100.7'),
      'a spoofed leftmost entry became the rate-limit key',
    ).toBe(200);
  });

  it('LOOPBACK spoof + append: 127.0.0.1 leftmost is not smuggled in as the key', async () => {
    expect(await secondStatusForSharedSpoof('127.0.0.1')).toBe(200);
  });

  it('BENIGN preserved: the SAME real client (LB append only) repeats -> throttled', async () => {
    // Not a discriminator (holds under both settings) but the necessary
    // preservation case: the fix must still bound a genuine repeat offender.
    const { app } = appWith({ AUTH_IP_LIMIT_PER_MIN: '1' });
    const hit = () =>
      app.inject({
        method: 'POST',
        url: '/auth',
        payload: { email: 'x@example.com' },
        headers: { 'x-forwarded-for': '192.0.2.55' },
        remoteAddress: LB,
      });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode, 'a real repeat offender escaped the cap').toBe(429);
    await app.close();
  });

  it('no XFF: request.ip is the socket, not something header-derived', async () => {
    // Documents the no-header case; two distinct sockets are distinct keys.
    const { app } = appWith({ AUTH_IP_LIMIT_PER_MIN: '1' });
    const hit = (sock: string) =>
      app.inject({ method: 'POST', url: '/auth', payload: { email: 'x@example.com' }, remoteAddress: sock });
    expect((await hit('192.0.2.1')).statusCode).toBe(200);
    expect((await hit('192.0.2.1')).statusCode, 'same socket not bounded').toBe(429);
    expect((await hit('192.0.2.2')).statusCode, 'a different socket was charged for the first').toBe(200);
    await app.close();
  });

  it('END TO END: a ROTATING spoofed XFF is throttled and does NOT reach GHL', async () => {
    // The measured defect: rotating the leftmost entry gave 12/12 x 200 and
    // 12 real GHL calls, because each spoof was a distinct key. Under :1 every
    // request resolves to the SAME real client (one hop from the right), so
    // the cap binds and the refused probes never bill GHL.
    const { app, ghlClient } = appWith({ AUTH_IP_LIMIT_PER_MIN: '3' });
    let allowed = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth',
        payload: { email: `probe${i}@example.com` },
        headers: { 'x-forwarded-for': `198.51.100.${i}, 192.0.2.55` }, // rotating spoof, fixed real client
        remoteAddress: LB,
      });
      if (res.statusCode === 200) allowed += 1;
    }
    expect(allowed, 'the rotating-spoof sweep was not bounded').toBe(3);
    expect(
      ghlClient.lookupCourseAccess.mock.calls.length,
      'refused probes still billed GHL — the quota is unprotected',
    ).toBe(3);
    await app.close();
  });
});

describe('/chat — per-email is the load-bearing limit', () => {
  const chat = (app: ReturnType<typeof appWith>['app'], email: string, ip: string) =>
    app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'hello', session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      headers: { authorization: `Bearer ${token(email)}` },
      remoteAddress: ip,
    });

  it('the SAME member is bounded even across DIFFERENT IPs — the token is the key', async () => {
    // A leaked token replayed from many addresses is the case per-IP misses.
    const { app } = appWith({ CHAT_MEMBER_LIMIT_PER_MIN: '2', CHAT_IP_LIMIT_PER_MIN: '100' });
    expect((await chat(app, 'member@example.com', '203.0.113.1')).statusCode).not.toBe(429);
    expect((await chat(app, 'member@example.com', '203.0.113.2')).statusCode).not.toBe(429);
    const third = await chat(app, 'member@example.com', '203.0.113.3');
    expect(third.statusCode, 'a member hopping IPs escaped the member limit').toBe(429);
    expect(third.json().reason).toBe('rate_limited');
    await app.close();
  });

  it('a DIFFERENT member from the same IP is charged separately, until per-IP binds', async () => {
    const { app } = appWith({ CHAT_MEMBER_LIMIT_PER_MIN: '1', CHAT_IP_LIMIT_PER_MIN: '3' });
    const ip = '203.0.113.9';
    expect((await chat(app, 'a@example.com', ip)).statusCode).not.toBe(429);
    expect((await chat(app, 'b@example.com', ip)).statusCode).not.toBe(429);
    expect((await chat(app, 'a@example.com', ip)).statusCode, 'member a not bounded').toBe(429);
    // The secondary net: a fourth DISTINCT member from the same address hits
    // the per-IP cap (3 allowed calls consumed above).
    expect((await chat(app, 'c@example.com', ip)).statusCode).not.toBe(429);
    expect((await chat(app, 'd@example.com', ip)).statusCode, 'per-IP net absent').toBe(429);
    await app.close();
  });
});

describe('message cap and bodyLimit — the two levers nobody had chosen', () => {
  it('a message over the cap is 400 message_too_long; at the cap it proceeds', async () => {
    const { app } = appWith({ MAX_MESSAGE_CHARS: '100' });
    const send = (len: number) =>
      app.inject({
        method: 'POST',
        url: '/chat',
        payload: { message: 'x'.repeat(len), session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        headers: { authorization: `Bearer ${token('member@example.com')}` },
      });

    const over = await send(101);
    expect(over.statusCode).toBe(400);
    expect(over.json().reason).toBe('message_too_long');
    const atCap = await send(100);
    expect(atCap.statusCode, 'the boundary message was rejected').not.toBe(400);
    await app.close();
  });

  it('a body over 32 KiB is 413 — the implicit 1 MiB default is gone', async () => {
    const { app } = appWith({});
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        message: 'x'.repeat(40 * 1024),
        session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      headers: { authorization: `Bearer ${token('member@example.com')}` },
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });
});

describe('per-member comps budget, layered under the global counter', () => {
  it('one member exhausts THEIR cap, not the pool; neither counter leaks on denial', () => {
    const globalBudget = createDailyRunBudget(4);
    const forMember = createMemberScopedBudget(globalBudget, 2);
    const now = new Date('2026-08-25T12:00:00Z');

    const a = forMember('email:a@example.com');
    const b = forMember('email:b@example.com');

    expect(a.tryConsume(now)).toBe(true);
    expect(a.tryConsume(now)).toBe(true);
    expect(a.tryConsume(now), 'member a exceeded their cap').toBe(false); // member-denied
    // THE FIX'S SUBJECT: a's denial charged nothing globally — b still has
    // the pool the one-request DoS used to empty.
    expect(b.tryConsume(now)).toBe(true);
    expect(b.tryConsume(now)).toBe(true);
    // Global pool (4) now exhausted; a third member is globally denied and
    // their MEMBER slot is not charged either (retry after midnight works).
    const c = forMember('email:c@example.com');
    expect(c.tryConsume(now), 'the global layer vanished').toBe(false);

    // Day rollover resets the member window.
    const tomorrow = new Date('2026-08-26T12:00:00Z');
    expect(a.tryConsume(tomorrow), 'the member window never resets').toBe(true);
  });
});
