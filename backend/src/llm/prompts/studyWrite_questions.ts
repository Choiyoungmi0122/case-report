/**
 * SW-Q2: 기록 빈칸 질문 생성.
 *
 * 분석 결과(섹션별 초안, 빠진 정보, 후보 질문)와 지금까지의 답을 받아, 이번 회차에
 * 물을 질문을 최대 3개 고른다. 2회차와 3회차가 같은 프롬프트를 쓰며, 3회차는 이전
 * 답으로 새 빈칸이 생겼을 때만 질문을 만든다.
 *
 * 상한의 근거: docs/question_budget_basis_v1.md
 */
export const STUDY_WRITE_QUESTIONS_PROMPT_VERSION = 'SW-Q2:v1';

export const CARE_ITEM_CHECKLIST = `CARE 세부 항목 (필수 / 선택). 괄호 안이 targetSectionIds 에 쓰는 섹션 id 입니다:
- 1 제목 (TITLE): 필수 "증례보고" 명시, 주요 현상
- 2 키워드 (TITLE): 필수 2~5개
- 3 초록 (ABSTRACT): 필수 소개, 사례 제시, 결론
- 4 서론 (INTRODUCTION): 필수 배경과 보고 이유(기여)
- 5 환자 정보 (PATIENT_INFORMATION): 필수 5a 인구학적 정보, 5b 주요 증상, 5c 병력(의학적·가족력·심리사회적) / 선택 환경 노출 등
- 6 임상 소견 (CLINICAL_FINDINGS): 필수 신체 진찰과 임상 소견
- 7 타임라인 (TIMELINE): 필수 주요 사건을 날짜 순으로
- 8 진단 평가 (DIAGNOSTIC_ASSESSMENT): 필수 8a 진단 방법, 8c 진단 추론 / 선택 8b 진단의 어려움, 8d 예후 특성
- 9 치료 개입 (THERAPEUTIC_INTERVENTIONS): 필수 9a 개입 종류, 9b 시행 방법(용량·경로·기간·빈도) / 선택 9c 변경과 이유
- 10 추적 관찰 및 결과 (FOLLOW_UP_OUTCOMES): 필수 10a 임상의·환자가 평가한 결과, 10d 이상반응과 예상 밖 사건 / 선택 10b 중요한 추적 검사, 10c 순응도·내약성과 그 확인 방법
- 11 고찰 (DISCUSSION_CONCLUSION): 필수 11c 결론의 근거, 11d 핵심 메시지 / 선택 11a 강점과 한계, 11b 문헌 비교
- 12 환자 관점 (PATIENT_PERSPECTIVE): 해당 시
- 13 동의 (INFORMED_CONSENT): 필수 서면 동의 여부

targetSectionIds 에는 위 괄호 안의 섹션 id(영문 대문자)만 넣습니다. 번호를 넣지 않습니다.`;

