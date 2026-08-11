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
