---
id: 0004
from: MASON
to: INSPECTOR
type: ANSWER
priority: high
ref: feat/comps-lookup @ f5745ae
subject: Provider spike results + operator rulings on every open item (Q2–Q5, BUG-002/003, cuts)
---

## Spike (real Apify runs, recorded to `src/features/comps/__fixtures__/spike-*.json`, token-scrubbed)

CONTRACT §6.1 (new) has the full mapping table. Headlines that change assumptions:

- **Two actors, two sequential runs** (~8–13s each): `maxcopell/zillow-detail-scraper`
  for the subject — takes PLAIN ADDRESSES, so there is no geocode step and
  `providers/geocode.ts` is deleted from the layout — and `maxcopell/zillow-scraper`
  for sold comps via a `searchQueryState` URL with mapBounds around the subject.
- **The same concept has different wire formats per actor**: subject `dateSold` is ISO,
  comp `homeInfo.dateSold` is epoch millis. `zpid` is a number. Lot size arrives in
  acres OR sqft. `homeStatus` is `RECENTLY_SOLD`, not `SOLD`. All adapter-mapped.
- **`homeType` has values outside our enum** (`LOT`, `MULTI_FAMILY`, `APARTMENT`) →
  `OTHER`, which rule 7 then rejects. 3/40 recorded search items are building/rental
  noise cards (no `hdpData.homeInfo`) and are skipped before filtering.
- **Address misses are TWO distinct shapes**, both recorded: a clean
  `{isValid:false, invalidReason}` (spike-miss.json) AND a fuzzy WRONG-PROPERTY match —
  "123 E Coronado Rd" came back as "319 E Coronado Rd #1234" with null facts. The
  adapter guards both: normalized input street must equal normalized returned street,
  else `ADDRESS_NOT_FOUND`. Our §5.1 normalizer already unifies the legit formatting
  drift ("W Encanto Blvd" vs "W ENCANTO Boulevard") — verified on the recorded pair.

## Operator rulings (all now in CONTRACT §0 change log; contract text updated)

- **BUG-003**: new rule 12 `FUTURE_SOLD_DATE` (new reason code, not NOT_SOLD — update
  your first-match ordering assertions) PLUS the `max(monthsAgo, 0)` clamp in §5.4,
  and the same clamp where age feeds the confidence median. Fix landing next commit.
- **BUG-002 / Q2**: `trimmedMean([])` and `pricePerSqft(price, area <= 0)` THROW.
  Fix landing next commit — your pinned KNOWN GAP block will go red; flip it.
- **CF-001 / Q1**: `compsUsed` = kept count, now in contract §4 as a signature comment.
- **Q3**: cache hits do NOT consume the daily cap (it's a spend cap).
- **Q5**: `OTHER` never matches, including OTHER-vs-OTHER — deliberate, now §0 #10.
  And no longer theoretical: the fuzzy-miss subject above was typed `HOME_TYPE_UNKNOWN`.
- **Q4**: `test:apify` script — adding with the provider slice. `vitest.config.ts` — I
  will create it pointing at `tests/helpers/netGuard.ts` the moment that file exists;
  it doesn't yet, and I won't point the suite at a missing file. Write the guard,
  message me, config lands within the same cycle.
- **CUTS**: in-flight dedupe CUT; per-session cap CUT (daily stays); radius tiers KEPT
  (operator's cut was conditional on "not already built" — it's built and covered);
  confidence stays three-tier. Don't churn your goldens.
- **BUG-001** (materialBudget shebang): ruled out of scope for this feature.
- **SCOPE**: session_state + Flip/BRRRR pre-fill are BACK IN. Full module tonight.
  Contract §8 rewritten: atomic single-block writes, block CLEARED at the start of
  every run_comps (a failed run leaves no stale ARV), mandatory bound-address echo in
  the pre-fill, address-mismatch ⇒ ask instead of pre-fill. Worth test planning now.

Build order from here, one HANDOFF each: bug fixes → provider+fixtures →
format+service → cache+migration → tools/agent wiring → session_state+pre-fill.

Inbox status: your 0001–0006 all read; 0001–0004 archived, 0005/0006 archive on my
FIXED messages.
