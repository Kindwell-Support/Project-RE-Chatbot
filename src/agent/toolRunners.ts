/**
 * Calculator tool runners: fill sheet defaults for anything the caller didn't
 * supply, run the pure calculator, and report exactly which defaults were
 * applied so the agent can disclose them.
 */
import { calculateFlip, FLIP_DEFAULTS, type FlipInputs } from '../calculators/flip.js';
import { calculateBrrrr, BRRRR_DEFAULTS, type BrrrrInputs } from '../calculators/brrrr.js';
import { calculateLand, LAND_DEFAULTS, type LandInputs } from '../calculators/land.js';

const ESTIMATE_NOTE =
  'All figures are estimates for education only, based on the inputs and defaults shown — not financial advice. Verify ARV, rehab, rents, and financing independently before acting.';

function defaultsApplied<T extends Record<string, unknown>>(
  defaults: T,
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const applied: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (provided[key] === undefined || provided[key] === null) applied[key] = value;
  }
  return applied;
}

function stripUndefined(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(([, v]) => v !== undefined && v !== null),
  );
}

/**
 * Required inputs have no default and never may have one. If the model omits
 * one, fail loudly: the arithmetic would otherwise produce NaN, which
 * JSON.stringify serialises to `null`, handing the model a silent blank
 * instead of an error. The old build's variant of this bug substituted sheet
 * defaults and reported the same frozen profit for every deal.
 */
export class MissingRequiredInputError extends Error {
  constructor(
    readonly calculator: string,
    readonly missing: string[],
  ) {
    super(
      `${calculator} is missing required input(s): ${missing.join(', ')}. ` +
        'Ask the user for these values — do not assume, default, or invent them.',
    );
    this.name = 'MissingRequiredInputError';
  }
}

function assertRequired(
  calculator: string,
  args: Record<string, unknown>,
  required: readonly string[],
): void {
  const missing = required.filter((field) => {
    const value = args[field];
    return typeof value !== 'number' || !Number.isFinite(value);
  });
  if (missing.length > 0) throw new MissingRequiredInputError(calculator, missing);
}

export const REQUIRED_INPUTS = {
  flip: ['purchase_price', 'rehab_budget', 'after_repair_value', 'holding_months'],
  brrrr: ['purchase_price', 'rehab_budget', 'after_repair_value', 'monthly_rent'],
  land_purchase: [
    'construction_sf',
    'price_per_sf',
    'new_construction_value',
    'project_duration_months',
  ],
} as const;

export function runFlipTool(rawArgs: Record<string, unknown>) {
  const args = stripUndefined(rawArgs);
  assertRequired('flip_calculator', args, REQUIRED_INPUTS.flip);
  const outputs = calculateFlip(args as unknown as FlipInputs);
  return {
    calculator: 'flip',
    inputs_used: { ...FLIP_DEFAULTS, ...args },
    defaults_applied: defaultsApplied(FLIP_DEFAULTS, args),
    outputs,
    note: ESTIMATE_NOTE,
  };
}

export function runBrrrrTool(rawArgs: Record<string, unknown>) {
  const args = stripUndefined(rawArgs);
  assertRequired('brrrr_calculator', args, REQUIRED_INPUTS.brrrr);
  const { projection, ...outputs } = calculateBrrrr(args as unknown as BrrrrInputs);
  return {
    calculator: 'brrrr',
    inputs_used: { ...BRRRR_DEFAULTS, ...args },
    defaults_applied: defaultsApplied(BRRRR_DEFAULTS, args),
    outputs,
    five_year_projection: projection,
    note: ESTIMATE_NOTE,
  };
}

export function runLandTool(rawArgs: Record<string, unknown>) {
  const args = stripUndefined(rawArgs);
  assertRequired('land_purchase_calculator', args, REQUIRED_INPUTS.land_purchase);
  const { intermediates, ...outputs } = calculateLand(args as unknown as LandInputs);
  return {
    calculator: 'land_purchase',
    inputs_used: { ...LAND_DEFAULTS, ...args },
    defaults_applied: defaultsApplied(LAND_DEFAULTS, args),
    computed_formula_cells: intermediates,
    outputs,
    note: ESTIMATE_NOTE,
  };
}
