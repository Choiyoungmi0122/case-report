import { callLLMWithSchema } from '../llm/client';
import { z } from 'zod';
import { getModelForChain } from '../llm/chains';
import {
  STUDY_WRITE_CARE_CHECK_PROMPT_VERSION,
  STUDY_WRITE_DRAFT_PROMPT_VERSION,
  STUDY_WRITE_REVISE_PROMPT_VERSION,
  buildStudyWriteCareCheckUserPrompt,
  buildStudyWriteDraftUserPrompt,
  buildStudyWriteReviseUserPrompt,
  studyWriteCareCheckSystemPrompt,
  studyWriteDraftSystemPrompt,
  studyWriteReviseSystemPrompt
} from '../llm/prompts/studyWrite_draft';
import {
  StudyWriteCareCheckOutputSchema,
  StudyWriteDraftOutputSchema,
  StudyWriteReviseOutputSchema
} from '../llm/schemas/studyWrite_draft';
import { StudyWriteCareCheck, StudyWriteSectionState, StudyWriteState } from '../types/studyWrite';
import { CARE_ITEMS_BY_SECTION, CARE_SECTION_NAMES, CARE_SECTION_ORDER, careItemsText, careWritingRule } from './careItems';
import { allQuestions, buildRecordText, isRecordTruncated } from './interview';
import { createOutboundDeidContext, deidentifyOutboundText } from '../deid/outbound';
import { promptMeta } from '../llm/promptRegistry';
import { acupointCodesForTexts, applyHanjaGlossary, formatHanjaGlossary, glossaryForTexts } from './hanja';
import { dropAbsenceSentences } from './absenceFilter';

/** 부재 문장 필터를 쓰지 않는 섹션: 서론·고찰(공백·한계 서술), 동의(답변 그대로) */
const ABSENCE_FILTER_SKIP = new Set(['INTRODUCTION', 'DISCUSSION_CONCLUSION', 'INFORMED_CONSENT']);
import { answerTextForPrompt } from './answerChoices';

/**
 * 실험용 Write ⑤~⑥: 답변을 반영한 섹션 초안(SW-D), 지시로 고쳐 쓰기(SW-R), CARE 점검(SW-C).
 */

const DRAFT_CONCURRENCY = 3;

// 한 번의 체인 호출 안에서는 같은 문맥을 써서 같은 식별자가 같은 표기를 받게 한다.
// 문맥은 호출마다 새로 만든다 (프로세스 전역 공유 시 케이스 간 번호가 섞이고 원문 식별자가 메모리에 남는다).
type OutboundContext = ReturnType<typeof createOutboundDeidContext>;
async function deidentifyText(text: string, context: OutboundContext): Promise<string> {
  if (!text.trim()) return '';
  return (
    await deidentifyOutboundText(text, { sharedContext: context, dateMode: 'KEEP', detectionProfile: 'anonymized_record' })
  ).text;
}

/** 질의응답을 체인 입력용 텍스트로. 답은 비식별 처리한다. */
export async function buildQaText(state: StudyWriteState, forSectionId?: string, context: OutboundContext = createOutboundDeidContext()): Promise<string> {
  const lines: string[] = [];
  for (const question of allQuestions(state)) {
    if (question.status === 'pending') continue;
    const relevant = !forSectionId || question.targetSectionIds.includes(forSectionId) || question.priority === 'case';
    if (!relevant) continue;
    // 글로 답하지 않은 질문은 선택지별 처리 지시를 그대로 넣는다 (자료 확인 필요 = 정보 부재 아님)
    const answer = question.status === 'answered' ? await deidentifyText(question.answer, context) : answerTextForPrompt(question) || '(아직 답하지 않음)';
    lines.push(`- id: ${question.id}\n  쓰이는 섹션: ${question.targetSectionIds.join(', ')}\n  Q: ${question.text}\n  A: ${answer}`);
  }
  return lines.join('\n');
}

/**
 * 모델이 입력에 없는 비식별 자리표시(예: [PATIENT_NAME_1])를 새로 써 넣는 일이 있다
 * (2차 측정에서 프롬프트 예시를 베껴 "[PATIENT_NAME_1]에게는"으로 씀). 입력 어디에도
 * 없는 자리표시는 사람 이름이면 "환자", 그 밖은 비운다.
 */
