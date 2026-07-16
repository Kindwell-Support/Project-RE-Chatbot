import { createClient } from '@supabase/supabase-js';
import { loadConfig, assertRuntimeConfig } from '../config.js';
import { buildApp } from './app.js';
import { ensureChatMessagesTable } from './migrate.js';

const config = loadConfig();
assertRuntimeConfig(config);

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

await ensureChatMessagesTable(supabase);

const app = buildApp(config, { supabase });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
