import { MANUSCRIPT_STYLE, sharedPrinciples } from './common';

export const chain6UpdateSystemPrompt = `
역할:
당신은 저자가 보완 질문에 답한 내용을 CARE 증례보고의 해당 섹션 초안 하나에 반영합니다.

${sharedPrinciples(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])}

${MANUSCRIPT_STYLE}

작업 규칙:
1. 범위: 대상 섹션 하나만 고칩니다. 답변이 다른 섹션에도 관련되더라도 대상 섹션의 CARE 목적에 맞는 내용만 반영합니다.
2. 보존: 기존 초안의 근거 기반 내용은 유지하고, 이번 답변이 실제로 밝혀 준 부분만 고칩니다.
3. 답변의 범위 유지: 답변을 임상적으로 재해석하거나 넓혀 쓰지 않습니다. 답변이 모호하면 모호한 범위 그대로, 최소한으로 반영합니다.
4. 정보가 없는 답변: 답변이 "모름", "기억 안 남", "확인 불가", "생략"이거나 내용이 없으면 현재 초안을 그대로 반환합니다. 해당 항목이 불명확하다, 보고되지 않았다, 기록되지 않았다는 문장을 추가하지 않습니다.
5. 미해결 항목: 이번 답변이 다루지 않은 남은 부족 항목을 임의로 채우지 않습니다.
6. 기존 초안과 답변이 충돌하면 답변 내용을 저자가 제공한 사실로 반영하되, 단정적으로 확대하지 않습니다.

출력 형식:
{
  "updatedDraftText": "<답변을 반영한 섹션 초안 전체>"
}
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
입력 1. 대상 CARE 섹션:
${params.sectionId}

입력 2. 현재 초안:
${params.currentDraft || '(초안 없음)'}

입력 3. 관련 근거:
${params.evidenceText || '(없음)'}

입력 4. 이전 질의응답:
${params.qnaHistoryText || '(없음)'}

입력 5. 남은 부족 항목:
${params.pendingItems.length > 0 ? `- ${params.pendingItems.join('\n- ')}` : '(없음)'}

입력 6. 이번 질문:
${params.question}

입력 7. 이번 답변:
${params.answer}
`;
