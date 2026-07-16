import { describe, it, expect } from 'vitest';
import { calculateBrrrr } from '../src/calculators/brrrr.js';

const DEFAULT_DEAL = {
  purchase_price: 215000,
  rehab_budget: 80000,
  after_repair_value: 399950,
  monthly_rent: 2750,
};

describe('BRRRR calculator — golden regression (sheet cached values)', () => {
  const r = calculateBrrrr(DEFAULT_DEAL);

  it('cash_left_in_deal (D70) = 13918.3', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(13918.3, 6);
  });
  it('monthly_cash_flow (D71) = -220', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(-220, 6);
  });
  it('cash_on_cash_return (D72) = -0.188816162893457', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(-0.188816162893457, 10);
  });
  it('return_on_equity (D73) = -0.0273215309102109', () => {
    expect(r.return_on_equity).toBeCloseTo(-0.0273215309102109, 10);
  });
  it('five_year_irr (D74) = 0.536613657506238', () => {
    expect(r.five_year_irr).toBeCloseTo(0.536613657506238, 9);
  });
  it('equity_captured (D75) = 96187.875', () => {
    expect(r.equity_captured).toBeCloseTo(96187.875, 6);
  });
  it('dscr_at_refinance (D76) = 0.896892655367232', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(0.896892655367232, 10);
  });
  it('max_allowable_offer (D77) = 219962.5', () => {
    expect(r.max_allowable_offer).toBeCloseTo(219962.5, 6);
  });
});

describe('BRRRR calculator — intermediate checkpoints', () => {
  const r = calculateBrrrr(DEFAULT_DEAL);

  it('refinance promissory note (D48) = 303762.125 — projection year-0 loan balance', () => {
    expect(r.projection[0].loan_balance).toBeCloseTo(303762.125, 6);
  });
  it('annual NOI (D65) = 22860 — projection year-1 NOI', () => {
    expect(r.projection[1].noi).toBeCloseTo(22860, 6);
  });
  it('monthly debt service (C66) = 2124 — projection annual debt service / 12', () => {
    expect(r.projection[1].debt_service / 12).toBeCloseTo(2124, 6);
  });
  it('projection C19 (year-0 net cash) = -13918.3', () => {
    expect(r.projection[0].net_cash_flow_to_investor).toBeCloseTo(-13918.3, 6);
  });
  it('projection H19 (year-5 net cash) = 147677.02943435', () => {
    expect(r.projection[5].net_cash_flow_to_investor).toBeCloseTo(147677.02943435, 5);
  });
  it('projection loan balances match sheet PV chain', () => {
    expect(r.projection[1].loan_balance).toBeCloseTo(300961.941154094, 5);
    expect(r.projection[5].loan_balance).toBeCloseTo(287411.935798558, 5);
  });
});

describe('B2 — 250k / 60k / 450k / 3000 rent (negative cash_left, n/a IRR)', () => {
  const r = calculateBrrrr({
    purchase_price: 250000,
    rehab_budget: 60000,
    after_repair_value: 450000,
    monthly_rent: 3000,
  });

  it('cash_left_in_deal is negative', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(-7889.600000000006, 1);
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
  it('monthly_cash_flow = -267', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(-267, 0);
  });
  it('cash_on_cash_return is misleadingly positive (negative ÷ negative)', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.4053437436625428, 9);
  });
  it('return_on_equity', () => {
    expect(r.return_on_equity).toBeCloseTo(-0.029522270943918762, 9);
  });
  it('five_year_irr = "n/a" (no sign change)', () => {
    expect(r.five_year_irr).toBe('n/a');
  });
  it('equity_captured = 108325', () => {
    expect(r.equity_captured).toBeCloseTo(108325, 0);
  });
  it('dscr_at_refinance', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(0.8884470489744664, 9);
  });
  it('max_allowable_offer = 277500', () => {
    expect(r.max_allowable_offer).toBeCloseTo(277500, 0);
  });
});

describe('B3 — DSCR method (defaults otherwise)', () => {
  const r = calculateBrrrr({ ...DEFAULT_DEAL, refinance_method: 'DSCR' });

  it('cash_left_in_deal', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(89880.32141745495, 1);
  });
  it('monthly_cash_flow = 316', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(316, 0);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.042322946113333045, 9);
  });
  it('return_on_equity', () => {
    expect(r.return_on_equity).toBeCloseTo(0.021999945833543283, 9);
  });
  it('five_year_irr', () => {
    expect(r.five_year_irr).toBeCloseTo(0.2339658526167574, 6);
  });
  it('equity_captured', () => {
    expect(r.equity_captured).toBeCloseTo(172909.5166316295, 1);
  });
  it('dscr_at_refinance lands at the 1.2 floor', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(1.1996221662468514, 6);
  });
  it('max_allowable_offer = 219962.5', () => {
    expect(r.max_allowable_offer).toBeCloseTo(219962.5, 6);
  });
});

