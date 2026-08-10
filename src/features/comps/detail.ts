/**
 * Detail-enrichment join (CONTRACT §14.14) — pure, offline-testable.
 *
 * THE JOIN KEY IS `addressOrUrlFromInput`. NEVER POSITION (§14.14 rule 1,
 * a RULE not a note): the batch returns items out of input order (recorded —
 * inputs 1,2,3,4,5 came back 1,4,5,2,3). A positional join would assemble
 * five comps wearing each other's parking counts and year built, and nothing
 * about that looks broken from the outside. Any change to this module that
 * matches batch output to comps by index is a bug regardless of passing
 * tests.
 *
 * Join precedence per comp:
 *   1. the zpid-keyed cache (a prior lookup already paid for this comp)
 *   2. a batch item whose key equals the comp's address EXACTLY (the actor
 *      echoes the input verbatim — recorded on valid AND invalid items)
 *   3. the same match after §5.1 normalization on both sides — tolerates an
 *      actor that ever re-formats its echo, without ever crossing properties
 *      (five distinct comps have five distinct normalized addresses)
 * No match, or an `ok:false` item ⇒ the comp stays detail-less and renders
 * em-dashes (§14.14 rule 3: partial failure is non-fatal).
 */
import { MAX_COMPS_KEPT } from './config.js';
import { normalizeAddress } from './normalize.js';
import { mapDetailBatchItems } from './providers/apifyZillow.js';
import type { DetailBatchItem } from './providers/types.js';
import type { CompDetail, ScoredComp } from './types.js';

export interface DetailJoin {
  /** The input comps, enriched where a detail was found; same order, same length. */
  comps: ScoredComp[];
  /**
   * Newly fetched, successfully joined details — the cache-write set. Keyed
   * by the COMP's zpid (the key future lookups will probe), not the batch
   * item's, which can differ (BUG-010 taught us one sale wears two zpids).
   */
  fetched: Array<{ zpid: string; detail: CompDetail }>;
  /** Count of comps left without detail. Addresses deliberately NOT included — they must not reach info logs. */
  missing: number;
}

/** Key-index a mapped batch: exact echo first, §5.1-normalized fallback. */
function indexItems(items: DetailBatchItem[]): {
  lookup: (inputAddress: string) => DetailBatchItem | undefined;
} {
  const byExact = new Map<string, DetailBatchItem>();
  const byNormalized = new Map<string, DetailBatchItem>();
  for (const item of items) {
    if (!byExact.has(item.addressOrUrlFromInput)) byExact.set(item.addressOrUrlFromInput, item);
    const normalized = normalizeAddress(item.addressOrUrlFromInput);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, item);
  }
  return {
    lookup: (inputAddress) =>
      byExact.get(inputAddress) ?? byNormalized.get(normalizeAddress(inputAddress)),
  };
}

/**
 * The §14.14 rule 2 bound as a STRUCTURAL backstop: the batch a lookup may
 * send is never larger than MAX_COMPS_KEPT — tracking the constant, never a
 * literal. The service passes ranked-and-capped comps, so this slice is
 * normally a no-op; it exists so that a future caller enriching the wrong
 * collection (the fetched pool: ~40 addresses, a ~700% quota multiplier with
 * no visible symptom) is clamped rather than billed.
 */
export function detailBatchFor(addresses: string[]): string[] {
  return addresses.slice(0, MAX_COMPS_KEPT);
}

/**
 * Join RAW batch items to the input addresses they were requested for.
 * Address-keyed (never positional — §14.14 rule 1); items for addresses
 * nobody asked for are ignored; invalid items join nothing. Raw items pass
 * through the real mapper, so fixtures drive the exact production path.
 */
export function joinDetailBatch(
  inputAddresses: string[],
  rawItems: Array<Record<string, unknown>>,
): Map<string, CompDetail> {
  const { lookup } = indexItems(mapDetailBatchItems(rawItems));
  const joined = new Map<string, CompDetail>();
  for (const address of inputAddresses) {
    const item = lookup(address);
    if (item?.ok && item.detail) joined.set(address, item.detail);
  }
  return joined;
}

export function attachDetails(
  comps: ScoredComp[],
  cached: Record<string, CompDetail>,
  items: DetailBatchItem[],
): DetailJoin {
  const { lookup } = indexItems(items);

  const fetched: DetailJoin['fetched'] = [];
  let missing = 0;
  const enriched = comps.map((scored) => {
    const cachedDetail = cached[scored.comp.zpid];
    if (cachedDetail) return { ...scored, detail: cachedDetail };

    const item = lookup(scored.comp.address);
    if (item?.ok && item.detail) {
      if (scored.comp.zpid) fetched.push({ zpid: scored.comp.zpid, detail: item.detail });
      return { ...scored, detail: item.detail };
    }
    missing += 1;
    return scored;
  });

  return { comps: enriched, fetched, missing };
}