export function dropForeignPlaceholders(draftText: string, inputs: string[]): string {
  const known = new Set<string>();
  for (const input of inputs) for (const match of String(input || '').match(/\[[A-Z_]+_\d+\]/g) || []) known.add(match);
  return String(draftText || '').replace(/\[([A-Z_]+)_\d+\]/g, (token, type: string) => {
    if (known.has(token)) return token;
    return /NAME/.test(type) ? '환자' : '';
  });
}

function currentDraftOf(caseData: any, sectionId: string): string {
  const drafts: any[] = Array.isArray(caseData?.sectionDrafts) ? caseData.sectionDrafts : [];
  return drafts.find((draft) => draft.sectionId === sectionId)?.draftText || '';
}

/** "9a", "9a.", "CARE 9a", "9-a" → "9a". 숫자만 있으면 그 숫자. 없으면 빈 문자열. */
export function normalizeCareItemCode(code: string): string {
  const match = String(code || '').toLowerCase().replace(/[\s\-_.]/g, '').match(/(\d{1,2})([a-d])?/);
  return match ? `${match[1]}${match[2] || ''}` : '';
}

export function emptySectionState(sectionId: string): StudyWriteSectionState {
  return { sectionId, draftText: '', version: 0, history: [], chat: [], careCheck: null, attachmentIds: [] };
}

export async function runDraftForSection(params: {
  caseData: any;
  state: StudyWriteState;
  sectionId: string;
}): Promise<{ draftText: string; usedQuestionIds: string[]; notes: string[]; model: string }> {
  const { caseData, state, sectionId } = params;
  const model = getModelForChain('chain6');
  const context = createOutboundDeidContext();
  const recordText = buildRecordText(caseData);
  const currentDraft = currentDraftOf(caseData, sectionId);
  const qaText = await buildQaText(state, sectionId, context);
  // 처방명·변증명 한자는 용어 사전 것을 쓴다 (기록·답변에 나온 것만 목록으로)
  const glossary = glossaryForTexts([recordText, currentDraft, qaText]);
  const acupoints = formatHanjaGlossary(acupointCodesForTexts([recordText, currentDraft, qaText]));
  const output = await callLLMWithSchema(
    StudyWriteDraftOutputSchema,
    studyWriteDraftSystemPrompt,
    buildStudyWriteDraftUserPrompt({
      sectionId,
      sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
      careItems: careItemsText(sectionId),
      writingRule: careWritingRule(sectionId),
      recordText,
      currentDraft,
      qaText,
      hanjaGlossary: formatHanjaGlossary(glossary),
      acupointCodes: acupoints
    }),
    { model, label: `SW-D ${sectionId}` }
  );
  // 기록에 없는 항목의 부재 문장("~는 기록되지 않았다")은 증례보고에 쓰지 않으므로 걸러내고 notes 로 알린다.
  // 서론·고찰은 선행 연구의 공백이나 한계("객관 지표 자료가 없다")를 말하는 정당한 문장이 있어 거르지 않는다.
  const prepared = applyHanjaGlossary(dropForeignPlaceholders(output.draftText, [recordText, currentDraft, qaText]), glossary);
  const filtered = ABSENCE_FILTER_SKIP.has(sectionId) ? { text: prepared, removed: [] as string[] } : dropAbsenceSentences(prepared);
  return {
    draftText: filtered.text,
    usedQuestionIds: output.usedQuestionIds || [],
    notes: [
      ...(output.notes || []),
      ...filtered.removed.map((sentence) => `기록에 없다는 문장을 본문에서 뺐습니다: "${sentence}"`)
    ],
    model
  };
}

