/**
 * BRRRR Calculator — pure transcription of BRRR_Calculator.xlsx.
 * Two interdependent tabs: Sheet1 computes up through debt service, the
 * 5-Year Projection consumes those values, and its IRR feeds back into
 * Sheet1's deal summary (D74). Resolution order below mirrors that.
 */
import { pv, pmt, irr, excelRound } from './finance.js';

export type RefinanceMethod = 'LTV' | 'DSCR';

export interface BrrrrInputs {
  /** C12 */ purchase_price: number;
  /** C13 */ rehab_budget: number;
  /** C14 */ after_repair_value: number;
  /** C55 */ monthly_rent: number;
  /** C15 */ holding_months?: number;
  /** C39 */ monthly_utilities_construction?: number;
  /** D28 */ construction_loan_fees?: number;
  /** D35 */ acquisition_closing_costs?: number;
  /** D47 */ refinance_loan_fees?: number;
  /** E12 */ construction_down_pct?: number;
  /** E13 */ construction_points_pct?: number;
  /** E14 */ construction_interest_rate?: number;
  /** G12 */ refinance_ltarv?: number;
  /** G13 */ refinance_points_pct?: number;
  /** G14 */ refinance_interest_rate?: number;
  /** G15 */ refinance_method?: RefinanceMethod;
  /** G16 */ min_dscr?: number;
  /** J12 */ annual_taxes?: number;
  /** J13 */ annual_insurance?: number;
  /** J14 */ annual_repairs?: number;
  /** J15 */ annual_utilities?: number;
  /** J16 */ property_mgmt_pct?: number;
  /** J17 */ vacancy_pct?: number;
  // 5-Year Projection assumptions
  /** '5-Year Projection'!C3 */ annual_appreciation?: number;
  /** '5-Year Projection'!C4 */ annual_rent_growth?: number;
  /** '5-Year Projection'!C5 */ annual_expense_growth?: number;
  /** '5-Year Projection'!C6 */ selling_costs_pct?: number;
}

export const BRRRR_DEFAULTS = {
  holding_months: 4,
  monthly_utilities_construction: 200,
  construction_loan_fees: 800,
  acquisition_closing_costs: 1500,
  refinance_loan_fees: 800,
  construction_down_pct: 0.2,
  construction_points_pct: 0.02,
  construction_interest_rate: 0.12,
  refinance_ltarv: 0.75,
  refinance_points_pct: 0.01,
  refinance_interest_rate: 0.075,
  refinance_method: 'LTV' as RefinanceMethod,
  min_dscr: 1.2,
  annual_taxes: 3000,
  annual_insurance: 1200,
  annual_repairs: 1650,
  annual_utilities: 0,
  property_mgmt_pct: 0.08,
  vacancy_pct: 0.05,
  annual_appreciation: 0.03,
  annual_rent_growth: 0.02,
  annual_expense_growth: 0.02,
  selling_costs_pct: 0.06,
};

export interface BrrrrProjectionYear {
  year: number;
  property_value: number;
  gross_rent: number;
  effective_gross_income: number;
  operating_expenses: number;
  noi: number;
  debt_service: number;
  cash_flow: number;
  loan_balance: number;
  equity: number;
  net_sale_proceeds: number;
  net_cash_flow_to_investor: number;
}

export interface BrrrrOutputs {
  /** D70 */ cash_left_in_deal: number;
  /** D71 */ monthly_cash_flow: number;
  /** D72 — "n/a" when denominator is zero (IFERROR) */ cash_on_cash_return: number | 'n/a';
  /** D73 */ return_on_equity: number | 'n/a';
  /** D74 */ five_year_irr: number | 'n/a';
  /** D75 */ equity_captured: number;
  /** D76 */ dscr_at_refinance: number | 'n/a';
  /** D77 */ max_allowable_offer: number;
  projection: BrrrrProjectionYear[];
}

