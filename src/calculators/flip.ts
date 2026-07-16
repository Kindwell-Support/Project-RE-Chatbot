/**
 * Flip Calculator — pure transcription of Flip_Calculator.xlsx (Sheet1).
 * Cell references in comments map 1:1 to the spreadsheet, which is the spec.
 */

export type YesNo = 'Yes' | 'No';

export interface FlipInputs {
  /** C8 */ purchase_price: number;
  /** C9 */ rehab_budget: number;
  /** C10 */ after_repair_value: number;
  /** C11 */ holding_months: number;
  /** C12 */ annual_taxes?: number;
  /** C13 */ re_sales_costs_pct?: number;
  /** E8 */ down_payment_pct?: number;
  /** E9 */ origination_points_pct?: number;
  /** E10 */ interest_rate?: number;
  /** E11 */ interest_reserve?: YesNo;
  /** E12 */ annual_insurance?: number;
  /** E13 */ excise_tax_pct?: number;
  /** C28 */ include_second_loan?: YesNo;
  /** C30 */ second_loan_points_pct?: number;
  /** C31 */ second_loan_interest_rate?: number;
  /** C43 */ monthly_utilities?: number;
  /** D24 */ loan_fees?: number;
  /** D32 */ second_loan_fees?: number;
  /** D39 */ acquisition_closing_costs?: number;
  /** D54 */ other_closing_costs?: number;
  /** D55 */ staging?: number;
}

export const FLIP_DEFAULTS = {
  annual_taxes: 3000,
  re_sales_costs_pct: 0.06,
  down_payment_pct: 0.2,
  origination_points_pct: 0.02,
  interest_rate: 0.12,
  interest_reserve: 'No' as YesNo,
  annual_insurance: 1200,
  excise_tax_pct: 0.0178,
  include_second_loan: 'No' as YesNo,
  second_loan_points_pct: 0.03,
  second_loan_interest_rate: 0.12,
  monthly_utilities: 200,
  loan_fees: 800,
  second_loan_fees: 500,
  acquisition_closing_costs: 1500,
  other_closing_costs: 1200,
  staging: 0,
};

export interface FlipOutputs {
  /** D49 */ total_direct_costs: number;
  /** D56 */ total_selling_costs: number;
  /** D62 */ est_net_profit: number;
  /** D64 */ down_payment: number;
  /** D65 */ monthly_carrying_cost: number;
  /** D66 */ total_carrying_costs: number;
  /** D68 */ cash_out_of_pocket: number;
  /** D73 */ cash_on_cash_return: number;
  /** D74 */ annualized_return: number;
}

export function calculateFlip(inputs: FlipInputs): FlipOutputs {
  const i = { ...FLIP_DEFAULTS, ...inputs };

  const D16 = i.purchase_price;                          // D16 = C8
  const D17 = i.rehab_budget;                            // D17 = C9
  const D18 = D16 + D17;                                 // total costs for financing
  const D19 = D18 * i.down_payment_pct;                  // down payment

  const D22 = D18 - D19;                                 // loan basis
  const D23 = D22 * i.origination_points_pct;            // loan points
  const D24 = i.loan_fees;
  const D25 = D22 + D23 + D24;                           // promissory note

  const secondLoan = i.include_second_loan === 'Yes';
  const D29 = secondLoan ? D19 : 0;                      // 2nd loan amount
  const D30 = secondLoan ? D29 * i.second_loan_points_pct : 0;
  const D32 = i.second_loan_fees;
  const D33 = secondLoan ? D29 + D30 + D32 : 0;          // 2nd loan promissory note
  const D34 = secondLoan
    ? (D33 * i.second_loan_interest_rate) / 12 * i.holding_months
    : 0;                                                 // 2nd loan interest

  const D37 = D16;
  const D38 = D17;
  const D39 = i.acquisition_closing_costs;
  const D40 = (D25 * i.interest_rate) / 12 * i.holding_months; // interest total
  const C40 = D40 / i.holding_months;                    // monthly interest
  const C41 = i.annual_taxes / 12;
  const D41 = C41 * i.holding_months;
  const C42 = i.annual_insurance / 12;
  const D42 = C42 * i.holding_months;
  const C43 = i.monthly_utilities;
  const D43 = C43 * i.holding_months;
  const D44 = D23;
  const D45 = D24;
  const D46 = secondLoan ? D30 : 0;
  const D47 = secondLoan ? D32 : 0;
  const D48 = secondLoan ? D34 : 0;
  const C48 = secondLoan ? D48 / i.holding_months : 0;
  // D49 = SUM(D37:D48) — C-column cells are outside the summed D range
  const D49 = D37 + D38 + D39 + D40 + D41 + D42 + D43 + D44 + D45 + D46 + D47 + D48;

  const D52 = i.re_sales_costs_pct * i.after_repair_value; // R/E commissions
  const D53 = i.excise_tax_pct * i.after_repair_value;     // excise tax
  const D54 = i.other_closing_costs;
  const D55 = i.staging;
  const D56 = D52 + D53 + D54 + D55;                       // total selling costs

  const D59 = i.after_repair_value;
  const D62 = D59 - D49 - D56;                             // est. net profit

  const D64 = D19 - D29;                                   // down payment cash in deal
  // Interest reserve "Yes": lender rolls interest into the loan, so no monthly
  // interest out of pocket (profit is unchanged — interest stays a deal cost).
  const D65 = i.interest_reserve === 'Yes'
    ? C41 + C42 + C43
    : C40 + C41 + C42 + C43 + C48;                         // monthly carrying
  const D66 = D65 * i.holding_months;
  const D67 = D55;                                         // staging
  const D68 = D64 + D66 + D67;                             // cash out of pocket

  const D73 = D68 === 0 ? 0 : D62 / D68;                   // IFERROR(D62/D68, 0)
  const D74 = D68 === 0 || i.holding_months === 0 ? 0 : (D62 / D68) * 12 / i.holding_months;

  return {
    total_direct_costs: D49,
    total_selling_costs: D56,
    est_net_profit: D62,
    down_payment: D64,
    monthly_carrying_cost: D65,
    total_carrying_costs: D66,
    cash_out_of_pocket: D68,
    cash_on_cash_return: D73,
    annualized_return: D74,
  };
}
