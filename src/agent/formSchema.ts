/**
 * Calculator form metadata — DERIVED, never hand-written.
 *
 * The inline chat forms need to know which fields a calculator takes, which are
 * required, and what each optional field defaults to. All of that already
 * exists in two places the code depends on:
 *
 *   1. TOOL_DEFINITIONS (toolDefs.ts) — the field list, types, enums, and the
 *      `required` array. This is the same schema the model is given.
 *   2. FLIP_DEFAULTS / BRRRR_DEFAULTS / LAND_DEFAULTS (calculators/*.ts) — the
 *      sheet defaults the tool runners apply.
 *
 * This module joins those two and emits frontend-consumable field descriptors.
 * It deliberately contains NO field list of its own: add a parameter to a tool
 * definition and it appears in the form automatically; rename one and the form
 * renames with it. A hand-duplicated list is exactly the drift that produced
 * past bugs, so there isn't one here.
 *
 * Note the field set is intentionally narrower than the *_DEFAULTS objects.
 * FLIP_DEFAULTS carries 17 keys, but the tool schema exposes 10 — the schema is
 * the contract for what a caller may set, so the schema is what the form shows.
 */
import { FLIP_DEFAULTS } from '../calculators/flip.js';
import { BRRRR_DEFAULTS } from '../calculators/brrrr.js';
import { LAND_DEFAULTS } from '../calculators/land.js';
import { TOOL_DEFINITIONS } from './toolDefs.js';

export type CalculatorKey = 'flip' | 'brrrr' | 'land_purchase';

/** Unit hint for rendering — inferred from the schema description, not restated. */
export type FieldUnit = 'usd' | 'decimal' | 'months' | 'sf';

export interface FormField {
  name: string;
  label: string;
  /** 'enum' renders as a select; 'number' as a numeric input. */
  type: 'number' | 'enum';
  required: boolean;
  description: string;
  unit?: FieldUnit;
  /** Present only for enum fields. */
  options?: string[];
  /** The sheet default. Absent for required fields, which never have one. */
  default?: number | string;
  /**
   * Session-derived editable default (CONTRACT §8.1) — today only the ARV
   * field, from the session's comps block. NOT a sheet default: the widget
   * must render `label` visibly next to the value ("Pre-filled from your
   * comps on … — edit to override") and must SUBMIT the value even when
   * untouched (it is a required field's value, not an omittable default).
   * Attached at request time by applyFormArvPrefill on a CLONE — the static
   * CALCULATOR_FORMS never carry it.
   */
  prefill?: {
    value: number;
    /** Null = unbound manual ARV (BUG-011); the label then says "you set earlier". */
    subjectAddress: string | null;
    arvSource: 'comps' | 'manual';
    confidence: string | null;
    label: string;
  };
}

export interface CalculatorForm {
  calculator: CalculatorKey;
  /** The tool a submission of this form must call. */
  tool: string;
  title: string;
  required: FormField[];
  optional: FormField[];
}

/**
 * The only per-calculator wiring: which tool backs which key, its defaults, and
 * a display title. Not a field list — the fields come from the schema.
 */
const CALCULATORS: Record<
  CalculatorKey,
  { tool: string; title: string; defaults: Record<string, unknown> }
> = {
  flip: { tool: 'flip_calculator', title: 'Fix & Flip', defaults: FLIP_DEFAULTS },
  brrrr: { tool: 'brrrr_calculator', title: 'BRRRR', defaults: BRRRR_DEFAULTS },
  land_purchase: {
    tool: 'land_purchase_calculator',
    title: 'Land / New Construction',
    defaults: LAND_DEFAULTS,
  },
};

export const CALCULATOR_KEYS = Object.keys(CALCULATORS) as CalculatorKey[];

/**
 * Display-only acronym fixes. This is NOT a field list and cannot drift: any
 * name absent here falls back to the derived label, so a new schema field still
 * renders correctly — just with a title-cased label instead of an acronym.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  after_repair_value: 'After-repair value (ARV)',
  refinance_ltarv: 'Refinance LTARV',
  min_dscr: 'Minimum DSCR',
  refinance_method: 'Refinance method',
  construction_sf: 'Build square footage',
  price_per_sf: 'Cost per square foot',
  property_mgmt_pct: 'Property management',
};

/** purchase_price -> "Purchase price"; _pct/_sf suffixes are noise in a label. */
function deriveLabel(name: string): string {
  if (LABEL_OVERRIDES[name]) return LABEL_OVERRIDES[name];
  const words = name.replace(/_pct$/, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Unit comes from the description the schema already carries ("in dollars",
 * "as a decimal", "in months"), so it stays correct without a second list to
 * maintain. Order matters: check the explicit phrases before the loose ones.
 */
function deriveUnit(name: string, description: string): FieldUnit | undefined {
  const d = description.toLowerCase();
  if (d.includes('as a decimal')) return 'decimal';
  if (d.includes('in dollars')) return 'usd';
  if (d.includes('in months')) return 'months';
  if (d.includes('square footage')) return 'sf';
  if (name.endsWith('_pct')) return 'decimal';
  if (name.endsWith('_months')) return 'months';
  return undefined;
}

interface SchemaProperty {
  type?: string;
  enum?: string[];
  description?: string;
}

/** Pull a tool's JSON-Schema parameters out of TOOL_DEFINITIONS by name. */
function schemaFor(toolName: string): {
  properties: Record<string, SchemaProperty>;
  required: string[];
} {
  // ChatCompletionTool is a union (function | custom); only function tools have
  // the parameter schema the form is built from.
  const tool = TOOL_DEFINITIONS.find(
    (t): t is Extract<typeof t, { type: 'function' }> =>
      t.type === 'function' && t.function.name === toolName,
  );
  if (!tool) throw new Error(`No tool definition named "${toolName}"`);
  const params = (tool.function.parameters ?? {}) as {
    properties?: Record<string, SchemaProperty>;
    required?: string[];
  };
  return { properties: params.properties ?? {}, required: params.required ?? [] };
}

function buildField(
  name: string,
  property: SchemaProperty,
  required: boolean,
  defaults: Record<string, unknown>,
): FormField {
  const description = property.description ?? '';
  const field: FormField = {
    name,
    label: deriveLabel(name),
    type: property.enum ? 'enum' : 'number',
    required,
    description,
  };
  const unit = deriveUnit(name, description);
  if (unit) field.unit = unit;
  if (property.enum) field.options = property.enum;
  // Required fields never carry a default — substituting one is the silent-blank
  // bug assertRequired exists to prevent.
  if (!required) {
    const fallback = defaults[name];
    if (typeof fallback === 'number' || typeof fallback === 'string') field.default = fallback;
  }
  return field;
}

export function buildCalculatorForm(calculator: CalculatorKey): CalculatorForm {
  const { tool, title, defaults } = CALCULATORS[calculator];
  const { properties, required } = schemaFor(tool);

  const fields = Object.entries(properties).map(([name, property]) =>
    buildField(name, property, required.includes(name), defaults),
  );

  return {
    calculator,
    tool,
    title,
    required: fields.filter((f) => f.required),
    optional: fields.filter((f) => !f.required),
  };
}

/** Every calculator's form, keyed by calculator. Derived at module load. */
export const CALCULATOR_FORMS: Record<CalculatorKey, CalculatorForm> = Object.fromEntries(
  CALCULATOR_KEYS.map((key) => [key, buildCalculatorForm(key)]),
) as Record<CalculatorKey, CalculatorForm>;

export function isCalculatorKey(value: unknown): value is CalculatorKey {
  return typeof value === 'string' && (CALCULATOR_KEYS as string[]).includes(value);
}
