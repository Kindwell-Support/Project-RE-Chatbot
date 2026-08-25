import { createClient } from '@supabase/supabase-js';
import { loadConfig, assertRuntimeConfig } from '../config.js';
import { buildApp } from './app.js';
import { ensureChatMessagesTable, ensureCompsTables } from './migrate.js';
import { createGhlClient } from './ghl.js';

const config = loadConfig();
assertRuntimeConfig(config);

// BUG-040: a gate that is off must ANNOUNCE it — the silent failure is the
// dangerous one (same class as the migrate probes). One line, every boot.
console.log(
  '[env] NODE_ENV=%s -> %s — auth gate %s%s',
  config.nodeEnvRaw === undefined ? '(unset)' : JSON.stringify(config.nodeEnvRaw),
  config.resolvedEnv,
  config.isProduction ? 'ACTIVE' : 'INACTIVE',
  config.isProduction && config.resolvedEnv === 'production' &&
    (config.nodeEnvRaw ?? '').trim().toLowerCase() !== 'production'
    ? ' (FAIL-CLOSED: unrecognised NODE_ENV treated as production)'
    : '',
);

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

await ensureChatMessagesTable(supabase);
await ensureCompsTables(supabase);

// C-1 boot probe: verify the configured Course Access field id against the
// definitions endpoint. DETACHED like the migrate probes — it must never
// block boot (a member-facing outage over a diagnostics call would invert
// the priority), and its .catch is the anti-process-kill guarantee.
if (config.ghlApiToken) {
  void createGhlClient(config)
    .verifyFieldId()
    .catch((err) => console.warn('[ghl] boot field-id probe failed', err));
} else {
  console.warn('[ghl] GHL_API_TOKEN not set — access gating client unconfigured (S3 will require it in production)');
}

const app = buildApp(config, { supabase });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
