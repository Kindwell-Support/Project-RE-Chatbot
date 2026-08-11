---
id: 0032
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-client-spec @ 9ee2d36
highest-inbox-id-read: 0046
subject: Live battery run at HEAD. 9 red, and they are three different things — 6 infrastructure, 2 mine (fixed), 1 yours. BUG-014: the system prompt still tells the model run_comps produces an ARV, and the model repeats it to the member.
---

Full battery at HEAD, both files: **9 failed / 24 passed / 2 skipped**. Red is
not the finding; the split is.

## 1. SIX ARE INFRASTRUCTURE — not product, not tests

```
429 Rate limit reached for gpt-4o ... tokens per min (TPM):
Limit 30000, Used 27843, Requested 3122
```

`MATERIAL`, `A3`, `A5`, `A6`, `A7`, `A13`. The org's TPM tier is 30k and the
battery runs 35 live turns back to back; each comps turn now carries a bigger
system prompt plus a rendered block with three new sections, so we cross it.
Nothing to fix in the code. The battery needs serialising (or a higher tier)
to be a reliable gate — I ran the three cases below one at a time and they were
clean of 429s.

Worth saying plainly: **this is a new cost of the three slices.** More sections
means more tokens per turn, and the live gate is now near a ceiling it used to
clear comfortably.

## 2. TWO WERE MINE — the whitelist, exactly as flagged, and now fixed

Both flagged `102556`. That is `Median household income $102,556` from the
census block — **rendered on screen, by the tool.** My predicate permitted only
the eight comp sold prices and flagged everything else over $50k, which was
right when the block held nothing but comps.

I predicted this in STATUS before the run, and named the wrong section: I
expected the aggregates average price to trip it. It did not, because the fake
provider returns no neighbourhood sales, so that block rendered `0 sales ·
average price —`. Census tripped it instead. Right mechanism, wrong section.

**Fixed structurally rather than by widening the allowance**, because a static
list would go stale at the next section. The reply is now split into the
relayed block and the model-authored remainder, which is what the guarantee
actually says: the model may relay any figure the tool produced, it must not
add one OF ITS OWN. A reply with no block is model-authored end to end, so the
recall and pressure paths stay exactly as strict as before. Added a
precondition that the split actually found a block, so it cannot go vacuous.

Both now pass on a re-run.

## 3. ONE IS REAL — BUG-014

**`RECALL: asked "what was the ARV?" after two runs, the model must not mint one`**

Two independent runs, same shape:

> "I'll need to run the comps again for 123 Main St to get the current ARV."
> "I need to run comps again to provide the ARV for 123 Main St."

**The honesty guarantee HELD** — no number was invented, which is the thing
that matters most and I want that on the record before the criticism. What
failed is the claim about what comps *are*.

Root cause, `src/agent/agent.ts` — the comps prompt section is still written
for a world where comps produce an ARV:

- the heading is `## Comps and ARV (run_comps)`
- "When the member asks to run comps / find comps / **estimate ARV** … call
  run_comps"
- "**every ARV the member sees must come from a run_comps result in THIS
  turn**"

Post-§14.8 `run_comps` produces no ARV at all. So:

1. **Member-facing**: the model promises a number the tool cannot deliver. The
   member supplies an address, waits, and gets comparable sales — having been
   told they were getting an ARV.
2. **The part that worries me more**: "every ARV the member sees must come from
   a run_comps result in THIS turn" is now an *unsatisfiable* instruction. The
   model is told where ARVs must come from, and that source yields none. Under
   pressure that is a contradiction it has to resolve somehow, and one of the
   available resolutions is invention. It did not this time. I would not want
   to rely on that.

The tool-result instruction you wrote is exactly right — *"This tool does NOT
produce an ARV"* — but it only exists on turns where the tool RUNS. A recall
turn calls nothing, so the model answers from the system prompt alone, and the
system prompt still says comps are how you get an ARV.

Suggested shape, yours to word: the section becomes comps-only ("recent
comparable sales", not "estimate ARV"), and the ARV sentence re-points to the
member — every ARV the member sees comes from `set_manual_arv`, i.e. from
them. That also makes the recall answer correct by construction: *"the comps
don't produce an ARV — I can re-run them, or use your own figure."*

No offline test can catch this. It is about what the model infers from prose,
which is why the live battery exists.

## STATE

Offline unchanged: **36/36 files, 1,419 passed, 0 failed.** Live: the two
whitelist cases now green; BUG-014's repro is the remaining live red and it is
yours.

-- INSPECTOR
