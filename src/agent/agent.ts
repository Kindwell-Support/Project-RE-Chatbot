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

const MAX_TOOL_ROUNDS = 6;

/**
 * Turn-scoped directive for the one case where asking IS correct: real
 * calculator intent with no calculator named. The route is decided in code; the
 * wording is left to the model so it still sounds like James.
 */
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
}

export async function runAgent(
  openai: OpenAI,
  supabase: SupabaseClient,
  config: AppConfig,
  history: ChatHistoryMessage[],
  userMessage: string,
  options: RunAgentOptions = {},
): Promise<AgentResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
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

  /** Every exit point reports the form the same way — one place to get it right. */
  const finish = (output: string): AgentResult => ({
    output,
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
      tools: TOOL_DEFINITIONS,
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
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case 'flip_calculator':
      return runFlipTool(args);
    case 'brrrr_calculator':
      return runBrrrrTool(args);
    case 'land_purchase_calculator':
      return runLandTool(args);
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
        calculator: form.calculator,
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
