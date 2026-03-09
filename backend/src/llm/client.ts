import OpenAI from 'openai';
import { z } from 'zod';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MAX_RETRIES = 2;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4-turbo-preview';

export async function callLLMWithSchema<T>(
  schema: z.ZodSchema<T>,
  systemPrompt: string,
  userPrompt: string,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await openai.chat.completions.create({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content);
      return schema.parse(parsed);
    } catch (error) {
      lastError = error;
      console.error('[LLM] Call or schema validation failed (attempt', i + 1, '):', error);
      if (i === retries) break;
    }
  }

  throw lastError;
}

