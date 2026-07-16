import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import { makeFakeOpenAI, makeFakeSupabase, flushDetached } from './helpers/fakes.js';

const ALLOWED = 'https://preacademy.app.clientclub.net';

const config = loadConfig({
  ALLOWED_ORIGINS: `${ALLOWED}, https://staging.example.com`,
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

const app = buildApp(config);
afterAll(() => app.close());

describe('I1: CORS preflight (the old build returned 500 here)', () => {
  it('OPTIONS /chat from the allowed origin returns 204 with CORS headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/chat',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('content-type');
  });

  it('second allow-listed origin (comma-separated env) also passes', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/chat',
      headers: { origin: 'https://staging.example.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://staging.example.com');
  });
});

describe('I2: unknown origin gets no ACAO header (never "*")', () => {
  it('disallowed origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/chat',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('I3: POST /chat validates body before external calls', () => {
  it('missing message returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { session_id: 's1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/message/i);
  });

  it('missing session_id returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/session_id/i);
  });
});

describe('I4: Supabase down — the user still gets their answer', () => {
  it('returns 200 with the reply while every qa_logs/chat_messages write rejects', async () => {
    const rejections: unknown[] = [];
    const onRejection = (r: unknown) => rejections.push(r);
    process.on('unhandledRejection', onRejection);

    const openai = makeFakeOpenAI([{ content: 'A buy box is your written criteria.' }]);
    // Every insert rejects — Supabase is unavailable.
    const supabase = makeFakeSupabase({ insertRejects: true });
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/chat',
        headers: { origin: ALLOWED, 'content-type': 'application/json' },
        payload: { message: 'How does James build a buy box?', session_id: 'test-session' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().output).toBeTruthy();

      // Let the detached writes settle and any unhandled rejection surface.
      await flushDetached();

      // Pins the Job 1 fix: an unhandled rejection here would terminate the
      // process on Node 15+, turning "logging failed" into "server down".
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onRejection);
      await app.close();
    }
  });

  it('the writes were genuinely attempted (the rejection path was exercised)', async () => {
    const openai = makeFakeOpenAI([{ content: 'answer' }]);
    const supabase = makeFakeSupabase({ insertRejects: true });
    const app = buildApp(config, { openai: openai.client, supabase: supabase.client });

    const res = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      payload: { message: 'hello', session_id: 'test-session-2' },
    });
    await flushDetached();
    await app.close();

    expect(res.statusCode).toBe(200);
    // Guards against the test passing vacuously because nothing tried to write.
    expect(supabase.inserts.map((i) => i.table)).toEqual(
      expect.arrayContaining(['chat_messages', 'qa_logs']),
    );
  });
});

describe('/demo — the widget hosted on the API origin (no GHL needed)', () => {
  it('serves an HTML page that mounts the widget when enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('id="james-bot"');
    expect(res.body).toContain('/widget.js');
    expect(res.body).toContain('createJamesBot');
    // Same-origin by construction: the widget posts to '' + '/chat'.
    expect(res.body).toContain("apiUrl: ''");
  });

  it('is OFF in production unless ENABLE_DEMO_PAGE=true', async () => {
    const prodConfig = loadConfig({
      ALLOWED_ORIGINS: ALLOWED,
      OPENAI_API_KEY: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);
    const prodApp = buildApp(prodConfig);
    const res = await prodApp.inject({ method: 'GET', url: '/demo' });
    expect(res.statusCode).toBe(404);
    await prodApp.close();

    const demoOn = loadConfig({
      ALLOWED_ORIGINS: ALLOWED,
      OPENAI_API_KEY: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test',
      NODE_ENV: 'production',
      ENABLE_DEMO_PAGE: 'true',
    } as NodeJS.ProcessEnv);
    const demoApp = buildApp(demoOn);
    const res2 = await demoApp.inject({ method: 'GET', url: '/demo' });
    expect(res2.statusCode).toBe(200);
    await demoApp.close();
  });
});

describe('I7: GET /health returns 200', () => {
  it('health check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });
});
