# GHL Field-Shape Report — Phase 3 first deliverable

Probed 2026-08-24, read-only, token from `.env`, location `EDY094ip0U3HwMFQYsVy`,
API `services.leadconnectorhq.com`, `Version: 2021-07-28`. Three contacts, one
per branch of the access rule, each read through BOTH the search shape and the
fetch-by-id shape. This file is the fixture source for INSPECTOR's GHL fake —
hold the fake against this, not the admin UI.

## 1. SCOPE FAILURE, named as such

`GET /locations/{id}/customFields` → **HTTP 401**:

```json
{ "statusCode": 401, "message": "The token is not authorized for this scope." }
```

Contact search and contact-by-id both answer 200, so the token carries a
contacts-read scope but NOT the custom-field-definitions scope. This is a scope
problem, not a data problem. Consequence below (§3): the Course Access field
**id** is inferred from values, not confirmed from definitions — either the
token gains the definitions scope (preferred: one probe re-run pins it) or the
client confirms the id out of band.

## 2. THE SHAPE

`contact.customFields` is an **array of `{ id, value }` — no key, no name** —
in BOTH shapes, exactly as the brief warned. `value` is polymorphic across
field types: plain string (dropdowns, text), array of strings (multi-selects,
even single-valued ones: `["2-5"]`), number (dates as epoch millis — search
shape only), string dates (`"2025-01-31"` — by-id shape only).

## 3. Course Access = field id `axyDeZQxj7gMCtV1FyxS` (inferred, see §1)

Evidence: it is the only field carrying `"Project Flip"` on the normal contact
and `"Retired Member"` on the retired contact — exact dropdown labels, same id,
in both shapes of both contacts. Strong, but inferred from values; the 401
blocks definitional confirmation.

## 4. LABELS, not keys — consistent across all three

Every observed value is the admin-UI label verbatim, exact case
(`"Project Flip"`, `"Retired Member"`; other dropdowns show `"Yes"`, `"No"`).
No key-form value (`project_flip`) appeared anywhere. **No mix observed** in
this sample — but the sample is two valued contacts, and the June 2026 sheet
import means the parser still normalizes case/whitespace rather than trusting
label casing (`normalize(v) = trim().toLowerCase()` per the ruled rule).

## 5. BLANK = the entry is ABSENT from the array entirely

`jooliefl@gmail.com` (blank branch): `axyDeZQxj7gMCtV1FyxS` **does not appear
in `customFields` at all** — not `null`, not `""`, not id-present-value-missing.
Identical in both shapes. Reported as observed; the other three blank
representations were NOT observed and are not inferred — the rule denies on all
four regardless, because `find(...)` returning `undefined` normalizes to the
same `{found: true, value: null}` deny path.

## 6. SEARCH shape vs BY-ID shape — consume BY-ID. Reasoning:

Two material differences, both observed on the normal contact:

- **The search shape THINS the array.** Search returned 6 custom fields; by-id
  returned 9 (dropping e.g. a text field and a long free-text field). The
  thinning rule is opaque. Course Access happened to survive thinning on both
  valued contacts — but "happened to" is not a contract, and under the ruled
  deny-on-blank rule, a thinned-away field is INDISTINGUISHABLE from a
  genuinely blank one: a paying member would be denied by an artifact of which
  shape we read. That failure mode is exactly the one the deny-list design
  exists to avoid.
- **Value encodings differ per shape.** The same date field is
  `1738281600000` in search and `"2025-01-31"` by-id. Irrelevant to Course
  Access today, but proof the shapes are not interchangeable.

**Therefore the server consumes: search by email (exact-match filtered — the
query is fuzzy) → contact id → `GET /contacts/{id}` → full-record
`customFields`.** Two calls per verification; correctness over one round trip
on an auth path that runs once per tab-session.

## 7. Verbatim payloads (fixture data)

One elision for data minimization, marked inline: a free-text personal answer
irrelevant to the gate. Everything else byte-verbatim.

### adrianroa2015@gmail.com — normal value ("Project Flip" → ALLOW)

