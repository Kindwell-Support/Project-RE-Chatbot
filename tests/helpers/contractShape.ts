/**
 * Structural validators for CONTRACT §4, hand-transcribed from the contract.
 *
 * These exist for one job: when MASON's recorded Apify payload lands, reconcile
 * it against the types the whole pipeline assumes BEFORE trusting any test that
 * runs on it. A payload that disagrees with §4 invalidates everything
 * downstream — and it disagrees quietly, because TypeScript types are erased at
 * runtime and a `livingArea` of `"2,140"` will happily divide into a $/sqft of
 * `NaN` without anyone raising a hand.
 *
 * Deliberately NOT `import type` from `src/features/comps/types.ts`. A runtime
 * validator built from MASON's compile-time types would only prove the payload
 * matches the code; the point is to prove it matches the CONTRACT.
 */

export const PROPERTY_TYPES = ['SFR', 'CONDO', 'TOWNHOUSE', 'MANUFACTURED', 'OTHER'] as const;

export interface FieldProblem {
  path: string;
  problem: string;
  got: string;
}

const describeValue = (v: unknown): string => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'number' && !Number.isFinite(v)) return `number(${v})`;
  return `${typeof v}(${JSON.stringify(v)?.slice(0, 40) ?? ''})`;
};

/** ISO date, date-only. `monthsBetween` and every golden assume midnight UTC. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Nullability = 'required' | 'nullable';

function checkNumber(
  out: FieldProblem[], obj: Record<string, unknown>, path: string, key: string, n: Nullability,
) {
  const v = obj[key];
  if (v === null) {
    if (n === 'required') out.push({ path: `${path}.${key}`, problem: 'null on a required field', got: 'null' });
    return;
  }
  if (typeof v !== 'number') {
    out.push({
      path: `${path}.${key}`,
      problem: typeof v === 'string' ? 'string, not number — a numeric string divides to NaN' : 'not a number',
      got: describeValue(v),
    });
    return;
  }
  if (!Number.isFinite(v)) {
    out.push({ path: `${path}.${key}`, problem: 'not finite', got: describeValue(v) });
  }
}

function checkString(
  out: FieldProblem[], obj: Record<string, unknown>, path: string, key: string, n: Nullability,
) {
  const v = obj[key];
  if (v === null) {
    if (n === 'required') out.push({ path: `${path}.${key}`, problem: 'null on a required field', got: 'null' });
    return;
  }
  if (typeof v !== 'string') {
    out.push({
      path: `${path}.${key}`,
      problem: typeof v === 'number' ? 'number, not string' : 'not a string',
      got: describeValue(v),
    });
  }
}

function checkIsoDate(
  out: FieldProblem[], obj: Record<string, unknown>, path: string, key: string,
) {
  const v = obj[key];
  if (v === null) return; // nullable everywhere it appears
  if (typeof v !== 'string') {
    out.push({
      path: `${path}.${key}`,
      problem: typeof v === 'number'
        ? 'epoch number, not an ISO date string'
        : 'not an ISO date string',
      got: describeValue(v),
    });
    return;
  }
  if (!ISO_DATE.test(v)) {
    out.push({
      path: `${path}.${key}`,
      problem: v.includes('T')
        ? 'full timestamp — §4 says ISO date; a time component shifts monthsBetween across the 12-month wall'
        : 'not YYYY-MM-DD',
      got: describeValue(v),
    });
    return;
  }
  if (Number.isNaN(Date.parse(v))) {
    out.push({ path: `${path}.${key}`, problem: 'unparseable date', got: describeValue(v) });
  }
}

function checkPropertyType(
  out: FieldProblem[], obj: Record<string, unknown>, path: string,
) {
  const v = obj.propertyType;
  if (typeof v !== 'string' || !(PROPERTY_TYPES as readonly string[]).includes(v)) {
    out.push({
      path: `${path}.propertyType`,
      problem: `outside the closed union [${PROPERTY_TYPES.join(', ')}]`,
      got: describeValue(v),
    });
  }
}

function checkLatLng(out: FieldProblem[], obj: Record<string, unknown>, path: string) {
  checkNumber(out, obj, path, 'lat', 'required');
  checkNumber(out, obj, path, 'lng', 'required');
  const { lat, lng } = obj as { lat: unknown; lng: unknown };
  if (typeof lat === 'number' && (lat < -90 || lat > 90)) {
    out.push({ path: `${path}.lat`, problem: 'outside [-90, 90]', got: describeValue(lat) });
  }
  if (typeof lng === 'number' && (lng < -180 || lng > 180)) {
    out.push({ path: `${path}.lng`, problem: 'outside [-180, 180]', got: describeValue(lng) });
  }
  if (lat === 0 && lng === 0) {
    // Null Island: the classic "geocode failed but returned success" signature.
    out.push({ path, problem: 'lat/lng are both exactly 0 — failed geocode, not a real location', got: '0,0' });
  }
}

/** Validate one object against CONTRACT §4 `SubjectProperty`. */
export function validateSubject(value: unknown, path = 'subject'): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path, problem: 'not an object', got: describeValue(value) }];
  }
  const o = value as Record<string, unknown>;
  checkString(out, o, path, 'zpid', 'required');
  checkString(out, o, path, 'address', 'required');
  checkNumber(out, o, path, 'beds', 'nullable');
  checkNumber(out, o, path, 'baths', 'nullable');
  checkNumber(out, o, path, 'livingArea', 'nullable');
  checkNumber(out, o, path, 'lotSize', 'nullable');
  checkNumber(out, o, path, 'yearBuilt', 'nullable');
  checkPropertyType(out, o, path);
  checkNumber(out, o, path, 'lastSoldPrice', 'nullable');
  checkIsoDate(out, o, path, 'lastSoldDate');
  checkLatLng(out, o, path);
  return out;
}

