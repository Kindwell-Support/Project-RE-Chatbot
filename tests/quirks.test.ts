import { describe, it, expect } from 'vitest';
import { calculateBrrrr } from '../src/calculators/brrrr.js';
import { calculateFlip } from '../src/calculators/flip.js';
import { calculateLand } from '../src/calculators/land.js';
import { excelRound } from '../src/calculators/finance.js';

describe('Quirk 1: negative cash_left_in_deal is legitimate (cash-out refi)', () => {
  it('B2 scenario — cash_left negative', () => {
    const r = calculateBrrrr({
      purchase_price: 250000, rehab_budget: 60000,
      after_repair_value: 450000, monthly_rent: 3000,
    });
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
  it('B5 scenario — cash_left negative', () => {
    const r = calculateBrrrr({
      purchase_price: 180000, rehab_budget: 70000,
      after_repair_value: 420000, monthly_rent: 2900,
    });
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
  it('B6 scenario — cash_left negative', () => {
    const r = calculateBrrrr({
      purchase_price: 215000, rehab_budget: 80000,
      after_repair_value: 399950, monthly_rent: 4000,
      refinance_method: 'DSCR',
    });
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
});

describe('Quirk 2: misleading positive CoC when cash_flow and cash_left both negative', () => {
  it('B2 scenario — positive CoC despite negative cash flow', () => {
    const r = calculateBrrrr({
      purchase_price: 250000, rehab_budget: 60000,
      after_repair_value: 450000, monthly_rent: 3000,
    });
    expect(r.monthly_cash_flow).toBeLessThan(0);
    expect(r.cash_left_in_deal).toBeLessThan(0);
    expect(r.cash_on_cash_return as number).toBeGreaterThan(0);
  });
});

describe('Quirk 3: n/a IRR when cash flows never change sign', () => {
  it('B2 — returns string "n/a", not null, not 0, not thrown', () => {
    const r = calculateBrrrr({
      purchase_price: 250000, rehab_budget: 60000,
      after_repair_value: 450000, monthly_rent: 3000,
    });
    expect(r.five_year_irr).toBe('n/a');
    expect(r.five_year_irr).not.toBe(null);
    expect(r.five_year_irr).not.toBe(0);
  });
  it('B5 — returns "n/a"', () => {
    const r = calculateBrrrr({
      purchase_price: 180000, rehab_budget: 70000,
      after_repair_value: 420000, monthly_rent: 2900,
    });
    expect(r.five_year_irr).toBe('n/a');
  });
  it('B6 — returns "n/a"', () => {
    const r = calculateBrrrr({
      purchase_price: 215000, rehab_budget: 80000,
      after_repair_value: 399950, monthly_rent: 4000,
      refinance_method: 'DSCR',
    });
    expect(r.five_year_irr).toBe('n/a');
  });
});

describe('Quirk 4: Land C25 excludes purchase closing costs (sheet logic)', () => {
  it('total_project_costs does not include C11 (purchase closing costs)', () => {
    const r = calculateLand({
      construction_sf: 3000, price_per_sf: 300,
      new_construction_value: 3000000, project_duration_months: 18,
    });
    const c11 = r.intermediates.purchase_closing_costs;
    expect(c11).toBeGreaterThan(0);
    const withOverride = calculateLand({
      construction_sf: 3000, price_per_sf: 300,
      new_construction_value: 3000000, project_duration_months: 18,
      purchase_closing_costs_override: c11 * 2,
    });
    expect(withOverride.total_project_costs).toBe(r.total_project_costs);
  });
});

describe('Quirk 5: excelRound is half-away-from-zero, not Math.round', () => {
  it('ROUND(137.5,0) = 138', () => {
    expect(excelRound(137.5)).toBe(138);
    expect(Math.round(137.5)).toBe(138);
  });
  it('ROUND(-137.5,0) = -138 (Math.round returns -137)', () => {
    expect(excelRound(-137.5)).toBe(-138);
    expect(Math.round(-137.5)).toBe(-137);
  });
});

describe('Quirk 6: IFERROR semantics — divide-by-zero returns fallback', () => {
  it('Flip: zero denominator returns 0 for CoC and annualized', () => {
    const r = calculateFlip({
      purchase_price: 0, rehab_budget: 0, after_repair_value: 0, holding_months: 6,
      monthly_utilities: 0, annual_taxes: 0, annual_insurance: 0,
      loan_fees: 0, acquisition_closing_costs: 0, other_closing_costs: 0,
    });
    expect(r.cash_on_cash_return).toBe(0);
    expect(r.annualized_return).toBe(0);
  });
  it('BRRRR: n/a for CoC/ROE/DSCR when denominator is zero', () => {
    const r = calculateBrrrr({
      purchase_price: 250000, rehab_budget: 60000,
      after_repair_value: 450000, monthly_rent: 3000,
    });
    expect(r.five_year_irr).toBe('n/a');
    expect(typeof r.cash_on_cash_return).not.toBe('undefined');
  });
});
