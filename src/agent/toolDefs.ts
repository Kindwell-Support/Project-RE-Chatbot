/**
 * OpenAI tool definitions — explicit typed parameters, never a free-form
 * string blob (the old build's root failure mode).
 */
import type OpenAI from 'openai';

const num = (description: string) => ({ type: 'number' as const, description });
const yesNo = (description: string) => ({
  type: 'string' as const,
  enum: ['Yes', 'No'],
  description,
});

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'flip_calculator',
      description:
        "Run James Dainard's fix-and-flip deal calculator. Returns net profit, carrying costs, cash out of pocket, and cash-on-cash returns. Unspecified optional fields fall back to the sheet defaults; the result lists which defaults were applied so they can be disclosed.",
      parameters: {
        type: 'object',
        properties: {
          purchase_price: num('Total acquisition price in dollars'),
          rehab_budget: num('Estimated rehab budget in dollars'),
          after_repair_value: num('Estimated after-repair value (ARV) in dollars'),
          holding_months: num('Holding period in months'),
          interest_reserve: yesNo(
            'Whether the lender rolls interest into the loan ("Yes") instead of monthly out-of-pocket payments. Default "No".',
          ),
          include_second_loan: yesNo(
            'Whether a second loan covers the down payment for 100% financing. Default "No".',
          ),
          down_payment_pct: num('Loan down payment as a decimal, e.g. 0.2. Default 0.2'),
          interest_rate: num('Annual interest rate as a decimal, e.g. 0.12. Default 0.12'),
          annual_taxes: num('Annual property taxes in dollars. Default 3000'),
          annual_insurance: num('Annual insurance in dollars. Default 1200'),
        },
        required: ['purchase_price', 'rehab_budget', 'after_repair_value', 'holding_months'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'brrrr_calculator',
      description:
        "Run James Dainard's BRRRR (buy, rehab, rent, refinance, repeat) calculator. Returns cash left in deal, monthly cash flow, cash-on-cash, 5-year IRR, equity captured, DSCR at refinance, and max allowable offer. Unspecified optional fields fall back to the sheet defaults; the result lists which defaults were applied.",
      parameters: {
        type: 'object',
        properties: {
          purchase_price: num('Total acquisition price in dollars'),
          rehab_budget: num('Estimated rehab budget in dollars'),
          after_repair_value: num('Estimated after-repair value (ARV) in dollars'),
          monthly_rent: num('Expected gross monthly rent in dollars'),
          holding_months: num('Construction/holding period in months. Default 4'),
          refinance_method: {
            type: 'string',
            enum: ['LTV', 'DSCR'],
            description:
              'How the refinance loan is sized: "LTV" (percent of ARV) or "DSCR" (sized from NOI and min DSCR). Default "LTV".',
          },
          refinance_ltarv: num('Refinance loan-to-ARV as a decimal. Default 0.75'),
          refinance_interest_rate: num('Refinance annual interest rate as a decimal. Default 0.075'),
          min_dscr: num('Minimum DSCR when refinance_method is "DSCR". Default 1.2'),
          annual_taxes: num('Annual property taxes in dollars. Default 3000'),
          annual_insurance: num('Annual insurance in dollars. Default 1200'),
          annual_repairs: num('Annual repairs & maintenance in dollars. Default 1650'),
          annual_utilities: num('Annual owner-paid utilities in dollars. Default 0'),
          property_mgmt_pct: num('Property management fee as a decimal of rent. Default 0.08'),
          vacancy_pct: num('Vacancy rate as a decimal. Default 0.05'),
        },
        required: ['purchase_price', 'rehab_budget', 'after_repair_value', 'monthly_rent'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'land_purchase_calculator',
      description:
        "Run James Dainard's land / new-construction calculator. Works backwards from the finished value and target investor return to the maximum land contract price. Returns target land contract, project costs, loan amount, net profit, and returns. Unspecified optional fields fall back to the sheet defaults; the result lists which defaults were applied.",
      parameters: {
        type: 'object',
        properties: {
          construction_sf: num('New construction square footage'),
          price_per_sf: num('Construction cost per square foot in dollars'),
          new_construction_value: num('Estimated finished (new construction) value in dollars'),
          project_duration_months: num('Total project duration in months'),
          construction_interest_rate: num(
            'Construction loan annual interest rate as a decimal. Default 0.09',
          ),
          target_assignment_fee: num('Target assignment fee in dollars. Default 100000'),
          target_investor_return: num('Target investor return as a decimal. Default 0.25'),
          selling_costs_pct: num('Selling costs as a decimal of sale price. Default 0.1'),
        },
        required: [
          'construction_sf',
          'price_per_sf',
          'new_construction_value',
          'project_duration_months',
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        "Semantic search over James Dainard's course material (transcripts, book, podcasts, YouTube). Use for his teaching, frameworks, rules of thumb, and renovation references. Returns the top matching passages.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language search query',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_material_budget',
      description:
        'Deterministic lookup of material-allowance and construction install-rate budgets by item and spec tier (Budget, Basic, Standard, Premium). Call this FIRST for any material/finish/install-rate budget question. If it reports the item is unavailable, follow the fallback instruction in its result (search the knowledge base and quote only retrieved figures).',
      parameters: {
        type: 'object',
        properties: {
          item: {
            type: 'string',
            description: 'Material or construction line item, e.g. "flooring", "countertops"',
          },
          spec_tier: {
            type: 'string',
            enum: ['Budget', 'Basic', 'Standard', 'Premium'],
            description: 'Finish specification tier. Omit to return all tiers for the item.',
          },
        },
        required: ['item'],
        additionalProperties: false,
      },
    },
  },
];
