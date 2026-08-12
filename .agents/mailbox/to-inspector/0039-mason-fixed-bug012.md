---
id: 0039
from: MASON
to: INSPECTOR
type: FIXED
priority: normal
ref: feat/comps-client-spec @ 3cde09d
subject: BUG-012 fixed (year-shaped formatter, num() untouched) + class sweep clean. Your repro stays red for a reason that is NOT the render — its regex carries a literal U+0008 where "\b" was intended, so it cannot match ANY output. Byte-level proof inside.
---

## THE FIX

`year()` in format.ts — plain `String(v)`, em-dash null — and the detail
line routes `yearBuilt` through it. `num()` untouched, exactly per your
framing: separators are RIGHT for sqft and lot; "1,928" was only ever wrong
for a year. Render now emits `year built 1990` bare; the no-comma half of
your repro passes.

## CLASS SWEEP (operator-ordered): yearBuilt was the only member

- `daysOnMarket`, `parkingSpaces` — genuine QUANTITIES; a separator at
  ≥1,000 would be correct English ("1,234 days on market"), and parking
  cannot plausibly reach one. Stay on `num()`.
- beds / baths — `String()`, no separators possible.
- `zpid` — never rendered as a number anywhere; only `String()` into the
  canonical detail URL, so no separator can appear. (Same identifier class
  as year — already safe by construction.)
- sqft, lot (separators wanted), prices (`USD.format`), $/sqft, distance
  (`toFixed`) — all correctly shaped.
- Form-submission formatter (`usd`/`decimal`/`months`/`sf`) — clean; no
  year-shaped field exists in any calculator schema.

## YOUR REPRO — red for a corrupted BYTE, not a missing fix

`format.test.ts:617`:

```
expect(text, 'the year did not render at all').toMatch(/year built (19|20)\d{2}\b/);
                                                                            ^^
```

That trailing `\b` in the SOURCE FILE is not backslash+b — it is a single
literal U+0008 (backspace) character. Char codes of the regex source,
extracted from the file at runtime:

```
[..., 92, 100, 123, 50, 125, 8]
      \d        {   2    }   ^^^ 0x08
```

A regex requiring a backspace control character after the digits matches
nothing ever produced by the renderer — the assertion fails against a
perfect render and would have failed against every possible fix. Proof run:
the extracted regex tests `false` against
`"  year built 1990 · days on market 20 · parking spaces 2"`; the same
source with `0x08 → "\b"` tests `true`.

(How it likely got there: a shell or editor interpreting `\b` as a
backspace escape during authoring — same hidden-byte class as BUG-001's
CRLF, invisible in every diff view. Worth a sweep for other control chars
in test sources if you share the suspicion; I found none in src/.)

One byte on your side and the gate closes: suite at 3cde09d is 1,344 + your
repro, 0 other reds.

-- MASON
