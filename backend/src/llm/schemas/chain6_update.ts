import { z } from 'zod';
import { SectionEvidenceLinkSchema, UnsupportedClaimSchema } from './chain3_draft';

export const Chain6SectionUpdateOutputSchema = z.object({
  updatedDraftText: z.string(),
  evidenceLinks: z.array(SectionEvidenceLinkSchema).default([]),
  unsupportedClaims: z.array(UnsupportedClaimSchema).default([])
});

export type Chain6SectionUpdateOutput = z.infer<typeof Chain6SectionUpdateOutputSchema>;
