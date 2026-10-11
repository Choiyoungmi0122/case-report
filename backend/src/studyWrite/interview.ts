import { randomUUID } from 'crypto';
import { CARE_ITEMS_BY_SECTION } from './careItems';
import { promptMeta } from '../llm/promptRegistry';
import { createOutboundDeidContext, deidentifyOutboundText } from '../deid/outbound';
import { answerTextForPrompt } from './answerChoices';
import { callLLMWithSchema } from '../llm/client';
import { getModelForChain } from '../llm/chains';
import {
  STUDY_WRITE_QUESTIONS_PROMPT_VERSION,
  buildStudyWriteGapQuestionsUserPrompt,
  studyWriteGapQuestionsSystemPrompt
} from '../llm/prompts/studyWrite_questions';
import { StudyWriteGapQuestionsOutputSchema } from '../llm/schemas/studyWrite_questions';
import { coerceCareSection } from '../llm/schemas/common';
import {
  StudyWriteQuestion,
  StudyWriteQuestionBudget,
  StudyWriteRound,
  StudyWriteState
} from '../types/studyWrite';

/**
 * 실험용 Write의 질의응답(인터뷰) 단계.
 *
 * 1회차는 분석 없이 물을 수 있는 사례 전체 질문 3개(고정). 2·3회차는 분석 결과를
 * 바탕으로 체인(SW-Q2)이 고른 기록 빈칸 질문이다. 상한과 그 근거는
 * docs/question_budget_basis_v1.md 에 있다.
 */

export const DEFAULT_QUESTION_BUDGET: StudyWriteQuestionBudget = {
  maxRounds: 3,
  perRound: 3,
  maxTotal: 9
};

/** 1회차 고정 질문. 모든 참여자가 같은 질문을 받는다. */
export const FIXED_CASE_QUESTIONS: Array<Pick<StudyWriteQuestion, 'text' | 'targetSectionIds' | 'careItem'>> = [
  {
    text: '이 환자를 증례보고로 쓰려는 이유는 무엇인가요? 이 증례에서 가장 보여 주고 싶은 점을 한두 문장으로 적어 주세요.',
    targetSectionIds: ['INTRODUCTION', 'DISCUSSION_CONCLUSION', 'TITLE', 'ABSTRACT'],
    careItem: '4, 11d'
  },
  {
    text: '독자(같은 분야 임상의)가 이 증례를 읽고 가져갔으면 하는 핵심 메시지는 무엇인가요?',
    targetSectionIds: ['DISCUSSION_CONCLUSION', 'ABSTRACT'],
    careItem: '11d'
  },
  {
    text: '환자(또는 보호자)에게 증례 발표에 대한 서면 동의를 받으셨나요? 받지 않았다면 받을 수 있는 상황인가요?',
    targetSectionIds: ['INFORMED_CONSENT'],
    careItem: '13'
  }
];

export function createInitialStudyWriteState(input?: StudyWriteState['inputSource']): StudyWriteState {
  return {
    version: 'study-write-v1',
    inputSource: input || null,
    questionBudget: { ...DEFAULT_QUESTION_BUDGET },
    rounds: [],
    updatedAt: new Date().toISOString()
  };
}

export function normalizeStudyWriteState(raw: any): StudyWriteState {
  if (!raw || typeof raw !== 'object') return createInitialStudyWriteState();
  return {
    ...createInitialStudyWriteState(raw.inputSource),
    ...raw,
    questionBudget: { ...DEFAULT_QUESTION_BUDGET, ...(raw.questionBudget || {}) },
    rounds: Array.isArray(raw.rounds) ? raw.rounds : []
  };
}

export function allQuestions(state: StudyWriteState): StudyWriteQuestion[] {
  return state.rounds.flatMap((round) => round.questions);
}

export function currentRound(state: StudyWriteState): StudyWriteRound | undefined {
  return state.rounds[state.rounds.length - 1];
}

export function isRoundComplete(round: StudyWriteRound | undefined): boolean {
  return Boolean(round && round.questions.every((question) => question.status !== 'pending'));
}

