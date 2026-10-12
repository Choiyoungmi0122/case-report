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
import {
  CARE_CHECKLIST_VERSION,
  conditionByEvidence,
  detectModalities,
  hasModalityGroupsFor,
  skippedModalities,
  subElementsForSection,
  subElementsText
} from './careSubElements';
import { terminologyEntries } from '../rag/loader';

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
/**
 * 섹션과 상관없이 질의응답의 모든 답을 받는 섹션. 질문 생성기가 정한 "쓰이는 섹션"이 틀리는 일이 있어
 * (예: 1년 전 타 기관 진단 이력을 임상 소견·진단 평가용으로만 분류해 환자 정보·타임라인에서 빠짐, 임교수 테스트 6),
 * 여러 섹션에 걸치는 사실을 쓰는 섹션은 모든 답을 보고 그 섹션 규칙에 맞는 것만 쓴다(SW-D·SW-R 작업 규칙 1-1).
 * 2026-10-12 사용자 결정: 타임라인 먼저, 이어 환자 정보·임상 소견·진단 평가·초록.
 */
export const ALL_QA_SECTIONS = new Set(['TIMELINE', 'PATIENT_INFORMATION', 'CLINICAL_FINDINGS', 'DIAGNOSTIC_ASSESSMENT', 'ABSTRACT']);

