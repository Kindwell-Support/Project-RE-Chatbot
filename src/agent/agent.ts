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
  runCompsToolHandler,
  setManualArvToolHandler,
  type CompsToolContext,
} from '../features/comps/tools.js';
import { normalizeAddress } from '../features/comps/normalize.js';

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
function compsPromptSection(hasProvider: boolean): string {
  const manualOnly = `

## ARV for Flip/BRRRR
- If the member states their own ARV ("use 450k as the ARV"), call set_manual_arv to store it.
- A stored ARV pre-fills the Flip and BRRRR calculators; they then only need the remaining inputs.
- When a tool result carries "arv_prefill", its echo_instruction is MANDATORY: the first line of
  your reply states the ARV used and where it came from, with the override offer. Never present a
  pre-filled ARV as if the member supplied it this turn.
- If the member is analyzing a DIFFERENT property than the stored one, do not reuse the stored ARV —
  ask which deal they mean.`;

  if (!hasProvider) return manualOnly;

  return `

## Comps and ARV (run_comps)
- When the member asks to run comps / find comps / estimate ARV and gives a street address, call
  run_comps with the full address (street, city, state). If the address is partial, ask for the rest
  first — one question.
- The result contains "rendered_block": relay it VERBATIM. Never re-derive, summarise, or adjust its
  numbers, and NEVER invent a comp, an address, or an ARV yourself. You may add one short coaching
  line after the block.
- If the lookup fails, the block explains why and offers manual entry — relay it, and if they answer
  with their own number, call set_manual_arv.
- Comps runs cost real money and are capped daily. Do not re-run comps for an address you already
  ran this conversation unless the member explicitly asks for a refresh.${manualOnly}`;
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
    const addressHead = prefill.subjectAddress.split(',')[0].trim().toUpperCase();
    const hasArv = digits.includes(arvDigits);
    const hasAddress = addressHead.length > 0 && output.toUpperCase().includes(addressHead);
    const hasOverride = /change arv|override|different arv/i.test(output);
    if (hasArv && hasAddress && hasOverride) return output;
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
  /** Set when a calculator ran on a pre-filled ARV this turn; finish() enforces the echo. */
  lastArvPrefill?: { arv: number; subjectAddress: string; source: 'comps' | 'manual' };
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

  const block = await store.getCompsBlock(ctx.comps.sessionId);

  const explicit = args.after_repair_value;
  if (explicit !== undefined && explicit !== null) {
    // Explicit ARV wins (CONTRACT §8) — but when it EQUALS the stored comps
    // ARV, the model is almost certainly relaying the number it read in the
    // comps tool result rather than the member typing it. Observed live: the
    // model passes the ARV itself, skipping this path entirely, and the reply
    // then carries no address binding and no override offer — the exact
    // wrong-house hazard the echo exists to make visible. Same value ⇒ same
    // guarantees: echo and mismatch guard apply. A genuinely different
    // member-supplied number stays untouched.
    if (block && block.arv > 0 && explicit === block.arv) {
      if (addressConflict(ctx.userMessage, block.subjectAddress, normalizeAddress)) {
        return {
          error:
            `The ARV ${block.arv} is the one computed for ${block.subjectAddress}, but this message names a ` +
            'different property. Do NOT price this deal with it. Ask ONE question: which deal is this — the one ' +
            `at ${block.subjectAddress}, or the new address (offer to run comps on it or take its ARV)?`,
        };
      }
      ctx.lastArvPrefill = { arv: block.arv, subjectAddress: block.subjectAddress, source: block.arvSource };
    }
    return { args };
  }

  if (!block || !(block.arv > 0)) return { args };

  if (addressConflict(ctx.userMessage, block.subjectAddress, normalizeAddress)) {
    return {
      error:
        `No ARV was given, and the stored ARV belongs to ${block.subjectAddress} while this message names a ` +
        'different property. Do NOT reuse the stored ARV. Ask ONE question: which deal is this — the one at ' +
        `${block.subjectAddress}, or the new address (in which case ask for its ARV or offer to run comps on it)?`,
    };
  }

  ctx.lastArvPrefill = { arv: block.arv, subjectAddress: block.subjectAddress, source: block.arvSource };
  return {
    args: { ...args, after_repair_value: block.arv },
    prefill: {
      arv: block.arv,
      arv_source: block.arvSource,
      subject_address: block.subjectAddress,
      echo_instruction:
        `REQUIRED: your reply's first line must state the pre-fill, e.g. "using ARV ` +
        `$${block.arv.toLocaleString('en-US')} from ${block.arvSource === 'comps' ? 'the comps on' : 'your manual entry for'} ` +
        `${block.subjectAddress} — say 'change ARV' to override." Never present a pre-filled ARV as if the member typed it.`,
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
      return setManualArvToolHandler(args, ctx.comps);
    }
    case 'request_calculator_form': {
      const calculator = args.calculator;
      if (!isCalculatorKey(calculator)) {
        return {
          error: `Unknown calculator "${String(calculator)}". Valid: flip, brrrr, land_purchase.`,
        };
      }
      const form = CALCULATOR_FORMS[calculator as CalculatorKey];
      ctx.formRequest.form = form;
      // The model gets the labels (so it can write a natural one-liner) but not
      // the defaults — it must not recite them as if they were the member's.
      return {
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
      return lookupMaterialBudget(String(args.item ?? ''), args.spec_tier as string | undefined);
    case 'search_knowledge_base': {
      const { chunks, embeddingTokens } = await searchKnowledgeBase(
        ctx.openai,
        ctx.supabase,
        ctx.config,
        String(args.query ?? ''),
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
