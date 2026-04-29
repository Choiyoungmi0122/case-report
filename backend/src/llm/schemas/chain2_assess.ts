import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionStatusEnum = z.enum([
  'IMPOSSIBLE',
  'INCOMPLETE',
  'READY'
]);

export const SectionAssessmentSchema = z.object({
  sectionId: CareSectionEnum,
  status: SectionStatusEnum,
  rationaleText: z.string()
});

export const Chain2OutputSchema = z.object({
  sectionAssessments: z.array(SectionAssessmentSchema)
});

export type SectionAssessment = z.infer<typeof SectionAssessmentSchema>;
