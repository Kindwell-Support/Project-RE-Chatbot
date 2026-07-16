import { describe, it, expect } from 'vitest';
import { calculateFlip } from '../src/calculators/flip.js';
import { calculateBrrrr } from '../src/calculators/brrrr.js';
import { calculateLand } from '../src/calculators/land.js';

function randBetween(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function randInt(lo: number, hi: number): number {
  return Math.floor(randBetween(lo, hi + 1));
}

const TRIALS = 50;

describe('Invariant 1: Flip profit = ARV - direct_costs - selling_costs', () => {
  for (let t = 0; t < TRIALS; t++) {
    const pp = randInt(100000, 1000000);
    const rb = randInt(10000, 300000);
    const arv = randInt(pp + rb, pp + rb + 500000);
    const hm = randInt(1, 18);
    it(`trial ${t}: ${pp}/${rb}/${arv}/${hm}mo`, () => {
      const r = calculateFlip({
        purchase_price: pp,
        rehab_budget: rb,
        after_repair_value: arv,
        holding_months: hm,
      });
      expect(r.est_net_profit).toBeCloseTo(arv - r.total_direct_costs - r.total_selling_costs, 6);
    });
  }
});

describe('Invariant 2: interest_reserve=Yes never changes est_net_profit', () => {
  for (let t = 0; t < TRIALS; t++) {
    const pp = randInt(100000, 1000000);
    const rb = randInt(10000, 300000);
    const arv = randInt(200000, 2000000);
    const hm = randInt(1, 18);
    it(`trial ${t}`, () => {
      const no = calculateFlip({ purchase_price: pp, rehab_budget: rb, after_repair_value: arv, holding_months: hm });
      const yes = calculateFlip({ purchase_price: pp, rehab_budget: rb, after_repair_value: arv, holding_months: hm, interest_reserve: 'Yes' });
      expect(yes.est_net_profit).toBeCloseTo(no.est_net_profit, 6);
      expect(yes.monthly_carrying_cost).toBeLessThanOrEqual(no.monthly_carrying_cost);
    });
  }
});

describe('Invariant 3: include_second_loan=Yes always yields down_payment === 0', () => {
  for (let t = 0; t < TRIALS; t++) {
    const pp = randInt(100000, 1000000);
    const rb = randInt(10000, 300000);
    const arv = randInt(200000, 2000000);
    const hm = randInt(1, 18);
    it(`trial ${t}`, () => {
      const r = calculateFlip({
        purchase_price: pp, rehab_budget: rb, after_repair_value: arv, holding_months: hm,
        include_second_loan: 'Yes',
      });
      expect(r.down_payment).toBe(0);
    });
  }
});

describe('Invariant 4: at 12 months, annualized === CoC', () => {
  it('Flip at 12 months', () => {
    for (let t = 0; t < 20; t++) {
      const r = calculateFlip({
        purchase_price: randInt(100000, 1000000),
        rehab_budget: randInt(10000, 300000),
        after_repair_value: randInt(200000, 2000000),
        holding_months: 12,
      });
      expect(r.annualized_return).toBeCloseTo(r.cash_on_cash_return, 10);
    }
  });
  it('Land at 12 months', () => {
    for (let t = 0; t < 20; t++) {
      const r = calculateLand({
        construction_sf: randInt(1000, 6000),
        price_per_sf: randInt(200, 500),
        new_construction_value: randInt(1000000, 6000000),
        project_duration_months: 12,
      });
      expect(r.annualized_return).toBeCloseTo(r.cash_on_cash_return, 10);
    }
  });
});

describe('Invariant 5: BRRRR LTV equity_captured = ARV - refinance_promissory_note', () => {
  for (let t = 0; t < TRIALS; t++) {
    const pp = randInt(100000, 500000);
    const rb = randInt(20000, 200000);
    const arv = randInt(pp + rb, pp + rb + 300000);
    const rent = randInt(1500, 5000);
    it(`trial ${t}`, () => {
      const r = calculateBrrrr({
        purchase_price: pp, rehab_budget: rb, after_repair_value: arv, monthly_rent: rent,
      });
      const refiNote = r.projection[0].loan_balance;
      expect(r.equity_captured).toBeCloseTo(arv - refiNote, 6);
    });
  }
});

describe('Invariant 6: BRRRR DSCR method lands dscr_at_refinance near min_dscr', () => {
  for (let t = 0; t < 20; t++) {
    const pp = randInt(100000, 500000);
    const rb = randInt(20000, 200000);
    const arv = randInt(pp + rb, pp + rb + 300000);
    const rent = randInt(2000, 6000);
    it(`trial ${t}`, () => {
      const r = calculateBrrrr({
        purchase_price: pp, rehab_budget: rb, after_repair_value: arv, monthly_rent: rent,
        refinance_method: 'DSCR',
      });
      if (typeof r.dscr_at_refinance === 'number') {
        expect(r.dscr_at_refinance).toBeCloseTo(1.2, 1);
      }
    });
  }
});

describe('Invariant 7: BRRRR max_allowable_offer = ARV*0.75 - rehab_budget', () => {
  for (let t = 0; t < TRIALS; t++) {
    const pp = randInt(100000, 500000);
    const rb = randInt(20000, 200000);
    const arv = randInt(200000, 800000);
    const rent = randInt(1500, 5000);
    it(`trial ${t}`, () => {
      const r = calculateBrrrr({
        purchase_price: pp, rehab_budget: rb, after_repair_value: arv, monthly_rent: rent,
      });
      expect(r.max_allowable_offer).toBeCloseTo(arv * 0.75 - rb, 6);
    });
  }
});

describe('Invariant 8: Land target_land_contract = land_acquisition_cost - assignment_fee', () => {
  for (let t = 0; t < TRIALS; t++) {
    const sf = randInt(1000, 6000);
    const psf = randInt(200, 500);
    const ncv = randInt(1000000, 6000000);
    const months = randInt(6, 36);
    const fee = randInt(0, 200000);
    it(`trial ${t}`, () => {
      const r = calculateLand({
        construction_sf: sf, price_per_sf: psf, new_construction_value: ncv,
        project_duration_months: months, target_assignment_fee: fee,
      });
      expect(r.target_land_contract).toBeCloseTo(r.land_acquisition_cost - fee, 0);
    });
  }
});

describe('Invariant 9: Land net_profit / ncv = target_investor_return', () => {
  it('at default 0.25 return', () => {
    const r = calculateLand({
      construction_sf: 3000, price_per_sf: 300, new_construction_value: 3000000,
      project_duration_months: 18,
    });
    expect(r.net_profit / 3000000).toBeCloseTo(0.25, 6);
  });
  for (let t = 0; t < 10; t++) {
    const ret = 0.1 + Math.random() * 0.4;
    const ncv = randInt(1000000, 6000000);
    it(`ncv=${ncv}, ret=${ret.toFixed(3)}`, () => {
      const r = calculateLand({
        construction_sf: 3000, price_per_sf: 300, new_construction_value: ncv,
        project_duration_months: 18, target_investor_return: ret,
      });
      expect(r.net_profit / ncv).toBeCloseTo(ret, 4);
    });
  }
});

describe('Invariant 10: no NaN, Infinity, or thrown errors for plausible inputs', () => {
  function assertNoSpecialValues(obj: Record<string, unknown>, path = '') {
    for (const [k, v] of Object.entries(obj)) {
      const key = path ? `${path}.${k}` : k;
      if (typeof v === 'number') {
        expect(Number.isNaN(v), `${key} is NaN`).toBe(false);
        expect(Number.isFinite(v), `${key} is Infinity`).toBe(true);
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        assertNoSpecialValues(v as Record<string, unknown>, key);
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'object' && item !== null) {
            assertNoSpecialValues(item as Record<string, unknown>, `${key}[${i}]`);
          }
        });
      }
    }
  }

  for (let t = 0; t < 20; t++) {
    it(`Flip trial ${t}`, () => {
      const r = calculateFlip({
        purchase_price: randInt(0, 2000000),
        rehab_budget: randInt(0, 500000),
        after_repair_value: randInt(0, 3000000),
        holding_months: randInt(1, 24),
      });
      assertNoSpecialValues(r as unknown as Record<string, unknown>);
    });
    it(`BRRRR trial ${t}`, () => {
      const r = calculateBrrrr({
        purchase_price: randInt(50000, 1000000),
        rehab_budget: randInt(10000, 300000),
        after_repair_value: randInt(100000, 1500000),
        monthly_rent: randInt(500, 8000),
      });
      const { projection, ...rest } = r;
      assertNoSpecialValues(rest as unknown as Record<string, unknown>);
      for (const yr of projection) {
        assertNoSpecialValues(yr as unknown as Record<string, unknown>);
      }
    });
    it(`Land trial ${t}`, () => {
      const r = calculateLand({
        construction_sf: randInt(500, 8000),
        price_per_sf: randInt(100, 600),
        new_construction_value: randInt(500000, 8000000),
        project_duration_months: randInt(3, 36),
      });
      assertNoSpecialValues(r as unknown as Record<string, unknown>);
    });
  }
});
