import { describe, it, expect } from 'vitest';
import { calculateLand } from '../src/calculators/land.js';

const DEFAULT_DEAL = {
  construction_sf: 3000,
  price_per_sf: 300,
  new_construction_value: 3000000,
  project_duration_months: 18,
};

describe('Land calculator — golden regression (sheet cached values)', () => {
  const r = calculateLand(DEFAULT_DEAL);

  it('target_land_contract (C17) = 772844', () => {
    expect(Math.abs(r.target_land_contract - 772844)).toBeLessThanOrEqual(1);
  });
  it('land_acquisition_cost (C20) = 872844', () => {
    expect(Math.abs(r.land_acquisition_cost - 872844)).toBeLessThanOrEqual(1);
  });
  it('total_construction_budget (C21) = 900000', () => {
    expect(r.total_construction_budget).toBe(900000);
  });
  it('total_project_costs (C25) = 1945500', () => {
    expect(Math.abs(r.total_project_costs - 1945500)).toBeLessThanOrEqual(1);
  });
  it('construction_loan_amount (C27) = 1556400', () => {
    expect(Math.abs(r.construction_loan_amount - 1556400)).toBeLessThanOrEqual(1);
  });
  it('total_cash_investment (C32) = 393600', () => {
    expect(Math.abs(r.total_cash_investment - 393600)).toBeLessThanOrEqual(1);
  });
  it('net_profit (E44) = 750000', () => {
    expect(Math.abs(r.net_profit - 750000)).toBeLessThanOrEqual(1);
  });
  it('sales_proceeds (C50) = 1143600', () => {
    expect(Math.abs(r.sales_proceeds - 1143600)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return (C56) = 1.90548780487805', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.90548780487805, 10);
  });
  it('annualized_return (C57) = 1.27032520325203', () => {
    expect(r.annualized_return).toBeCloseTo(1.27032520325203, 10);
  });

  it('intermediates: C26=-389100, C23=15564, C24=149364, C11=7728, C12=4500', () => {
    expect(r.intermediates.less_construction_loan_downpayment).toBe(-389100);
    expect(r.intermediates.loan_origination_fee).toBe(15564);
    expect(r.intermediates.interest_reserve).toBe(149364);
    expect(r.intermediates.purchase_closing_costs).toBe(7728);
    expect(r.intermediates.estimated_utilities_insurance).toBe(4500);
  });
});

describe('L2 — 4000sf / 350psf / 3.5M / 24mo (the n8n bug regression)', () => {
  const r = calculateLand({
    construction_sf: 4000,
    price_per_sf: 350,
    new_construction_value: 3500000,
    project_duration_months: 24,
  });

  it('target_land_contract = 544665 (NOT the buggy 595665)', () => {
    expect(Math.abs(r.target_land_contract - 544665)).toBeLessThanOrEqual(1);
    expect(r.target_land_contract).not.toBe(595665);
  });
  it('net_profit = 875000 (NOT the buggy 873229)', () => {
    expect(Math.abs(r.net_profit - 875000)).toBeLessThanOrEqual(1);
    expect(r.net_profit).not.toBe(873229);
  });
  it('land_acquisition_cost = 644665', () => {
    expect(Math.abs(r.land_acquisition_cost - 644665)).toBeLessThanOrEqual(1);
  });
  it('total_project_costs = 2269000', () => {
    expect(Math.abs(r.total_project_costs - 2269000)).toBeLessThanOrEqual(1);
  });
  it('construction_loan_amount = 1815200', () => {
    expect(Math.abs(r.construction_loan_amount - 1815200)).toBeLessThanOrEqual(1);
  });
  it('total_cash_investment = 459800', () => {
    expect(Math.abs(r.total_cash_investment - 459800)).toBeLessThanOrEqual(1);
  });
  it('sales_proceeds = 1334800', () => {
    expect(Math.abs(r.sales_proceeds - 1334800)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.9030013049151806, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(0.9515006524575903, 9);
  });
  it('derived formula cells recomputed for 24mo', () => {
    expect(r.intermediates.estimated_utilities_insurance).toBe(6000);
    expect(r.intermediates.interest_reserve_months).toBe(24);
    expect(r.intermediates.purchase_closing_costs).toBe(
      Math.round(r.target_land_contract * 0.01),
    );
  });
});

describe('L3 — 2500sf / 275psf / 2.2M / 12mo', () => {
  const r = calculateLand({
    construction_sf: 2500,
    price_per_sf: 275,
    new_construction_value: 2200000,
    project_duration_months: 12,
  });

  it('target_land_contract = 550769', () => {
    expect(Math.abs(r.target_land_contract - 550769)).toBeLessThanOrEqual(1);
  });
  it('land_acquisition_cost = 650769', () => {
    expect(Math.abs(r.land_acquisition_cost - 650769)).toBeLessThanOrEqual(1);
  });
  it('total_project_costs = 1427000', () => {
    expect(Math.abs(r.total_project_costs - 1427000)).toBeLessThanOrEqual(1);
  });
  it('construction_loan_amount = 1141600', () => {
    expect(Math.abs(r.construction_loan_amount - 1141600)).toBeLessThanOrEqual(1);
  });
  it('total_cash_investment = 288400', () => {
    expect(Math.abs(r.total_cash_investment - 288400)).toBeLessThanOrEqual(1);
  });
  it('net_profit = 550000', () => {
    expect(Math.abs(r.net_profit - 550000)).toBeLessThanOrEqual(1);
  });
  it('sales_proceeds = 838400', () => {
    expect(Math.abs(r.sales_proceeds - 838400)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.9070735090152566, 9);
  });
  it('at 12 months, annualized_return === cash_on_cash_return', () => {
    expect(r.annualized_return).toBeCloseTo(r.cash_on_cash_return, 12);
  });
});

describe('L4 — 5000sf / 400psf / 5M / 30mo', () => {
  const r = calculateLand({
    construction_sf: 5000,
    price_per_sf: 400,
    new_construction_value: 5000000,
    project_duration_months: 30,
  });

  it('target_land_contract = 750406', () => {
    expect(Math.abs(r.target_land_contract - 750406)).toBeLessThanOrEqual(1);
  });
  it('land_acquisition_cost = 850406', () => {
    expect(Math.abs(r.land_acquisition_cost - 850406)).toBeLessThanOrEqual(1);
  });
  it('total_project_costs = 3242500', () => {
    expect(Math.abs(r.total_project_costs - 3242500)).toBeLessThanOrEqual(1);
  });
  it('construction_loan_amount = 2594000', () => {
    expect(Math.abs(r.construction_loan_amount - 2594000)).toBeLessThanOrEqual(1);
  });
  it('total_cash_investment = 656000', () => {
    expect(Math.abs(r.total_cash_investment - 656000)).toBeLessThanOrEqual(1);
  });
  it('net_profit = 1250000', () => {
    expect(Math.abs(r.net_profit - 1250000)).toBeLessThanOrEqual(1);
  });
  it('sales_proceeds = 1906000', () => {
    expect(Math.abs(r.sales_proceeds - 1906000)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(1.9054878048780488, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(0.7621951219512195, 9);
  });
});

describe('L5 — target_assignment_fee = 0 (defaults otherwise)', () => {
  const r = calculateLand({ ...DEFAULT_DEAL, target_assignment_fee: 0 });

  it('target_land_contract = land_acquisition_cost (no assignment fee)', () => {
    expect(Math.abs(r.target_land_contract - 871853)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.land_acquisition_cost - 871853)).toBeLessThanOrEqual(1);
    expect(r.target_land_contract).toBeCloseTo(r.land_acquisition_cost, 0);
  });
  it('net_profit = 750000', () => {
    expect(Math.abs(r.net_profit - 750000)).toBeLessThanOrEqual(1);
  });
  it('total_project_costs = 1945500', () => {
    expect(Math.abs(r.total_project_costs - 1945500)).toBeLessThanOrEqual(1);
  });
});

describe('L6 — target_investor_return = 0.30 (defaults otherwise)', () => {
  const r = calculateLand({ ...DEFAULT_DEAL, target_investor_return: 0.30 });

  it('target_land_contract = 641556', () => {
    expect(Math.abs(r.target_land_contract - 641556)).toBeLessThanOrEqual(1);
  });
  it('land_acquisition_cost = 741556', () => {
    expect(Math.abs(r.land_acquisition_cost - 741556)).toBeLessThanOrEqual(1);
  });
  it('total_project_costs = 1795500', () => {
    expect(Math.abs(r.total_project_costs - 1795500)).toBeLessThanOrEqual(1);
  });
  it('construction_loan_amount = 1436400', () => {
    expect(Math.abs(r.construction_loan_amount - 1436400)).toBeLessThanOrEqual(1);
  });
  it('total_cash_investment = 363600', () => {
    expect(Math.abs(r.total_cash_investment - 363600)).toBeLessThanOrEqual(1);
  });
  it('net_profit = 900000', () => {
    expect(Math.abs(r.net_profit - 900000)).toBeLessThanOrEqual(1);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(2.4752475247524752, 9);
  });
  it('annualized_return', () => {
    expect(r.annualized_return).toBeCloseTo(1.6501650165016502, 9);
  });
});

describe('Land calculator — explicit overrides still honored', () => {
  it('caller-supplied utilities/insurance replaces the 250*months formula', () => {
    const r = calculateLand({ ...DEFAULT_DEAL, utilities_insurance_override: 9000 });
    expect(r.intermediates.estimated_utilities_insurance).toBe(9000);
    expect(r.total_project_costs).toBeCloseTo(1945500 - (9000 - 4500), 6);
  });
});
