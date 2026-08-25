import 'dotenv/config';
import { signingKeyProblem } from './server/sessionToken.js';

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
  /** Daily cap on Apify-touching LOOKUPS (cache hits are free) — the spend guard on the client's quota. */
  compsDailyRunCap: number;
  /**
   * US Census API key for the demographics section (CONTRACT §14.10).
   * OPTIONAL, same gating pattern as apifyToken: absent ⇒ demographics are
   * never attempted and NO section renders (an unconfigured feature is not a
   * failure). The key is free (api.census.gov/data/key_signup.html) — the
   * API stopped serving keyless requests (verified 2026-08-10: 302 to a
   * "Missing Key" page on every vintage).
   */
  censusApiKey?: string;
  /**
   * GHL access gating (Phase 3). Token OPTIONAL at S1: the client exists but
   * no route is gated until S3, which is where assertRuntimeConfig grows the
   * production requirement. The field id is a CONFIGURED VALUE, not a code
   * literal (C-1): it is INFERRED from cross-contact probe evidence until the
   * token gains the definitions scope, and a wrong id denies every member —
   * env-overridable so fixing it never needs a deploy of new code.
   */
  ghlApiToken?: string;
  ghlLocationId: string;
  ghlCourseAccessFieldId: string;
  /** HMAC key for member session tokens (S2). Boot REFUSES on absence or
   * triviality — a missing key that degraded to a predictable token would
   * look gated and not be. */
  sessionSigningKey?: string;
  /** S3: the auth gate and the dev fallback both key off THIS and nothing
   * else — no dedicated flag exists for production to flip (structural
   * requirement: a dev-only path production can reach by configuration is a
   * gate with a bypass; reaching ours requires redefining the deployment as
   * non-production, which changes everything else too). */
  isProduction: boolean;
  /** BUG-040: what NODE_ENV actually contained, and what it resolved to —
   * logged loudly at boot so a gate that is off ANNOUNCES it. */
  nodeEnvRaw: string | undefined;
  resolvedEnv: 'production' | 'development' | 'test';
}

/**
 * BUG-040 — NODE_ENV resolution, FAIL CLOSED.
 *
 * `env.NODE_ENV === 'production'` (strict, unnormalized) silently disabled
 * the auth gate for 'Production' (capital P) and 'production ' (trailing
 * space — routine when pasting into a hosting dashboard): the app booted
 * normally, served with authentication OFF, and nothing said so.
 *
 * The rule now: trim + lowercase, and anything outside the known set —
 * INCLUDING empty and unset — resolves to PRODUCTION. The gate's default is
 * ON; only an explicit, exact 'development' or 'test' turns it off. This is
 * why every test config must now DECLARE its posture (NODE_ENV: 'test') —
 * dev-by-omission was exactly the bypass.
 *
 * WHY NOT BOOT-REFUSE ON UNSET (stated per ruling): fail-closed-to-production
 * yields a GATED SERVICE, a refusal yields a full outage. The safer failure
 * is the one that keeps members served behind the gate, and the loud boot
 * line makes the fallback diagnosable rather than silent.
 */
export function resolveEnvironment(
  raw: string | undefined,
): 'production' | 'development' | 'test' {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'development') return 'development';
  if (normalized === 'test') return 'test';
  // 'production', '', unset, 'staging', 'Production ', garbage: the gate is ON.
  return 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const resolvedEnv = resolveEnvironment(env.NODE_ENV);
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
    // Uses the RESOLVED environment (BUG-040): the raw string let
    // 'Production ' enable the demo page in production too.
    enableDemoPage: env.ENABLE_DEMO_PAGE === 'true' || resolvedEnv !== 'production',
    ...(env.APIFY_TOKEN ? { apifyToken: env.APIFY_TOKEN } : {}),
    compsDailyRunCap: Number(env.COMPS_DAILY_RUN_CAP ?? 50),
    ...(env.CENSUS_API_KEY ? { censusApiKey: env.CENSUS_API_KEY } : {}),
    ...(env.GHL_API_TOKEN ? { ghlApiToken: env.GHL_API_TOKEN } : {}),
    ghlLocationId: env.GHL_LOCATION_ID ?? 'EDY094ip0U3HwMFQYsVy',
    ghlCourseAccessFieldId: env.GHL_COURSE_ACCESS_FIELD_ID ?? 'axyDeZQxj7gMCtV1FyxS',
    ...(env.SESSION_SIGNING_KEY ? { sessionSigningKey: env.SESSION_SIGNING_KEY } : {}),
    isProduction: resolvedEnv === 'production',
    nodeEnvRaw: env.NODE_ENV,
    resolvedEnv,
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
  // S2: the signing key refuses boot on absence or triviality — unlike the
  // optional feature keys above, a weak value here does not degrade a
  // feature, it silently unguards the whole product.
  const keyProblem = signingKeyProblem(config.sessionSigningKey);
  if (keyProblem) {
    throw new Error(
      `${keyProblem}. Generate one (e.g. openssl rand -base64 48) and set it in the ` +
        'environment. Rotating it invalidates every live member session.',
    );
  }
}
