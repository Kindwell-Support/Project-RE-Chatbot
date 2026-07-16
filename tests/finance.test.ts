import { describe, it, expect } from 'vitest';
import { pv, pmt, irr, excelRound } from '../src/calculators/finance.js';

describe('pv / pmt (Excel sign conventions)', () => {
  it('PMT amortizes a positive pv into a negative payment', () => {
    // Excel: PMT(0.075/12, 360, 303762.125) = -2123.936...
    const p = pmt(0.075 / 12, 360, 303762.125);
    expect(p).toBeLessThan(0);
    expect(-p).toBeCloseTo(2123.94, 1);
  });

  it('PV of the exact PMT recovers the balance after n payments', () => {
    const rate = 0.075 / 12;
    const principal = 303762.125;
    const payment = pmt(rate, 360, principal);
    // Sheet golden: 5-Year Projection D16 = 300961.941154094
    expect(pv(rate, 360 - 12, payment)).toBeCloseTo(300961.941154094, 6);
    expect(pv(rate, 360 - 60, payment)).toBeCloseTo(287411.935798558, 6);
  });

  it('handles zero rate', () => {
    expect(pmt(0, 12, 1200)).toBeCloseTo(-100, 10);
    expect(pv(0, 12, -100)).toBeCloseTo(1200, 10);
  });

  it('-PV of a positive payment stream is positive (DSCR sizing)', () => {
    // Sheet golden: Sheet1 D44 = 227040.483368371 at defaults
    const maxLoan = -pv(0.075 / 12, 360, (22860 / 1.2) / 12);
    expect(maxLoan).toBeCloseTo(227040.483368371, 6);
  });
});

describe('excelRound', () => {
  it('rounds half away from zero like Excel, not like Math.round', () => {
    expect(excelRound(2.5)).toBe(3);
    expect(excelRound(-2.5)).toBe(-3); // Math.round(-2.5) === -2
    expect(excelRound(1234.567, 2)).toBe(1234.57);
    expect(excelRound(1234.567, -2)).toBe(1200);
  });
  it('negative half rounds away from zero (Excel ROUND(-137.5,0) = -138)', () => {
    expect(excelRound(-137.5)).toBe(-138);
    expect(excelRound(137.5)).toBe(138);
  });
});

describe('irr', () => {
  it('matches the BRRRR sheet golden IRR', () => {
    const flows = [-13918.3, -2628, -2170.8, -1704.456, -1228.78512, 147677.02943435];
    expect(irr(flows)).toBeCloseTo(0.536613657506238, 9);
  });

  it('solves a textbook case', () => {
    // 3 years of 500 on -1000: IRR ≈ 23.375%
    const r = irr([-1000, 500, 500, 500])!;
    // NPV at solution ~ 0
    const npv = -1000 + 500 / (1 + r) + 500 / (1 + r) ** 2 + 500 / (1 + r) ** 3;
    expect(npv).toBeCloseTo(0, 8);
  });

  it('returns null when all flows share a sign', () => {
    expect(irr([-100, -50, -25])).toBeNull();
    expect(irr([100, 50, 25])).toBeNull();
  });

  it('falls back to bisection when Newton diverges (large negative IRR)', () => {
    const flows = [-1000, 10, 10, 10, 200];
    const r = irr(flows);
    expect(r).not.toBeNull();
    const npv = flows.reduce((acc, cf, i) => acc + cf / (1 + r!) ** i, 0);
    expect(npv).toBeCloseTo(0, 6);
  });
});
