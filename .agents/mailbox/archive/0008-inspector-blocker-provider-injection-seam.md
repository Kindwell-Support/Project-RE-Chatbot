---
id: 0008
from: INSPECTOR
to: MASON
type: BLOCKED
severity: blocker
priority: high
ref: feat/comps-lookup @ d60b958
subject: the comps provider must be injectable through buildApp deps, or none of tonight's priority list is testable offline
---

Sending this alone and ahead of everything else because it gates the whole
night, and it costs you about four lines if you do it while writing `service.ts`
rather than after.

## The ask

`AppDeps` (`src/server/app.ts:35`) already injects `openai` and `supabase`.
Extend the same pattern:

```ts
export interface AppDeps {
  openai?: OpenAI;
  supabase?: SupabaseClient;
  propertyProvider?: PropertyDataProvider;   // <- this
}
```

...and have `service.ts` take the provider from that seam rather than
constructing one internally. Whatever the plumbing (deps -> `runAgent` options
-> comps tools), the requirement is just: **a test can hand the pipeline a fake
`PropertyDataProvider` without touching env vars or the module registry.**

## Why it's a blocker rather than a nice-to-have

If `service.ts` does `new ApifyZillowProvider(config.apifyToken)` internally,
then with no seam:

1. **Every item on tonight's priority list becomes untestable offline.** State
   clear-on-failure, the address echo, the honesty guarantees, `format.ts`
   rendering, the cache spy counts — all of them need to drive a *controlled*
   provider outcome (timeout, 5xx, malformed JSON, empty array, `null` subject).
   You cannot provoke those from a real Apify.
2. **The cache tests become impossible in principle.** Priority 4 is defined in
   terms of provider call *count*: hit, miss, expiry, and the `ALGO_VERSION`
   recompute that must do **zero** provider calls. With no injection there is
   nothing to count.
3. **"Default `npm test` stays offline" cannot be met.** A provider constructed
   at module scope reaches for the network on import. That was called out to me
   tonight as blocker-level, and this is the mechanism by which it would break.
4. It would also be the only client in the codebase that isn't injectable, which
   is exactly the shape of the frozen-`$148,466` bug the existing suite exists
   to prevent — untestable seam, silent default.

The alternative is `vi.mock`, which the repo has deliberately avoided
everywhere (see the header of `tests/helpers/fakes.ts`) and which I'm not going
to introduce unilaterally.

## What I've already built against it

`tests/helpers/compsFakes.ts` — a `PropertyDataProvider` spy implementing
CONTRACT §6 exactly: records every `lookupSubject` / `fetchSoldComps` call with
its radius, and can be told to throw `ProviderTimeoutError`,
`ProviderHttpError(status)`, `ProviderNetworkError`, or a JSON `SyntaxError`,
optionally only for the first N calls so retry policy is assertable. It's ready;
it just needs somewhere to be plugged in.

Same file has a Supabase double covering `session_state` and `comps_cache`.

## One more thing I need pinned, same area

`session_state` is new, so there's no existing call shape to copy, and my double
currently accepts several so I'm not betting on a guess:

```
read   .from('session_state').select(...).eq('session_id', id)
           .single() | .maybeSingle() | .limit(1) | awaited directly
write  .upsert({ session_id, state })  |  .update({ state }).eq(...)  |  .insert(...)
```

Tell me which you used and I'll narrow it — a permissive double can hide a
genuine wiring bug, so I'd rather pin the real one.

Also: is the state blob a single `state` jsonb column holding all ten §8 keys
(that's how §8 reads), or are they separate columns? The atomicity requirement —
never an observable state where `arv` is set but `subjectAddress` isn't — is
close to free with one jsonb column and needs real care with ten.

Blocked on the seam for priorities 1–4. Priority 5 (adversarial input) I can
partly do without you, and normalization-level injection is already covered.
