import { StudyWriteQuestion, StudyWriteSkipReason } from '../types/studyWrite';

/**
 * 질의응답에서 글 대신 고를 수 있는 선택지. 화면 문구와 저장값을 여기서만 정의한다.
 *
 * - skipped + skipReason: 답을 하지 않기로 한 것 (기록 없음 / 확인할 수 없음 / 추후 확인 필요)
 * - deferred: "자료 확인 필요". 참여자가 제공된 기록을 아직 충분히 보지 못해 답을 보류한 것.
 *   정보가 없다는 뜻이 아니므로 AI 는 이를 부재로 해석하거나 지어내서 채우면 안 된다.
 * - 옛 데이터: skipReason 없는 skipped 는 "모름 / 기록에 없음"이었으므로 not_in_record 로 본다.
 */
export const SKIP_REASON_LABELS: Record<StudyWriteSkipReason, { label: string; description: string }> = {
  not_in_record: { label: '기록 없음', description: '제공된 진료기록에 해당 정보가 기재되지 않음' },
  cannot_confirm: { label: '확인할 수 없음', description: '현재 기록만으로 사실 여부나 임상적 판단을 확정하기 어려움' },
  needs_follow_up: { label: '추후 확인 필요', description: '현재 제공된 자료 외에 추가 자료나 확인이 필요함' }
};

export const DEFERRED_LABEL = { label: '자료 확인 필요', description: '제공된 기록을 아직 충분히 확인하지 못해 답을 보류함' };

export function effectiveSkipReason(question: Pick<StudyWriteQuestion, 'status' | 'skipReason'>): StudyWriteSkipReason | null {
  if (question.status !== 'skipped') return null;
  return question.skipReason || 'not_in_record';
}

/** 화면·기록용 짧은 표시 */
export function answerStatusLabel(question: Pick<StudyWriteQuestion, 'status' | 'skipReason'>): string {
  if (question.status === 'deferred') return DEFERRED_LABEL.label;
  const reason = effectiveSkipReason(question);
  if (reason) return SKIP_REASON_LABELS[reason].label;
  return question.status === 'answered' ? '답함' : '답하지 않음';
}

/**
 * 프롬프트에 넣는 답 칸. 글로 답한 경우는 호출부가 비식별한 답을 넣고, 그 밖은 이 문구를 쓴다.
 * 선택지마다 AI 가 어떻게 다뤄야 하는지까지 적는다.
 */
export function answerTextForPrompt(question: Pick<StudyWriteQuestion, 'status' | 'skipReason'>): string | null {
  if (question.status === 'deferred') {
    return '(답 보류 — 참여자가 제공된 기록을 아직 충분히 확인하지 못해 답하지 않음. 정보가 없다는 뜻이 아니다. 기록에 있으면 기록대로 쓴다. 기록에 없으면 이 주제에 대해 아무 문장도 쓰지 않는다: "기록에 없다", "확인되지 않는다", "정보가 없다" 같은 말을 쓰지 말고, 지어내지도 말고, 그 자리에 "[확인 필요: <무엇> — 자료 확인 중]" 표시만 남긴다. 이미 물은 질문이므로 다시 묻지 않는다)';
  }
  const reason = effectiveSkipReason(question);
  if (reason === 'not_in_record') {
    return '(기록 없음 — 제공된 진료기록에 해당 정보가 기재되지 않음. 이 주제는 쓰지 않는다. 필수 항목이면 "[확인 필요: <무엇>]"을 남긴다)';
  }
  if (reason === 'cannot_confirm') {
    return '(확인할 수 없음 — 현재 기록만으로 사실 여부나 임상적 판단을 확정하기 어려움. 사실로 단정하지 않고, 기록에 적힌 범위에서 잠정 표현으로만 쓴다. 필수 항목이면 "[확인 필요: <무엇>]"을 남긴다)';
  }
  if (reason === 'needs_follow_up') {
    return '(추후 확인 필요 — 추가 자료나 확인이 필요함. 지금은 쓰지 않고, 필수 항목이면 "[확인 필요: <무엇>, 추후 확인]"을 남긴다)';
  }
  if (question.status === 'pending') return '(아직 답하지 않음)';
  return null;
}
