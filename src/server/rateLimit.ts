/**
 * Fixed-window rate limiting, in-memory (Phase 3 unconditional items).
 *
 * PER-INSTANCE by construction: the counters live in process memory, so with
 * N instances behind the load balancer the effective cap is N x the
 * configured one. Acceptable at this deployment's scale (instance_count 1-2)
 * and stated rather than discovered; a shared store is the upgrade path if
 * the fleet grows.
 *
 * SIZING (INSPECTOR's /auth oracle measurement): /auth exposes 4
 * distinguishable states per request and our stack sustained ~3,509
 * requests/sec against a fake — a 10k-address sweep in ~3 seconds, with each
 * probe costing a REAL upstream GHL call. Two consequences, both encoded
 * where the limiters are wired:
 *   - per-EMAIL bounds nothing on /auth (every probe is a different address);
 *     only per-IP constrains a sweep. Per-IP is load-bearing on /auth,
 *     per-email on /chat.
 *   - the /auth limit protects the CLIENT'S GHL QUOTA as much as member
 *     privacy: unthrottled, the enumeration bill lands upstream.
 * 3,509/sec is our measured ceiling against a fake faster than real GHL — a
 * throughput ceiling, not a prediction of an attacker's real rate.
 */

export interface RateLimiter {
  /** True = allowed (and counted). False = over the limit for this window. */
  allow(key: string, now?: number): boolean;
}

export function createFixedWindowLimiter(max: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  let lastSweep = 0;
  return {
    allow(key: string, now = Date.now()): boolean {
      // Opportunistic eviction so an address sweep cannot also become a
      // memory leak: stale windows are dropped at most once per window.
      if (now - lastSweep >= windowMs) {
        lastSweep = now;
        for (const [k, w] of windows) {
          if (now - w.start >= windowMs) windows.delete(k);
        }
      }
      const win = windows.get(key);
      if (!win || now - win.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      if (win.count >= max) return false;
      win.count += 1;
      return true;
    },
  };
}
