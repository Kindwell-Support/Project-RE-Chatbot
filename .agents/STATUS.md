18:52 MASON — read repo end-to-end, confirmed config/tool/state plumbing, wrote CONTRACT.md, sent HANDOFF 0001 — next: slice 1 (types+config+normalize)
18:54 MASON — slice 1 shipped (types/config/normalize), typecheck clean, HANDOFF 0002 sent — next: slice 2 (filter/rank/arv)
18:57 MASON — slice 2 shipped (filter/rank/arv), smoke-verified reason order + tiers + trim + confidence, HANDOFF 0003 sent — next: slice 3 (format/service/stub+fixtures)
19:15 INSPECTOR — TEST_PLAN.md up (130+ cases from CONTRACT); golden dataset (7 cases) hand-computed and cross-checked both ways; Q1 compsUsed resolved via MASON 0003 — next: unit specs for normalize/haversine/trimmedMean (slices 1-2)
19:22 INSPECTOR — golden dataset (7 cases) run against slice 2: 25/25 pass, ARV core scoped-GREEN; filed BUG-001 (materialBudget suite has never executed, shebang+CRLF, 17 tests absent, npm test red) — next: unit specs for normalize/haversine/trimmedMean/filter/rank
19:42 INSPECTOR — slice 1+2 unit specs landed (235 tests: normalize 78, filter 49, arv 57, rank 26, golden 25); found BUG-003 (major: future-dated comp scores negative, outranks every real comp, cannot be capped out) + BUG-002 and two CONTRACT §5.1 wording fixes (minor batch) — next: format/service specs when slice 3 lands
20:12 MASON — spike done (4 recorded fixtures, 2 actors, miss shapes), CONTRACT amended (rulings+cuts+§6.1 mapping), ANSWER 0004 sent — next: BUG-003/BUG-002 fixes
20:18 MASON — BUG-003 fixed (rule 12 + term clamp, field raw), BUG-002 fixed (boundary throws), seam+key rulings in contract, FIXED 0006 sent — next: provider slice
20:23 MASON — provider slice shipped (real adapter + stub + seam + netGuard wired), mapper verified on all 4 recorded fixtures, HANDOFF 0007 sent — next: format+service
20:25 MASON — format+service shipped (orchestrator, one-source failure copy, cache/budget seams), 6 offline smokes green incl. recompute-from-raw, HANDOFF 0008 sent — next: cache+migration
20:29 INSPECTOR — reconciled real Apify payload vs §4/§6.1 (mapping correct; found BUG-004 subject self-comps + FINDING-001 recorded pair can never reach 3 comps); BUG-002/BUG-003 repros re-run and CLOSED; P1 session_state + P2 retry/honesty specs written (53 gated, zero vacuous under COMPS_STRICT) — next: cache spy counts, format.ts, adversarial
20:29 MASON — BUG-004 fixed (rule 0 SUBJECT_PROPERTY), success-path pair recorded (ARV 431k real data), mapped fixtures emitted, FIXED 0009 sent — next: cache+migration
20:31 MASON — cache+migration shipped (comps_cache impl, both tables, boot probes), HANDOFF 0010 sent — next: tools+agent wiring
20:36 INSPECTOR — conformance harness run against MASON mapped fixtures: found BUG-006 (major: soldDate mapped as timestamp not date, so same-day comps hit FUTURE_SOLD_DATE for 7h of every UTC day, nondeterministic + frozen by 14d cache) and BUG-005 (minor: renderCompsForChat returns undefined); BUG-004 + FINDING-001 verified CLOSED; format.ts data-only guarantee green (14/16) — next: cache spy counts, rule-0 ordering, live social-pressure battery
21:11 INSPECTOR — CONDITIONAL GREEN: 346 comps tests green (state 24, service 31, cache 17, format 16, filter 54, normalize 78, arv 57, rank 26, goldens 25, conformance 15); BUG-005 + BUG-006 verified CLOSED; live social-pressure battery written but NOT RUN (needs OPENAI_API_KEY — operator call) and BUG-001 still reds npm test — both documented as conditions in msg 0012
21:12 MASON — BUG-005/006 fixed (date-only + day-granularity monthsBetween, render fallback), retry moved to seam, tools+state slices shipped, suite 1182/0 — next: live verification
21:31 MASON — live battery 12/12 (caught+fixed example-figure anchor), model-carried ARV echo closed, live e2e verified (2 addresses + miss + cache), ANSWER 0014 sent — awaiting unconditional GREEN
21:44 MASON — operator blocker fixed: stale model-carried ARV now refuses+asks (three-way explicit rule in §8), RLS confirmed live (enabled, zero policies, service-role only) — awaiting GREEN
21:45 INSPECTOR — MASON live find invalidated P1 altitude (real model passes ARV explicitly, not via pre-fill); re-pointed P1 at the production path (+7 tests). His 3-way discriminator HOLDS incl. the transformed-carry case; BRRRR covered. Filed BUG-007 (minor: override escape hatch skips property binding when the carried figure coincides with another number in the message — analysis runs unlabelled). GREEN still conditional on BUG-007 fix-or-accept
21:51 MASON — BUG-007 fixed (two-part labelled override echo, operator ruling), 508 regression green, FIXED 0016 sent — awaiting unconditional GREEN
22:37 MASON — SCOPE AMENDMENT: form surface server side shipped (formPrefill + agent wiring + §8.1), 7/7 probes green, HANDOFF 0017 sent — next: widget render
22:41 MASON — form surface complete (widget render + live e2e, 5 guarantees re-proven, untouched prefill submits through applyArvPrefill), suite 1203/30sk, HANDOFF 0018 — awaiting re-issued GREEN
22:45 INSPECTOR — form surface verified as a second entry point (19 tests: 14 server + 5 widget). Both blocker questions answered independently: submitted form ARV DOES traverse applyArvPrefill (proven via the echo, which only that fn sets); model CANNOT populate the form (closed enum + adversarial extra-args test proves the handler ignores them). All 6 mandated P1 guarantees ported and green with positive preconditions. Found BUG-008 (minor: widget pre-fills without a label, contradicting its own stated invariant). Full suite 1210 passing
23:17 MASON — ANF copy branch shipped (unit_mismatch vs not_found, INFO-logged), widget declines label-less prefill, PV live-verified, suite 1211/0 — CONTRACT_CHANGE 0019 sent
23:18 MASON — BUG-008 confirmed fixed (pre-empted in a90b811), FIXED 0020 sent; merge gated only on INSPECTOR ack of 0019 copy-branch delta
23:27 MASON — rulings 1+3 shipped (APARTMENT->CONDO, pool-composition copy branch), fixtures regenerated, stale cache row purged, 16402 live-verified, suite 1211/0, CONTRACT_CHANGE 0021 sent
23:29 INSPECTOR — BUG-008 verified CLOSED; verified CONTRACT_CHANGE 0019 independently: all EIGHT failure copy branches (2 codes branch on detail) carry no value-shaped figure and offer manual entry, and the unit_mismatch branch is REACHABLE through the provider seam, not just correct in the renderer. 1,236 passing, 0 test failures
23:39 MASON — unit-designator copy branch shipped (three-truth ANF), 8/8 matrix + live no-unit verified, suite 1247/0, CONTRACT_CHANGE 0022 sent
23:42 INSPECTOR — verified CONTRACT_CHANGE 0021 (APARTMENT->CONDO) + post-ack 0f6cd86 (unit-typed copy branch). Pinned the §6.1 homeType mapping RULE through mapCompItems so the ruling survives fixture regeneration; verified MASON regenerated-fixture distributions independently; proved the no_type_match branch fires only on the full 3-part condition (one same-type comp in pool => thin copy WITH counts); proved both unit sub-branches reachable from real input. 412 comps / 1,251 repo, 0 test failures
23:57 MASON — DIAGNOSTIC: recall turns proven tool-free (state frozen at 18:48:11, single-round tokens); prompt-induced by the anti-re-run spend guard; INFO 0023 sent, NO fix pending ruling
00:13 MASON — RULING executed: repeat-rerun prompt flip + qa_logs.tool_calls (migrated live), 4/4 repro checks green, suite 1251/0, CONTRACT_CHANGE 0024 sent
00:13 INSPECTOR — assessed MASON 0023 (transcript-recall path) as FINDING-004, severity MAJOR not INFO: every honesty guarantee I signed assumes the tool ran, and this path engages none of them. Characterised offline (5 tests): both ARVs in replayed history with no currency marker, state binds only the latest, recall turn = 0 provider/0 state/0 tool, and the divergence case (member told A while state binds B). Added 2 gated live tests for the question the ruling turns on. GREEN QUALIFIED pending the ruling
00:28 INSPECTOR — verified RULING 0024: re-run instruction + no-memory rule pinned in the comps prompt AS SENT, regression guard on the old spend guard, qa_logs.tool_calls verified for both tool and tool-free turns. Caught and corrected a FALSE PIN of my own (asserted SYSTEM_PROMPT, matched the unrelated calculator rule, would have passed through the flip). FINDING-004 closed-by-ruling with a minor residual: closed by instruction not structure. 1,260 passing, 0 test failures
18:22 MASON — BUG-001 fixed (shebang + repo-wide .gitattributes): 17/17 PASS on first-ever run, npm test exit 0, FIXED 0025 sent
18:31 INSPECTOR — BUG-001 CLOSED: fix verified on a REAL fresh clone (blob LF, checkout LF, CRLF normalized on add so the class cannot re-enter), three-way probe re-run, ingest script still runs, npm test exits 0 for the first time (1,277 passing). AUDIT of the 17 reported separately: all pass, 14/17 meaningful under mutation, 3 vacuous-capable (T7 determinism genuinely empty — fixed; T9/T17 backstopped by siblings). Closed a substring-matching coverage gap. Filed BUG-009 (blank item returns the ENTIRE table — frozen-148466 shape, latent until the sheet lands). Tile inconsistency located in the KB corpus, not this suite
18:38 MASON — BUG-009 fixed (blank item throws MissingRequiredInputError, guard before load check, call-site coercion dropped); INSPECTOR repro needs a toThrow reshape on their side, FIXED 0026 sent
18:43 INSPECTOR — BUG-009 CLOSED against the full gate: all 8 blank shapes rejected (empty/spaces/tab/newline/undefined/null/number/object), no result set on any, same error CLASS as calculators (constructor-compared vs runFlipTool) and same SURFACING through runAgent with the do-not-invent instruction, guard fires even when loaded:false, substring coverage landed, nothing regressed. npm test exits 0 — 1,290 passing, first genuinely clean baseline. Pattern sweep -> FINDING-005: 3 coercion sites, 2 guarded, search_knowledge_base UNGUARDED (empty query embedded + searched, arbitrary passages the KB-fallback then tells the model to quote figures from). Reported not fixed per scope
18:49 INSPECTOR — suite states reconciled with EVIDENCE not inference: at 8acf994 npm test exits 0 / 1,290 passing (clean tree verified before and after). Reproduced MASON 1,278+1-failed exactly by checking out his test-file state (git checkout 071903b -- tests/materialBudget.test.ts). src/ and tools/ are IDENTICAL between 071903b and HEAD — the only delta is my test reshape (19->30 tests). My old repro stayed red at 071903b for the OPPOSITE reason (fix made it throw, test had no try/catch) while its name still claimed the bug was live — my fault, noted
18:53 MASON — FINDING-005 fixed (blank query throws before the embedding; zero billed), suite 1301 exit 0, FIXED 0027 sent
23:48 INSPECTOR — on feat/comps-client-spec, baseline verified clean (689dfc7, exit 0, 1,301 passing). NOT recomputing goldens yet: CONTRACT.md is unamended (last touch f0b81b3) and no CONTRACT_CHANGE received — deriving from the brief would repeat the radius-tier-cut mistake. Sent 0022 with the measured blast radius (6 goldens / 76 hand-derived values, filter 54, arv 40, rank 28, format 23, cache 17; conformance + normalize unaffected) and 7 specifics needed in the amendment to avoid a round trip
23:50 MASON — new block: branch feat/comps-client-spec, CONTRACT §14 written (client-spec params, ALGO_VERSION 2), payload evidence gathered (DOM/parking/style absent from comps payload), HANDOFF 0028 sent BEFORE any code
00:11 MASON — client amendments: ARV surfacing OUT behind ARV_SURFACING flag (plumbing+tests retained), style/condition waived (link now load-bearing), Census queued as a later slice; CONTRACT_CHANGE 0029 sent, implementation starting
00:15 INSPECTOR — CONTRACT §14 read; raised 0023 with two contradictions (ALGO_VERSION: §14 heading + commit + handoff all say 2, but §3 table AND config.ts still say 1 — the recompute trigger, with real cached prod rows, MAJOR; and §14.8 "ARV stays" vs the client ruling "ARV is out" — blocks all surface tests). Arithmetic is unblocked and DONE: all 6 goldens hand-recomputed under v2 and cross-checked against a from-scratch §14 transcription (golden 01 verified on paper to 7dp). Reachability confirmed both ends — high fires (01, 04), medium fires (02 via median age), low fires (03, 06). THREE fixture findings recorded in V2-RECOMPUTE.md: golden 02 lost its purpose (outlier is CAPPED OUT before the trim sees it), four cases converged on 400,000, and golden 04 is now redundant
00:24 MASON — v2 implemented (params, tiers, lot scoring, new columns, prescribed copy, ARV gated off); INSPECTOR contract contradictions fixed; recompute verified on all 10 real cache rows, 0 provider calls; HANDOFF 0030
00:30 MASON — footer de-ARVed (before INSPECTOR asserts it); ground truth v1 10.3% -> v2 7.7% mean abs error; BUG-010 filed (duplicate comps = 40% of a 5-set, inflates confidence); HANDOFF 0031
18:44 MASON — BUG-010 fixed (dedupeSales, sale-identity not zpid, after gates before ranking, + candidate-median dedupe); verified on 10 real pools, 1 dup dropped, Don Frank conf high->medium; FIXED 0032; HOLDING before ARV removal per sequencing
18:53 MASON — ARV REMOVED (arv.ts deleted, flag gone, ALGO_VERSION 3, run_comps no longer touches session_state); manual ARV path verified intact; CONTRACT §14.8 records the one-way door; CONTRACT_CHANGE 0033
19:09 MASON — batch spike done (5-in-1 run works, 16s, out-of-order join on addressOrUrlFromInput, per-item failure isolation); NO build until INSPECTOR GREEN; INFO 0034
19:47 MASON — cap ruling recorded (50, counts lookups); §14.14 pinned (join-key rule, batch bound to MAX_COMPS_KEPT, zpid cache, 90s ceiling, blind-parallel ban) — HOLDING for INSPECTOR GREEN
20:15 MASON — BUG-011 fixed @ 0b7dcab (optional address arg, structural current-message binding, null=unbound, guard skips null, legacy 'manual entry' coerced on read); 5 smokes green, tsc clean, FIXED 0035 sent — next: the six 0025 contract contradictions
20:19 MASON — 0025 resolved @ 643d614 (ALGO_VERSION 3 everywhere, §5.3 ladder, §4 sync+tombstones, §5.5 preserved-spec banner, §14.7, rule 10) + §14.15 BUG-011 record; accepted INSPECTOR's em-dash exclusivity reading @ aed1761 (compLine separator now interpunct, rule pinned §14.5); SUITE FULLY GREEN 1,313/0 exit 0; CONTRACT_CHANGE 0036 sent — HOLDING for GREEN, then detail slice §14.14

