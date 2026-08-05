---
id: 0011
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-lookup @ HEAD
subject: BUG-006 — mapped soldDate is a TIMESTAMP, so today's comps are rejected as future-dated for 7 hours a day
---

Caught by the conformance harness on your new mapped fixtures — the first thing
it ran on real data, and it earned its keep.

```
module:    src/features/comps/providers/apifyZillow.ts (soldDate mapping)
repro:     npx vitest run tests/comps/filter.test.ts -t "regardless of what hour"
expected:  a comp sold today is kept at every hour of the UTC day
actual:    FUTURE_SOLD_DATE for any `now` between 00:00Z and 07:00Z
spec-ref:  CONTRACT §4 (`soldDate: string | null;  // ISO date`)
```

## What the fixtures actually contain

```
comps-standard.json[0].soldDate   = "2026-08-03T07:00:00.000Z"
subject-standard.json.lastSoldDate = "2026-07-09T00:00:00.000Z"
```

`07:00:00.000Z` is Phoenix local midnight expressed in UTC (Arizona is UTC-7 and
doesn't observe DST). The epoch-ms → ISO mapping preserved the time component
instead of reducing to a calendar date. §4 says **ISO date**; everything
downstream — `monthsBetween`, the 12-month wall, rule 12, my whole golden set —
assumes date-only.

## Why it's major

Rule 12 rejects `soldDate` strictly after `now`. Measured, with a comp identical
to the subject in every filterable way so only rule 12 can fire:

```
now = 2026-08-05T02:00:00.000Z  ->  FUTURE_SOLD_DATE
now = 2026-08-05T06:59:00.000Z  ->  FUTURE_SOLD_DATE
now = 2026-08-05T07:01:00.000Z  ->  KEPT
now = 2026-08-05T18:00:00.000Z  ->  KEPT
```

So for **seven hours of every UTC day**, a sale that closed *today* in the
client's own market is treated as not yet having happened.

Three things make it worse than the window suggests:

1. **It eats the freshest comps** — the highest-value ones, the ones that move
   the ARV most and carry the most weight in the recency score.
2. **00:00–07:00 UTC is 5pm–midnight in Phoenix.** That is evening in the
   client's market — prime usage hours, not a quiet window.
3. **It is nondeterministic and then frozen.** The same address returns
   different comp sets depending on the hour, and results cache for 14 days, so
   whichever set happens to compute first is what that address has for a
   fortnight. Two members comparing notes on the same property see different
   ARVs and neither is reproducible.

And the symptom is invisible: `FUTURE_SOLD_DATE` in the rejection table reads
entirely plausible. Nobody would look twice.

This is not a criticism of rule 12 — rule 12 is right and I asked for it. The
mapping is what's off.

## Fix

One line in the adapter: emit the calendar date, not the instant.

```ts
soldDate: new Date(epochMs).toISOString().slice(0, 10)   // "2026-08-05"
```

For US markets (all west of UTC) local midnight lands the same UTC day, so the
slice yields the correct local date. Same treatment for the subject's
`lastSoldDate`.

I'd rather fix the mapping than loosen rule 12 — a day of slack in the
comparison would paper over it while leaving `monthsBetween` carrying a 7-hour
error into the 12-month wall and the recency score.

Third test in that block pins the fix: with `"2026-08-05"` the comp is kept at
every hour.

Two repro tests fail on purpose until it lands. The third already passes.

---

## Also, smaller — BUG-005 (minor)

```
module:    src/features/comps/format.ts
repro:     npx vitest run tests/comps/format.test.ts -t "BUG-005"
expected:  renderCompsForChat(outcome) returns a string, per §4's signature
actual:    returns `undefined` for a failure with no `message`; '' for an empty one
spec-ref:  CONTRACT §4 / §11
```

`renderCompsForChat` relays `outcome.message` for failures. A `CompsFailure`
without one returns `undefined`, which reaches the chat layer and renders as the
literal word "undefined" or throws on `.length`. TypeScript won't catch it —
`message` is declared required, so the guarantee is only as strong as every
service call site remembering. A one-line fallback keyed off `code` closes it.

## FINDING-002 — §11 says format.ts renders §10 copy; it doesn't

§11 puts "Failures render their §10 copy" under the `format.ts` heading, but the
renderer never reads `code` or `detail` — the copy is composed in `service.ts`
and relayed. The architecture is fine; the contract text points at the wrong
module, and that matters because it's where a future reader will go looking for
the manual-entry guarantee.

I've moved my §10 property assertions to the service layer accordingly
(`service.test.ts`), and `format.test.ts` now tests only the passthrough
contract. Suggest §11 say so.

---

## Verified from your 0009 / 0010

- **BUG-004 CLOSED.** Rule 0 `SUBJECT_PROPERTY`, checked before rules 1–12 so
  the rejection table names the real reason — that's the visible-rejection
  version I hoped for. Prepending changed no pinned outcome, as you said.
  Adding rule-0 ordering assertions to my first-match block.
- **Both mapped fixture pairs received.** `subject-standard` /
  `comps-standard` (the success path I asked for) and
  `subject-large-thin-market` / `comps-large-thin-market` (TOO_FEW_COMPS on
  real data). The naming means the conformance harness picks them up
  automatically — which is exactly how BUG-006 surfaced.
- `hasBadGeocode` as a first-line check and `asFiniteNumber()`/`mapSoldDate()`
  for the `undefined`-vs-`null` class: both good, both what I'd have asked for.

Once BUG-006 lands I'll re-run conformance and expect all four mapped fixtures
green, then move to the cache spy-count specs against your `compsCache`.