export function calculateBrrrr(inputs: BrrrrInputs): BrrrrOutputs {
  const i = { ...BRRRR_DEFAULTS, ...inputs };

  // --- Construction financing ---
  const D19 = i.purchase_price;
  const D20 = i.rehab_budget;
  const D21 = D19 + D20;
  const D22 = D21 * i.construction_down_pct;             // construction down payment
  const D26 = D21 - D22;                                 // loan basis
  const D27 = D26 * i.construction_points_pct;           // points
  const D28 = i.construction_loan_fees;
  const D29 = D26 + D27 + D28;                           // construction promissory note

  // --- Pre-refinance direct costs ---
  const D34 = D20;
  const D35 = i.acquisition_closing_costs;
  const D36 = (D29 * i.construction_interest_rate) / 12 * i.holding_months;
  const C37 = i.annual_taxes / 12;
  const D37 = C37 * i.holding_months;
  const C38 = i.annual_insurance / 12;
  const D38 = C38 * i.holding_months;
  const D39 = i.monthly_utilities_construction * i.holding_months;
  const D40 = D19 + D20 + D27 + D28 + D35 + D36 + D37 + D38 + D39; // total direct costs
  const D41 = D22 + D35 + (D36 + D37 + D38 + D39);                 // total cash invested

  // --- Rent / operating (needed before the refinance sizing) ---
  const C55 = i.monthly_rent;
  const D55 = C55 * 12;
  const D56 = excelRound(D55 * i.vacancy_pct, 0);
  const C56 = excelRound(D56 / 12, 0);
  const D57 = D55 - D56;
  const C57 = C55 - C56;
  const D59 = i.annual_taxes;
  const D60 = i.annual_insurance;
  const D61 = i.annual_utilities;
  const C62 = excelRound(C55 * i.property_mgmt_pct, 0);
  const D62 = C62 * 12;
  const D63 = i.annual_repairs;
  const C59 = excelRound(D59 / 12, 0);
  const C60 = excelRound(D60 / 12, 0);
  const C61 = excelRound(D61 / 12, 0);
  const C63 = excelRound(D63 / 12, 0);
  const D64 = D59 + D60 + D61 + D62 + D63;               // annual operating expenses
  const C64 = C59 + C60 + C61 + C62 + C63;
  const D65 = D57 - D64;                                 // annual NOI
  const C65 = C57 - C64;                                 // monthly NOI

  // --- Refinance ---
  const monthlyRefiRate = i.refinance_interest_rate / 12;
  // D44 = IFERROR(-PV(G14/12, 360, (D65/G16)/12), 0)
  let D44 = 0;
  if (i.min_dscr !== 0) {
    const candidate = -pv(monthlyRefiRate, 360, (D65 / i.min_dscr) / 12);
    D44 = Number.isFinite(candidate) ? candidate : 0;
  }
  const D47 = i.refinance_loan_fees;
  const D45 = i.refinance_method === 'DSCR'
    ? (D44 - D47) / (1 + i.refinance_points_pct)
    : i.after_repair_value * i.refinance_ltarv;          // refi loan basis
  const D46 = i.refinance_points_pct * D45;
  const D48 = D45 + D46 + D47;                           // refinance promissory note
  const D49 = -D29;
  const D50 = D48 + D49 - D46 - D47;                     // cash (in)/out from refi
  const D51 = D41 - D50;                                 // total cash remaining in project

  const C66 = -excelRound(pmt(monthlyRefiRate, 360, D48), 0); // monthly debt service
  const D66 = C66 * 12;
  const C67 = C65 - C66;                                 // monthly cash flow
  const D67 = D65 - D66;                                 // annual cash flow

  // --- 5-Year Projection tab ---
  const projection: BrrrrProjectionYear[] = [];
  const exactPmt = pmt(monthlyRefiRate, 360, D48);       // row 16 uses the unrounded PMT
  const netCashFlows: number[] = [];
  for (let n = 0; n <= 5; n++) {
    const propertyValue = i.after_repair_value * Math.pow(1 + i.annual_appreciation, n);
    const grossRent = n === 0 ? 0 : D55 * Math.pow(1 + i.annual_rent_growth, n - 1);
    const egi = n === 0 ? 0 : grossRent * (1 - i.vacancy_pct);
    const opex = n === 0 ? 0 : D64 * Math.pow(1 + i.annual_expense_growth, n - 1);
    const noi = egi - opex;
    const debtService = n === 0 ? 0 : D66;
    const cashFlow = noi - debtService;
    const loanBalance = n === 0 ? D48 : pv(monthlyRefiRate, 360 - 12 * n, exactPmt);
    const equity = propertyValue - loanBalance;
    const netSale = n === 5 ? propertyValue * (1 - i.selling_costs_pct) - loanBalance : 0;
    const netCash = n === 0 ? -D51 : n === 5 ? cashFlow + netSale : cashFlow;
    netCashFlows.push(netCash);
    projection.push({
      year: n,
      property_value: propertyValue,
      gross_rent: grossRent,
      effective_gross_income: egi,
      operating_expenses: opex,
      noi,
      debt_service: debtService,
      cash_flow: cashFlow,
      loan_balance: loanBalance,
      equity,
      net_sale_proceeds: netSale,
      net_cash_flow_to_investor: netCash,
    });
  }
  const fiveYearIrrRaw = irr(netCashFlows);

  // --- Deal summary (IFERROR → "n/a") ---
  const D72: number | 'n/a' = D51 === 0 ? 'n/a' : D67 / D51;
  const equityDenom = i.after_repair_value - D48;
  const D73: number | 'n/a' = equityDenom === 0 ? 'n/a' : D67 / equityDenom;
  const fiveYearIrr: number | 'n/a' = fiveYearIrrRaw ?? 'n/a';
  const D75 = i.after_repair_value - D48;
  const D76: number | 'n/a' = D66 === 0 ? 'n/a' : D65 / D66;
  const D77 = i.after_repair_value * 0.75 - i.rehab_budget;

  return {
    cash_left_in_deal: D51,
    monthly_cash_flow: C67,
    cash_on_cash_return: D72,
    return_on_equity: D73,
    five_year_irr: fiveYearIrr,
    equity_captured: D75,
    dscr_at_refinance: D76,
    max_allowable_offer: D77,
    projection,
  };
}
