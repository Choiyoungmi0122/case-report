/**
 * 수정 요청 채팅의 "질문 받기" (SW-Q4). 이 섹션을 더 자세히 쓰기 위한 질문 하나를 만든다.
 * 질문은 채팅에 AI 질문 항목(kind 'question')으로 남고, 답은 routes/studyWrite.ts 의 revise(chatAnswer)에서
 * 질의응답에 저장된 뒤 그 답으로 섹션을 고쳐 쓴다.
 *
 * 2026-10-12 임교수 테스트 6 열두 섹션 시험에서 나온 문제를 코드로 막는다(사용자 결정):
 *  - 제목·초록은 본문 요약이라 새 정보를 묻지 않는다 → 체인을 부르지 않고 안내만
 *  - 문헌으로 채우는 요소(4-1, 4b-1, 11b-1)는 임상의에게 물을 것이 아니다 → 빠진 목록에서 뺀다
 *  - 빠진 요소가 없으면 억지 질문을 만들지 않는다 → 체인을 부르지 않고 "채워져 있다"고 알린다
 *  - 고른 요소가 빠진 목록에 없으면(다른 섹션 등) 질문을 버린다
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
import { normalizeSubElementId } from './drafting';

/** 본문을 요약하는 섹션: 질문 받기 대상이 아니다 */
export const CHAT_QUESTION_SUMMARY_SECTIONS = new Set(['TITLE', 'ABSTRACT']);

/** 임상의의 기억·기록이 아니라 문헌으로 채우는 요소 */
function isLiteratureElement(criterion: string): boolean {
  return /\[문헌 보완 필요\]/.test(criterion);
}

export interface MissingCareElement {
  id: string;
  required: boolean;
  line: string;
}

/** CARE 점검에서 "기록·답변에 없음"인 요소. 하위 요소가 있으면 하위 요소 단위, 필수 먼저. 문헌 요소는 뺀다 */
export function missingCareElements(section: StudyWriteSectionState | undefined): MissingCareElement[] {
  const out: MissingCareElement[] = [];
  for (const item of section?.careCheck?.items || []) {
    if ((item.subItems || []).length > 0) {
      for (const sub of item.subItems || []) {
        if (sub.status !== 'not_in_record' || isLiteratureElement(sub.criterion)) continue;
        const group = sub.groupLabel ? `${sub.groupLabel} ` : '';
        const condition = sub.condition ? ` (조건: ${sub.condition})` : '';
        out.push({ id: sub.id, required: sub.required, line: `- ${sub.id} (${sub.required ? '필수' : '선택'}) ${group}${sub.label}: ${sub.criterion}${condition}` });
      }
    } else if (effectiveCareStatus(item) === 'not_in_record') {
      out.push({ id: item.code, required: item.required, line: `- ${item.code} (${item.required ? '필수' : '선택'}) ${item.label}` });
    }
  }
  return [...out.filter((item) => item.required), ...out.filter((item) => !item.required)];
}

export function missingCareText(section: StudyWriteSectionState | undefined): string {
  if (!section?.careCheck?.items?.length) return '(CARE 점검 결과 없음)';
  const missing = missingCareElements(section);
  return missing.length > 0 ? missing.map((item) => item.line).join('\n') : '(없음)';
}

/** 이 섹션 채팅에서 이미 한 AI 질문 */
export function askedInChat(section: StudyWriteSectionState | undefined): string {
  return (section?.chat || [])
    .filter((entry) => entry.kind === 'question')
    .map((entry) => `- ${entry.text}${entry.answeredAt ? '' : entry.skippedAt ? ' (건너뜀)' : ' (답 없음)'}`)
    .join('\n');
}

/** 모델이 적은 targetCode 가운데 빠진 목록에 있는 것만 남긴다 */
export function validTargets(targetCode: string, missing: MissingCareElement[]): string[] {
  const allowed = new Map(missing.map((item) => [normalizeSubElementId(item.id), item.id]));
  return String(targetCode || '')
    .split(/[,，/]/)
    .map((code) => allowed.get(normalizeSubElementId(code.trim())))
    .filter((code): code is string => Boolean(code));
}

