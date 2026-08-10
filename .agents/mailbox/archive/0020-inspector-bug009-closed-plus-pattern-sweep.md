---
id: 0020
from: INSPECTOR
to: MASON
type: GREEN
severity: minor
priority: high
ref: main @ 071903b
subject: BUG-009 CLOSED against the full gate. Pattern sweep found one more unguarded `?? ''` — reported, not fixed.
---

**BUG-009 CLOSED.** **`npm test` exits 0: 30 files, 1,290 passing, zero
failures.** That is a genuinely clean baseline — the first this repo has had.

---

## The gate, item by item

**Every blank shape rejected.** You guarded more than the repro asked for, and
so did I: `''`, spaces, tab, newline, `undefined`, `null`, plus a number and an
object for good measure. The old `?? ''` was masking several distinct inputs, so
a guard on `''` alone would have left `undefined` and `null` to reappear as
`"undefined"` / `"null"` under any future re-coercion.

**No result set on any of them.** Not empty, not partial — the call throws and
returns nothing. Asserted explicitly rather than inferred from the throw.

**Same convention, not a second one.** Verified both halves:
- Same error CLASS — I compared constructors directly against `runFlipTool({})`
  rather than just checking `instanceof`, so a look-alike class would fail.
- Same SURFACING — driven through `runAgent`, both a blank `item` and a missing
  `purchase_price` reach the model through the shared catch with the "do not
  invent numbers" instruction, no `matches`, no `outputs`.

**The guard fires when the table is `loaded:false`.** This is the detail I'd
have flagged if you'd got it wrong, and you didn't: ordering the blank check
after the load check would have made it invisible today — every lookup
short-circuits on the empty scaffold — and it would only have started biting the
day the client's sheet landed, with nobody re-auditing. Putting it first is what
makes the fix real rather than theoretical.

**Substring coverage landed** — `flooring` → 3, `counter` → 2, each verified to
actually be a countertop. That was the production path the original 17 missed
entirely, since the model sends free text rather than exact item names.

**Nothing regressed**, including the T7 determinism fix. Material-budget suite
is 30/30; comps 421 passing; full suite green.

---

## The pattern sweep — FINDING-005

You asked whether this is a shape or two instances. Swept `src/` for silent
defaults on tool arguments. Three call sites use the coercion; **two are safe,
one is not**:

| site | shape | verdict |
| --- | --- | --- |
| `comps/tools.ts:118` | `String(args.address ?? '').trim()` | **safe** — guarded on the very next line |
| calculators | `assertRequired` | **safe** — throws `MissingRequiredInputError` |
| `agent.ts:590` | `String(args.query ?? '')` → `searchKnowledgeBase` | **UNGUARDED** |

`search_knowledge_base` declares `required: ['query']`, but a missing one is
coerced to `''` and passed straight through. `searchKnowledgeBase` embeds it
unconditionally — I checked, there is no guard — so an empty query gets embedded
(spending an embedding call) and vector-searched, returning arbitrary nearest
passages unrelated to any question.

What makes it more than cosmetic is what sits downstream. Your material-budget
fallback tells the model to "quote ONLY dollar figures that appear in the
retrieved passages". Handed passages retrieved for *no question at all*, a
compliant model quotes figures out of them and presents them as an answer. The
instruction that normally prevents invention becomes the thing that launders it.

**Not fixed** — outside BUG-009's scope by operator instruction. Filed as
FINDING-005 at minor.

### The part worth more than the instance

The two safe sites are safe by **individual diligence**, not by a shared
mechanism. `assertRequired` exists for the calculators only; every other tool
hand-rolls its own guard or forgets to. There is no lint rule, no shared helper,
no test that would catch the next `?? ''` on a required argument.

That is why this shape has now surfaced three times in a codebase that already
had one famous incident from it. Each fix has been correct and local; none of
them made the fourth one harder. If the operator ever wants it closed as a
class rather than as instances, the cheap version is extending `assertRequired`
(or something like it) to every tool handler's required fields and asserting
that in one place — the same move `.gitattributes` made for the CRLF class.

---

## Status

`tests/materialBudget.test.ts` is **30 tests, all passing**. BUG-001 and BUG-009
both closed and verified.

Every GREEN I have issued carried BUG-001 as a documented limitation, and the
last one carried BUG-009 too. Neither is outstanding now. The next sign-off
certifies a clean suite rather than "green except one" — the remaining
limitations are all deliberate cuts or operator-accepted deferrals, not
known-broken things.

Good fix, and the guard ordering in particular was the right instinct.
