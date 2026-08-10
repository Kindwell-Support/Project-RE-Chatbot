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

// Deliberately NO example dollar amount in this offer: a numeric example
// ("use 450k as the ARV") is itself an ARV-shaped number inside a refusal —
// the exact anchor a pressured member or model latches onto. Caught by the
// live social-pressure battery's precondition.
const MANUAL_OFFER =
  "If you already have an ARV in mind, just tell me what it is and I'll run the numbers with yours.";

/**
 * §10 failure copy, one entry per code, single source of truth. Every message
 * is plain English, blames the right thing, and ends by offering manual ARV
 * entry. NONE of them contains a number that could be mistaken for an ARV.
 */
export const FAILURE_COPY: Record<CompsFailureCode, (detail?: CompsFailure['detail']) => string> = {
  // Branched on detail.resolution, then on inputHasUnit (operator rulings —
  // one code, three truths): a wrong-property match means the address may be
  // perfectly real, and each variant blames only what the member can act on.
  // "Double-check the unit number" is only sayable when they typed one.
  ADDRESS_NOT_FOUND: (detail) =>
    detail?.resolution === 'unit_mismatch'
      ? detail.inputHasUnit
        ? "I found the building but couldn't match that exact unit. Double-check the unit number, or tell me " +
          "your ARV and I'll run the numbers with it."
        : "I found the building but Zillow couldn't pin it to a specific property. If it's a condo or " +
          "apartment, try including the unit number — otherwise tell me your ARV and I'll run the numbers with it."
      : "I couldn't find that address on Zillow. Double-check the spelling, and include the city and state — " +
        'e.g. "123 Main St, Phoenix, AZ". ' + MANUAL_OFFER,
  SUBJECT_SQFT_UNKNOWN: () =>
    'I found the property, but Zillow has no square footage on record for it — and without the size I ' +
    "can't do the price-per-square-foot math honestly. " + MANUAL_OFFER,
  // Branched on detail.pool (operator ruling): an empty kept set over a pool
  // with ZERO same-type comps means we didn't find the right pool — telling
  // that member "the market is thin" misassigns the blame to their market.
  TOO_FEW_COMPS: (detail) =>
    detail?.pool === 'no_type_match'
      ? "I found sold homes nearby but none of the same property type as yours, so I can't build a " +
        "reliable comp set here. If you have an ARV in mind, tell me and I'll run the numbers with it."
      : `Not enough recent sales to work with: I found ${detail?.kept ?? 'fewer than the minimum'} usable ` +
        `sold comp(s) within ${detail?.radiusTierMi ?? 2} mi in the last 12 months, and I need at least ` +
        `${detail?.needed ?? 3} before an ARV means anything. The market there is too thin for automated comps. ` +
        MANUAL_OFFER,
  PROVIDER_TIMEOUT: () =>
    "The property data source didn't answer in time. That's on their end, not your address — give it a " +
    'minute and ask me to run the comps again. ' + MANUAL_OFFER,
  PROVIDER_ERROR: () =>
    'The property data source returned an error — nothing wrong with your input. Try again in a few ' +
    'minutes. ' + MANUAL_OFFER,
  RATE_LIMITED: () =>
    "Comps lookups are capped for the day (each one costs real money to run), and today's budget is " +
    'used up. Try again tomorrow. ' + MANUAL_OFFER,
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

function compLine(s: ScoredComp): string {
  const c = s.comp;
  const soldDate = c.soldDate ? c.soldDate.slice(0, 10) : NA;
  const price = c.soldPrice === null ? NA : USD.format(c.soldPrice);
  const ppsf = c.soldPrice !== null && (c.livingArea ?? 0) > 0 ? `${USD.format(s.pricePerSqft)}/sqft` : NA;
  const beds = c.beds === null ? NA : String(c.beds);
  const baths = c.baths === null ? NA : String(c.baths);
  // The link is LOAD-BEARING (CONTRACT §14.9): the client waived
  // style/condition/quality matching and named this as the member's substitute
  // for judging them. Its absence is a real degradation, so it is stated, not
  // dropped.
  const link = c.detailUrl ? c.detailUrl : 'link unavailable';
  // Detail enrichment (§14.14): label-first so a null renders as an explicit
  // "year built —", never a bare dash with no referent. A comp the detail
  // batch missed renders all three as em-dashes — same §14.5 rule as every
  // other column. architecturalStyle / propertyCondition are CAPTURED but
  // deliberately NOT rendered: display needs its own client ruling (operator
  // directive) — do not add them here without one.
  const d = s.detail;
  const detailLine =
    `  year built ${year(d?.yearBuilt)} · days on market ${num(d?.daysOnMarket)} · ` +
    `parking spaces ${num(d?.parkingSpaces)}`;
  // No em dash as punctuation anywhere in the success block: "—" is the §14.5
  // NULL MARKER, and a marker that doubles as a separator stops being
  // explicit — a member scanning a row could not tell "missing data" from
  // typography. The interpunct separates, like the rest of the row; the em
  // dash means one thing.
  return (
    `- **${c.address}** · sold ${price} on ${soldDate}\n` +
    `  ${num(c.livingArea, ' sqft')} · ${ppsf} · ${beds} bd / ${baths} ba · ` +
    `lot ${num(c.lotSize, ' sqft')} · ${s.distanceMi.toFixed(2)} mi away\n` +
    detailLine + '\n' +
    `  ${link}`
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
  if (demographics === null) {
    return '_Neighborhood demographics are unavailable right now — the comps above are unaffected._';
  }
  const d = demographics;
  const income = d.medianHouseholdIncome === null ? NA : USD.format(d.medianHouseholdIncome);
  const age = d.medianAge === null ? NA : String(d.medianAge);
  const owner = d.ownerOccupiedPct === null ? NA : `${Math.round(d.ownerOccupiedPct)}%`;
  const renter = d.renterOccupiedPct === null ? NA : `${Math.round(d.renterOccupiedPct)}%`;
  return (
    `**Neighborhood snapshot** — ${d.tractName} (US Census ACS 5-year, ${d.acsYear})\n` +
    `Median household income ${income} · median age ${age} · ` +
    `owner-occupied ${owner} · renter-occupied ${renter}`
  );
}

function renderSuccess(result: CompsResult): string {
  const { subject, comps, rejected, radiusTierMi, recencyTierMonths } = result;

  const header = [
    `**Comps for ${subject.address}**`,
    `Subject: ${subject.beds ?? NA} bd / ${subject.baths ?? NA} ba, ` +
      `${num(subject.livingArea, ' sqft')} ${subject.propertyType}. ` +
      `Searched within ${radiusTierMi} mi, sold in the last ${recencyTierMonths} months ` +
      `(${rejected.length} candidate(s) rejected).`,
  ].join('\n');

  const table = [`**${comps.length} sold comps** (best match first):`, ...comps.map(compLine)].join('\n');

  /**
   * THE emit order (CONTRACT §14.8, extended by §14.10): opening → header →
   * table → [demographics] → closing → footer. The ARV block that used to
   * sit after the table is GONE — removed with arv.ts, not gated;
   * reinstating it would be a rebuild from the contract, not a line here.
   * The demographics section slots where it does so COMPS_CLOSING stays the
   * LAST content before the footer, exactly as pinned.
   */
  const sections: Array<string | null> = [
    COMPS_OPENING,
    header,
    table,
    renderDemographics(result.demographics),
    COMPS_CLOSING,
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
    : "Something went wrong pulling comps — no estimate this time. If you have your own ARV, tell me and I'll run the numbers with it.";
}

export function renderCompsForChat(outcome: CompsOutcome): string {
  return outcome.ok ? renderSuccess(outcome) : renderFailure(outcome);
}
