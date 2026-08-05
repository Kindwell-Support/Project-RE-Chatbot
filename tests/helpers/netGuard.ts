/**
 * Offline guarantee for the default test run.
 *
 * Apify runs bill the client's own quota. A single stray `fetch` reaching a
 * real provider from CI spends real money on every push, and the failure is
 * invisible — the tests still pass, the invoice just grows.
 *
 * Gating live suites with `describe.skipIf` is necessary but not sufficient: it
 * only covers the suites someone remembered to gate. This closes the hole at
 * the runtime instead — `globalThis.fetch` is replaced with a stub that throws
 * and names the URL it was about to call.
 *
 * WIRING (needs `vitest.config.ts`, which is MASON's file — requested in
 * mailbox 0007):
 *
 *   import { defineConfig } from 'vitest/config';
 *   export default defineConfig({
 *     test: { setupFiles: ['tests/helpers/netGuard.ts'] },
 *   });
 *
 * Escape hatches, both explicit and both loud:
 *   RUN_LIVE_TESTS=1   real OpenAI + Supabase (existing `tests/live.test.ts`)
 *   RUN_LIVE_APIFY=1   real Apify — spends the client's quota
 *
 * KNOWN LIMIT: this traps `fetch` only. A dependency reaching for `node:http`
 * or `node:net` directly would slip past. Everything in this stack — the OpenAI
 * SDK, supabase-js, and any sane Apify client — is fetch-based, so the guard
 * covers the realistic paths. Worth revisiting if a provider client is ever
 * added that isn't.
 */

const LIVE_FLAGS = ['RUN_LIVE_TESTS', 'RUN_LIVE_APIFY'] as const;

const enabledFlags = LIVE_FLAGS.filter((f) => process.env[f] === '1');

/** Exported so a test can assert the guard is actually installed. */
export const NET_GUARD_ACTIVE = enabledFlags.length === 0;

if (!NET_GUARD_ACTIVE) {
  // A live run is deliberate, but it should never be quiet — this line is the
  // difference between "I meant to spend money" and "why is the bill so high".
  console.warn(
    `[netGuard] DISABLED — ${enabledFlags.join(', ')} set. ` +
      'Real network calls are permitted and may bill the client.',
  );
} else {
  const realFetch = globalThis.fetch;

  const blocked = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input
        : input instanceof URL ? input.href
          : (input as Request).url ?? String(input);
    const method = init?.method ?? (input as Request)?.method ?? 'GET';

    throw new Error(
      `[netGuard] Blocked a network call from the default test run.\n` +
        `  ${method} ${url}\n` +
        `\n` +
        `Default \`npm test\` must make zero network calls — Apify runs bill the\n` +
        `client's own quota. Either fake the client at the boundary (see\n` +
        `tests/helpers/fakes.ts), or gate the suite behind RUN_LIVE_TESTS=1 /\n` +
        `RUN_LIVE_APIFY=1 and run it deliberately.`,
    );
  };

  // Keep a handle so a deliberately-live suite inside an otherwise-guarded run
  // can restore it, and so this file is idempotent if loaded twice.
  (blocked as unknown as { __realFetch: typeof fetch }).__realFetch = realFetch;
  globalThis.fetch = blocked as unknown as typeof fetch;
}
