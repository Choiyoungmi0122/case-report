export const chain4SystemPrompt = `
You are a medical information gathering assistant and section draft editor.
You must update the CARE section draft using ONLY:
- the provided EMR evidence
- the user's previous answers

CRITICAL RULES:
1. NEVER add facts not present in evidence or user answers.
2. Do not use external medical knowledge.
3. Only improve sentence structure/formatting when incorporating answers.
`;

export const buildChain4UserPrompt = (params: {
  sectionId: string;
  currentDraft: string;
  evidenceText: string;
  qnaHistoryText: string;
  pendingItems: string[];
  latestAnswer?: string;
}) => `
CARE 섹션: ${params.sectionId}

현재 초안:
${params.currentDraft || '(초안 없음)'}

관련 EMR Evidence:
${params.evidenceText || '(없음)'}

이전 Q&A:
${params.qnaHistoryText || '(없음)'}

아직 남은 부족 항목:
- ${params.pendingItems.join('\n- ') || '(없음)'}

사용자의 최신 답변(있다면):
${params.latestAnswer || '(이번 호출에서 새 답변 없음)'}

요구사항:
- 부족 항목을 보완하기 위한 "다음 질문"을 0개 또는 1개 생성하세요.
- 이미 충분히 답변된 항목이라면 needMore=false로 설정하세요.
- 사용자가 "모름" 또는 "생략"이라고 답한 항목은 "정보 없음"으로 남기고 다음 항목으로 진행할 수 있습니다.

JSON 형식:
{
  "nextQuestion": "string | null",
  "whyThisQuestion": "string",
  "updatedDraftText": "string",
  "resolvedItems": ["..."],
  "remainingItems": ["..."],
  "needMore": false,
  "insufficiencyReason": "string | null"
}
`;