/** 기록 자체를 확인하는 질문("…기록에 있나요?", "기록되어 있나요?") */
export function asksAboutRecord(question: string): boolean {
  return /기록(?:에|상|으로)?\s*(?:남아\s*)?(?:있|되어\s*있|돼\s*있)(?:나요|습니까|는지)|기록이\s*있(?:나요|습니까|는지)/.test(question);
}

export type ChatQuestionResult =
  | { kind: 'question'; question: string; hint: string; targetCode: string; reason: string }
  | { kind: 'none'; message: string };

export async function generateSectionChatQuestion(params: {
  caseData: any;
  state: StudyWriteState;
  sectionId: string;
}): Promise<ChatQuestionResult> {
  const { sectionId } = params;
  if (CHAT_QUESTION_SUMMARY_SECTIONS.has(sectionId)) {
    return {
      kind: 'none',
      message: `${CARE_SECTION_NAMES[sectionId]}은 본문 섹션을 요약하는 자리라 새 정보를 묻지 않습니다. 더 넣을 내용은 해당 본문 섹션(환자 정보, 치료 개입, 추적 관찰 등)에서 질문을 받아 주세요.`
    };
  }
  const section = params.state.sections?.[sectionId];
  const missing = missingCareElements(section);
  if (missing.length === 0) {
    return {
      kind: 'none',
      message: '이 섹션의 CARE 세부 항목은 기록과 답변으로 채워져 있어 여쭤볼 것이 없습니다. 더 넣고 싶은 내용이 있으면 아래에 직접 적어 주세요.'
    };
  }
  const userPrompt = buildStudyWriteChatQuestionUserPrompt({
    sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
    careItems: careItemsText(sectionId),
    missingCareText: missingCareText(section),
    sectionDraft: section?.draftText || '',
    priorQaSummary: await buildPriorQaSummary(params.state),
    askedInChat: askedInChat(section),
    recordText: buildRecordText(params.caseData)
  });
  const ask = (prompt: string) =>
    callLLMWithSchema(StudyWriteChatQuestionOutputSchema, studyWriteChatQuestionSystemPrompt, prompt, {
      model: getModelForChain('chain4'),
      label: `SW-Q4 ${sectionId}`
    });
  let output = await ask(userPrompt);
  // "기록에 있나요?"처럼 기록 여부를 묻는 질문이면 한 번 다시 묻는다 (규칙 4, 시험에서 남은 문제)
  if (asksAboutRecord(String(output.question || ''))) {
    output = await ask(
      `${userPrompt}

직전에 만든 질문 "${String(output.question).trim()}"은 기록에 있는지를 묻습니다. 같은 요소에 대해 임상의가 사실이나 경험으로 답할 수 있는 질문으로 바꾸세요.`
    );
    if (asksAboutRecord(String(output.question || ''))) {
      return { kind: 'none', message: '이 섹션에 맞는 질문을 고르지 못했습니다. 한 번 더 눌러 보세요.' };
    }
  }
  const question = String(output.question || '').trim();
  const reason = String(output.reason || '').trim();
  if (!question) {
    return { kind: 'none', message: `지금은 더 여쭤볼 것이 없습니다. ${reason || '빠진 CARE 요소는 이미 여쭤봤거나 기록에 있습니다.'}` };
  }
  const targets = validTargets(String(output.targetCode || ''), missing);
  if (targets.length === 0) {
    console.warn(`[SW-Q4 ${sectionId}] target "${output.targetCode}" not in missing list; question dropped`);
    return { kind: 'none', message: '이 섹션에 맞는 질문을 고르지 못했습니다. 한 번 더 눌러 보세요.' };
  }
  return { kind: 'question', question, hint: String(output.hint || '').trim(), targetCode: targets.join(', '), reason };
}
