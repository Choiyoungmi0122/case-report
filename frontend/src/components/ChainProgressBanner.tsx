import { ChainProgressState } from '../services/api';
import './ChainProgressBanner.css';

const STEP_LABELS: Record<string, string> = {
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

function getStepLabel(step?: string) {
  if (!step) return '';
  if (step.startsWith('REVIEW:')) {
    return 'Review AI 검토';
  }
  return STEP_LABELS[step] || step;
}

function getRemainingLabels(steps: string[]) {
  return steps.map((step) => getStepLabel(step)).filter(Boolean);
}

export default function ChainProgressBanner({
  progress,
  title = 'AI 처리 진행 상태'
}: {
  progress?: ChainProgressState | null;
  title?: string;
}) {
  const currentStep = progress?.currentStep;

  if (!progress || !currentStep || currentStep === 'BLOCKED') {
    return null;
  }

  const currentLabel = getStepLabel(currentStep);
  const remainingLabels = getRemainingLabels(progress.estimatedRemainingSteps || []);
  const completedCount = (progress.completedSteps || []).length;

  return (
    <div className="chain-progress-banner">
      <div className="chain-progress-banner-header">
        <div>
          <h3>{title}</h3>
          <p>지금 처리 중인 단계만 표시합니다.</p>
        </div>
        <span className="chain-progress-current">{currentLabel}</span>
      </div>

      <div className="chain-progress-summary">
        {completedCount > 0 ? <span>완료 단계 {completedCount}개</span> : null}
        {remainingLabels.length > 0 ? <span>남은 단계 {remainingLabels.length}개</span> : null}
      </div>

      {remainingLabels.length > 0 ? (
        <div className="chain-progress-remaining">
          {remainingLabels.map((label) => (
            <span key={label} className="chain-progress-pill">
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
