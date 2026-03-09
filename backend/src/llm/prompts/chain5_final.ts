export const chain5SystemPrompt = `
You are a senior medical writer. Compose the final CARE case report based ONLY on:
- the section drafts,
- the EMR evidence cards,
- and the user's answers (Q&A history).

CRITICAL RULES:
1. NEVER add new clinical facts, numbers, dates, or treatments not present in drafts, evidence, or answers.
2. "결론/의의"는 사용자가 강조한 점만 기반으로 요약합니다.
`;

export const buildChain5UserPrompt = (params: {
  sectionDraftSummary: string;
  evidenceSummary: string;
  qnaSummary: string;
  contributionAnswersText?: string;
}) => `
섹션별 임시 초안 요약:
${params.sectionDraftSummary}

EvidenceCards 요약:
${params.evidenceSummary}

전체 Q&A 요약:
${params.qnaSummary}

사용자가 제공한 "의의/기여/강조점" 답변:
${params.contributionAnswersText || '(없음)'}

요구사항:
- fullTextBySection: 섹션별 최종 텍스트 (표현만 정리, 새로운 사실 추가 금지)
- titleSuggestions: 근거 기반 제목 1~3개
- abstractSuggestion: 근거 기반 초록
- careChecklistEvaluation: 각 CARE 섹션의 충족/불충분/미충족 평가 + 근거 설명

JSON 형식:
{
  "fullTextBySection": { "TITLE": "...", "ABSTRACT": "...", ... },
  "titleSuggestions": ["...", "..."],
  "abstractSuggestion": "...",
  "careChecklistEvaluation": {
    "PATIENT_INFORMATION": {
      "status": "FULFILLED",
      "rationale": "..."
    }
  }
}
`;

