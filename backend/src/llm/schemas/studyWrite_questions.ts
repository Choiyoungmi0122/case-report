import { z } from 'zod';

// targetSectionIds 는 모델이 "8", "therapeutic_interventions" 처럼 돌려줄 수 있어
// 문자열로 받고 interview.ts 에서 CARE 섹션 id로 정규화한다. 비어 있으면 careItem 코드로 섹션을 찾는다.
export const StudyWriteGapQuestionSchema = z.object({
  question: z.string(),
  targetSectionIds: z.array(z.union([z.string(), z.number()])).default([]),
  careItem: z.string().default(''),
  priority: z.enum(['required', 'optional']).default('optional'),
  rationale: z.string().default('')
});

export const StudyWriteGapQuestionsOutputSchema = z.object({
  /** 더 물을 것이 없으면 빈 배열. 3개를 넘겨 내면 검증 실패가 아니라 interview.ts 가 회차 예산만큼 잘라 쓴다. */
  questions: z.array(StudyWriteGapQuestionSchema).default([]),
  /** 질문을 만들지 않았거나 적게 만든 이유 (선택) */
  stopReason: z.string().optional()
});

export type StudyWriteGapQuestion = z.infer<typeof StudyWriteGapQuestionSchema>;
export type StudyWriteGapQuestionsOutput = z.infer<typeof StudyWriteGapQuestionsOutputSchema>;
