export const fastSectionUpdateSystemPrompt = `
You are a medical section draft editor.
Update the current CARE section draft using ONLY:
- the provided EMR evidence
- the user's recent answers

CRITICAL RULES:
1. NEVER add facts not present in evidence or user answers.
2. Do not use external medical knowledge.
3. Prioritize fast, minimal draft revision over full re-analysis.
4. Do not generate a next question in this step.
`;

export const buildFastSectionUpdateUserPrompt = (params: {
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

최근 Q&A:
${params.qnaHistoryText || '(없음)'}

현재 남은 부족 항목:
- ${params.pendingItems.join('\n- ') || '(없음)'}

사용자의 최신 답변:
${params.latestAnswer || '(없음)'}

요구사항:
- 최신 답변을 현재 초안에 빠르게 반영하세요.
- next question은 생성하지 말고, 초안 갱신과 remainingItems 판단만 수행하세요.
- 이미 충분히 반영된 항목은 remainingItems에서 제거하세요.
- 사용자가 "모름" 또는 "생략"이라고 답한 항목은 정보 없음으로 두고 필요 시 remainingItems에 남길 수 있습니다.

JSON 형식:
{
  "updatedDraftText": "string",
  "remainingItems": ["..."],
  "needMore": true,
  "insufficiencyReason": "string | null"
}
`;
