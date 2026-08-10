/**
 * Tract-keyed demographics cache (CONTRACT §14.10). The Census API is free,
 * so this cache is not a spend guard — it is latency (two HTTP round trips
 * saved), politeness, and headroom under the API key's daily request quota.
 * ACS data changes once a year, hence the long TTL (CENSUS_CACHE_TTL_DAYS).
 *
 * Same failure posture as every comps cache: errors throw to the caller,
 * the service catches and degrades — here to a live Census query, or to the
 * "unavailable" line. Expiry enforced on read.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Demographics } from '../types.js';

export interface CensusCacheLike {
  get(tractGeoid: string, now: Date): Promise<Demographics | null>;
  set(tractGeoid: string, demographics: Demographics, expiresAt: string): Promise<void>;
}

interface CensusCacheRow {
  tract_geoid: string;
  demographics: Demographics;
  expires_at: string;
}

export function createCensusCache(supabase: SupabaseClient): CensusCacheLike {
  return {
    async get(tractGeoid: string, now: Date): Promise<Demographics | null> {
      const { data, error } = await supabase
        .from('census_cache')
        .select('tract_geoid, demographics, expires_at')
        .eq('tract_geoid', tractGeoid)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as CensusCacheRow;
      if (Date.parse(row.expires_at) <= now.getTime()) return null;
      return row.demographics && typeof row.demographics === 'object' ? row.demographics : null;
    },

    async set(tractGeoid: string, demographics: Demographics, expiresAt: string): Promise<void> {
      const { error } = await supabase.from('census_cache').upsert({
        tract_geoid: tractGeoid,
        demographics,
        expires_at: expiresAt,
      });
      if (error) throw error;
    },
  };
}