describe('B4 — strong rent (monthly_rent = 4000)', () => {
  const r = calculateBrrrr({ ...DEFAULT_DEAL, monthly_rent: 4000 });

  it('cash_left_in_deal = 13918.3', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(13918.3, 6);
  });
  it('monthly_cash_flow = 868 (positive)', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(868, 0);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.748798344625421, 9);
  });
  it('return_on_equity', () => {
    expect(r.return_on_equity).toBeCloseTo(0.10835045477405546, 9);
  });
  it('five_year_irr', () => {
    expect(r.five_year_irr).toBeCloseTo(1.0699769849694516, 6);
  });
  it('equity_captured = 96187.875', () => {
    expect(r.equity_captured).toBeCloseTo(96187.875, 6);
  });
  it('DSCR above 1.2', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(1.4088983050847457, 9);
    expect(r.dscr_at_refinance as number).toBeGreaterThan(1.2);
  });
  it('max_allowable_offer = 219962.5', () => {
    expect(r.max_allowable_offer).toBeCloseTo(219962.5, 6);
  });
});

describe('B5 — 180k / 70k / 420k / 2900 rent (another n/a IRR)', () => {
  const r = calculateBrrrr({
    purchase_price: 180000,
    rehab_budget: 70000,
    after_repair_value: 420000,
    monthly_rent: 2900,
  });

  it('cash_left_in_deal is negative', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(-48308, 0);
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
  it('monthly_cash_flow = -195', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(-195, 0);
  });
  it('cash_on_cash_return (positive despite negative cash flow)', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.048314978885484805, 9);
  });
  it('return_on_equity', () => {
    expect(r.return_on_equity).toBeCloseTo(-0.02309747649678377, 9);
  });
  it('five_year_irr = "n/a"', () => {
    expect(r.five_year_irr).toBe('n/a');
  });
  it('equity_captured = 101050', () => {
    expect(r.equity_captured).toBeCloseTo(101050, 0);
  });
  it('dscr_at_refinance', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(0.912780269058296, 9);
  });
  it('max_allowable_offer = 245000', () => {
    expect(r.max_allowable_offer).toBeCloseTo(245000, 0);
  });
});

describe('B6 — DSCR method + monthly_rent = 4000', () => {
  const r = calculateBrrrr({
    ...DEFAULT_DEAL,
    refinance_method: 'DSCR',
    monthly_rent: 4000,
  });

  it('cash_left_in_deal is negative', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(-38446.13873851953, 1);
    expect(r.cash_left_in_deal).toBeLessThan(0);
  });
  it('monthly_cash_flow = 498', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(498, 0);
  });
  it('cash_on_cash_return (negative due to negative denominator)', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(-0.1555942988367407, 9);
  });
  it('return_on_equity', () => {
    expect(r.return_on_equity).toBeCloseTo(0.13815308898929876, 9);
  });
  it('five_year_irr = "n/a"', () => {
    expect(r.five_year_irr).toBe('n/a');
  });
  it('equity_captured', () => {
    expect(r.equity_captured).toBeCloseTo(43299.791874095274, 1);
  });
  it('dscr_at_refinance near 1.2', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(1.199879711307137, 6);
  });
});

describe('B7 — zero vacancy and property management', () => {
  const r = calculateBrrrr({
    ...DEFAULT_DEAL,
    vacancy_pct: 0,
    property_mgmt_pct: 0,
  });

  it('cash_left_in_deal = 13918.3', () => {
    expect(r.cash_left_in_deal).toBeCloseTo(13918.3, 6);
  });
  it('monthly_cash_flow = 138', () => {
    expect(r.monthly_cash_flow).toBeCloseTo(138, 0);
  });
  it('cash_on_cash_return', () => {
    expect(r.cash_on_cash_return).toBeCloseTo(0.11941113498056513, 9);
  });
  it('five_year_irr', () => {
    expect(r.five_year_irr).toBeCloseTo(0.6862976331250289, 6);
  });
  it('dscr_at_refinance', () => {
    expect(r.dscr_at_refinance).toBeCloseTo(1.0652071563088512, 9);
  });
});

describe('BRRRR calculator — n/a guards', () => {
  it('returns "n/a" five_year_irr when all projection flows share a sign', () => {
    const r = calculateBrrrr({
      purchase_price: 250000,
      rehab_budget: 60000,
      after_repair_value: 450000,
      monthly_rent: 3000,
    });
    expect(r.five_year_irr).toBe('n/a');
  });
  it('min_dscr 0 does not throw', () => {
    const r = calculateBrrrr({ ...DEFAULT_DEAL, min_dscr: 0 });
    expect(r.cash_left_in_deal).toBeCloseTo(13918.3, 6);
  });
});
