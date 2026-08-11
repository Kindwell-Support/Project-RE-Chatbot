import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { TOOL_DEFINITIONS } from './toolDefs.js';
import { runFlipTool, runBrrrrTool, runLandTool } from './toolRunners.js';
import { lookupMaterialBudget } from './materialLookup.js';
import { searchKnowledgeBase, formatChunksForModel } from './retrieval.js';
import {
  CALCULATOR_FORMS,
  isCalculatorKey,
  type CalculatorForm,
  type CalculatorKey,
} from './formSchema.js';
import { routeCalculatorIntent } from './calculatorIntent.js';
import {
  addressConflict,
  buildCompsToolDefinitions,
  findConflictingAddress,
  runCompsToolHandler,
  setManualArvToolHandler,
  type CompsToolContext,
} from '../features/comps/tools.js';
import { normalizeAddress } from '../features/comps/normalize.js';
import { applyFormArvPrefill } from '../features/comps/formPrefill.js';

const MAX_TOOL_ROUNDS = 6;

/**
 * Turn-scoped directive for the one case where asking IS correct: real
 * calculator intent with no calculator named. The route is decided in code; the
 * wording is left to the model so it still sounds like James.
 */
/**
 * Comps prompt section, appended to SYSTEM_PROMPT only when the comps context
 * exists — and mentioning run_comps only when the provider (token) does. The
 * prompt is the BACKUP for behaviour the tool layer already enforces in code:
 * rendered-block relay, the pre-fill echo, and the mismatch ask.
 */
/**
 * BUG-014: this section is the ONLY instruction source on turns where no
 * tool runs (a recall turn calls nothing), so every sentence must be true
 * of the post-§14.8 world — run_comps produces comparable sales and NO
 * ARV; every ARV comes from the member. Deleting the stale claims is not
 * enough: a gap where an instruction was is worse than the wrong
 * instruction, because the model fills gaps. Each removed claim below is
 * REPLACED by its true counterpart.
 */
function compsPromptSection(hasProvider: boolean): string {
  const manualOnly = `

## ARV for Flip/BRRRR — always the member's number
- Nothing in this system computes an ARV. The ARV used in any calculation comes from the MEMBER:
  when they state one ("use 450k as the ARV"), call set_manual_arv to store it.
- If THAT SAME message names the property ("use 450k for 123 Main St"), pass the address too. If it
  does not, OMIT the address argument entirely — never supply one from earlier in the conversation.
- A stored ARV pre-fills the Flip and BRRRR calculators; they then only need the remaining inputs.
- When a tool result carries "arv_prefill", its echo_instruction is MANDATORY: the first line of
  your reply states the ARV used and where it came from, with the override offer. Never present a
  pre-filled ARV as if the member supplied it this turn.
- If the member is analyzing a DIFFERENT property than the stored one, do not reuse the stored ARV —
  ask which deal they mean.`;

  if (!hasProvider) return manualOnly;

  return `

## Comps (run_comps) — comparable sales, not a valuation
- run_comps returns recent comparable SALES for an address: sold prices, $/sqft, beds/baths, lot
  size, year built, days on market, property links, and neighborhood context. It does NOT produce
  an ARV, a value estimate, or any number for the member's own property — never promise it will,
  and never describe comps as a way to "get the ARV".
- When the member asks for comparable sales IN ANY PHRASING — "run comps", "run a comparable",
  "pull comps", "find comps", "show me comparables", "what are similar homes selling for" — or
  wants market data to help value a property, call run_comps with the full address (street, city,
  state). The INTENT (comparable sales for an address) is the trigger, never the exact words. If
  the address is partial, ask for the rest first — one question. If they then want deal numbers
  run, the ARV is theirs to choose from those comps: ask for their figure and call set_manual_arv.
- The result contains "rendered_block": relay it VERBATIM. Never re-derive, summarise, or adjust its
  numbers, and NEVER invent a comp, an address, or an ARV yourself. You may add one short coaching
  line after the block.
- If the lookup fails, the block explains why and offers manual entry — relay it, and if they answer
  with their own number, call set_manual_arv.
- If the member asks for comps on an address you already ran — AGAIN, IN ANY PHRASING, including
  "run a comparable for the same address" — call run_comps AGAIN: a repeat address is answered
  from the cache at no cost, and the member must always receive the full rendered block.
  NEVER answer a comps request by summarising an earlier result from memory: every comps figure the
  member sees must come from a run_comps result in THIS turn, and every ARV comes from the member
  via set_manual_arv — comps never produce one. If asked "what was the ARV?", say plainly that
  comps don't produce an ARV, and offer to re-run the comps or to use their own figure. (Operator
  ruling: the old "don't re-run" spend guard solved a problem the cache already solves, and it
  pushed replies outside the rendered-block guarantees.)${manualOnly}`;
}

