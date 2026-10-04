export const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  KEYWORDS: '키워드',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 결과',
  DISCUSSION_CONCLUSION: '논의 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '사전 동의'
};

export const SECTION_STATUS_LABELS: Record<string, string> = {
  IMPOSSIBLE: '작성 불가',
  INCOMPLETE: '보완 필요',
  READY: '초안 가능',
  PARTIAL_IMPOSSIBLE: '보완 필요',
  PARTIAL_POSSIBLE: '보완 필요',
  POSSIBLE: '보완 필요',
  FULLY_POSSIBLE: '초안 가능',
  AUTO: '자동 생성'
};

/**
 * What each backend processing stage is actually doing, in the user's terms.
 *
 * Processing a case takes roughly two minutes, most of it inside evidence
 * extraction, so a single unchanging spinner reads as "frozen". These labels are
 * driven by the real `chainProgress.currentStep` the backend writes as it goes -
 * no estimated percentage is shown, because none is available.
 */
export const PROCESS_STAGE_MESSAGES: Record<string, string> = {
  PREPROCESS: '진료기록을 안전하게 비식별화하고 용어를 정리하고 있습니다...',
  CHAIN1: '증례보고에 필요한 근거를 기록에서 찾고 있습니다...',
  CHAIN2: 'CARE 항목별로 작성 가능 여부를 판단하고 있습니다...',
  CHAIN3: 'CARE 항목별 초안을 구성하고 있습니다...',
  CHAIN4: '보완이 필요한 정보를 확인하고 있습니다...',
  CHAIN5: '확인이 필요한 질문을 정리하고 있습니다...',
  CHAIN6: '답변을 초안에 반영하고 있습니다...',
  CHAIN7: '최종 원고를 작성하고 있습니다...'
};

/** Short label for the same stages, used by the progress banner. */
export const PROCESS_STAGE_LABELS: Record<string, string> = {
  PREPROCESS: '비식별화와 입력 정리',
  CHAIN1: '근거 추출',
  CHAIN2: '섹션 상태 판단',
  CHAIN3: '초안 생성',
  CHAIN4: '부족 정보 분석',
  CHAIN5: '질문 생성',
  CHAIN6: '답변 반영',
  CHAIN7: '최종 원고 생성',
  BLOCKED: '개인정보 검토 필요'
};

/**
 * Resolves the message for the current stage. Before the first stage is
 * recorded the case is still being de-identified, so `PREPROCESS` is the honest
 * default rather than a generic "처리 중".
 */
export function getProcessStageMessage(currentStep: string | undefined | null, fallback: string): string {
  if (!currentStep) return PROCESS_STAGE_MESSAGES.PREPROCESS || fallback;
  if (currentStep.startsWith('REVIEW:')) return 'Review AI가 초안을 검토하고 있습니다...';
  return PROCESS_STAGE_MESSAGES[currentStep] || fallback;
}

export const DEFAULT_TIMELINE_COLUMNS = [
  '시점',
  '방문차수',
  '주요 증상',
  '검사/평가',
  '진단/판단',
  '치료',
  '경과',
  '비고'
];
