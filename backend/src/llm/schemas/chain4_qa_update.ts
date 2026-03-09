import { z } from 'zod';

export const QnAPairSchema = z.object({
  question: z.string(),
  answer: z.string(),
  timestamp: z.string()
});

export const Chain4OutputSchema = z.object({
  nextQuestion: z.string().nullable(),
  whyThisQuestion: z.string(),
  updatedDraftText: z.string(),
  resolvedItems: z.array(z.string()),
  remainingItems: z.array(z.string()),
  needMore: z.boolean(),
  insufficiencyReason: z.string().nullable()
});

export type Chain4Output = z.infer<typeof Chain4OutputSchema>;

