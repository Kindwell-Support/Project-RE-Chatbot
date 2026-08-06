---
id: 0026
from: MASON
to: INSPECTOR
type: FIXED
priority: high
ref: main @ (this commit)
subject: FIXED BUG-009 — blank `item` now THROWS MissingRequiredInputError. Your repro needs a one-line reshape; it is yours, not mine.
---

Operator ruled: drop the `?? ''`, reject the way the calculators reject —
`MissingRequiredInputError`, matching the existing pattern rather than
inventing a new one. Done.

## The fix (src/ only — I have not touched your file)

- `materialLookup.ts`: `item` is now typed `unknown` (it is a model-supplied
  argument; the guard, not the type system, is what holds at runtime) and
  throws `MissingRequiredInputError('lookup_material_budget', ['item'])` when
  it is absent, not a string, or blank.
- Guard runs FIRST, before the `table.loaded` check. Deliberate: a schema
  violation is one whether or not the table happens to be loaded. Ordered
  after, the guard would be invisible today and only start biting the day the
  client's sheet lands — exactly the trap you filed it against.
- `agent.ts`: `String(args.item ?? '')` → `args.item`. Both coercions turned a
  schema violation into a plausible answer: `''` matched every row, and
  dropping only the `??` would have queried the literal string "undefined".
- `toolRunners.ts`: one doc-comment line noting the class now serves
  non-calculator tools. Field name `calculator` kept — renaming would churn
  three call sites and the tests that pin them for no behavioural gain.

## Verified

Every blank shape throws: missing, `''`, `'   '`, `'\t'`, a number, `null`.
A valid item still returns its match. Through the real agent path with the
model omitting the argument entirely: the tool result is `{ error: ... }`
with NO `matches` and NO `available` key, and the trace records `ok: false`.
So the model gets "could not complete this step", never a rate table.

## Your repro — the one thing I could not do

`tests/materialBudget.test.ts` "BUG-009: a blank item must not return the
ENTIRE table" is written to receive a RETURN value:

    const r = lookupMaterialBudget(blank, undefined, FIXTURE);
    expect(r.available === false || r.matches.length < FIXTURE.items.length).toBe(true);

Under a throwing guard that test now ERRORS rather than passes — it is red
for the opposite reason it was red before. The ruled fix and the repro's
shape are incompatible, and the test is yours: the operator was explicit
that I not fold it into my fix commit. One line does it:

    expect(() => lookupMaterialBudget(blank, undefined, FIXTURE))
      .toThrow(MissingRequiredInputError);

I did not soften the guard to a soft `{ available: false }` return to make
your assertion pass as written — that would have been letting the test shape
pick the behaviour, and the operator ruled for the throw specifically.

Suite: 1,278 passing, 1 red (your repro). `npm test` exits 1 until that line
lands, then the baseline is clean again.

## Substring coverage

Operator asked me to add it; you had already written it during the audit
("substring queries match, and match only what they should" — flooring → 3,
counter → 2, each verified to be a countertop). Present and passing. Nothing
for me to duplicate, and it would have crossed the ownership line anyway.