const ASK_WHICH_CALCULATOR = [
  'ROUTING (this turn): the member signalled they want a deal analysed but did NOT say which',
  'calculator. Ask which one in ONE short line — flip, BRRRR, or land / new construction — and',
  'nothing else. Do not ask for any numbers, do not list input fields, and do not run a',
  'calculator. As soon as they name one, its input form appears automatically.',
].join(' ');

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  embedding_tokens: number;
}

/** One tool invocation, in call order. Trace evidence: proves which tool actually fired. */
export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface AgentResult {
  output: string;
  usage: TokenUsage;
  retrievedChunkIds: Array<string | number>;
  similarityScores: number[];
  toolCalls: ToolCallTrace[];
  /** Set when an inline input form is to be rendered; the widget renders it. */
  renderForm?: CalculatorForm;
  /**
   * Who decided to render it. 'router' is the deterministic code path (see
   * calculatorIntent.ts) and is the only path clear calculator intent can take;
   * 'model' is the residual tool-call path for cases the rules don't cover.
   */
  formTrigger?: 'router' | 'model';
}

export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

/**
 * A tool call injected before the model's first turn. Used by form submissions:
 * the form already knows which calculator and which arguments, so the model is
 * handed the finished tool result and only writes the prose around it. It runs
 * through the same executeTool path as a model-issued call — same runner, same
 * validation, same trace — so a form result cannot diverge from a typed one.
 */
export interface SeedToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RunAgentOptions {
  seedToolCall?: SeedToolCall;
  /**
   * Comps feature context (CONTRACT §6/§8/§9). When absent, or when
   * `provider` is undefined (no APIFY_TOKEN), run_comps is NOT registered —
   * the model cannot offer a lookup the backend can't perform.
   * set_manual_arv registers whenever comps context exists at all.
   */
  comps?: CompsToolContext;
}

