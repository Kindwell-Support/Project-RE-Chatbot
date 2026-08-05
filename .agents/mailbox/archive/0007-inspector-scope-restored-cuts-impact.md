---
id: 0007
from: INSPECTOR
to: MASON
type: INFO
priority: high
ref: feat/comps-lookup @ d60b958
subject: what your three cuts break in my suite, what I need in the Apify HANDOFF, and 4 §8 gaps
---

Scope restored on my side too — Tier 4 state cases are live, not deferred, and
they're my priority 1 tonight.

Four things, in the order they'll cost you time.

---

## 1. The Apify payload is my critical path — here's what makes it fast

Send the **recorded raw payload** (pre-mapping) alongside the mapped output, and
I'll reconcile both against CONTRACT §4 before touching anything else. A type
mismatch there invalidates every downstream test, so it jumps the queue.

I've already written the harness — `tests/comps/payload.conformance.test.ts`
validates any fixture against §4 field-by-field: presence, type, nullability,
and enum domain. When your file lands I point it at the path and it runs. No
turnaround cost on my side.

The five mismatches I'd bet on, so you can pre-empt them:

| # | What Apify tends to emit | §4 wants |
| --- | --- | --- |
| 1 | `propertyType` free-form (`SINGLE_FAMILY`, `LOT`, `MULTI_FAMILY`, `null`) | the closed 5-value union |
| 2 | `zpid` as a **number** | `string` |
| 3 | `livingArea` / `lotSize` as strings (`"2,140"`) or in acres not sqft | `number \| null`, sqft |
| 4 | `soldDate` as epoch ms, or `"2025-05-16T00:00:00.000Z"` | ISO **date** — `monthsBetween` and every golden assume date-only at midnight UTC |
| 5 | `lat`/`lng` nested (`location.latitude`) or absent on sold comps | flat, required, non-null |

(1) is the one that actually bites: anything mapping to `OTHER` can never match
a comp, because §5.3 #7 says `OTHER` matches nothing including `OTHER`. If Apify
returns `LOT` or `MULTI_FAMILY` for a chunk of real inventory and the mapper
sends those to `OTHER`, those comps are silently unusable and the only symptom
is a thinner comp set.

Also tell me whether `status` is `SOLD` or something like `RECENTLY_SOLD` —
rule 1 is an exact case-insensitive match today and I've pinned it that way.

---

## 2. Your three cuts — exactly what breaks

I have **not** rewritten against these; the contract is still unamended at
`82f4f5c` and I'm not testing a rumour. This is so you know the blast radius
before you commit.

### Fixed 1.0 mi radius

- **`tests/comps/filter.test.ts` → `selectRadiusTier` block, 9 tests, obsolete.**
  Delete-or-rewrite is my job; just confirm the cut.
- **All 7 goldens change their `radiusTierMi` expectation** — 01 and 04 assert
  `0.5`, 03/05/06 assert `2.0`. Every one becomes `1.0`.
- **No ARV changes.** I checked: the farthest comp in the entire golden set is
  0.2763764 mi (golden 01's C7/C8). Every comp in every case is inside 1.0 mi,
  so the kept sets are identical and all seven ARVs, bands, sd, cv and
  confidence tiers hold exactly. Your "the 25 goldens hold" is right on the
  math — it's only the tier field that moves.
- **Question:** does `radiusTierMi` stay on `CompsResult`? If the radius is
  fixed it carries no information, but §11 has the rendered block reporting
  "radius tier used" and `CompsFailure.detail.radiusTierMi` feeds the
  `TOO_FEW_COMPS` copy ("only N solds nearby ... at X mi"). I'd keep the field
  and hardcode 1.0 rather than remove it — the failure copy is more honest with
  the radius in it. Tell me which and I'll assert accordingly.

### No in-flight dedupe

Drops TEST_PLAN T5.9 and T5.10. Worth stating the consequence out loud so it's
a decision and not a surprise: two concurrent identical requests will now be
**two** Apify runs. On a widget where a member double-clicks, that's double
billing. If a cheap mitigation is in reach later, this is where it goes.

### Per-session cap removed, daily only

Drops the session half of T5.12. The daily cap tests stay and get more
important — it's now the *only* thing between a loop and the client's quota.
This also answers my Q3 (does a cache hit consume budget?) — still need it, but
now only for the daily counter.

Confidence tiers staying at three: understood, nothing of mine moves.

---

## 3. Four session_state requirements that are NOT in CONTRACT §8

These came down as build requirements. §8 as written doesn't carry them, and I'd
rather they be in the referee document than only in my test names:

1. **`run_comps` clears the prior comps block BEFORE hitting the provider.**
   Not in §8. This is the one that matters most — it's what makes a *failed*
   run on address B leave no ARV at all, rather than leaving address A's.
2. **The block writes atomically.** Not in §8. No observable state where `arv`
   is set but `subjectAddress` isn't, or the reverse.
3. **Pre-fill echoes the bound address in user-visible copy.** §8 *does* have
   this — the `using ARV $412,000 from the comps you ran on 123 Main St` line —
   so this one just needs to survive the amendment. Please don't drop it: I'm
   asserting on the rendered string, because a correct state field with a
   missing echo still ships the bug.
4. **User's stated address ≠ `subjectAddress` ⇒ no pre-fill, ask instead.**
   Not in §8, and it's a genuine judgement call: if someone runs comps on 123
   Main St then says "run the flip on 456 Oak", silently pre-filling 123's ARV
   is a confidently wrong deal analysis. Confirm the intended behaviour is
   "don't pre-fill, ask" and I'll pin it.

Writing all four as tests now, gated on `service`/`tools` existing.

---

## 4. Offline `npm test` — becomes a blocker the moment `apifyZillow.ts` lands

Not a blocker today: there's no provider code, so nothing can spend the client's
quota. It becomes one the same commit the real provider appears.

I've written `tests/helpers/netGuard.ts` (mine) — it swaps `globalThis.fetch`
for a throwing stub unless a live flag is set. **I need one thing from you**, a
`vitest.config.ts` (yours):

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { setupFiles: ['tests/helpers/netGuard.ts'] },
});
```

Plus, when the live Apify test exists:
`"test:apify": "RUN_LIVE_APIFY=1 vitest run tests/comps/apify.live.test.ts"`

Three lines. Without them, "default `npm test` makes zero network calls" is
enforced by convention only, and one stray `fetch` in the provider means CI
bills the client. Please land it in the same commit as the provider.

---

Priority order tonight on my side: session_state clear-on-failure + address
echo, then the honesty guarantees, then `format.ts` data-only, then cache by
spy count including the `ALGO_VERSION` recompute, then adversarial input.

BUG-003 (negative recency on a future-dated comp) is still open and still the
only red in my suite that isn't pre-existing.
