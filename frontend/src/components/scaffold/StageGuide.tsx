import type { StageGuideText } from '../../utils/scaffoldV2Guide';
import './StageGuide.css';

/**
 * 화면 머리의 "지금 할 일 / 다음" 두 줄 안내 (Scaffold V2, V2-01).
 * 현재 단계에서 할 일과, 끝낸 뒤 어디로 가는지만 짧게 말한다.
 */
export default function StageGuide({ guide, compact = false }: { guide: StageGuideText; compact?: boolean }) {
  return (
    <div className={`scaffold-stage-guide${compact ? ' is-compact' : ''}`} role="note">
      <div className="scaffold-stage-guide__row">
        <span className="scaffold-stage-guide__label is-now">지금 할 일</span>
        <span>{guide.now}</span>
      </div>
      <div className="scaffold-stage-guide__row">
        <span className="scaffold-stage-guide__label is-next">다음</span>
        <span>{guide.next}</span>
      </div>
    </div>
  );
}
