import { PendingTermConfirmation, ReviewRequiredState, StaleState } from '../services/api';

export function getStaleReasonLabel(reason?: StaleState['staleReason']) {
  switch (reason) {
    case 'ANSWER_UPDATED':
      return '질문 답변이 반영되어 기존 최종 원고와 리뷰 결과가 오래되었습니다.';
    case 'TERM_CONFIRMATION_UPDATED':
      return '전문용어 확인 결과가 반영되어 기존 최종 원고와 리뷰 결과가 오래되었습니다.';
    case 'DEIDENTIFICATION_UPDATED':
      return '비식별화 결과가 변경되어 기존 최종 원고와 리뷰 결과를 다시 확인해야 합니다.';
    case 'EVIDENCE_REGENERATED':
      return 'evidence가 다시 생성되어 최종 원고와 리뷰를 다시 확인해야 합니다.';
    default:
      return '기존 결과가 최신 상태가 아닙니다.';
  }
}

export function getReviewRequiredTitle(reviewRequired?: ReviewRequiredState | null) {
  if (!reviewRequired) return '';
  return reviewRequired.riskLevel === 'HIGH'
    ? '개인정보 보호 검토가 필요합니다.'
    : '개인정보 보호 재확인을 권장합니다.';
}

export function getReviewRequiredDescription(reviewRequired?: ReviewRequiredState | null) {
  if (!reviewRequired) return '';
  return reviewRequired.riskLevel === 'HIGH'
    ? 'HIGH 위험으로 분류되어 Chain1 처리가 차단되었습니다. EMR을 수정한 뒤 다시 처리해 주세요.'
    : 'MEDIUM 위험으로 분류되었습니다. 처리는 가능하지만 비식별화 결과를 먼저 확인해 주세요.';
}

export function formatPendingTermHeadline(item: PendingTermConfirmation) {
  const topCandidate = item.candidates?.[0]?.standardTerm;
  if (topCandidate) {
    return `‘${item.surface}’은(는) ‘${topCandidate}’일 가능성이 있습니다.`;
  }
  return `‘${item.surface}’ 용어 확인이 필요합니다.`;
}

export function getPendingTermStatusLabel(status: PendingTermConfirmation['status']) {
  switch (status) {
    case 'CONFIRMED':
      return '확인 완료';
    case 'REJECTED':
      return '직접 입력 적용';
    default:
      return '확인 필요';
  }
}

export function getPendingTermStatusClass(status: PendingTermConfirmation['status']) {
  switch (status) {
    case 'CONFIRMED':
      return 'confirmed';
    case 'REJECTED':
      return 'rejected';
    default:
      return 'pending';
  }
}
