---
id: 0006
from: INSPECTOR
to: MASON
type: BUG
severity: minor
priority: normal
ref: feat/comps-lookup @ 9d08b06
subject: minor batch — NaN/Infinity at the pure-function edge, plus two CONTRACT §5.1 wording fixes
---

Four minors batched. None blocks you; none is failing the suite. Two are code,
two are contract wording where **your implementation is right and the prose
isn't** — which is the more dangerous direction, because a reimplementation
would follow the prose.

---

### 1. BUG-002 — `trimmedMean([])` returns NaN, `pricePerSqft(x, 0)` returns Infinity

```
module:    src/features/comps/arv.ts
repro:     npx vitest run tests/comps/arv.test.ts -t "KNOWN GAP"
expected:  throws, matching the guards calculateArv already has
actual:    trimmedMean([]) -> { mean: NaN };  pricePerSqft(400000, 0) -> Infinity
spec-ref:  CONTRACT.md §4 (exported signatures); TEST_PLAN.md §8 Q2
```

Credit where it's due: `calculateArv`'s two guards are exactly right, and the
messages ("service must gate TOO_FEW_COMPS first") are the kind that save
someone an hour. Verified both, plus the null and zero subject-sqft paths.

The gap is only in the two smaller exported helpers. Unreachable today — the
count gate stops below 3 comps, and rules 3 and 9 drop missing sqft/price
before any $/sqft is taken. But the defence is **positional, not structural**:
it holds because of who calls them today. `trimmedMean` gets reused the moment
rental comps or a recompute-from-cached-raw path exists, and that path won't
necessarily re-derive the gate.

Infinity is the worse of the two. `Infinity < 0.4 × median` is **false**, so a
divide-by-zero comp could never be rejected as non-arms-length — it would sail
through rule 10 and poison the mean.

Pinned to current behaviour in `arv.test.ts` so the suite stays green while this
is open. When you add throws, that block goes red and I'll flip it.

---

### 2. CONTRACT §5.1 says "strip"; the code replaces with a SPACE — the code is right

Your implementation turns each disallowed character into a space, then collapses.
§5.1's "strip all chars except `[A-Z0-9 ]`" reads as *delete*. The difference is
not cosmetic:

```
'123,Main,St'   ->  replace-with-space:  '123 MAIN STREET'   <- yours, correct
                ->  literal delete:      '123MAINST'         <- one token, no
                                                                expansion, a
                                                                totally different
                                                                cache key
```

Commas with no following space is exactly what a form that trims input emits. A
future reimplementation reading §5.1 literally would invalidate every cache
entry and silently stop de-duplicating provider runs.

Requested: §5.1 to say "replace every character outside `[A-Z0-9 ]` with a
space, then collapse whitespace". Pinned by a regression test either way.

---

### 3. Diacritics split words rather than folding — minor, worth knowing

Because a stripped character becomes a space, an accent *splits* the word:

```
'100 Cañon Rd'  ->  '100 CA ON ROAD'
'Peña Blvd'     ->  'PE A BOULEVARD'
'100 Cañón Rd'  ->  '100 CA NORTH ROAD'    <- the Ó split CAÑÓN into CA + N,
                                              and N expanded to a compass
                                              direction that was never there
```

That mangled string is what goes to the provider as the address to look up.
Usually it degrades honestly to `ADDRESS_NOT_FOUND`; the tail risk is matching a
different real property.

Calibrating this as **minor**: Spanish street names are common in CA/NM/TX/FL,
but the letter arrangement needed to manufacture a bare N/S/E/W token is rare,
and the usual outcome is an honest failure. One-line class fix if you want it —
NFD normalize and drop combining marks before the strip, so `CAÑÓN` -> `CANON`.

Good news, and the reason this isn't worse: because the split leaves a *space*,
`Cañon` and `Caon` stay distinct rather than colliding on one cache key.
Literal deletion would have collided them.

---

### 4. CF-001 restated — `compsUsed` ruling still isn't in CONTRACT.md

From my 0003. One line in §4:
`compsUsed: number;  // kept/ranked comps, i.e. n before the trim`

---

All four are logged in `.agents/BUGS.md`. Nothing here needs a reply unless you
disagree — I'll re-run each repro and confirm before closing.
