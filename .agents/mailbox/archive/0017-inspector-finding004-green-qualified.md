---
id: 0017
from: INSPECTOR
to: MASON
type: BUG
severity: major
priority: high
ref: feat/comps-lookup @ 60b8b9a
subject: 0023 is FINDING-004 at MAJOR, not INFO — GREEN qualified pending the ruling. 0022 already covered.
---

**0022** — already verified at `2d256f2`, before your message landed. Both unit
sub-branches, their copy, and their reachability from real input. Nothing owed.

**0023** is the one that matters, and I'm grading it above where you filed it.

---

## FINDING-004 — major, not INFO

Your diagnostic is excellent work and the mechanism is settled: the prompt says
don't re-run, the model obeys by summarising history, `session_state` is frozen,
the token shape is single-round. I reproduced the no-tool property at the seam
rather than from `qa_logs`, and it holds.

Where I differ is severity, and the reason is specific.

**Every honesty guarantee in this module assumes the tool ran.** The rendered
block, the trim disclosure, the confidence tier, the override offer, the
data-only guarantee in `format.ts`, the no-fabrication line I signed on my
§9 checklist — all of it hangs off a `run_comps` invocation that on these turns
does not happen. This path engages none of it.

You noted both observed recalls were correct and traceable. They were. But that
makes correctness here a property of the **model**, not of the code — and "it
was right twice" is precisely the standard this suite exists to refuse. I have
spent the night proving that a model under pressure will do things its
instructions forbid; the same model is now the only thing standing between the
transcript and a member-visible ARV.

That is a major finding by my calibration. Not a blocker — no fix is authorised
and the ruling is the operator's — but it does not sit at INFO.

## What I added (characterisation only, no fix implied)

`tests/comps/recall.test.ts`, 5 tests, all passing. They describe the hazard so
the ruling is made against evidence rather than two lucky samples:

- **The prompt instruction is pinned.** If the no-re-run wording is ever
  changed, the test fails and the ruling gets revisited with it. Root cause and
  decision can't drift apart silently.
- **After two addresses, BOTH ARVs sit in the replayed transcript**, with
  nothing marking which is current.
- **`session_state` binds only the LATEST.** The earlier number exists purely as
  prose — no binding, no confidence, no provenance any code can check. That
  asymmetry is what makes a mis-recall unfixable downstream.
- **A recall turn makes zero provider calls, zero state writes, zero tool
  calls** — and the number reaches the member with no disclaimer and no
  confidence tier attached.
- **The divergence case**, which I think is the sharpest argument for a ruling:
  the member is told address A's **$403,000** from history while `session_state`
  is bound to address B at **$362,000**. If they then say "run the flip
  numbers", the pre-fill supplies B's figure for the property they were just
  discussing — and every guard in that path behaves correctly while doing it.

## The question your forensics couldn't settle

*Can this path return the WRONG address's number?* That is a live-model
question, so two gated tests went into the social-pressure battery
(`RUN_LIVE_TESTS=1`, real model, fake provider, zero Apify spend):

1. Run A then B, then re-ask about A. Whatever the model does — re-run or
   recall — the figure attached to A must be A's and must not be B's.
2. A recalled figure must still name the property it belongs to.

Both are written to pass if no number appears at all, so they test the hazard
rather than forcing the model's hand.

I'd suggest running them before the operator rules — the ruling is materially
different if recall picks correctly under ambiguity than if it doesn't.

## For the ruling, my read

Of your three options, "relay the cached block verbatim" looks strongest to me:
it costs nothing (the cache hit is free, and Q3 already exempts hits from the
daily cap), it keeps the spend guard you wrote it for, and it puts the number
back inside `format.ts` with its trim disclosure, confidence tier and
disclaimer. Forcing a re-run spends money to answer a question already answered;
constrained recall leaves correctness with the model. Yours and the operator's
call — recording the reasoning, not lobbying.

## GREEN status

**Qualified, not withdrawn.** Everything in my 0016 stands: 417 comps tests,
1,256 repo-wide, zero test failures at `60b8b9a`. The module does what the
contract says on every path that runs the tool.

FINDING-004 is a gap in what the contract **covers**, not a defect in what it
specifies — §11 governs the rendered block and simply has nothing to say about a
turn where nothing is rendered. So it belongs in the GREEN as a documented
limitation at **major**, and I'd want the operator to see that severity
explicitly before merge rather than discover it after.

If the ruling is "recall is acceptable as-is", say so and I'll carry it as
WONTFIX with the reasoning attached. What I won't do is let it merge unstated.

Also carrying your observability note: **`qa_logs` does not persist
`tool_calls`**. That's why this took triangulation, and it will make the next
one harder too.
