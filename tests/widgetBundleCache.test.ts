/**
 * BUG-021 — /widget.js must be revalidatable, not merely uncached.
 *
 * `Cache-Control: no-cache` instructs a browser to REVALIDATE before reuse. It
 * can only do that if the response gave it a validator to quote back. This
 * route sent none, so there was no conditional request available and every page
 * load re-downloaded the whole bundle (measured: 3/3 loads, 35,542 bytes).
 *
 * The trap this file is written around: "the ETag changes when the bundle
 * changes" is satisfied by a validator minted fresh on every boot — a uuid, a
 * timestamp — which is WORSE than no ETag at all, because two instances behind
 * one load balancer would then disagree and revalidation would miss every time
 * while looking correct in a single-process test. So the stability cases below
 * carry as much weight as the sensitivity ones, and neither is meaningful
 * alone.
 */
import { describe, it, expect } from 'vitest';
import { buildApp, bundleEtag, ifNoneMatchMatches } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig({ NODE_ENV: 'test',
  ALLOWED_ORIGINS: 'https://preacademy.app.clientclub.net',
  OPENAI_API_KEY: 'test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test',
} as NodeJS.ProcessEnv);

const get = (app: ReturnType<typeof buildApp>, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/widget.js', headers });

describe('the validator itself', () => {
  it('is DERIVED FROM THE BYTES — same bundle, same tag, every time', () => {
    // The case that kills a per-boot random or timestamped validator. Computed
    // twice from separately-constructed buffers so nothing is shared but the
    // content.
    const a = bundleEtag(Buffer.from('createJamesBot v1'));
    const b = bundleEtag(Buffer.from('createJamesBot v1'));
    expect(a).toBe(b);
  });

  it('changes when the bundle changes', () => {
    // The converse, which kills a hardcoded constant.
    expect(bundleEtag(Buffer.from('createJamesBot v1'))).not.toBe(
      bundleEtag(Buffer.from('createJamesBot v2')),
    );
  });

  it('is sensitive to a ONE-BYTE difference, not just a length difference', () => {
    // A tag derived from file size alone would pass the case above and miss
    // every same-length edit — which is most of them.
    const one = bundleEtag(Buffer.from('aaaaaaaa'));
    const two = bundleEtag(Buffer.from('aaaaaaab'));
    expect(one).not.toBe(two);
  });

  it('is a QUOTED strong entity-tag (RFC 9110 §8.8.3)', () => {
    // An unquoted tag is malformed and a cache is entitled to ignore it, which
    // fails silently as "caching just does not work".
    expect(bundleEtag(Buffer.from('x'))).toMatch(/^"[0-9a-f]{32}"$/);
  });
});

describe('If-None-Match comparison', () => {
  const tag = '"abc123"';

  it('matches the identical tag', () => {
    expect(ifNoneMatchMatches(tag, tag)).toBe(true);
  });

  it('does NOT match a different tag', () => {
    // The control. Without it, a comparator hardwired to `true` passes
    // everything else in this block.
    expect(ifNoneMatchMatches('"different"', tag)).toBe(false);
  });

  it('matches WEAKLY — W/"x" against "x" (RFC 9110 §13.1.2)', () => {
    // An intermediary may weaken a validator in transit. Comparing verbatim
    // would turn every such request back into a full download: the exact
    // defect this fix exists to close, reintroduced one layer down.
    expect(ifNoneMatchMatches('W/"abc123"', tag)).toBe(true);
  });

  it('handles the header as a LIST, matching any member', () => {
    expect(ifNoneMatchMatches('"stale", W/"abc123", "older"', tag)).toBe(true);
  });

  it('a list of exclusively non-matching tags is still a miss', () => {
    expect(ifNoneMatchMatches('"stale", "older"', tag)).toBe(false);
  });

  it('* matches any current representation', () => {
    expect(ifNoneMatchMatches('*', tag)).toBe(true);
  });

  it('an absent header is a miss, not a match', () => {
    // A first-ever load sends no If-None-Match. Getting this backwards would
    // serve a 304 with no body to a browser holding nothing — a blank widget.
    expect(ifNoneMatchMatches(undefined, tag)).toBe(false);
    expect(ifNoneMatchMatches('', tag)).toBe(false);
  });
});

describe('GET /widget.js', () => {
  it('first fetch: 200, the bundle, an ETag, and Cache-Control: no-cache', async () => {
    const app = buildApp(config);
    const res = await get(app);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers.etag, 'no validator — nothing to revalidate against').toMatch(
      /^"[0-9a-f]{32}"$/,
    );
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body.length, 'the bundle body is missing').toBeGreaterThan(1000);
    expect(res.body).toContain('createJamesBot');
    await app.close();
  });

  it('conditional fetch with the matching ETag: 304 and NO body', async () => {
    const app = buildApp(config);
    const first = await get(app);

    const second = await get(app, { 'if-none-match': String(first.headers.etag) });

    expect(second.statusCode).toBe(304);
    expect(second.body, 'a 304 that still ships the bundle saves nothing').toBe('');
    await app.close();
  });

  it('the 304 still carries the ETag, so the NEXT load can revalidate too', async () => {
    // Without this the caching would work exactly once: the browser would
    // update its stored response from a 304 that named no validator and have
    // nothing to send on the third load.
    const app = buildApp(config);
    const first = await get(app);
    const second = await get(app, { 'if-none-match': String(first.headers.etag) });

    expect(second.headers.etag).toBe(first.headers.etag);
    expect(second.headers['cache-control']).toBe('no-cache');
    await app.close();
  });

  it('conditional fetch with a NON-matching ETag: 200 and the full bundle', async () => {
    // The control for the 304 case. A route that answered 304 unconditionally
    // would pass every assertion above and serve a permanently blank widget to
    // anyone whose cache held an older build.
    const app = buildApp(config);
    const res = await get(app, { 'if-none-match': '"not-the-current-bundle"' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('createJamesBot');
    await app.close();
  });

  it('a WEAKENED form of the current tag still yields 304, end to end', async () => {
    const app = buildApp(config);
    const first = await get(app);

    const second = await get(app, { 'if-none-match': `W/${first.headers.etag}` });

    expect(second.statusCode).toBe(304);
    await app.close();
  });

  it('TWO app instances over the same bundle serve the SAME ETag', async () => {
    // The load-balancer case, and the one that catches a validator minted per
    // boot. Two processes serving one deploy must agree, or a browser
    // revalidating against whichever it reaches next misses every time.
    const one = buildApp(config);
    const two = buildApp(config);

    const a = await get(one);
    const b = await get(two);

    expect(a.headers.etag).toBe(b.headers.etag);
    // And the tag from instance A must satisfy instance B.
    const cross = await get(two, { 'if-none-match': String(a.headers.etag) });
    expect(cross.statusCode).toBe(304);
    await one.close();
    await two.close();
  });

  it('the ETag is the hash of the bytes it actually served', async () => {
    // Ties the header to the body rather than to some other value that merely
    // happens to be stable — the assertion that makes "derived from the bytes"
    // a claim about THIS response.
    const app = buildApp(config);
    const res = await get(app);

    expect(res.headers.etag).toBe(bundleEtag(res.rawPayload));
    await app.close();
  });

  it('serves from memory — the bundle is read once, not per request', async () => {
    // Three sequential fetches must be byte-identical and same-tagged. This is
    // a consequence check, not a proof of the disk read being gone; the read
    // itself is pinned by construction in the route.
    const app = buildApp(config);
    const results = [await get(app), await get(app), await get(app)];

    expect(new Set(results.map((r) => r.headers.etag)).size).toBe(1);
    expect(new Set(results.map((r) => r.body)).size).toBe(1);
    await app.close();
  });
});
