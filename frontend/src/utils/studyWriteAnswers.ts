import type { StudyWriteQuestion, StudyWriteSkipReason } from '../services/api';

/**
 * 질의응답 선택지의 화면 문구. 저장값(status / skipReason)과 분리해 둔다.
 * 서버의 studyWrite/answerChoices.ts 와 같은 뜻을 유지한다.
 */
export type AnswerChoiceValue = StudyWriteSkipReason | 'deferred';

export const ANSWER_CHOICES: Array<{ value: AnswerChoiceValue; label: string; description: string }> = [
  { value: 'not_in_record', label: '기록 없음', description: '제공된 진료기록에 해당 정보가 기재되지 않음' },
  { value: 'cannot_confirm', label: '확인할 수 없음', description: '현재 기록만으로 사실 여부나 임상적 판단을 확정하기 어려움' },
  { value: 'needs_follow_up', label: '추후 확인 필요', description: '현재 제공된 자료 외에 추가 자료나 확인이 필요함' },
  { value: 'deferred', label: '자료 확인 필요', description: '기록을 아직 충분히 확인하지 못해 답을 보류함. 나중에 다시 답할 수 있음' }
];

export function choiceToBody(questionId: string, value: AnswerChoiceValue) {
  return value === 'deferred'
    ? { questionId, deferred: true as const }
    : { questionId, skipped: true as const, skipReason: value };
}

export function answerStatusLabel(question: Pick<StudyWriteQuestion, 'status' | 'skipReason'>): string {
  if (question.status === 'deferred') return '자료 확인 필요 (보류)';
  if (question.status === 'skipped') {
    const reason = question.skipReason || 'not_in_record';
    return ANSWER_CHOICES.find((choice) => choice.value === reason)?.label || '기록 없음';
  }
  return '';
}

export function isUnanswered(question: Pick<StudyWriteQuestion, 'status'>): boolean {
  return question.status === 'deferred' || question.status === 'pending';
}
