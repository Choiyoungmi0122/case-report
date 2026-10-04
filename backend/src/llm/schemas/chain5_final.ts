import { z } from 'zod';
import { CareSectionEnum } from './common';
import { SectionEvidenceLinkSchema, UnsupportedClaimSchema } from './chain3_draft';

export const FinalDraftSectionEnum = z.enum([...CareSectionEnum.options, 'KEYWORDS']);

export const FinalDraftSchema = z.object({
  fullTextBySection: z.record(FinalDraftSectionEnum, z.string()),
  titleSuggestions: z.array(z.string()).min(1).max(3),
  keywordSuggestions: z.array(z.string()).min(1).max(7).default([]),
  abstractSuggestion: z.string(),
  sectionTraceability: z
    .record(
      CareSectionEnum,
      z.object({
        evidenceLinks: z.array(SectionEvidenceLinkSchema).default([]),
        unsupportedClaims: z.array(UnsupportedClaimSchema).default([])
      })
    )
    .default({} as Record<string, { evidenceLinks: Array<{ sentence: string; evidenceCardIds: string[] }>; unsupportedClaims: Array<{ sentence: string; reason: string }> }>),
  careChecklistEvaluation: z.record(
    CareSectionEnum,
    z.object({
      status: z.enum(['FULFILLED', 'INSUFFICIENT', 'MISSING']),
      rationale: z.string()
    })
  )
});

export type FinalDraft = z.infer<typeof FinalDraftSchema>;

