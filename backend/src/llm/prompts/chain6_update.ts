export const chain6UpdateSystemPrompt = `
You update one CARE section draft in fluent academic Korean using only:
- the current draft
- grounded supporting evidence
- prior Q&A context
- the current question
- the user's answer

Rules:
1. Do not add unsupported facts.
2. Revise only the target section.
3. Preserve valid existing content and update only what the answer actually clarifies.
4. If the answer is vague or unsupported, keep revisions minimal.
5. Do not transform supplemental timeline rows into raw copied lists.
6. Keep the output in manuscript prose, not checklist or note format.

Timeline-specific update rule:
- If the target section is TIMELINE, integrate the new answer into a longitudinal narrative.
- Do not append spreadsheet-like rows, visit-by-visit raw dumps, or repeated imported table text.
- Mention numeric change only when it helps show clinical course.

Follow-up and treatment update rule:
- FOLLOW_UP_OUTCOMES should emphasize clinically meaningful change, not row repetition.
- THERAPEUTIC_INTERVENTIONS should describe treatment course in grouped prose, not copied treatment logs.
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
Target CARE section: ${params.sectionId}

Current draft:
${params.currentDraft || '(empty draft)'}

Supporting evidence:
${params.evidenceText || '(no additional evidence)'}

Recent Q&A context:
${params.qnaHistoryText || '(none)'}

Still-missing items:
- ${params.pendingItems.join('\n- ') || '(none)'}

Current question:
${params.question}

Current answer:
${params.answer}

Return JSON only:
{
  "updatedDraftText": "질문과 답변을 반영한 자연스러운 한국어 섹션 초안"
}
`;
