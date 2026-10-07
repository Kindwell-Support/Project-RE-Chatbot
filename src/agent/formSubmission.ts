/**
 * Turns an inline form submission into calculator tool arguments.
 *
 * This is a translation layer, NOT a second calculation path. It produces the
 * same `args` object the model would have produced from natural language, and
 * that object goes through the same runFlipTool/runBrrrrTool/runLandTool via
 * the same executeTool switch. Same validation, same defaults, same logging.
 *
 * Everything here is driven by CALCULATOR_FORMS, which is itself derived from
 * TOOL_DEFINITIONS — so a new schema field is accepted by this validator the
 * moment it exists, with no edit here.
 */
import { CALCULATOR_FORMS, type CalculatorForm, type CalculatorKey } from './formSchema.js';

export class FormValidationError extends Error {
  constructor(
    readonly calculator: string,
    readonly fields: string[],
    message: string,
  ) {
    super(message);
    this.name = 'FormValidationError';
  }
}

/** Treat blank string / null / undefined as "not supplied". 0 is a real value. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

/**
 * Form inputs arrive as strings. Accept the number the member typed, including
 * "350000" and "350,000", but never coerce nonsense to 0 — NaN must surface as
 * a validation error rather than silently calculating on a zero.
 */
function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Longest property name the library stores — enough for a full street address. */
export const MAX_PROPERTY_NAME_LENGTH = 120;

/** Trim and collapse whitespace; null when nothing is left. */
export function normalizePropertyName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, MAX_PROPERTY_NAME_LENGTH) : null;
}

export interface BuiltSubmission {
  tool: string;
  args: Record<string, unknown>;
  form: CalculatorForm;
}

/**
 * Validate + coerce raw form values into tool arguments.
 *
 * Required fields must be present and numeric — missing ones are rejected with
 * their labels, never defaulted (defaulting a required input is the exact bug
 * assertRequired guards in the natural-language path).
 *
 * Optional fields left blank are OMITTED, not zero-filled, so the tool runner
 * applies the sheet default and reports it in `defaults_applied`.
 */
export function buildFormSubmission(
  calculator: CalculatorKey,
  values: Record<string, unknown>,
): BuiltSubmission {
  const form = CALCULATOR_FORMS[calculator];
  const args: Record<string, unknown> = {};

  const missing: string[] = [];
  const invalid: string[] = [];

  for (const field of form.required) {
    const raw = values[field.name];
    if (isBlank(raw)) {
      missing.push(field.label);
      continue;
    }
    if (field.type === 'text') {
      const text = normalizePropertyName(raw);
      if (text === null) missing.push(field.label);
      else args[field.name] = text;
      continue;
    }
    const num = toNumber(raw);
    if (num === null) {
      invalid.push(field.label);
      continue;
    }
    args[field.name] = num;
  }

  if (missing.length > 0) {
    throw new FormValidationError(
      calculator,
      missing,
      `Please fill in: ${missing.join(', ')}. These are required — they have no default.`,
    );
  }

  for (const field of form.optional) {
    const raw = values[field.name];
    if (isBlank(raw)) continue; // omitted -> tool runner applies the sheet default

    if (field.type === 'enum') {
      const text = String(raw);
      if (!field.options?.includes(text)) {
        invalid.push(`${field.label} (expected ${field.options?.join(' or ')})`);
        continue;
      }
      args[field.name] = text;
      continue;
    }

    const num = toNumber(raw);
    if (num === null) {
      invalid.push(field.label);
      continue;
    }
    args[field.name] = num;
  }

  if (invalid.length > 0) {
    throw new FormValidationError(
      calculator,
      invalid,
      `These values aren't valid numbers: ${invalid.join(', ')}.`,
    );
  }

  return { tool: form.tool, args, form };
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatValue(value: unknown, unit: string | undefined): string {
  if (typeof value !== 'number') return String(value);
  if (unit === 'usd') return USD.format(value);
  if (unit === 'decimal') return `${(value * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  if (unit === 'months') return `${value} months`;
  if (unit === 'sf') return `${value.toLocaleString('en-US')} sf`;
  return String(value);
}

/**
 * A readable transcript line for a form submission.
 *
 * The conversation is stored server-side and replayed to the model on the next
 * turn, so a submission must read like something a member said — otherwise the
 * follow-up turn ("why is the cash-on-cash low?") has no numbers to refer to.
 */
export function describeSubmission(form: CalculatorForm, args: Record<string, unknown>): string {
  const byName = new Map([...form.required, ...form.optional].map((f) => [f.name, f]));
  const parts = Object.entries(args)
    .filter(([name]) => name !== 'property_name')
    .map(([name, value]) => {
      const field = byName.get(name);
      return `${field ? field.label.toLowerCase() : name} ${formatValue(value, field?.unit)}`;
    });
  // The property leads the line, the way a member would say it — and it keeps
  // the name in the replayed history, so "re-run it with 5 months" next turn
  // still knows which property "it" is.
  const property = typeof args.property_name === 'string' ? ` for ${args.property_name}` : '';
  return `Run the ${form.title} calculator${property}: ${parts.join(', ')}.`;
}
