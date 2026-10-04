import { z } from 'zod';
import { CareSectionEnum } from './common';

export const CommonQuestionCategoryEnum = z.enum([
  'psychosocial_context',
  'symptom_course',
  'functional_impact',
  'treatment_response',
  'patient_perspective',
  'diagnostic_reasoning',
  'follow_up_outcome',
  'adverse_event',
  'consent',
  'timeline_clarification'
]);

export const SectionMissingSchema = z.object({
  sectionId: CareSectionEnum,
  missingItems: z.array(z.string())
});

export const CommonMissingItemSchema = z.object({
  item: z.string(),
  relatedSectionIds: z.array(CareSectionEnum),
  category: CommonQuestionCategoryEnum.optional()
});

export const Chain4MissingOutputSchema = z.object({
  sectionMissing: z.array(SectionMissingSchema),
  commonMissing: z.array(CommonMissingItemSchema)
});

export type SectionMissing = z.infer<typeof SectionMissingSchema>;
export type CommonMissingItem = z.infer<typeof CommonMissingItemSchema>;
export type CommonQuestionCategory = z.infer<typeof CommonQuestionCategoryEnum>;
