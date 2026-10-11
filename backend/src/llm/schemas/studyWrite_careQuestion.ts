import { z } from 'zod';

/** SW-Q3 출력: CARE 점검에서 빠진 항목 하나를 쓰기 위한 질문 */
export const StudyWriteCareQuestionOutputSchema = z.object({
  question: z.string().min(1),
  /** 답에 들어가면 좋은 요소 (질문 아래 작게 보여 준다) */
  hint: z.string().optional().default('')
});

export type StudyWriteCareQuestionOutput = z.infer<typeof StudyWriteCareQuestionOutputSchema>;