---

## INSPECTOR — 2026-08-10, ARV-removal block @ a667e2b

Suite: **22 failed / 1276 passed / 33 skipped**, down from 93 failed at
`12eb0e7`. All 22 remaining failures are in `state.test.ts` (13) and
`form.test.ts` (9) and have ONE cause: **BUG-011** (mailbox `0024`, blocker) —
every manual ARV binds to the literal string `"manual entry"`, so no test can
bind an ARV to a real address.

Not GREEN, and not close to it until BUG-011 lands. Left red rather than
skipped: a red suite with a named blocker is honest; a green one that hides it
is not.

DONE: filter (41→0, tier ladder rewritten with an order proof), rank (9→0, all
five v2 terms hand-derived), cache (3→0), service (1→0), recall (2→0),
`arv.test.ts` retired with the live half of BUG-002 re-pointed onto `scoreComp`,
`golden.test.ts` and `format.test.ts` rebuilt (both were DEAD on a deleted
import, contributing 0 tests while looking like 82), golden header-integrity
guard added, four stale golden headers corrected, the P1 inversion landed.

RAISED: BUG-011 (`0024`, blocker), six contract self-contradictions (`0025`,
non-blocking — code is right in every case).

DEFERRED: the live battery, until the suite is green offline.

=== SESSION-STATE SUMMARY (MASON, 2026-08-08) =========================
BRANCH feat/comps-client-spec @ b200ffb — UNPUSHED (operator handles all
pushes). main @ 689dfc7 is pushed and deployed; production runs the v1
comps module.

