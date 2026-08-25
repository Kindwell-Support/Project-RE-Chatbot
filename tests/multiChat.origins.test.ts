/**
 * I2 — the operator's live origin probe table, run against THIS branch.
 *
 * cors.test.ts covers the shape (allowed vs a generic evil origin). It does
 * NOT cover the real neighbours: the production apex and its subdomains, the
 * staging sibling of the real origin, and the http:// variant of the allowed
 * host. Those are the ones an attacker actually has, and a prefix/suffix bug
 * in origin matching shows up there and nowhere else.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

const ALLOWED = 'https://preacademy.app.clientclub.net';
const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: ALLOWED,
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);
const app = buildApp(config);
afterAll(() => app.close());

const preflight = (origin: string, route = '/chats', method = 'GET') =>
  app.inject({
    method: 'OPTIONS',
    url: route,
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'content-type, x-james-owner',
    },
  });

describe('I2 — origin probe table', () => {
  it('the real GHL origin is ALLOWED and echoed exactly, never "*"', async () => {
    const res = await preflight(ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-origin'], 'wildcarded').not.toBe('*');
  });

  it.each([
    ['apex', 'https://projectre.com'],
    ['www', 'https://www.projectre.com'],
    ['members', 'https://members.projectre.com'],
    ['app', 'https://app.projectre.com'],
    ['academy', 'https://academy.projectre.com'],
    ['staging sibling', 'https://staging.app.clientclub.net'],
    ['no TLS variant of the real origin', 'http://preacademy.app.clientclub.net'],
    ['suffix-extension attack', 'https://preacademy.app.clientclub.net.evil.com'],
    ['prefix attack', 'https://evilpreacademy.app.clientclub.net'],
  ])('%s is DENIED with no ACAO header at all', async (_label, origin) => {
    const res = await preflight(origin);
    expect(
      res.headers['access-control-allow-origin'],
      `${origin} received an ACAO header. A browser will let that origin read ` +
        'chat listings and transcripts.',
    ).toBeUndefined();
  });

  it('I1: no HEAD or PUT is advertised on routes that do not take them', async () => {
    const res = await preflight(ALLOWED);
    const methods = String(res.headers['access-control-allow-methods'] ?? '')
      .split(',')
      .map((m) => m.trim().toUpperCase());
    expect(methods, 'PUT is advertised but no route implements it').not.toContain('PUT');
    expect(methods, 'HEAD is advertised but no route implements it').not.toContain('HEAD');
    expect(methods, 'the owner-key routes need GET').toContain('GET');
  });

  it('I1: allow-headers are the credential pair ONLY — no wildcard, no widening (S3: authorization replaced x-james-owner)', async () => {
    const res = await preflight(ALLOWED);
    const headers = String(res.headers['access-control-allow-headers'] ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .sort();
    expect(headers, 'allow-headers widened beyond content-type + the owner key')
      .toEqual(['authorization', 'content-type']);
  });
});
