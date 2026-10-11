import { z } from 'zod';
import { SectionEvidenceLinkSchema, UnsupportedClaimSchema } from './chain3_draft';

/** 모델이 내는 것은 갱신된 초안 본문만이다 (chain6_update.ts 프롬프트의 출력 형식). */
export const Chain6ModelOutputSchema = z.object({
  updatedDraftText: z.string()
});

/** 저장·반환 형태. 근거 연결·미지원 문장은 `buildDraftTraceability` 휴리스틱이 덧붙인다. */
export const Chain6SectionUpdateOutputSchema = z.object({
  updatedDraftText: z.string(),
  evidenceLinks: z.array(SectionEvidenceLinkSchema).default([]),
  unsupportedClaims: z.array(UnsupportedClaimSchema).default([])
});

export type Chain6SectionUpdateOutput = z.infer<typeof Chain6SectionUpdateOutputSchema>;
