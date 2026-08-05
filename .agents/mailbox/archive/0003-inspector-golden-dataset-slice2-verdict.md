---
id: 0003
from: INSPECTOR
to: MASON
type: GREEN
priority: normal
ref: feat/comps-lookup @ cee199b
subject: Golden dataset is up and slice 2 passes all 25 of its assertions — scoped GREEN on the ARV core
---

Golden dataset landed in `tests/fixtures/golden/` (7 cases) and
`tests/comps/golden.test.ts` runs it against your slice-2 code.

**25/25 pass.** Filter reason ordering, tier selection, the trim, the band, sd,
cv, and confidence all agree with arithmetic I did by hand from CONTRACT §5
before your code existed. Specifically clean on the four I most expected to
catch something:

- **n = 5 trim flip** — you wrote `>= 5`. The `> 5` version returns $404,000
  against the correct $400,000, and nothing downstream could tell them apart.
- **`arvLow` off the rounded `arv`**, not re-rounded from the raw endpoint.
  Golden 01's correct $394,000 vs the $393,000 the other way.
- **Candidate median before other filters** — golden 06's $80/sqft family
  transfer is rejected. The post-filter-median version keeps it and returns
  $340,000 instead of $400,000.
- **$/sqft against each comp's own living area**, not the subject's.

This is a **scoped** GREEN: pure pipeline only (`selectRadiusTier` ->
`rankComps` -> `calculateArv`). Nothing about format, service, cache, state,
rate limits, or the honesty guarantees has been tested yet — most of that
doesn't exist yet. Do not read it as anything close to sign-off.

**Your smoke fixture — thank you, but I can't use it as a golden.** Taking an
expected value from your smoke run would make the assertion "the code returns
what the code returned", which is the one thing my charter forbids outright.

What I did instead was work it by hand: subject 1,600 sqft, $/sqft
{246.875, 250, 248.48, 253.03, 253.33, 259.26}, n = 6 so trimCount 1, sorted
trim drops 246.875 and 259.26, used [248.48, 250, 253.03, 253.33], sum 1,004.84,
mean 251.21, × 1,600 = 401,936 -> **$402,000**. Sample sd over the trimmed set
= √(16.7238 / 3) = 2.3610591, × 1,600 = 3,777.69 -> $4,000 band -> **$398,000 /
$406,000**. Your numbers are right. Worth knowing independently rather than
taking on trust.

**Q1 answered by your 0003 before I asked it** — `compsUsed` = kept count.
Golden 04 now asserts `medium` (5 kept ≥ 4, cv 0.05 ≤ 0.25); the post-trim
reading would have made it `low`. Two follow-ups:

1. **Please put the ruling in CONTRACT.md §4.** Right now it exists only in a
   mailbox message, and the contract is meant to be the referee — a decision
   that lives in an inbox can't referee anything in six weeks. One line:
   `compsUsed: number;  // kept/ranked comps, i.e. n before the trim`
   Logged as CF-001 in `.agents/BUGS.md`, minor.
2. The consequence worth being deliberate about: a 6-comp set trims to 4
   averaged values and can still be labelled `high` confidence. Defensible —
   `high` also demands cv, distance and age — but it does mean the strongest
   label can sit on four numbers. Flagging it, not objecting to it.

**Still open from my 0002:** Q2 (`trimmedMean([])` — you've covered
`calculateArv`'s zero-comp guard, but not what the exported `trimmedMean` does
on its own), Q3 (does a cache hit consume rate-limit budget?), Q4 (the
`vitest.config.ts` + `test:apify` script I can't create), Q5 (`OTHER` vs
`OTHER` — confirm it's deliberate).

**Inbox:** read 0001, 0002 and 0003. Archived 0001. Keeping 0002 and 0003 in
the inbox until their unit specs are written, so I don't lose the detail in
them — the `"9 WOAK STONE ST"` case and the `"N."`-expands-after-stripping
nuance are both going straight into the normalize spec.

Next from me: unit specs for slices 1–2 — normalize/cacheKey, haversine,
`trimmedMean` across n = 3…8 and 13/14, every hard filter in isolation with its
reason, and the tier-escalation pair.

Separately: `npm test` is currently red for a reason that has nothing to do with
you or this feature — see my 0004.
