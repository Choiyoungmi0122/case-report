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
import TimelineTable, { parseTimelineRows } from '../components/studyWrite/TimelineTable';
import { ANSWER_CHOICES, answerStatusLabel, choiceToBody, AnswerChoiceValue } from '../utils/studyWriteAnswers';
import './StudyWriteDraftPage.css';

/**
 * 실험용 Write ⑤ 전체 초안 생성 → ⑥ 섹션별 화면.
 * 왼쪽: 섹션 목록(빠진 필수 요소 수). 가운데: 초안과 표·그림. 오른쪽: 이 섹션의 채팅 수정,
 * CARE 점검, 내 답변(수정 가능).
 */

const POLL_MS = 3000;

const STATUS_LABEL: Record<StudyWriteCareItemStatus, string> = {
  present: '있음',
  in_record_not_in_draft: '초안에 빠짐',
  not_in_record: '기록에 없음',
  not_applicable: '해당 없음'
};

/** 상태 배지에 쓰는 기호와 한 줄 설명 */
const STATUS_META: Record<StudyWriteCareItemStatus, { mark: string; note: string }> = {
  present: { mark: '✓', note: '초안에 들어 있음' },
  in_record_not_in_draft: { mark: '!', note: '기록에는 있는데 초안에 없음. 수정 요청으로 넣을 수 있음' },
  not_in_record: { mark: '✕', note: '기록에도 답변에도 없음. 알고 있으면 내 답변에 보충' },
  not_applicable: { mark: '–', note: '이 증례에는 해당 없음' }
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [instruction, setInstruction] = useState('');
  // 보낸 뒤 입력 칸 높이를 원래대로
  useEffect(() => {
    if (!instruction && composerRef.current) composerRef.current.style.height = 'auto';
  }, [instruction]);
  const [revising, setRevising] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  // 내 답변 탭: 기본은 이 섹션에 쓰인 답만, 원하면 전체
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  // CARE 점검의 "기록에 없음" 항목에 정보를 직접 넣는 입력칸 (열린 항목 코드와 내용)
  const [careInfoCode, setCareInfoCode] = useState<string | null>(null);
  const [careInfoText, setCareInfoText] = useState('');
  const [careInfoSaving, setCareInfoSaving] = useState(false);

  /** 넣은 정보를 저장하고 이 섹션만 다시 쓴다 */
  const submitCareInfo = async (sectionId: string, code: string) => {
    if (!caseId || !careInfoText.trim()) return;
    setCareInfoSaving(true);
    setError(null);
    try {
      await caseApi.addStudyWriteCareInfo(caseId, sectionId, { code, answer: careInfoText.trim() });
      setData(await caseApi.generateStudyWriteDrafts(caseId, [sectionId]));
      setCareInfoCode(null);
      setCareInfoText('');
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setCareInfoSaving(false);
    }
  };
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

  const saveAnswer = async (question: StudyWriteQuestion, choice?: AnswerChoiceValue) => {
    if (!caseId) return;
    const answer = answerDraft.trim();
    if (!choice && !answer) {
      setError('답을 적거나 선택지를 골라 주세요.');
      return;
    }
    try {
      await caseApi.answerStudyWriteQuestion(caseId, choice ? choiceToBody(question.id, choice) : { questionId: question.id, answer });
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
          <button type="button" disabled={running || !hasAnyDraft} onClick={() => navigate(`/study/write/cases/${caseId}/final`)}>
            {locked ? '최종 수정으로' : '최종 수정으로 (답 수정 잠김)'}
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
              {section.draftText && section.sectionId === 'TIMELINE' && parseTimelineRows(section.draftText) ? (
                // 타임라인은 CARE 표로 보여 준다 (날짜 | 경과 요약 | 진단 검사 | 치료 개입)
                <TimelineTable text={section.draftText} />
              ) : section.draftText ? (
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
              내 답변{questions.some((question) => question.status === 'deferred') ? ` (보류 ${questions.filter((question) => question.status === 'deferred').length})` : ''}
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
                    {entry.role === 'user' || entry.role === 'assistant' ? (
                      <span className="sw-chat__role">{entry.role === 'user' ? '나' : 'AI'}</span>
                    ) : null}
                    {entry.role === 'assistant' ? renderClinicalAnonymizedText(entry.text) : entry.text}
                    {entry.resultVersion ? <small>초안 버전 {entry.resultVersion}</small> : null}
                  </div>
                ))}
                {revising ? <div className="sw-chat sw-chat--system">고쳐 쓰는 중…</div> : null}
              </div>
              {!locked ? (
                <div className="sw-draft__chat-composer">
                  <div className="sw-draft__chat-box">
                    <textarea
                      ref={composerRef}
                      value={instruction}
                      onChange={(event) => {
                        setInstruction(event.target.value);
                        // 입력 길이에 맞춰 늘어난다 (최대 높이는 CSS)
                        event.target.style.height = 'auto';
                        event.target.style.height = `${event.target.scrollHeight}px`;
                      }}
                      rows={1}
                      placeholder="이 섹션을 어떻게 고칠까요?"
                      disabled={revising || !section.draftText}
                      onKeyDown={(event) => {
                        // Enter 보내기, Shift+Enter 줄바꿈 (일반 채팅과 같게)
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void sendInstruction();
                        }
                      }}
                    />
                    <button
                      type="button"
                      aria-label="보내기"
                      title="보내기 (Enter)"
                      disabled={revising || !instruction.trim() || !section.draftText}
                      onClick={() => void sendInstruction()}
                    >
                      ↑
                    </button>
                  </div>
                  <p className="sw-draft__chat-hint">Enter 보내기 · Shift+Enter 줄바꿈</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'care' && section ? (
            <div className="sw-draft__care">
              {section.careCheck ? (
                (() => {
                  const items = section.careCheck.items;
                  const required = items.filter((item) => item.required);
                  const optional = items.filter((item) => !item.required);
                  const okCount = (list: typeof items) => list.filter((item) => item.status === 'present' || item.status === 'not_applicable').length;
                  const renderItem = (item: (typeof items)[number]) => (
                    <li key={item.code} className={`sw-care-item is-${item.status}`}>
                      <div className="sw-care-item__status" aria-label={STATUS_LABEL[item.status]}>
                        <span className="sw-care-item__mark">{STATUS_META[item.status].mark}</span>
                        <span className="sw-care-item__state">{STATUS_LABEL[item.status]}</span>
                      </div>
                      <div className="sw-care-item__body">
                        <div className="sw-care-item__head">
                          <span className={`sw-draft__tag${item.required ? ' is-required' : ''}`}>
                            {item.code} {item.required ? '필수' : '선택'}
                          </span>
                          <strong>{item.label}</strong>
                        </div>
                        <p className="sw-care-item__note">{STATUS_META[item.status].note}</p>
                        {item.hint ? <p className="sw-care-item__hint">{renderClinicalAnonymizedText(item.hint)}</p> : null}
                        {item.status === 'in_record_not_in_draft' && !locked ? (
                          <button
                            type="button"
                            className="sw-care-item__action"
                            onClick={() => {
                              setInstruction(`${item.label.split('.')[0].split('(')[0].trim()} 내용을 기록에서 찾아 이 섹션에 넣어 줘.`);
                              setTab('chat');
                            }}
                          >
                            수정 요청으로 넣기
                          </button>
                        ) : null}
                        {item.status === 'not_in_record' && !locked && careInfoCode !== item.code ? (
                          <button
                            type="button"
                            className="sw-care-item__action"
                            disabled={running || careInfoSaving}
                            onClick={() => {
                              setCareInfoCode(item.code);
                              setCareInfoText('');
                            }}
                          >
                            이 정보 입력하기
                          </button>
                        ) : null}
                        {item.status === 'not_in_record' && !locked && careInfoCode === item.code ? (
                          <div className="sw-care-item__input">
                            <textarea
                              value={careInfoText}
                              autoFocus
                              rows={3}
                              placeholder="알고 있는 내용을 적어 주세요. 저장하면 이 섹션을 다시 씁니다."
                              disabled={careInfoSaving}
                              onChange={(event) => setCareInfoText(event.target.value)}
                            />
                            <div>
                              <button type="button" disabled={careInfoSaving || !careInfoText.trim()} onClick={() => void submitCareInfo(section.sectionId, item.code)}>
                                {careInfoSaving ? '저장 중…' : '저장하고 다시 쓰기'}
                              </button>
                              <button type="button" className="is-secondary" disabled={careInfoSaving} onClick={() => setCareInfoCode(null)}>
                                취소
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                  return (
                    <>
                      <div className="sw-care-summary">
                        <div className={`sw-care-summary__box${okCount(required) === required.length ? ' is-ok' : ' is-missing'}`}>
                          <span>필수</span>
                          <strong>
                            {okCount(required)} / {required.length}
                          </strong>
                          <em>{okCount(required) === required.length ? '모두 있음' : `${required.length - okCount(required)}개 빠짐`}</em>
                        </div>
                        <div className="sw-care-summary__box">
                          <span>선택</span>
                          <strong>
                            {okCount(optional)} / {optional.length}
                          </strong>
                          <em>{optional.length === 0 ? '없음' : `${optional.length - okCount(optional)}개 빠짐`}</em>
                        </div>
                      </div>
                      {required.length > 0 ? (
                        <>
                          <h4 className="sw-care-group">필수 항목</h4>
                          <ul>{required.map(renderItem)}</ul>
                        </>
                      ) : null}
                      {optional.length > 0 ? (
                        <>
                          <h4 className="sw-care-group">선택 항목</h4>
                          <ul>{optional.map(renderItem)}</ul>
                        </>
                      ) : null}
                    </>
                  );
                })()
              ) : (
                <p className="sw-draft__empty">아직 점검 결과가 없습니다.</p>
              )}
            </div>
          ) : null}

          {tab === 'answers' ? (
            (() => {
              const sectionName = (id: string) => data?.sections.find((item) => item.sectionId === id)?.name || id;
              const relevant = section
                ? questions.filter((question) => question.priority === 'case' || question.targetSectionIds.includes(section.sectionId))
                : questions;
              const shown = showAllAnswers ? questions : relevant;
              return (
                <div className="sw-draft__answers">
                  <div className="sw-answers__head">
                    <p>
                      {showAllAnswers
                        ? `질의응답 답 전체 ${questions.length}개.`
                        : `이 섹션을 쓸 때 참고한 답 ${relevant.length}개.`}{' '}
                      {locked ? '최종 수정 단계라 고칠 수 없습니다.' : '고치면 관련 섹션을 다시 쓸 수 있습니다.'}
                    </p>
                    {questions.length !== relevant.length ? (
                      <button type="button" className="is-link" onClick={() => setShowAllAnswers((value) => !value)}>
                        {showAllAnswers ? '이 섹션 것만' : `전체 보기 (${questions.length})`}
                      </button>
                    ) : null}
                  </div>
                  {shown.length === 0 ? <p className="sw-draft__empty">이 섹션에 쓰인 답이 없습니다.</p> : null}
                  {shown.map((question) => (
                    <article key={question.id} className="sw-answer">
                      <header className="sw-answer__head">
                        <span className="sw-answer__no">질문 {question.order}</span>
                        <span className="sw-answer__sections">{question.targetSectionIds.map(sectionName).join(' · ')}</span>
                        {!locked && editingAnswerId !== question.id ? (
                          <button
                            type="button"
                            className="is-link sw-answer__edit"
                            onClick={() => {
                              setEditingAnswerId(question.id);
                              setAnswerDraft(question.answer);
                            }}
                          >
                            수정
                          </button>
                        ) : null}
                      </header>
                      <p className="sw-answer__question">{question.text}</p>
                      {editingAnswerId === question.id ? (
                        <div className="sw-draft__answer-edit">
                          <textarea value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} rows={4} autoFocus placeholder="답을 적거나 아래 선택지를 고르세요" />
                          <div className="sw-answer__choices">
                            {ANSWER_CHOICES.map((choice) => (
                              <button key={choice.value} type="button" className="is-secondary" title={choice.description} onClick={() => void saveAnswer(question, choice.value)}>
                                {choice.label}
                              </button>
                            ))}
                          </div>
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
                        <p className="sw-answer__text">
                          {question.status === 'answered' ? (
                            question.answer
                          ) : (
                            <em className={question.status === 'deferred' ? 'is-deferred' : ''}>
                              {answerStatusLabel(question)}
                              {question.status === 'deferred' && !locked ? ' — 기록을 확인한 뒤 "수정"으로 답해 주세요' : ''}
                            </em>
                          )}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              );
            })()
          ) : null}
        </aside>
      </div>
    </div>
  );
}
