import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, StudyWriteDraftsResponse, StudyWriteSection } from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import './StudyWriteFinalPage.css';

/**
 * 실험용 Write ⑦ 최종 수정 → ⑧ Word.
 * 전체 글을 섹션 순서대로 한 화면에서 직접 고친다. 들어오면 질의응답 답은 잠긴다.
 * 칸에서 나올 때 저장한다. "최종 제출"을 누르면 더 고칠 수 없고, Word 로 내려받는다.
 */

export default function StudyWriteFinalPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudyWriteDraftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  return (
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
      {hasPlaceholders && !submitted ? (
        <div className="sw-final__notice">
          본문에 비식별 표기([PATIENT_NAME_1] 등)가 남아 있습니다. Word 에서는 "환자", "타 의료기관"처럼 바뀌어 나갑니다. 다른 말로 바꾸고 싶으면 여기서 고치면 됩니다.
        </div>
      ) : null}

      <div className="sw-final__body">
        {data?.sections.map((section) => (
          <section key={section.sectionId} className="sw-final__section">
            <div className="sw-final__section-head">
              <h2>{section.name}</h2>
              <span>
                버전 {section.version}
                {savingId === section.sectionId ? ' · 저장 중…' : ''}
              </span>
            </div>
            {submitted ? (
              <div className="sw-final__text">{renderClinicalAnonymizedText(section.draftText) || '(내용 없음)'}</div>
            ) : (
              <textarea
                value={texts[section.sectionId] ?? ''}
                onChange={(event) => setTexts((prev) => ({ ...prev, [section.sectionId]: event.target.value }))}
                onBlur={() => void save(section)}
                rows={Math.max(4, Math.min(18, Math.ceil((texts[section.sectionId] ?? '').length / 70) + 2))}
                spellCheck={false}
              />
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
  );
}
