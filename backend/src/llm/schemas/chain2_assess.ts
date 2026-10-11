import { z } from 'zod';
import { CareSectionCoerced } from './common';

export const SectionStatusEnum = z.enum([
  'IMPOSSIBLE',
  'INCOMPLETE',
  'READY'
]);

export const SectionAssessmentSchema = z.object({
  sectionId: CareSectionCoerced,
  status: SectionStatusEnum,
  rationaleText: z.string().default('')
});

export const Chain2OutputSchema = z.object({
  sectionAssessments: z.array(SectionAssessmentSchema).default([])
});

export type SectionAssessment = z.infer<typeof SectionAssessmentSchema>;
