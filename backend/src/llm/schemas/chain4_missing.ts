import { z } from 'zod';
import { CareSectionCoerced, CareSectionListCoerced } from './common';

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

export type CommonQuestionCategory = z.infer<typeof CommonQuestionCategoryEnum>;

/** 허용 목록 밖의 category 는 버린다(없음으로 처리). 코드가 뒤에서 추정한다. */
export const CommonQuestionCategoryTolerant = z
  .unknown()
  .optional()
  .transform((value): CommonQuestionCategory | undefined => {
    const parsed = CommonQuestionCategoryEnum.safeParse(typeof value === 'string' ? value.trim().toLowerCase() : value);
    return parsed.success ? parsed.data : undefined;
  });

export const SectionMissingSchema = z.object({
  sectionId: CareSectionCoerced,
  missingItems: z.array(z.string()).default([])
});

export const CommonMissingItemSchema = z.object({
  item: z.string(),
  relatedSectionIds: CareSectionListCoerced,
  category: CommonQuestionCategoryTolerant
});

export const Chain4MissingOutputSchema = z.object({
  sectionMissing: z.array(SectionMissingSchema).default([]),
  commonMissing: z.array(CommonMissingItemSchema).default([])
});

export type SectionMissing = z.infer<typeof SectionMissingSchema>;
export type CommonMissingItem = z.infer<typeof CommonMissingItemSchema>;
