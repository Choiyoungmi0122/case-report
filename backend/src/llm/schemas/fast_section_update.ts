import { z } from 'zod';

export const FastSectionUpdateOutputSchema = z.object({
  updatedDraftText: z.string(),
  remainingItems: z.array(z.string()),
  needMore: z.boolean(),
  insufficiencyReason: z.string().nullable()
});

export type FastSectionUpdateOutput = z.infer<typeof FastSectionUpdateOutputSchema>;