/** 분석이 끝나 섹션 초안과 빠진 정보가 있으면 2회차를 만들 수 있다. */
export function isAnalysisReady(caseData: any): boolean {
  const drafts = Array.isArray(caseData?.sectionDrafts) ? caseData.sectionDrafts : [];
  const progress = caseData?.chainProgress;
  const remaining = Array.isArray(progress?.estimatedRemainingSteps) ? progress.estimatedRemainingSteps : [];
  return drafts.length > 0 && (!progress || (!progress.currentStep && remaining.length === 0));
}

export function startInterview(state: StudyWriteState): StudyWriteState {
  if (state.rounds.length > 0) return state;
  const now = new Date().toISOString();
  const round: StudyWriteRound = {
    roundNo: 1,
    kind: 'case',
    startedAt: now,
    questions: FIXED_CASE_QUESTIONS.slice(0, state.questionBudget.perRound).map((question, index) => ({
      id: `swq-${randomUUID()}`,
      roundNo: 1,
      order: index + 1,
      text: question.text,
      source: 'fixed',
      targetSectionIds: question.targetSectionIds,
      careItem: question.careItem,
      priority: 'case',
      status: 'pending',
      answer: '',
      askedAt: now,
      editHistory: []
    }))
  };
  return { ...state, rounds: [round], interviewStartedAt: now, updatedAt: now };
}

const SKIP_REASONS: ReadonlyArray<StudyWriteQuestion['skipReason']> = ['not_in_record', 'cannot_confirm', 'needs_follow_up'];

export function answerQuestion(
  state: StudyWriteState,
  questionId: string,
  params: { answer?: string; skipped?: boolean; skipReason?: string; deferred?: boolean }
): StudyWriteState {
  if (state.answersLockedAt) {
    throw new Error('최종 수정 단계에 들어가 답을 더 바꿀 수 없습니다.');
  }
  const now = new Date().toISOString();
  let found = false;
  const rounds = state.rounds.map((round) => {
    const questions = round.questions.map((question) => {
      if (question.id !== questionId) return question;
      found = true;
      // deferred(자료 확인 필요) > skipped(이유 있음) > answered(글)
      const nextStatus: StudyWriteQuestion['status'] = params.deferred ? 'deferred' : params.skipped ? 'skipped' : 'answered';
      const nextAnswer = nextStatus === 'answered' ? String(params.answer || '').trim() : '';
      if (nextStatus === 'answered' && !nextAnswer) {
        throw new Error('답을 적거나 선택지(기록 없음 · 확인할 수 없음 · 추후 확인 필요 · 자료 확인 필요) 중 하나를 골라 주세요.');
      }
      const skipReason =
        nextStatus === 'skipped'
          ? (SKIP_REASONS.includes(params.skipReason as any) ? (params.skipReason as StudyWriteQuestion['skipReason']) : 'not_in_record')
          : undefined;
      const editHistory =
        question.status === 'pending'
          ? question.editHistory
          : [...question.editHistory, { previousAnswer: question.answer, previousStatus: question.status, editedAt: now }];
      const next: StudyWriteQuestion = { ...question, status: nextStatus, answer: nextAnswer, answeredAt: now, editHistory };
      if (skipReason) next.skipReason = skipReason;
      else delete next.skipReason;
      return next;
    });
    const completed = questions.every((question) => question.status !== 'pending');
    return { ...round, questions, completedAt: completed ? round.completedAt || now : undefined };
  });
  if (!found) throw new Error('질문을 찾지 못했습니다.');
  return { ...state, rounds, updatedAt: now };
}

export function remainingQuestionCount(state: StudyWriteState): number {
  // CARE 점검에서 사용자가 직접 넣은 정보는 질문 상한에 넣지 않는다
  const asked = allQuestions(state).filter((question) => question.source !== 'care_check').length;
  return Math.max(0, state.questionBudget.maxTotal - asked);
}

/**
 * CARE 점검에서 "기록에 없음"으로 뜬 항목에 사용자가 정보를 직접 넣는다. 질의응답의 답과 같은 자리에
 * 저장돼 초안·점검 체인에 그대로 쓰인다 (사용자 결정 2026-10-12). 질문 상한(9개)과는 별개다.
 * 같은 섹션·항목에 다시 넣으면 답을 바꾸고 이력을 남긴다.
 */
