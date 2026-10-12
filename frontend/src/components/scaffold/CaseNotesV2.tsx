import { useMemo, useState } from 'react';
import type { ScaffoldMemoSuggestion, ScaffoldV2CaseNote, ScaffoldV2CaseNoteType, Visit } from '../../services/api';

/**
 * Scaffold V2 1단계 "내 증례 메모" 패널 (V2-04).
 *
 * V1 패널과 다른 점:
 *  - 메모마다 방문 회차(visitIndex)와 CARE 세부 항목(careItems)을 붙일 수 있다. 회차는 사용자가
 *    고르거나 방문 카드의 "이 회차에 메모"로 지정한다. 자동으로 추정해 채우지 않는다(미지정 허용).
 *  - 직접 쓴 메모(origin 'own')와 AI 추천에서 가져온 메모('ai_suggestion')를 배지로 구분한다.
 *  - 회차·분류·출처 필터와 작성순·회차순 정렬. 필터·정렬 상태는 저장하지 않는다.
 *  - "원문 보기"로 해당 회차(와 AI 추천이 가리키는 구절)로 이동한다.
 */

export const CASE_NOTE_CARE_OPTIONS: Array<{ code: string; label: string; hint: string }> = [
  { code: '9a', label: '치료 종류', hint: '어떤 치료를 했는가 (한약, 침, 약침, 상담, 다른 병원 약 등)' },
  { code: '9b', label: '용량·기간·빈도', hint: '얼마나, 얼마 동안, 얼마나 자주 했는가' },
  { code: '9c', label: '치료 변경·이유', hint: '무엇을 바꾸거나 멈췄고 왜 그랬는가' }
];

export type CaseNoteDraft = {
  type: ScaffoldV2CaseNoteType;
  text: string;
  /** 1부터 시작. undefined는 미지정. */
  visitIndex?: number;
  careItems: string[];
};

export const EMPTY_CASE_NOTE_DRAFT: CaseNoteDraft = { type: 'observation', text: '', careItems: [] };

type VisitFilter = 'all' | 'none' | number;
type CareFilter = 'all' | 'none' | string;
type OriginFilter = 'all' | 'own' | 'ai_suggestion';
type SortMode = 'created' | 'visit';

const AI_NOTE_PREFIX = 'case-note-ai-';

/** V1 메모(필드 없음)도 함께 다루기 위해 출처는 필드 → id 접두어 순으로 본다. */
export function getCaseNoteOrigin(note: ScaffoldV2CaseNote): 'own' | 'ai_suggestion' {
  if (note.origin) return note.origin;
  return note.id.startsWith(AI_NOTE_PREFIX) ? 'ai_suggestion' : 'own';
}

/**
 * 메모 분류 (2026-10-12 "문헌 확인 필요" 추가). 문헌 확인 필요는 이 환자 기록이 아니라 선행연구·다른 증례보고를
 * 찾아봐야 할 것이다. 치료 개입 실습에는 쓰지 않고, 나중에 서론·고찰을 쓸 때 쓴다.
 */
export const CASE_NOTE_TYPE_OPTIONS: Array<{
  type: ScaffoldV2CaseNoteType;
  label: string;
  hint: string;
  prompt: string;
  placeholder: string;
}> = [
  {
    type: 'observation',
    label: '눈에 띈 점',
    hint: '기록을 읽으며 알아차린 것',
    prompt: '어떤 점이 눈에 띄었나요?',
    placeholder: '예: 한약 용량과 복용 기간이 처방란에 적혀 있다.'
  },
  {
    type: 'question',
    label: '더 확인할 점',
    hint: '환자·보호자, 약봉투, 다른 병원 기록 등으로 더 확인해야 할 것',
    prompt: '무엇을 더 확인하고 싶나요?',
    placeholder: '예: 첫 한약을 다 먹은 뒤 다음 처방 전까지 복용했는지 확인하고 싶다.'
  },
  {
    type: 'literature',
    label: '문헌 확인 필요',
    hint: '선행연구나 다른 증례보고를 찾아봐야 할 것 (나중에 서론·고찰에 씁니다)',
    prompt: '어떤 문헌을 찾아보고 싶나요?',
    placeholder: '예: 같은 처방을 화병에 쓴 다른 한의 증례보고가 있는지 찾아보고 싶다.'
  }
];

export function getCaseNoteTypeLabel(type: ScaffoldV2CaseNoteType | string | undefined) {
  return CASE_NOTE_TYPE_OPTIONS.find((option) => option.type === type)?.label || '눈에 띈 점';
}

type CaseNotesV2Props = {
  notes: ScaffoldV2CaseNote[];
  visits: Visit[];
  suggestions: ScaffoldMemoSuggestion[];
  draft: CaseNoteDraft;
  onDraftChange: (next: CaseNoteDraft) => void;
  onAdd: () => void;
  onUpdate: (noteId: string, updates: Partial<ScaffoldV2CaseNote>, saveNow: boolean) => void;
  onRemove: (noteId: string) => void;
  onShowSource: (visitIndex: number, anchorQuote?: string | null) => void;
  saving: boolean;
  readOnly?: boolean;
};

