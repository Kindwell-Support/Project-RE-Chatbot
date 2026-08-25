/**
 * LLM tool layer for comps (CONTRACT §9) + the session-state contract (§8).
 *
 * Honesty invariants enforced here, not in the prompt:
 *  - run_comps returns a RENDERED block from format.ts. The model relays it
 *    and may add one coaching line; it never authors comp data.
 *  - The comps state block is CLEARED before the provider is hit, so a failed
 *    run on address B leaves NO ARV behind — not address A's.
 *  - The block is written as ONE object, whole or not at all.
 *  - Failures return the §10 copy (which always offers manual entry); they
 *    never carry a number.
 */
import type OpenAI from 'openai';
import { normalizeAddress } from './normalize.js';
import { renderCompsForChat } from './format.js';
import { runComps, type CompsCacheLike, type RunBudgetLike } from './service.js';
import type { CensusCacheLike } from './cache/censusCache.js';
import type { DetailCacheLike } from './cache/detailCache.js';
import type { DemographicsProviderLike } from './providers/census.js';
import type { PropertyDataProvider } from './providers/types.js';

/** The §8 atomic block. `state.comps` holds this whole object or nothing. */
export interface CompsStateBlock {
  /**
   * The property this ARV is bound to, or null when the member stated a
   * number without naming one (BUG-011). Null is a real state, not a
   * placeholder: an unbound ARV pre-fills without an address clause and the
   * mismatch guard never fires on it — there is nothing to conflict with.
   * The old `'manual entry'` literal is retired; legacy rows carrying it are
   * coerced to null on read (sessionState.ts).
   */
  subjectAddress: string | null;
  subjectSqft: number;
  subjectBeds: number | null;
  subjectBaths: number | null;
  arv: number;
  arvLow: number | null;
  arvHigh: number | null;
  arvConfidence: null;
  arvSource: 'comps' | 'manual';
  compsRunId: string | null;
  computedAt: string; // ISO
}

/**
 * State store seam (pinned shapes in CONTRACT §8; Supabase impl in
 * sessionState.ts). All three ops swallow-and-warn INSIDE the implementation:
 * state failure degrades to no-prefill, never a blocked reply.
 */
export interface SessionStateStore {
  getCompsBlock(sessionId: string): Promise<CompsStateBlock | null>;
  setCompsBlock(sessionId: string, block: CompsStateBlock): Promise<void>;
  clearCompsBlock(sessionId: string): Promise<void>;
}

export interface CompsToolContext {
  sessionId: string;
  provider?: PropertyDataProvider;
  cache?: CompsCacheLike;
  /** Zpid-keyed detail cache (§14.14). Optional — absent degrades to live detail fetches. */
  detailCache?: DetailCacheLike;
  /** Census demographics (§14.10). Provider absent ⇒ no section renders (CENSUS_API_KEY gate). */
  censusProvider?: DemographicsProviderLike;
  censusCache?: CensusCacheLike;
  budget?: RunBudgetLike;
  stateStore?: SessionStateStore;
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
  now?: () => Date;
  /**
   * The member's CURRENT message (BUG-011). set_manual_arv verifies a
   * model-supplied address against it before binding — history is precisely
   * where stale addresses live. Absent ⇒ no address can bind (null), which
   * degrades safe: an unbound ARV never mis-fires the guard.
   */
  userMessage?: string;
}

/**
 * Tool definitions. run_comps exists ONLY when the provider does (i.e. the
 * token is configured — CONTRACT §9 gate): a model cannot offer a lookup the
 * backend cannot perform. set_manual_arv is always available — manual entry
 * is the universal fallback every failure path points at.
 */
export function buildCompsToolDefinitions(
  hasProvider: boolean,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const defs: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'set_manual_arv',
        description:
          "Store the member's own after-repair value for this conversation. Use when they state an ARV directly " +
          '("use 450k as the ARV", "my ARV is 620000") or after a comps failure when they supply one. ' +
          'The stored ARV pre-fills the Flip and BRRRR calculators.',
        parameters: {
          type: 'object',
          properties: {
            arv: { type: 'number', description: 'After-repair value in dollars, > 0' },
            address: {
              type: 'string',
              description:
                'The property the member tied this ARV to IN THIS MESSAGE (e.g. "use 450k for 123 Main St" → ' +
                '"123 Main St"). OMIT when the current message names no address — NEVER pull an address from ' +
                'earlier in the conversation.',
            },
          },
          required: ['arv'],
          additionalProperties: false,
        },
      },
    },
  ];
  if (hasProvider) {
    defs.unshift({
      type: 'function',
      function: {
        name: 'run_comps',
        // BUG-014: tool definitions reach EVERY turn, including recall turns
        // where no tool runs — this description must never claim an ARV.
        description:
          'Look up recent comparable SALES for a property address: sold prices, $/sqft, beds/baths, lot size, ' +
          'year built, days on market, property links, and neighborhood context. Produces NO ARV and no value ' +
          'estimate — the member supplies their own ARV (set_manual_arv) if they want deal numbers run. Use ' +
          'when the member asks to run comps or find comps, or wants market data to value a property. The ' +
          'result is a pre-rendered block — relay it verbatim. Requires a full street address including city ' +
          'and state.',
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Full street address incl. city and state (and ZIP if given), e.g. "123 Main St, Phoenix, AZ"',
            },
          },
          required: ['address'],
          additionalProperties: false,
        },
      },
    });
  }
  return defs;
}