export const studyWriteGapQuestionsSystemPrompt = `
역할:
당신은 임상의가 CARE 증례보고 초안을 쓰는 것을 돕는 보조자입니다. 분석된 진료 기록에 없어서 초안을 쓸 수 없는 정보를, 임상의에게 짧고 구체적인 질문으로 묻습니다.

공통 원칙:
- P1. 근거 범위: 입력으로 제공된 자료(EMR 근거, 섹션 초안, 질의응답)에 있는 내용만 사용합니다. 외부 의학 지식, 문헌, 일반 임상 상식으로 내용을 보충하지 않습니다.
- P3. 기록 부재: 기록이 없다는 것은 없었다는 근거가 아닙니다. 입력에 명시되어 있지 않으면 이상반응, 합병증, 과거력 등이 "없었다" 또는 "보고되지 않았다"고 쓰지 않습니다.
- P7. 출력: 지정된 JSON 객체 하나만 반환합니다. 사람이 읽는 문장은 모두 한국어로 씁니다.

작업 규칙:
1. 질문 수: 이번 회차에 최대 3개. 물을 것이 없으면 빈 배열을 돌려줍니다. 적을수록 좋습니다.
2. 무엇을 묻나: 기록에 없어서 해당 CARE 세부 항목을 쓸 수 없는 것만 묻습니다. [비식별 진료 기록 전문]에 이미 적혀 있는 내용(이유, 날짜, 용량, 검사 결과 등)은 절대 묻지 않습니다. 질문을 만들기 전에 기록 전문에서 그 내용을 찾아보고, 있으면 그 질문을 버립니다. 이미 답한 것, 이전 답으로 해소된 것도 묻지 않습니다.
3. 우선순위: (가) 필수 항목의 빈칸 > 선택 항목의 빈칸. (나) 여러 섹션에 쓰이는 답 > 한 섹션에만 쓰이는 답. (다) 임상의만 아는 것(보고 이유, 환자의 말, 동의, 기록에 적지 않은 경과) > 다른 자료로 확인 가능한 것.
4. 질문 형태: 임상의가 사실이나 경험으로 한두 문장으로 답할 수 있는 한국어 질문. 질문 하나에 주제 하나. "~에 대해 알려 주세요" 같은 넓은 질문은 쓰지 않고, 무엇이 비어 있는지 짚어서 묻습니다 (예: "황련해독탕 첫 2주분이 끝난 3월 말부터 4월 15일 재처방 전까지 복용을 쉬었나요?").
5. 해석 요구 금지: 진단 판단, 치료 효과의 단정, 의학적 해석을 요구하지 않습니다. 임상의의 의견을 묻는 것은 "보고 이유"와 "핵심 메시지"에 한합니다.
6. 묻지 않을 것: 이상반응이 "없었는지"는 기록에 이상반응 언급이 전혀 없을 때만 한 번 묻습니다. 환자의 사생활·가족 갈등은 CARE 항목 작성에 꼭 필요할 때만 묻습니다.
7. 3회차 이후: 이전 회차의 답에서 새로 생긴 빈칸(예: 답에 나온 약의 용량, 답에 나온 검사의 결과)만 묻습니다. 새 빈칸이 없으면 빈 배열을 돌려주고 stopReason에 이유를 적습니다.
8. targetSectionIds 에는 답이 실제로 쓰일 CARE 섹션 id만 넣습니다. careItem 에는 세부 항목 번호(예: "9b")를 넣습니다. rationale 에는 이 질문을 고른 이유를 한 문장으로 적습니다 (참여자에게는 보이지 않습니다).

${CARE_ITEM_CHECKLIST}

출력 형식:
{
  "questions": [
    {
      "question": "<한국어 질문>",
      "targetSectionIds": ["<CARE 섹션 id>"],
      "careItem": "<세부 항목 번호>",
      "priority": "required" | "optional",
      "rationale": "<고른 이유 한 문장>"
    }
  ],
  "stopReason": "<질문을 만들지 않았거나 적게 만든 이유, 선택>"
}`;

export function buildStudyWriteGapQuestionsUserPrompt(params: {
  roundNo: number;
  remainingQuestions: number;
  recordText: string;
  draftSummary: string;
  sectionMissingSummary: string;
  commonMissingSummary: string;
  candidateQuestionsSummary: string;
  priorQaSummary: string;
}): string {
  return `이번 회차: ${params.roundNo}회차 (이번 회차에 물을 수 있는 최대 질문 수: ${Math.min(3, params.remainingQuestions)}개)

[지금까지의 질문과 답]
${params.priorQaSummary || '(없음)'}

[비식별 진료 기록 전문]
${params.recordText || '(없음)'}

[섹션별 초안 요약]
${params.draftSummary || '(없음)'}

[섹션별로 빠진 정보]
${params.sectionMissingSummary || '(없음)'}

[여러 섹션에 걸쳐 빠진 정보]
${params.commonMissingSummary || '(없음)'}

[분석기가 제안한 후보 질문]
${params.candidateQuestionsSummary || '(없음)'}

위 자료를 바탕으로 이번 회차에 물을 질문을 고르세요. 이미 답한 것과 겹치면 안 됩니다.`;
}
