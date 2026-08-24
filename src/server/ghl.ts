/**
 * GHL access gating — the client, the parser, and the access rule (Phase 3 S1).
 *
 * Layering is the approved design: every shape-dependence lives in ONE parser
 * whose fixtures are the verbatim probe payloads in reports/GHL_FIELD_SHAPE.md;
 * the rule consumes only the parser's output and its tests are
 * shape-independent. If GHL ever returns keys where it now returns labels, the
 * PARSER grows a documented mapping and the change is announced — the rule
 * does not move.
 */
import type { AppConfig } from '../config.js';

interface Logger {
  info?: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const consoleLogger: Logger = {
  warn: (obj, msg) => console.warn('[ghl]', msg ?? '', obj),
  error: (obj, msg) => console.error('[ghl]', msg ?? '', obj),
};

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// ---------------------------------------------------------------------------
// The access rule — exclusion-based, DELIBERATELY (ruled; do not "tighten").
// ---------------------------------------------------------------------------

export function normalizeAccessValue(value: string): string {
  return value.trim().toLowerCase();
}

const DENY_VALUE = 'retired member';

export type CourseAccessLookup =
  /** No contact whose primary email exactly matches. */
  | { ok: true; found: false }
  /** Contact found; values is the parsed Course Access content (empty = blank). */
  | { ok: true; found: true; values: string[] }
  /** GHL unreachable / erroring / rate-limited — the retryable case. */
  | { ok: false; detail: string };

export type AccessDecision =
  | { allow: true; value: string }
  /**
   * The three deny reasons are DISTINCT MEMBER-FACING CASES and the reason is
   * part of the contract from day one (ruled): "denied because retired" and
   * "denied because the lookup threw" both deny, and an assertion on the
   * boolean alone cannot tell them apart — the /chats-503 discriminator
   * lesson from Phase 1. S4 renders each differently; only lookup_failed
   * carries a retry affordance.
   */
  | { allow: false; reason: 'not_found' }
  | { allow: false; reason: 'denied'; value: string | null }
  | { allow: false; reason: 'lookup_failed'; detail: string };

/**
 * DENY-LIST, NOT ALLOW-LIST — ruled, with the reasoning pinned here so nobody
 * "tightens" it: if a seventh tier is added later, a new member gets access by
 * default rather than being locked out by a hardcoded list nobody updated. An
 * allow-list's failure mode is a PAYING MEMBER unable to use the product; a
 * deny-list's is a member getting access slightly early. The second is far
 * cheaper. "Free Unlimited" is included by client confirmation.
 *
 * DENY on: not found · lookup failure (never fail open — the gate exists to
 * stop unauthenticated spend) · blank (absent entry, null, empty, whitespace —
 * a member with a blank field is denied BY DESIGN; that is a GHL data
 * question, not a bot defect) · any value normalizing to "retired member".
 * ALLOW anything else, unknown values included.
 *
 * The retired check runs over EVERY parsed element, not just the first: the
 * field is a single dropdown today, but an array-wrapped or multi-valued
 * representation that smuggles "Retired Member" past a first-element read
 * would re-admit a revoked member — the worst failure this phase can have.
 * Unknown values still allow; unknown REPRESENTATIONS of the known deny value
 * do not.
 */
export function decideAccess(lookup: CourseAccessLookup): AccessDecision {
  if (!lookup.ok) return { allow: false, reason: 'lookup_failed', detail: lookup.detail };
  if (!lookup.found) return { allow: false, reason: 'not_found' };
  const values = lookup.values.map(normalizeAccessValue).filter((v) => v.length > 0);
  if (values.length === 0) return { allow: false, reason: 'denied', value: null };
  if (values.some((v) => v === DENY_VALUE)) {
    return { allow: false, reason: 'denied', value: 'Retired Member' };
  }
  return { allow: true, value: lookup.values.map((v) => v.trim()).filter(Boolean)[0] ?? '' };
}

// ---------------------------------------------------------------------------
// The parser — the ONLY shape-dependent code.
// ---------------------------------------------------------------------------

/**
 * customFields is an array of {id, value} with NO key (probe §2), and value is
 * POLYMORPHIC: string, array-of-strings (even for single-valued fields —
 * ["2-5"] observed), or number. Everything stringy is surfaced; the blank
 * cases all collapse to [].
 *
 * Handles all four blank representations even though only ABSENT was observed
 * (probe §5, §9): the entry missing entirely · value null · value "" · value
 * whitespace-only. Cleared-after-having-a-value was NOT sampled and GHL may
 * represent it as any of the last three — the parser denies on all of them,
 * and each is tested rather than asserted.
 */
export function parseCourseAccessValues(customFields: unknown, fieldId: string): string[] {
  if (!Array.isArray(customFields)) return [];
  const entry = (customFields as Array<{ id?: unknown; value?: unknown }>).find(
    (f) => f && f.id === fieldId,
  );
  if (!entry) return [];
  const raw = entry.value;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return ''; // null/undefined/objects → blank, never "[object Object]"
    })
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface GhlClientDeps {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  timeoutMs?: number;
}

