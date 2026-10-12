import { z } from 'zod';

/** SW-Q4 출력: 수정 요청 채팅의 "질문 받기" */
export const StudyWriteChatQuestionOutputSchema = z.object({
  /** 물을 것이 없으면 빈 문자열 */
  question: z.string().default(''),
  /** 답에 들어가면 좋은 요소 (질문 아래 작게 보여 준다) */
  hint: z.string().optional().default(''),
  /** 이 질문이 채우는 CARE 항목·하위 요소 id. 없으면 빈 문자열 */
  targetCode: z.string().optional().default(''),
  /** 왜 이 질문을 골랐는지 (임상의에게 보여 준다) */
  reason: z.string().optional().default('')
});

export type StudyWriteChatQuestionOutput = z.infer<typeof StudyWriteChatQuestionOutputSchema>;
