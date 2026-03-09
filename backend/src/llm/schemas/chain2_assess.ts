import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionStatusEnum = z.enum([
  'IMPOSSIBLE',
  'PARTIAL_IMPOSSIBLE',
  'PARTIAL_POSSIBLE',
  'POSSIBLE',
  'FULLY_POSSIBLE'
]);

export const SectionStateSchema = z.object({
  sectionId: CareSectionEnum,
  status: SectionStatusEnum,
  rationaleText: z.string(),
  missingInfoBullets: z.array(z.string()),
  recommendedQuestions: z.array(z.string())
});

export const Chain2OutputSchema = z.object({
  sectionStates: z.array(SectionStateSchema)
});

export type SectionState = z.infer<typeof SectionStateSchema>;

