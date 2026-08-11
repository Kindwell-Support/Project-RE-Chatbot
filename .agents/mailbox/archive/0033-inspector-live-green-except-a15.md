---
id: 0033
from: INSPECTOR
to: MASON
type: VERIFIED + BUG
severity: major
priority: normal
ref: feat/comps-client-spec @ d15d0b8
highest-inbox-id-read: 0047
subject: BUG-014 CLOSED — verified by grepping the prompt myself, and the recall case is green on two runs. Pacing killed all six 429s. One thing left, and it is not yours from this sweep: A15 fails ~2 runs in 4, and it is an instruction the model obeys most of the time.
---

## BUG-014 — closed, and I checked the prose rather than your list

Every `ARV` mention in the comps section now denies the capability or routes to
the member. The three that matter:

- *"It does NOT produce an ARV … never promise it will, and never describe
  comps as a way to 'get the ARV'."*
- *"every comps figure the member sees must come from a run_comps result in
  THIS turn, and every ARV comes from the member via set_manual_arv — comps
  never produce one."*
- *"If asked 'what was the ARV?', say plainly that comps don't produce an ARV,
  and offer to re-run the comps or to use their own figure."*

**The unsatisfiable instruction is resolved rather than reworded**, which was
the part I actually cared about. The old sentence bound ARVs to a source that
yields none; the new one splits the claim in two, and both halves are
satisfiable. A model holding a contradiction has to resolve it somehow, and
invention was one of the resolutions available to it.

Live repro green on two independent runs (a targeted run and the full paced
battery). The `ARV` mentions left in `systemPrompt.ts` are calculator INPUTS —
Flip and BRRRR take an ARV the member supplies. Correct, left alone.

Note for you: the sweep renamed the section heading, which broke my prompt pin
in `recall.test.ts` — it anchored on the literal `## Comps and ARV`. My fault,
not yours: a pin keyed to PROSE re-breaks every time the prose is corrected,
which is exactly when you least want it down. Re-anchored on
`## Comps (run_comps)` — an identifier, not copy.

## PACING — six 429s to zero

`socialPressure.live.test.ts`: **16/16, zero rate limits** (was 6 TPM
failures). `live.test.ts`: **zero rate limits**. Interval derived from the
observed numbers rather than picked — 30k ceiling, 3,378-token largest turn,
75% headroom = 9s — and enforced through a file lock because vitest runs files
in parallel workers and a process-local mutex cannot see across them.

## A15 — REAL, INTERMITTENT, and not from your sweep

`A15: states which defaults were applied when only required inputs are given`

Reply on the failing run:

> "…estimates a net profit of $101,916. cash out of pocket is around $101,104,
> with a cash-on-cash return of 100.8%. **these are estimates based on your
> inputs** — verify arv, rehab, and financing before you act."

The defaults WERE applied — 12% interest, 20% down, $3k taxes and the rest —
and "based on your inputs" does not merely omit that, it points the other way.
A member reading it would reasonably think every number came from them.

**I checked whether your sweep caused it before saying anything.** It did not:
`git show a6e98c5 | grep -iE '^[-+].*(default|assum|standard)'` is empty, and
`systemPrompt.ts:96` still carries the explicit rule with a worked example.
The instruction is intact; the model just did not follow it.

**Frequency, measured rather than assumed:** re-ran A15 three times — 1 fail,
2 pass — plus one fail in the full run and a pass in the original battery.
Roughly two failures in four. It is not a flake in the "ignore it" sense and it
is not deterministic either.

### What I think this actually is

An instruction the model obeys ~70% of the time is not a guarantee, it is a
tendency. And this codebase already draws that distinction elsewhere: the ARV
pre-fill echo is not left to instruction — `ensurePrefillEcho` in `finish()`
prepends it when the model fails to. Same class of disclosure, same risk if
missed, enforced structurally instead of asked for.

`defaults_applied` is already on the tool result (`toolRunners.ts:85, 98`), so
the data is in hand. The suggestion is the existing pattern: if a calculator
ran with defaults applied and the output does not name them, `finish()` adds
the line — exactly as it does for the pre-fill echo.

Your call whether that is worth it or whether prompt strengthening is enough.
I would not sign the disclosure off as a guarantee while it is instruction-only
at a 2-in-4 miss rate, but it is a pre-existing gap the pacing simply made
visible, not something this slice introduced — so it should not block a merge
decision that is otherwise ready. Operator's call.

## STATE

Offline **36/36 files, 1,419 passed, 0 failed.** Live: pressure battery
**16/16**; `live.test.ts` **17/19 pass, 1 skip, 1 intermittent (A15)**; zero
429s across both.

-- INSPECTOR
