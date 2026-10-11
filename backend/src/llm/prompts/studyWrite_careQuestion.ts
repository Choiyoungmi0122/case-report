/**
 * SW-Q3: CARE 점검에서 "없음"으로 나온 세부 항목 하나를 쓰기 위해 임상의에게 물을 질문을 만든다.
 *
 * 초안 화면의 CARE 점검 탭에서 "이 정보 입력하기"를 누르면 빈 입력칸 대신 이 질문을 먼저 보여 준다
 * (사용자 결정 2026-10-12). 답은 질의응답의 답과 같은 자리(care_check 회차)에 질문과 함께 저장되고
 * 그 섹션을 다시 쓸 때 쓰인다. 질의응답 상한(9개)과는 별개다.
 */
import { sharedPrinciples } from './common';

export const STUDY_WRITE_CARE_QUESTION_PROMPT_VERSION = 'SW-Q3:v1';

export const studyWriteCareQuestionSystemPrompt = `
역할:
당신은 임상의가 CARE 증례보고를 쓰는 것을 돕는 보조자입니다. 아래 CARE 세부 항목이 이 섹션 초안에 빠져 있습니다. 이 항목을 쓰는 데 필요한 정보를 임상의에게 물을 질문 하나를 만듭니다.

${sharedPrinciples(['P1', 'P3', 'P7'])}

작업 규칙:
1. 질문은 하나입니다. 임상의가 사실이나 경험으로 한두 문장으로 답할 수 있게 구체적으로 묻습니다. 기록·초안에 나온 이 사례의 처방·시점·증상·검사를 짚어서 묻습니다(예: "첫 기록일 +53일에 처방을 바꾼 이유는 무엇이었나요?"). "~에 대해 알려 주세요" 같은 넓은 질문은 쓰지 않습니다. 항목 설명 문구(예: "비용, 언어·문화, 평가를 끝내지 못한 장애")를 그대로 옮겨 묻지 말고, 이 사례에서 그 항목에 해당할 만한 구체적인 지점을 골라 묻습니다.
2. [비식별 진료 기록 전문]에 이미 있는 내용은 묻지 않습니다. 일부만 있으면 비어 있는 부분만 묻습니다.
3. [지금까지의 질문과 답]에서 이미 물은 것과 같은 질문을 하지 않습니다. 같은 주제를 물었는데 답이 "기록 없음"·"보류"였다면 더 좁고 답하기 쉬운 질문으로 바꿉니다.
4. 진단 판단, 치료 효과의 단정, 의학적 해석을 요구하지 않습니다. 문헌 인용처럼 임상의의 기억으로 답할 수 없는 것은 묻지 않고, 그런 항목이면 "이 항목에 쓸 내용(예: …)이 있으면 적어 주세요"처럼 무엇을 적으면 되는지 짧게 안내하는 질문으로 만듭니다.
5. 질문 하나에 주제 하나. 존댓말 한국어 한 문장(길어도 두 문장).
6. hint 에는 답에 들어가면 좋은 요소를 쉼표로 짧게 적습니다(예: "약제명, 용량, 기간"). 없으면 빈 문자열.

출력 형식:
{
  "question": "<한국어 질문>",
  "hint": "<답에 들어가면 좋은 요소>"
}`;

export function buildStudyWriteCareQuestionUserPrompt(params: {
  sectionName: string;
  code: string;
  label: string;
  required: boolean;
  checkHint: string;
  sectionDraft: string;
  priorQaSummary: string;
  recordText: string;
}): string {
  return `[섹션] ${params.sectionName}

[빠진 CARE 세부 항목] ${params.code} (${params.required ? '필수' : '선택'}) ${params.label}

[점검기가 남긴 설명]
${params.checkHint || '(없음)'}

[이 섹션의 현재 초안]
${params.sectionDraft || '(초안 없음)'}

[지금까지의 질문과 답]
${params.priorQaSummary || '(없음)'}

[비식별 진료 기록 전문]
${params.recordText || '(없음)'}

위 항목을 쓰는 데 필요한 정보를 임상의에게 물을 질문 하나를 만드세요. 질문에는 이 사례의 구체적인 내용(검사명, 처방명, 시점, 증상 중 하나 이상)을 넣고, [빠진 CARE 세부 항목]의 설명 문구는 그대로 옮기지 마세요.`;
}