/**
 * run_comps handler. Returns a model-facing object whose `rendered_block` is
 * the member-visible content.
 */
export async function runCompsToolHandler(
  args: Record<string, unknown>,
  ctx: CompsToolContext,
): Promise<unknown> {
  const address = String(args.address ?? '').trim();
  if (!address) {
    return { error: 'run_comps requires an address. Ask the member for the full street address, city, and state.' };
  }
  if (!ctx.provider) {
    // Unreachable when gating works (the tool isn't registered without a
    // provider) — kept as defence so a wiring bug fails honestly.
    return { error: 'Comps lookup is not configured on this deployment. Offer manual ARV entry instead.' };
  }

  // NO clear-before-provider any more (CONTRACT §14.8, operator ruling).
  // The clear existed to stop a failed run leaving the PREVIOUS comps ARV
  // behind. Comps no longer writes an ARV at all, so the only thing that
  // clear could still destroy is a number the MEMBER typed via
  // set_manual_arv — running comps must never silently delete that. The
  // address-mismatch guard still stops a manual ARV bound to address A from
  // being applied to address B; ambiguity resolves to asking, not assuming.

  const outcome = await runComps(address, {
    provider: ctx.provider,
    cache: ctx.cache,
    detailCache: ctx.detailCache,
    censusProvider: ctx.censusProvider,
    censusCache: ctx.censusCache,
    budget: ctx.budget,
    logger: ctx.logger,
    now: ctx.now,
  });

  const rendered = renderCompsForChat(outcome);

  if (outcome.ok) {
    // NOTHING about an ARV reaches the model from this tool (CONTRACT §14.8).
    // No `arv`, no `confidence`, and no claim that anything will pre-fill a
    // calculator — the previous instruction said exactly that and it is now
    // false. session_state is untouched by a comps run: the only ARV that can
    // exist is one the member typed.
    return {
      rendered_block: rendered,
      // FINDING-023: the trailing clause here — "if the member wants deal
      // numbers run, they supply their own ARV and you call set_manual_arv" —
      // was being PARAPHRASED into the coaching line, so the member saw the
      // same instruction twice, sandwiching the disclaimer: once as the
      // structural COMPS_ARV_CLOSE inside rendered_block, and again in the
      // model's own words after it.
      //
      // It is removed rather than reworded. Prescribed copy that lives in a
      // prompt is a REQUEST, not a constraint (the standing principle), and
      // this request also arrived nearer the point of generation than the
      // system prompt's own prohibition on mentioning an ARV in that line —
      // so it won. The routing it duplicated (call set_manual_arv when the
      // member volunteers a figure) is a STANDING rule in the system prompt,
      // which is where a rule that holds on every turn belongs; restating it
      // per tool result bought nothing and cost member-facing copy.
      //
      // "This tool does NOT produce an ARV" STAYS — that half is the BUG-014
      // guard against the model claiming comps yield one.
      instruction:
        'Relay rendered_block to the member VERBATIM — do not re-derive, summarise, or alter any number in ' +
        'it. You may add ONE short coaching line after it. This tool does NOT produce an ARV.',
    };
  }

  return {
    rendered_block: rendered,
    failure_code: outcome.code,
    instruction:
      'The comps lookup failed. Relay rendered_block to the member VERBATIM. Do NOT invent an ARV or any ' +
      'comp. If they reply with their own ARV, call set_manual_arv.',
  };
}

/**
 * Address-mismatch guard for the pre-fill (CONTRACT §8): if the member's
 * CURRENT message names a street address that is not the stored subject,
 * pre-filling the stored ARV would silently price the wrong deal. Pure and
 * deliberately conservative: only a digit-led fragment ending in a street
 * suffix counts as "naming an address" — "350k purchase, 75k rehab" never
 * trips it.
 */
