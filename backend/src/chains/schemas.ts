import { z } from 'zod';
import { CareSection, SectionStatus } from '../types';

// Chain A: Section Evidence Mapping
export const SectionEvidenceMappingSchema = z.object({
  sectionToEvidenceMap: z.record(
    z.string(),
    z.array(z.string()).describe('EMR evidence 조각 리스트')
  ).refine(
    (data) => {
      const validKeys = Object.values(CareSection);
      return Object.keys(data).every(key => validKeys.includes(key as CareSection));
    },
    { message: 'Invalid section key' }
  )
});

// Chain B: Section Status Assessment
export const SectionStatusAssessmentSchema = z.object({
  sectionStatusMap: z.record(
    z.string(),
    z.object({
      status: z.string(),
      rationaleText: z.string().describe('상태 판정 근거 (2~4문장)'),
      missingInfoBullets: z.array(z.string()).describe('부족 정보 bullet 리스트'),
      recommendedQuestions: z.array(z.string()).describe('추천 질문 리스트')
    })
  ).refine(
    (data) => {
      const validKeys = Object.values(CareSection);
      const validStatuses = Object.values(SectionStatus);
      return Object.keys(data).every(key => validKeys.includes(key as CareSection)) &&
             Object.values(data).every(item => validStatuses.includes(item.status as SectionStatus));
    },
    { message: 'Invalid section key or status' }
  )
});

// Chain C: EMR-only Draft Generation
export const DraftGenerationSchema = z.object({
  draftsBySection: z.record(
    z.string(),
    z.string().describe('섹션별 초안 텍스트')
  ).refine(
    (data) => {
      const validKeys = Object.values(CareSection);
      return Object.keys(data).every(key => validKeys.includes(key as CareSection));
    },
    { message: 'Invalid section key' }
  ),
  citations: z.record(
    z.string(),
    z.array(z.string()).describe('사용된 visit/date evidence 키')
  ).optional()
});

// Chain D: Next Question Generation
export const NextQuestionSchema = z.object({
  question: z.string().describe('다음 질문'),
  context: z.string().optional().describe('질문 배경 설명'),
  isComplete: z.boolean().describe('질문이 완료되었는지 여부')
});

// Chain E: Section Draft Update
export const DraftUpdateSchema = z.object({
  updatedDraft: z.string().describe('업데이트된 섹션 초안'),
  addedFacts: z.array(z.string()).describe('추가된 사실 리스트 (반드시 빈 배열이어야 함)'),
  isComplete: z.boolean().describe('섹션이 완성되었는지 여부'),
  nextQuestion: z.string().optional().describe('추가 질문이 필요한 경우')
});

export type SectionEvidenceMapping = z.infer<typeof SectionEvidenceMappingSchema>;
export type SectionStatusAssessment = z.infer<typeof SectionStatusAssessmentSchema>;
export type DraftGeneration = z.infer<typeof DraftGenerationSchema>;
export type NextQuestion = z.infer<typeof NextQuestionSchema>;
export type DraftUpdate = z.infer<typeof DraftUpdateSchema>;
