/**
 * Chat rendering for comps outcomes (CONTRACT §10, §11). Pure and
 * deterministic: the same outcome object always renders the same string.
 *
 * This is the honesty layer. The LLM is handed this rendered block and told
 * to relay it — it never authors comp data, so a hallucinated comp cannot
 * exist. Everything a member could ask "why?" about is IN the render: every
 * per-comp fact with explicit em-dash nulls, which tiers produced the set,
 * and how many candidates were rejected. (The trim/ARV arithmetic this
 * comment once promised is gone with the ARV itself — CONTRACT §14.8.)
 */
import {
  MIN_COMPS_TO_COMPUTE,
  NEIGHBORHOOD_RADIUS_MI,
  OUTLIER_PPSF_RATIO,
  OUTLIER_REFERENCE_MIN_COUNT,
} from './config.js';
import { median } from './filter.js';
import type { CompsFailure, CompsFailureCode, CompsOutcome, CompsResult, ScoredComp } from './types.js';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/**
 * Retains all three required elements — automated estimate, public sold data,
 * not a formal appraisal, verify before acting — with the ARV reference
 * dropped: the client removed the ARV from this response (CONTRACT §14.8), so
 * telling a member to "verify the ARV" pointed at something no longer on
 * screen. Our copy, not the client's prescribed §14.7 text, so it is ours to
 * correct.
 */
const FOOTER =
  '_Automated estimate from public sold data, not a formal appraisal. Verify these comps with your agent before you act._';

/**
 * §10 failure copy, one entry per code, single source of truth — AMENDED BY
 * OPERATOR RULING (2026-08-12): a failure message says what went wrong and
 * what to do next. It does NOT pivot to deal numbers, and NO failure path
 * names or solicits an ARV — the old MANUAL_OFFER tail is deleted from every
 * branch. (Manual ARV survives REACTIVELY: a member who volunteers a number
 * flows through set_manual_arv; we stopped asking, not listening.) The one
 * member-facing comps line that names ARV is COMPS_ARV_CLOSE below. NONE of
 * these contains a number that could be mistaken for an ARV.
 */
export const FAILURE_COPY: Record<CompsFailureCode, (detail?: CompsFailure['detail']) => string> = {
  // Branched on detail.resolution, then on inputHasUnit (operator rulings —
  // one code, three truths): a wrong-property match means the address may be
  // perfectly real, and each variant blames only what the member can act on.
  // "Double-check the unit number" is only sayable when they typed one.
  ADDRESS_NOT_FOUND: (detail) =>
    detail?.resolution === 'unit_mismatch'
      ? detail.inputHasUnit
        ? "I found the building but couldn't match that exact unit. Double-check the unit number and " +
          "I'll try again."
        : "I found the building but Zillow couldn't pin it to a specific property. If it's a condo or " +
          'apartment, try including the unit number.'
      : "I couldn't find that address on Zillow. Double-check the spelling, and include the city and state — " +
        'e.g. "123 Main St, Phoenix, AZ".',
  SUBJECT_SQFT_UNKNOWN: () =>
    'I found the property, but Zillow has no square footage on record for it — and without the size I ' +
    "can't do the price-per-square-foot math honestly, so I can't build a comp set for this one.",
  // Branched on detail.pool (operator ruling): an empty kept set over a pool
  // with ZERO same-type comps means we didn't find the right pool — telling
  // that member "the market is thin" misassigns the blame to their market.
  // The comp threshold is stated WITHOUT invoking ARV (§10 amendment).
  TOO_FEW_COMPS: (detail) =>
    detail?.pool === 'no_type_match'
      ? "I found sold homes nearby but none of the same property type as yours, so I can't build a " +
        'reliable comp set here.'
      : `Not enough recent sales to work with: I found ${detail?.kept ?? 'fewer than the minimum'} usable ` +
        `sold comp(s) within ${detail?.radiusTierMi ?? 2} mi in the last 12 months, and I need at least ` +
        `${detail?.needed ?? 3} to build a reliable comp set. The market there is too thin for automated comps.`,
  PROVIDER_TIMEOUT: () =>
    "The property data source didn't answer in time. That's on their end, not your address — give it a " +
    'minute and ask me to run the comps again.',
  PROVIDER_ERROR: () =>
    'The property data source returned an error — nothing wrong with your input. Try again in a few ' +
    'minutes.',
  RATE_LIMITED: () =>
    "Comps lookups are capped for the day (each one costs real money to run), and today's budget is " +
    'used up. Try again tomorrow.',
};

