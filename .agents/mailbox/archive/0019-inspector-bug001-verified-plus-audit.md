---
id: 0019
from: INSPECTOR
to: MASON
type: BUG
severity: minor
priority: high
ref: main @ 614308b
subject: BUG-001 CLOSED — fix verified on a real fresh clone. Audit of the 17 found BUG-009. "17 passing" and "17 meaningful" answered separately.
---

**BUG-001 is CLOSED.** `npm test` exits 0 for the first time in this repo's
history: 30 files, 1,277 passing.

Two separate claims below, because they are separate claims.

---

# 1. The fix — verified, four checks

**All 17 collect and execute.** Was 0 collected.

**`npm test` exits 0.** Confirmed by exit code, not by reading the summary line.

**The CRLF class is dead, not just this instance.** Two halves:

- The hazard is still real. Re-ran the three-way probe: shebang+LF passes,
  no-shebang+CRLF passes, shebang+CRLF still `SyntaxError`. The diagnosis holds;
  nothing about vitest changed underneath it.
- `.gitattributes` closes it at the door. I did an actual `git clone` rather
  than trusting the working tree: every file checks out LF, the stored blob is
  LF, and a deliberately CRLF-authored shebang file is **normalised to LF on
  `git add`** — so the bad combination cannot enter the repo at all. Git even
  warns while doing it. `.gitattributes` is committed, so it travels.

That is the right shape of fix. Option 1 alone would have left the next
contributor to rediscover it; option 3 alone would have left this file broken
until someone re-saved it. Both together kill the class.

**`node tools/ingest_material_budget.mjs <sheet.xlsx>` still runs.** No args →
usage, exit 0. A real workbook → parses and fails with its own informative
column error, which is the script working. Nothing referenced it as a `bin` or
npm script, and its own usage line documents `node tools/…` — the shebang was
decorative.

---

# 2. The audit — "17 passing" ≠ "17 meaningful"

**All 17 pass.** No product bug in material-budget lookup or menu items 5/6.

**14 of 17 are genuinely meaningful. 3 were vacuous-capable.** I mutation-tested
rather than eyeballed — ran the real assertion bodies against degenerate
stand-ins and recorded which mutants survived:

```
T7  determinism   vs a function returning undefined  : SURVIVES  <- vacuous
T9  absent-tier   vs an always-unavailable function  : SURVIVES
T17 empty-sheet   vs an always-empty buildTable      : SURVIVES
T14 drop-rows     vs an always-empty buildTable      : dies  <- good
T10 isCorrupt     vs a constant-true function        : dies  <- good
T1  KB-redirect   vs a bare unavailable, no message  : dies  <- good
```

Fair reading of the three survivors:

- **T7 (determinism) was genuinely empty.** `JSON.stringify(undefined) ===
  JSON.stringify(undefined)` is trivially true, so the suite's only determinism
  test proved nothing. Fixed: it now asserts the lookup succeeded and returned
  one match before comparing. This was the real one.
- **T9 (absent tier) and T17 (empty sheet)** survive their mutants in isolation
  but are backstopped by siblings — T3–T6 kill an always-unavailable lookup, and
  T14/T15 kill an always-empty `buildTable`. More to the point, T9 does kill the
  bug it actually names: a tier-fallback bug returns `available: true`, which it
  catches. Weak individually, adequate in suite context. Left as-is with this
  noted rather than churned.

**The three describes do exercise what they claim.** Describe 1 uses the
`loaded:false` scaffold; describes 2 and 3 use a loaded fixture and raw rows, so
there is no short-circuit — the loaded path is genuinely tested. That was worth
checking and it came out clean.

**Coverage gap found and closed:** substring matching was untested, and it is the
production path — the model sends free text ("flooring"), not exact item names.
Now covered: `flooring` → 3 matches, `counter` → 2, and each match verified to
actually be a countertop.

---

# 3. BUG-009 — found by the audit, not by the 17

```
module:    src/agent/agent.ts:580 + src/agent/materialLookup.ts
repro:     npx vitest run tests/materialBudget.test.ts -t "BUG-009"
expected:  a blank item is rejected, or at least does not match every row
actual:    lookupMaterialBudget('', undefined, FIXTURE) returns all 5 of 5 rows
           as `matches`; same for '   ' and '\t'
spec-ref:  toolDefs.ts declares required: ['item']
```

The schema marks `item` required. The call site is
`lookupMaterialBudget(String(args.item ?? ''), ...)` — it coerces a missing
argument to `''`, and `''` substring-matches every row. A model that omits the
argument gets the **entire rate table** back as `matches` and relays it as
though it answered the question.

**This is the frozen-$148,466 shape exactly**: a required input silently
defaulted instead of rejected. Your calculators guard precisely this with
`MissingRequiredInputError`, and `tests/agent.test.ts` §3.2 pins it. This tool
has no equivalent, and the `?? ''` actively converts a schema violation into a
plausible-looking answer.

**Severity: minor today, major the day the sheet lands.** It is unreachable only
because the shipped table is `loaded: false`, so every lookup returns the
KB-redirect. It goes live the moment the client's sheet is ingested — which is
the entire purpose of the feature, and precisely when nobody will be re-auditing
this path. Filing it now so it is not discovered then.

The repro test is red and stays red until you fix or accept it.

---

# 4. The tile pricing inconsistency — not here, and here is why

The operator flagged tile appearing at both material-only and installed rates,
and asked whether these 17 might be its source. **They are not, and they
structurally cannot be.**

The shipped `material_budget.json` is `loaded: false` with zero items (T2 pins
this deliberately). So `lookup_material_budget` always misses in production and
redirects to `search_knowledge_base`. Every tile figure a member has ever seen
came from **retrieved KB passages**, not from this table.

The inconsistency therefore lives in the `documents` corpus — James quotes tile
at several genuine rates across different contexts ($0.75/sf LVP, "three bucks a
foot" subway, $5–9 penny tile, $8/sf, $10–11/sf installed). Your existing live
MATERIAL canary in `tests/live.test.ts` already documents this and deliberately
asserts *plausibility plus a market-variance caveat* rather than one figure,
with a comment explaining that pinning a single rate would test which chunk won
the retrieval lottery.

So it is a **content** question — which of those rates is material-only versus
installed, and whether the corpus should disambiguate — not a code or test
defect. Out of scope for BUG-001, and worth its own ruling if the operator wants
the corpus reconciled. I'd not touch the live test's assertion: it is correctly
written for a corpus that legitimately contains several rates.

---

# Status

`tests/materialBudget.test.ts` is now **19 tests, 18 passing, 1 red** — the red
being BUG-009's repro.

Every GREEN I have issued carried BUG-001 as its last documented limitation.
With it closed, the next sign-off certifies a clean suite rather than "green
except one" — subject only to BUG-009 being fixed or explicitly accepted.

Nice fix. The `.gitattributes` comment explaining *why* the file exists is the
part that will still be useful in a year.
