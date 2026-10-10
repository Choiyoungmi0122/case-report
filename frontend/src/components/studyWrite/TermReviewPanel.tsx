import { Fragment, useEffect, useMemo, useState } from 'react';
import { caseApi, PendingTermConfirmation, PendingTermMutationResponse, Visit } from '../../services/api';
import './TermReviewPanel.css';

/**
 * 실험용 Write 의 전문용어 확인. 왼쪽에 그 용어가 나온 방문(회차)과 원문 전체를 보여 주고,
 * 오른쪽에서 용어를 고른다. 같은 용어가 여러 방문에 나오면 한 묶음으로 보여 주고 한 번에 처리한다.
 */

type TermGroup = {
  key: string;
  surface: string;
  category: string;
  candidates: PendingTermConfirmation['candidates'];
  items: PendingTermConfirmation[];
};

type TermReviewPanelProps = {
  caseId: string;
  isOpen: boolean;
  onClose: () => void;
  pendingTerms: PendingTermConfirmation[];
  visits: Visit[];
  relativeDates: boolean;
  onResolved: (result: PendingTermMutationResponse) => Promise<void> | void;
};

function groupTerms(items: PendingTermConfirmation[]): TermGroup[] {
  const groups = new Map<string, TermGroup>();
  for (const item of items) {
    if (item.status !== 'PENDING') continue;
    const key = `${item.surface}|${(item.candidates || []).map((candidate) => candidate.standardTerm).join(',')}`;
    const group = groups.get(key) || {
      key,
      surface: item.surface,
      category: item.category,
      candidates: item.candidates || [],
      items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    items: [...group.items].sort((a, b) => a.visitIndex - b.visitIndex)
  }));
}

function visitDateLabel(visits: Visit[], visitIndex: number, relativeDates: boolean): string {
  const visit = visits[visitIndex - 1];
  if (!visit?.date) return '';
  if (relativeDates && visits[0]?.date) {
    const days = Math.round((new Date(visit.date).getTime() - new Date(visits[0].date).getTime()) / 86400000);
    return days === 0 ? '첫 기록일' : `첫 기록일 +${days}일`;
  }
  return visit.date.slice(0, 16).replace('T', ' ');
}

/** 원문에서 용어가 나온 자리를 표시한다. */
function highlight(text: string, surface: string) {
  if (!surface || !text.includes(surface)) return text;
  const parts = text.split(surface);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <mark>{surface}</mark> : null}
    </Fragment>
  ));
}