/**
 * The client's prescribed copy (CONTRACT §14.7) — VERBATIM, emitted
 * structurally by this renderer. Not model-authored and not prompt-dependent,
 * because "helpful" paraphrase is exactly the failure mode: this is the
 * client's own compliance wording.
 */
export const COMPS_OPENING =
  'Sure. Here are recent comparable sales for that location and home type. Please note responses ' +
  'are for education and based on available public data. Investors are encouraged to review each ' +
  'address for additional information.';

export const COMPS_CLOSING =
  'Evaluate each property carefully. Current quality of home, overall appeal, lot location and ' +
  'usability can drastically impact value. Also consider external factors such as view properties, ' +
  'environmental concerns, powerlines and busy roads.';

/**
 * §10 amendment (operator ruling, 2026-08-12): THE one member-facing comps
 * line that names ARV, VERBATIM and STRUCTURAL. It previously existed only
 * as a prompt-suggested idea the model paraphrased per turn — "choose an ARV
 * from these comps… let me know if you have a figure in mind!" reached
 * members. Prescribed copy that lives in a prompt is not fixed, it is
 * requested; this line now rides the rendered block like every §14.7 string.
 * Emitted after COMPS_CLOSING, before the footer.
 */
export const COMPS_ARV_CLOSE =
  "If you want to run deal numbers, you'll need to supply your own ARV based on these comps.";

/**
 * The null marker (CONTRACT §14.5). No-fabrication extends to every column: a
 * missing field is SHOWN as missing, never omitted (which reads as "not
 * applicable"), never inferred, never back-filled from a sibling comp or the
 * subject.
 */
const NA = '—';

const num = (v: number | null | undefined, suffix = ''): string =>
  v === null || v === undefined ? NA : `${v.toLocaleString('en-US')}${suffix}`;

/**
 * BUG-012: a year is an IDENTIFIER, not a quantity — "1,928" is a count of
 * something, "1928" is when the house was built. num() stays correct for
 * sqft/lot (genuine quantities, separators wanted); anything year-shaped
 * must route through this instead.
 */
const year = (v: number | null | undefined): string => (v === null || v === undefined ? NA : String(v));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * §14.18 goal 4: dates read as dates — "2026-08-05" renders "Aug 5, 2026",
 * everywhere member-visible. Formatted from the CALENDAR STRING directly,
 * never through Date() — re-parsing an ISO date shifts it across timezones,
 * which is precisely BUG-006's mechanism. Anything unparsable is a missing
 * value and renders the §14.5 marker.
 */
/**
 * Count + unit with real pluralization — "1 parking space", "2 parking
 * spaces" (operator-caught: the block the model re-types showed "1 parking
 * spaces" on every single-space comp). Null keeps the PLURAL label next to
 * the §14.5 marker ("— parking spaces"), the established null form.
 */
const counted = (v: number | null | undefined, singular: string, plural: string): string =>
  v === null || v === undefined ? `${NA} ${plural}` : `${v.toLocaleString('en-US')} ${v === 1 ? singular : plural}`;

const humanDate = (iso: string | null | undefined): string => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return NA;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : NA;
};

/**
 * One comp entry, §14.18's pinned shape: numbered bold address header (goal
 * 5 — "best match first" VISIBLE), three value-first fact lines with the
 * member's top questions on line one (goal 1: sold price · date · distance),
 * then the link on its OWN line (the widget's only-a-link rule renders it
 * as a button). Blank-line separation between entries is the caller's (goal
 * 2).
 *
 * §14.5 holds in the value-first layout: a null renders the marker IN
 * PLACE with its static label adjacent ("Built —", "— bd / — ba",
 * "—/sqft") — never omitted, and the em dash appears nowhere else. The
 * link is LOAD-BEARING (§14.9): unbuildable renders the literal text
 * "link unavailable", never an empty or dead control.
 * architecturalStyle / propertyCondition remain CAPTURED but NOT rendered
 * (operator directive — display needs its own client ruling).
 */
