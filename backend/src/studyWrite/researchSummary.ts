import { StudyWriteState } from '../types/studyWrite';
import { CARE_SECTION_ORDER } from './careItems';
import { effectiveCareStatus, isCareJudged, isCareSatisfied } from './careStatus';

/**
 * 연구용 내보내기에 넣는 실험용 Write 요약. 유용성·효율성을 보려는 것이므로 단계별
 * 소요 시간과 횟수를 미리 계산해 둔다. 원자료(studyWrite 전체)도 함께 내보낸다.
 */

/**
 * 섹션 하나의 CARE 세부 항목 집계. "있음"·"해당 없음"을 충족으로 본다.
 * 준수율의 분모는 판정을 받은 항목이다: 판정 없음(unchecked, 2026-10-11 판의 "판정 못 받음" 포함)은
 * 충족도 누락도 아니므로 careUnchecked 로 따로 센다.
 */
function careSummaryFields(rawItems: Array<{ status: string; hint?: string; required: boolean; subItems?: Array<{ status: string; required: boolean }> }>) {
  const items = rawItems.map((item) => ({ ...item, status: effectiveCareStatus(item) }));
  const judged = items.filter((item) => isCareJudged(item.status));
  const judgedRequired = judged.filter((item) => item.required);
  const ok = judged.filter((item) => isCareSatisfied(item.status)).length;
  return {
    careTotal: items.length,
    careUnchecked: items.length - judged.length,
    careOk: ok,
    carePct: judged.length ? Math.round((ok / judged.length) * 100) : null,
    careRequiredPct: judgedRequired.length
      ? Math.round((judgedRequired.filter((item) => isCareSatisfied(item.status)).length / judgedRequired.length) * 100)
      : null,
    careRequiredMissing: judged.filter((item) => item.required && !isCareSatisfied(item.status)).length,
    careOptionalMissing: judged.filter((item) => !item.required && !isCareSatisfied(item.status)).length,
    careInRecordNotInDraft: judged.filter((item) => item.status === 'in_record_not_in_draft').length,
    ...careSubSummaryFields(rawItems)
  };
}

/**
 * 하위 요소(체크리스트 v2) 집계. 해당 없음은 분모에서 뺀다(항목 단위 준수율과 다르다).
 * 하위 요소가 없는 섹션·옛 점검 결과는 careSubTotal 0, 나머지 null.
 */
function careSubSummaryFields(rawItems: Array<{ subItems?: Array<{ status: string; required: boolean }> }>) {
  const subs = rawItems.flatMap((item) => item.subItems || []);
  const judged = subs.filter((sub) => isCareJudged(sub.status));
  const applicable = judged.filter((sub) => sub.status !== 'not_applicable');
  const requiredApplicable = applicable.filter((sub) => sub.required);
  const present = applicable.filter((sub) => sub.status === 'present').length;
  return {
    careSubTotal: subs.length,
    careSubUnchecked: subs.length - judged.length,
    careSubNotApplicable: judged.length - applicable.length,
    careSubPresent: present,
    careSubPct: applicable.length ? Math.round((present / applicable.length) * 100) : null,
    careSubRequiredPct: requiredApplicable.length
      ? Math.round((requiredApplicable.filter((sub) => sub.status === 'present').length / requiredApplicable.length) * 100)
      : null,
    careSubRequiredMissing: requiredApplicable.filter((sub) => sub.status !== 'present').length
  };
}

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
  const deferred = questions.filter((question) => question.status === 'deferred');
  const skipReasons = {
    not_in_record: skipped.filter((question) => (question.skipReason || 'not_in_record') === 'not_in_record').length,
    cannot_confirm: skipped.filter((question) => question.skipReason === 'cannot_confirm').length,
    needs_follow_up: skipped.filter((question) => question.skipReason === 'needs_follow_up').length
  };
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
      ...careSummaryFields(careItems)
    };
  });

  const firstDraftAt = Object.values(state.sections || {})
    .map((section) => section.history.find((item) => item.source === 'answers')?.at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  return {
    inputSource: state.inputSource || null,
    /** 참여자가 넣은 첫 기록일 (보여 주기·Word 에만 쓰임, 저장된 초안은 상대 날짜 그대로) */
    dateAnchor: state.dateAnchor || null,
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
      /** "자료 확인 필요"로 보류된 채 남은 질문 수 (제출 시점 기준) */
      deferred: deferred.length,
      /** CARE 점검에서 사용자가 직접 넣은 정보 수 */
      careInfoAdded: questions.filter((question) => question.source === 'care_check').length,
      skipReasons,
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
    /** 전체 CARE 준수율: 점검된 모든 섹션의 세부 항목 합산 */
    careCompliance: (() => {
      const checked = sections.filter((item: any) => typeof item.careTotal === 'number' && item.careTotal > 0) as any[];
      const total = checked.reduce((sum, item) => sum + item.careTotal, 0);
      const unchecked = checked.reduce((sum, item) => sum + (item.careUnchecked || 0), 0);
      const judged = total - unchecked;
      const ok = checked.reduce((sum, item) => sum + item.careOk, 0);
      return { sectionsChecked: checked.length, total, unchecked, ok, pct: judged ? Math.round((ok / judged) * 100) : null };
    })(),
    totals: {
      reviseCount: sumOf(sections, 'reviseCount'),
      manualEditCount: sumOf(sections, 'manualEditCount'),
      attachmentCount: sumOf(sections, 'attachmentCount'),
      outOfRecordClaimCount: sumOf(sections, 'outOfRecordClaimCount'),
      careRequiredMissing: sumOf(sections, 'careRequiredMissing')
    }
  };
}
