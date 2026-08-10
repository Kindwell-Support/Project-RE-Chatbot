/**
 * Supabase-backed detail cache, keyed by ZPID (CONTRACT §14.14 rule 4) —
 * SEPARATE from comps_cache, with its own much longer TTL: property facts
 * (year built, parking, days on market of a completed sale) barely change,
 * and nearby lookups share comps and therefore share these rows. This is the
 * detail slice's main cost lever.
 *
 * Failure posture matches compsCache: a broken cache degrades (to a live
 * detail run, or to em-dash detail fields) and never blocks a member. Expiry
 * is enforced ON READ so correctness never depends on a cleanup job.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompDetail } from '../types.js';

export interface DetailCacheLike {
  /** Unexpired details for the given zpids; absent keys are misses. */
  getMany(zpids: string[], now: Date): Promise<Record<string, CompDetail>>;
  setMany(entries: Array<{ zpid: string; detail: CompDetail }>, expiresAt: string): Promise<void>;
}

interface DetailCacheRow {
  zpid: string;
  detail: CompDetail;
  expires_at: string;
}

export function createDetailCache(supabase: SupabaseClient): DetailCacheLike {
  return {
    async getMany(zpids: string[], now: Date): Promise<Record<string, CompDetail>> {
      if (zpids.length === 0) return {};
      const { data, error } = await supabase
        .from('comps_detail_cache')
        .select('zpid, detail, expires_at')
        .in('zpid', zpids);
      if (error) throw error; // service catches, warns, degrades
      const found: Record<string, CompDetail> = {};
      for (const row of (data ?? []) as DetailCacheRow[]) {
        if (Date.parse(row.expires_at) > now.getTime() && row.detail && typeof row.detail === 'object') {
          found[row.zpid] = row.detail;
        }
      }
      return found;
    },

    async setMany(entries: Array<{ zpid: string; detail: CompDetail }>, expiresAt: string): Promise<void> {
      if (entries.length === 0) return;
      const { error } = await supabase.from('comps_detail_cache').upsert(
        entries.map((e) => ({ zpid: e.zpid, detail: e.detail, expires_at: expiresAt })),
      );
      if (error) throw error;
    },
  };
}
