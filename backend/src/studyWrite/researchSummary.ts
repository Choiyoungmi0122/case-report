import { StudyWriteState } from '../types/studyWrite';
import { CARE_SECTION_ORDER } from './careItems';

/**
 * 연구용 내보내기에 넣는 실험용 Write 요약. 유용성·효율성을 보려는 것이므로 단계별
 * 소요 시간과 횟수를 미리 계산해 둔다. 원자료(studyWrite 전체)도 함께 내보낸다.
 */

function seconds(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 100) / 10;
}

function sumOf(items: Array<Record<string, unknown>>, key: string): number {
  return items.reduce((sum, item) => sum + (typeof item[key] === 'number' ? (item[key] as number) : 0), 0);
}

export function buildStudyWriteSummary(state: StudyWriteState | null | undefined, caseCreatedAt?: string) {
  if (!state) return null;
  const questions = state.rounds.flatMap((round) => round.questions);
  const answered = questions.filter((question) => question.status === 'answered');
  const skipped = questions.filter((question) => question.status === 'skipped');
  const edits = questions.reduce((sum, question) => sum + question.editHistory.length, 0);
  const answerSeconds = questions
    .map((question) => seconds(question.askedAt, question.answeredAt))
    .filter((value): value is number => value !== null);

  const sections = CARE_SECTION_ORDER.map((sectionId) => {
    const section = state.sections?.[sectionId];
    if (!section) return { sectionId, hasDraft: false };
    const reviseCount = section.history.filter((item) => item.source === 'revise').length;
    const manualCount = section.history.filter((item) => item.source === 'manual').length;
    const regenerateCount = section.history.filter((item) => item.source === 'answers_edited').length;
    const outOfRecord = section.history.reduce((sum, item) => sum + (item.outOfRecordClaims?.length || 0), 0);
    const firstText = section.history.find((item) => item.source === 'answers')?.text || '';
    const finalText = section.draftText || '';
    const careItems = section.careCheck?.items || [];
    return {
      sectionId,
      hasDraft: Boolean(finalText),
      version: section.version,
      reviseCount,
      manualEditCount: manualCount,
      regenerateCount,
      chatTurns: section.chat.filter((entry) => entry.role === 'user').length,
      outOfRecordClaimCount: outOfRecord,
      attachmentCount: section.attachmentIds.length,
      firstDraftChars: firstText.length,
      finalDraftChars: finalText.length,
      /** 처음 초안 대비 최종 글자 수 변화 비율 */
      changeRatio: firstText ? Math.round((Math.abs(finalText.length - firstText.length) / firstText.length) * 1000) / 1000 : null,
      careRequiredMissing: careItems.filter((item) => item.required && item.status !== 'present' && item.status !== 'not_applicable').length,
      careOptionalMissing: careItems.filter((item) => !item.required && item.status !== 'present' && item.status !== 'not_applicable').length,
      careInRecordNotInDraft: careItems.filter((item) => item.status === 'in_record_not_in_draft').length
    };
  });

  const firstDraftAt = Object.values(state.sections || {})
    .map((section) => section.history.find((item) => item.source === 'answers')?.at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return {
    inputSource: state.inputSource || null,
    questionBudget: state.questionBudget,
    timing: {
      caseCreatedAt: caseCreatedAt || null,
      interviewStartedAt: state.interviewStartedAt || null,
      interviewCompletedAt: state.interviewCompletedAt || null,
      interviewSeconds: seconds(state.interviewStartedAt, state.interviewCompletedAt),
      draftGenerationStartedAt: state.firstGeneration?.startedAt || state.draftGeneration?.startedAt || null,
      draftGenerationFinishedAt: state.firstGeneration?.finishedAt || state.draftGeneration?.finishedAt || null,
      draftGenerationSeconds: seconds(
        state.firstGeneration?.startedAt || state.draftGeneration?.startedAt,
        state.firstGeneration?.finishedAt || state.draftGeneration?.finishedAt
      ),
      firstDraftAt: firstDraftAt || null,
      answersLockedAt: state.answersLockedAt || null,
      submittedAt: state.submittedAt || null,
      editingSeconds: seconds(
        state.firstGeneration?.finishedAt || state.draftGeneration?.finishedAt,
        state.answersLockedAt || state.submittedAt
      ),
      finalEditSeconds: seconds(state.answersLockedAt, state.submittedAt),
      totalSeconds: seconds(caseCreatedAt, state.submittedAt)
    },
    interview: {
      rounds: state.rounds.length,
      questionsAsked: questions.length,
      answered: answered.length,
      skipped: skipped.length,
      answerEdits: edits,
      medianAnswerSeconds: answerSeconds.length ? answerSeconds.sort((a, b) => a - b)[Math.floor(answerSeconds.length / 2)] : null,
      byRound: state.rounds.map((round) => ({
        roundNo: round.roundNo,
        kind: round.kind,
        questions: round.questions.length,
        skipped: round.questions.filter((question) => question.status === 'skipped').length,
        seconds: seconds(round.startedAt, round.completedAt)
      }))
    },
    sections,
    totals: {
      reviseCount: sumOf(sections, 'reviseCount'),
      manualEditCount: sumOf(sections, 'manualEditCount'),
      attachmentCount: sumOf(sections, 'attachmentCount'),
      outOfRecordClaimCount: sumOf(sections, 'outOfRecordClaimCount'),
      careRequiredMissing: sumOf(sections, 'careRequiredMissing')
    }
  };
}
