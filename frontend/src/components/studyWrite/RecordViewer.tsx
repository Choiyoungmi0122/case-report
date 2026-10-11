import { Fragment, useEffect, useMemo, useState } from 'react';
import { caseApi, Visit } from '../../services/api';
import './RecordViewer.css';

/**
 * 실험용 Write 초안 화면의 "원문 EMR 보기": 이 사례에 넣은 (비식별) 진료 기록을 회차별로 보여 준다.
 * 처음 열 때 한 번만 불러온다. 낱말을 찾으면 강조하고 그 낱말이 있는 회차만 남길 수 있다.
 */

function visitLabel(visits: Visit[], index: number, relativeDates: boolean): string {
  const visit = visits[index];
  if (!visit?.date) return '';
  if (relativeDates && visits[0]?.date) {
    const days = Math.round((new Date(visit.date).getTime() - new Date(visits[0].date).getTime()) / 86400000);
    return days === 0 ? '첫 기록일' : `첫 기록일 +${days}일`;
  }
  return visit.date.slice(0, 16).replace('T', ' ');
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(query);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <mark>{query}</mark> : null}
    </Fragment>
  ));
}

export default function RecordViewer(props: {
  caseId: string;
  isOpen: boolean;
  onClose: () => void;
  relativeDates: boolean;
  /** "첫 기록일 +N일"을 실제 날짜로 바꿔 보여 줄 때 (첫 기록일을 넣은 경우) */
  formatDate?: (label: string) => string;
}) {
  const { caseId, isOpen, onClose, relativeDates, formatDate } = props;
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyMatches, setOnlyMatches] = useState(false);

  useEffect(() => {
    if (!isOpen || visits !== null) return;
    caseApi
      .getCase(caseId)
      .then((caseData) => setVisits(((caseData as any).visits as Visit[] | undefined) || []))
      .catch((nextError: any) => setError(nextError?.response?.data?.error || nextError?.message || '기록을 불러오지 못했습니다.'));
  }, [caseId, isOpen, visits]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const needle = query.trim();
  const counts = useMemo(
    () => (visits || []).map((visit) => (needle ? String(visit.soapText || '').split(needle).length - 1 : 0)),
    [visits, needle]
  );
  const total = counts.reduce((sum, count) => sum + count, 0);

  if (!isOpen) return null;

  return (
    <div className="sw-record" role="dialog" aria-modal="true" aria-label="원문 EMR">
      <div className="sw-record__backdrop" onClick={onClose} />
      <aside className="sw-record__panel">
        <header className="sw-record__head">
          <div>
            <h2>원문 EMR</h2>
            <p>이 사례에 넣은 비식별 진료 기록입니다. 고칠 수는 없고 보기만 합니다.</p>
          </div>
          <button type="button" className="sw-record__close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="sw-record__search">
          <input
            value={query}
            placeholder="기록에서 찾기 (예: 황련, 두근거림)"
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          {needle ? <span>{total}곳</span> : null}
          <label>
            <input type="checkbox" checked={onlyMatches} disabled={!needle} onChange={(event) => setOnlyMatches(event.target.checked)} />
            찾은 회차만
          </label>
        </div>
        <div className="sw-record__body">
          {error ? <p className="sw-record__empty">{error}</p> : null}
          {!error && visits === null ? <p className="sw-record__empty">불러오는 중…</p> : null}
          {visits && visits.length === 0 ? <p className="sw-record__empty">넣은 기록이 없습니다.</p> : null}
          {visits?.map((visit, index) => {
            if (onlyMatches && needle && counts[index] === 0) return null;
            const label = visitLabel(visits, index, relativeDates);
            return (
              <section key={index} className="sw-record__visit">
                <h3>
                  {index + 1}회차
                  {visit.type ? <em>{visit.type}</em> : null}
                  {label ? <span>{formatDate ? formatDate(label) : label}</span> : null}
                  {needle && counts[index] > 0 ? <b>{counts[index]}곳</b> : null}
                </h3>
                <pre>{highlight(String(visit.soapText || '').trim() || '(내용 없음)', needle)}</pre>
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