export function addCareInfoAnswer(
  state: StudyWriteState,
  params: { sectionId: string; code: string; label: string; required: boolean; answer: string }
): StudyWriteState {
  if (state.answersLockedAt) {
    throw new Error('최종 수정 단계에 들어가 정보를 더 넣을 수 없습니다.');
  }
  const answer = String(params.answer || '').trim();
  if (!answer) throw new Error('내용을 적어 주세요.');
  const now = new Date().toISOString();
  const rounds = state.rounds.map((round) => ({ ...round, questions: [...round.questions] }));
  let round = rounds.find((item) => item.kind === 'care_check');
  if (!round) {
    round = { roundNo: rounds.length + 1, kind: 'care_check', startedAt: now, questions: [] };
    rounds.push(round);
  }
  const existing = round.questions.find((question) => question.careItem === params.code && question.targetSectionIds.includes(params.sectionId));
  if (existing) {
    existing.editHistory = [...existing.editHistory, { previousAnswer: existing.answer, previousStatus: existing.status, editedAt: now }];
    existing.status = 'answered';
    existing.answer = answer;
    existing.answeredAt = now;
    delete existing.skipReason;
  } else {
    round.questions.push({
      id: `swq-${randomUUID()}`,
      roundNo: round.roundNo,
      order: allQuestions(state).length + 1,
      text: `[CARE 점검 추가 입력] ${params.code} ${params.label}`,
      source: 'care_check',
      targetSectionIds: [params.sectionId],
      careItem: params.code,
      priority: params.required ? 'required' : 'optional',
      status: 'answered',
      answer,
      askedAt: now,
      answeredAt: now,
      editHistory: []
    });
  }
  round.completedAt = now;
  return { ...state, rounds, updatedAt: now };
}

export function canOpenNextRound(state: StudyWriteState): { ok: boolean; reason?: string } {
  if (state.interviewCompletedAt) return { ok: false, reason: '질의응답이 이미 끝났습니다.' };
  const round = currentRound(state);
  if (!round) return { ok: false, reason: '1회차가 아직 시작되지 않았습니다.' };
  if (!isRoundComplete(round)) return { ok: false, reason: '이번 회차 질문에 먼저 답해 주세요.' };
  if (state.rounds.length >= state.questionBudget.maxRounds) return { ok: false, reason: '회차 상한에 닿았습니다.' };
  if (remainingQuestionCount(state) <= 0) return { ok: false, reason: '질문 수 상한에 닿았습니다.' };
  return { ok: true };
}

export function finishInterview(state: StudyWriteState): StudyWriteState {
  const now = new Date().toISOString();
  return { ...state, interviewCompletedAt: state.interviewCompletedAt || now, updatedAt: now };
}

// ---------------------------------------------------------------------------
// SW-Q2: 기록 빈칸 질문 생성

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 관찰 및 결과',
  DISCUSSION_CONCLUSION: '고찰',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '동의'
};

export function sectionName(sectionId: string): string {
  return SECTION_NAMES[sectionId] || sectionId;
}

// 체인이 "8", "9b", "진단 평가" 처럼 돌려준 값을 CARE 섹션 id로 바꾼다.
const CARE_NUMBER_TO_SECTION: Record<string, string> = {
  '1': 'TITLE',
  '2': 'TITLE',
  '3': 'ABSTRACT',
  '4': 'INTRODUCTION',
  '5': 'PATIENT_INFORMATION',
  '6': 'CLINICAL_FINDINGS',
  '7': 'TIMELINE',
  '8': 'DIAGNOSTIC_ASSESSMENT',
  '9': 'THERAPEUTIC_INTERVENTIONS',
  '10': 'FOLLOW_UP_OUTCOMES',
  '11': 'DISCUSSION_CONCLUSION',
  '12': 'PATIENT_PERSPECTIVE',
  '13': 'INFORMED_CONSENT'
};

export function normalizeTargetSectionIds(raw: Array<string | number>): string[] {
  const result: string[] = [];
  for (const value of raw) {
    const text = String(value).trim();
    const direct = coerceCareSection(text);
    const numberMatch = text.match(/^(\d{1,2})/);
    const byNumber = numberMatch ? CARE_NUMBER_TO_SECTION[numberMatch[1]] : undefined;
    const byName = Object.entries(SECTION_NAMES).find(([, name]) => name === text)?.[0];
    const sectionId = direct || byNumber || byName;
    if (sectionId && !result.includes(sectionId)) result.push(sectionId);
  }
  return result;
}

