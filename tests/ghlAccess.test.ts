/**
 * Phase 3 S1 — the GHL client, the parser, and the access rule.
 *
 * Layer discipline (approved plan): the RULE tests are shape-independent and
 * consume only {found, values}; the PARSER tests pin the probe's verbatim
 * payloads (reports/GHL_FIELD_SHAPE.md §7) as fixtures; the CLIENT tests
 * drive a fetch fake shaped by the same report. Wrong-subject check
 * throughout: every deny case asserts the REASON, not just the boolean —
 * "denied because retired" and "denied because the lookup threw" both deny,
 * and an assertion on the outcome alone cannot tell them apart.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createGhlClient,
  decideAccess,
  normalizeAccessValue,
  parseCourseAccessValues,
  FIELD_MISSING_TRIPWIRE,
  type CourseAccessLookup,
} from '../src/server/ghl.js';

const FIELD_ID = 'axyDeZQxj7gMCtV1FyxS';

const found = (values: string[]): CourseAccessLookup => ({ ok: true, found: true, values });

// ---------------------------------------------------------------------------
// The rule — shape-independent.
// ---------------------------------------------------------------------------

describe('the access rule — deny-list, deliberately', () => {
  it('ALLOWS every current dropdown value except Retired Member', () => {
    for (const value of [
      'Project Flip',
      'Project Broker',
      'Project Private Money',
      'Project Wholesale',
      'Free Unlimited', // client-confirmed included
    ]) {
      const decision = decideAccess(found([value]));
      expect(decision.allow, `${value} was denied`).toBe(true);
      if (decision.allow) expect(decision.value).toBe(value);
    }
  });

  it('ALLOWS an unknown seventh value — the deny-list property itself', () => {
    // If a seventh tier is added later, a new member gets access by default
    // rather than being locked out by a hardcoded list nobody updated. An
    // allow-list would fail THIS case, and its failure mode is a paying
    // member unable to use the product.
    const decision = decideAccess(found(['Project Land Baron']));
    expect(decision.allow, 'an unknown tier was denied — the deny-list became an allow-list').toBe(
      true,
    );
  });

  it('DENIES Retired Member in every case/whitespace variant', () => {
    for (const variant of [
      'Retired Member',
      'retired member',
      'RETIRED MEMBER',
      'Retired member',
      '  Retired Member  ',
      'retired MEMBER',
    ]) {
      const decision = decideAccess(found([variant]));
      expect(decision.allow, `"${variant}" was allowed`).toBe(false);
      if (!decision.allow) {
        expect(decision.reason, `"${variant}" denied for the wrong reason`).toBe('denied');
      }
    }
  });

  it('DENIES blank: empty list, empty string, whitespace-only', () => {
    // A member with a blank field is denied BY DESIGN — a GHL data question,
    // not a bot defect.
    for (const values of [[], [''], ['   '], ['', '   ']]) {
      const decision = decideAccess(found(values as string[]));
      expect(decision.allow, `blank variant ${JSON.stringify(values)} was allowed`).toBe(false);
      if (!decision.allow) {
        expect(decision.reason).toBe('denied');
        expect((decision as { value: string | null }).value, 'blank must carry value null').toBeNull();
      }
    }
  });

  it('the three deny reasons are DISTINCT — the discriminator is built in', () => {
    const notFound = decideAccess({ ok: true, found: false });
    const denied = decideAccess(found(['Retired Member']));
    const failed = decideAccess({ ok: false, detail: 'search HTTP 503' });

    expect(notFound).toEqual({ allow: false, reason: 'not_found' });
    expect(denied).toEqual({ allow: false, reason: 'denied', value: 'Retired Member' });
    expect(failed).toEqual({ allow: false, reason: 'lookup_failed', detail: 'search HTTP 503' });
    // The subject: three different problems a member can act on differently.
    const reasons = new Set([notFound, denied, failed].map((d) => !d.allow && d.reason));
    expect(reasons.size, 'two deny paths collapsed into one reason').toBe(3);
  });

  it('NEVER fails open: a lookup failure denies', () => {
    const decision = decideAccess({ ok: false, detail: 'timeout' });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toBe('lookup_failed');
  });

  it('normalize is trim + lowercase, nothing more', () => {
    expect(normalizeAccessValue('  Retired Member  ')).toBe('retired member');
    expect(normalizeAccessValue('PROJECT FLIP')).toBe('project flip');
  });
});

// ---------------------------------------------------------------------------
// The parser — fixtures are the probe's verbatim payloads (§7).
// ---------------------------------------------------------------------------

const ADRIAN_FULL = [
  { id: 'z09aaQZyyKFX1dX28kco', value: 'Construction' },
  { id: 'VedX2M1wunGxatcZajdg', value: ['2-5'] },
  { id: 'GmyrqPq2LqhcE7nhfql3', value: ['This week!'] },
  { id: 'IsDX0IseGA7WqQvQIz0C', value: '[free-text elided]' },
  { id: 'HuXw1632z0s1fufjADdy', value: '$5,000 - $10,000' },
  { id: 'SnAPg4oTiWa3OGV9HRIS', value: '2025-01-31' },
  { id: 'LQT2NWwZIWNyUNLbG8TM', value: '2026-01-31' },
  { id: 'KWnz2Nm3pJSk6c0tzF1t', value: '1495' },
  { id: FIELD_ID, value: 'Project Flip' },
];

const ABEL_FULL = [
  { id: 'HgPGAFdSHWptiQEDlkTh', value: 'No' },
  { id: 'bq2WrZ21MgRVxC5rJcXq', value: 'Yes' },
  { id: 'Ac6tlsYcZGdsyMF3nNvl', value: 'Yes' },
  { id: 'VedX2M1wunGxatcZajdg', value: ['2-5'] },
  { id: 'HuXw1632z0s1fufjADdy', value: '$100,000 +' },
  { id: 'SnAPg4oTiWa3OGV9HRIS', value: 1737676800000 },
  { id: 'LQT2NWwZIWNyUNLbG8TM', value: 1769212800000 },
  { id: 'KWnz2Nm3pJSk6c0tzF1t', value: '9995' },
  { id: FIELD_ID, value: 'Retired Member' },
];

const JOOLIE_FULL = [
  { id: 'HgPGAFdSHWptiQEDlkTh', value: 'Yes' },
  { id: 'Tg4QihW7AjClysAWYI8q', value: ['1 - 5'] },
  { id: 'ct7kkPeWYjQMtQh1ptDN', value: ['Flipping', 'Rentals'] },
];

describe('the parser — the only shape-dependent code', () => {
  it('FIXTURE adrian: extracts "Project Flip" from the full record', () => {
    expect(parseCourseAccessValues(ADRIAN_FULL, FIELD_ID)).toEqual(['Project Flip']);
  });

  it('FIXTURE abel: extracts "Retired Member"', () => {
    expect(parseCourseAccessValues(ABEL_FULL, FIELD_ID)).toEqual(['Retired Member']);
  });

  it('FIXTURE joolie: the entry is ABSENT — empty list (probe §5, as observed)', () => {
    expect(parseCourseAccessValues(JOOLIE_FULL, FIELD_ID)).toEqual([]);
  });

  it('CLEARED four-way (probe §9 — unsampled, so TESTED, not asserted): all deny', () => {
    // Never-set was the only observed blank. Cleared-after-having-a-value may
    // arrive as any of the other three; every one must reach the same deny.
    const representations: Array<[string, unknown]> = [
      ['entry absent', JOOLIE_FULL],
      ['value null', [...JOOLIE_FULL, { id: FIELD_ID, value: null }]],
      ['value empty string', [...JOOLIE_FULL, { id: FIELD_ID, value: '' }]],
      ['value whitespace-only', [...JOOLIE_FULL, { id: FIELD_ID, value: '   ' }]],
    ];
    for (const [label, customFields] of representations) {
      const values = parseCourseAccessValues(customFields, FIELD_ID);
      const decision = decideAccess({ ok: true, found: true, values });
      expect(decision.allow, `${label} was allowed`).toBe(false);
      if (!decision.allow) expect(decision.reason, label).toBe('denied');
    }
  });

  it('C-2 POLYMORPHIC VALUE: an array-wrapped "Retired Member" still DENIES', () => {
    // The worst possible failure in this phase: a revoked member re-admitted
    // because the deny value arrived in a representation the parser read as
    // non-string and passed through as unknown. Not observed; tested anyway.
    const wrapped = [...JOOLIE_FULL, { id: FIELD_ID, value: ['Retired Member'] }];
    const decision = decideAccess({
      ok: true,
      found: true,
      values: parseCourseAccessValues(wrapped, FIELD_ID),
    });
    expect(decision.allow, 'array-wrapping smuggled a revoked member past the gate').toBe(false);
    if (!decision.allow) expect(decision.reason).toBe('denied');
  });

  it('C-2: an array-wrapped allowed value still allows', () => {
    const wrapped = [...JOOLIE_FULL, { id: FIELD_ID, value: ['Project Flip'] }];
    const decision = decideAccess({
      ok: true,
      found: true,
      values: parseCourseAccessValues(wrapped, FIELD_ID),
    });
    expect(decision.allow).toBe(true);
  });

  it('C-2: "Retired Member" ANYWHERE in a multi-value array denies', () => {
    // Unknown values allow; unknown REPRESENTATIONS of the known deny value
    // do not. The check runs over every element, not element zero.
    const multi = [...JOOLIE_FULL, { id: FIELD_ID, value: ['Project Flip', 'Retired Member'] }];
    const decision = decideAccess({
      ok: true,
      found: true,
      values: parseCourseAccessValues(multi, FIELD_ID),
    });
    expect(decision.allow, 'retired hid behind an allowed first element').toBe(false);
  });

  it('C-2: a numeric value stringifies and ALLOWS as unknown (deny-list property)', () => {
    const numeric = [...JOOLIE_FULL, { id: FIELD_ID, value: 1738281600000 }];
    const values = parseCourseAccessValues(numeric, FIELD_ID);
    expect(values).toEqual(['1738281600000']);
    expect(decideAccess({ ok: true, found: true, values }).allow).toBe(true);
  });

  it('an object value collapses to blank, never "[object Object]"', () => {
    const objectValue = [...JOOLIE_FULL, { id: FIELD_ID, value: { nested: true } }];
    expect(parseCourseAccessValues(objectValue, FIELD_ID)).toEqual([]);
  });

  it('a non-array customFields collapses to blank', () => {
    for (const junk of [null, undefined, 'nope', 42, { id: FIELD_ID, value: 'Project Flip' }]) {
      expect(parseCourseAccessValues(junk, FIELD_ID)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// The client — fetch fake shaped by the report.
// ---------------------------------------------------------------------------

interface FakeGhlOptions {
  searchContacts?: any[];
  searchStatus?: number;
  byId?: Record<string, { status?: number; contact?: any }>;
  reject?: boolean;
  definitions?: { status: number; fields?: any[] };
}

function fakeGhl(opts: FakeGhlOptions) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (opts.reject) throw new Error('network down');
    const respond = (status: number, body: unknown) => ({
      status,
      text: async () => JSON.stringify(body),
    });
    if (u.includes('/customFields')) {
      const d = opts.definitions ?? { status: 401 };
      return respond(d.status, d.status === 200 ? { customFields: d.fields ?? [] } : { statusCode: d.status, message: 'The token is not authorized for this scope.' });
    }
    if (u.includes('/contacts/?')) {
      if ((opts.searchStatus ?? 200) !== 200) return respond(opts.searchStatus!, {});
      const q = decodeURIComponent(u.split('query=')[1] ?? '').toLowerCase();
      const pool = opts.searchContacts ?? [];
      // Fuzzy like the real API: return every contact whose email CONTAINS
      // the query, so exact-match filtering stays the client's job.
      const hits = pool.filter((c) => String(c.email ?? '').toLowerCase().includes(q));
      return respond(200, { contacts: hits.length ? hits : pool });
    }
    const id = decodeURIComponent(u.split('/contacts/')[1] ?? '');
    const entry = opts.byId?.[id];
    if (!entry) return respond(404, {});
    return respond(entry.status ?? 200, { contact: entry.contact });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const CFG = {
  ghlApiToken: 'test-token',
  ghlLocationId: 'EDY094ip0U3HwMFQYsVy',
  ghlCourseAccessFieldId: FIELD_ID,
};

const silent = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

describe('the client — search finds the id, BY-ID is what the rule consumes', () => {
  it('reads Course Access from the FULL record even when search thinned it away', async () => {
    // The report's §6 reasoning as a test: search returns a thinned array
    // WITHOUT Course Access; the full record has it. If the client consumed
    // the search shape, this paying member would be denied as blank.
    const { fetchImpl } = fakeGhl({
      searchContacts: [
        { id: 'c1', email: 'adrianroa2015@gmail.com', customFields: JOOLIE_FULL /* thinned! */ },
      ],
      byId: { c1: { contact: { id: 'c1', customFields: ADRIAN_FULL } } },
    });
    const client = createGhlClient(CFG, { fetchImpl, logger: silent });

    const lookup = await client.lookupCourseAccess('adrianroa2015@gmail.com');

    expect(lookup).toEqual({ ok: true, found: true, values: ['Project Flip'] });
    const decision = decideAccess(lookup);
    expect(decision.allow, 'the client consumed the thinned search shape').toBe(true);
  });

  it('exact-matches the email — a fuzzy search hit for someone else is not the member', async () => {
    const { fetchImpl } = fakeGhl({
      searchContacts: [
        { id: 'other', email: 'adrianroa2015+other@gmail.com', customFields: [] },
        { id: 'c1', email: 'Adrianroa2015@Gmail.com', customFields: [] },
      ],
      byId: { c1: { contact: { id: 'c1', customFields: ADRIAN_FULL } } },
    });
    const client = createGhlClient(CFG, { fetchImpl, logger: silent });

    const lookup = await client.lookupCourseAccess('adrianroa2015@gmail.com');

    expect(lookup.ok && lookup.found && lookup.values).toEqual(['Project Flip']);
  });

  it('NO exact match → not_found, even with fuzzy hits present', async () => {
    const { fetchImpl } = fakeGhl({
      searchContacts: [{ id: 'other', email: 'adrianroa2015+other@gmail.com' }],
    });
    const client = createGhlClient(CFG, { fetchImpl, logger: silent });

    const lookup = await client.lookupCourseAccess('adrianroa2015@gmail.com');

    expect(lookup).toEqual({ ok: true, found: false });
    expect(decideAccess(lookup)).toEqual({ allow: false, reason: 'not_found' });
  });

  it('search HTTP failure → lookup_failed with detail; NEVER not_found', async () => {
    // Wrong-subject guard: a 503 misreported as not_found would tell the
    // member their email is wrong when GHL is what broke.
    const { fetchImpl } = fakeGhl({ searchStatus: 503 });
    const client = createGhlClient(CFG, { fetchImpl, logger: silent });

    const lookup = await client.lookupCourseAccess('x@y.com');

    expect(lookup).toEqual({ ok: false, detail: 'search HTTP 503' });
  });

  it('by-id HTTP failure → lookup_failed, not blank-deny', async () => {
    // The full-record fetch failing must not read as "found with no field" —
    // that would convert a GHL outage into denied-as-blank with no retry.
    const { fetchImpl } = fakeGhl({
      searchContacts: [{ id: 'c1', email: 'x@y.com' }],
      byId: { c1: { status: 500, contact: null } },
    });
    const client = createGhlClient(CFG, { fetchImpl, logger: silent });

    const lookup = await client.lookupCourseAccess('x@y.com');

    expect(lookup).toEqual({ ok: false, detail: 'contact fetch HTTP 500' });
  });

  it('network rejection → lookup_failed; the failure is logged with running counts', async () => {
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const { fetchImpl } = fakeGhl({ reject: true });
    const client = createGhlClient(CFG, { fetchImpl, logger });

    const lookup = await client.lookupCourseAccess('x@y.com');

    expect(lookup.ok).toBe(false);
    expect(client.stats()).toEqual({ lookups: 1, failures: 1 });
    // The ruled observability: GHL flakiness must be visible before the
    // client sees it as support traffic.
    expect(logger.warn).toHaveBeenCalled();
  });

  it('C-1 TRIPWIRE: a streak of found-contacts with no field fires an error log', async () => {
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const { fetchImpl } = fakeGhl({
      searchContacts: [{ id: 'c1', email: 'x@y.com' }],
      byId: { c1: { contact: { id: 'c1', customFields: JOOLIE_FULL } } },
    });
    const client = createGhlClient(CFG, { fetchImpl, logger });

    for (let i = 0; i < FIELD_MISSING_TRIPWIRE; i += 1) {
      await client.lookupCourseAccess('x@y.com');
    }

    expect(
      logger.error,
      'a wrong field id would deny every member silently — the tripwire must fire',
    ).toHaveBeenCalled();
    const [obj] = logger.error.mock.calls[0];
    expect(obj.fieldId).toBe(FIELD_ID);
  });

  it('C-1 TRIPWIRE CONTROL: a found value RESETS the streak — blanks alone never fire', async () => {
    // Blank members exist by design (probe §5). One member with a value inside
    // the window proves the id is right, and the tripwire must stay silent.
    //
    // ONE client, 2N-2 total blanks with a valued lookup in the middle: fires
    // if the reset is missing (2N-2 >= N), silent if it works. A first draft
    // used two clients and only proved N-1 < N — wrong subject, caught in
    // review before commit.
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const { fetchImpl } = fakeGhl({
      searchContacts: [
        { id: 'c1', email: 'x@y.com' },
        { id: 'c2', email: 'v@y.com' },
      ],
      byId: {
        c1: { contact: { id: 'c1', customFields: JOOLIE_FULL } },
        c2: { contact: { id: 'c2', customFields: ADRIAN_FULL } },
      },
    });
    const client = createGhlClient(CFG, { fetchImpl, logger });

    for (let i = 0; i < FIELD_MISSING_TRIPWIRE - 1; i += 1) await client.lookupCourseAccess('x@y.com');
    await client.lookupCourseAccess('v@y.com'); // valued — must reset the streak
    for (let i = 0; i < FIELD_MISSING_TRIPWIRE - 1; i += 1) await client.lookupCourseAccess('x@y.com');

    expect(
      logger.error,
      '2N-2 blanks with a valued lookup between fired the tripwire — the reset is gone',
    ).not.toHaveBeenCalled();
  });

  it('C-1 BOOT PROBE: verified / wrong_id / scope_missing are three distinct outcomes', async () => {
    // scope_missing (today's reality, probe §1):
    const scopeMissing = createGhlClient(CFG, {
      fetchImpl: fakeGhl({ definitions: { status: 401 } }).fetchImpl,
      logger: silent,
    });
    expect(await scopeMissing.verifyFieldId()).toBe('scope_missing');

    // verified (once the scope lands):
    const okLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const verified = createGhlClient(CFG, {
      fetchImpl: fakeGhl({
        definitions: { status: 200, fields: [{ id: FIELD_ID, name: 'Course Access' }] },
      }).fetchImpl,
      logger: okLogger,
    });
    expect(await verified.verifyFieldId()).toBe('verified');
    expect(okLogger.error).not.toHaveBeenCalled();

    // wrong_id — the catastrophic case, loud:
    const wrongLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const wrong = createGhlClient(CFG, {
      fetchImpl: fakeGhl({
        definitions: { status: 200, fields: [{ id: 'SOMETHING_ELSE', name: 'Course Access' }] },
      }).fetchImpl,
      logger: wrongLogger,
    });
    expect(await wrong.verifyFieldId()).toBe('wrong_id');
    expect(wrongLogger.error, 'a wrong id must fail LOUDLY at boot').toHaveBeenCalled();
  });
});
