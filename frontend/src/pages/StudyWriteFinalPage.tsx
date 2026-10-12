import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, StudyWriteDraftsResponse, StudyWriteSection } from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import TimelineTable, { parseTimelineRows } from '../components/studyWrite/TimelineTable';
import { careCompliance, complianceLevel, uncheckedSuffix } from '../utils/studyWriteCare';
import { convertRelativeDates } from '../utils/relativeDates';
import DateAnchorBar from '../components/studyWrite/DateAnchorBar';
import ManuscriptCheckPanel from '../components/studyWrite/ManuscriptCheckPanel';
import RecordViewer from '../components/studyWrite/RecordViewer';
import TitleKeywordsEditor from '../components/studyWrite/TitleKeywordsEditor';
import { parseTitleDraft } from '../utils/titleKeywords';
import './StudyWriteFinalPage.css';

/**
 * 실험용 Write ⑦ 최종 수정 → ⑧ Word.
 * 전체 글을 섹션 순서대로 한 화면에서 직접 고친다. 들어오면 질의응답 답은 잠긴다.
 * 칸에서 나올 때 저장한다. "최종 제출"을 누르면 더 고칠 수 없고, Word 로 내려받는다.
 */

const RECORD_PINNED_KEY = 'swFinalRecordPinned';

export default function StudyWriteFinalPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudyWriteDraftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 원고 검사 (코드 검사)
  const [checkOpen, setCheckOpen] = useState(false);
  // 원문 EMR 보기. "유지하기"를 누르면 왼쪽 칸에 계속 띄운다 (이 브라우저에만 기억)
  const [recordPinned, setRecordPinned] = useState(() => {
    try {
      return window.localStorage.getItem(RECORD_PINNED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [recordOpen, setRecordOpen] = useState(recordPinned);
  const changeRecordPinned = (next: boolean) => {
    setRecordPinned(next);
    try {
      if (next) window.localStorage.setItem(RECORD_PINNED_KEY, '1');
      else window.localStorage.removeItem(RECORD_PINNED_KEY);
    } catch {
      // 저장하지 못해도 이 화면에서는 그대로 유지된다
    }
  };
  const locked = useRef(false);

  useEffect(() => {
    if (!caseId) return;
    (async () => {
      try {
        // 들어오면 답 수정을 잠근다 (이미 잠겼으면 그대로).
        const next = locked.current ? await caseApi.getStudyWriteDrafts(caseId) : await caseApi.lockStudyWriteAnswers(caseId);
        locked.current = true;
        setData(next);
        setTexts(Object.fromEntries(next.sections.map((section) => [section.sectionId, section.draftText])));
      } catch (nextError: any) {
        setError(nextError?.response?.data?.error || nextError?.message || '불러오지 못했습니다.');
      }
    })();
  }, [caseId]);

  const submitted = Boolean(data?.submittedAt);

  const save = async (section: StudyWriteSection) => {
    if (!caseId || submitted) return;
    const text = texts[section.sectionId] ?? '';
    if (text === section.draftText) return;
    setSavingId(section.sectionId);
    try {
      const next = await caseApi.saveStudyWriteSectionDraft(caseId, section.sectionId, text);
      setData(next);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  const submit = async () => {
    if (!caseId || !data) return;
    const changed = data.sections.filter((section) => (texts[section.sectionId] ?? '') !== section.draftText);
    if (!window.confirm('최종 제출하면 더 고칠 수 없습니다. 제출할까요?')) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const section of changed) {
        await caseApi.saveStudyWriteSectionDraft(caseId, section.sectionId, texts[section.sectionId] ?? '');
      }
      setData(await caseApi.submitStudyWrite(caseId));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '제출하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasPlaceholders = data?.sections.some((section) => /\[[A-Z][A-Z_]*_\d+\]/.test(texts[section.sectionId] ?? ''));

  // 첫 기록일을 넣었으면 미리보기와 Word 에 실제 날짜로 나온다. 편집 칸은 원래 표기
  const anchor = data?.dateAnchor || null;
  const dated = (text: string) => (anchor ? convertRelativeDates(text, anchor).text : text);

  /** 편집 칸의 본문 자체를 날짜 표기로 바꿔 저장한다 */
  const applyDatesToText = async () => {
    if (!caseId || !data || !anchor || submitted) return;
    const changed = data.sections
      .map((section) => ({ section, next: convertRelativeDates(texts[section.sectionId] ?? '', anchor).text }))
      .filter(({ section, next }) => next !== (texts[section.sectionId] ?? ''));
    if (changed.length === 0) {
      window.alert('바꿀 "첫 기록일 +N일" 표기가 없습니다.');
      return;
    }
    if (!window.confirm(`${changed.length}개 섹션의 "첫 기록일 +N일" 표기를 날짜로 바꿔 저장합니다. 계속할까요?`)) return;
    setError(null);
    try {
      let latest = data;
      for (const { section, next } of changed) {
        setSavingId(section.sectionId);
        latest = await caseApi.saveStudyWriteSectionDraft(caseId, section.sectionId, next);
      }
      setData(latest);
      setTexts(Object.fromEntries(latest.sections.map((section) => [section.sectionId, section.draftText])));
      setSavedAt(new Date().toLocaleTimeString());
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className={`sw-final-shell${recordPinned && recordOpen ? ' is-record-pinned' : ''}`}>
      {caseId ? (
        <RecordViewer
          caseId={caseId}
          isOpen={recordOpen}
          onClose={() => {
            setRecordOpen(false);
            changeRecordPinned(false);
          }}
          relativeDates={Boolean(data?.relativeDates)}
          formatDate={dated}
          pinned={recordPinned}
          onPinnedChange={changeRecordPinned}
        />
      ) : null}
      <div className="sw-final">
        <header className="sw-final__header">
          <div>
            <p className="sw-final__eyebrow">실험용 Write · 최종 수정</p>
            <h1>{submitted ? '제출된 원고' : '전체 글을 직접 고칩니다'}</h1>
            <p className="sw-final__lead">
              {submitted
                ? '제출이 끝났습니다. 아래에서 Word 파일을 내려받을 수 있습니다.'
                : '칸을 벗어나면 저장됩니다. 이 단계에서는 질의응답의 답을 더 고칠 수 없습니다. 섹션별 AI 수정이 더 필요하면 "초안 화면으로"로 돌아갈 수 있습니다.'}
            </p>
          </div>
          <div className="sw-final__actions">
            {data?.experimentCode ? <span className="sw-final__badge">실험번호 {data.experimentCode}</span> : null}
            {savedAt && !submitted ? <span className="sw-final__badge">저장됨 {savedAt}</span> : null}
            {!submitted ? (
              <button type="button" className="is-secondary" onClick={() => navigate(`/study/write/cases/${caseId}/draft`)}>
                초안 화면으로
              </button>
            ) : null}
            <button type="button" className="is-secondary" onClick={() => setRecordOpen(true)}>
              원문 EMR 보기
            </button>
            <button type="button" className="is-secondary" disabled={!data} onClick={() => setCheckOpen(true)}>
              원고 검사
            </button>
            {caseId ? (
              <a className="sw-final__download" href={caseApi.studyWriteManuscriptUrl(caseId)}>
                Word로 내려받기
              </a>
            ) : null}
            {!submitted ? (
              <button type="button" disabled={submitting || !data} onClick={() => void submit()}>
                {submitting ? '제출 중…' : '최종 제출'}
              </button>
            ) : null}
          </div>
        </header>

        {error ? <div className="sw-final__error">{error}</div> : null}
        {caseId ? (
          <ManuscriptCheckPanel
            caseId={caseId}
            isOpen={checkOpen}
            onClose={() => setCheckOpen(false)}
            formatText={dated}
            onGoToSection={(sectionId) => {
              setCheckOpen(false);
              document.getElementById(`sw-final-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />
        ) : null}
        {data && caseId ? (
          <DateAnchorBar caseId={caseId} data={data} onChange={setData} onApplyToText={submitted ? undefined : () => void applyDatesToText()} />
        ) : null}
        {hasPlaceholders && !submitted ? (
          <div className="sw-final__notice">
            본문에 비식별 표기([PATIENT_NAME_1] 등)가 남아 있습니다. Word 에서는 "환자", "타 의료기관"처럼 바뀌어 나갑니다. 다른 말로 바꾸고 싶으면 여기서 고치면 됩니다.
          </div>
        ) : null}

        <div className="sw-final__body">
          {data?.sections.map((section) => (
            <section key={section.sectionId} id={`sw-final-${section.sectionId}`} className="sw-final__section">
              <div className="sw-final__section-head">
                <h2>{section.name}</h2>
                <span>
                  {(() => {
                    const c = careCompliance(section);
                    return c ? (
                      <i className={`sw-final__pct is-${complianceLevel(c)}`} title={`CARE 세부 항목 ${c.ok}/${c.total} 충족 · 필수 ${c.requiredOk}/${c.requiredTotal}${uncheckedSuffix(c)}`}>
                        CARE {c.pct}%
                      </i>
                    ) : null;
                  })()}
                  버전 {section.version}
                  {savingId === section.sectionId ? ' · 저장 중…' : ''}
                </span>
              </div>
              {section.sectionId === 'TITLE' && parseTitleDraft(texts.TITLE ?? section.draftText).titleIndex >= 0 ? (
                // 제목·핵심 단어는 따로: ↻ 다시 만들기, ✎ 직접 고치기 (제출 뒤에는 보기만)
                <TitleKeywordsEditor
                  text={texts.TITLE ?? section.draftText}
                  history={section.history}
                  readOnly={submitted}
                  disabled={submitting || savingId !== null}
                  onRegenerate={async (part) => {
                    if (!caseId) return;
                    setError(null);
                    try {
                      const next = await caseApi.regenerateStudyWriteTitlePart(caseId, part);
                      setData(next);
                      const title = next.sections.find((item) => item.sectionId === 'TITLE');
                      if (title) setTexts((prev) => ({ ...prev, TITLE: title.draftText }));
                    } catch (nextError: any) {
                      setError(nextError?.response?.data?.error || nextError?.message || '다시 만들지 못했습니다.');
                    }
                  }}
                  onSave={async (nextText) => {
                    if (!caseId) return;
                    setError(null);
                    setSavingId('TITLE');
                    try {
                      const next = await caseApi.saveStudyWriteSectionDraft(caseId, 'TITLE', nextText, { recheckCare: true });
                      setData(next);
                      setTexts((prev) => ({ ...prev, TITLE: nextText }));
                      setSavedAt(new Date().toLocaleTimeString());
                    } catch (nextError: any) {
                      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
                      throw nextError;
                    } finally {
                      setSavingId(null);
                    }
                  }}
                />
              ) : submitted ? (
                section.sectionId === 'TIMELINE' && parseTimelineRows(section.draftText) ? (
                  <TimelineTable text={dated(section.draftText)} />
                ) : (
                  <div className="sw-final__text">{renderClinicalAnonymizedText(dated(section.draftText)) || '(내용 없음)'}</div>
                )
              ) : (
                <>
                  {/* 타임라인: 표 미리보기를 위에, 그 아래에 표의 원본 글 */}
                  {section.sectionId === 'TIMELINE' && parseTimelineRows(texts[section.sectionId] ?? '') ? (
                    <div className="sw-final__timeline-preview">
                      <p>표 미리보기 (Word 에서도 이 표로 나갑니다)</p>
                      <TimelineTable text={dated(texts[section.sectionId] ?? '')} />
                    </div>
                  ) : null}
                  {section.sectionId === 'TIMELINE' ? (
                    <p className="sw-final__source-label">표의 원본 (한 줄 = 한 행, 칸은 "|"로 나눔: 날짜 | 경과 요약 | 진단 검사 | 치료 개입). 여기서 고치면 위 표가 바뀝니다.</p>
                  ) : null}
                  <textarea
                    value={texts[section.sectionId] ?? ''}
                    onChange={(event) => setTexts((prev) => ({ ...prev, [section.sectionId]: event.target.value }))}
                    onBlur={() => void save(section)}
                    rows={Math.max(4, Math.min(18, Math.ceil((texts[section.sectionId] ?? '').length / 70) + 2))}
                    spellCheck={false}
                  />
                </>
              )}
              {section.attachments.length > 0 ? (
                <ul className="sw-final__attachments">
                  {section.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      {attachment.kind === 'table' ? '표' : '그림'}: {attachment.caption || attachment.fileName}
                      {attachment.kind === 'image' && caseId ? (
                        <img src={caseApi.studyWriteAttachmentFileUrl(caseId, attachment.id)} alt={attachment.caption || attachment.fileName} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