/** Validate one object against CONTRACT §4 `RawComp`. */
export function validateRawComp(value: unknown, path = 'comp'): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path, problem: 'not an object', got: describeValue(value) }];
  }
  const o = value as Record<string, unknown>;
  checkString(out, o, path, 'zpid', 'required');
  checkString(out, o, path, 'address', 'required');
  checkString(out, o, path, 'status', 'required');
  checkNumber(out, o, path, 'soldPrice', 'nullable');
  checkIsoDate(out, o, path, 'soldDate');
  checkNumber(out, o, path, 'beds', 'nullable');
  checkNumber(out, o, path, 'baths', 'nullable');
  checkNumber(out, o, path, 'livingArea', 'nullable');
  checkNumber(out, o, path, 'lotSize', 'nullable');
  checkPropertyType(out, o, path);
  checkLatLng(out, o, path);
  return out;
}

/** Every key §4 declares, so an extra or renamed field is visible rather than ignored. */
export const SUBJECT_KEYS = [
  'zpid', 'address', 'beds', 'baths', 'livingArea', 'lotSize', 'yearBuilt',
  'propertyType', 'lastSoldPrice', 'lastSoldDate', 'lat', 'lng',
] as const;

export const RAW_COMP_KEYS = [
  'zpid', 'address', 'status', 'soldPrice', 'soldDate', 'beds', 'baths',
  'livingArea', 'lotSize', 'propertyType', 'lat', 'lng',
] as const;

export function missingKeys(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== 'object' || value === null) return [...keys];
  return keys.filter((k) => !(k in (value as Record<string, unknown>)));
}

export function extraKeys(value: unknown, keys: readonly string[]): string[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.keys(value as Record<string, unknown>).filter((k) => !keys.includes(k));
}

/** Readable multi-line report for an assertion message. */
export function formatProblems(problems: FieldProblem[]): string {
  if (!problems.length) return 'none';
  return '\n' + problems.map((p) => `  ${p.path}: ${p.problem} (got ${p.got})`).join('\n');
}