export async function runAgent(
  openai: OpenAI,
  supabase: SupabaseClient,
  config: AppConfig,
  history: ChatHistoryMessage[],
  userMessage: string,
  options: RunAgentOptions = {},
): Promise<AgentResult> {
  const comps = options.comps;
  const toolDefinitions = comps
    ? [...TOOL_DEFINITIONS, ...buildCompsToolDefinitions(!!comps.provider)]
    : TOOL_DEFINITIONS;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT + (comps ? compsPromptSection(!!comps.provider) : '') },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const usage: TokenUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    embedding_tokens: 0,
  };
  const retrievedChunkIds: Array<string | number> = [];
  const similarityScores: number[] = [];
  const toolCalls: ToolCallTrace[] = [];
  const formRequest: { form?: CalculatorForm } = {};

  const ctx: ToolContext = {
    openai,
    supabase,
    config,
    retrievedChunkIds,
    similarityScores,
    usage,
    formRequest,
    comps,
    userMessage,
  };

  // Form submission: run the calculator first, then let the model narrate it.
  // Errors are NOT swallowed here — a bad submission must surface as a failed
  // request, not as the model improvising around a tool error.
  if (options.seedToolCall) {
    const { name, args } = options.seedToolCall;
    const result = await executeTool(name, args, ctx);
    toolCalls.push({ name, args, ok: true });
    const seedId = 'seed_form_submission';
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: seedId,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    });
    messages.push({
      role: 'tool',
      tool_call_id: seedId,
      content: typeof result === 'string' ? result : JSON.stringify(result),
    });
  }

  // --- Deterministic form routing -----------------------------------------
  // This runs BEFORE the model's first turn, and it is what guarantees the
  // form. Clear calculator intent with no numbers renders the form here, in
  // code, by rule — the model is then handed the finished
  // request_calculator_form result and only writes the one line around it. It
  // is not asked whether to show a form and has no way to decline: renderForm
  // is already set on the result below regardless of what it does next.
  //
  // Skipped for form submissions (a submission IS the form's answer).
  let formTrigger: 'router' | 'model' | undefined;
  if (!options.seedToolCall) {
    const route = routeCalculatorIntent(userMessage, history);

    if (route.kind === 'form') {
      const args = { calculator: route.calculator };
      // Same executeTool path a model-issued call takes — same validation, same
      // trace entry — so a routed form cannot diverge from a model-asked one.
      const result = await executeTool('request_calculator_form', args, ctx);
      toolCalls.push({ name: 'request_calculator_form', args, ok: true });
      formTrigger = 'router';
      const routeId = 'router_calculator_form';
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: routeId,
            type: 'function',
            function: { name: 'request_calculator_form', arguments: JSON.stringify(args) },
          },
        ],
      });
      messages.push({
        role: 'tool',
        tool_call_id: routeId,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    } else if (route.kind === 'ask_which_calculator') {
      messages.push({ role: 'system', content: ASK_WHICH_CALCULATOR });
    }
  }

  /**
   * Structural pre-fill echo (CONTRACT §8): "the reply MUST echo the
   * injection visibly" cannot be a prompt instruction alone — a model under
   * pressure drops it, and a correct state field with a missing echo still
   * ships the wrong-house bug. If a calculator ran on a pre-filled ARV and
   * the final text is missing the amount, the bound address, or the override
   * offer, the echo line is PREPENDED here, in code.
   */
  const ensurePrefillEcho = (output: string): string => {
    const prefill = ctx.lastArvPrefill;
    if (!prefill || !output) return output;
    const digits = output.replace(/[$,\s]/g, '');
    const arvDigits = String(prefill.arv);
    // BUG-011: an unbound ARV (subjectAddress null) has no address to echo —
    // the address requirement is waived, never satisfied by a placeholder.
    const addressHead = prefill.subjectAddress ? prefill.subjectAddress.split(',')[0].trim().toUpperCase() : null;
    const hasArv = digits.includes(arvDigits);
    const hasAddress = addressHead === null || (addressHead.length > 0 && output.toUpperCase().includes(addressHead));
    const hasOverride = /change arv|override|different arv/i.test(output);
    if (hasArv && hasAddress && hasOverride) return output;
    if (prefill.source === 'override') {
      // BUG-007 (operator ruling): an override on a DIFFERENT property must
      // name BOTH the property being analysed and the ARV's provenance —
      // the member's stated number, with the comps on file bound elsewhere.
      // Naming the property alone leaves state.comps silently bound to the
      // old address on the next turn.
      if (prefill.staleCompsAddress) {
        return (
          `Running this on ${prefill.subjectAddress} using YOUR stated ARV of $${prefill.arv.toLocaleString('en-US')} — ` +
          `note: the comps on file are for ${prefill.staleCompsAddress}, not this property. ` +
          `Say "run comps on ${prefill.subjectAddress}" for fresh ones, or "change ARV" to adjust.\n\n${output}`
        );
      }
      // Same property: the member's own number replacing a stored estimate —
      // the echo names BOTH, so a mistaken override is visible immediately.
      // A null binding (BUG-011) names no property on either side.
      const storedAt = prefill.subjectAddress ? ` stored for ${prefill.subjectAddress}` : ' you set earlier';
      const replaced =
        prefill.overridden !== undefined
          ? ` (overriding the $${prefill.overridden.toLocaleString('en-US')} estimate${storedAt})`
          : prefill.subjectAddress
            ? ` for ${prefill.subjectAddress}`
            : '';
      return `Using YOUR ARV $${prefill.arv.toLocaleString('en-US')}${replaced} — say "change ARV" to switch back or set another.\n\n${output}`;
    }
    // BUG-011: unbound manual ARV — no address clause, ever. The old code
    // rendered the 'manual entry' placeholder here, member-visible.
    if (prefill.subjectAddress === null) {
      return (
        `Using your ARV of $${prefill.arv.toLocaleString('en-US')} — say "change ARV" to override.\n\n` + output
      );
    }
    const source =
      prefill.source === 'comps'
        ? `the comps on ${prefill.subjectAddress}`
        : `your manual entry for ${prefill.subjectAddress}`;
    return (
      `Using ARV $${prefill.arv.toLocaleString('en-US')} from ${source} — say "change ARV" to override.\n\n` +
      output
    );
  };

  /** Every exit point reports the form the same way — one place to get it right. */
  const finish = (output: string): AgentResult => ({
    output: ensurePrefillEcho(output),
    usage,
    retrievedChunkIds,
    similarityScores,
    toolCalls,
    ...(formRequest.form
      ? { renderForm: formRequest.form, formTrigger: formTrigger ?? 'model' }
      : {}),
  });

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model: config.openaiModel,
      temperature: 0.3,
      messages,
      tools: toolDefinitions,
    });

    if (completion.usage) {
      usage.prompt_tokens += completion.usage.prompt_tokens;
      usage.completion_tokens += completion.usage.completion_tokens;
      usage.total_tokens += completion.usage.total_tokens;
    }

    const choice = completion.choices[0];
    const message = choice.message;

    if (!message.tool_calls || message.tool_calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      return finish(message.content ?? '');
    }

    messages.push(message);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue;
      let result: unknown;
      let args: Record<string, unknown> = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
        result = await executeTool(toolCall.function.name, args, ctx);
        toolCalls.push({ name: toolCall.function.name, args, ok: true });
      } catch (err) {
        toolCalls.push({ name: toolCall.function.name, args, ok: false });
        result = {
          error: `Tool "${toolCall.function.name}" failed: ${err instanceof Error ? err.message : String(err)}. Tell the user you could not complete this step — do not invent numbers.`,
        };
      }
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  // Unreachable, but keeps TypeScript satisfied.
  return finish('');
}

