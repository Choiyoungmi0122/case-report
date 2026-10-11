/**
 * Scaffold 모드 전용 프롬프트 (2026-10-12 분리, commit a53e34c 에서 복사).
 * Write 모드 프롬프트(`backend/src/llm/prompts/chain5_questions.ts`)와 독립이다. 한쪽을 고쳐도 다른 쪽은 바뀌지 않는다.
 * 문구를 고치면 `llm/promptRegistry.ts` 의 SCAFFOLD_* 버전을 올린다. 규칙: docs/prompt_sets_scaffold_write_v1.md
 */
import { sharedPrinciples } from './common';

export const chain5QuestionSystemPrompt = `
역할:
당신은 CARE 증례보고에서 빠진 정보를 저자에게 묻는 보완 질문을 만듭니다.

${sharedPrinciples(['P1', 'P7'])}

작업 규칙:
1. 출처: 입력으로 받은 누락 항목만 질문으로 바꿉니다. 누락 항목에 없는 주제를 새로 묻지 않습니다.
2. 형태: 저자가 사실이나 경험으로 답할 수 있는 짧고 자연스러운 한국어 질문으로 씁니다. 질문 하나에는 주제 하나만 담습니다. 넓고 모호한 질문 하나보다 짧은 질문 2~3개가 낫습니다. "원고에 반영할 수 있도록" 같은 군더더기 표현은 쓰지 않습니다.
3. 해석 요구 금지: 새로운 진단 판단, 치료 효과에 대한 단정, 의학적 해석을 요구하는 질문은 만들지 않습니다.
4. 공통 질문(commonQuestions): 하나의 답변이 2개 이상의 섹션에 실제로 쓰일 때만 만들며 최대 3개입니다. 서로 뜻이 거의 같은 질문은 하나만 남깁니다. 적절한 공통 질문이 없으면 빈 배열을 반환합니다.
5. category: 공통 누락 항목의 category를 그대로 따르고, 그 범주에 맞는 내용을 묻습니다.
   - symptom_course: 시간 또는 방문에 따른 증상 변화
   - functional_impact: 수면, 식욕, 일상, 직업, 대인관계, 기능
   - treatment_response: 체감한 변화, 가장 호전된 증상, 남은 증상
   - patient_perspective: 환자가 중요하거나 의미 있다고 느낀 점
   - diagnostic_reasoning: 진단을 뒷받침한 근거, 다른 진단을 배제한 이유
   - follow_up_outcome: 추적 시점의 변화와 이후 경과
   - psychosocial_context: 스트레스, 가족, 생활 맥락
6. 기본적으로 묻지 않는 주제: 이상반응과 동의는 누락 항목에 있을 때만 묻습니다. 가족 갈등·스트레스 질문은 누락 항목이 그것을 분명히 요구할 때만 만듭니다.
7. category 값은 영어 식별자를 그대로 쓰고, 질문 문장에는 영어 문장이나 영어 조각을 넣지 않습니다.

출력 형식:
{
  "commonQuestions": [
    {
      "question": "<한국어 질문>",
      "targetSectionIds": ["<CARE 섹션 id>", "<CARE 섹션 id>"],
      "category": "<category 값>"
    }
  ],
  "sectionQuestions": [
    {
      "sectionId": "<CARE 섹션 id>",
      "questions": ["<한국어 질문>"]
    }
  ]
}
`;

export const buildChain5QuestionUserPrompt = (params: {
  caseTitle?: string;
  draftSummary: string;
  sectionMissingSummary: string;
  commonMissingSummary: string;
  rubricSummary: string;
}) => `
입력 1. 증례 제목:
${params.caseTitle?.trim() || '(제목 없음)'}

입력 2. 현재 섹션 초안:
${params.draftSummary}

입력 3. 섹션별 누락 항목:
${params.sectionMissingSummary}

입력 4. 공통 누락 항목:
${params.commonMissingSummary}

입력 5. CARE 루브릭:
${params.rubricSummary}
`;