function clip(text: string, max: number): string {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)} …` : value;
}

/**
 * 참여자의 답은 외부로 나가기 전에 비식별 처리한다 (기록과 같은 기준).
 * 비식별 문맥은 호출(케이스)마다 새로 만든다. 프로세스 전역으로 공유하면 다른 케이스의 식별자 번호가
 * 섞이고 원문 식별자가 메모리에 남는다 (docs/prompt_chain_review_v1.md §2-6).
 */
type OutboundContext = ReturnType<typeof createOutboundDeidContext>;
async function deidentifyAnswer(answer: string, context: OutboundContext): Promise<string> {
  if (!answer.trim()) return '';
  // 날짜는 가리지 않는다 (실험용 Write 정책). 이름·연락처 등은 가린다.
  return (
    await deidentifyOutboundText(answer, { sharedContext: context, dateMode: 'KEEP', detectionProfile: 'anonymized_record' })
  ).text;
}

export async function buildPriorQaSummary(state: StudyWriteState): Promise<string> {
  const context = createOutboundDeidContext();
  const lines: string[] = [];
  for (const question of allQuestions(state)) {
    const answer = question.status === 'answered' ? await deidentifyAnswer(question.answer, context) : answerTextForPrompt(question) || '(아직 답하지 않음)';
    lines.push(`Q${question.order} [${question.roundNo}회차, ${question.careItem || '-'}] ${question.text}\nA: ${answer}`);
  }
  return lines.join('\n\n');
}

// CARE 세부 항목의 필수·선택은 연구실 구분표를 따른다. 모델이 돌려준 priority 는 쓰지 않는다.
const OPTIONAL_CARE_ITEMS = new Set(['8b', '8d', '9c', '10b', '10c', '11a', '11b', '12']);

export function priorityForCareItem(careItem: string): 'required' | 'optional' {
  const codes = String(careItem || '')
    .toLowerCase()
    .match(/\d{1,2}[a-d]?/g) || [];
  if (codes.length === 0) return 'required';
  return codes.every((code) => OPTIONAL_CARE_ITEMS.has(code)) ? 'optional' : 'required';
}

const MAX_RECORD_CHARS = 16000;

/** 기록 전문이 상한을 넘어 뒷부분이 잘려 전송되는지. 회차·초안 이력에 남긴다. */
export function isRecordTruncated(caseData: any): boolean {
  return buildRecordTextFull(caseData).length > MAX_RECORD_CHARS;
}

/** 비식별된 방문 기록 전문. 체인이 "기록에 이미 있는 것"을 묻지 않도록 함께 보낸다. */
export function buildRecordText(caseData: any): string {
  const text = buildRecordTextFull(caseData);
  if (text.length <= MAX_RECORD_CHARS) return text;
  console.warn(`[studyWrite] record text truncated: ${text.length} > ${MAX_RECORD_CHARS} chars (case ${caseData?.id || '?'})`);
  return `${text.slice(0, MAX_RECORD_CHARS)}\n…(기록이 길어 뒤의 ${text.length - MAX_RECORD_CHARS}자는 전달되지 않았습니다. 이 뒤의 내용은 기록에 없는 것으로 다루지 말고, 필요하면 임상의에게 확인을 요청하세요)`;
}

function buildRecordTextFull(caseData: any): string {
  const records: any[] = Array.isArray(caseData?.deidentifiedEMRs) ? caseData.deidentifiedEMRs : [];
  const visits: any[] = Array.isArray(caseData?.visits) ? caseData.visits : [];
  // 전문가 기록 프리셋은 날짜가 첫 기록일 기준 일수뿐이다. 입력 칸의 날짜는 임의
  // 기준일이므로 모델에는 보여 주지 않고 "첫 기록일 +N일"로 쓴다.
  const relativeDates = Boolean(caseData?.studyWrite?.inputSource?.relativeDates);
  const firstVisitMs = relativeDates && visits[0]?.date ? new Date(visits[0].date).getTime() : NaN;
  const text = records
    .map((record, index) => {
      // 방문 날짜와 구분(초진/재진)을 머리글에 넣는다. 날짜가 없으면 모델이 연도를
      // 추정해 타임라인이 틀어진다.
      const visit = visits[index] || {};
      const absolute = record?.visitDate || record?.visitDateTime || visit?.date || '';
      let date = absolute ? String(absolute).slice(0, 16).replace('T', ' ') : '';
      if (relativeDates && visit?.date && !Number.isNaN(firstVisitMs)) {
        const days = Math.round((new Date(visit.date).getTime() - firstVisitMs) / 86400000);
        date = days === 0 ? '첫 기록일' : `첫 기록일 +${days}일`;
      }
      const type = visit?.type ? ` ${visit.type}` : '';
      return `[방문 ${record?.visitIndex || index + 1}${type}${date ? ` ${date}` : ''}]\n${String(record?.deidentifiedText || '').trim()}`;
    })
    .join('\n\n');
  return text;
}

/** careItem 코드("9b", "8a·8c")로 CARE 섹션을 찾는다. 모델이 섹션 id 를 이상하게 돌려줬을 때의 대체 경로. */
export function sectionsForCareItem(careItem: string): string[] {
  const codes = String(careItem || '').toLowerCase().match(/\d{1,2}[a-d]?/g) || [];
  const result: string[] = [];
  for (const code of codes) {
    for (const [sectionId, defs] of Object.entries(CARE_ITEMS_BY_SECTION)) {
      if (defs.some((def) => def.code.toLowerCase() === code) && !result.includes(sectionId)) result.push(sectionId);
    }
  }
  return result;
}

export function buildAnalysisSummaries(caseData: any) {
  const sectionDrafts: any[] = Array.isArray(caseData?.sectionDrafts) ? caseData.sectionDrafts : [];
  const sectionStates: any[] = Array.isArray(caseData?.sectionStates) ? caseData.sectionStates : [];
  const commonMissing: any[] = Array.isArray(caseData?.commonMissingItems) ? caseData.commonMissingItems : [];
  const commonQuestions: any[] = Array.isArray(caseData?.commonQuestionSets) ? caseData.commonQuestionSets : [];

  const draftSummary = sectionDrafts
    .map((draft) => `[${draft.sectionId} ${sectionName(draft.sectionId)}]\n${clip(draft.draftText || '(비어 있음)', 700)}`)
    .join('\n\n');

  const sectionMissingSummary = sectionStates
    .filter((state) => Array.isArray(state.missingInfoBullets) && state.missingInfoBullets.length > 0)
    .map(
      (state) =>
        `[${state.sectionId} ${sectionName(state.sectionId)}]\n${state.missingInfoBullets.map((item: string) => `- ${item}`).join('\n')}`
    )
    .join('\n\n');

  const commonMissingSummary = commonMissing
    .map((item) => `- ${item.item} (관련: ${(item.relatedSectionIds || []).map(sectionName).join(', ')})`)
    .join('\n');

  const candidateQuestionsSummary = [
    ...commonQuestions.map(
      (item) => `- ${item.question} (쓰이는 섹션: ${(item.targetSectionIds || []).map(sectionName).join(', ')})`
    ),
    ...sectionStates.flatMap((state) =>
      (state.recommendedQuestions || []).map((question: string) => `- ${question} (섹션: ${sectionName(state.sectionId)})`)
    )
  ].join('\n');

  return {
    draftSummary,
    sectionMissingSummary,
    commonMissingSummary,
    candidateQuestionsSummary,
    candidateCount: commonQuestions.length + sectionStates.reduce((sum, s) => sum + (s.recommendedQuestions || []).length, 0)
  };
}

/**
 * 다음 회차(2 또는 3)를 만든다. 체인이 질문을 하나도 만들지 않으면 회차를 추가하지 않고
 * 질의응답을 끝낸다.
 */
export async function generateNextRound(
  state: StudyWriteState,
  caseData: any
): Promise<{ state: StudyWriteState; round: StudyWriteRound | null; stopReason?: string }> {
  const gate = canOpenNextRound(state);
  if (!gate.ok) throw new Error(gate.reason);
  if (!isAnalysisReady(caseData)) throw new Error('기록 분석이 아직 끝나지 않았습니다.');

  const roundNo = state.rounds.length + 1;
  const remaining = remainingQuestionCount(state);
  const summaries = buildAnalysisSummaries(caseData);
  const priorQaSummary = await buildPriorQaSummary(state);
  const model = getModelForChain('chain5');

  let output;
  try {
    output = await callLLMWithSchema(
      StudyWriteGapQuestionsOutputSchema,
      studyWriteGapQuestionsSystemPrompt,
      buildStudyWriteGapQuestionsUserPrompt({
        roundNo,
        remainingQuestions: remaining,
        recordText: buildRecordText(caseData),
        ...summaries,
        priorQaSummary
      }),
      { model, label: `SW-Q2 round ${roundNo}` }
    );
  } catch (error: any) {
    console.error(`[SW-Q2 round ${roundNo}] failed`, error);
    throw new Error('다음 질문을 만들지 못했습니다. 잠시 뒤 "다시 시도"를 눌러 주세요.');
  }

  const asked = new Set(allQuestions(state).map((question) => question.text.trim()));
  // 같은 세부 항목은 한 회차에 하나만 묻는다 (모델이 8c 를 두 번 묻는 일이 있었다).
  const seenCareItems = new Set<string>();
  // 섹션 id 를 알아볼 수 없으면 careItem 코드로 섹션을 찾는다. 그래도 못 찾으면 그 질문만 버리고 세어 둔다.
  let unmappable = 0;
  const picked = output.questions
    .map((question) => {
      const normalized = normalizeTargetSectionIds(question.targetSectionIds);
      const targetSectionIds = normalized.length > 0 ? normalized : sectionsForCareItem(question.careItem);
      if (targetSectionIds.length === 0) unmappable += 1;
      return { ...question, targetSectionIds };
    })
    .filter((question) => {
      const key = question.careItem.trim().toLowerCase();
      if (!question.question.trim() || question.targetSectionIds.length === 0 || asked.has(question.question.trim())) return false;
      if (key && seenCareItems.has(key)) return false;
      if (key) seenCareItems.add(key);
      return true;
    })
    .slice(0, Math.min(state.questionBudget.perRound, remaining));

  const now = new Date().toISOString();
  if (picked.length === 0 && unmappable > 0) {
    // 모델이 질문은 만들었는데 섹션을 못 알아본 경우다. 인터뷰를 끝내지 말고 다시 시도하게 한다.
    console.error(`[SW-Q2 round ${roundNo}] ${unmappable} question(s) had unrecognizable section ids`, output.questions);
    throw new Error('질문의 CARE 섹션을 알아보지 못했습니다. "다시 시도"를 눌러 주세요.');
  }
  if (picked.length === 0) {
    return { state: finishInterview(state), round: null, stopReason: output.stopReason || '더 물을 빈칸이 없습니다.' };
  }

  const baseOrder = allQuestions(state).length;
  const round: StudyWriteRound = {
    roundNo,
    kind: 'gap',
    startedAt: now,
    generation: {
      model,
      promptVersion: STUDY_WRITE_QUESTIONS_PROMPT_VERSION,
      promptTemplateHash: promptMeta('SW_Q2').promptTemplateHash,
      generatedAt: now,
      candidateCount: summaries.candidateCount,
      recordTruncated: isRecordTruncated(caseData)
    },
    questions: picked.map((question, index) => ({
      id: `swq-${randomUUID()}`,
      roundNo,
      order: baseOrder + index + 1,
      text: question.question.trim(),
      source: 'generated',
      targetSectionIds: question.targetSectionIds,
      careItem: question.careItem,
      priority: priorityForCareItem(question.careItem),
      rationale: question.rationale,
      status: 'pending',
      answer: '',
      askedAt: now,
      editHistory: []
    }))
  };

  return { state: { ...state, rounds: [...state.rounds, round], updatedAt: now }, round };
}

/** 화면에 돌려줄 때 참여자에게 보이지 않아야 하는 필드를 뺀다. */
export function toParticipantView(state: StudyWriteState) {
  return {
    ...state,
    rounds: state.rounds.map((round) => ({
      ...round,
      questions: round.questions.map(({ rationale: _rationale, ...question }) => question)
    }))
  };
}
