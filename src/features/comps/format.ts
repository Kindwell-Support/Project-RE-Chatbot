/**
 * Chat rendering for comps outcomes (CONTRACT §10, §11). Pure and
 * deterministic: the same outcome object always renders the same string.
 *
 * This is the honesty layer. The LLM is handed this rendered block and told
 * to relay it — it never authors comp data, so a hallucinated comp cannot
 * exist. Everything a member could ask "why?" about is IN the render: which
 * comps were trimmed and why, the arithmetic from $/sqft to ARV, and which
 * radius produced the set.
 */
import type { ArvConfidence, CompsFailure, CompsFailureCode, CompsOutcome, CompsResult, ScoredComp } from './types.js';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const FOOTER =
  '_Automated estimate from public sold data, not a formal appraisal. Verify comps and ARV with your agent before you act._';

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

function confidenceLine(confidence: ArvConfidence): string {
  switch (confidence) {
    case 'high':
      return 'Confidence: **high** — tight spread, close and recent sales.';
    case 'medium':
      return 'Confidence: **medium** — decent set, but verify the ARV against your own comps.';
    case 'low':
      return (
        'Confidence: **low** — this estimate is WEAK (few comps, wide spread, or far/stale sales). ' +
        'Treat it as a starting point only, and strongly consider overriding it: tell me your own ARV ' +
        'and I\'ll use that instead.'
      );
  }
}

function compLine(s: ScoredComp): string {
  const soldDate = s.comp.soldDate ? s.comp.soldDate.slice(0, 10) : 'unknown date';
  return (
    `- ${s.comp.address} — sold ${USD.format(s.comp.soldPrice ?? 0)} on ${soldDate}, ` +
    `${(s.comp.livingArea ?? 0).toLocaleString('en-US')} sqft ` +
    `(${USD.format(s.pricePerSqft)}/sqft), ${s.distanceMi.toFixed(2)} mi away`
  );
}

function renderSuccess(result: CompsResult): string {
  const { subject, comps, arv, rejected, radiusTierMi } = result;
  const lines: string[] = [];

  lines.push(`**Comps for ${subject.address}**`);
  lines.push(
    `Subject: ${subject.beds ?? '?'} bd / ${subject.baths ?? '?'} ba, ` +
      `${(subject.livingArea ?? 0).toLocaleString('en-US')} sqft ${subject.propertyType}. ` +
      `Search radius used: ${radiusTierMi} mi (${rejected.length} candidate(s) rejected).`,
  );
  lines.push('');
  lines.push(`**${comps.length} sold comps** (best match first):`);
  for (const comp of comps) lines.push(compLine(comp));

  lines.push('');
  if (arv.trimmedOut.length > 0) {
    const trimmed = arv.trimmedOut
      .map((t) => `${USD.format(t.pricePerSqft)}/sqft (${t.end} outlier)`)
      .join(', ');
    lines.push(`Trimmed mean: dropped ${trimmed} before averaging.`);
  } else {
    lines.push('Trimmed mean: set too small to trim — all comps averaged.');
  }
  lines.push(
    `Math: average of the remaining $/sqft = ${USD.format(arv.arvPerSqft)}/sqft × ` +
      `${(subject.livingArea ?? 0).toLocaleString('en-US')} sqft (subject) = **ARV ${USD.format(arv.arv)}**`,
  );
  lines.push(`Range: ${USD.format(arv.arvLow)} – ${USD.format(arv.arvHigh)} (±1 std dev of the trimmed set).`);
  lines.push(confidenceLine(arv.confidence));
  lines.push('');
  lines.push(FOOTER);
  return lines.join('\n');
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