interface ToolContext {
  openai: OpenAI;
  supabase: SupabaseClient;
  config: AppConfig;
  retrievedChunkIds: Array<string | number>;
  similarityScores: number[];
  usage: TokenUsage;
  formRequest: { form?: CalculatorForm };
  comps?: CompsToolContext;
  /** The current member message — the ARV pre-fill's address-mismatch guard reads it. */
  userMessage: string;
  /** Set when a calculator ran on a pre-filled/bound ARV this turn; finish() enforces the echo. */
  lastArvPrefill?: {
    arv: number;
    /** Null = the ARV is unbound (BUG-011): the echo carries no address clause. */
    subjectAddress: string | null;
    source: 'comps' | 'manual' | 'override';
    /** For 'override': the stored comps/manual value the member's number replaced. */
    overridden?: number;
    /**
     * For 'override' on a DIFFERENT property (BUG-007): the address the
     * stored comps block is still bound to — the echo must flag it, because
     * state.comps keeps that binding on the next turn.
     */
    staleCompsAddress?: string;
  };
}

/**
 * Did the member state this dollar amount in THIS message? The discriminator
 * between a genuine override and a model-carried stale figure. Accepts the
 * forms members actually type: 431000, 431,000, $431,000, 431k, 0.5m,
 * "431 thousand". Exact value match only — current message only, because the
 * conversation HISTORY is precisely where stale figures live.
 */
