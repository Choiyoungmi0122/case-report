import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionQuestionSetSchema = z.object({
  sectionId: CareSectionEnum,
  questions: z.array(z.string())
});

export const CommonQuestionSetSchema = z.object({
  question: z.string(),
  targetSectionIds: z.array(CareSectionEnum)
});

export const Chain5QuestionOutputSchema = z.object({
  commonQuestions: z.array(CommonQuestionSetSchema),
  sectionQuestions: z.array(SectionQuestionSetSchema)
});

export type SectionQuestionSet = z.infer<typeof SectionQuestionSetSchema>;
export type CommonQuestionSet = z.infer<typeof CommonQuestionSetSchema>;
