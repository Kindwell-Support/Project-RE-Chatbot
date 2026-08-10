/**
 * Slice gate for the comps suites.
 *
 * INSPECTOR writes specs from CONTRACT.md ahead of MASON's implementation
 * slices. Two bad options if we do nothing about that: land a few hundred
 * failing tests and make MASON's own `npm test` unreadable while he builds, or
 * hold the specs back until the code exists and lose the whole point of writing
 * them from the contract.
 *
 * So: a suite whose module hasn't landed yet SKIPS, and says why. Then the
 * escape hatch that stops that turning into false confidence —
 *
 *   COMPS_STRICT=1 npm test
 *
 * makes every missing module a FAILURE instead of a skip. Sign-off runs strict,
 * so nothing can reach GREEN by being quietly skipped. A renamed or deleted
 * module fails there too, which a plain `describe.skipIf` would silently
 * swallow forever.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src', 'features', 'comps');

export const COMPS_STRICT = process.env.COMPS_STRICT === '1';

/** Modules named in CONTRACT §2's file layout. */
export type CompsModule =
  | 'types' | 'config' | 'normalize' | 'filter' | 'rank' | 'arv'
  | 'format' | 'service' | 'tools'
  | 'providers/types' | 'providers/apifyZillow' | 'providers/geocode' | 'providers/stub'
  | 'cache/compsCache'
  // §14.14 detail enrichment — specs written pre-build, from the contract and
  // the recorded spike fixtures.
  | 'detail' | 'cache/detailCache'
  // §14.10 Census demographics — spec written pre-build from the operator's
  // four guarantees. Skips until the module lands; fails under COMPS_STRICT.
  | 'providers/census'
  // §14.16 neighbourhood aggregates — spec written pre-build. PATH ASSUMED;
  // confirm it resolves at handoff (a gate that never resolves skips forever
  // while reporting 'pending', which already happened once with census).
  | 'aggregates';

export function hasModule(...mods: CompsModule[]): boolean {
  return mods.every((m) => existsSync(resolve(SRC, `${m}.ts`)));
}

/**
 * `describe.skipIf(...)` argument. Returns true (skip) when a module is
 * missing, unless COMPS_STRICT is set — then it returns false so the suite
 * runs and fails loudly on the import.
 */
export function pendingSlice(...mods: CompsModule[]): boolean {
  if (COMPS_STRICT) return false;
  return !hasModule(...mods);
}

/** Human-readable reason, for the skipped-suite name. */
export function sliceNote(...mods: CompsModule[]): string {
  const missing = mods.filter((m) => !hasModule(m));
  return missing.length
    ? ` [pending MASON: ${missing.join(', ')} — set COMPS_STRICT=1 to fail instead of skip]`
    : '';
}
