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
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * CAPABILITY gate for the pool-depth slice (§14.17 truncation fix).
 *
 * The modules all exist, so `hasModule` cannot express "the fix has not landed
 * yet". The observable difference is the fetch SIGNATURE: a windowed
 * `fetchSoldComps` takes the window as a third parameter.
 *
 * PROBED BY READING THE SOURCE TEXT, and the first version of this is why.
 * It called `require()` on a `.ts` path — which does not exist under ESM, so
 * it threw, the catch returned "pending", and the gate could NEVER resolve.
 * Nine cases would have sat green-by-skipping forever while the note read
 * "pending MASON". That is precisely the census-gate failure I had added a
 * checklist item to prevent, committed one commit after adding it.
 *
 * A text probe is crude, but it is objective, needs no runtime import of the
 * thing under test, and flips exactly once. The handoff step still applies:
 * confirm this resolves rather than assuming it did.
 */
export function poolDepthPending(): boolean {
  if (COMPS_STRICT) return false;
  try {
    const src = readFileSync(resolve(SRC, 'providers', 'apifyZillow.ts'), 'utf8');
    return !/fetchSoldComps\([^)]*radiusMi:\s*number,\s*windowMonths/.test(src);
  } catch {
    return true;
  }
}

/** Human-readable reason, for the skipped-suite name. */
export function sliceNote(...mods: CompsModule[]): string {
  const missing = mods.filter((m) => !hasModule(m));
  return missing.length
    ? ` [pending MASON: ${missing.join(', ')} — set COMPS_STRICT=1 to fail instead of skip]`
    : '';
}
