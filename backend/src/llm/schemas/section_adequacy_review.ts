import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionAdequacyStatusEnum = z.enum(['INSUFFICIENT', 'BORDERLINE', 'ADEQUATE']);

export const SectionAdequacyReviewOutputSchema = z.object({
  sectionId: CareSectionEnum,
  adequacyStatus: SectionAdequacyStatusEnum,
  summary: z.string(),
  missingRequiredItems: z.array(z.string()),
  depthIssues: z.array(z.string()),
  shouldAskMore: z.boolean(),
  questionFocus: z.string()
});

export type SectionAdequacyReviewOutput = z.infer<typeof SectionAdequacyReviewOutputSchema>;
