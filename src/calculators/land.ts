/**
 * Land / New Construction Calculator — pure transcription of Land_Purchase.xlsx
 * ("Land Purchase Calc" tab).
 *
 * ⚠️ C9 (interest reserve months), C11 (purchase closing costs), and C12
 * (estimated utilities/insurance) are FORMULAS in the sheet, not inputs.
 * They are computed here and may only be overridden when the caller passes an
 * explicit value — the old n8n build hardcoded them and produced wrong numbers.
 */
import { excelRound } from './finance.js';

export interface LandInputs {
  /** C4 */ construction_sf: number;
  /** C5 */ price_per_sf: number;
  /** C13 */ new_construction_value: number;
  /** C8 */ project_duration_months: number;
  /** C6 */ construction_down_pct?: number;
  /** C7 */ construction_interest_rate?: number;
  /** C10 */ origination_fee_pct?: number;
  /** C15 */ target_assignment_fee?: number;
  /** C16 */ target_investor_return?: number;
  /** C36 */ selling_costs_pct?: number;
  // Explicit overrides for formula cells (normally computed — leave unset)
  /** C9 = C8 */ interest_reserve_months_override?: number;
  /** C11 = ROUND(C17*0.01, 0) */ purchase_closing_costs_override?: number;
  /** C12 = 250*C8 */ utilities_insurance_override?: number;
}

export const LAND_DEFAULTS = {
  construction_down_pct: 0.2,
  construction_interest_rate: 0.09,
  origination_fee_pct: 0.01,
  target_assignment_fee: 100000,
  target_investor_return: 0.25,
  selling_costs_pct: 0.1,
};

export interface LandOutputs {
  /** C17 */ target_land_contract: number;
  /** C20 */ land_acquisition_cost: number;
  /** C21 */ total_construction_budget: number;
  /** C25 */ total_project_costs: number;
  /** C27 */ construction_loan_amount: number;
  /** C32 */ total_cash_investment: number;
  /** E44 */ net_profit: number;
  /** C50 */ sales_proceeds: number;
  /** C56 */ cash_on_cash_return: number;
  /** C57 */ annualized_return: number;
  /** Computed formula cells — exposed for testing and disclosure. */
  intermediates: {
    /** C9 */ interest_reserve_months: number;
    /** C11 */ purchase_closing_costs: number;
    /** C12 */ estimated_utilities_insurance: number;
    /** C23 */ loan_origination_fee: number;
    /** C24 */ interest_reserve: number;
    /** C26 */ less_construction_loan_downpayment: number;
  };
}

export function calculateLand(inputs: LandInputs): LandOutputs {
  const i = { ...LAND_DEFAULTS, ...inputs };

  // Resolution order matters — the sheet's dependency graph is not top-to-bottom.
  const E35 = i.new_construction_value;                    // E35 = C13
  const E20 = i.new_construction_value * i.target_investor_return;
  const E21 = i.new_construction_value - E20;
  const D36 = i.selling_costs_pct * -E35;                  // selling costs (negative)
  const C12 = i.utilities_insurance_override ?? 250 * i.project_duration_months;
  const C25 = E21 + D36 - C12;                             // total project costs
  const C26 = excelRound(-C25 * i.construction_down_pct, 0);
  const C27 = C25 + C26;                                   // construction loan amount
  const C21 = i.construction_sf * i.price_per_sf;          // total construction budget
  const C23 = excelRound(C27 * i.origination_fee_pct, 0);  // loan origination fee
  const C9 = i.interest_reserve_months_override ?? i.project_duration_months;
  const C24 = excelRound(((C27 - C21) + C21 / 2) * (i.construction_interest_rate / 12) * C9, 0);
  const C20 = excelRound((C25 - C21 - C23 - C24 + i.target_assignment_fee * 0.01) / 1.01, 0);
  const C17 = C20 - i.target_assignment_fee;               // TARGET LAND CONTRACT AMOUNT
  const C11 = i.purchase_closing_costs_override ?? excelRound(C17 * 0.01, 0);

  const D37 = -C20;
  const D38 = -C21;
  const D39 = -C12;
  const D40 = -C23;
  const D41 = -C11;
  const D42 = -C24;
  const E43 = D36 + D37 + D38 + D39 + D40 + D41 + D42;     // total costs
  const E44 = E35 + E43;                                   // NET PROFIT

  const C30 = -C26;
  const C31 = C12;
  const C32 = C30 + C31;                                   // total cash investment

  const C47 = E35;
  const C48 = D36;
  const C49 = -C27;
  const C50 = C47 + C48 + C49;                             // sales proceeds

  const C56 = C32 === 0 ? 0 : E44 / C32;                   // cash on cash
  const C57 = i.project_duration_months === 0 ? 0 : C56 * (12 / i.project_duration_months);

  return {
    target_land_contract: C17,
    land_acquisition_cost: C20,
    total_construction_budget: C21,
    total_project_costs: C25,
    construction_loan_amount: C27,
    total_cash_investment: C32,
    net_profit: E44,
    sales_proceeds: C50,
    cash_on_cash_return: C56,
    annualized_return: C57,
    intermediates: {
      interest_reserve_months: C9,
      purchase_closing_costs: C11,
      estimated_utilities_insurance: C12,
      loan_origination_fee: C23,
      interest_reserve: C24,
      less_construction_loan_downpayment: C26,
    },
  };
}
