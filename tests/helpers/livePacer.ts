/**
 * Rate pacer for the LIVE batteries.
 *
 * WHY THIS EXISTS. The first live run at HEAD produced nine reds, and six of
 * them were the org's tokens-per-minute ceiling, not the product:
 *
 *   429 Rate limit reached for gpt-4o ... tokens per min (TPM):
 *   Limit 30000, Used 27843, Requested 3122
 *
 * A gate that fails on throughput is a coin flip, not a gate — and the real
 * cost is diagnostic, not the red itself: with infrastructure and product
 * failing the same way, nobody can tell them apart at a glance, and the one
 * finding that mattered was sitting underneath five that did not.
 *
 * WHY IT GOT TIGHT NOW. Every comps turn renders three sections that did not
 * exist a week ago — detail fields, census demographics, neighbourhood
 * aggregates. Same number of turns, ~3.4k tokens each, against a ceiling the
 * battery used to clear comfortably.
 *
 * THE INTERVAL, derived rather than guessed:
 *   ceiling                30,000 tok/min
 *   largest observed turn   3,378 tok   (the failing requests were 3,122–3,378)
 *   at the ceiling          30,000 / 3,378 = 8.9 turns/min -> one every 6.8s
 *   at 75% of the ceiling   22,500 / 3,378 = 6.7 turns/min -> one every 9.0s
 *
 * 9s, i.e. a quarter of the ceiling left as headroom. The ceiling is shared
 * with anything else on the key, the window is rolling rather than aligned to
 * our first call, and turns get bigger every time a section is added — so
 * pacing exactly at the limit would put us back here on the next slice.
 *
 * WHY A FILE LOCK. Vitest runs test FILES in parallel workers by default, and
 * the two live files raced each other into the ceiling. A process-local mutex
 * cannot see across workers, so the timestamp lives on disk and every worker
 * serialises through the same lock. This also means the pacing holds however
 * the battery is invoked — one file, both files, a `-t` filter — rather than
 * depending on a runner flag someone has to remember.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'ask-james-live-pacer');
const STAMP = join(DIR, 'last-call-ms');
const LOCK = join(DIR, 'lock');

/** Minimum gap between live model calls, across every worker. See the header. */
export const LIVE_CALL_GAP_MS = Number(process.env.LIVE_CALL_GAP_MS ?? 9_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exclusive create as a mutex; stale locks are broken so one crash cannot wedge the suite. */
function withLock<T>(fn: () => T): T {
  mkdirSync(DIR, { recursive: true });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      try {
        return fn();
      } finally {
        closeSync(fd);
        rmSync(LOCK, { force: true });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (Date.now() > deadline) {
        // A worker died holding it. Break it rather than hang the battery —
        // the worst case is one un-paced call, not a stuck run.
        rmSync(LOCK, { force: true });
        continue;
      }
      // Spin briefly; the critical section is two file operations.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/**
 * Claim the next slot. Returns how long the caller must wait before issuing
 * its request; the reservation is recorded under the lock so two workers can
 * never claim the same slot.
 */
function reserveSlot(gapMs: number): number {
  return withLock(() => {
    const now = Date.now();
    let last = 0;
    try {
      last = Number(readFileSync(STAMP, 'utf8')) || 0;
    } catch {
      last = 0;
    }
    const earliest = Math.max(now, last + gapMs);
    const fd = openSync(STAMP, 'w');
    try {
      writeSync(fd, String(earliest));
    } finally {
      closeSync(fd);
    }
    return earliest - now;
  });
}

/**
 * Await this immediately before every live model call.
 *
 * Deliberately NOT a retry-on-429: a retry hides the problem and doubles the
 * spend on the turn that triggered it. Pacing keeps us under the ceiling, and
 * a 429 that still gets through is then real information — the ceiling moved,
 * or a turn got much bigger — rather than noise to be swallowed.
 */
export async function paceLiveCall(gapMs: number = LIVE_CALL_GAP_MS): Promise<void> {
  if (gapMs <= 0) return;
  const wait = reserveSlot(gapMs);
  if (wait > 0) await sleep(wait);
}

/** Forget the recorded slot — for a suite that wants to start from a clean window. */
export function resetLivePacer(): void {
  rmSync(STAMP, { force: true });
  rmSync(LOCK, { force: true });
}