search-result `customFields`:
```json
[
  { "id": "VedX2M1wunGxatcZajdg", "value": ["2-5"] },
  { "id": "HuXw1632z0s1fufjADdy", "value": "$5,000 - $10,000" },
  { "id": "SnAPg4oTiWa3OGV9HRIS", "value": 1738281600000 },
  { "id": "LQT2NWwZIWNyUNLbG8TM", "value": 1769817600000 },
  { "id": "KWnz2Nm3pJSk6c0tzF1t", "value": "1495" },
  { "id": "axyDeZQxj7gMCtV1FyxS", "value": "Project Flip" }
]
```

full-record `customFields`:
```json
[
  { "id": "z09aaQZyyKFX1dX28kco", "value": "Construction" },
  { "id": "VedX2M1wunGxatcZajdg", "value": ["2-5"] },
  { "id": "GmyrqPq2LqhcE7nhfql3", "value": ["This week!"] },
  { "id": "IsDX0IseGA7WqQvQIz0C", "value": "[free-text personal answer elided — PII, irrelevant to the gate]" },
  { "id": "HuXw1632z0s1fufjADdy", "value": "$5,000 - $10,000" },
  { "id": "SnAPg4oTiWa3OGV9HRIS", "value": "2025-01-31" },
  { "id": "LQT2NWwZIWNyUNLbG8TM", "value": "2026-01-31" },
  { "id": "KWnz2Nm3pJSk6c0tzF1t", "value": "1495" },
  { "id": "axyDeZQxj7gMCtV1FyxS", "value": "Project Flip" }
]
```

### abel@investslo.com — Retired Member → DENY

search-result `customFields`:
```json
[
  { "id": "HgPGAFdSHWptiQEDlkTh", "value": "No" },
  { "id": "bq2WrZ21MgRVxC5rJcXq", "value": "Yes" },
  { "id": "Ac6tlsYcZGdsyMF3nNvl", "value": "Yes" },
  { "id": "VedX2M1wunGxatcZajdg", "value": ["2-5"] },
  { "id": "HuXw1632z0s1fufjADdy", "value": "$100,000 +" },
  { "id": "SnAPg4oTiWa3OGV9HRIS", "value": 1737676800000 },
  { "id": "LQT2NWwZIWNyUNLbG8TM", "value": 1769212800000 },
  { "id": "KWnz2Nm3pJSk6c0tzF1t", "value": "9995" },
  { "id": "axyDeZQxj7gMCtV1FyxS", "value": "Retired Member" }
]
```

full-record `customFields`: same nine entries, same encodings for Course
Access (`"Retired Member"` string in both); date fields differ in encoding as
described in §6.

### jooliefl@gmail.com — blank → DENY

Both shapes identical:
```json
[
  { "id": "HgPGAFdSHWptiQEDlkTh", "value": "Yes" },
  { "id": "Tg4QihW7AjClysAWYI8q", "value": ["1 - 5"] },
  { "id": "ct7kkPeWYjQMtQh1ptDN", "value": ["Flipping", "Rentals"] }
]
```

`axyDeZQxj7gMCtV1FyxS` absent entirely — the §5 finding.

## 8. Consequences for S1 (approved normalization plan, restated)

The parser is the ONLY shape-dependent code: full-record `customFields` →
`{found: boolean, value: string | null}`, where `found` is "the contact
exists" and `value` is the Course Access entry's value coerced to a trimmed
string, or null when the entry is absent/null/empty/non-string. The rule
consumes `{found, value}` only; its unit tests are shape-independent; this
file's §7 arrays are the parser's pinned fixtures. Labels-not-keys means no
mapping table today — if one ever appears mixed, the parser grows a documented
mapping and the change is announced, not absorbed.

## 9. UNSAMPLED: cleared-after-having-a-value (operator addendum)

All three probes sampled NEVER-SET blanks. A field that HAD a value and was
set back to empty — the path revocation actually takes if a retiree is handled
by clearing rather than selecting Retired Member — was NOT sampled, and GHL
sometimes represents cleared differently from never-set (id present with
null, or with ""). Not inferred here: the parser DENIES on all four candidate
representations (entry absent · value null · value "" · value whitespace-only)
and each of the four is TESTED, not merely asserted, in tests/ghlAccess.test.ts.
If a cleared contact becomes available, one probe run pins the real
representation.

Open item for Abdullah: the definitions-scope 401 (§1). Preferred close: add
the scope, re-run the probe once, replace "inferred" with "confirmed" in §3.
