import OpenAI from 'openai';
import { z } from 'zod';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_RETRIES = 2;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4.1';

export async function callLLMWithSchema<T>(
  schema: z.ZodSchema<T>,
  systemPrompt: string,
  userPrompt: string,
  options?: {
    retries?: number;
    model?: string;
    label?: string;
  }
): Promise<T> {
  const retries = options?.retries ?? MAX_RETRIES;
  const model = options?.model || LLM_MODEL;
  const label = options?.label || 'LLM';
  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    const attemptStartedAt = Date.now();
    try {
      console.log(`[${label}] attempt ${i + 1}/${retries + 1} started with model=${model}`);
      const response = await openai.chat.completions.create({
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
      console.log(`[${label}] attempt ${i + 1} succeeded in ${elapsedMs}ms`);
      return validated;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - attemptStartedAt;
      console.error(`[${label}] attempt ${i + 1} failed after ${elapsedMs}ms:`, error);
      if (i === retries) break;
    }
  }

  throw lastError;
}