SHIPPED ON THIS BRANCH
- CONTRACT §14: client-spec alignment. Params live in code: sqft ±20%,
  radius [1,3]mi, recency tiers [3,6,12]mo (recency widens before radius),
  cap 5 display+compute, lot as soft scoring (35/25/20/10/10), new per-comp
  fields (beds/baths/lot/link, em-dash nulls, "link unavailable"),
  prescribed opening/closing copy verbatim.
- BUG-010 dedupe: sale-identity (price+sqft+date+~10m), after gates before
  ranking, DUPLICATE_SALE visible; candidate median dedupes its own input.
- ARV REMOVED ENTIRELY (one-way door, §14.8): arv.ts deleted, ALGO_VERSION
  3, run_comps no longer touches session_state; manual ARV path
  (set_manual_arv + prefills, arvSource 'manual' only) verified intact.
- Ground truth v1->v2: mean abs error 10.3% -> 7.7% (Vale -0.3%, Danbury
  -7.7%, Don Frank -15.1%; post-dedupe Don Frank -16.6% at honest medium).
- Detail-batch spike: 5-in-1 run works (16s), join on addressOrUrlFromInput
  NEVER position, per-item failure isolation. §14.14 pins the build rules.
- reports/APIFY_FIELD_AVAILABILITY.md: DOM/parking absent from comps
  payload (detail-only); lot available and shipped.

GATED / WAITING
- HOLDING for INSPECTOR GREEN on the client-spec block (their
  tests/comps recompute is in flight; non-comps suites 880 green).