const ADDRESS_FRAGMENT_SRC = String.raw`\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9'.\- ]{0,40}?\s?(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|pl|place|way|ter|terrace)`;
const ADDRESS_FRAGMENT_RE = new RegExp(String.raw`\b${ADDRESS_FRAGMENT_SRC}\b`, 'gi');
/** The same pattern, anchored — one source string, so the two cannot drift. */
const ADDRESS_FRAGMENT_ANCHORED_RE = new RegExp(`^${ADDRESS_FRAGMENT_SRC}$`, 'i');

/**
 * The first address fragment in the message that is NOT the stored subject,
 * returned AS THE MEMBER TYPED IT — BUG-007 needs it to label which property
 * an accepted override is actually analysing. Null when no conflict.
 */
export function findConflictingAddress(
  message: string,
  subjectAddress: string,
  normalize: (raw: string) => string,
): string | null {
  const normalizedSubject = normalize(subjectAddress);
  for (const match of String(message ?? '').matchAll(ADDRESS_FRAGMENT_RE)) {
    const fragment = normalize(match[0]);
    if (fragment && !normalizedSubject.includes(fragment)) return match[0].trim();
  }
  return null;
}

export function addressConflict(
  message: string,
  subjectAddress: string,
  normalize: (raw: string) => string,
): boolean {
  return findConflictingAddress(message, subjectAddress, normalize) !== null;
}

/**
 * BUG-011: bind a model-supplied address to the member's CURRENT message, or
 * refuse to. The tool definition tells the model to pass only an address the
 * member just named, but "told" is not a guarantee — this is the structural
 * check, the same discriminator shape as `messageStatesNumber` uses for
 * dollar amounts. Two ways to bind, both requiring the CURRENT message to
 * name the property:
 *  (a) an address fragment of the message (same regex the mismatch guard
 *      uses) is contained in the normalized candidate, or
 *  (b) the candidate's street part appears verbatim, post-normalization, in
 *      the message — needed because the fragment regex over-captures when a
 *      dollar figure precedes the address ("my ARV is 620000 for 830 W
 *      America St" fragments as "620000 for 830 …", which (a) then misses).
 * Anything the current message does not name — i.e. anything carried from
 * history — drops to null, never trusted. Failure direction is always
 * "unbound", never "bound to the wrong thing".
 */
export function bindAddressToCurrentMessage(
  candidate: unknown,
  userMessage: string | undefined,
  normalize: (raw: string) => string,
): string | null {
  const address = typeof candidate === 'string' ? candidate.trim() : '';
  if (!address) return null;
  const normalizedCandidate = normalize(address);
  if (!normalizedCandidate) return null;
  const message = String(userMessage ?? '');
  for (const match of message.matchAll(ADDRESS_FRAGMENT_RE)) {
    const fragment = normalize(match[0]);
    if (fragment && normalizedCandidate.includes(fragment)) return address;
  }
  const streetPart = normalize(address.split(',')[0]);
  if (streetPart && normalize(message).includes(streetPart)) return address;
  return null;
}

/**
 * Trim the fragment regex's known over-capture: a pure dollar figure before
 * the address is swallowed into the match ("my ARV is 620000 for 830 W
 * America St" fragments as "620000 for 830 W America St"). The refined
 * fragment starts at the LAST pure-digit run whose tail still parses as a
 * complete address on its own — "830 W America St" above. A digit word that
 * is part of the street name ("2000 Highway 7 Ct") does not parse as an
 * address start, so real addresses pass through untrimmed.
 */
function refineAddressFragment(fragment: string): string {
  let best = fragment;
  for (const digits of fragment.matchAll(/\b\d{1,6}\b/g)) {
    const tail = fragment.slice(digits.index);
    if (tail !== fragment && ADDRESS_FRAGMENT_ANCHORED_RE.test(tail)) best = tail;
  }
  return best;
}

/**
 * RULING 0026: extract the ONE address the member's CURRENT message names,
 * or nothing. The fallback for a model that omits the address argument —
 * without it, model non-compliance alone reached the guard-free path and
 * failed toward a silent number on the wrong property.
 *
 *  - CURRENT message only. This function never sees history.
 *  - Zero fragments, or two DISTINCT fragments (compared normalized) ⇒ null.
 *    Ambiguity is not guessed at; the same fragment stated twice is one.
 *  - Over-captured fragments are refined first (refineAddressFragment), so
 *    the stored binding is the address, not the dollar figure beside it.
 */
