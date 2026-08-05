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

const MANUAL_OFFER =
  'If you already have an ARV in mind, just tell me — e.g. "use 450k as the ARV" — and I\'ll run the numbers with yours.';

/**
 * §10 failure copy, one entry per code, single source of truth. Every message
 * is plain English, blames the right thing, and ends by offering manual ARV
 * entry. NONE of them contains a number that could be mistaken for an ARV.
 */
export const FAILURE_COPY: Record<CompsFailureCode, (detail?: CompsFailure['detail']) => string> = {
  ADDRESS_NOT_FOUND: () =>
    "I couldn't find that address on Zillow. Double-check the spelling, and include the city and state — " +
    'e.g. "123 Main St, Phoenix, AZ". ' + MANUAL_OFFER,
  SUBJECT_SQFT_UNKNOWN: () =>
    'I found the property, but Zillow has no square footage on record for it — and without the size I ' +
    "can't do the price-per-square-foot math honestly. " + MANUAL_OFFER,
  TOO_FEW_COMPS: (detail) =>
    `Not enough recent sales to work with: I found ${detail?.kept ?? 'fewer than the minimum'} usable ` +
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
        'Treat it as a starting point only, and strongly consider overriding it: say "use 450k as the ARV" ' +
        'to set your own.'
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

/** Failure render: the §10 copy verbatim — service and chat share ONE wording. */
function renderFailure(failure: CompsFailure): string {
  return failure.message;
}

export function renderCompsForChat(outcome: CompsOutcome): string {
  return outcome.ok ? renderSuccess(outcome) : renderFailure(outcome);
}