function compEntry(s: ScoredComp, index: number): string {
  const c = s.comp;
  const price = c.soldPrice === null ? NA : USD.format(c.soldPrice);
  const ppsf =
    c.soldPrice !== null && (c.livingArea ?? 0) > 0 ? `${USD.format(s.pricePerSqft)}/sqft` : `${NA}/sqft`;
  const beds = c.beds === null ? NA : String(c.beds);
  const baths = c.baths === null ? NA : String(c.baths);
  const d = s.detail;
  const link = c.detailUrl ? `[View property](${c.detailUrl})` : 'link unavailable';
  return (
    `**${index + 1}. ${c.address}**\n` +
    `Sold ${price} · ${humanDate(c.soldDate)} · ${s.distanceMi.toFixed(2)} mi away\n` +
    // Lot rounds at RENDER too (BUG-018): cached rows written before the
    // mapper fix carry fractional lots for up to a 14-day TTL, and the
    // member must never see them.
    `${num(c.livingArea)} sqft · ${ppsf} · ${beds} bd / ${baths} ba · ` +
    `${num(c.lotSize === null ? null : Math.round(c.lotSize))} sqft lot\n` +
    `Built ${year(d?.yearBuilt)} · ${counted(d?.daysOnMarket, 'day on market', 'days on market')} · ` +
    `${counted(d?.parkingSpaces, 'parking space', 'parking spaces')}\n` +
    link
  );
}

/**
 * Thin-market disclosure (§14.21, RULING 2 — approved as proposed).
 * Composite trigger, both signals structural: the served rung exceeded the
 * 1-mile ring AND fewer than MIN_COMPS_TO_COMPUTE in-band same-type sales
 * existed within it. Serve-with-disclosure, never refusal: this is a line
 * of copy and nothing else — the comp set is byte-identical either way.
 * Guarantee 4: the block carries what a member needs to judge the set (the
 * 1-mile count, the radius served, median distance, and the ppsf range AS
 * A QUOTED FACT — ratio is never the trigger). All figures derive from the
 * served result itself. No em dash; no ARV.
 */
function renderThinMarketDisclosure(result: CompsResult): string | null {
  const fired =
    result.radiusTierMi > NEIGHBORHOOD_RADIUS_MI &&
    result.nearInBandSameTypeSales < MIN_COMPS_TO_COMPUTE;
  if (!fired || result.comps.length === 0) return null;
  const medianDist = median(result.comps.map((c) => c.distanceMi));
  const ppsf = result.comps.map((c) => c.pricePerSqft).sort((a, b) => a - b);
  const n = result.nearInBandSameTypeSales;
  return (
    `_A note on this set: only ${n} comparable sale${n === 1 ? '' : 's'} of this home's type and size ` +
    `closed within 1 mile in the past 12 months, so these comps come from up to ` +
    `${result.radiusTierMi} miles away (median ${medianDist.toFixed(2)} mi). Prices in this set range from ` +
    `${USD.format(Math.round(ppsf[0]))} to ${USD.format(Math.round(ppsf[ppsf.length - 1]))} per square foot; ` +
    `weigh each comp's location and condition accordingly._`
  );
}

/**
 * Price-outlier disclosure (§14.23, the FINAL slice) — per-comp lines, in
 * comp order, in the same disclosure slot as §14.21.
 *
 * Reference is two-level, both levels evidence-decided (the 2026-08-12
 * outlier report): the matched near-pool median when its sample clears
 * OUTLIER_REFERENCE_MIN_COUNT, else the kept set's LEAVE-ONE-OUT median —
 * each comp judged against the median of the OTHERS, so a comp cannot drag
 * its own reference (Coronado's 655 among 198–465 is why). The band is
 * TWO-SIDED (OUTLIER_PPSF_RATIO, high 1.6× and low 1/1.6): NON_ARMS_LENGTH
 * excludes below 0.4× and nothing else watches 0.4×–0.625×.
 *
 * Disclosure only: nothing here re-ranks, excludes, or rescales — the comp
 * set is byte-identical whether or not any line fires. Guarantee 4: the
 * copy NAMES its reference honestly; the fallback line must never claim to
 * be a neighbourhood figure. No em dash; no ARV.
 */
