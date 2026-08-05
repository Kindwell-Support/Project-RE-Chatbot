/**
 * The one job of this file is the netGuard setup hook: the default `npm test`
 * must make ZERO network calls, because a stray fetch reaching Apify bills
 * the client's own quota invisibly — the suite stays green, the invoice
 * grows. The guard (INSPECTOR-owned, tests/helpers/netGuard.ts) swaps
 * globalThis.fetch for a throwing stub unless RUN_LIVE_TESTS=1 or
 * RUN_LIVE_APIFY=1 is set deliberately.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['tests/helpers/netGuard.ts'] },
});
