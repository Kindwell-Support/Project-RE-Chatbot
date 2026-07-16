import { describe, it, expect } from 'vitest';
import { calculateFlip } from '../src/calculators/flip.js';

const DEFAULT_DEAL = {
  purchase_price: 700000,
  rehab_budget: 150000,
  after_repair_value: 1150000,
  holding_months: 6,
};

describe('Flip calculator — golden regression (sheet cached values)', () => {
  const r = calculateFlip(DEFAULT_DEAL);

  it('total_direct_costs (D49) = 910864', () => {
    expect(Math.abs(r.total_direct_costs - 910864)).toBeLessThanOrEqual(1);
  });
  it('total_selling_costs (D56) = 90670', () => {
    expect(Math.abs(r.total_selling_costs - 90670)).toBeLessThanOrEqual(1);
  });
  it('est_net_profit (D62) = 148466', () => {
    expect(Math.abs(r.est_net_profit - 148466)).toBeLessThanOrEqual(1);
  });
  it('down_payment (D64) = 170000', () => {
    expect(Math.abs(r.down_payment - 170000)).toBeLessThanOrEqual(1);
  });
  it('monthly_carrying_cost (D65) = 7494', () => {
    expect(Math.abs(r.monthly_carrying_cost - 7494)).toBeLessThanOrEqual(1);
  });
  it('total_carrying_costs (D66) = 44964', () => {
    expect(Math.abs(r.total_carrying_costs - 44964)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket (D68) = 214964', () => {
    expect(Math.abs(r.cash_out_of_pocket - 214964)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return (D73) = 0.690655179471912', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.690655179471912, 10);
  });
  it('annualized_return (D74) = 1.38131035894382', () => {
    expect(r.annualized_return).toBeCloseTo(1.38131035894382, 10);
  });
});

describe('F2 — 350k / 75k / 600k / 4mo', () => {
  const r = calculateFlip({
    purchase_price: 350000,
    rehab_budget: 75000,
    after_repair_value: 600000,
    holding_months: 4,
  });

  it('est_net_profit = 101916', () => {
    expect(Math.abs(r.est_net_profit - 101916)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 101104', () => {
    expect(Math.abs(r.cash_out_of_pocket - 101104)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.0080313340718468, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(3.0240940022155405, 9);
  });
  it('total_direct_costs = 450204', () => {
    expect(Math.abs(r.total_direct_costs - 450204)).toBeLessThanOrEqual(1);
  });
  it('total_selling_costs = 47880', () => {
    expect(Math.abs(r.total_selling_costs - 47880)).toBeLessThanOrEqual(1);
  });
  it('down_payment = 85000', () => {
    expect(Math.abs(r.down_payment - 85000)).toBeLessThanOrEqual(1);
  });
  it('monthly_carrying_cost = 4026', () => {
    expect(Math.abs(r.monthly_carrying_cost - 4026)).toBeLessThanOrEqual(1);
  });
  it('total_carrying_costs = 16104', () => {
    expect(Math.abs(r.total_carrying_costs - 16104)).toBeLessThanOrEqual(1);
  });
});

describe('F3 — 300k / 50k / 550k / 3mo', () => {
  const r = calculateFlip({
    purchase_price: 300000,
    rehab_budget: 50000,
    after_repair_value: 550000,
    holding_months: 3,
  });

  it('est_net_profit = 137868', () => {
    expect(Math.abs(r.est_net_profit - 137868)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 80242', () => {
    expect(Math.abs(r.cash_out_of_pocket - 80242)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.7181525884200295, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(6.872610353680119, 9);
  });
  it('total_direct_costs = 368142', () => {
    expect(Math.abs(r.total_direct_costs - 368142)).toBeLessThanOrEqual(1);
  });
  it('total_selling_costs = 43990', () => {
    expect(Math.abs(r.total_selling_costs - 43990)).toBeLessThanOrEqual(1);
  });
  it('down_payment = 70000', () => {
    expect(Math.abs(r.down_payment - 70000)).toBeLessThanOrEqual(1);
  });
  it('monthly_carrying_cost = 3414', () => {
    expect(Math.abs(r.monthly_carrying_cost - 3414)).toBeLessThanOrEqual(1);
  });
  it('total_carrying_costs = 10242', () => {
    expect(Math.abs(r.total_carrying_costs - 10242)).toBeLessThanOrEqual(1);
  });
});

describe('F4 — interest_reserve = Yes (defaults otherwise)', () => {
  const r = calculateFlip({ ...DEFAULT_DEAL, interest_reserve: 'Yes' });

  it('est_net_profit identical to defaults (148466)', () => {
    expect(Math.abs(r.est_net_profit - 148466)).toBeLessThanOrEqual(1);
  });
  it('monthly_carrying_cost = 550 (interest dropped out)', () => {
    expect(Math.abs(r.monthly_carrying_cost - 550)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 173300', () => {
    expect(Math.abs(r.cash_out_of_pocket - 173300)).toBeLessThanOrEqual(1);
  });
  it('total_carrying_costs = 3300', () => {
    expect(Math.abs(r.total_carrying_costs - 3300)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.8566993652625505, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(1.7133987305251008, 9);
  });
  it('total_direct_costs = 910864', () => {
    expect(Math.abs(r.total_direct_costs - 910864)).toBeLessThanOrEqual(1);
  });
});

describe('F5 — include_second_loan = Yes (defaults otherwise)', () => {
  const r = calculateFlip({ ...DEFAULT_DEAL, include_second_loan: 'Yes' });

  it('est_net_profit = 132330', () => {
    expect(Math.abs(r.est_net_profit - 132330)).toBeLessThanOrEqual(1);
  });
  it('down_payment = 0 (2nd loan funds it)', () => {
    expect(r.down_payment).toBe(0);
  });
  it('cash_out_of_pocket = 55500', () => {
    expect(Math.abs(r.cash_out_of_pocket - 55500)).toBeLessThanOrEqual(1);
  });
  it('total_direct_costs = 927000', () => {
    expect(Math.abs(r.total_direct_costs - 927000)).toBeLessThanOrEqual(1);
  });
  it('monthly_carrying_cost = 9250', () => {
    expect(Math.abs(r.monthly_carrying_cost - 9250)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(2.384324324324324, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(4.768648648648648, 9);
  });
});

describe('F6 — both interest_reserve and second_loan = Yes', () => {
  const r = calculateFlip({
    ...DEFAULT_DEAL,
    interest_reserve: 'Yes',
    include_second_loan: 'Yes',
  });

  it('est_net_profit = 132330', () => {
    expect(Math.abs(r.est_net_profit - 132330)).toBeLessThanOrEqual(1);
  });
  it('down_payment = 0', () => {
    expect(r.down_payment).toBe(0);
  });
  it('monthly_carrying_cost = 550', () => {
    expect(Math.abs(r.monthly_carrying_cost - 550)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 3300', () => {
    expect(Math.abs(r.cash_out_of_pocket - 3300)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(40.1, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(80.2, 9);
  });
});

describe('F7 — losing deal: 500k / 200k / 600k / 6mo', () => {
  const r = calculateFlip({
    purchase_price: 500000,
    rehab_budget: 200000,
    after_repair_value: 600000,
    holding_months: 6,
  });

  it('est_net_profit is negative (-199000)', () => {
    expect(Math.abs(r.est_net_profit - (-199000))).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 177620', () => {
    expect(Math.abs(r.cash_out_of_pocket - 177620)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return is negative', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(-1.1203693277784033, 9);
  });
  it('annualized_return is negative', () => {
    expect(r.annualized_return).toBeCloseTo(-2.2407386555568065, 9);
  });
  it('total_direct_costs = 751120', () => {
    expect(Math.abs(r.total_direct_costs - 751120)).toBeLessThanOrEqual(1);
  });
});

describe('F8 — long hold: 400k / 100k / 650k / 12mo', () => {
  const r = calculateFlip({
    purchase_price: 400000,
    rehab_budget: 100000,
    after_repair_value: 650000,
    holding_months: 12,
  });

  it('est_net_profit = 32274', () => {
    expect(Math.abs(r.est_net_profit - 32274)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 155656', () => {
    expect(Math.abs(r.cash_out_of_pocket - 155656)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.20734183070360282, 9);
  });
  it('at 12 months, annualized_return === cash_on_cash_return', () => {
    expect(r.annualized_return).toBeCloseTo(r.cash_on_cash_return, 12);
  });
  it('total_carrying_costs = 55656', () => {
    expect(Math.abs(r.total_carrying_costs - 55656)).toBeLessThanOrEqual(1);
  });
});

describe('F9 — down_payment_pct = 1.0 (all cash)', () => {
  const r = calculateFlip({
    ...DEFAULT_DEAL,
    down_payment_pct: 1.0,
  });

  it('est_net_profit = 203682', () => {
    expect(Math.abs(r.est_net_profit - 203682)).toBeLessThanOrEqual(1);
  });
  it('down_payment = 850000', () => {
    expect(Math.abs(r.down_payment - 850000)).toBeLessThanOrEqual(1);
  });
  it('cash_out_of_pocket = 853348', () => {
    expect(Math.abs(r.cash_out_of_pocket - 853348)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.23868574133882073, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(0.47737148267764146, 9);
  });
});

describe('Flip calculator — IFERROR guards', () => {
  it('zero cash out of pocket yields 0 returns instead of dividing by zero', () => {
    const r = calculateFlip({
      purchase_price: 0,
      rehab_budget: 0,
      after_repair_value: 0,
      holding_months: 6,
      monthly_utilities: 0,
      annual_taxes: 0,
      annual_insurance: 0,
      loan_fees: 0,
      acquisition_closing_costs: 0,
      other_closing_costs: 0,
    });
    expect(r.cash_out_of_pocket).toBe(0);
    expect(r.cash_on_cash_return).toBe(0);
    expect(r.annualized_return).toBe(0);
  });
});
