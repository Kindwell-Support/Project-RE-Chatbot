import 'dotenv/config';

export interface AppConfig {
  openaiApiKey: string;
  openaiModel: string;
  embeddingModel: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  allowedOrigins: string[];
  port: number;
  matchCount: number;
  matchThreshold: number;
  enableDemoPage: boolean;
  /**
   * Apify token for the comps feature. OPTIONAL at boot by design: absence
   * does not fail assertRuntimeConfig — it gates the run_comps tool out of
   * TOOL_DEFINITIONS entirely (CONTRACT §9), so the model can never offer a
   * lookup the backend cannot perform.
   */
  apifyToken?: string;
  /** Daily cap on PROVIDER runs (cache hits are free) — the spend guard on the client's Apify quota. */
  compsDailyRunCap: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    openaiApiKey: env.OPENAI_API_KEY ?? '',
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o',
    // Must stay text-embedding-3-small — the documents table was embedded with
    // it, and a different model breaks retrieval.
    embeddingModel: env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    supabaseUrl: env.SUPABASE_URL ?? '',
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://preacademy.app.clientclub.net')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    port: Number(env.PORT ?? 3000),
    matchCount: Number(env.MATCH_COUNT ?? 5),
    matchThreshold: Number(env.MATCH_THRESHOLD ?? 0),
    // /demo hosts the widget on the API's own origin (no GHL needed). On by
    // default outside production; in production set ENABLE_DEMO_PAGE=true.
    enableDemoPage: env.ENABLE_DEMO_PAGE === 'true' || env.NODE_ENV !== 'production',
    ...(env.APIFY_TOKEN ? { apifyToken: env.APIFY_TOKEN } : {}),
    compsDailyRunCap: Number(env.COMPS_DAILY_RUN_CAP ?? 50),
  };
}

/**
 * The `documents` table was embedded with text-embedding-3-small. Querying it
 * with a different model is only loud if the dimensions differ:
 *   - text-embedding-3-large is 3072-dim  -> pgvector errors, obvious.
 *   - text-embedding-ada-002 is ALSO 1536 -> no error, silently wrong results.
 * The ada-002 case is the dangerous one, so it is rejected explicitly rather
 * than left to fail quietly in production.
 */
export const REQUIRED_EMBEDDING_MODEL = 'text-embedding-3-small';

export function assertRuntimeConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseServiceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (config.embeddingModel !== REQUIRED_EMBEDDING_MODEL) {
    throw new Error(
      `EMBEDDING_MODEL must be "${REQUIRED_EMBEDDING_MODEL}" (got "${config.embeddingModel}"). ` +
        'The documents table was embedded with it. A 1536-dim substitute such as ' +
        'text-embedding-ada-002 will NOT error — it will return silently wrong results. ' +
        'Only change this after re-embedding the entire documents table.',
    );
  }
}
