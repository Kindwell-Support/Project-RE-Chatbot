/**
 * Excel-compatible financial functions.
 *
 * Sign conventions follow Excel exactly:
 *   PV(rate, nper, pmt)  — present value of a stream of payments (pmt paid each
 *                          period, end-of-period). Positive pmt => negative PV.
 *   PMT(rate, nper, pv)  — payment that amortizes pv over nper periods.
 *                          Positive pv => negative PMT.
 */

/** Excel PV(rate, nper, pmt, [fv=0], [type=0]) */
export function pv(rate: number, nper: number, pmt: number, fv = 0): number {
  if (rate === 0) return -(pmt * nper + fv);
  const pow = Math.pow(1 + rate, nper);
  return -(pmt * (pow - 1) / rate + fv) / pow;
}

/** Excel PMT(rate, nper, pv, [fv=0], [type=0]) */
export function pmt(rate: number, nper: number, presentValue: number, fv = 0): number {
  if (rate === 0) return -(presentValue + fv) / nper;
  const pow = Math.pow(1 + rate, nper);
  return -(presentValue * pow + fv) * rate / (pow - 1);
}

/** Excel ROUND — rounds half away from zero (unlike Math.round for negatives). */
export function excelRound(value: number, digits = 0): number {
  const factor = Math.pow(10, digits);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
}

function npv(rate: number, cashFlows: number[]): number {
  // Excel IRR treats cashFlows[0] as period 0 (undiscounted... actually
  // IRR's NPV convention: sum cf[i] / (1+r)^i with i starting at 0).
  let acc = 0;
  for (let i = 0; i < cashFlows.length; i++) {
    acc += cashFlows[i] / Math.pow(1 + rate, i);
  }
  return acc;
}

function npvDerivative(rate: number, cashFlows: number[]): number {
  let acc = 0;
  for (let i = 1; i < cashFlows.length; i++) {
    acc += -i * cashFlows[i] / Math.pow(1 + rate, i + 1);
  }
  return acc;
}

/**
 * Excel IRR(values, [guess=0.1]).
 * Newton-Raphson first; falls back to bisection over a bracketed interval.
 * Returns null when no IRR can be found (Excel would show #NUM!).
 */
export function irr(cashFlows: number[], guess = 0.1): number | null {
  const hasPositive = cashFlows.some((c) => c > 0);
  const hasNegative = cashFlows.some((c) => c < 0);
  if (!hasPositive || !hasNegative) return null;

  const TOL = 1e-12;

  // Newton-Raphson
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    const value = npv(rate, cashFlows);
    if (Math.abs(value) < TOL) return rate;
    const deriv = npvDerivative(rate, cashFlows);
    if (deriv === 0 || !Number.isFinite(deriv)) break;
    const next = rate - value / deriv;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - rate) < TOL) return next;
    rate = next;
  }

  // Bisection fallback: scan for a sign change on (-0.9999, 10]
  let lo = -0.9999;
  let hi = -0.9999;
  let prevValue = npv(lo, cashFlows);
  let bracketed = false;
  for (let step = 1; step <= 10000; step++) {
    const candidate = -0.9999 + step * 0.001; // up to ~9.0
    const value = npv(candidate, cashFlows);
    if (Number.isFinite(value) && Number.isFinite(prevValue) && prevValue * value <= 0) {
      lo = candidate - 0.001;
      hi = candidate;
      bracketed = true;
      break;
    }
    prevValue = value;
  }
  if (!bracketed) return null;

  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const value = npv(mid, cashFlows);
    if (Math.abs(value) < TOL || (hi - lo) / 2 < TOL) return mid;
    if (npv(lo, cashFlows) * value < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
