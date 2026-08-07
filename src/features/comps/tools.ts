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
import { renderCompsForChat } from './format.js';
import { runComps, type CompsCacheLike, type RunBudgetLike } from './service.js';
import type { ArvConfidence } from './types.js';
import type { PropertyDataProvider } from './providers/types.js';

/** The §8 atomic block. `state.comps` holds this whole object or nothing. */
export interface CompsStateBlock {
  subjectAddress: string;
  subjectSqft: number;
  subjectBeds: number | null;
  subjectBaths: number | null;
  arv: number;
  arvLow: number | null;
  arvHigh: number | null;
  arvConfidence: ArvConfidence | null;
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
  /**
   * CONTRACT §14.8 — surface the ARV in the render/pre-fill. Optional and
   * defaulting to FALSE at every use site, so forgetting to thread it cannot
   * resurrect the surface the client removed.
   */
  arvSurfacing?: boolean;
  provider?: PropertyDataProvider;
  cache?: CompsCacheLike;
  budget?: RunBudgetLike;
  stateStore?: SessionStateStore;
  logger?: { warn(obj: Record<string, unknown>, msg: string): void };
  now?: () => Date;
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

  // CONTRACT §8: clear BEFORE the provider is hit. A failed run must leave no
  // ARV — especially not the previous address's.
  await ctx.stateStore?.clearCompsBlock(ctx.sessionId);

  const outcome = await runComps(address, {
    provider: ctx.provider,
    cache: ctx.cache,
    budget: ctx.budget,
    logger: ctx.logger,
    now: ctx.now,
  });

  const rendered = renderCompsForChat(outcome, { arvSurfacing: ctx.arvSurfacing === true });

  if (outcome.ok) {
    const block: CompsStateBlock = {
      subjectAddress: outcome.subject.address,
      subjectSqft: outcome.subject.livingArea ?? 0,
      subjectBeds: outcome.subject.beds,
      subjectBaths: outcome.subject.baths,
      arv: outcome.arv.arv,
      arvLow: outcome.arv.arvLow,
      arvHigh: outcome.arv.arvHigh,
      arvConfidence: outcome.arv.confidence,
      arvSource: 'comps',
      compsRunId: outcome.runId,
      computedAt: (ctx.now?.() ?? new Date()).toISOString(),
    };
    await ctx.stateStore?.setCompsBlock(ctx.sessionId, block);
    return {
      rendered_block: rendered,
      arv: outcome.arv.arv,
      confidence: outcome.arv.confidence,
      instruction:
        'Relay rendered_block to the member VERBATIM — do not re-derive, summarise, or alter any number in it. ' +
        'You may add ONE short coaching line after it. The ARV is now stored and will pre-fill the Flip/BRRRR ' +
        'calculators for this conversation.',
    };
  }

  return {
    rendered_block: rendered,
    failure_code: outcome.code,
    instruction:
      'The comps lookup did not produce an ARV. Relay rendered_block to the member VERBATIM. Do NOT invent an ' +
      'ARV or any comp. If they reply with their own ARV, call set_manual_arv.',
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

/** set_manual_arv handler. Same block shape, arvSource 'manual' (CONTRACT §8). */
export async function setManualArvToolHandler(
  args: Record<string, unknown>,
  ctx: CompsToolContext,
): Promise<unknown> {
  const arv = args.arv;
  if (typeof arv !== 'number' || !Number.isFinite(arv) || arv <= 0) {
    return { error: 'set_manual_arv requires a positive dollar amount. Ask the member for their ARV as a number.' };
  }

  const existing = (await ctx.stateStore?.getCompsBlock(ctx.sessionId)) ?? null;
  const block: CompsStateBlock = {
    subjectAddress: existing?.subjectAddress ?? 'manual entry',
    subjectSqft: existing?.subjectSqft ?? 0,
    subjectBeds: existing?.subjectBeds ?? null,
    subjectBaths: existing?.subjectBaths ?? null,
    arv,
    arvLow: null,
    arvHigh: null,
    arvConfidence: null,
    arvSource: 'manual',
    compsRunId: null,
    computedAt: (ctx.now?.() ?? new Date()).toISOString(),
  };
  await ctx.stateStore?.setCompsBlock(ctx.sessionId, block);

  return {
    stored: true,
    arv,
    arvSource: 'manual',
    instruction:
      `Confirm in one short line that you'll use ${arv.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} ` +
      'as the ARV for this conversation (it now pre-fills Flip/BRRRR), and remind them it is their number, not a comp-derived one.',
  };
}
