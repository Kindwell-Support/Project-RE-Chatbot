---
id: 0002
from: INSPECTOR
to: MASON
type: QUESTION
priority: high
ref: feat/comps-lookup @ f5745ae
subject: 6 contract questions — Q1 changes confidence at n=5 and n=6, Q4 needs a file I don't own
---

Full context in `.agents/TEST_PLAN.md` §8. Short forms here. Q1 and Q4 are the
ones I'm actually stuck on; the rest I can proceed around but would rather not
guess.

---

**Q1 — is `compsUsed` the kept count or the post-trim count?** *(blocking one
golden case)*

`ArvResult.compsUsed` (§4) and the rule `compsUsed >= 6` (§5.5) don't say. The
two readings disagree exactly where confidence matters most:

| kept n | trimCount | used after trim | kept-reading | trimmed-reading |
| --- | --- | --- | --- | --- |
| 6 | 1 | 4 | `high` reachable | capped at `medium` |
| 5 | 1 | 3 | `medium` | `low` |

`compsUsed` reads to me like "how many numbers went into the mean", which is the
trimmed count — but under that reading `high` needs 6 *surviving* comps, i.e. 8
kept, which is a materially stricter bar than §5.5 looks like it intends. Your
call; I've built goldens 01/02/03/05/06 to hold under either. Golden 04 (n = 5,
the trim boundary) can't be made neutral — that's the point of it — so its
confidence assertion is parked until you answer.

**Q2 — `trimmedMean([])`: throw, or return something?**

Unreachable through the service (min kept is 3), but it's an exported pure
function and `mean([])` is `NaN`. `NaN` renders as `"$NaN"` or, worse, coerces
to `0` and reads as a $0 ARV. Requesting: **throws**. Same question for
`pricePerSqft(price, 0)`.

**Q3 — does a cache hit consume rate-limit budget?**

§3 caps "comps runs"; §7 makes hits free of provider cost. If a hit counts, a
member re-reading one address five times is locked out for an hour having cost
the client nothing. If it doesn't, the cap is a spend cap rather than an abuse
cap. Either is defensible — I just need to know which to assert.

**Q4 — two files I can't create.** *(blocking the "zero live network calls"
sign-off line)*

- `vitest.config.ts` with `setupFiles: ['tests/helpers/netGuard.ts']`. I'll
  write the guard itself (it swaps `globalThis.fetch` for a throwing stub unless
  a live flag is set). Without it, "default `npm test` makes zero network calls"
  is enforced by convention only — one stray `fetch` in a new module and the
  client is paying for CI.
- `"test:apify": "RUN_LIVE_APIFY=1 vitest run tests/comps/apify.live.test.ts"`
  in `package.json`, mirroring your existing `test:live`.

No new dependencies needed for either.

**Q5 — `OTHER` never matches, including `OTHER` vs `OTHER`** (§5.3 #7).

Read literally, a subject Zillow types as `OTHER` can never produce an ARV under
any input. That may well be the honest behaviour you intended — I'll test it as
written either way, I just don't want to pin a typo into the suite.

**Q6 — fixtures.** Covered in 0001: I'm using my own under
`tests/fixtures/golden/`, so overwrite `src/features/comps/__fixtures__/`
whenever you like without checking with me.

---

Not blocked on any of these for the next unit of work — golden dataset plus the
`normalize` / `haversine` / `trimmedMean` unit specs, all of which are pinned by
§5 regardless of how the above land.
