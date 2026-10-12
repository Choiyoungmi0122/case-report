import { useCallback, useEffect, useMemo, useState } from 'react';
import { caseApi, StudyWriteManuscriptFinding } from '../../services/api';
import './ManuscriptCheckPanel.css';

/**
 * 원고 검사 (코드 검사, AI 호출 없음). backend studyWrite/manuscriptCheck.ts 의 결과를 섹션별로 보여 준다.
 * 고치지는 않는다. "이 섹션으로"를 누르면 그 섹션으로 간다.
 */

const SEVERITY_LABEL: Record<StudyWriteManuscriptFinding['severity'], string> = { error: '오류', warn: '주의', info: '참고' };
const KIND_LABEL: Record<string, string> = {
  dose: '약재 용량',
  unit: '단위',
  date: '날짜',
  timing: '시점',
  formula: '처방명',
  speculation: '추측 표현',
  absence: '부재 문장',
  consistency: '섹션 사이 불일치',
  voice: '말한 사람',
  marker: '남은 표시',
  added_answer: '초안 단계 추가 답'
};

export default function ManuscriptCheckPanel(props: {
  caseId: string;
  isOpen: boolean;
  onClose: () => void;
  onGoToSection?: (sectionId: string) => void;
  /** "첫 기록일 +N일"을 실제 날짜로 보여 줄 때 */
  formatText?: (text: string) => string;
}) {
  const { caseId, isOpen, onClose, onGoToSection, formatText } = props;
  const [findings, setFindings] = useState<StudyWriteManuscriptFinding[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const fmt = (text?: string) => (text ? (formatText ? formatText(text) : text) : '');

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await caseApi.checkStudyWriteManuscript(caseId);
      setFindings(result.findings);
      setCheckedAt(result.checkedAt);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '원고를 검사하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  // 열 때마다 다시 검사한다 (그 사이 원고가 바뀌었을 수 있다)
  useEffect(() => {
    if (isOpen) void run();
  }, [isOpen, run]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const counts = useMemo(() => {
    const out = { error: 0, warn: 0, info: 0 };
    for (const finding of findings || []) out[finding.severity] += 1;
    return out;
  }, [findings]);

  const grouped = useMemo(() => {
    const map = new Map<string, { sectionName: string; items: StudyWriteManuscriptFinding[] }>();
    for (const finding of findings || []) {
      if (!showInfo && finding.severity === 'info') continue;
      const group = map.get(finding.sectionId) || { sectionName: finding.sectionName, items: [] };
      group.items.push(finding);
      map.set(finding.sectionId, group);
    }
    return [...map.entries()];
  }, [findings, showInfo]);

  if (!isOpen) return null;

  return (
    <div className="sw-check" role="dialog" aria-modal="true" aria-label="원고 검사">
      <div className="sw-check__backdrop" onClick={onClose} />
      <aside className="sw-check__panel">
        <header className="sw-check__head">
          <div>
            <h2>원고 검사</h2>
            <p>기록·답과 코드로 대조한 결과입니다(AI를 쓰지 않음). 고치지는 않고 위치와 이유만 알려 드립니다.</p>
          </div>
          <button type="button" className="sw-check__close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sw-check__summary">
          <span className="is-error">오류 {counts.error}</span>
          <span className="is-warn">주의 {counts.warn}</span>
          <span className="is-info">참고 {counts.info}</span>
          <label>
            <input type="checkbox" checked={showInfo} onChange={(event) => setShowInfo(event.target.checked)} />
            참고 보기
          </label>
          <button type="button" disabled={loading} onClick={() => void run()}>
            {loading ? '검사 중…' : '다시 검사'}
          </button>
        </div>
        <div className="sw-check__body">
          {error ? <p className="sw-check__empty">{error}</p> : null}
          {!error && loading && !findings ? <p className="sw-check__empty">검사하는 중…</p> : null}
          {findings && grouped.length === 0 ? (
            <p className="sw-check__empty">{counts.info > 0 ? '오류·주의는 없습니다. 참고 항목만 있습니다.' : '찾은 문제가 없습니다.'}</p>
          ) : null}
          {grouped.map(([sectionId, group]) => (
            <section key={sectionId} className="sw-check__section">
              <h3>
                {group.sectionName}
                {onGoToSection ? (
                  <button type="button" className="is-link" onClick={() => onGoToSection(sectionId)}>
                    이 섹션으로
                  </button>
                ) : null}
              </h3>
              <ul>
                {group.items.map((finding) => (
                  <li key={finding.id} className={`sw-check__item is-${finding.severity}`}>
                    <div className="sw-check__tags">
                      <em>{SEVERITY_LABEL[finding.severity]}</em>
                      <span>{KIND_LABEL[finding.kind] || finding.kind}</span>
                    </div>
                    <p>{fmt(finding.message)}</p>
                    {finding.excerpt ? <blockquote>{fmt(finding.excerpt)}</blockquote> : null}
                    {finding.evidence ? <small>근거·질문: {fmt(finding.evidence)}</small> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {checkedAt ? <p className="sw-check__time">검사 시각 {new Date(checkedAt).toLocaleTimeString()}</p> : null}
        </div>
      </aside>
    </div>
  );
}
