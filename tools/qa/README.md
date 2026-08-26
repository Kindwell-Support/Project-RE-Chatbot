# QA tooling

Verifiers used to check that assertions are worth what they claim. All are run
by hand, not by CI, and all exit non-zero on failure.

```
python tools/qa/mutate.py          # do the tests catch the defects they target?
python tools/qa/p1_identity.py     # are the P1 mechanisms still byte-identical?
npm run qa:chrome                  # the claims jsdom cannot make honestly
```

## PRE-MERGE — required on every branch that touches widget/widget.js

**A merge request for a widget change must paste a clean `npm run qa:chrome`.**
Not a summary of it, and not "it passed locally" — the output, because the
verdict lines are the evidence and the examined counts are what distinguish a
pass from a sweep over an empty set.

```
npm run qa:chrome
```

It runs, in order and stopping at the first failure:

| check | the claim it carries |
| --- | --- |
| `type_scale_chrome_check.mjs` | every control resolves to its mapped size, against TWO host fixtures (one with `!important`); the `--jb-font-base` floor holds at 16px for text entry; rail hierarchy survives on weight; and the FRAME survives too — rail/row padding is asserted non-zero and on-token, because the host reset zeroes button `padding` and that had already shipped a rail whose text sat flush against the pill |
| `bug046_chrome_check.mjs` | percentage resolution and UA form-control defaults |
| `bug046_placeholder_check.mjs` | the `::placeholder` guard against five host shapes |
| `input_padding_chrome_check.mjs` | composer geometry at six widths, no overlap with the send button |

**WHY THESE CANNOT LIVE IN `npm test`.** jsdom does not resolve `var()` in
`font-size`, does not resolve percentages, does no layout, and has no UA
form-control defaults. Every claim above is one jsdom would either answer
wrongly or answer vacuously. `npm test` being green says nothing about them —
which is exactly why the paste is required rather than assumed.

`qa:chrome` **rebuilds the bundle first**. These checks read
`public/widget.js`, which is gitignored build output; without the rebuild a
clean run can certify a stale bundle that no longer matches the source it
claims to verify. Running a check standalone skips that rebuild — `qa:chrome`
is the sanctioned entry point for exactly this reason.

Requires Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
There is no CI on this repo; that gap is filed separately and is not something
a branch is expected to fix.

**THE MUTATION LOCK — one lock, both drivers, or it is not a lock.** Both
rigs' drivers mutate the same target on a shared tree, and "the other rig had
no uncommitted work when I started" is a point-in-time check that says nothing
about them starting mid-cycle: INSPECTOR sampled between a restore and the
next mutation and measured a phantom coverage gap (opacity:0.999 against a
.toBe('1')). `mutation_lock.py` is the shared implementation — acquire before
ANY write (sidecar recovery included), hold across every restore, release on
clean exit only. Refusal names the holder and its start time. Stale locks
(holder PID dead, or older than the stated 60 minutes) are reclaimed LOUDLY,
and reclaiming restores the previous holder's sidecar first — silent
reclamation would reintroduce the corruption the lock prevents. The driver
also verifies every restore left the target byte-equal to the pristine source
and aborts on a second writer (INSPECTOR's tree_clean() equivalent, adopted).

**READ-SIDE PROTECTION (L-1/L-2): the lock protects writers from each other
and does nothing for readers.** A read-only measurement — a plain suite run, a
browser pass — can sample inside the window between a holder's mutations,
where fifteen seconds of stability is a gap, not quiescence. Before ANY
measurement: `python tools/qa/mutation_lock.py status` (exit 0 free / 2 held,
holder named) and decline to start if held. Around EVERY measurement: bracket
with `python tools/qa/mutation_lock.py hash <paths>` before and after — if the
hashes differ the tree moved mid-measurement; DISCARD, do not report. Both
rigs use this one implementation.

**Run mutate.py IN THE BACKGROUND — that is the default, foreground is the
exception.** The run outgrew a 10-minute foreground window at 32 mutations and
the set only grows; a foreground timeout kills it mid-mutation (the sidecar
recovery has already had to fire for exactly this). Every run appends
JSON-lines to `tools/qa/results/run-<stamp>.jsonl` after each mutation —
crash-durable, so a killed run leaves a file that is VISIBLY partial: rows
with no trailing `summary` line. **A file without a `summary` row is not a
pass and must never be read as one.** `latest.json` points at the newest run.
Results are per-rig evidence, gitignored, and survive session boundaries — a
session boundary has already cost this project a matrix that had to be
reconstructed from memory.

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

**NOT CAUGHT IS A QUESTION, NOT A VERDICT (FINDING-036).** A mutation defeated
by a working defence and a mutation the tests missed report identically — the
build genuinely changed both times, so the inert guard cannot tell them apart.
Only reading the code path can. Every MISSED takes one of three dispositions
before it is reported onward, and the driver prints the menu so nobody
defaults to (a):

- **(a) genuine coverage gap** → write the test. BUG-033 (qualifier Arm B,
  load-bearing and unpinned) was this, and was nearly missed.
- **(b) defeated by a live defence** → mutate *past* the defence, then
  re-score. A skeleton injected inside `prependHistory` was removed by
  `loadHistory`'s unconditional teardown before any assertion ran — the fourth
  teardown path *working*, not a gap. Filing a (b) as (a) yields a vacuous
  test.
- **(c) unpinned by construction** → record why, write nothing. The
  belt-and-braces teardown itself: deleting it goes unnoticed because the
  primary paths work, exactly as its comment predicts. Its pin is the comment,
  by design.

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