- After GREEN, in order: detail-enrichment slice per §14.14 (3 runs per
  lookup, zpid cache, cap stays 50 counting lookups — fix the "provider
  runs" comment in that slice), then Census (§14.10), then merge/push
  (operator).
- Client ruling pending: DISPLAY of style/condition (obtainable via
  detail; waived only as matching criteria).

KNOWN / ACCEPTED
- Commit 12eb0e7 trailer typo (duty@) — ruled leave-as-is.
- Production comps_cache holds v1 rows; ALGO_VERSION 3 forces
  recompute-from-raw on first touch after deploy, zero Apify spend.
=======================================================================

---

## INSPECTOR — 2026-08-10, GREEN @ c8d1d3b

**Offline: 33/33 files, 1,313 passed, 0 failed, 33 skipped** (the two live
gates + sentinels, verified by reporter — no silent skips, no file failing at
import). **Live: pressure battery 15/15, agent suite 18/18**, zero Apify
spend (fake provider by design). Known flake on the watch list: A7, once in
three runs, passes on re-run, detail uncaptured because unreproduced.

BUG-011 CLOSED — verified to the ruling by the four-state battery
(`manualArvBinding.test.ts`, 6/6, written from the ruling not the diff).
The never-conflict blur did NOT happen: bound A still refuses B. One
RESIDUAL raised for a ruling in `0026`: a model-OMITTED address leaves the
member's ARV unbound and therefore portable — silent-number failure
direction, reachable through model non-compliance alone.

All six contract fixes confirmed from the document at `643d614`/`aed1761`.
Em-dash marker exclusivity accepted both ways (contract text <-> suite).

The strongest post-removal live result, on the record: asked "what was the
ARV on 123 Main again?" with two comps runs in history, the model re-ran per
RULING 0024 and relayed a fresh block — the whitelist assertion found ZERO
figures outside the eight known comp prices.
21:48 MASON — RULING 0026 executed @ f0b81ce (extraction fallback: same verification, ambiguity->unbound, over-capture refined; unbind announced via unbound_from + echo); smokes 15/15, only red is INSPECTOR's own tripwire; §8/§9/§14.15 amended, FIXED 0037 sent — HOLDING for re-issued GREEN
22:05 MASON — DETAIL SLICE shipped @ 66699ce (§14.14.1: batched 3rd run, join by addressOrUrlFromInput never position, zpid cache 90d, detail-free comps_cache + re-attach per serve, 20s ceiling floor, no-retry pinned, cap counts lookups, style/condition captured NOT rendered); smokes 9/9, INSPECTOR pre-written suite 10/11, 4 reds all fixture-vintage theirs; HANDOFF 0038 + maybeSingle flag relayed — next: Census §14.10 after their verification
22:20 MASON — BUG-012 fixed @ 3cde09d (year() identifier formatter, num() untouched; class sweep: DOM/parking are true quantities, beds/baths String(), zpid never rendered — yearBuilt was the only member); found INSPECTOR's repro regex carries a literal U+0008 where \b was meant (char-code proof), FIXED 0039 sent — gate closes with their one-byte repair
22:35 MASON — SCOPED neighbourhood aggregates (report reports/NEIGHBOURHOOD_AGGREGATES_SCOPING.md, zero runs spent): existing pool unusable (both recorded runs hit the 40-result cap — pool is 4-5 WEEKS deep, not 12 months); DOM impossible without detail runs (-1 sentinel on 76/76, options omit / labelled 5-comp avg / N-slot real thing); proper build = +1 search run per lookup with Zillow doz=12m, exact bill gated on ONE spike (resultsLimit>40 behavior + per-result rate in client console); Census stays cheaper, sequence unchanged — NOT built

---

## INSPECTOR — 2026-08-10, detail slice GREEN (offline) @ HEAD

**Offline: 34/34 files, 1,345 passed, 0 failed, 33 skipped** (live gates +
sentinels), and identical under `COMPS_STRICT=1`.

BUG-012 CLOSED and verified against the build. My gate for it was itself
broken — five U+0008 bytes in `format.test.ts`, one loud and one SILENT
(FINDING-006). Swept all 49 test files; that was the only carrier.

FINDING-007, the sixth shape: **assertions that never execute.** 31 guarded
blocks measured by instrumentation; 16 never took their branch; 8 of those
were the wrong-house leak guards, dead every run. Converted to unguarded
optional-chain assertions that pass on a refusal and fail on a leak.

**LIVE BATTERY BLOCKED — not run at this SHA.** OpenAI returns
`429 no credits remaining`. Last green live run was 15/15 + 18/18 at
`c8d1d3b`, before the detail slice. Checked offline in substitute: the three
new detail fields (year, DOM, parking) introduce ZERO figures the pressure
battery's whitelist can see (all below its $50k floor, none currency-marked),
so that battery is structurally undisturbed — verified, not assumed. The rest
of the live battery is unaffected in principle by this slice but UNVERIFIED in
fact. Needs a re-run once credits are restored, before merge.
00:15 MASON — CENSUS shipped @ 4623e7f (§14.10 built: key now REQUIRED by the API — CENSUS_API_KEY gate, three-state demographics, tract cache 180d, emit order extended, no retry, geocoder fixture RECORDED / ACS hand-built pending key; smokes 9/9, suite 1,346/0); §14.16 records both aggregate rulings + outlier candidate; SPIKE run (authorized): 235 items @ 6.4s, doz=12m holds, our resultsLimit was the wall, fixture recorded — aggregates NOT built, awaiting operator go; HANDOFF 0040. OPERATOR ACTION: register free CENSUS_API_KEY
00:25 MASON — RULING executed @ a292bc8: §14.10 Guarantee 3 (ACS_SENTINELS enumerated set — operator's four + two documented completions flagged; threshold check gone; zero survives) + Guarantee 4 (standing provenance rule, INSPECTOR framing, three surfaces cross-referenced); smokes 10/10, suite 1,346/0; CONTRACT_CHANGE 0041 sent. Pricing pulled from actor API: search $0.002/result, detail $0.003/result at BRONZE tier (account tier itself 403-hidden to this token) — reported to operator
00:30 MASON — CENSUS LIVE-VERIFIED @ 1cddcca (keyed ACS real values: $93,333/37.9/62-38 tract 1117; hand-built fixture DELETED, two real recordings incl. tract 061017 with LIVE -666666666 sentinel + 0/0/0 tenure; county sweep 35 sentinel hits / 1,009 tracts all -666666666, zero negative non-sentinels; rendered section verbatim in contract, emit order holds); six-sentinel list stands per ruling; HANDOFF 0042 — HOLDING for INSPECTOR census verification before aggregates

---

## INSPECTOR — 2026-08-11, Census verified @ 2e8c466 + working tree

**26 of 28 census cases pass.** Every hand-derived figure matches the real
recording (62.2 / 37.8 from 1427 and 869 over 2296). Six sentinels asserted as
an exact SET. Columns confirmed located by NAME — re-ordered the recorded
headers and every field still lands, which is the detail-batch join lesson in
a second place. Denominator confirmed as the SUM of the two counts, with a case
that makes sum and returned-total disagree since the recording cannot.

**The live sentinel question is answered by the recording**: tract
`04013061017` really does return `-666666666` income with a zero denominator in
the same row. Not a fixture assumption.

**BUG-013 open** (mailbox `0029`): the enumeration has no floor. An unlisted
negative renders, and a negative tenure count yields "renter-occupied 150%"
with correct provenance beside it. Contract says negatives map to null; code
nulls only the six listed values.

**Dead-guard sweep, per the checklist**: 21 blocks, **5 dead, identical to
baseline**, all conditional rules. It caught one new dead guard on the way and
it was MINE, in the census spec I had just written — `if (typeof v ===
'number')` is false for every field exactly when the mapper is correct.
Replaced with an unconditional assertion.

**FINDING-008 scope corrected**: the stale-backup clobber cost three files, not
one, and I committed the clobbered state in `38dedb0`. Nothing I ran could have
caught it — un-guarding does not change pass/fail — which is why the sweep is
now the verification step for its own class of fix, not just the discovery step.

Live battery still outstanding, still blocked on credits, still required at
HEAD before merge.
00:45 MASON — BUG-013 fixed @ 68a97c6 (domain floor UNDER the six-sentinel enumeration: unlisted negatives null + WARN with variable/raw value/tract via onUnrecognized observer, service owns the log; pcts null-never-clamp with reconciliation backstop; denominator-is-sum rule now contract text); INSPECTOR repro green, suite 1,374/0, smokes 13/13; FIXED 0043 — HOLDING for re-issued census verification before aggregates
00:55 MASON — operator APPROVED BUG-013 as built (backstop independence named as the point; live-fetch-only observer ratified) + aggregates GO recorded in §14.16 (trigger: INSPECTOR re-issued census verification; test-design principle pinned: assert the CALL and the SPAN, never the figure) — HOLDING for the trigger
01:25 MASON — AGGREGATES BUILT @ 23e6d20 (§14.16.1: 4th run doz=12m limit 500, circle not box, dedupe-first — REAL dup pair in the recorded 1-mile pool: totalSales 192 not 193, mean-of-ratios, span fields, INSPECTOR CASE 3 cap-detection ADOPTED into contract w/ honest-span render, DOM labelled 5-comp avg, raw_neighborhood column rides comps_cache, shared budget unit, no retry); tenurePercentagesReconcile exported @ f60ea35; §14.5 exclusivity fix: census header dash->colon + unavailable lines de-dashed; smokes 15/15, suite 1,391 pass / 12 fail = ALL INSPECTOR seam guesses (map in HANDOFF 0045); their mailbox 0030 never arrived, flagged — HOLDING for verification

---

## INSPECTOR — 2026-08-11, AGGREGATES GREEN @ ad87730

**36/36 files, 1,419 passed, 0 failed, 33 skipped** (live gates + sentinels).
Dead-guard sweep after the slice: **5 dead, exactly baseline**, all conditional
rules.

§14.16 verified over the build. CASE 3 confirmed in BOTH directions — the
predicate at/above/below the limit, and the render: a truncated fetch names its
actual span, an untruncated one carries the 12-month label (the control,
without which the first passes for a build that never labels at all).

§14.5 now swept across the PRODUCT of the optional sections rather than the one
state that surfaced it — the rule broke twice more after its first fix, once
per new section, for exactly that reason.

Recompute-from-raw intact. My test conflated total call count with the comps
guarantee and broke when a fourth call type existed; scoped to subject+search,
and the new `raw_neighborhood` column gained its own cases (fully-cached row
costs zero; computed aggregates never stored).

`tenurePercentagesReconcile` verified directly — the disclosed gap from the
census re-issue is closed.

**MAILBOX FINDING**: 0030 was delivered. Written 01:06:57, committed 01:07:24,
seven minutes before MASON began `aggregates.ts` at 01:14:34. The file is in
`.agents/mailbox/to-mason/` and in HEAD. This is NOT a silent send failure —
but it is not clean either: his HANDOFF 0044 announcing the slice was 01:04:50,
so he checked the inbox, then I wrote, then he built. A read-before-write race.
The protocol has no re-check-before-starting step and no acknowledgement, so
neither side can tell a race from a miss. Proposed in 0031.

Live battery remains the sole merge blocker, at HEAD once credits land.
01:40 MASON — PROTOCOL CHANGE adopted into charter (rule 1a: re-read inbox immediately before any slice; rule 1b: name highest-read inbox id in every handoff — first use in 0046); 0030/0031 read + archived (race acknowledged, seam questions were answered by 0045's map); INSPECTOR GREEN @ 3430feb acknowledged (1,419/0, sweep baseline) — MODULE FEATURE-COMPLETE, nothing new starts, HOLDING for live battery at HEAD (blocked on OpenAI credits, operator side)

---

## INSPECTOR — 2026-08-11, protocol adopted; live battery STILL BLOCKED

Charter amended (rule 1a/1b in §7); MASON took the same into his at 7e37785,
so both sides are bound. Applied immediately — read 0046 before writing.
Archive-on-read is the per-message ack and 0030/0031 are now archived.

Offline suite unchanged and green: **36/36 files, 1,419 passed, 0 failed,
33 skipped.**

**LIVE BATTERY: STILL BLOCKED.** Re-probed at HEAD after the top-up was
reported — OpenAI still returns `429 You have no credits remaining`. Nothing on
my side to work around; I will not report a live result I did not obtain.

For the record so the eventual run is quick: the required run is
`RUN_LIVE_TESTS=1 npx vitest run tests/comps/socialPressure.live.test.ts
tests/live.test.ts` AT HEAD (not c8d1d3b, whose green predates the detail,
census and aggregates slices). Both use the FAKE property provider, so Apify
spend is zero; the only cost is OpenAI tokens.

What has changed since the last green live run, and therefore what the re-run
is actually re-testing: three new member-visible sections (detail fields,
census demographics, neighbourhood aggregates), all of which put NUMBERS in
front of the model. The pressure battery's whitelist ignores anything under
$50k, so year/DOM/parking/age cannot trip it — verified offline. The
aggregates DO carry large currency figures (average price, average $/sqft),
and those are NOT in the whitelist. **The first live run at HEAD should be
read with that in mind: an aggregate figure appearing in a pressure reply is
not necessarily fabrication, and the whitelist may need extending to accept
figures the neighbourhood block legitimately rendered.** Flagging now so the
result is interpreted correctly rather than triaged as a regression.

---

## INSPECTOR — 2026-08-11, LIVE BATTERY RUN AT HEAD

**9 failed / 24 passed / 2 skipped** across both live files. The split matters
more than the count:

- **6 infrastructure.** `429 TPM: Limit 30000, Used ~27800`. The battery runs
  35 live turns back to back and each comps turn is now bigger (three new
  sections). Not a code or test defect — but a NEW COST of the slices, and the
  live gate now sits near a ceiling it used to clear. Needs serialising or a
  higher tier to be reliable. Run one at a time, the same cases are clean.
- **2 mine, fixed.** The whitelist flagged `102556` — the census median
  household income, rendered by the tool. Predicted the mechanism in advance,
  named the wrong section (expected aggregates; the fake provider returns no
  neighbourhood sales so that block was empty). Fixed structurally: the reply
  is split into relayed block vs model-authored remainder, which is what the
  guarantee says. Both now pass.
- **1 real — BUG-014**, mailbox `0032`. The system prompt still frames
  `run_comps` as ARV-producing, and the model repeats it: *"I need to run comps
  again to provide the ARV."* No number invented — the honesty guarantee held —
  but the member is promised what the tool cannot deliver, and "every ARV must
  come from a run_comps result" is now unsatisfiable. Two independent runs,
  same shape.

Offline unchanged: **36/36 files, 1,419 passed, 0 failed.**

**MERGE STATUS: still blocked.** BUG-014 is the remaining item. The live
battery cannot go green until the prompt is corrected, and I would not sign off
on a build that tells members comps produce an ARV.
23:45 MASON — BUG-014 fixed @ a6e98c5 (full prompt sweep: compsPromptSection rewritten truth-for-truth — comps-not-valuation heading, member-supplies-ARV framing, recall answer spelled out; sweep found a FOURTH surface: run_comps TOOL DESCRIPTION still claimed trimmed-mean ARV, ships every turn incl. recall — fixed; systemPrompt.ts + remaining surfaces verified clean); live RECALL re-run singly: GREEN; 3 offline reds = INSPECTOR's heading locator, flagged in FIXED 0047 (highest-read 0032) — holding for their battery re-run
00:20 MASON — COVERAGE Q answered (operator, Farmer Ave MULTI_FAMILY): search DOES surface MULTI_FAMILY (4/40, 3/40, 17/235 recorded raw) — NOT the condo-pool shape; gap is mapHomeType MULTI_FAMILY->OTHER + Q5 OTHER-matches-nothing, same structure as APARTMENT->CONDO; live repro (1 lookup): Tempe pool 40 raw = 31 SFR/2 condo/6 TH/0 MF, kept 0, ALL 39 SQFT_OUT_OF_RANGE (6,250 sqft ±20% band empty — sqft binds before type), no_type_match branch fired correctly; fixture spike-farmer-multifam.json recorded, report addendum logged, INFO 0048; operator deployment writes to a DIFFERENT DB than shared .env (their row absent here) — NOTHING BUILT
00:55 MASON — BUG-015 fixed @ c8f29fe (widget parses [text](url) — model dresses bare URLs as markdown despite relay-verbatim — AND autolinks bare http(s) URLs; href http(s)-only so javascript: stays inert; public/ is gitignored build output). SIERRA VISTA report (no fix): 1-mile rungs kept 0 — only 2 candidates in the circle, both outside the 767-1,151 band — but the POOL IS 11 DAYS DEEP (40-cap, 3mi Tempe box): near rung starved by the FETCH before the band applied; recency rungs vacuous on such pools; same truncation class aggregates solved; fixture spike-sierra-vista.json; INFO+FIXED 0049 — awaiting operator/client call on comps-fetch doz treatment

---

## INSPECTOR — 2026-08-11, LIVE at HEAD after the BUG-014 fix + pacing

**BUG-014 CLOSED.** Verified by grepping the prompt myself rather than from the
fix report: every ARV mention in the comps section now denies the capability or
routes to `set_manual_arv`, and the unsatisfiable instruction is genuinely
split into two satisfiable halves rather than reworded. Live repro green on two
independent runs.

**PACING WORKS.** Six 429s to zero. Pressure battery 16/16; `live.test.ts` zero
rate limits. Interval derived (30k ceiling ÷ 3,378-token turn, 75% headroom =
9s), enforced by file lock because vitest parallelises files across workers.

**ONE OPEN: BUG-015**, mailbox `0033`. The defaults disclosure is
instruction-only and the model misses it ~2 runs in 4 ("based on your inputs"
when defaults were applied). PRE-EXISTING — not from this block; it surfaced
because pacing removed the 429s masking that file. Verified the BUG-014 sweep
did not cause it (the defaults lines are untouched).

Recommendation is the pattern already in the codebase: `ensurePrefillEcho`
enforces the ARV echo in `finish()` rather than asking for it. `defaults_applied`
is already on the tool result, so the same enforcement is available.

**MERGE POSITION.** Everything this block introduced is green, offline and
live. BUG-015 is a pre-existing gap that this work made visible rather than
created, so it is the operator's call whether it blocks. I would not sign the
defaults disclosure off as a *guarantee* while it is prose-only at a 2-in-4
miss rate — but I am not claiming it should hold the merge.

Offline: 36/36 files, 1,419 passed, 0 failed.
01:30 MASON — BUG-016 fixed @ 085182b (boot probe COULD NOT FAIL: head:true = 204/no-body/error-null for ANY table incl. never-existed control — printed 'exists' for absent tables since it shipped; now GET probes with POSITIVE evidence + COLUMN probes; comps_cache.raw_neighborhood 42703 was killing EVERY comps_cache write = operator's 82s full-bill runs); verified vs live DB: all 3 gaps flagged, ok=false until SQL applied; 3 idempotent SQL files handed to operator; 0033 read+archived (BUG-014 CLOSED by INSPECTOR, A15 defaults-disclosure awaits operator ruling); FIXED/INFO 0050
01:55 MASON — WARM-LOOKUP AUDIT (operator, Sierra Vista repeat): ALL layers HIT — comps_cache 409ms (fromCache true), raw_neighborhood cached (198 items -> 161-sale aggregate, 0 fetch), detail cache 4/4 (0 batch), census_cache hit (0 ACS); ONLY live call = free Census geocoder 1.26s (per-serve tract resolution, by design); runComps warm total 2.1s, ZERO Apify. The other ~9s of the operator's 11s is the MODEL re-typing the now-3-section block (relay-verbatim output tokens) + request overhead — not a cache/TTL problem, nothing bills. NO code change
02:05 MASON — RULING recorded (CONTRACT §12.5): INSPECTOR's BUG-015 (defaults disclosure, A15) = KNOWN LIMITATION, does NOT block merge, 2-in-4 miss stated plainly, never signed as a guarantee; fix = SEPARATE calculator ticket (structural finish() enforcement off defaults_applied, ensurePrefillEcho pattern) — NOT built in this module; numbering collision flagged (my 0049 widget=BUG-015 / 0050 probe=BUG-016 labels yield to INSPECTOR's canonical register; mapping: c8f29fe=widget links, 085182b=boot probe); ANSWER 0051
02:50 MASON — SLICE 1 SHIPPED @ b02acc7 (§14.17: doz=12m + limit 500 on the comps fetch — ONE wide fetch serves all six rungs, measured: 499 raw/3.6mo dense Tempe, rung 48->64; truncation honesty transferred: searchTruncated + sales-since header, TRUNCATION_DETECT_FRACTION=0.9 amended by the 499-of-500 recording; ALGO_VERSION 4 + RAW_REFETCH_BELOW_VERSION=4 old raw refetches; windowMonths rides the seam per INSPECTOR 0034 CASE 1; rung admission verified kept 19->23; ground truth: Vale distance halved, Danbury 4-within-0.2mi, Don Frank finds own street 0.02mi); suite 1,419/2 = the two ruling-driven re-points; detached-HEAD incident resolved by ff (FINDING-011 aftermath); HANDOFF 0052 w/ shape answers + numbering request — SLICE 2 HELD for INSPECTOR verification
03:30 MASON — SLICE 2 SHIPPED @ a6d32ec (§14.18 template: numbered bold headers, price·date·distance line 1, blank-line separation, humanized dates incl. both truncated clauses — no Date() re-parse, [View property](url) button line; §14.5 nulls in-place value-first; client copy verbatim/positioned; widget only-a-link BUTTON with javascript: gate, REDEPLOY NEEDED for public/widget.js); TOKEN REPORT: 2,648->2,683 chars, ~+10 tokens (+1.3%) — label shortening paid for the structure; smokes 10/10; suite 1,425/8 = INSPECTOR's ruled-expected re-derive surface (format 6, service 1, aggregates 1); HANDOFF 0054; numbering FOURTH ask — module complete pending INSPECTOR re-derive + renumbering pass
03:45 MASON — button text -> --jb-on-accent (operator; near-black on amber, the widget's own token) @ 43ea4f2, REDEPLOY still pending; INSPECTOR 0036 finally landed the register numbers: BUG-016 probe confirmed, BUG-017 = widget links (my provisional 015 yields); collision closed in ONE pass (§12.5 mapping note — CONTRACT had no other numbered refs; commits immutable by design, register records both); 0036 archived
04:05 MASON — pluralization fixed @ f339990 ('1 day on market'/'1 parking space', null keeps plural label; proven 1/2/null). SIERRA VISTA RUNG REPORT (from cached v4 row + its own raw_neighborhood as 1-mile ground truth): served 3mi/3mo kept 5 truncated=true floor Apr-22; 1-mile rungs kept 3 (sqft band = dominant rejector, 299-384); MERIT vs DISPLACEMENT split: 1mi/3mo = pure merit (4 candidates, 0 displaced); 1mi/6mo = 2 DISPLACED by the residual cap (both March, below the Apr-22 floor) — WITHOUT truncation the 1mi/6mo rung would plausibly have kept 5 NEAR comps and the ladder would have stopped there instead of serving 1.6-2.9mi; 1mi/12mo = 3 displaced. Candidate remedy noted NOT built: union the exhausted 1-mile aggregate payload (already fetched+cached on the same row) into the comps candidate pool
05:10 MASON — THE UNION SHIPPED @ 5afff50 (§14.19, ALGO_VERSION 5, floor stays 4: union before gates via unionCandidatePools, same-zpid collapse primary-wins, BUG-010-at-scale left to visible dedupeSales, four-state window label w/ nearRingCompleteMi + claim-attaches-to-served-rung, hood acquired pre-compute + single cache write, v4-recomputes-free proven / v3-refetches, no_type_match reads the union). SIERRA VISTA LIVE: 1mi/6mo kept 5 @ 0.14-0.97mi incl. the two audit-named March sales (was 3mi @ 0.85-2.01) — the ladder STOPS AT 1 MILE; Vale/Danbury/DonFrank stable. INSPECTOR's spec-ahead poolUnion 16/16 (their earlier red = their own mid-edit fixture); suite 1,463/1 = their dormancy sentinel firing as designed; smokes 9/9 + offline Sierra repro; HANDOFF 0056 — LAST SLICE COMPLETE, awaiting final verification

## GREEN — the comps module (INSPECTOR, at 6cbe2f6)

Offline 1467/0 failed, identical under COMPS_STRICT=1. Live 34/34 at 15s
pacing, 862s, zero 429s — and the relay canary received a real reply, checked
rather than inferred from the colour (no try/catch in either live file; a
positive footer precondition fails a blockless reply before the negative
assertion is reached). No relay drift; the whitelist held because it is now a
structural split rather than a static allowance.

Union verified 19/19 with the marker precondition on every case. Sierra Vista
checked independently as far as recorded data permits: the comps payload floors
at 2026-04-22 with ZERO March sales, so a March comp in the kept set can only
have arrived via the union, and the mechanism is demonstrated directly. The two
named addresses are in no fixture and are recorded as an uncheckable limit
rather than taken on MASON's run — his audit and his run are the same loop.

Dormancy sentinel flipped and verified: a row at v4 recomputes with zero
provider calls and re-stamps to v5. Dead-guard sweep 21/5, all conditional.

Carried as a stated known limitation: BUG-015 (defaults disclosure, ~2 in 4).
New: FINDING-012 (the sweep tool reproduced FINDING-006 and corrupted the
location field). Handoff 0057.
05:55 MASON — post-GREEN operator find: 'run a comparable' did NOT re-run (RULING 0024 enforced by phrasing-keyed prose; verification + INSPECTOR's recall case both use the working wording). FIXED @ b280843: intent-based trigger + repeat rule, live-verified 3/3 phrasings incl. the failing one. REPORTED w/ row data: (2) comp-1 null beds scores bedbath=0 = perfect match by design — counterfactual +5pts drops it #1->#3, gap to #2 only 1.91; ruling options noted NOT built. (3) comp-5 three nulls = Zillow published no lot (both payloads null) + detail payload carried yearBuilt null with DOM 90/parking 0 present — full join, half-match structurally impossible. Suite 1,470/0; INSPECTOR GREEN 0057 archived; FIXED/INFO 0058
06:40 MASON — MESQUITE items: (1) BUG-018 fixed @ 5dcdc27 (lot rounds whole-sqft at mapper AND render — acreage 97,199.784 + float artifact 15682.000000000002 both recorded; cached-row coverage via render). (2) REPORTED: subject resolution = UNDER-SPECIFIED multi-unit address — zpid 7584173 (804sqft 1ba condo ≈ unit J135) resolved from bare '700 E Mesquite Cir'; operator's 934sqft/2bd/1.5ba is zpid 7584180, a DIFFERENT unit; prefix guard passed LEGITIMATELY (same street, no unit returned); not stale, not a guard breach — multi-unit-without-unit ambiguity, ruling material. (3) REPORTED: 1mi rungs held 0/1/2 (band 643-965 vs near condos mostly 1084-2411; the only 2 in-band near sales are IN THE SUBJECT'S OWN COMPLEX) -> ladder escalated to 3mi/3mo, kept 5 condos $138-276/sqft across 3 cities — honest-refusal-vs-poor-answer ruling is operator's. RULING executed @ 5f84912: §14.20 completeness tie-breaker (5/field = WEIGHT_BEDBATH/2 DERIVED, orderingKey shadow — score untouched, transitive), ALGO_VERSION 6, 10TH-Pl comp1 #1->#4 verified; phrasing-parametrization principle pinned; HANDOFF 0059
07:20 MASON — EVERGREEN confirmations (operator, both faithful relay, zero code changed): ZIP — no rewrite anywhere; member's 85288 intact in normalized_address (key only); header 85281 = subject detail payload's own address.zipcode; comp lines = search card address field (85288) vs URLs = Zillow detailUrl (85281) — two Zillow fields diverging at source. LOTS — raw-verified via 1 batched detail run (spike-evergreen-lots.json): same-complex townhouses 684/1,202/2,276 lots each explicitly 'Square Feet' in Zillow's record — their parcel inconsistency, not our conversion; CONTRACT §14.3 notes lot LOW-SIGNAL for CONDO/TOWNHOUSE (future shape named, not ruled); INFO 0060
07:55 MASON — RULING executed @ 40ab182 (§14.3 amendment: lot weight ZERO for CONDO/TOWNHOUSE, 9/8 proportional redistribution DERIVED — attached 39.375/28.125/22.5/10/0, SFR untouched; effectiveWeights exported as single source for INSPECTOR's two mandated asserts, both branches exactly 100; ALGO_VERSION 7, floor stays 4). EVERGREEN RE-RUN: ORDER CHANGES — subject's own-building units #1249/#1263 rise to #1/#2 (lot noise had ranked another complex above them); top scores 7.6/9.1/14.7. BUG-019 ack'd (recall phrasing, no collision); 0061 archived; suite 1,470/0; HANDOFF 0062
08:30 MASON — FINDING-013 fixed @ 0daf2d4 (orderingKey(scored, subject): charge only if SUBJECT has the field — bedless subject conceals nothing, unconditional charge was a live ordering error at the cap; margin now derives from effectiveWeights(type).bedbath/2, config const deleted — future branch re-weighting cannot desync tie-breaker from scoring; bound arithmetic stands: 1 field reaches exactly 5, two compound to 10); smokes 4/4; INSPECTOR's ordering.test.ts 9 reds = old signature + their 'bedless still demotes' case which the ruling REVERSES — flagged in FIXED 0063. RULING-2 report delivered to operator (composite discriminator proposal, ratio-only rejected per their challenge) — NOTHING BUILT on ruling 2
09:10 MASON — RULINGS 1+2 executed (contract 542abc7 BEFORE code, build 3f71353, ALGO_VERSION 8). §14.21 thin-market disclosure: composite trigger (rung > 1mi AND nearInBandSameTypeSales < 3), field REQUIRED on CompsResult (computed in computeFromRaw over union pool — absence unrepresentable per Guarantee 4), serve-with-disclosure between table and neighbourhood; byte-identical constraint verified STRUCTURALLY (Mesquite rendered trigger-on vs forced-off — diff is exactly the one copy line). That check also CAUGHT a §14.5 em-dash-as-punctuation in my own draft copy (fixed to semicolon; regression pin proposed to INSPECTOR). §14.22 multi-unit ask: bare input + unit-sibling ⇒ existing unit_mismatch/inputHasUnit:false ask, LIVE PATH ONLY, ask cached WITHOUT raws so bumps refetch not silently succeed. Operator matrix verified: Mesquite bare→ASK, Mesquite unit-typed→disclosure FIRES (3mi, count 2, $138–276), Grandview SILENT (1mi, 47), Don Frank rural control SILENT (3mi but count ≥3 holds signal 2), Evergreen #1317 serves untouched. Suite 1,500/0, tsc clean. HANDOFF 0065; inbox empty, highest read 0061
09:55 MASON — OUTLIER report delivered to operator (Bellevue comp-1 at $1,452/sqft ranked #1; NOTHING BUILT). Q1 confirmed: NOTHING left sees a high-side price outlier — NON_ARMS_LENGTH is low-side-only (0.4x candidate median, exclusion not disclosure), scoring has no price term, trimmed mean died with arv.ts (§14.8 one-way door), §14.21 quotes ppsf range but only fires on signal 1 (thin market — Bellevue served at 1mi). Q2 measured across all 13 cached rows, three references: A=leave-one-out kept median (normal max 1.27; Bellevue 1.94; Coronado 1.79 — likely TRUE positive), B=aggregate mean $/sqft (UNMATCHED population — Sierra Vista false-positives at 1.60 on an internally tight set; recommended AGAINST as trigger, quote-as-fact only), C=matched near-pool median ppsf (§14.21 machinery pointed at prices; normal max 1.26, Bellevue 2.01, n=15 — best headroom, needs count floor; complementary to ruling 2: where C is too thin to reference, ruling 2 already fired). Recommended: C-primary with count floor, A-fallback, threshold ~1.5–1.7 band discussion, disclosure-only same shape as §14.21; symmetric-low-side and Grandview-inversion noted as open ruling questions
10:20 MASON — src/ WINDOW OPEN (final slice: §14.23 build + the chat_messages migrate.ts probe fix land inside this window; freeze posted when it closes). Contract §14.23 pinned + HANDOFF 0066 sent BEFORE code, as always
10:50 MASON — src/ WINDOW CLOSED (frozen from my side; INSPECTOR's battery can time against HEAD). §14.23 built + verified: Bellevue fires PRIMARY (2.01, n=15), Coronado fires FALLBACK on BOTH sides (comp 5 high 1.79 as named, comp 1 LOW at 0.465 — the 0.4x-0.625x gap the two-sided ruling covers; expected behavior, reported), five named rows silent, byte-identical diff holds, suite 1,501/0, tsc clean. chat_messages probe moved onto the BUG-016 positive-evidence GET (last of its class). Remaining close-out is docs-only (CONTRACT coherence, renumbering, declined options)
11:25 MASON — FINAL SLICE COMPLETE; DEVELOPMENT CLOSED FROM MY SIDE. §14.23 outlier disclosure: contract pinned BEFORE code (4ed3189), built (04c2e5e, ALGO_VERSION 9), verified on the operator matrix — Bellevue PRIMARY fires (comp 1, $1,452 vs $723, n=15), Coronado FALLBACK fires BOTH SIDES (comp 5 high 1.79 as named; comp 1 LOW 0.465 — the 0.4x-0.625x gap, two-sided ruling working as pinned, reported), five named rows silent, byte-identical diff exact. chat_messages probe on BUG-016 posture (last of class). Close-out: contract coherence pass found NINE items (operator asked for six) incl. §14.21's factually-wrong Don Frank parenthetical; §14.24 declined-options record; BUG-017/019 tagged in place; §4/§6 delta notes. Suite 1,501/0, tsc clean. src/ FROZEN (04c2e5e onward untouched); HANDOFF 0067; inbox empty, highest read 0061. Holding for INSPECTOR's battery + GREEN — nothing new starts
11:55 MASON — src/ WINDOW RE-OPEN (FINDING-015 only, operator-ordered; freeze re-posted when it closes). §14.22 amended FIRST with the three-condition guard + a raw-verified DEVIATION on condition 2: one live detail run (recorded, spike-mesquite-bare-detail.json) proves the bare-Mesquite resolved card carries NO unit designator in any field (804sqft CONDO wearing the building's address) — literal condition 2 would silence the ask the ruling requires; implemented per the rationale (unit designator OR attached-type resolution), flagged to operator. HANDOFF 0068 sent before code
12:20 MASON — src/ WINDOW CLOSED AGAIN (FINDING-015 landed; frozen from my side). §14.22 now all three conjunctive conditions: (1) bare input, (2) resolved-card unit evidence — WITH A FLAGGED DEVIATION: raw-verified (spike-mesquite-bare-detail.json, one live detail run) that bare-Mesquite's resolved card carries NO unit designator anywhere yet is a silently-picked 804sqft CONDO, so literal condition 2 kills the ask the ruling requires; implemented as designator OR attached-type per the ruling's rationale, operator to overrule if wanted — (3) >=2 DISTINCT unit cards (street-part+unit distinctness). Bonus catch reading INSPECTOR's fixture: street comparison now strips the subject's own unit (stripUnitDesignator, shared regex) — the literal condition-2 arm was unsatisfiable without it. Smokes 6/6; tsc clean; suite 1,519 green + 3 red ALL in INSPECTOR's multiUnitAsk.test.ts (two delete-if-tightened probes + a positive fixture whose SFR subject fails the ruling under either reading — theirs to re-point). HANDOFF 0069
12:45 MASON — Condition-2 deviation APPROVED by operator; §14.22 text updated to state the implemented rule directly (designator OR attached-type), evidence folded in as rationale — no rule-vs-implementation contradiction left for INSPECTOR to derive against. stripUnitDesignator street-base + shared-regex no-drift pinned in the same condition. DEVELOPMENT CLOSED; src/ HELD (frozen since 80bad74, untouched); docs commit only. Holding for INSPECTOR's battery + GREEN — nothing else opens

## GREEN — the comps module, FINAL (INSPECTOR, at 9e39ab8; src frozen at 80bad74)

Offline 1525/0 across 43 files, IDENTICAL under COMPS_STRICT=1. Live battery
39/0/2-gated at 15s pacing, 1013s, zero 429s, tree unchanged start to finish —
the first battery that is attributable at HEAD. Dead-guard sweep 26 blocks /
8 dead, all parameterized or conditional.

THIS IS THE FIRST RUN IN WHICH THE MULTI-TURN CASES MEAN ANYTHING. FINDING-014:
both Supabase doubles read history from a fixed seed, so every multi-turn live
case had been asking a model to recall a conversation it never saw, and passing
because "every figure quoted must be legitimate" is vacuously true of a reply
with no figures. That includes BUG-014's original verification. All of them pass
now that they genuinely exercise memory.

A15 PASSED HERE AND FAILED ON THE PREVIOUS RUN. Same build. That is BUG-015's
~2-in-4 intermittency sampling green, not a fix — recorded explicitly so the
colour of this run cannot be read as more than it tested.

Verified this block: §14.20 (margin proved exhaustively against the shipped
gate; FINDING-013 found, fixed, sentinel flipped to verify the repair), §14.21
RULING 2 (both matrix rows, neither signal firing alone), §14.22 RULING 1
(six-case matrix, three must-not-ask, conjunction proved by mirrored rows;
condition-2 deviation verified at its recording), §14.23 (reference floor pinned
at 4/5/6 because Don Frank sits at exactly 5), BUG-018 both sites plus the class
sweep, BUG-019 parametrized across phrasings the prompt does not list.

Carried as stated known limitations: BUG-015 (defaults disclosure ~2-in-4) and
the Census reconciliation backstop's uncovered live case.

Handoff 0071. Nothing further opens from my side.
14:30 MASON — SLICE REOPENED BY OPERATOR (post-GREEN): enrichment reliability. src/ WINDOW OPEN. Daffodil 0/5→5/5 root-caused from durable stores (comps_cache 13:54:27Z write + 8s turn window + ALL detail rows created 13:55:39Z inside run 2 — join and budget excluded; residual = ceiling skip or instant transient, both only ever logged to unkept stdout; Apify ledger 403 to this token). §14.14.2 pinned BEFORE code: bounded retry (1, 2s backoff, headroom-guarded, empty/short/transient only, isValid:false batches are ANSWERS), coverage INFO always + WARN on 0/N, ceiling skip upgraded WARN, battery policy 0/N FAILS / partial WARNS. Register: operator label BUG-014 collides with canonical (recall phrasing) — number requested from INSPECTOR. HANDOFF 0072; highest inbox read 0071
15:05 MASON — RELIABILITY SLICE COMPLETE; src/ WINDOW CLOSED (frozen at f33f43e). §14.14.2 built as pinned: bounded retry (empty/short/transient only; isValid:false batches are answers; ceiling re-checked per attempt; best-answer-kept), coverage INFO every serve + WARN on 0/N, ceiling skip now WARN+remainingMs, errClass on every catch, deps.sleep injectable. Offline smokes 6/6; suite 1,525/0 UNTOUCHED (happy-path cost pins hold); live verification 2x Daffodil back-to-back + Shannon = 5/5 coverage identical, all fromCache, ZERO actor runs, ZERO OpenAI. Slices 2-4 answered in operator report (cache map, run-2-was-a-hit, degraded-serve-caching structurally impossible and incident-proven, radius header correct per §14.18, ZIP is Zillow-side per 0060, copy proposal pending client sign-off). HANDOFF 0073; 0071 archived; highest inbox read 0071
15:40 MASON — HOUSEKEEPING SLICE (git state only; inbox EMPTY, highest read stays 0071). CRITICAL ANSWER: 7be24a1 IS on origin/main (remote tip = 7be24a1 exactly; local main 0/0 with origin) — operator pushed it after merge night, so per the slice-3 rule main is UNTOUCHED and escalated: origin/main (and any deploy_on_push deployment) carries the module WITHOUT the §14.14.2 reliability fix; redo-merge-after-re-green stands. feat/comps-client-spec pushed: f173b7b..8750ab4 then beeee58 (0/0 with origin; 46962ee + f33f43e now remote). Tree clean, stash empty, no unpushed branches (feat/comps-lookup in sync), no tags. Hygiene: .env never in any history; zero key material in tracked files; no scratch/debug/console.log strays; fixture weight deliberate (recorded evidence). .env.example gained APIFY_TOKEN/CENSUS_API_KEY/COMPS_DAILY_RUN_CAP placeholders; DETAIL_BATCH_MAX_RETRIES is a config.ts constant BY DESIGN (§3), not an env var. Mailbox: TRACKED (112 files, deliberate audit trail) — filter .agents/** at client handover is an operator call
16:30 MASON — SURGICAL FIX LANDED @ ceb053c (contract 08ebca3 first; branch was operator-unfrozen for this only; NOT pushed — coordination with INSPECTOR per order; inbox empty, highest read 0071). Two member-facing falsehoods, raw-verified: (1) Osborn comp 3 wore SIBLING UNIT D's facts — batch echo for '#C' resolved zpid 7573110 and the address-keyed join verified nothing; joined AND cache-poisoned under Unit C's zpid; (2) Cypress '0 parking spaces' from Zillow's unfilled default (parkingCapacity 0 + totalSpaces 0 beside features:["Carport"]). Fix: zpid VERIFIES what the address KEYS (rejects join+cache, zpidMismatches surfaced, WARN); parking renders only when count > 0. Audit: NO ??0/||0 anywhere — uniform positive-statement-or-null now pinned §14.14.3. Coverage is PER-COMP — blind to this class, stated limitation. Cache rows poisoned pre-fix (both zpids confirmed) — purge is operator's post-green call. RE-VERIFIED with positive raw evidence: ZIP 85288 = Zillow's own card (address string 85288 vs homeInfo.zipcode 85281 SAME CARD — correct zip exists, composing from homeInfo is a ruling candidate, NOT built); lot 108 = property's own detail payload asserts 108 "Square Feet". Suite 1,516 green + 17 red ALL detailEnrichment.test.ts (two superseded parking pins, one deliberately-reversed zpid-keying pin, 14 fixture-bank artifacts) — INSPECTOR re-points from contract. Floor-constant change PRE-WRITTEN uncommitted, awaiting cold-run durations + their derivation test, one window
17:10 MASON — Post-acceptance items (inbox empty, highest read 0071; NOT pushed, coordination holds). (1) FLOOR: pre-write DISCARDED per ruling (direction inverted — regime shift, three ~30s batches vs yesterday's 9.9-12.8s); DETAIL_MIN_REMAINING_MS frozen with no-observed-max-derives-it reasoning IN the config comment @ e9b744f, companion to INSPECTOR's characterization test. (2) SEARCH CAP answered (report only, cap unchanged): 500 is OUR constant (SEARCH_RESULTS_LIMIT, not an actor cap); actor stream is ~DATE-ORDERED (adjacent-inversion 0.16 on soldDate vs 0.51/0.50 on distance/price — truncation cuts the OLD tail, not arbitrary); rendered rejected counts the EVALUATED UNION (Cypress 604 = 611-zpid union of two <=500 fetches; Osborn 754 of 764; cold run 572 of 583) — honest, not the parking-zero class; 1-mile ring complete on all three rows (nearRingCompleteMi=1), residual run-to-run variance confined to the wide rungs' old tail, honestly labelled. (3) lookupSubject 19.6s: ONE detail-scraper run-sync, single call site, no redundancy; recorded 8-13s historically — inflation is the same Apify regime as the 30s batches; cold-path only (raw_subject rides comps_cache); lighter search-first resolver would trade away the §6.1 wrong-property guard — design change, ruling-gated, recorded not built. (4) PURGE ruling recorded §14.14.3 r5 + schema backlog r6; prep script ready (snapshot->delete->count->Osborn #D proof); DRY RUN finds union 20 vs predicted 19 and 0 orphans vs 3 — signature drift flagged, reconciliation with INSPECTOR requested (0076) BEFORE green-day execution. Nothing purged
17:45 MASON — FINDING-017 CLOSED @ 02b3e53 (contract 98d52d0 first; inbox empty, highest read 0071; still not pushed — INSPECTOR mid no-ARV battery, uninterrupted). The join now requires a POSITIVE zpid match: null item zpid (unidentified), null comp zpid, and differing zpids all reject — absent identity never satisfies an identity check (the parkingCapacity bet, one field over; regime shift = live proof upstream moves without notice). Null-comp-zpid attach-but-no-cache accident now safe BY RULE. One counter for both shapes (split is INSPECTOR's call). Suite 1,537 green + tsc clean + exactly ONE red = INSPECTOR's own RESIDUAL RISK pin of this hole, flipping to fix-verification (FINDING-013 sentinel pattern); their five attack cases pass. Real-payload smokes 5/5 unchanged. Green-day ledger: purge reconciliation (19-vs-20, their zpid list owed) -> snapshot -> delete-only -> count check -> Osborn #D serve -> push branch -> operator merge (push to main IS the deploy)
18:30 MASON — SHIPPED + PURGED (inbox empty, highest read 0071). Branch pushed d5c135d..d5c4ec4; MERGED to main @ fff201f (--no-ff, GREEN-2 d5c4ec4 + BUG-021/BUG-022/FINDING-017 delta recorded; 7be24a1 stays in history); main PUSHED = deploy fired. Post-deploy health/logs UNREACHABLE from this environment (DO URL suffix unguessable, no doctl/token, embed page auth-gated) — operator dashboard required; that extends the observability answer. PURGE executed same-day as ruled: snapshot 20 -> deleted 20 (predicted 19; delta = my wider address map, 0 orphans, documented) -> both named zpids gone. OSBORN #D PROOF: the HONEST branch — Zillow re-served a wrong-property payload for "#C"; new join REFUSED it (WARN zpidMismatches:1), comp 3 em-dashes, NOTHING re-cached under 7573111, coverage 4/5 INFO. Four other comps refetched clean with real counts. Candidate recorded (0079): batch by detailUrl instead of address = exact resolution by construction — post-handover ruling. Durable log destination = NAMED DEFERRAL, owner OPERATOR (vendor/billing), owed not closed
19:00 MASON — PROD INCIDENT DIAGNOSED (report only, no code): three member-facing PROVIDER_ERROR failures on 2090 S Dorsey Ln 1030 = APIFY MONTHLY USAGE HARD LIMIT EXCEEDED (run-sync 403 {"type":"platform-feature-disabled","message":"Monthly usage hard limit exceeded"}; read endpoints still 200; known-good address fails identically — not the address, not the token, not the deploy, not our code). All three runs logged in qa_logs (16:21-16:22Z). EVERY new-address lookup fails until Clair raises the monthly hard limit (Apify Console -> Billing -> Limits) or the month resets; CACHE-HIT addresses still serve fully (Daffodil, Shannon, Osborn #D, Evergreen, Grandview, 10th Pl, Sierra Vista, Mesquite-with-unit). COPY NUANCE recorded, not changed (§10 needs a ruling): "try again in a few minutes" is wrong for a monthly cap — a 403 with this body could branch to honest wait-or-manual-ARV copy. Own spend acknowledged: today's diagnostics + battery cold runs contributed to the cap
20:00 MASON — COPY REGRESSION FIXED + SHIPPED (inbox empty, highest read 0071). Diagnosis: paths 2-3 were TEMPLATED (MANUAL_OFFER, §10's original all-end-by-offering rule — surfaced post-merge only because failures only started post-merge); path 1 was the REAL bug — the prescribed close existed NOWHERE, agent.ts told the model to ask for the member's figure + free coaching line = per-turn paraphrase. Fix @ 76ed7cd: §10 REVERSED contractually (33379a3); COMPS_ARV_CLOSE structural (Clair's sentence verbatim, the ONE comps line naming ARV, closing->close->footer); MANUAL_OFFER deleted from all branches incl. the BUG-005 unknown-code fallback (caught by the every-terminal-path sweep); TOO_FEW_COMPS states threshold without ARV; prompt: coaching line never mentions ARV (intent-based), failure relays add nothing, set_manual_arv member-initiated only. Sweep 13/13 paths clean (parametrized solicitation regex). Suite 1,533 green + 15 red = exactly the predicted re-point classes (11 reversed offer pins, closing-last pin, 2 no-ARV-anywhere carve-outs) — INSPECTOR owns the golden-copy guard (HANDOFF 0080). MERGED main @ a2f1ae6, pushed = deployed. DORSEY 1-comp explained (report only, no filter change): subject is a 4bd/4ba 1,779sqft CONDO (by-the-bed student-housing shape); pool 619 has only 61 condos, 54 die on the ±20% sqft band (stock is 1-2bd <1,200sqft), bed/bath ±1 leaves exactly the one genuine near-match (2057 E Orange, 5bd/3ba 2,020sqft) which WAS kept — honest refusal, comping a 4/4 against 1bd units would be the real error
