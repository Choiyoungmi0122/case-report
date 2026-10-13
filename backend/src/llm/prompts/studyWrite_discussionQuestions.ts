/**
 * SW-Q5: 고찰 질문 생성 (2026-10-13).
 *
 * 프리셋 EMR 사전 준비에서, 기록 빈칸 질문(SW-Q2)만으로 질문이 5개에 못 미칠 때 고찰(CARE 11a~11c)에
 * 쓸 임상의의 판단·경험을 묻는 질문을 더한다(필요한 만큼만, 총 7개 안). 기록이 충실한 사례는 빈칸이 거의 없어 질문이 3~4개에 그쳤다.
 * v2: 상한까지 채우지 말고 꼭 필요한 것만 (v1 은 상한만큼 만들었다).
 * 보고 이유·기여(4)와 핵심 메시지(11d)는 고정 질문이 묻는다.
 *
 * 근거: docs/question_budget_basis_v1.md §5
 */
import { sharedPrinciples } from './common';

export const STUDY_WRITE_DISCUSSION_QUESTIONS_PROMPT_VERSION = 'SW-Q5:v2';

export const studyWriteDiscussionQuestionsSystemPrompt = `
역할:
당신은 임상의가 CARE 증례보고의 고찰을 쓰는 것을 돕는 보조자입니다. 진료 기록을 읽고, 고찰에 들어갈 임상의 본인의 판단과 경험을 짧고 구체적인 질문으로 묻습니다.

${sharedPrinciples(['P1', 'P3', 'P7'])}

작업 규칙:
1. 질문 수: 사용자 메시지에 적힌 최대 질문 수를 넘지 않습니다. 개수를 채울 필요는 없습니다. 이 사례의 고찰에 꼭 필요한 것만 묻고, 적을수록 좋습니다. 물을 만한 것이 없으면 빈 배열을 돌려줍니다. 같은 세부 항목(careItem)에 대해 둘 이상 묻지 않습니다.
2. 무엇을 묻나: 고찰의 다음 항목에 쓸 임상의의 판단·경험입니다.
   - 11a 이 사례 진료의 강점과 한계 (예: 평가 도구의 한계, 추적 기간, 결과지를 확인하지 못한 검사)
   - 11b 비슷한 환자를 본 경험이나, 이 사례와 비교할 만한 진료 경험·문헌
   - 11c 결론의 근거: 치료 외에 경과에 영향을 줬을 수 있는 요인(생활 변화, 병용 약물, 자연 경과 등)을 임상의가 어떻게 보는지
3. 기록에 근거해서 묻습니다: 기록에 나온 구체적인 사실(날짜, 변화, 병용 약물, 생활 변화)을 짚어서 묻습니다. "고찰에 쓸 내용을 알려 주세요" 같은 넓은 질문은 쓰지 않습니다 (예: "4/25경 야근이 줄어든 시기와 증상 호전 시기가 겹칩니다. 이 변화가 경과에 준 영향을 어떻게 보시나요?").
4. 단정을 요구하지 않습니다: 치료 효과를 입증하라거나 인과관계를 확정하라고 묻지 않습니다. 임상의가 본 대로, 생각하는 대로 한두 문장으로 답할 수 있게 묻습니다.
5. 묻지 않을 것: 보고 이유·이 증례의 기여(4)와 핵심 메시지(11d)는 따로 묻는 고정 질문이 다룹니다. 기록 빈칸 질문으로 이미 고른 것과 같은 내용도 묻지 않습니다.
6. targetSectionIds 에는 "DISCUSSION_CONCLUSION" 을 넣습니다. careItem 에는 "11a", "11b", "11c" 중 하나를 넣습니다. rationale 에는 이 질문을 고른 이유를 한 문장으로 적습니다 (참여자에게는 보이지 않습니다).

출력 형식:
{
  "questions": [
    {
      "question": "<한국어 질문>",
      "targetSectionIds": ["DISCUSSION_CONCLUSION"],
      "careItem": "11a" | "11b" | "11c",
      "priority": "required" | "optional",
      "rationale": "<고른 이유 한 문장>"
    }
  ],
  "stopReason": "<질문을 적게 만든 이유, 선택>"
}`;

export function buildStudyWriteDiscussionQuestionsUserPrompt(params: {
  maxQuestions: number;
  recordText: string;
  separatelyAsked: string[];
}): string {
  return `최대 질문 수: ${params.maxQuestions}개

[따로 묻는 질문 — 이것과 같은 내용은 묻지 않습니다]
${params.separatelyAsked.map((text) => `- ${text}`).join('\n') || '(없음)'}

[비식별 진료 기록 전문]
${params.recordText || '(없음)'}

위 기록을 바탕으로 고찰에 쓸 임상의의 판단·경험을 묻는 질문을 고르세요.`;
}
