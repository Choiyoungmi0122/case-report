import { z } from 'zod';

export const Chain6SectionUpdateOutputSchema = z.object({
  updatedDraftText: z.string()
});

export type Chain6SectionUpdateOutput = z.infer<typeof Chain6SectionUpdateOutputSchema>;
