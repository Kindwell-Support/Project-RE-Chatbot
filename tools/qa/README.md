# QA tooling

Two verifiers used to check that assertions are worth what they claim. Both are
run by hand, not by CI, and both exit non-zero on failure.

```
python tools/qa/mutate.py          # do the tests catch the defects they target?
python tools/qa/p1_identity.py     # are the P1 mechanisms still byte-identical?
```

## The rule these exist to enforce

An assertion is only worth what it *discriminates*. "It goes red" is not the
standard; "it goes red for the right reason, and green for the right reason" is.
Both scripts are therefore self-controlled — each can demonstrate that it fails
when it should, so neither can pass by measuring nothing.

## mutate.py — does a test catch the defect it names?

Reintroduces one original defect at a time into a target file, runs a suite, and
requires it to go red. A mutation that is *not* caught is reported as MISSED.

**THE NON-ZERO PASSED COUNT RULE.** A collection failure — a parse error, a bad
import, a renamed file — reports as:

```
Test Files  1 failed (1)
     Tests  no tests
```

A driver that decides "caught" from the failed-file count alone reads that as a
catch. It is not: **nothing ran**. Every mutation would appear caught, including
the ones the suite is blind to, and the report would be exactly backwards.

So every run must yield a **non-zero PASSED count** before its result is
believed. A run that collects nothing is reported INVALID, never as a catch.
This is not hypothetical — it has fired twice:

- a parse error in a test file surfaced as `Tests no tests` and would have
  scored as six clean catches;
- a mutation anchor that matched two call sites was reported as SKIP rather than
  silently mutating the wrong one and scoring the result.

The same rule applies to any gate, any driver, and any green claim made by hand:
assert what PASSED, not merely the absence of failures.

Two further guards, both learned the hard way:

- **The pristine source is read once, before anything is written**, and every
  restore writes *that*. An earlier version re-derived its backup from the
  target on each start, so a crashed run left a mutation in place and the next
  run promoted it into its own baseline — reporting a broken tree as green.
- **Restores run in a `finally`**, so a driver that throws mid-run still leaves
  the working tree clean.

## p1_identity.py — are the protected mechanisms untouched?

`stale(op)`, the `op.cleanup` inerting block, and the call-time `sessionId`
reads are the three mechanisms that stop chat A's late-arriving answer painting
into chat B. They must stay byte-identical to the Phase 1 baseline
(`BASELINE_REV`) across all of Phase 2.

Each region is located by an explicit start and end anchor, extracted, and
SHA-256 compared — not read by eye and not inferred from a diff. If an anchor
fails to match exactly once in either revision the region is reported FAIL
rather than compared, because an extractor that matched nothing in both
revisions would hash two empty strings and report identity.

To confirm it still discriminates, change one character inside `stale(op)`
(`!==` to `!=`) and re-run: it must report CHANGED for P1a and identical for the
rest.