function renderOutlierDisclosures(result: CompsResult): string | null {
  if (result.comps.length < 2) return null;
  const usePool =
    result.nearInBandPpsfCount >= OUTLIER_REFERENCE_MIN_COUNT && result.nearInBandMedianPpsf !== null;
  const ppsf = result.comps.map((c) => c.pricePerSqft);
  const lines: string[] = [];
  result.comps.forEach((s, i) => {
    const reference = usePool
      ? (result.nearInBandMedianPpsf as number)
      : median(ppsf.filter((_, j) => j !== i));
    if (!(reference > 0)) return;
    const ratio = s.pricePerSqft / reference;
    if (ratio <= OUTLIER_PPSF_RATIO && ratio >= 1 / OUTLIER_PPSF_RATIO) return;
    const refClause = usePool
      ? `a neighbourhood median of ${USD.format(Math.round(reference))}/sqft for this home's type and size`
      : `a median of ${USD.format(Math.round(reference))}/sqft for the other comps in this set`;
    lines.push(
      `_Comp ${i + 1} sold at ${USD.format(Math.round(s.pricePerSqft))}/sqft against ${refClause}; ` +
        `weigh its price accordingly._`,
    );
  });
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Neighbourhood sales section (§14.16.1). Three states like demographics.
 * Guarantee 4 twice over: the section header carries geography AND window
 * verbatim ("past 12 months within 1 mile") in the same template as the
 * figures, and the DOM line exists ONLY inside its load-bearing label —
 * it is the average of the comps SHOWN, never the neighbourhood, and a
 * template that renders the number without saying so cannot be written
 * from this function. domCompCount 0 keeps the label and em-dashes the
 * number. Em-dash nulls everywhere; totalSales 0 is a real figure.
 */
function renderNeighborhood(
  neighborhood: CompsResult['neighborhood'],
  displayedCompCount: number,
): string | null {
  if (neighborhood === undefined) return null;
  // §14.5 marker exclusivity applies to these sections too: no em dash as
  // punctuation anywhere — the dash below means "missing value" only.
  if (neighborhood === null) {
    return '_Neighborhood sales data is unavailable right now; the comps above are unaffected._';
  }
  const n = neighborhood;
  const price = n.avgSoldPrice === null ? NA : USD.format(n.avgSoldPrice);
  const ppsf = n.avgPricePerSqft === null ? NA : `${USD.format(n.avgPricePerSqft)}/sqft`;
  const beds = n.avgBeds === null ? NA : String(n.avgBeds);
  const baths = n.avgBaths === null ? NA : String(n.avgBaths);
  const dom = n.avgDomOfDisplayedComps === null ? NA : String(n.avgDomOfDisplayedComps);
  // Cap-detection invariant (§14.16.1): a truncated fetch must NOT carry a
  // 12-month label — the actual covered span is the only honest window.
  const miles = `within ${n.radiusMi} mile${n.radiusMi === 1 ? '' : 's'}`;
  const window = n.windowTruncated
    ? n.earliestSaleDate
      ? `sales since ${humanDate(n.earliestSaleDate)} ${miles}; older sales exceeded the data limit`
      : `recent sales ${miles}; the full history exceeded the data limit`
    : `past ${n.windowMonths} months ${miles}`;
  return (
    `**Neighborhood sales** (${window})\n` +
    `${n.totalSales} sale${n.totalSales === 1 ? '' : 's'} · average price ${price} · average ${ppsf} · ` +
    `average ${beds} bd / ${baths} ba\n` +
    `Days on market: ${dom} (average across ${n.domCompCount} of the ${displayedCompCount} comps shown ` +
    'above, not a neighborhood figure)'
  );
}

/**
 * Demographics section (§14.10). Three states, mirroring the type: absent
 * field ⇒ NO section (unconfigured is not a failure); null ⇒ the
 * "unavailable" line — plain, blames nothing, promises nothing; present ⇒
 * the tract figures, every value from the API (or arithmetic on returned
 * counts), em-dash nulls, the ACS vintage named so a figure is never
 * presented as current-year truth.
 */
function renderDemographics(demographics: CompsResult['demographics']): string | null {
  if (demographics === undefined) return null;
  // §14.5 marker exclusivity: the em dash is the null marker, never
  // punctuation — hence the colon (BUG caught by the aggregates build: the
  // original header used a dash and would have broken the fully-populated
  // zero-em-dash guarantee the moment this section joined it).
  if (demographics === null) {
    return '_Neighborhood demographics are unavailable right now; the comps above are unaffected._';
  }
  const d = demographics;
  const income = d.medianHouseholdIncome === null ? NA : USD.format(d.medianHouseholdIncome);
  const age = d.medianAge === null ? NA : String(d.medianAge);
  const owner = d.ownerOccupiedPct === null ? NA : `${Math.round(d.ownerOccupiedPct)}%`;
  const renter = d.renterOccupiedPct === null ? NA : `${Math.round(d.renterOccupiedPct)}%`;
  return (
    `**Neighborhood snapshot**: ${d.tractName} (US Census ACS 5-year, ${d.acsYear})\n` +
    `Median household income ${income} · median age ${age} · ` +
    `owner-occupied ${owner} · renter-occupied ${renter}`
  );
}

function renderSuccess(result: CompsResult): string {
  const { subject, comps, rejected, radiusTierMi, recencyTierMonths } = result;

  // §14.17 + §14.19: the window claim attaches to the SERVED RUNG. Four
  // states, pinned in the contract — this is the one place the union could
  // quietly start lying, so each branch states only what its data covers:
  //  1. fetch not truncated                         → plain window claim;
  //  2. truncated, but the served rung sits at/inside the ring the unioned
  //     aggregate payload covers COMPLETELY        → plain claim, honestly;
  //  3. truncated, served rung beyond the complete ring → mixed truth:
  //     complete within the ring, capped beyond it;
  //  4. truncated, no complete ring                 → the §14.17 span label.
  const ring = result.nearRingCompleteMi;
  const servedRungFullyCovered = ring !== null && radiusTierMi <= ring;
  const beyondSince = result.searchEarliestSoldDate
    ? `sales since ${humanDate(result.searchEarliestSoldDate)}`
    : 'newest sales only';
  const windowClause =
    !result.searchTruncated || servedRungFullyCovered
      ? `sold in the last ${recencyTierMonths} months`
      : ring !== null
        ? `sold in the last ${recencyTierMonths} months within ${ring} mile${ring === 1 ? '' : 's'}; ` +
          `beyond that, ${beyondSince} (older sales exceeded the data limit)`
        : `${beyondSince} (older sales exceeded the data limit)`;
  const header = [
    `**Comps for ${subject.address}**`,
    `Subject: ${subject.beds ?? NA} bd / ${subject.baths ?? NA} ba, ` +
      `${num(subject.livingArea, ' sqft')} ${subject.propertyType}. ` +
      `Searched within ${radiusTierMi} mi, ${windowClause} ` +
      `(${rejected.length} candidate(s) rejected).`,
  ].join('\n');

  // §14.18 goal 2: one blank line between comp entries (and after the list
  // intro) — the numbered headers plus the gap are the visual separation.
  const table = [`**${comps.length} sold comps** (best match first):`, ...comps.map(compEntry)].join('\n\n');

  /**
   * THE emit order (CONTRACT §14.8, extended by §14.10 and §14.16.1):
   * opening → header → table → [neighborhood] → [demographics] → closing →
   * footer. The ARV block that used to sit after the table is GONE —
   * removed with arv.ts, not gated; reinstating it would be a rebuild from
   * the contract, not a line here. Both decoration sections slot where
   * they do so COMPS_CLOSING stays the LAST content before the footer,
   * exactly as pinned.
   */
  const sections: Array<string | null> = [
    COMPS_OPENING,
    header,
    table,
    renderThinMarketDisclosure(result),
    renderOutlierDisclosures(result),
    renderNeighborhood(result.neighborhood, comps.length),
    renderDemographics(result.demographics),
    COMPS_CLOSING,
    COMPS_ARV_CLOSE,
    FOOTER,
  ];
  return sections.filter((s): s is string => s !== null).join('\n\n');
}

/**
 * Failure render: the §10 copy the service minted, with a code-keyed fallback
 * (BUG-005) — `message` is required by the type, but a failure object built
 * anywhere else could omit it, and `undefined` reaching the chat renders as
 * the literal word "undefined". The fallback regenerates from the same table,
 * so the §10 guarantees hold even for a malformed failure object.
 */
function renderFailure(failure: CompsFailure): string {
  if (typeof failure.message === 'string' && failure.message.trim().length > 0) {
    return failure.message;
  }
  const copy = FAILURE_COPY[failure.code];
  return copy
    ? copy(failure.detail)
    : // §10 amendment: even the last-resort unknown-code fallback solicits
      // nothing — what went wrong, what to do next, and stop.
      'Something went wrong pulling comps this time. Give it a minute and ask me to run them again.';
}

export function renderCompsForChat(outcome: CompsOutcome): string {
  return outcome.ok ? renderSuccess(outcome) : renderFailure(outcome);
}
