---
id: 0001
from: MASON
to: INSPECTOR
type: HANDOFF
priority: high
ref: feat/comps-lookup @ e046790
subject: CONTRACT.md is written — start test authoring from it now
---

`.agents/CONTRACT.md` is complete and is the binding spec. Nothing is
implemented yet — you are not waiting on my code, and that's deliberate: write
tests from the contract, not from what I happen to ship.

What the contract pins down (§ refs are CONTRACT.md's):

- **Exported pure-function signatures** you can import directly — §4. Every
  decision function takes `now: Date` as a parameter; nothing pure touches the
  clock, so all of it is deterministic under test.
- **Full config table with defaults** — §3. All in
  `src/features/comps/config.ts` as named exports. A hardcoded threshold
  anywhere else is a valid bug.
- **Algorithm** — §5, including the exact suffix map, filter order with
  first-match reject reasons, tie-breaks (distance asc, then zpid asc), median
  definition, `DAYS_PER_MONTH = 30.44`, sample (n−1) std dev with the
  `trimmed.length < 2 ⇒ sd = 0` edge, and rounding to nearest $1,000.
- **Failure codes** — §10; all six end by offering manual ARV entry, none carry
  a number.
- **Tool schemas** — §9.
- **Conversation state keys + pre-fill semantics** — §8. Note: the repo has NO
  structured session state today (memory is a plain transcript); the
  `session_state` table is new, and explicit ARV in a tool call always beats the
  pre-fill.

Operational facts you need:

- **APIFY_TOKEN is not available yet.** I'm building everything against
  `providers/stub.ts` + hand-written fixtures (§12 lists the starter set and
  their shapes). Real recorded payloads will land in `__fixtures__/` later —
  I'll message before touching any fixture you already reference.
- Implementation order (each slice gets its own message): 1) `types` +
  `config` + `normalize`, 2) `filter` + `rank` + `arv`, 3) `format` +
  `service` + stub provider, 4) cache + migration, 5) tools + agent wiring +
  state pre-fill. Slice 1 starts now.
- Ports: I'm on 3000 (a dev server of mine is already bound there), you're on
  3001.
- If you need a dependency installed, ask — you can't install, I'll add it.

Deliberately left out (don't test for): comp photos, map tiles, rental comps,
MLS, any UI beyond the rendered chat block.

Suggested early targets while I build slice 1: normalization idempotence and
the suffix map's whole-word rule (`"N MAIN ST"` vs `"NORTH MAIN STREET"` same
key; `"STONE ST"` must not become `"STONE STREET"` twice), trimmed-mean edges
(n=3,4,5,7,8), confidence boundaries at exactly cv=0.15/0.25, and filter reason
ordering (a comp failing multiple rules reports the FIRST per §5.3's order).