export async function runCareCheck(params: {
  caseData: any;
  state: StudyWriteState;
  sectionId: string;
  draftText: string;
}): Promise<StudyWriteCareCheck> {
  const { caseData, state, sectionId, draftText } = params;
  const defs = CARE_ITEMS_BY_SECTION[sectionId] || [];
  const output = await callLLMWithSchema(
    StudyWriteCareCheckOutputSchema,
    studyWriteCareCheckSystemPrompt,
    buildStudyWriteCareCheckUserPrompt({
      sectionId,
      sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
      careItems: careItemsText(sectionId),
      recordText: buildRecordText(caseData),
      currentDraft: draftText,
      qaText: await buildQaText(state, sectionId, createOutboundDeidContext())
    }),
    { model: getModelForChain('chain4'), label: `SW-C ${sectionId}` }
  );
  // 정의된 항목 순서대로 맞춘다. 코드 표기("9a.", "CARE 9a", "9-a")는 숫자+영문으로 정규화해 맞춘다.
  // 모델이 빠뜨린 항목은 'unchecked'(판정 없음)로 둔다. "없음"으로 두면 기록에 없는 것처럼 보인다
  // (docs/prompt_chain_review_v1.md §5-1 4번).
  const byCode = new Map<string, (typeof output.items)[number]>();
  for (const item of output.items) {
    const key = normalizeCareItemCode(item.code);
    if (key && !byCode.has(key)) byCode.set(key, item);
  }
  const missing = defs.filter((def) => !byCode.has(normalizeCareItemCode(def.code))).map((def) => def.code);
  if (missing.length > 0) console.warn(`[SW-C ${sectionId}] no verdict for ${missing.join(', ')}`);
  return {
    checkedAt: new Date().toISOString(),
    promptVersion: STUDY_WRITE_CARE_CHECK_PROMPT_VERSION,
    promptTemplateHash: promptMeta('SW_C').promptTemplateHash,
    items: defs.map((def) => {
      const found = byCode.get(normalizeCareItemCode(def.code));
      return {
        code: def.code,
        label: def.label,
        required: def.required,
        status: found?.status || 'unchecked',
        hint: found?.hint || (found ? '' : '점검 결과를 받지 못했습니다. "전체 점검하기"로 다시 점검하면 판정됩니다.')
      };
    })
  };
}

const NoChangeReasonSchema = z.object({ reason: z.string() });

/**
 * 수정 지시를 받았는데 본문이 그대로일 때, 왜 안 바뀌었는지만 따로 묻는다. 수정 체인이
 * "삭제했다"고 거짓 요약을 내놓는 일이 있어(해당 문장이 섹션에 없는데도), 초안을 다시 보고
 * 사실만 설명하게 한다. 빠른 모델로 짧게.
 */
async function explainNoChange(params: { sectionName: string; draftText: string; instruction: string }): Promise<string> {
  try {
    const output = await callLLMWithSchema(
      NoChangeReasonSchema,
      `임상의가 증례보고 섹션 초안에 수정 지시를 보냈지만 초안 본문은 바뀌지 않았습니다. 왜 바뀌지 않았는지 임상의에게 한두 문장으로 설명합니다.
초안을 실제로 보고 사실만 씁니다:
- 지시한 내용에 해당하는 문장이 이 섹션에 없으면 "이 섹션에는 …에 해당하는 문장이 없습니다"라고 쓰고, 그 내용이 CARE 의 어느 섹션(환자 정보, 임상 소견, 타임라인, 진단 평가, 치료 개입, 추적 관찰 및 결과, 고찰, 환자 관점 등)에 속하는지 덧붙입니다.
- 이미 반영되어 있으면 어느 문장에 있는지 짚습니다.
- 기록·답변에 근거가 없어 넣을 수 없는 요청이면 그렇게 씁니다.
- 바꿨다고 쓰지 않습니다. 지어내지 않습니다. 한국어로, JSON {"reason": "..."} 만 돌려줍니다.`,
      `[섹션] ${params.sectionName}

[현재 초안]
${params.draftText}

[임상의의 지시]
${params.instruction}`,
      { model: getModelForChain('chain4'), label: 'SW-R no-change reason' }
    );
    return String(output.reason || '').trim();
  } catch {
    return '';
  }
}

