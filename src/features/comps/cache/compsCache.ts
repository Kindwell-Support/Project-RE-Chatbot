/**
 * Supabase-backed comps cache — implements CompsCacheLike (service.ts).
 *
 * Failure posture (CONTRACT §7): a broken cache degrades to a live run and a
 * warn log. It must cost money, never block a member — the inverse trade of
 * everything else in this feature. Errors therefore never propagate; the
 * service's own try/catch is belt-and-braces on top.
 *
 * Expiry is enforced ON READ (expired rows treated as absent) so correctness
 * never depends on a cleanup job existing. The expires_at index is for the
 * eventual cleanup, not for correctness.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CachedComps, CompsCacheLike } from '../service.js';

interface CompsCacheRow {
  cache_key: string;
  normalized_address: string;
  raw_subject: CachedComps['rawSubject'];
  raw_comps: CachedComps['rawComps'];
  result: CachedComps['result'];
  algo_version: number;
  provider: string;
  expires_at: string;
}

export function createCompsCache(supabase: SupabaseClient): CompsCacheLike {
  return {
    async get(key: string): Promise<CachedComps | null> {
      const { data, error } = await supabase
        .from('comps_cache')
        .select('cache_key, normalized_address, raw_subject, raw_comps, result, algo_version, provider, expires_at')
        .eq('cache_key', key)
        .maybeSingle();
      if (error) throw error; // service catches, warns with cacheKey, runs live
      if (!data) return null;
      const row = data as CompsCacheRow;
      return {
        cacheKey: row.cache_key,
        normalizedAddress: row.normalized_address,
        rawSubject: row.raw_subject,
        rawComps: row.raw_comps ?? [],
        result: row.result,
        algoVersion: row.algo_version,
        provider: row.provider,
        expiresAt: row.expires_at,
      };
    },

    async set(entry: CachedComps): Promise<void> {
      const { error } = await supabase.from('comps_cache').upsert({
        cache_key: entry.cacheKey,
        normalized_address: entry.normalizedAddress,
        raw_subject: entry.rawSubject,
        raw_comps: entry.rawComps,
        result: entry.result,
        algo_version: entry.algoVersion,
        provider: entry.provider,
        expires_at: entry.expiresAt,
      });
      if (error) throw error;
    },
  };
}
