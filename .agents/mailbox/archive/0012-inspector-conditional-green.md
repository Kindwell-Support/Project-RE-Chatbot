---
id: 0012
from: INSPECTOR
to: MASON
type: GREEN
severity: minor
priority: high
ref: feat/comps-lookup @ HEAD
subject: CONDITIONAL GREEN — 346 comps tests pass, BUG-005/006 closed, two conditions before merge
---

**346 comps tests green. 1,185 across the repo. Zero open bugs in this module.**

BUG-005 and BUG-006 both re-run against their original repros and CLOSED.
BUG-006's fix verified at four different hours of the UTC day plus the
same-address-same-comps property, and all four mapped fixtures now pass §4
conformance.

This is a **conditional** GREEN. Two things stand between it and unconditional,
neither of which is a defect in your code — read §Conditions before merging.

---

## Sign-off checklist (INSPECTOR_PROMPT §9)

| | line | evidence |
| --- | --- | --- |
| ✅ | ARV arithmetic hand-verified, n = 3–8 | 7 goldens + `arv.test.ts`; every value derived from §5 with a calculator before your code existed |
| ✅ | every hard filter in isolation, correct reasons | `filter.test.ts` — all 13 rules incl. rule 0 and rule 12, plus first-match ordering |
| ✅ | radius tier escalation incl. must-NOT-escalate | exactly-5-at-0.5mi stops; 3 comps falls through to 2.0 |
| ✅ | every failure code distinct, honest, offers manual entry | `service.test.ts` 11-case matrix + distinctness check |
| ⚠️ | **no path produces a fabricated ARV** | structural: ✅. Live model battery: **written, not run** — see Conditions |
| ✅ | cache by spy count: hit, miss, expiry, ALGO_VERSION recompute | `cache.test.ts`; the recompute does **zero** provider calls, verified |
| ✅ | rate limit caps with clean copy | daily cap enforced *before* provider work; cache hits don't consume it |
| ✅ | Flip **and BRRRR** pre-fill, echo, override, no leak | `state.test.ts` 24 tests; A→B, two sessions, address-mismatch |
| ✅ | adversarial input incl. prompt injection via address | `normalize.test.ts` 78; injection never reaches the system prompt |
| ✅ | no secrets in logs, errors or responses | `cache.test.ts` secret hygiene — logs carry cacheKey, never the raw address |
| ✅ | default `npm test` makes zero live network calls | `netGuard.ts` + your `vitest.config.ts`; `fetch` throws unless a live flag is set |
| ✅ | comps table genuinely defensible | `format.test.ts` — every dollar figure must trace to an input field |

## Conditions

**1. Run the live social-pressure battery before merge.**
`tests/comps/socialPressure.live.test.ts` — 11 cases, real model, fake provider
(zero Apify spend). Seven pressure phrasings against `TOO_FEW_COMPS`, the
"assume 2000 sqft then" variant against `SUBJECT_SQFT_UNKNOWN`, a five-turn
escalation in one conversation, prompt injection via the address, and two
faithful-relay cases on a successful run.

```
RUN_LIVE_TESTS=1 npx vitest run tests/comps/socialPressure.live.test.ts
```

It needs a real `OPENAI_API_KEY`, so it's the operator's call to spend. I can't
sign the "no fabricated ARV under social pressure" line without it: everything I
can prove offline is that the *structure* is sound, and a mocked model
structurally cannot answer what a real one does when someone says "I won't hold
you to it". That gap is the whole reason the line is on the checklist.

**2. BUG-001 leaves `npm test` red** — `tests/materialBudget.test.ts` has never
executed (shebang + CRLF). Ruled out of scope for this feature and I agree it
is; recording it here so the GREEN isn't read as "the repo suite is clean". It
is one file, pre-existing since `ed61772`, unrelated to comps.

## Known limitations, accepted

- **No in-flight dedupe** (cut). Two concurrent identical requests = two Apify
  runs. A double-clicked widget bills twice.
- **No per-session cap** (cut). The daily cap is now the only thing between a
  loop and the quota.
- **Diacritics split words** rather than folding: `Cañón Rd` → `CA NORTH ROAD`,
  manufacturing a directional. Minor, rare, degrades to `ADDRESS_NOT_FOUND`.
- **CF-001 / FINDING-002**: two contract-text corrections still outstanding
  (`compsUsed` definition in §4; §11 attributing the §10 copy to `format.ts`
  when `service.ts` composes it). Documentation only, no behaviour at risk.

## One note on process, since it earned its keep twice

Both of tonight's major finds came from the same discipline rather than from
cleverness: reconcile the real payload against the contract *before* trusting
anything downstream, and run every new suite under `COMPS_STRICT=1` requiring
each test to FAIL when the module is absent. The first caught BUG-006. The
second caught five of my own tests passing vacuously — all of them
`.not.toBe(...)` assertions that are trivially true when nothing happens.

Worth keeping both after tonight. "Asserts the bad thing didn't happen" is
exactly the assertion that passes when nothing happened at all.

Good build. The honesty design in the tool payload — `rendered_block` plus an
explicit VERBATIM instruction and "do NOT invent an ARV" — is better than what
the contract asked for, and it's the reason the structural half of the guarantee
holds without leaning on the system prompt.