export async function runRevise(params: {
  caseData: any;
  state: StudyWriteState;
  section: StudyWriteSectionState;
  instruction: string;
  /** 초안에서 드래그한 부분. 있으면 그 부분만 고친다 */
  selectedText?: string;
  /** 직접 수정 뒤 전체 점검: 직접 수정 전(마지막 AI 판) 초안 */
  previousDraft?: string;
}): Promise<{ draftText: string; changeSummary: string; noChangeReason: string; outOfRecordClaims: string[]; model: string }> {
  const { caseData, state, section, instruction } = params;
  const context = createOutboundDeidContext();
  const selectedText = params.selectedText ? await deidentifyText(params.selectedText, context) : undefined;
  const model = getModelForChain('chain6');
  // 이전 지시도 참여자가 쓴 글이므로 이번 지시와 같은 기준으로 비식별 처리한다.
  const priorInstructionTexts: string[] = [];
  for (const entry of section.chat.filter((item) => item.role === 'user').slice(-5)) {
    priorInstructionTexts.push(`- ${await deidentifyText(entry.text, context)}`);
  }
  const priorInstructions = priorInstructionTexts.join('\n');
  const recordText = buildRecordText(caseData);
  const qaText = await buildQaText(state, section.sectionId, context);
  const safeInstruction = await deidentifyText(instruction, context);
  const glossary = glossaryForTexts([recordText, section.draftText, qaText, safeInstruction]);
  const acupoints = formatHanjaGlossary(acupointCodesForTexts([recordText, section.draftText, qaText, safeInstruction]));
  const output = await callLLMWithSchema(
    StudyWriteReviseOutputSchema,
    studyWriteReviseSystemPrompt,
    buildStudyWriteReviseUserPrompt({
      sectionId: section.sectionId,
      sectionName: CARE_SECTION_NAMES[section.sectionId] || section.sectionId,
      careItems: careItemsText(section.sectionId),
      writingRule: careWritingRule(section.sectionId),
      recordText,
      currentDraft: section.draftText,
      qaText,
      priorInstructions,
      instruction: safeInstruction,
      hanjaGlossary: formatHanjaGlossary(glossary),
      acupointCodes: acupoints,
      selectedText,
      previousDraft: params.previousDraft
    }),
    { model, label: `SW-R ${section.sectionId}` }
  );
  const finalDraft = applyHanjaGlossary(
    dropForeignPlaceholders(output.draftText, [recordText, section.draftText, qaText, safeInstruction]),
    glossary
  );
  let noChangeReason = String(output.noChangeReason || '').trim();
  if (finalDraft.trim() === section.draftText.trim() && !noChangeReason) {
    noChangeReason = await explainNoChange({
      sectionName: CARE_SECTION_NAMES[section.sectionId] || section.sectionId,
      draftText: section.draftText,
      instruction: safeInstruction
    });
  }
  return {
    draftText: finalDraft,
    changeSummary: output.changeSummary,
    noChangeReason,
    outOfRecordClaims: output.outOfRecordClaims || [],
    model
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await task(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 모든(또는 지정한) 섹션의 초안을 만든다. 섹션 하나가 끝날 때마다 onSection 으로 저장을
 * 맡기므로, 중간에 실패해도 끝난 섹션은 남는다.
 */
export async function generateDrafts(params: {
  caseData: any;
  state: StudyWriteState;
  sectionIds?: string[];
  source: 'answers' | 'answers_edited';
  onSection: (section: StudyWriteSectionState) => Promise<void>;
  onError: (sectionId: string, message: string) => Promise<void>;
}): Promise<void> {
  const targets = params.sectionIds && params.sectionIds.length > 0 ? params.sectionIds : [...CARE_SECTION_ORDER];
  await mapWithConcurrency(targets, DRAFT_CONCURRENCY, async (sectionId) => {
    try {
      const existing = params.state.sections?.[sectionId] || emptySectionState(sectionId);
      const draft = await runDraftForSection({ caseData: params.caseData, state: params.state, sectionId });
      const careCheck = await runCareCheck({ caseData: params.caseData, state: params.state, sectionId, draftText: draft.draftText });
      const now = new Date().toISOString();
      const next: StudyWriteSectionState = {
        ...existing,
        draftText: draft.draftText,
        version: existing.version + 1,
        history: [
          ...existing.history,
          {
            version: existing.version + 1,
            text: draft.draftText,
            source: params.source,
            at: now,
            model: draft.model,
            promptVersion: STUDY_WRITE_DRAFT_PROMPT_VERSION,
            promptTemplateHash: promptMeta('SW_D').promptTemplateHash,
            usedQuestionIds: draft.usedQuestionIds,
            notes: isRecordTruncated(params.caseData) ? [...draft.notes, '기록 전문이 길어 뒷부분이 모델에 전달되지 않았습니다.'] : draft.notes
          }
        ],
        careCheck,
        lastGeneratedAt: now
      };
      await params.onSection(next);
    } catch (error: any) {
      console.error(`[SW-D ${sectionId}] failed`, error);
      await params.onError(sectionId, error?.message || 'failed');
    }
  });
}

export { STUDY_WRITE_REVISE_PROMPT_VERSION };
