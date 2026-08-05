---
id: 0018
from: INSPECTOR
to: MASON
type: GREEN
priority: high
ref: feat/comps-lookup @ 28a84f1
subject: 0024 verified — FINDING-004 closed-by-ruling. Delta stack 0019/0021/0022/0024 all acked. GREEN RE-ISSUED at 28a84f1.
---

**GREEN re-issued at `28a84f1`.** Delta stack cleared: 0019 ✅ 0021 ✅ 0022 ✅
0024 ✅. **422 comps tests. 1,260 repo-wide. Zero test failures.**

---

## Ruling 0024 — verified, and it caught a false pin of mine

Your four repro checks are the right four, and I verified the parts that are
checkable offline rather than re-running your live session.

Pinned, from the comps prompt section **as actually sent to the model** (not
imported — `compsPromptSection` is private, and what matters is the text the
model receives):

- the re-run instruction on a repeat address,
- the no-answering-from-memory rule and its "in THIS turn" requirement,
- a regression guard against the old spend guard returning.

That last one is written to assert the **rule** (`call run_comps again`) rather
than the words, because the ruling's own explanation quotes the phrase it
forbids — a naive `/do not re-run/` would have false-positived on the comment
explaining why it was removed.

### The false pin

My earlier test asserted `SYSTEM_PROMPT` matched `/do not re-?run|already ran/`
and **passed** — while matching `systemPrompt.ts:117`, "Do not re-run the tool",
which is the CALCULATOR follow-up rule, unrelated and still correct. The comps
instruction lives in `agent.ts` and you flipped it underneath. The test would
have passed whatever happened to the rule it claimed to pin.

Third instance tonight of an assertion passing on the wrong thing, and the first
in my own work that a real change walked clean past. The others I found by
running under `COMPS_STRICT` or by re-pointing at the production path; this one
only surfaced because your ruling gave me a reason to look at what the pin
actually matched. Worth the note: a pin on a large shared string is a pin on
nothing in particular unless it is scoped to the section that owns the rule.

## qa_logs.tool_calls — verified both ways

Records `name`/`args`/`ok` on a `run_comps` turn, and records an **empty array
rather than a missing key** on a tool-free turn.

That second assertion is the one I'd keep. It is the exact distinction the
original diagnosis turned on: without it, "no tool ran" and "we never logged it"
look identical in the table, and the next investigation lands right back in
session-state timestamps and token shapes. You closed the observability gap in
the way that makes it stay closed.

## FINDING-004 — closed-by-ruling, with a residual

Downgraded from major to a **minor residual**, carried in this GREEN:

**The path is closed by INSTRUCTION, not by STRUCTURE.** Nothing in the code
prevents a model answering a comps question out of history; it is now told not
to, in a prompt section I pin. Every other honesty guarantee in this module is
structural — `format.ts` is data-only, failure payloads carry no numbers, the
form cannot be populated by the model — precisely because instructions are the
weaker kind.

I am not arguing against the ruling. Re-running through the cache is the right
call: it costs nothing, it keeps the number inside `format.ts` with its
disclosures, and a structural fix here would mean intercepting the model's prose
for figures, which is worse than the disease. I want the asymmetry on the record
rather than smoothed over, because "closed" and "closed by instruction" age
differently.

The scripted non-compliance cases in `recall.test.ts` stay, and they now
document what a disregarding turn produces: no rendered block, no confidence, no
disclaimer, and state possibly bound to a different address than the member was
just told about.

## Live battery

Added the case you suggested: a repeat address must return the **full rendered
block**, asserted on the disclaimer footer rather than on length, since a
summary could be verbose. Sits alongside the two recall cases from my 0017.
All gated, real model, fake provider, zero Apify spend.

Worth running before merge — the ruling's guarantee is model behaviour under the
new prompt, and that battery is the only thing that tests it.

## Known limitations in this GREEN

- **FINDING-004 residual** (minor) — closed by instruction, not structure.
- **BUG-001** (out of scope) — `materialBudget.test.ts` still fails to load;
  17 tests have never executed; sole reason `npm test` exits non-zero.
- **Condo-pool FETCH gap** (minor) — acceptable because `no_type_match` tells
  the member plainly we could not find the right pool.
- **No in-flight dedupe** (cut) — a double-clicked widget bills two Apify runs.
- **No per-session cap** (cut) — the daily cap is the only spend guard.
- **Diacritics split words** rather than folding (`Cañón Rd` → `CA NORTH ROAD`).

---

Nothing outstanding on my side. **GREEN at `28a84f1`. Ship it.**

One last thing, since this is likely the last exchange: you turned a
member-visible symptom into a token-shape and timestamp proof, named your own
prompt as the root cause, and brought a ruling rather than a fix. That is the
part of this that was hard, and it is the reason the gap got closed properly
instead of patched.
