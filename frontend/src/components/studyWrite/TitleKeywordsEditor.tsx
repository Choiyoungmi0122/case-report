import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { renderClinicalAnonymizedText } from '../../utils/publicationRenderer';
import { composeTitleDraft, parseTitleDraft, splitKeywords, TitlePart } from '../../utils/titleKeywords';
import './TitleKeywordsEditor.css';

/**
 * 제목 섹션: 제목과 핵심 단어를 따로 보여 주고, 각각 ↻(AI 가 다시 만들기)와 ✎(직접 고치기)를 단다.
 * 다시 만들기는 그 줄만 바뀌고 다른 줄은 글자 그대로다(서버가 보장, routes/studyWrite.ts revise 의 regeneratePart).
 */
export default function TitleKeywordsEditor(props: {
  text: string;
  /** 제출 뒤 등 고칠 수 없을 때 */
  readOnly?: boolean;
  /** 다른 작업 중이라 버튼을 막을 때 */
  disabled?: boolean;
  onRegenerate: (part: TitlePart) => Promise<void>;
  onSave: (nextText: string) => Promise<void>;
}) {
  const { text, readOnly, disabled, onRegenerate, onSave } = props;
  const parsed = parseTitleDraft(text);
  const [editing, setEditing] = useState<TitlePart | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [keywordsDraft, setKeywordsDraft] = useState('');
  const [busy, setBusy] = useState<{ part: TitlePart; kind: 'regenerate' | 'save' } | null>(null);

  // 다른 곳에서 초안이 바뀌면 편집을 닫는다
  useEffect(() => {
    setEditing(null);
  }, [text]);

  const blocked = Boolean(disabled || busy);

  const startEdit = (part: TitlePart) => {
    setTitleDraft(parsed.title);
    setKeywordsDraft(parsed.keywords.join(', '));
    setEditing(part);
  };

  const regenerate = async (part: TitlePart) => {
    setBusy({ part, kind: 'regenerate' });
    try {
      await onRegenerate(part);
    } finally {
      setBusy(null);
    }
  };

  const save = async (part: TitlePart) => {
    const next =
      part === 'title'
        ? composeTitleDraft(parsed, { title: titleDraft })
        : composeTitleDraft(parsed, { keywords: splitKeywords(keywordsDraft) });
    if (next === text.trim()) {
      setEditing(null);
      return;
    }
    setBusy({ part, kind: 'save' });
    try {
      await onSave(next);
      setEditing(null);
    } finally {
      setBusy(null);
    }
  };

  const onKey = (part: TitlePart) => (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape') setEditing(null);
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save(part);
    }
  };

  const editedKeywords = splitKeywords(keywordsDraft);
  const keywordWarnings = [
    editedKeywords.length < 2 || editedKeywords.length > 5 ? `지금 ${editedKeywords.length}개 (CARE 권장 2~5개)` : '',
    editedKeywords.length > 0 && !editedKeywords.some((item) => /증례\s*보고|case\s*report/i.test(item)) ? '"증례보고"가 없습니다' : ''
  ].filter(Boolean);

  const tools = (part: TitlePart, label: string) =>
    readOnly ? null : (
      <div className="sw-title-editor__tools">
        <button
          type="button"
          className="sw-title-editor__icon"
          title={`${label} 다시 만들기 (AI)`}
          aria-label={`${label} 다시 만들기`}
          disabled={blocked || editing !== null}
          onClick={() => void regenerate(part)}
        >
          <span className={busy?.part === part && busy.kind === 'regenerate' ? 'is-spinning' : ''}>↻</span>
        </button>
        <button
          type="button"
          className="sw-title-editor__icon"
          title={`${label} 직접 고치기`}
          aria-label={`${label} 직접 고치기`}
          disabled={blocked || editing !== null}
          onClick={() => startEdit(part)}
        >
          ✎
        </button>
      </div>
    );

  const editButtons = (part: TitlePart, canSave: boolean) => (
    <div className="sw-title-editor__edit-actions">
      <button type="button" disabled={blocked || !canSave} onClick={() => void save(part)}>
        {busy?.part === part && busy.kind === 'save' ? '저장 중…' : '저장'}
      </button>
      <button type="button" className="is-secondary" disabled={blocked} onClick={() => setEditing(null)}>
        취소
      </button>
    </div>
  );

  return (
    <div className="sw-title-editor">
      <div className="sw-title-editor__row">
        <div className="sw-title-editor__head">
          <span>제목</span>
          {tools('title', '제목')}
        </div>
        {editing === 'title' ? (
          <>
            <textarea
              value={titleDraft}
              autoFocus
              rows={2}
              spellCheck={false}
              disabled={blocked}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={onKey('title')}
            />
            <small className="sw-title-editor__hint">Enter 저장 · Esc 취소</small>
            {editButtons('title', Boolean(titleDraft.trim()))}
          </>
        ) : (
          <p className={`sw-title-editor__title${busy?.part === 'title' ? ' is-busy' : ''}`}>
            {busy?.part === 'title' && busy.kind === 'regenerate'
              ? '제목을 다시 만드는 중…'
              : parsed.title
                ? renderClinicalAnonymizedText(parsed.title)
                : '(제목 없음)'}
          </p>
        )}
      </div>

      <div className="sw-title-editor__row">
        <div className="sw-title-editor__head">
          <span>핵심 단어</span>
          {tools('keywords', '핵심 단어')}
        </div>
        {editing === 'keywords' ? (
          <>
            <input
              value={keywordsDraft}
              autoFocus
              spellCheck={false}
              placeholder="쉼표로 나눠 적어 주세요 (예: 증례보고, 발작성 심방세동, 황련온담탕)"
              disabled={blocked}
              onChange={(event) => setKeywordsDraft(event.target.value)}
              onKeyDown={onKey('keywords')}
            />
            <small className="sw-title-editor__hint">
              쉼표로 나눕니다 · Enter 저장 · Esc 취소
              {keywordWarnings.length > 0 ? <b> · {keywordWarnings.join(' · ')}</b> : null}
            </small>
            {editButtons('keywords', editedKeywords.length > 0)}
          </>
        ) : busy?.part === 'keywords' && busy.kind === 'regenerate' ? (
          <p className="sw-title-editor__title is-busy">핵심 단어를 다시 고르는 중…</p>
        ) : parsed.keywords.length > 0 ? (
          <ul className="sw-title-editor__chips">
            {parsed.keywords.map((keyword, index) => (
              <li key={`${keyword}-${index}`}>{renderClinicalAnonymizedText(keyword)}</li>
            ))}
          </ul>
        ) : (
          <p className="sw-title-editor__title is-empty">(핵심 단어 없음)</p>
        )}
      </div>
    </div>
  );
}
