import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionMissingSchema = z.object({
  sectionId: CareSectionEnum,
  missingItems: z.array(z.string())
});

export const CommonMissingItemSchema = z.object({
  item: z.string(),
  relatedSectionIds: z.array(CareSectionEnum)
});

export const Chain4MissingOutputSchema = z.object({
  sectionMissing: z.array(SectionMissingSchema),
  commonMissing: z.array(CommonMissingItemSchema)
});

export type SectionMissing = z.infer<typeof SectionMissingSchema>;
export type CommonMissingItem = z.infer<typeof CommonMissingItemSchema>;
