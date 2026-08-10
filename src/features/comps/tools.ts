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
        description:
          'Look up real sold comps for a property address and compute an ARV from them (trimmed-mean $/sqft). ' +
          'Use when the member asks to run comps, find comps, or estimate ARV for an address. The result is a ' +
          'pre-rendered block — relay it verbatim. Requires a full street address including city and state.',
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
      instruction:
        'Relay rendered_block to the member VERBATIM — do not re-derive, summarise, or alter any number in ' +
        'it. You may add ONE short coaching line after it. This tool does NOT produce an ARV: if the member ' +
        'wants deal numbers run, they supply their own ARV and you call set_manual_arv.',
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
const ADDRESS_FRAGMENT_RE =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9'.\- ]{0,40}?\s?(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|ct|court|pl|place|way|ter|terrace)\b/gi;

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
 * set_manual_arv handler. Same block shape, arvSource 'manual' (CONTRACT §8).
 *
 * BUG-011: the block no longer inherits ANYTHING from a previous block. The
 * old code carried `subjectAddress` forward (falling back to the literal
 * 'manual entry' once run_comps stopped writing state — which bound every
 * manual ARV to a placeholder the guard then "defended"). A manual ARV is a
 * fresh statement: bound to the address the member named in THIS message, or
 * bound to nothing.
 */
export async function setManualArvToolHandler(
  args: Record<string, unknown>,
  ctx: CompsToolContext,
): Promise<unknown> {
  const arv = args.arv;
  if (typeof arv !== 'number' || !Number.isFinite(arv) || arv <= 0) {
    return { error: 'set_manual_arv requires a positive dollar amount. Ask the member for their ARV as a number.' };
  }

  const boundAddress = bindAddressToCurrentMessage(args.address, ctx.userMessage, normalizeAddress);
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
  return {
    stored: true,
    arv,
    arvSource: 'manual',
    ...(boundAddress ? { bound_address: boundAddress } : {}),
    instruction: boundAddress
      ? `Confirm in one short line that you'll use ${formatted} as the ARV for ${boundAddress} ` +
        '(it now pre-fills Flip/BRRRR), and remind them it is their number, not a comp-derived one.'
      : `Confirm in one short line that you'll use ${formatted} as the ARV for this conversation ` +
        '(it now pre-fills Flip/BRRRR), and remind them it is their number, not a comp-derived one. ' +
        'Do NOT attach it to any property address — none was stated.',
  };
}
