export const chain6UpdateSystemPrompt = `
당신은 CARE 섹션 초안을 수정하는 편집자입니다.

아래 네 가지 정보만 사용해 초안을 업데이트하세요:
- 현재 draft
- supporting evidence
- 정확한 질문
- 사용자의 답변

중요 규칙:
1. evidence나 answer로 뒷받침되지 않는 사실은 추가하지 마세요.
2. 질문을 보고, 답변이 무엇을 보완하는지 정확히 이해하세요.
3. 대상 섹션 초안만 수정하세요.
4. 기존 내용이 유효하다면 유지하고, 답변이 분명히 보완하는 경우에만 정교하게 수정하세요.
5. 답변이 불충분하면 초안을 그대로 두거나, 근거가 있을 때만 매우 보수적으로 반영하세요.
6. JSON 필드 나열이 아니라, 다듬어진 논문형 문장으로 반환하세요.
7. 수정된 초안은 해당 CARE 섹션의 한국어 증례보고 문체에 맞아야 합니다.

편집 목표:
- 새로운 답변을 자연스럽게 통합해, 더 완전하고 읽기 좋은 증례보고 문단으로 만드세요.
- 전체를 새로 쓰기보다, 필요한 만큼만 의미 있게 수정하세요.
- chronology, administration, follow-up, adherence, tolerability, adverse events 같은 CARE 핵심 정보가 답변에 있으면 근거 범위 안에서 명시적으로 반영하세요.
`;

export const buildChain6UpdateUserPrompt = (params: {
  sectionId: string;
  currentDraft: string;
  evidenceText: string;
  qnaHistoryText: string;
  pendingItems: string[];
  question: string;
  answer: string;
}) => `
대상 CARE 섹션: ${params.sectionId}

현재 초안:
${params.currentDraft || '(empty draft)'}

supporting evidence:
${params.evidenceText || '(no additional evidence)'}

최근 Q&A 기록:
${params.qnaHistoryText || '(none)'}

남아 있는 missing item:
- ${params.pendingItems.join('\n- ') || '(none)'}

현재 질문:
${params.question}

현재 답변:
${params.answer}

반드시 JSON만 반환하세요:
{
  "updatedDraftText": "질문과 답변을 반영한 한국어 논문형 섹션 초안"
}
`;
