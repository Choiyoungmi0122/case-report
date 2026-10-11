import { z } from 'zod';
import { CareSectionCoerced, CareSectionListCoerced } from './common';
import { CommonQuestionCategoryTolerant } from './chain4_missing';

export const SectionQuestionSetSchema = z.object({
  sectionId: CareSectionCoerced,
  questions: z.array(z.string()).default([])
});

export const CommonQuestionSetSchema = z.object({
  question: z.string(),
  targetSectionIds: CareSectionListCoerced,
  category: CommonQuestionCategoryTolerant
});

export const Chain5QuestionOutputSchema = z.object({
  commonQuestions: z.array(CommonQuestionSetSchema).default([]),
  sectionQuestions: z.array(SectionQuestionSetSchema).default([])
});

export type SectionQuestionSet = z.infer<typeof SectionQuestionSetSchema>;
export type CommonQuestionSet = z.infer<typeof CommonQuestionSetSchema>;