export interface GhlClient {
  lookupCourseAccess(email: string): Promise<CourseAccessLookup>;
  verifyFieldId(): Promise<'verified' | 'wrong_id' | 'scope_missing' | 'error'>;
  stats(): { lookups: number; failures: number };
}

/** How many consecutive found-contacts may lack the field before the tripwire fires. */
export const FIELD_MISSING_TRIPWIRE = 10;

export function createGhlClient(
  config: Pick<AppConfig, 'ghlApiToken' | 'ghlLocationId' | 'ghlCourseAccessFieldId'>,
  deps: GhlClientDeps = {},
): GhlClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const logger = deps.logger ?? consoleLogger;
  const timeoutMs = deps.timeoutMs ?? 6000;
  const headers = {
    Authorization: `Bearer ${config.ghlApiToken ?? ''}`,
    Version: GHL_VERSION,
    Accept: 'application/json',
  };

  let lookups = 0;
  let failures = 0;
  /**
   * C-1 runtime tripwire: the field id is CONFIGURED, not literal, and it is
   * INFERRED until the definitions scope lands (probe §1/§3). A silently
   * wrong id makes every member look blank and denies them all — that must be
   * impossible to ship quietly, so a streak of found-contacts with no Course
   * Access entry logs at error level. Blank members exist by design (§5), so
   * a single miss proves nothing; a streak of FIELD_MISSING_TRIPWIRE does.
   */
  let consecutiveFieldMissing = 0;

  async function ghlGet(label: string, url: string): Promise<{ status: number; body: any }> {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(url, {
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null; // a proxy error page must not read as data
      }
      return { status: res.status, body };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function lookupCourseAccess(email: string): Promise<CourseAccessLookup> {
    lookups += 1;
    const wanted = email.trim().toLowerCase();
    try {
      // Search finds the CONTACT ID and nothing else. The query is fuzzy, so
      // the hit is exact-matched on the primary email; and the search shape's
      // customFields are DELIBERATELY ignored — that shape thins the array
      // with an opaque rule (probe §6: 6 fields vs 9 on the same contact),
      // and under deny-on-blank a thinned-away field is indistinguishable
      // from a genuinely blank one: a paying member denied by an artifact of
      // which endpoint we read. Do not collapse the two calls into one — the
      // second round trip is the price of that distinction, once per
      // tab-session.
      const search = await ghlGet(
        'search',
        `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(config.ghlLocationId)}&query=${encodeURIComponent(wanted)}`,
      );
      if (search.status !== 200) {
        failures += 1;
        logger.warn(
          { status: search.status, failures, lookups },
          'GHL contact search failed — access DENIED pending retry (never fail open)',
        );
        return { ok: false, detail: `search HTTP ${search.status}` };
      }
      const contacts: any[] = Array.isArray(search.body?.contacts) ? search.body.contacts : [];
      const hit = contacts.find(
        (c) =>
          String(c?.email ?? '').trim().toLowerCase() === wanted ||
          String(c?.emailLowerCase ?? '').trim() === wanted,
      );
      if (!hit || !hit.id) return { ok: true, found: false };

      // The full record is what the rule consumes (probe §6).
      const full = await ghlGet('by-id', `${GHL_BASE}/contacts/${encodeURIComponent(hit.id)}`);
      if (full.status !== 200) {
        failures += 1;
        logger.warn(
          { status: full.status, failures, lookups },
          'GHL contact fetch failed — access DENIED pending retry (never fail open)',
        );
        return { ok: false, detail: `contact fetch HTTP ${full.status}` };
      }
      const record = full.body?.contact ?? full.body ?? {};
      const values = parseCourseAccessValues(record.customFields, config.ghlCourseAccessFieldId);

      if (values.length === 0) {
        consecutiveFieldMissing += 1;
        if (consecutiveFieldMissing % FIELD_MISSING_TRIPWIRE === 0) {
          logger.error(
            { fieldId: config.ghlCourseAccessFieldId, streak: consecutiveFieldMissing },
            'Course Access absent from EVERY recent contact — the configured field id is ' +
              'likely WRONG (it is inferred until the definitions scope lands), and a wrong ' +
              'id denies every member. Verify with verifyFieldId() / the probe.',
          );
        }
      } else {
        consecutiveFieldMissing = 0;
      }
      return { ok: true, found: true, values };
    } catch (err) {
      failures += 1;
      logger.warn(
        { err, failures, lookups },
        'GHL lookup threw — access DENIED pending retry (never fail open)',
      );
      return { ok: false, detail: err instanceof Error ? err.message : 'network failure' };
    }
  }

  /**
   * C-1 boot probe. Self-upgrading: while the token lacks the definitions
   * scope this reports scope_missing and the runtime tripwire above is the
   * only guard; the moment the scope lands, boot verifies the configured id
   * against the definitions endpoint and a wrong id fails LOUDLY at startup
   * instead of as a mystery denial pattern.
   */
  async function verifyFieldId(): Promise<'verified' | 'wrong_id' | 'scope_missing' | 'error'> {
    try {
      const res = await ghlGet(
        'customFields',
        `${GHL_BASE}/locations/${encodeURIComponent(config.ghlLocationId)}/customFields`,
      );
      if (res.status === 401 || res.status === 403) {
        logger.warn(
          { status: res.status },
          'GHL definitions scope missing — Course Access field id stays INFERRED; ' +
            'runtime tripwire is the only wrong-id guard until the scope is added',
        );
        return 'scope_missing';
      }
      if (res.status !== 200) {
        logger.warn({ status: res.status }, 'GHL customFields probe failed');
        return 'error';
      }
      const fields: any[] = res.body?.customFields ?? res.body?.fields ?? [];
      const match = fields.find((f) => f?.id === config.ghlCourseAccessFieldId);
      if (!match) {
        logger.error(
          { fieldId: config.ghlCourseAccessFieldId },
          'Configured Course Access field id is ABSENT from the location definitions — ' +
            'EVERY member will be denied. Fix GHL_COURSE_ACCESS_FIELD_ID before shipping.',
        );
        return 'wrong_id';
      }
      (logger.info ?? logger.warn)(
        { fieldId: match.id, name: match.name },
        'Course Access field id VERIFIED against definitions',
      );
      return 'verified';
    } catch (err) {
      logger.warn({ err }, 'GHL customFields probe threw');
      return 'error';
    }
  }

  return { lookupCourseAccess, verifyFieldId, stats: () => ({ lookups, failures }) };
}
