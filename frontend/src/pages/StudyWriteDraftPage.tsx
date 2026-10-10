import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  caseApi,
  StudyWriteAttachment,
  StudyWriteCareItemStatus,
  StudyWriteDraftsResponse,
  StudyWriteQuestion,
  StudyWriteSection
} from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import './StudyWriteDraftPage.css';

/**
 * 실험용 Write ⑤ 전체 초안 생성 → ⑥ 섹션별 화면.
 * 왼쪽: 섹션 목록(빠진 필수 요소 수). 가운데: 초안과 표·그림. 오른쪽: 이 섹션의 채팅 수정,
 * CARE 점검, 내 답변(수정 가능).
 */

const POLL_MS = 3000;

const STATUS_LABEL: Record<StudyWriteCareItemStatus, string> = {
  present: '있음',
  in_record_not_in_draft: '기록에는 있음',
  not_in_record: '기록에 없음',
  not_applicable: '해당 없음'
};

function missingRequiredCount(section: StudyWriteSection) {
  return section.careCheck?.items.filter((item) => item.required && item.status !== 'present' && item.status !== 'not_applicable').length || 0;
}

export default function StudyWriteDraftPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudyWriteDraftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('TITLE');
  const [tab, setTab] = useState<'chat' | 'care' | 'answers'>('chat');
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [dirtySectionIds, setDirtySectionIds] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const kicked = useRef(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const generation = data?.generation;
  const running = generation?.status === 'running';
  const hasAnyDraft = Boolean(data?.sections.some((section) => section.draftText));
  const section = data?.sections.find((item) => item.sectionId === selectedId) || data?.sections[0];
  const questions = useMemo(() => data?.interview.rounds.flatMap((round) => round.questions) || [], [data]);

  const refresh = useCallback(async () => {
    if (!caseId) return null;
    const next = await caseApi.getStudyWriteDrafts(caseId);
    setData(next);
    return next;
  }, [caseId]);

  // 처음: 초안이 없으면 생성 시작
  useEffect(() => {
    if (!caseId) return;
    (async () => {
      try {
        const next = await caseApi.getStudyWriteDrafts(caseId);
        setData(next);
        const none = !next.sections.some((item) => item.draftText);
        if (none && next.generation.status !== 'running' && !kicked.current) {
          kicked.current = true;
          setData(await caseApi.generateStudyWriteDrafts(caseId));
        }
      } catch (nextError: any) {
        setError(nextError?.response?.data?.error || nextError?.message || '불러오지 못했습니다.');
      }
    })();
  }, [caseId]);

  // 생성 중이면 폴링
  useEffect(() => {
    if (!caseId || !running) return;
    const timer = window.setInterval(() => refresh().catch(() => undefined), POLL_MS);
    return () => window.clearInterval(timer);
  }, [caseId, running, refresh]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [section?.chat.length, revising]);

  const sendInstruction = async () => {
    if (!caseId || !section || revising) return;
    const text = instruction.trim();
    if (!text) return;
    setRevising(true);
    setError(null);
    try {
      setData(await caseApi.reviseStudyWriteSection(caseId, section.sectionId, text));
      setInstruction('');
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '고치지 못했습니다.');
    } finally {
      setRevising(false);
    }
  };

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !caseId || !section) return;
    setUploading(true);
    setError(null);
    try {
      await caseApi.uploadStudyWriteAttachment(caseId, section.sectionId, file, caption);
      setCaption('');
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '올리지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const saveCaption = async (attachment: StudyWriteAttachment, value: string) => {
    if (!caseId || value === attachment.caption) return;
    try {
      await caseApi.updateStudyWriteAttachmentCaption(caseId, attachment.id, value);
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '제목을 저장하지 못했습니다.');
    }
  };

  const removeAttachment = async (attachment: StudyWriteAttachment) => {
    if (!caseId || !window.confirm(`"${attachment.caption || attachment.fileName}"을(를) 지울까요?`)) return;
    try {
      await caseApi.deleteStudyWriteAttachment(caseId, attachment.id);
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '지우지 못했습니다.');
    }
  };

  const saveAnswer = async (question: StudyWriteQuestion) => {
    if (!caseId) return;
    const answer = answerDraft.trim();
    try {
      await caseApi.answerStudyWriteQuestion(caseId, { questionId: question.id, answer, skipped: !answer });
      setEditingAnswerId(null);
      setDirtySectionIds((prev) => Array.from(new Set([...prev, ...question.targetSectionIds])));
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '답을 저장하지 못했습니다.');
    }
  };

  const regenerateDirty = async () => {
    if (!caseId || dirtySectionIds.length === 0) return;
    setRegenerating(true);
    try {
      setData(await caseApi.generateStudyWriteDrafts(caseId, dirtySectionIds));
      setDirtySectionIds([]);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '다시 쓰지 못했습니다.');
    } finally {
      setRegenerating(false);
    }
  };

  const locked = Boolean(data?.answersLockedAt || data?.submittedAt);

  if (data && !hasAnyDraft) {
    const done = generation?.doneSectionIds.length || 0;
    const total = generation?.targetSectionIds.length || 12;
    return (
      <div className="sw-draft sw-draft--loading">
        <div>
          <p className="sw-draft__eyebrow">실험용 Write · 초안 생성</p>
          <h1>답한 내용을 바탕으로 초안을 쓰고 있습니다</h1>
          <p>섹션 {done} / {total} 완료. 보통 2~3분 걸립니다. 끝난 섹션부터 열립니다.</p>
          <div className="sw-draft__progress">
            <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          {generation?.status === 'failed' ? (
            <div className="sw-draft__error">
              초안을 만들지 못했습니다. {generation.lastError || ''}
              <button type="button" onClick={() => caseId && caseApi.generateStudyWriteDrafts(caseId).then(setData)}>
                다시 시도
              </button>
            </div>
          ) : null}
          {error ? <div className="sw-draft__error">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sw-draft">
      <header className="sw-draft__header">
        <div>
          <p className="sw-draft__eyebrow">실험용 Write · 초안</p>
          <h1>섹션별 초안</h1>
        </div>
        <div className="sw-draft__meta">
          {data?.experimentCode ? <span>실험번호 {data.experimentCode}</span> : null}
          {running ? (
            <span className="is-busy">
              초안 생성 중 {generation?.doneSectionIds.length} / {generation?.targetSectionIds.length}
            </span>
          ) : null}
          <button type="button" className="is-secondary" onClick={() => navigate(`/study/write/cases/${caseId}/interview`)}>
            질의응답 보기
          </button>
        </div>
      </header>

      {error ? <div className="sw-draft__error">{error}</div> : null}
      {dirtySectionIds.length > 0 ? (
        <div className="sw-draft__notice">
          답을 고쳤습니다. 관련 섹션({dirtySectionIds.length}개)을 다시 쓸까요?
          <button type="button" disabled={regenerating || running} onClick={() => void regenerateDirty()}>
            {regenerating ? '다시 쓰는 중…' : '관련 섹션 다시 쓰기'}
          </button>
          <button type="button" className="is-secondary" onClick={() => setDirtySectionIds([])}>
            나중에
          </button>
        </div>
      ) : null}

      <div className="sw-draft__body">
        <nav className="sw-draft__nav">
          {data?.sections.map((item) => {
            const missing = missingRequiredCount(item);
            const pending = running && !item.draftText;
            return (
              <button
                key={item.sectionId}
                type="button"
                className={`sw-draft__nav-item${item.sectionId === section?.sectionId ? ' is-active' : ''}`}
                onClick={() => setSelectedId(item.sectionId)}
              >
                <span>{item.name}</span>
                {pending ? <em>쓰는 중</em> : null}
                {!pending && !item.draftText ? <em>없음</em> : null}
                {missing > 0 ? <b title="빠진 필수 요소">{missing}</b> : null}
              </button>
            );
          })}
        </nav>

        <main className="sw-draft__main">
          {section ? (
            <>
              <div className="sw-draft__section-head">
                <h2>{section.name}</h2>
                <span>버전 {section.version}</span>
              </div>
              {section.draftText ? (
                <div className="sw-draft__text">{renderClinicalAnonymizedText(section.draftText)}</div>
              ) : (
                <p className="sw-draft__empty">{running ? '이 섹션은 아직 쓰는 중입니다.' : '이 섹션의 초안이 없습니다.'}</p>
              )}

              <section className="sw-draft__attachments">
                <h3>표와 그림</h3>
                {section.attachments.length === 0 ? <p className="sw-draft__empty">아직 넣은 표나 그림이 없습니다.</p> : null}
                {section.attachments.map((attachment, index) => (
                  <div key={attachment.id} className="sw-draft__attachment">
                    <div className="sw-draft__attachment-head">
                      <strong>
                        {attachment.kind === 'table' ? '표' : '그림'} · {attachment.fileName}
                      </strong>
                      {!locked ? (
                        <button type="button" className="is-link" onClick={() => void removeAttachment(attachment)}>
                          지우기
                        </button>
                      ) : null}
                    </div>
                    {attachment.kind === 'image' && caseId ? (
                      <img src={caseApi.studyWriteAttachmentFileUrl(caseId, attachment.id)} alt={attachment.caption || attachment.fileName} />
                    ) : null}
                    {attachment.kind === 'table' && attachment.tableRows ? (
                      <div className="sw-draft__table">
                        <table>
                          <tbody>
                            {attachment.tableRows.slice(0, 12).map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {row.map((cell, cellIndex) =>
                                  rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {attachment.tableRows.length > 12 ? <p>… 외 {attachment.tableRows.length - 12}행</p> : null}
                      </div>
                    ) : null}
                    <label className="sw-draft__caption">
                      <span>{attachment.kind === 'table' ? '표' : '그림'} 제목</span>
                      <input
                        defaultValue={attachment.caption}
                        placeholder={`예: ${attachment.kind === 'table' ? '표' : '그림'} ${index + 1}. 치료 경과`}
                        disabled={locked}
                        onBlur={(event) => void saveCaption(attachment, event.target.value)}
                      />
                    </label>
                  </div>
                ))}
                {!locked ? (
                  <div className="sw-draft__upload">
                    <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="먼저 제목을 적고 파일을 고르세요 (나중에 고칠 수 있음)" />
                    <label className={`sw-draft__file${uploading ? ' is-busy' : ''}`}>
                      <input type="file" accept=".png,.jpg,.jpeg,.xlsx" onChange={uploadFile} disabled={uploading} />
                      {uploading ? '올리는 중…' : '그림(png·jpg) 또는 표(xlsx) 올리기'}
                    </label>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>

        <aside className="sw-draft__side">
          <div className="sw-draft__tabs">
            <button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>
              수정 요청
            </button>
            <button type="button" className={tab === 'care' ? 'is-active' : ''} onClick={() => setTab('care')}>
              CARE 점검{section && missingRequiredCount(section) > 0 ? ` (${missingRequiredCount(section)})` : ''}
            </button>
            <button type="button" className={tab === 'answers' ? 'is-active' : ''} onClick={() => setTab('answers')}>
              내 답변
            </button>
          </div>

          {tab === 'chat' && section ? (
            <div className="sw-draft__chat">
              <div className="sw-draft__chat-log" ref={chatRef}>
                <div className="sw-chat sw-chat--system">
                  이 섹션을 어떻게 고칠지 적어 주세요. 예: "용량과 복용법을 넣어 줘", "둘째 문장은 빼 줘", "더 간결하게".
                  기록에 없는 내용을 넣으라고 하면 그 문장에 표시가 붙습니다.
                </div>
                {section.chat.map((entry) => (
                  <div key={entry.id} className={`sw-chat sw-chat--${entry.role}`}>
                    {entry.role === 'assistant' ? renderClinicalAnonymizedText(entry.text) : entry.text}
                    {entry.resultVersion ? <small>초안 버전 {entry.resultVersion}</small> : null}
                  </div>
                ))}
                {revising ? <div className="sw-chat sw-chat--system">고쳐 쓰는 중…</div> : null}
              </div>
              {!locked ? (
                <div className="sw-draft__chat-composer">
                  <textarea
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    rows={3}
                    placeholder="이 섹션에 대한 수정 요청"
                    disabled={revising || !section.draftText}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void sendInstruction();
                    }}
                  />
                  <button type="button" disabled={revising || !instruction.trim() || !section.draftText} onClick={() => void sendInstruction()}>
                    보내기
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'care' && section ? (
            <div className="sw-draft__care">
              {section.careCheck ? (
                <>
                  <p className="sw-draft__care-hint">
                    이 섹션의 CARE 세부 항목입니다. "기록에는 있음"은 수정 요청으로 넣을 수 있고, "기록에 없음"은 확인이 필요합니다.
                  </p>
                  <ul>
                    {section.careCheck.items.map((item) => (
                      <li key={item.code} className={`is-${item.status}`}>
                        <span className={`sw-draft__tag${item.required ? ' is-required' : ''}`}>
                          {item.code} {item.required ? '필수' : '선택'}
                        </span>
                        <div>
                          <strong>{item.label}</strong>
                          <em>{STATUS_LABEL[item.status]}</em>
                          {item.hint ? <p>{renderClinicalAnonymizedText(item.hint)}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="sw-draft__empty">아직 점검 결과가 없습니다.</p>
              )}
            </div>
          ) : null}

          {tab === 'answers' ? (
            <div className="sw-draft__answers">
              <p className="sw-draft__care-hint">
                질의응답에서 한 답입니다. {locked ? '최종 수정 단계라 고칠 수 없습니다.' : '고치면 관련 섹션을 다시 쓸 수 있습니다.'}
              </p>
              {questions.map((question) => (
                <div key={question.id} className="sw-draft__answer">
                  <strong>
                    질문 {question.order}. {question.text}
                  </strong>
                  {editingAnswerId === question.id ? (
                    <div className="sw-draft__answer-edit">
                      <textarea value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} rows={3} />
                      <div>
                        <button type="button" onClick={() => void saveAnswer(question)}>
                          저장
                        </button>
                        <button type="button" className="is-secondary" onClick={() => setEditingAnswerId(null)}>
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p>
                      {question.status === 'skipped' ? <em>모름 / 기록에 없음</em> : question.answer}
                      {!locked ? (
                        <button
                          type="button"
                          className="is-link"
                          onClick={() => {
                            setEditingAnswerId(question.id);
                            setAnswerDraft(question.answer);
                          }}
                        >
                          수정
                        </button>
                      ) : null}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