export default function TermReviewPanel({
  caseId,
  isOpen,
  onClose,
  pendingTerms,
  visits,
  relativeDates,
  onResolved
}: TermReviewPanelProps) {
  const groups = useMemo(() => groupTerms(pendingTerms), [pendingTerms]);
  const pendingCount = useMemo(() => pendingTerms.filter((item) => item.status === 'PENDING').length, [pendingTerms]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [customTerm, setCustomTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = groups.find((group) => group.key === selectedKey) || groups[0] || null;

  useEffect(() => {
    if (!isOpen) {
      setSelectedKey(null);
      setCustomTerm('');
      setMessage(null);
      setError(null);
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, busy, onClose]);

  // 처리한 묶음이 사라지면 다음 묶음을 고른다.
  useEffect(() => {
    if (selectedKey && !groups.some((group) => group.key === selectedKey)) {
      setSelectedKey(groups[0]?.key || null);
      setCustomTerm('');
    }
  }, [groups, selectedKey]);

  if (!isOpen) return null;

  /** 묶음의 모든 방문에 같은 결정을 적용한다. 서버는 재처리를 한 번으로 모은다. */
  const applyToGroup = async (group: TermGroup, decision: { confirmedTerm?: string; keepOriginal?: boolean; customReplacement?: string }) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let last: PendingTermMutationResponse | null = null;
      for (const item of group.items) {
        last = decision.keepOriginal
          ? await caseApi.rejectPendingTerm(caseId, item.pendingId, decision.customReplacement || undefined)
          : await caseApi.confirmPendingTerm(caseId, item.pendingId, decision.confirmedTerm);
      }
      if (last) await onResolved(last);
      setCustomTerm('');
      setMessage(
        decision.keepOriginal && !decision.customReplacement
          ? `‘${group.surface}’은(는) 원문대로 둡니다 (${group.items.length}곳).`
          : `‘${group.surface}’ → ‘${decision.confirmedTerm || decision.customReplacement}’ (${group.items.length}곳). 기록 분석에 반영 중입니다.`
      );
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-term-overlay" role="dialog" aria-modal="true" aria-labelledby="sw-term-title" onClick={() => !busy && onClose()}>
      <div className="sw-term-panel" onClick={(event) => event.stopPropagation()}>
        <header className="sw-term-panel__header">
          <div>
            <h2 id="sw-term-title">전문용어 확인</h2>
            <p>
              기록에서 뜻이 애매한 표현입니다. 왼쪽 원문을 보고 오른쪽에서 표준 용어를 고르거나 원문대로 두세요.
              남은 용어 {groups.length}종 · {pendingCount}곳
            </p>
          </div>
          <button type="button" className="sw-term-panel__close" onClick={onClose} disabled={busy} aria-label="닫기">
            ×
          </button>
        </header>

        {error ? <div className="sw-term-panel__error">{error}</div> : null}
        {message ? <div className="sw-term-panel__message">{message}</div> : null}

        {!selected ? (
          <div className="sw-term-panel__empty">확인할 전문용어가 없습니다.</div>
        ) : (
          <div className="sw-term-panel__body">
            <section className="sw-term-source" aria-label="원문">
              <h3>
                ‘{selected.surface}’이(가) 나온 기록 · {selected.items.length}곳
              </h3>
              {selected.items.map((item) => {
                const visit = visits[item.visitIndex - 1];
                const dateLabel = visitDateLabel(visits, item.visitIndex, relativeDates);
                return (
                  <article key={item.pendingId} className="sw-term-visit">
                    <div className="sw-term-visit__head">
                      <strong>방문 {item.visitIndex}</strong>
                      {visit?.type ? <span>{visit.type}</span> : null}
                      {dateLabel ? <span>{dateLabel}</span> : null}
                    </div>
                    <p className="sw-term-visit__sentence">해당 문장: {highlight(item.sourceText, selected.surface)}</p>
                    <pre className="sw-term-visit__text">{highlight(visit?.soapText || item.sourceText, selected.surface)}</pre>
                  </article>
                );
              })}
            </section>

            <section className="sw-term-decide" aria-label="용어 선택">
              <ul className="sw-term-list">
                {groups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={`sw-term-list__item${group.key === selected.key ? ' is-selected' : ''}`}
                      disabled={busy}
                      onClick={() => {
                        setSelectedKey(group.key);
                        setCustomTerm('');
                        setMessage(null);
                      }}
                    >
                      <span className="sw-term-list__surface">{group.surface}</span>
                      <span className="sw-term-list__meta">
                        {group.candidates[0]?.standardTerm ? `→ ${group.candidates[0].standardTerm}?` : '후보 없음'} · 방문{' '}
                        {group.items.map((item) => item.visitIndex).join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="sw-term-decide__card">
                <h3>‘{selected.surface}’ 은(는) 어떤 뜻인가요?</h3>
                <p className="sw-term-decide__hint">
                  고른 용어는 방문 {selected.items.map((item) => item.visitIndex).join(', ')}의 같은 표현에 모두 적용됩니다.
                </p>
                {selected.candidates.length > 0 ? (
                  <div className="sw-term-decide__chips">
                    {selected.candidates.map((candidate) => (
                      <button
                        key={candidate.termId}
                        type="button"
                        disabled={busy}
                        onClick={() => void applyToGroup(selected, { confirmedTerm: candidate.standardTerm })}
                      >
                        {candidate.standardTerm}
                        <small>{Math.round(candidate.confidence * 100)}%</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="sw-term-decide__custom">
                  <input
                    type="text"
                    value={customTerm}
                    disabled={busy}
                    onChange={(event) => setCustomTerm(event.target.value)}
                    placeholder="다른 용어로 쓰려면 직접 입력"
                  />
                  <button
                    type="button"
                    disabled={busy || !customTerm.trim()}
                    onClick={() => void applyToGroup(selected, { keepOriginal: true, customReplacement: customTerm.trim() })}
                  >
                    이 용어로
                  </button>
                </div>
                <button
                  type="button"
                  className="sw-term-decide__keep"
                  disabled={busy}
                  onClick={() => void applyToGroup(selected, { keepOriginal: true })}
                >
                  원문대로 둔다
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
