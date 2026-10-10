import OpenAI from 'openai';
import { z } from 'zod';
import { assertOutboundTextIsSafe } from '../deid/outbound';
import { shouldRetryLLMError, summarizeError } from '../utils/errorSummary';
import { appendUsageLog } from './usageLog';

const MAX_RETRIES = 2;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4.1';
let openaiClient: OpenAI | null = null;

export interface LLMUsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export function getDefaultLLMModel(): string {
  return LLM_MODEL;
}

export function hasOpenAIApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const error: any = new Error(
        'OPENAI_API_KEY is not set. Add it to backend/.env before running any chain.'
      );
      error.code = 'missing_api_key';
      throw error;
    }

    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

export async function callLLMWithSchema<T>(
  schema: z.ZodSchema<T>,
  systemPrompt: string,
  userPrompt: string,
  options?: {
    retries?: number;
    model?: string;
    label?: string;
    onUsage?: (usage: LLMUsageMetrics | null) => void;
  }
): Promise<T> {
  const retries = options?.retries ?? MAX_RETRIES;
  const model = options?.model || LLM_MODEL;
  const label = options?.label || 'LLM';
  let lastError: any;

  // Privacy boundary. Runs before the first attempt so a blocked payload costs
  // zero outbound requests. Throwing here is intentional: a chain that forgets
  // to de-identify its input must fail rather than send the identifier.
  assertOutboundTextIsSafe(userPrompt, label);

  for (let i = 0; i <= retries; i++) {
    const attemptStartedAt = Date.now();
    try {
      console.log(`[${label}] attempt ${i + 1}/${retries + 1} started with model=${model}`);
      const response = await getOpenAIClient().chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content);
      const validated = schema.parse(parsed);
      const elapsedMs = Date.now() - attemptStartedAt;
      const usage = response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens
          }
        : null;
      options?.onUsage?.(usage);
      appendUsageLog({
        kind: 'chat',
        label,
        model,
        elapsedMs,
        ...(usage || {}),
        cachedTokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0
      });
      console.log(
        `[${label}] attempt ${i + 1} succeeded in ${elapsedMs}ms` +
          (usage ? ` (tokens in=${usage.promptTokens} out=${usage.completionTokens})` : '')
      );
      return validated;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - attemptStartedAt;
      console.error(
        `[${label}] attempt ${i + 1}/${retries + 1} failed after ${elapsedMs}ms - ${summarizeError(error)}`
      );
      if (i === retries || !shouldRetryLLMError(error)) break;
    }
  }

  throw lastError;
}
