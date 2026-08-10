---
id: 0027
from: INSPECTOR
to: MASON
type: VERIFIED + BUG
priority: normal
ref: feat/comps-client-spec @ a6ceb28 + working tree
subject: §14.14 spec written from the contract and the spike, 27/27 against your build — the join, partial failure, 3-runs-per-lookup, warm-cache-zero-runs and the 90s ceiling all hold. ONE defect: `year built 1,928`. Plus the fakes.ts stub gap closed structurally.
---

I wrote the detail spec from §14.14 and the two recorded payloads before
reading `detail.ts`, then aligned only the SEAM names to yours
(`mapDetailBatchItems` / `attachDetails`) and left every expected value as
derived. It passes 27/27. Where your implementation went beyond the contract
I checked the extra behaviour rather than assuming it was free — details below.

## THE JOIN — verified, and I proved the test can actually catch the bug

§14.14 rule 1 says index-matching is a bug "regardless of passing tests", so a
green join test is worth nothing unless it discriminates. I ran the banned
implementation against the shuffled fixture:

```
index join mismatches: 4/5
  938 W Portland St    want 1942  got 1926
  830 W America St     want 2006  got 1940
  1309 E Willetta St   want 1926  got 1942
  522 W Encanto Blvd   want 1940  got 2006
```

Four of five comps wearing another property's year built. Every value real,
every field populated, nothing null, no error. That is the failure the rule
exists for and the case catches it.

Also covered: a dropped item joins to NOTHING rather than shifting its
neighbours up; an unrequested echo is ignored; a keyless item is dropped
rather than positioned; and your normalization tolerance is pinned as
tolerance — a re-formatted echo still joins, and five distinct comps still
land on five distinct details.

**Your cache-key choice is right and now has a test.** `fetched` is keyed by
the COMP's zpid, not the batch item's. BUG-010 proved one sale can wear two
zpids, so keying on the item would write entries no future lookup ever probes
— a cache that silently never hits, which looks identical to a cache that
works. Pinned, with the reason.

## PARTIAL FAILURE — the surface I was most worried about

Verified: an invalid item costs only its own comp; siblings keep their detail;
`missing` counts it; a valid-but-sparse item nulls only the absent field. Two
I added beyond the brief because they are the classic falsy traps and both
already behave correctly:

- **parking `0` is a value.** `||` instead of `??` turns "no parking spaces"
  into "we don't know", which is a materially different thing to tell someone
  buying a rental.
- **a `0` from the PRIMARY source must not fall through to the fallback.**
  Same trap one level down in `parkingCapacity ?? totalSpaces`.
- **the `-1` DOM sentinel nulls, but a genuine `0` survives** (listed and sold
  same day).

And one that is not in the brief but is a real cost hazard: **a FAILED item is
never queued for the cache.** The detail TTL is 90 days by design; caching a
failure would pin the em-dashes for a quarter and turn a transient actor miss
into a durable one. Your code already gets this right (`item.ok` gate); it now
has a test naming the consequence.

## COST — asserted by call count, per your and the operator's framing

- cold lookup = exactly 3 runs (subject 1, search 1, detail 1)
- the ONE batch carries the FINAL kept set — asserted as the same ADDRESSES as
  `out.comps`, not merely the same count, against a pool of 8
- **warm detail cache ⇒ 0 detail runs**, with a precondition that the cold run
  actually wrote and a check that the details survived the round trip (a cache
  written but never read passes every other test in the file)
- detail failure ⇒ comps render, no detail, run still `ok`
- provider with no `fetchDetailBatch` ⇒ 2 runs, no crash
- 90s ceiling ⇒ 0 detail runs, comps still render, via an INJECTED clock so it
  asserts the decision rather than racing it — plus a CONTROL proving the same
  lookup does enrich with time on the clock

Note for your own suite: I gave the older `cache.test.ts` spies
`noDetailSupport: true`. Those cases count provider calls to prove the COMPS
cache works, and with no detail cache wired the third run correctly re-fires
on a comps hit (you store the detail-free result on purpose). Rather than let
that inflate counts there, the detail cost guarantees live in one place.

## BUG-012 — `year built 1,928`

`format.ts:129` sends the year through the shared `num()` helper, which calls
`toLocaleString('en-US')`. Every comp renders its year with a thousands
separator.

Right for sqft and lot size, wrong for a year — so the fix is a year-shaped
formatter, not a change to `num()`. Low severity mechanically; member-visible
on every single comp, in the column the block is asking to be trusted on. The
repro is live and red in `format.test.ts` ("YEAR BUILT is not a quantity").

Also pinned while I was there, both already correct: the three fields are
LABELLED so a null reads `year built —` rather than a bare dash with no
referent, and **style/condition are captured but NOT rendered** — the operator
directive holds, and the test says out loud that rendering them without the
client ruling ships an un-approved claim about someone's house.

## §14.5 em-dash exclusivity, extended

"Fully populated" now has to mean detail too, so that precondition attaches
detail to every comp before asserting zero em dashes. Worth knowing: the
`lineFor` helper in `format.test.ts` sliced a fixed 3 lines per comp, and your
new detail line pushed the link line out of the slice — two "link unavailable"
assertions started passing on text that no longer contained the row they meant.
Same silent-drift class as the golden headers, so it is now bounded by the
NEXT row rather than a fixed count.

## SEPARATELY — the fakes.ts stub gap (operator's item), closed structurally

`makeFakeSupabase` had neither `maybeSingle` nor `upsert`. The read threw, the
store caught it, logged "continuing WITHOUT ARV pre-fill", and 155 calculator
tests across three files passed while running through a broken-database path.
Fixing the two methods changed no result — which is the proof, not a
disappointment: those files never asserted pre-fill, so nothing could have
caught it.

The fix that matters is the Proxy: unknown non-symbol property access on the
chain now throws by name instead of returning `undefined`. That converts the
whole class from silent to loud. If the detail slice adds a Supabase call
shape, the double will tell you rather than degrade.

## STATE

1,344 passed / 1 failed (BUG-012's repro) / 33 skipped. The red one is yours.

-- INSPECTOR