export function extractAddressFromMessage(
  userMessage: string | undefined,
  normalize: (raw: string) => string,
): string | null {
  const message = String(userMessage ?? '');
  const distinct = new Map<string, string>(); // normalized -> as the member typed it
  for (const match of message.matchAll(ADDRESS_FRAGMENT_RE)) {
    const refined = refineAddressFragment(match[0]).trim();
    const normalized = normalize(refined);
    if (normalized && !distinct.has(normalized)) distinct.set(normalized, refined);
  }
  if (distinct.size !== 1) return null;
  return distinct.values().next().value ?? null;
}

/**
 * set_manual_arv handler. Same block shape, arvSource 'manual' (CONTRACT §8).
 *
 * BUG-011: the block no longer inherits ANYTHING from a previous block. The
 * old code carried `subjectAddress` forward (falling back to the literal
 * 'manual entry' once run_comps stopped writing state — which bound every
 * manual ARV to a placeholder the guard then "defended"). A manual ARV is a
 * fresh statement: bound to the address the member named in THIS message —
 * via the model's argument or, failing that, extraction (RULING 0026) — or
 * bound to nothing. When a fresh statement drops a previous binding, the
 * result says so (`unbound_from`), so the member sees the address clause
 * disappear instead of discovering it at the calculator.
 */
export async function setManualArvToolHandler(
  args: Record<string, unknown>,
  ctx: CompsToolContext,
): Promise<unknown> {
  const arv = args.arv;
  if (typeof arv !== 'number' || !Number.isFinite(arv) || arv <= 0) {
    return { error: 'set_manual_arv requires a positive dollar amount. Ask the member for their ARV as a number.' };
  }

  // Binding order (RULING 0026): the model's argument first, verified; when
  // that yields nothing — omitted, or unverifiable against the current
  // message — fall back to extracting from the member's CURRENT message,
  // and verify the extraction through the SAME check. History is never
  // consulted on either route. "Unbound" now means: no address verifiable
  // in the current message by argument OR extraction.
  const argumentBound = bindAddressToCurrentMessage(args.address, ctx.userMessage, normalizeAddress);
  const boundAddress =
    argumentBound ??
    bindAddressToCurrentMessage(
      extractAddressFromMessage(ctx.userMessage, normalizeAddress),
      ctx.userMessage,
      normalizeAddress,
    );

  // Read-only look at the previous block, SOLELY to make an unbinding
  // visible (RULING 0026): if the member had an ARV bound to a property and
  // this fresh statement binds nothing, the address clause disappears — the
  // member must be told now, not discover it at the calculator. No field is
  // inherited from `previous`; the fresh-statement rule (§14.15) stands.
  const previous = (await ctx.stateStore?.getCompsBlock(ctx.sessionId)) ?? null;
  const unboundFrom =
    boundAddress === null && previous?.arvSource === 'manual' && previous.subjectAddress !== null
      ? previous.subjectAddress
      : null;

  const block: CompsStateBlock = {
    subjectAddress: boundAddress,
    subjectSqft: 0,
    subjectBeds: null,
    subjectBaths: null,
    arv,
    arvLow: null,
    arvHigh: null,
    arvConfidence: null,
    arvSource: 'manual',
    compsRunId: null,
    computedAt: (ctx.now?.() ?? new Date()).toISOString(),
  };
  await ctx.stateStore?.setCompsBlock(ctx.sessionId, block);

  const formatted = arv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const instruction = boundAddress
    ? `Confirm in one short line that you'll use ${formatted} as the ARV for ${boundAddress} ` +
      '(it now pre-fills Flip/BRRRR), and remind them it is their number, not a comp-derived one.'
    : unboundFrom
      ? `Confirm that you'll use ${formatted} as the ARV for this conversation, and SAY EXPLICITLY that it ` +
        `replaces the ARV they had set for ${unboundFrom} and is no longer tied to that property — if they ` +
        'meant it for that address, they should restate it with the address. Remind them it is their ' +
        'number, not a comp-derived one. Do NOT attach the new ARV to any property address.'
      : `Confirm in one short line that you'll use ${formatted} as the ARV for this conversation ` +
        '(it now pre-fills Flip/BRRRR), and remind them it is their number, not a comp-derived one. ' +
        'Do NOT attach it to any property address — none was stated.';
  return {
    stored: true,
    arv,
    arvSource: 'manual',
    ...(boundAddress ? { bound_address: boundAddress } : {}),
    ...(unboundFrom ? { unbound_from: unboundFrom } : {}),
    instruction,
  };
}
