import { useEffect, useState } from 'react';
import { caseApi, StudyWriteDraftsResponse } from '../../services/api';
import { hasRelativeDates, parseAnchorDate } from '../../utils/relativeDates';
import './DateAnchorBar.css';

/**
 * 첫 기록일 입력 막대. 넣으면 화면과 Word 에서 "첫 기록일 +N일"이 실제 날짜로 나온다.
 * 저장된 초안은 그대로라 바꾸거나 지우면 바로 원래대로 돌아간다.
 */
export default function DateAnchorBar({
  caseId,
  data,
  onChange,
  onApplyToText
}: {
  caseId: string;
  data: StudyWriteDraftsResponse;
  onChange: (next: StudyWriteDraftsResponse) => void;
  /** 최종 화면 전용: 편집 칸의 본문 자체를 날짜로 바꿔 넣는다 */
  onApplyToText?: () => void;
}) {
  const anchor = data.dateAnchor || null;
  const [editing, setEditing] = useState(!anchor);
  const [date, setDate] = useState(anchor?.date || '');
  const [format, setFormat] = useState<'iso' | 'ko'>(anchor?.format || 'iso');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(!data.dateAnchor);
    setDate(data.dateAnchor?.date || '');
    setFormat(data.dateAnchor?.format || 'iso');
  }, [data.dateAnchor?.date, data.dateAnchor?.format]);

  const relevant = data.relativeDates || Boolean(anchor) || data.sections.some((section) => hasRelativeDates(section.draftText));
  if (!relevant) return null;

  const save = async (nextDate: string | null) => {
    if (nextDate !== null && parseAnchorDate(nextDate) === null) {
      setError('날짜를 골라 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await caseApi.setStudyWriteDateAnchor(caseId, nextDate, format));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const preview = (offset: number) => {
    const ms = parseAnchorDate(date);
    if (ms === null) return '';
    const d = new Date(ms + offset * 86400000);
    return format === 'ko'
      ? `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  return (
    <div className={`sw-date-anchor${anchor && !editing ? ' is-set' : ''}`}>
      {anchor && !editing ? (
        <>
          <span>
            <strong>첫 기록일 {anchor.date}</strong> 기준으로 "첫 기록일 +N일"을 실제 날짜로 보여 주는 중입니다. Word에도 날짜로 나갑니다.
            {onApplyToText ? ' 편집 칸에는 원래 표기가 보입니다.' : ''}
          </span>
          <div>
            {onApplyToText ? (
              <button type="button" className="is-secondary" disabled={busy} onClick={onApplyToText} title="편집 칸의 본문 자체를 날짜 표기로 바꿔 저장합니다">
                본문에 날짜로 바꿔 넣기
              </button>
            ) : null}
            <button type="button" className="is-secondary" disabled={busy} onClick={() => setEditing(true)}>
              바꾸기
            </button>
            <button type="button" className="is-secondary" disabled={busy} onClick={() => void save(null)}>
              해제
            </button>
          </div>
        </>
      ) : (
        <>
          <span>
            이 기록은 날짜가 "첫 기록일 +N일"로 되어 있습니다. 첫 기록일을 넣으면 모든 섹션과 Word에 실제 날짜로 나옵니다.
            {date && parseAnchorDate(date) !== null ? ` 예: 첫 기록일 +18일 → ${preview(18)}` : ''}
          </span>
          <div>
            <input type="date" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} aria-label="첫 기록일" />
            <select value={format} disabled={busy} onChange={(event) => setFormat(event.target.value === 'ko' ? 'ko' : 'iso')} aria-label="날짜 형식">
              <option value="iso">2025-03-02</option>
              <option value="ko">2025년 3월 2일</option>
            </select>
            <button type="button" disabled={busy || !date} onClick={() => void save(date)}>
              {busy ? '저장 중…' : '적용'}
            </button>
            {anchor ? (
              <button type="button" className="is-secondary" disabled={busy} onClick={() => setEditing(false)}>
                취소
              </button>
            ) : null}
          </div>
        </>
      )}
      {error ? <p className="sw-date-anchor__error">{error}</p> : null}
    </div>
  );
}