export async function buildQaText(state: StudyWriteState, forSectionId?: string, context: OutboundContext = createOutboundDeidContext()): Promise<string> {
  const lines: string[] = [];
  for (const question of allQuestions(state)) {
    if (question.status === 'pending') continue;
    // 질문의 "쓰이는 섹션" 분류에 기대지 않고 모든 답을 받는 섹션 (ALL_QA_SECTIONS 설명)
    const relevant =
      !forSectionId || ALL_QA_SECTIONS.has(forSectionId) || question.targetSectionIds.includes(forSectionId) || question.priority === 'case';
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

/** 하위 요소 id 표기 정규화: " 9b-h4 ", "9b–H4", "9bH4" → "9B-H4" */
export function normalizeSubElementId(raw: string): string {
  const compact = String(raw || '').toUpperCase().replace(/[\s\u2010-\u2015]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const match = compact.match(/^(\d{1,2}[A-D]?)-?([A-Z]?\d{1,2})$/);
  return match ? `${match[1]}-${match[2]}` : compact;
}

/** 마지막 방문의 첫 기록일 기준 일수 (날짜가 없으면 null) */
function lastVisitDay(caseData: any): number | null {
  const visits: any[] = Array.isArray(caseData?.visits) ? caseData.visits : [];
  const first = visits[0]?.date ? new Date(visits[0].date).getTime() : NaN;
  const last = visits[visits.length - 1]?.date ? new Date(visits[visits.length - 1].date).getTime() : NaN;
  return Number.isNaN(first) || Number.isNaN(last) ? null : Math.round((last - first) / 86400000);
}

let herbalNameCache: string[] | null = null;
/** 용어 사전의 처방명. "○○산", "○○음"처럼 낱말 꼴로 가려낼 수 없는 처방을 찾는 데 쓴다 */
function herbalPrescriptionNames(): string[] {
  if (!herbalNameCache) {
    herbalNameCache = terminologyEntries
      .filter((entry) => entry.category === 'herbal_prescription')
      .map((entry) => String(entry.standardTerm || '').trim())
      .filter((name) => name.length >= 2);
  }
  return herbalNameCache;
}

/**
 * CARE 점검(SW-C)을 같은 입력으로 몇 번 돌려 합칠지. gpt-4.1-mini 가 같은 초안에서 판정을 바꾸는 일이 있어
 * (임교수 테스트 6 타임라인: 세 번 중 두 번 과거력 행·진단 검사 칸을 "없음"으로 봄) 두 번 돌리고,
 * 두 번 다 "없음"일 때만 "없음"으로 둔다 (사용자 결정 2026-10-12). 비용은 두 배, 시간은 동시에 돌려 그대로.
 */
export const CARE_CHECK_RUNS = 2;

/**
 * 타임라인 표 구조로 코드가 확실히 "있음"이라 할 수 있는 하위 요소. 두 번 점검해도 모델이 같은 표의 과거력 행·진단 검사 칸을
 * 꾸준히 "없음"으로 읽는 일이 있어(임교수 테스트 6, 2026-10-12) 구조로 확인되면 "있음"으로 올린다. 확인되지 않으면 모델 판정을 둔다.
 *  7-1 모든 행에 날짜 칸 / 7-2 첫 행이 과거력·발병 / 7-3 진단 검사 칸이 하나라도 채워짐 / 7-4 치료 개입 칸이 채워짐 / 7-5 마지막 행이 마지막 방문
 */
export function timelineStructurePresent(draftText: string, lastVisitDay: number | null): Set<string> {
  const rows = String(draftText || '')
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4);
  const out = new Set<string>();
  if (rows.length === 0) return out;
  const filled = (cell: string | undefined) => Boolean(cell && cell !== '-' && cell !== '–');
  if (rows.every((cells) => filled(cells[0]))) out.add('7-1');
  if (/과거력|발병|이전\s*치료|병력/.test(rows[0][0])) out.add('7-2');
  if (rows.some((cells) => filled(cells[2]))) out.add('7-3');
  if (rows.filter((cells) => filled(cells[3])).length >= Math.max(1, rows.length - 1)) out.add('7-4');
  if (lastVisitDay !== null) {
    const lastDays = (rows[rows.length - 1][0].match(/\+(\d+)/g) || []).map((value) => Number(value.slice(1)));
    if (lastDays.includes(lastVisitDay)) out.add('7-5');
  }
  return out;
}

type CareCheckOutput = z.infer<typeof StudyWriteCareCheckOutputSchema>;
type CareVerdict = { status: CareCheckOutput['items'][number]['status']; hint: string };

/** 합칠 때 고르는 순서: 있음 > 해당 없음 > 초안에 빠짐 > 없음. 하나라도 있음이면 있음 */
const CARE_STATUS_RANK: Record<string, number> = { present: 0, not_applicable: 1, in_record_not_in_draft: 2, not_in_record: 3 };

function pickVerdict<T extends CareVerdict>(candidates: T[]): T {
  return [...candidates].sort((a, b) => (CARE_STATUS_RANK[a.status] ?? 9) - (CARE_STATUS_RANK[b.status] ?? 9))[0];
}

/** 여러 번의 점검 결과를 항목·하위 요소마다 합친다. 판정이 갈린 곳을 함께 돌려준다 */
export function mergeCareCheckOutputs(outputs: CareCheckOutput[]): CareCheckOutput & {
  disagreedItemCodes: Set<string>;
  disagreedSubIds: Set<string>;
} {
  const itemGroups = new Map<string, CareCheckOutput['items']>();
  const subGroups = new Map<string, CareCheckOutput['subItems']>();
  for (const output of outputs) {
    const seenItems = new Set<string>();
    for (const item of output.items) {
      const key = normalizeCareItemCode(item.code);
      if (!key || seenItems.has(key)) continue;
      seenItems.add(key);
      itemGroups.set(key, [...(itemGroups.get(key) || []), item]);
    }
    const seenSubs = new Set<string>();
    for (const sub of output.subItems || []) {
      const key = normalizeSubElementId(sub.id);
      if (!key || seenSubs.has(key)) continue;
      seenSubs.add(key);
      subGroups.set(key, [...(subGroups.get(key) || []), sub]);
    }
  }
  const disagreedItemCodes = new Set<string>();
  const disagreedSubIds = new Set<string>();
  const items = [...itemGroups.entries()].map(([key, group]) => {
    if (new Set(group.map((item) => item.status)).size > 1) disagreedItemCodes.add(key);
    return pickVerdict(group);
  });
  const subItems = [...subGroups.entries()].map(([key, group]) => {
    if (new Set(group.map((sub) => sub.status)).size > 1) disagreedSubIds.add(key);
    return pickVerdict(group);
  });
  return { items, subItems, disagreedItemCodes, disagreedSubIds };
}

export async function runCareCheck(params: {
  caseData: any;
  state: StudyWriteState;
  sectionId: string;
  draftText: string;
}): Promise<StudyWriteCareCheck> {
  const { caseData, state, sectionId, draftText } = params;
  const defs = CARE_ITEMS_BY_SECTION[sectionId] || [];
  const recordText = buildRecordText(caseData);
  const qaText = await buildQaText(state, sectionId, createOutboundDeidContext());
  // 하위 요소(체크리스트 v2): 9b 개입 묶음은 기록·답변·초안에 나온 것만 점검한다
  const itemCodes = defs.map((def) => def.code);
  // 개입 묶음은 9b 가 있는 섹션(치료 개입)에만 있다
  const hasModalityGroups = itemCodes.some((code) => hasModalityGroupsFor(code));
  const modalities = hasModalityGroups ? detectModalities([recordText, qaText, draftText].join('\n'), herbalPrescriptionNames()) : [];
  const subDefs = subElementsForSection(sectionId, itemCodes, modalities);
  const conditionText = [recordText, qaText, draftText].join('\n');
  // 낱말로 조건을 가린 요소: 맞지 않으면 묻지 않고 해당 없음, 맞으면 프롬프트에 충족으로 적는다
  const evidenceById = new Map(subDefs.map((sub) => [sub.id, conditionByEvidence(sub, conditionText)] as const));
  const promptSubDefs = subDefs.filter((sub) => evidenceById.get(sub.id) !== false);
  const conditionMetIds = new Set(subDefs.filter((sub) => evidenceById.get(sub.id) === true).map((sub) => sub.id));
  const userPrompt = buildStudyWriteCareCheckUserPrompt({
    sectionId,
    sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
    careItems: careItemsText(sectionId),
    recordText,
    currentDraft: draftText,
    qaText,
    subElements: subElementsText(promptSubDefs, conditionMetIds)
  });
  // 같은 입력으로 두 번 점검해 합친다: 둘 다 "없음"일 때만 "없음" (CARE_CHECK_RUNS 설명)
  const runs = await Promise.allSettled(
    Array.from({ length: CARE_CHECK_RUNS }, () =>
      callLLMWithSchema(StudyWriteCareCheckOutputSchema, studyWriteCareCheckSystemPrompt, userPrompt, {
        model: getModelForChain('chain4'),
        label: `SW-C ${sectionId}`
      })
    )
  );
  const outputs = runs.flatMap((run) => (run.status === 'fulfilled' ? [run.value] : []));
  if (outputs.length === 0) throw (runs[0] as PromiseRejectedResult).reason;
  if (outputs.length < runs.length) console.warn(`[SW-C ${sectionId}] ${runs.length - outputs.length} of ${runs.length} runs failed; using the rest`);
  const output = mergeCareCheckOutputs(outputs);
  // 타임라인: 표 구조로 확인되는 요소는 "있음"으로 올린다
  const structurePresent =
    sectionId === 'TIMELINE' ? timelineStructurePresent(draftText, lastVisitDay(caseData)) : new Set<string>();
  const subById = new Map<string, (typeof output.subItems)[number]>();
  for (const sub of output.subItems || []) {
    const key = normalizeSubElementId(sub.id);
    if (key && !subById.has(key)) subById.set(key, sub);
  }
  const subMissing = promptSubDefs.filter((sub) => !subById.has(normalizeSubElementId(sub.id))).map((sub) => sub.id);
  if (subMissing.length > 0) console.warn(`[SW-C ${sectionId}] no sub-element verdict for ${subMissing.join(', ')}`);
  const subItemsFor = (code: string) =>
    subDefs
      .filter((sub) => sub.itemCode === code)
      .map((sub) => {
        const found = subById.get(normalizeSubElementId(sub.id));
        // 조건: 낱말로 가릴 수 있는 것은 코드가, 나머지는 모델(conditionMet)이 정한다.
        // 맞지 않으면 해당 없음 (모델이 status 를 not_in_record 로 둔 경우도)
        const byEvidence = evidenceById.get(sub.id) ?? null;
        const conditionMet = byEvidence !== null ? byEvidence : typeof found?.conditionMet === 'boolean' ? found.conditionMet : undefined;
        const conditionFalse = Boolean(sub.condition && conditionMet === false && (found || byEvidence === false));
        // 코드가 조건 충족이라 했는데 모델이 해당 없음으로 둔 것은 판정을 다시 받아야 한다
        const conditionConflict = byEvidence === true && found?.status === 'not_applicable';
        return {
          id: sub.id,
          label: sub.label,
          required: sub.required,
          ...(output.disagreedSubIds.has(normalizeSubElementId(sub.id)) ? { disagreed: true } : {}),
          group: sub.group,
          groupLabel: sub.groupLabel,
          criterion: sub.criterion,
          source: sub.source,
          ...(sub.condition ? { condition: sub.condition } : {}),
          status: structurePresent.has(sub.id) && !conditionFalse
            ? ('present' as const)
            : conditionFalse
              ? ('not_applicable' as const)
              : conditionConflict
                ? ('unchecked' as const)
                : found?.status || ('unchecked' as const),
          hint:
            structurePresent.has(sub.id) && !conditionFalse
              ? ''
              : conditionFalse
                ? ''
                : conditionConflict
                  ? '기록에 해당 내용이 있어 다시 점검이 필요합니다.'
                  : found?.hint || '',
          ...(sub.condition && typeof conditionMet === 'boolean' ? { conditionMet } : {})
        };
      });
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
    checklistVersion: subDefs.length > 0 ? CARE_CHECKLIST_VERSION : 'care-checklist:v1',
    checkRuns: outputs.length,
    ...(hasModalityGroups
      ? { modalities: { checked: modalities, skipped: [...new Set(skippedModalities(sectionId, itemCodes, modalities))] } }
      : {}),
    items: defs.map((def) => {
      const found = byCode.get(normalizeCareItemCode(def.code));
      const subItems = subItemsFor(def.code);
      return {
        code: def.code,
        label: def.label,
        required: def.required,
        status: found?.status || 'unchecked',
        hint: found?.hint || (found ? '' : '점검 결과를 받지 못했습니다. "전체 점검하기"로 다시 점검하면 판정됩니다.'),
        ...(output.disagreedItemCodes.has(normalizeCareItemCode(def.code)) ? { disagreed: true } : {}),
        ...(subItems.length > 0 ? { subItems } : {})
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
