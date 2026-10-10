import { callLLMWithSchema } from '../llm/client';
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
import { allQuestions, buildRecordText } from './interview';
import { createOutboundDeidContext, deidentifyOutboundText } from '../deid/outbound';

/**
 * 실험용 Write ⑤~⑥: 답변을 반영한 섹션 초안(SW-D), 지시로 고쳐 쓰기(SW-R), CARE 점검(SW-C).
 */

const DRAFT_CONCURRENCY = 3;

// 한 번의 체인 호출 안에서는 같은 문맥을 써서 같은 식별자가 같은 표기를 받게 한다.
const outboundContext = createOutboundDeidContext();
async function deidentifyText(text: string): Promise<string> {
  if (!text.trim()) return '';
  return (
    await deidentifyOutboundText(text, { sharedContext: outboundContext, dateMode: 'KEEP', detectionProfile: 'anonymized_record' })
  ).text;
}

/** 질의응답을 체인 입력용 텍스트로. 답은 비식별 처리한다. */
export async function buildQaText(state: StudyWriteState, forSectionId?: string): Promise<string> {
  const lines: string[] = [];
  for (const question of allQuestions(state)) {
    if (question.status === 'pending') continue;
    const relevant = !forSectionId || question.targetSectionIds.includes(forSectionId) || question.priority === 'case';
    if (!relevant) continue;
    const answer = question.status === 'skipped' ? '(모름 / 기록에 없음 — 이 주제는 쓰지 않는다)' : await deidentifyText(question.answer);
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
  const recordText = buildRecordText(caseData);
  const currentDraft = currentDraftOf(caseData, sectionId);
  const qaText = await buildQaText(state, sectionId);
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
      qaText
    }),
    { model, label: `SW-D ${sectionId}` }
  );
  return {
    draftText: dropForeignPlaceholders(output.draftText, [recordText, currentDraft, qaText]),
    usedQuestionIds: output.usedQuestionIds || [],
    notes: output.notes || [],
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
      qaText: await buildQaText(state, sectionId)
    }),
    { model: getModelForChain('chain4'), label: `SW-C ${sectionId}` }
  );
  // 정의된 항목 순서대로 맞추고, 모델이 빠뜨린 항목은 not_in_record 로 둔다.
  const byCode = new Map(output.items.map((item) => [item.code.trim().toLowerCase(), item]));
  return {
    checkedAt: new Date().toISOString(),
    promptVersion: STUDY_WRITE_CARE_CHECK_PROMPT_VERSION,
    items: defs.map((def) => {
      const found = byCode.get(def.code.toLowerCase());
      return {
        code: def.code,
        label: def.label,
        required: def.required,
        status: found?.status || 'not_in_record',
        hint: found?.hint || ''
      };
    })
  };
}

export async function runRevise(params: {
  caseData: any;
  state: StudyWriteState;
  section: StudyWriteSectionState;
  instruction: string;
}): Promise<{ draftText: string; changeSummary: string; outOfRecordClaims: string[]; model: string }> {
  const { caseData, state, section, instruction } = params;
  const model = getModelForChain('chain6');
  const priorInstructions = section.chat
    .filter((entry) => entry.role === 'user')
    .slice(-5)
    .map((entry) => `- ${entry.text}`)
    .join('\n');
  const recordText = buildRecordText(caseData);
  const qaText = await buildQaText(state, section.sectionId);
  const safeInstruction = await deidentifyText(instruction);
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
      instruction: safeInstruction
    }),
    { model, label: `SW-R ${section.sectionId}` }
  );
  return {
    draftText: dropForeignPlaceholders(output.draftText, [recordText, section.draftText, qaText, safeInstruction]),
    changeSummary: output.changeSummary,
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
            usedQuestionIds: draft.usedQuestionIds,
            notes: draft.notes
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
