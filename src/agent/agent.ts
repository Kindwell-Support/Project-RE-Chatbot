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

const MAX_TOOL_ROUNDS = 6;

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
  /** Set when the model asked for an inline input form; the widget renders it. */
  renderForm?: CalculatorForm;
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
      return {
        output: message.content ?? '',
        usage,
        retrievedChunkIds,
        similarityScores,
        toolCalls,
        ...(formRequest.form ? { renderForm: formRequest.form } : {}),
      };
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
  return { output: '', usage, retrievedChunkIds, similarityScores, toolCalls };
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
