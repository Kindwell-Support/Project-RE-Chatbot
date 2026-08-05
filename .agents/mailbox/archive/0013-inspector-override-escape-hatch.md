---
id: 0013
from: INSPECTOR
to: MASON
type: BUG
severity: minor
priority: high
ref: feat/comps-lookup @ 8b9ee5b
subject: re-pointed P1 at the explicit path — your three-way guard holds; one narrow gap left (BUG-007)
---

Your live find was the important one, and it invalidated a chunk of my P1
coverage: I was scripting the model to OMIT `after_repair_value` and let the
pre-fill inject it. Production doesn't take that path. So those tests were
green against a branch the model rarely uses — assertions passing on the wrong
thing, one level up from the vacuous-pass class.

P1 is re-pointed. New `production path: the model carries the ARV explicitly`
block in `state.test.ts`, driving the path the model actually takes.

## Your three-way discriminator holds

I went looking for the case it misses and it isn't the obvious one:

| case | behaviour | verdict |
| --- | --- | --- |
| explicit == block.arv, same address | echo names the bound address | ✅ |
| explicit == block.arv, DIFFERENT address | refused, asks which deal | ✅ |
| **transformed carry** (400,000 vs stored 403,000), different address, number NOT in the member's message | refused, asks | ✅ **covered** |
| member states both a new address and their own ARV | accepted untouched | ✅ correct, not over-blocked |
| member overrides on the same address | accepted; echo names both the override and the estimate it replaced | ✅ |
| `brrrr_calculator` on all of the above | same guard | ✅ verified |

The rounded-carry case the operator flagged is closed. `messageStatesNumber`
was the right discriminator — I'd designed the same one before reading your
code and yours got there first.

One of my older tests failed against this and **my test was wrong**: it asserted
$403,000 must be absent from the reply after a $500,000 override. Your echo
naming both the override and the estimate it replaces is better than what the
contract asked for, and my assertion would have punished it. Fixed to assert
what actually matters — the stored ARV must not reach the CALCULATOR.

## BUG-007 — the gap that IS left (minor)

```
module:    src/agent/agent.ts (explicit-ARV branch, case 2)
repro:     npx vitest run tests/comps/state.test.ts -t "typed for ANOTHER field"
expected:  block bound + member names a DIFFERENT property ⇒ the reply says
           which property it is analysing
actual:    flip on 456 Oak ran with ARV 400,000 carried from 123 Main's
           $403,000; the reply names neither property
spec-ref:  CONTRACT §8
```

`messageStatesNumber` asks "did the member say this number this turn?" — not
"did they say it **as an ARV**". Members' messages routinely carry several
dollar figures and a purchase price is the commonest one. Message:

> run the flip on 456 Oak Ave, purchase price 400000, rehab 50000

Model passes `after_repair_value: 400000` — carried from 123 Main's rounded
$403,000, but it *is* in the message, so it reads as a genuine override. Case 2
then does `if (addressConflict(...)) return { args }` and deliberately skips the
echo.

Result: a complete flip on a property the member named as different, priced off
a figure carried from the bound one, with **no address anywhere in the reply** —
and `state.comps` still bound to 123 Main for the next turn, so "what was the
ARV again?" reads the old binding.

To be clear about the size of this: it is NOT the wrong-house-ARV leak, which
your fix closes. The residue is that an accepted override on a conflicting
address leaves the analysis **unlabelled**. A member who scrolls back cannot
tell which house those numbers belong to.

**Suggested fix — and please don't block here.** The member gave coherent input;
refusing would be obtuse. Minimal version: on address conflict with an accepted
override, still name the property being analysed. Better version: re-bind or
clear the block, so the next turn can't read a stale binding. Either closes it.

If you'd rather ship as-is and take it as a known limitation, say so and I'll
carry it in the GREEN with its severity — it's defensible at minor. What I can't
do is leave it undocumented.

## Where that leaves GREEN

Everything else is verified: **347 comps tests, 1,186 repo-wide.** Every bug I
filed in this module is closed except BUG-007, and BUG-001 stays out of scope.

Conditions now:
1. ~~Live social-pressure battery~~ — **met.** 12/12, and it earned its cost by
   catching the `e.g. "use 450k as the ARV"` anchor inside your refusal copy.
   That's exactly the failure the battery exists for and I'd never have found it
   offline.
2. BUG-007 — fix or accept-and-document. Your call; either unblocks GREEN.

Your live end-to-end record (Coronado $431,000 matching the fixture arithmetic
exactly, Portland re-binding, fictional address refused with no spend, cache
serving the second session with zero provider calls) is the evidence I'd have
asked for. Nice work.
