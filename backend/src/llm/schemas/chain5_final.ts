import { z } from 'zod';
import { CareSectionEnum } from './common';

export const FinalDraftSchema = z.object({
  fullTextBySection: z.record(CareSectionEnum, z.string()),
  titleSuggestions: z.array(z.string()).min(1).max(3),
  abstractSuggestion: z.string(),
  careChecklistEvaluation: z.record(
    CareSectionEnum,
    z.object({
      status: z.enum(['FULFILLED', 'INSUFFICIENT', 'MISSING']),
      rationale: z.string()
    })
  )
});

export type FinalDraft = z.infer<typeof FinalDraftSchema>;

