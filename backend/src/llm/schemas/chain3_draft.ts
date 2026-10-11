import { z } from 'zod';
import { CareSectionCoerced, CareSectionEnum } from './common';

export const SectionEvidenceLinkSchema = z.object({
  sentence: z.string(),
  evidenceCardIds: z.array(z.string())
});

export const UnsupportedClaimSchema = z.object({
  sentence: z.string(),
  reason: z.string()
});

/**
 * 모델이 실제로 내는 필드 (chain3_draft.ts 프롬프트의 출력 형식과 같다).
 * 섹션 id 는 "therapeutic_intervention" 같은 변형을 허용한다. 빠진 배열은 빈 배열로 둔다.
 */
export const Chain3ModelSectionDraftSchema = z.object({
  sectionId: CareSectionCoerced,
  evidenceCardIdsUsed: z.array(z.string()).default([]),
  timelineEventIdsUsed: z.array(z.string()).optional().default([]),
  draftText: z.string().default(''),
  openIssues: z.array(z.string()).default([])
});

export const Chain3ModelOutputSchema = z.object({
  sectionDrafts: z.array(Chain3ModelSectionDraftSchema).default([])
});

/**
 * 저장되는 섹션 초안. `evidenceLinks`·`unsupportedClaims` 는 모델이 내는 것이 아니라
 * `chains.ts` 의 `buildDraftTraceability` 가 문자 2-gram 일치로 추정해 덧붙이는 휴리스틱이다.
 */
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
