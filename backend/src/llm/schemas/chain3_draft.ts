import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionDraftSchema = z.object({
  sectionId: CareSectionEnum,
  evidenceCardIdsUsed: z.array(z.string().uuid()),
  draftText: z.string(),
  openIssues: z.array(z.string())
});

export const Chain3OutputSchema = z.object({
  sectionDrafts: z.array(SectionDraftSchema)
});

export type SectionDraft = z.infer<typeof SectionDraftSchema>;

