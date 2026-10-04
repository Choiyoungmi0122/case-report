import { z } from 'zod';
import { CareSectionEnum } from './common';

export const SectionEvidenceLinkSchema = z.object({
  sentence: z.string(),
  evidenceCardIds: z.array(z.string())
});

export const UnsupportedClaimSchema = z.object({
  sentence: z.string(),
  reason: z.string()
});

export const SectionDraftSchema = z.object({
  sectionId: CareSectionEnum,
  evidenceCardIdsUsed: z.array(z.string()),
  timelineEventIdsUsed: z.array(z.string()).optional().default([]),
  draftText: z.string(),
  openIssues: z.array(z.string()),
  evidenceLinks: z.array(SectionEvidenceLinkSchema).default([]),
  unsupportedClaims: z.array(UnsupportedClaimSchema).default([])
});

export const Chain3OutputSchema = z.object({
  sectionDrafts: z.array(SectionDraftSchema)
});

export type SectionDraft = z.infer<typeof SectionDraftSchema>;