export default function CaseNotesV2({
  notes,
  visits,
  suggestions,
  draft,
  onDraftChange,
  onAdd,
  onUpdate,
  onRemove,
  onShowSource,
  saving,
  readOnly = false
}: CaseNotesV2Props) {
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('all');
  const [careFilter, setCareFilter] = useState<CareFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('created');

  const suggestionById = useMemo(() => new Map(suggestions.map((item) => [item.id, item])), [suggestions]);
  const draftTypeOption = CASE_NOTE_TYPE_OPTIONS.find((option) => option.type === draft.type) || CASE_NOTE_TYPE_OPTIONS[0];

  const visible = useMemo(() => {
    const filtered = notes.filter((note) => {
      if (visitFilter === 'none' && note.visitIndex) return false;
      if (typeof visitFilter === 'number' && note.visitIndex !== visitFilter) return false;
      const careItems = note.careItems || [];
      if (careFilter === 'none' && careItems.length > 0) return false;
      if (careFilter !== 'all' && careFilter !== 'none' && !careItems.includes(careFilter)) return false;
      if (originFilter !== 'all' && getCaseNoteOrigin(note) !== originFilter) return false;
      return true;
    });
    if (sortMode === 'visit') {
      return [...filtered].sort((a, b) => {
        const av = a.visitIndex ?? Number.MAX_SAFE_INTEGER;
        const bv = b.visitIndex ?? Number.MAX_SAFE_INTEGER;
        if (av !== bv) return av - bv;
        return a.createdAt.localeCompare(b.createdAt);
      });
    }
    return filtered;
  }, [notes, visitFilter, careFilter, originFilter, sortMode]);

  const isFiltered = visitFilter !== 'all' || careFilter !== 'all' || originFilter !== 'all';
  const toggleDraftCare = (code: string) =>
    onDraftChange({
      ...draft,
      careItems: draft.careItems.includes(code) ? draft.careItems.filter((item) => item !== code) : [...draft.careItems, code]
    });

  const toggleNoteCare = (note: ScaffoldV2CaseNote, code: string) => {
    const current = note.careItems || [];
    const next = current.includes(code) ? current.filter((item) => item !== code) : [...current, code];
    onUpdate(note.id, { careItems: next, updatedAt: new Date().toISOString() }, true);
  };

  return (
    <>
      {!readOnly ? (
        <form
          className="scaffold-v2__memo-composer scaffold-v2__memo-composer--v2"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd();
          }}
        >
          <div className="scaffold-v2__memo-types" role="group" aria-label="메모 종류">
            {CASE_NOTE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                className={draft.type === option.type ? 'is-active' : ''}
                // 문헌 확인 필요는 치료 개입 세부 항목(9a~9c)과 관계없어 고른 항목을 비운다
                onClick={() => onDraftChange({ ...draft, type: option.type, careItems: option.type === 'literature' ? [] : draft.careItems })}
                title={option.hint}
                aria-pressed={draft.type === option.type}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="scaffold-v2__memo-type-hint">{draftTypeOption.hint}</p>
          <label>
            <span>{draftTypeOption.prompt}</span>
            <textarea
              rows={4}
              value={draft.text}
              onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
              placeholder={draftTypeOption.placeholder}
            />
          </label>
          <div className="scaffold-v2__memo-meta-row">
            <label className="scaffold-v2__memo-visit-select">
              <span>어느 회차 기록인가요?</span>
              <select
                value={draft.visitIndex ?? ''}
                onChange={(event) =>
                  onDraftChange({ ...draft, visitIndex: event.target.value ? Number(event.target.value) : undefined })
                }
              >
                <option value="">미지정</option>
                {visits.map((visit, index) => (
                  <option key={`${visit.date}-${index}`} value={index + 1}>
                    {index + 1}회차
                  </option>
                ))}
              </select>
            </label>
            {draft.type !== 'literature' ? (
            <div className="scaffold-v2__memo-care" role="group" aria-label="CARE 세부 항목 (선택)">
              <span>관련 항목 (선택)</span>
              <div>
                {CASE_NOTE_CARE_OPTIONS.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={draft.careItems.includes(option.code) ? 'is-active' : ''}
                    onClick={() => toggleDraftCare(option.code)}
                    title={option.hint}
                  >
                    {option.code} {option.label}
                  </button>
                ))}
              </div>
            </div>
            ) : null}
          </div>
          <button type="submit" className="scaffold-v2__button is-primary" disabled={saving}>
            메모 추가
          </button>
        </form>
      ) : null}

      <div className="scaffold-v2__memo-filters" role="group" aria-label="메모 필터와 정렬">
        <label>
          <span>회차</span>
          <select
            value={visitFilter === 'all' || visitFilter === 'none' ? visitFilter : String(visitFilter)}
            onChange={(event) => {
              const value = event.target.value;
              setVisitFilter(value === 'all' || value === 'none' ? value : Number(value));
            }}
          >
            <option value="all">전체</option>
            {visits.map((visit, index) => (
              <option key={`${visit.date}-filter-${index}`} value={index + 1}>
                {index + 1}회차
              </option>
            ))}
            <option value="none">미지정</option>
          </select>
        </label>
        <label>
          <span>항목</span>
          <select value={careFilter} onChange={(event) => setCareFilter(event.target.value)}>
            <option value="all">전체</option>
            {CASE_NOTE_CARE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.code} {option.label}
              </option>
            ))}
            <option value="none">분류 없음</option>
          </select>
        </label>
        <label>
          <span>출처</span>
          <select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as OriginFilter)}>
            <option value="all">전체</option>
            <option value="own">직접 쓴 메모</option>
            <option value="ai_suggestion">AI 추천에서 가져옴</option>
          </select>
        </label>
        <label>
          <span>정렬</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="created">작성순</option>
            <option value="visit">회차순</option>
          </select>
        </label>
        {isFiltered ? (
          <button
            type="button"
            className="scaffold-v2__link-button"
            onClick={() => {
              setVisitFilter('all');
              setCareFilter('all');
              setOriginFilter('all');
            }}
          >
            필터 해제
          </button>
        ) : null}
      </div>

      <div className="scaffold-v2__memo-list scaffold-v2__memo-list--v2">
        {visible.map((note) => {
          const origin = getCaseNoteOrigin(note);
          const suggestion = note.suggestionId ? suggestionById.get(note.suggestionId) : undefined;
          const anchorQuote = suggestion?.recordAnchor || null;
          const noteNumber = notes.indexOf(note) + 1;
          return (
            <article key={note.id} className={`scaffold-v2__memo-item scaffold-v2__memo-item--v2 is-${origin}`}>
              <div className="scaffold-v2__memo-item-head">
                <div className="scaffold-v2__memo-badges">
                  <span className="scaffold-v2__memo-badge is-type">{getCaseNoteTypeLabel(note.type)}</span>
                  <span className={`scaffold-v2__memo-badge is-origin ${origin === 'ai_suggestion' ? 'is-ai' : 'is-own'}`}>
                    {origin === 'ai_suggestion' ? 'AI 추천에서 가져옴' : '직접 쓴 메모'}
                  </span>
                  {note.visitIndex ? (
                    <button
                      type="button"
                      className="scaffold-v2__memo-badge is-visit is-link"
                      onClick={() => onShowSource(note.visitIndex! - 1, anchorQuote)}
                      title="이 회차 기록으로 이동"
                    >
                      {note.visitIndex}회차 · 원문 보기
                    </button>
                  ) : (
                    <span className="scaffold-v2__memo-badge is-visit is-muted">회차 미지정</span>
                  )}
                </div>
                {!readOnly ? (
                  <button type="button" className="scaffold-v2__remove" title="메모 삭제" aria-label={`메모 ${noteNumber} 삭제`} onClick={() => onRemove(note.id)}>
                    ×
                  </button>
                ) : null}
              </div>
              <textarea
                rows={3}
                value={note.text}
                readOnly={readOnly}
                onChange={(event) => onUpdate(note.id, { text: event.target.value, updatedAt: new Date().toISOString() }, false)}
                aria-label={`메모 ${noteNumber} 내용`}
              />
              <div className="scaffold-v2__memo-item-meta">
                <label>
                  <span>회차</span>
                  <select
                    value={note.visitIndex ?? ''}
                    disabled={readOnly}
                    onChange={(event) =>
                      onUpdate(
                        note.id,
                        { visitIndex: event.target.value ? Number(event.target.value) : undefined, updatedAt: new Date().toISOString() },
                        true
                      )
                    }
                  >
                    <option value="">미지정</option>
                    {visits.map((visit, index) => (
                      <option key={`${visit.date}-note-${index}`} value={index + 1}>
                        {index + 1}회차
                      </option>
                    ))}
                  </select>
                </label>
                {note.type !== 'literature' ? (
                <div className="scaffold-v2__memo-care is-inline" role="group" aria-label="관련 항목">
                  {CASE_NOTE_CARE_OPTIONS.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      className={(note.careItems || []).includes(option.code) ? 'is-active' : ''}
                      disabled={readOnly}
                      onClick={() => toggleNoteCare(note, option.code)}
                      title={option.hint}
                    >
                      {option.code}
                    </button>
                  ))}
                </div>
                ) : null}
              </div>
            </article>
          );
        })}
        {notes.length === 0 ? (
          <div className="scaffold-v2__empty">아직 메모가 없습니다. 기록에서 먼저 눈에 띈 한 가지를 적어보세요.</div>
        ) : visible.length === 0 ? (
          <div className="scaffold-v2__empty">조건에 맞는 메모가 없습니다. 필터를 바꾸거나 해제해 보세요.</div>
        ) : null}
      </div>
    </>
  );
}
