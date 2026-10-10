import { randomUUID } from 'crypto';
import { createOutboundDeidContext, deidentifyOutboundField } from '../deid/outbound';
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

export function answerQuestion(
  state: StudyWriteState,
  questionId: string,
  params: { answer?: string; skipped?: boolean }
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
      const nextStatus = params.skipped ? 'skipped' : 'answered';
      const nextAnswer = params.skipped ? '' : String(params.answer || '').trim();
      if (!params.skipped && !nextAnswer) {
        throw new Error('답을 적거나 "모름 / 기록에 없음"을 눌러 주세요.');
      }
      const editHistory =
        question.status === 'pending'
          ? question.editHistory
          : [...question.editHistory, { previousAnswer: question.answer, previousStatus: question.status, editedAt: now }];
      return { ...question, status: nextStatus as StudyWriteQuestion['status'], answer: nextAnswer, answeredAt: now, editHistory };
    });
    const completed = questions.every((question) => question.status !== 'pending');
    return { ...round, questions, completedAt: completed ? round.completedAt || now : undefined };
  });
  if (!found) throw new Error('질문을 찾지 못했습니다.');
  return { ...state, rounds, updatedAt: now };
}

export function remainingQuestionCount(state: StudyWriteState): number {
  return Math.max(0, state.questionBudget.maxTotal - allQuestions(state).length);
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

/** 참여자의 답은 외부로 나가기 전에 비식별 처리한다 (기록과 같은 기준). */
const outboundContext = createOutboundDeidContext();
async function deidentifyAnswer(answer: string): Promise<string> {
  if (!answer.trim()) return '';
  return deidentifyOutboundField(answer, outboundContext);
}

export async function buildPriorQaSummary(state: StudyWriteState): Promise<string> {
  const lines: string[] = [];
  for (const question of allQuestions(state)) {
    const answer =
      question.status === 'skipped'
        ? '(모름 / 기록에 없음)'
        : question.status === 'answered'
          ? await deidentifyAnswer(question.answer)
          : '(아직 답하지 않음)';
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

/** 비식별된 방문 기록 전문. 체인이 "기록에 이미 있는 것"을 묻지 않도록 함께 보낸다. */
export function buildRecordText(caseData: any): string {
  const records: any[] = Array.isArray(caseData?.deidentifiedEMRs) ? caseData.deidentifiedEMRs : [];
  const text = records
    .map((record, index) => {
      const date = record?.visitDateTime || record?.date || '';
      return `[방문 ${record?.visitIndex || index + 1}${date ? ` ${String(date).slice(0, 16)}` : ''}]\n${String(record?.deidentifiedText || '').trim()}`;
    })
    .join('\n\n');
  return text.length > MAX_RECORD_CHARS ? `${text.slice(0, MAX_RECORD_CHARS)}\n…(이하 생략)` : text;
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
  const picked = output.questions
    .map((question) => ({ ...question, targetSectionIds: normalizeTargetSectionIds(question.targetSectionIds) }))
    .filter(
      (question) => question.question.trim() && question.targetSectionIds.length > 0 && !asked.has(question.question.trim())
    )
    .slice(0, Math.min(state.questionBudget.perRound, remaining));

  const now = new Date().toISOString();
  if (picked.length === 0) {
    return { state: finishInterview(state), round: null, stopReason: output.stopReason || '더 물을 빈칸이 없습니다.' };
  }

  const baseOrder = allQuestions(state).length;
  const round: StudyWriteRound = {
    roundNo,
    kind: 'gap',
    startedAt: now,
    generation: { model, promptVersion: STUDY_WRITE_QUESTIONS_PROMPT_VERSION, generatedAt: now, candidateCount: summaries.candidateCount },
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
