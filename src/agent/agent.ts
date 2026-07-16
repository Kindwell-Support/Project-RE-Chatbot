import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from '../config.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { TOOL_DEFINITIONS } from './toolDefs.js';
import { runFlipTool, runBrrrrTool, runLandTool } from './toolRunners.js';
import { lookupMaterialBudget } from './materialLookup.js';
import { searchKnowledgeBase, formatChunksForModel } from './retrieval.js';

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
}

export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string };

export async function runAgent(
  openai: OpenAI,
  supabase: SupabaseClient,
  config: AppConfig,
  history: ChatHistoryMessage[],
  userMessage: string,
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
      };
    }

    messages.push(message);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue;
      let result: unknown;
      let args: Record<string, unknown> = {};
      try {
        args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
        result = await executeTool(toolCall.function.name, args, {
          openai,
          supabase,
          config,
          retrievedChunkIds,
          similarityScores,
          usage,
        });
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