export function messageStatesNumber(message: string, value: number): boolean {
  const re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m|mm|million|thousand)?\b/gi;
  for (const match of String(message ?? '').matchAll(re)) {
    const base = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const suffix = (match[2] ?? '').toLowerCase();
    const multiplier = suffix === 'k' || suffix === 'thousand' ? 1_000 : suffix ? 1_000_000 : 1;
    if (base * multiplier === value) return true;
  }
  return false;
}

/**
 * ARV pre-fill (CONTRACT §8): when Flip/BRRRR is invoked WITHOUT an ARV and
 * the session carries a comps block, inject the stored ARV — with the
 * bound-address echo attached to the result so the model's reply names where
 * the number came from. An explicit ARV in the call always wins; a message
 * naming a DIFFERENT address never pre-fills (silently pricing the wrong
 * deal is the failure mode this guard exists for). State errors degrade to
 * no-prefill; the calculator then asks for the ARV as it always did.
 */
async function applyArvPrefill(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<
  | { args: Record<string, unknown>; prefill?: Record<string, unknown> }
  | { error: string }
> {
  const store = ctx.comps?.stateStore;
  if (!store || !ctx.comps) return { args };

  const stored = await store.getCompsBlock(ctx.comps.sessionId);
  // MANUAL ARVs ONLY (CONTRACT §14.8). The computed comps ARV is gone; any
  // block still carrying arvSource 'comps' is a leftover from a cached v2
  // session and must not pre-fill anything. set_manual_arv is unaffected —
  // a member's own number still flows through every guard below.
  const block = stored && stored.arvSource === 'manual' ? stored : null;

  const explicit = args.after_repair_value;
  if (explicit !== undefined && explicit !== null) {
    // No stored block ⇒ nothing to conflict with; the plain pre-comps
    // behaviour (explicit value, assertRequired, prompt rules) applies.
    if (!block || !(block.arv > 0)) return { args };

    // A stored block EXISTS, so an explicit ARV is one of three things, and
    // the tool call alone cannot distinguish them — the discriminator is
    // whether the MEMBER said the number this turn:
    //
    //  1. explicit == block.arv — the model relaying the current block
    //     (observed live). Same value ⇒ same guarantees: echo + guard.
    //  2. explicit != block.arv and the number IS in the member's message —
    //     a genuine override. Runs, but never silently: the echo names both
    //     the override and the stored estimate it replaces.
    //  3. explicit != block.arv and the number is NOT in the member's message
    //     — the model carried a stale figure (address A's ARV after B was
    //     bound — the wrong-house leak reopened through history). Ambiguity
    //     is a QUESTION, not an assumption: refuse and ask.
    if (typeof explicit !== 'number' || !Number.isFinite(explicit)) return { args };

    if (explicit === block.arv) {
      // BUG-011: the guard compares addresses, so it needs one. An unbound
      // ARV (subjectAddress null) has nothing to conflict with — it applies
      // wherever the member takes it, and the echo says so without naming a
      // property. A BOUND ARV keeps the full A-vs-B refusal.
      if (block.subjectAddress !== null && addressConflict(ctx.userMessage, block.subjectAddress, normalizeAddress)) {
        return {
          error:
            `The ARV ${block.arv} is the one stored for ${block.subjectAddress}, but this message names a ` +
            'different property. Do NOT price this deal with it. Ask ONE question: which deal is this — the one ' +
            `at ${block.subjectAddress}, or the new address (offer to run comps on it or take its ARV)?`,
        };
      }
      ctx.lastArvPrefill = { arv: block.arv, subjectAddress: block.subjectAddress, source: block.arvSource };
      return { args };
    }

    if (messageStatesNumber(ctx.userMessage, explicit)) {
      // Member named BOTH a different property and a number — coherent input,
      // so it RUNS (refusing here would be obtuse; operator ruling on
      // BUG-007). But never unlabelled: the number may be a purchase price
      // the model mistook for an ARV ("456 Oak, purchase 400000" vs a stored
      // $403k), and state.comps stays bound to the OLD address afterwards.
      // The echo therefore names the property being analysed AND flags that
      // the comps on file belong elsewhere.
      // Null binding ⇒ no stale-comps flag is possible: nothing is bound
      // elsewhere, so a member-stated number is a plain override (BUG-011).
      const newAddress =
        block.subjectAddress !== null
          ? findConflictingAddress(ctx.userMessage, block.subjectAddress, normalizeAddress)
          : null;
      if (newAddress && block.subjectAddress !== null) {
        ctx.lastArvPrefill = {
          arv: explicit,
          subjectAddress: newAddress,
          source: 'override',
          staleCompsAddress: block.subjectAddress,
        };
        return { args };
      }
      ctx.lastArvPrefill = { arv: explicit, subjectAddress: block.subjectAddress, source: 'override', overridden: block.arv };
      return { args };
    }

    // BUG-011: the stale-figure refusal is VALUE-based, not address-based —
    // it fires whether or not the stored ARV is bound. Only the wording
    // changes when there is no address to name.
    const storedLabel =
      block.subjectAddress !== null
        ? `the stored ARV for ${block.subjectAddress}`
        : 'the stored manual ARV (not bound to any address)';
    return {
      error:
        `ARV mismatch: you passed ${explicit}, but ${storedLabel} is ${block.arv}, ` +
        `and the member did not state ${explicit} in this message — so that number is likely carried from an ` +
        'earlier deal. Do NOT run the calculator. Ask ONE question: should this deal use the stored ' +
        `${block.arv} ARV, or a different number (have them state it)?`,
    };
  }

  if (!block || !(block.arv > 0)) return { args };

  // BUG-011: only a BOUND ARV can conflict. subjectAddress null means the
  // member never named a property for this number — it pre-fills anywhere in
  // the session, and the echo carries no address clause.
  if (block.subjectAddress !== null && addressConflict(ctx.userMessage, block.subjectAddress, normalizeAddress)) {
    return {
      error:
        `No ARV was given, and the stored ARV belongs to ${block.subjectAddress} while this message names a ` +
        'different property. Do NOT reuse the stored ARV. Ask ONE question: which deal is this — the one at ' +
        `${block.subjectAddress}, or the new address (in which case ask for its ARV or offer to run comps on it)?`,
    };
  }

  ctx.lastArvPrefill = { arv: block.arv, subjectAddress: block.subjectAddress, source: block.arvSource };
  const exampleEcho =
    block.subjectAddress === null
      ? `"Using your ARV of $${block.arv.toLocaleString('en-US')} — say 'change ARV' to override."`
      : `"using ARV $${block.arv.toLocaleString('en-US')} from ${block.arvSource === 'comps' ? 'the comps on' : 'your manual entry for'} ` +
        `${block.subjectAddress} — say 'change ARV' to override."`;
  return {
    args: { ...args, after_repair_value: block.arv },
    prefill: {
      arv: block.arv,
      arv_source: block.arvSource,
      subject_address: block.subjectAddress,
      echo_instruction:
        `REQUIRED: your reply's first line must state the pre-fill, e.g. ${exampleEcho} ` +
        'Never present a pre-filled ARV as if the member typed it' +
        (block.subjectAddress === null ? ', and never attach it to a property address — none is bound.' : '.'),
    },
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case 'flip_calculator': {
      const prefilled = await applyArvPrefill(args, ctx);
      if ('error' in prefilled) return prefilled;
      const result = runFlipTool(prefilled.args);
      return prefilled.prefill ? { ...result, arv_prefill: prefilled.prefill } : result;
    }
    case 'brrrr_calculator': {
      const prefilled = await applyArvPrefill(args, ctx);
      if ('error' in prefilled) return prefilled;
      const result = runBrrrrTool(prefilled.args);
      return prefilled.prefill ? { ...result, arv_prefill: prefilled.prefill } : result;
    }
    case 'land_purchase_calculator':
      return runLandTool(args);
    case 'run_comps': {
      if (!ctx.comps) return { error: 'Comps are not configured on this deployment.' };
      return runCompsToolHandler(args, ctx.comps);
    }
    case 'set_manual_arv': {
      if (!ctx.comps) return { error: 'Comps state is not configured on this deployment.' };
      // BUG-011: the handler binds a model-supplied address against the
      // member's CURRENT message — threaded here, not trusted from the args.
      return setManualArvToolHandler(args, { ...ctx.comps, userMessage: ctx.userMessage });
    }
    case 'request_calculator_form': {
      const calculator = args.calculator;
      if (!isCalculatorKey(calculator)) {
        return {
          error: `Unknown calculator "${String(calculator)}". Valid: flip, brrrr, land_purchase.`,
        };
      }
      // CONTRACT §8.1: the ARV field picks up the session's comps block as an
      // editable, LABELLED default — server-side state read only; the model's
      // args carry nothing but the calculator key (additionalProperties:
      // false), so no model output can place a value into a form field. The
      // same §8 guards apply: no block -> no default; a message naming a
      // different property -> blank. State read failure degrades to the
      // plain form. applyFormArvPrefill clones — CALCULATOR_FORMS stay pristine.
      let form = CALCULATOR_FORMS[calculator as CalculatorKey];
      if (ctx.comps?.stateStore) {
        const block = await ctx.comps.stateStore.getCompsBlock(ctx.comps.sessionId);
        form = applyFormArvPrefill(form, block, ctx.userMessage);
      }
      ctx.formRequest.form = form;
      // The model gets the labels (so it can write a natural one-liner) but not
      // the defaults — it must not recite them as if they were the member's.
      const arvPrefill = [...form.required, ...form.optional].find((f) => f.prefill)?.prefill;
      return {
        // Address only, never the value: the binding is worth mentioning in
        // the one-liner; the number must come from the form, not the model.
        // Null binding (BUG-011) ⇒ name the source, never a placeholder.
        ...(arvPrefill
          ? { arv_prefilled_from: arvPrefill.subjectAddress ?? 'your manual ARV (not bound to an address)' }
          : {}),
        form_rendered: true,
        // Named form_calculator, NOT `calculator`: that key is the calculator
        // RESULT discriminator (runFlipTool et al.), and a form directive
        // claiming it makes "find the flip result" match the form instead.
        form_calculator: form.calculator,
        title: form.title,
        required_fields: form.required.map((f) => f.label),
        instruction:
          'The input form is now displayed in the chat. Tell the member in ONE short line to fill it in, including the estimate disclaimer. Do not list the fields or ask for the numbers in prose — the form collects them.',
      };
    }
    case 'lookup_material_budget':
      // No `?? ''` and no String() coercion (BUG-009): both converted a schema
      // violation into a plausible-looking answer — `''` matched every row,
      // and String(undefined) would query the literal "undefined". The raw
      // argument goes to the guard, which rejects it like the calculators do.
      return lookupMaterialBudget(args.item, args.spec_tier as string | undefined);
    case 'search_knowledge_base': {
      const { chunks, embeddingTokens } = await searchKnowledgeBase(
        ctx.openai,
        ctx.supabase,
        ctx.config,
        // Raw, uncoerced (FINDING-005): `?? ''` embedded a void query and
        // returned arbitrary passages the model would then quote as an answer.
        args.query,
      );
      ctx.usage.embedding_tokens += embeddingTokens;
      for (const chunk of chunks) {
        ctx.retrievedChunkIds.push(chunk.id);
        ctx.similarityScores.push(chunk.similarity);
      }
      return formatChunksForModel(chunks);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
