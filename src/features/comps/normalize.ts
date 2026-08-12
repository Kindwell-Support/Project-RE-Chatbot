/**
 * Address normalization + cache key (CONTRACT §5.1).
 *
 * The point is cache identity: "123 N Main St." and "123 North Main Street"
 * must produce the same cache key, because every miss costs a real Apify run
 * on the client's paid quota. Pure and deterministic — same string in, same
 * key out, forever.
 */
import { createHash } from 'node:crypto';

/**
 * Suffix/directional abbreviations, expanded as WHOLE TOKENS only. The map
 * goes short -> long so normalization is idempotent: "STREET" is not a key,
 * so normalizing an already-normalized string changes nothing.
 *
 * This exact table is documented in CONTRACT §5.1 — extend it there first.
 */
export const SUFFIX_EXPANSIONS: Readonly<Record<string, string>> = {
  ST: 'STREET',
  AVE: 'AVENUE',
  RD: 'ROAD',
  DR: 'DRIVE',
  BLVD: 'BOULEVARD',
  LN: 'LANE',
  CT: 'COURT',
  PL: 'PLACE',
  N: 'NORTH',
  S: 'SOUTH',
  E: 'EAST',
  W: 'WEST',
};

/**
 * Uppercase -> strip everything but [A-Z0-9 ] -> collapse whitespace ->
 * expand abbreviations token-by-token.
 *
 * Token-by-token matters: "W" in "123 W OAK" is a directional, but the "W" in
 * "WOAK" is not a token and must not be touched. Punctuation is stripped
 * BEFORE tokenizing so "St." and "St" are the same token.
 */
export function normalizeAddress(raw: string): string {
  const cleaned = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((token) => SUFFIX_EXPANSIONS[token] ?? token)
    .join(' ');
}

/** sha256 hex (lowercase) of the normalized address. Log this, never the address. */
export function cacheKey(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Does the RAW member input name a unit — "#429", "Unit 12", "Apt 4B",
 * "Suite 210"? Branches the wrong-property copy (CONTRACT §10): telling a
 * member to "double-check the unit number" when they never typed one blames
 * them for Zillow's resolution. Deliberately conservative — explicit
 * designators only; a bare trailing number is not treated as a unit.
 */
const UNIT_DESIGNATOR_RE = /#\s*[0-9a-z]|\b(?:unit|apt|apartment|suite|ste)\s*#?\s*[0-9a-z]/i;

export function hasUnitDesignator(raw: string): boolean {
  return UNIT_DESIGNATOR_RE.test(String(raw ?? ''));
}

/**
 * The street part with everything from the first unit designator on removed —
 * "100 Oak St Unit 3" → "100 Oak St ". §14.22's condition-3 street comparison
 * needs the BUILDING's street base: a resolved address that carries its unit
 * would otherwise never prefix-match its sibling cards, making the ask
 * unsatisfiable in exactly the branch where the resolution names a unit.
 * Shares the one designator regex with hasUnitDesignator so the two can
 * never drift.
 */
export function stripUnitDesignator(raw: string): string {
  const s = String(raw ?? '');
  const m = s.match(UNIT_DESIGNATOR_RE);
  return m ? s.slice(0, m.index) : s;
}
