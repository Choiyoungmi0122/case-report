/**
 * 수정 요청 채팅의 "질문 받기" (SW-Q4). 이 섹션을 더 자세히 쓰기 위한 질문 하나를 만든다.
 * 질문은 채팅에 AI 질문 항목(kind 'question')으로 남고, 답은 routes/studyWrite.ts 의 revise(chatAnswer)에서
 * 질의응답에 저장된 뒤 그 답으로 섹션을 고쳐 쓴다.
 */
import { callLLMWithSchema } from '../llm/client';
import { getModelForChain } from '../llm/chains';
import {
  buildStudyWriteChatQuestionUserPrompt,
  studyWriteChatQuestionSystemPrompt
} from '../llm/prompts/studyWrite_chatQuestion';
import { StudyWriteChatQuestionOutputSchema } from '../llm/schemas/studyWrite_chatQuestion';
import { StudyWriteSectionState, StudyWriteState } from '../types/studyWrite';
import { CARE_SECTION_NAMES, careItemsText } from './careItems';
import { effectiveCareStatus } from './careStatus';
import { buildPriorQaSummary, buildRecordText } from './interview';

/** CARE 점검에서 "기록·답변에 없음"인 항목·하위 요소를 필수 먼저 적는다. 하위 요소가 있으면 하위 요소 단위로 */
export function missingCareText(section: StudyWriteSectionState | undefined): string {
  const items = section?.careCheck?.items || [];
  if (items.length === 0) return '(CARE 점검 결과 없음)';
  const lines: Array<{ required: boolean; line: string }> = [];
  for (const item of items) {
    const subs = (item.subItems || []).filter((sub) => sub.status === 'not_in_record');
    if ((item.subItems || []).length > 0) {
      for (const sub of subs) {
        const group = sub.groupLabel ? `${sub.groupLabel} ` : '';
        lines.push({ required: sub.required, line: `- ${sub.id} (${sub.required ? '필수' : '선택'}) ${group}${sub.label}: ${sub.criterion}` });
      }
    } else if (effectiveCareStatus(item) === 'not_in_record') {
      lines.push({ required: item.required, line: `- ${item.code} (${item.required ? '필수' : '선택'}) ${item.label}` });
    }
  }
  if (lines.length === 0) return '(없음)';
  return [...lines.filter((item) => item.required), ...lines.filter((item) => !item.required)].map((item) => item.line).join('\n');
}

/** 이 섹션 채팅에서 이미 한 AI 질문 */
export function askedInChat(section: StudyWriteSectionState | undefined): string {
  return (section?.chat || [])
    .filter((entry) => entry.kind === 'question')
    .map((entry) => `- ${entry.text}${entry.answeredAt ? '' : ' (답 없음)'}`)
    .join('\n');
}

export async function generateSectionChatQuestion(params: {
  caseData: any;
  state: StudyWriteState;
  sectionId: string;
}): Promise<{ question: string; hint: string; targetCode: string; reason: string }> {
  const section = params.state.sections?.[params.sectionId];
  const output = await callLLMWithSchema(
    StudyWriteChatQuestionOutputSchema,
    studyWriteChatQuestionSystemPrompt,
    buildStudyWriteChatQuestionUserPrompt({
      sectionName: CARE_SECTION_NAMES[params.sectionId] || params.sectionId,
      careItems: careItemsText(params.sectionId),
      missingCareText: missingCareText(section),
      sectionDraft: section?.draftText || '',
      priorQaSummary: await buildPriorQaSummary(params.state),
      askedInChat: askedInChat(section),
      recordText: buildRecordText(params.caseData)
    }),
    { model: getModelForChain('chain4'), label: `SW-Q4 ${params.sectionId}` }
  );
  return {
    question: String(output.question || '').trim(),
    hint: String(output.hint || '').trim(),
    targetCode: String(output.targetCode || '').trim(),
    reason: String(output.reason || '').trim()
  };
}
