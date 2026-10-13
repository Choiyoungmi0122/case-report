import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, PendingTermConfirmation, StudyWriteInterviewResponse, StudyWriteQuestion } from '../services/api';
import TermReviewPanel from '../components/studyWrite/TermReviewPanel';
import RecordViewer from '../components/studyWrite/RecordViewer';
import { ANSWER_CHOICES, answerStatusLabel, choiceToBody, AnswerChoiceValue } from '../utils/studyWriteAnswers';
import type { Visit } from '../services/api';
import { getProcessStageMessage } from '../utils/uiLabels';
import './StudyWriteInterviewPage.css';

/**
 * 실험용 Write ④ 질의응답. 글(초안)은 보이지 않고 채팅창만 보인다.
 *
 * - 1회차 고정 질문 3개는 바로 묻는다. 그동안 기록 분석이 뒤에서 돈다.
 * - 1회차가 끝나고 분석이 끝나면 2회차(기록 빈칸 질문)를 만든다. 3회차는 새 빈칸이 있을 때만.
 * - 답은 "수정"으로 고칠 수 있다. 최종 수정 단계에 들어가면 잠긴다.
 * - 상한과 근거: docs/question_budget_basis_v1.md
 */

const POLL_MS = 3000;

type ChatItem =
  | { kind: 'system'; id: string; text: string }
  | { kind: 'overview'; id: string; questions: StudyWriteQuestion[]; currentId?: string }
  | { kind: 'question'; id: string; question: StudyWriteQuestion }
  | { kind: 'answer'; id: string; question: StudyWriteQuestion };

function formatElapsed(fromIso?: string) {
  if (!fromIso) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const RECORD_PINNED_KEY = 'swInterviewRecordPinned';

export default function StudyWriteInterviewPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudyWriteInterviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // 글 대신 고르는 선택지 목록 열림 여부
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [pendingTerms, setPendingTerms] = useState<PendingTermConfirmation[]>([]);
  // 전문용어 확인 화면에서 회차별 원문을 보여 주기 위한 방문 기록
  const [visits, setVisits] = useState<Visit[]>([]);
  const [termModalOpen, setTermModalOpen] = useState(false);
  // 원문 EMR 보기 (초안 화면과 같은 왼쪽 칸). "유지하기"를 누르면 왼쪽 칸에 계속 띄운다 (이 브라우저에만 기억)
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
  const [, setTick] = useState(0);
  const processingKicked = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  // 보낸 뒤 입력 칸 높이를 원래대로
  useEffect(() => {
    if (!draft && draftRef.current) draftRef.current.style.height = 'auto';
  }, [draft]);

  const interview = data?.interview;
  const questions = useMemo(() => interview?.rounds.flatMap((round) => round.questions) || [], [interview]);
  const pendingQuestion = questions.find((question) => question.status === 'pending');
  const answeredCount = questions.filter((question) => question.status !== 'pending').length;
  const totalPlanned = Math.max(questions.length, interview?.questionBudget.perRound || 3);
  const finished = Boolean(interview?.interviewCompletedAt);
  const locked = Boolean(interview?.answersLockedAt);
  const currentRound = interview?.rounds[interview.rounds.length - 1];
  const roundComplete = Boolean(currentRound && currentRound.questions.every((q) => q.status !== 'pending'));

  const refresh = useCallback(async () => {
    if (!caseId) return null;
    const next = await caseApi.getStudyWriteInterview(caseId);
    setData(next);
    return next;
  }, [caseId]);

  // 처음: 상태를 읽고, 1회차가 없으면 열고, 분석 요청을 아직 안 보냈으면 보낸다.
  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    (async () => {
      try {
        let next = await caseApi.getStudyWriteInterview(caseId);
        if (next.interview.rounds.length === 0) {
          next = await caseApi.startStudyWriteInterview(caseId, {});
        }
        if (cancelled) return;
        setData(next);
        if (!next.analysis.ready && !next.analysis.processingRequestedAt && !processingKicked.current) {
          processingKicked.current = true;
          await caseApi.startStudyWriteInterview(caseId, { processingRequested: true });
          // 분석은 길게 걸린다. 응답을 기다리지 않고, 아래 폴링으로 진행을 본다.
          caseApi.processCase(caseId).catch((nextError) => {
            console.error('study write processing failed', nextError);
          });
        }
      } catch (nextError: any) {
        if (!cancelled) setError(nextError?.response?.data?.error || nextError?.message || '불러오지 못했습니다.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  // 분석이 끝날 때까지 폴링. 경과 시간 표시도 이 주기로 갱신한다.
  useEffect(() => {
    if (!caseId || !data || data.analysis.ready || finished) return;
    const timer = window.setInterval(() => {
      setTick((value) => value + 1);
      refresh().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [caseId, data, finished, refresh]);

  // 회차가 끝났고 분석이 준비되면 다음 회차를 만든다.
  useEffect(() => {
    if (!caseId || !data || generating || generationFailed || finished || !roundComplete) return;
    if (!data.nextRound.ok) {
      // 상한에 닿았으면 끝낸다.
      if (!finished) {
        caseApi.finishStudyWriteInterview(caseId, 'budget_reached').then(setData).catch(() => undefined);
      }
      return;
    }
    if (!data.analysis.ready) return;
    setGenerating(true);
    caseApi
      .nextStudyWriteRound(caseId)
      .then((next) => {
        setData(next);
        if (next.stopReason) setStopReason(next.stopReason);
      })
      .catch((nextError) => {
        if (nextError?.response?.status === 409) return;
        setGenerationFailed(true);
        const message = nextError?.response?.data?.error;
        setError(typeof message === 'string' ? message : '다음 질문을 만들지 못했습니다. "다시 시도"를 눌러 주세요.');
      })
      .finally(() => setGenerating(false));
  }, [caseId, data, generating, generationFailed, finished, roundComplete]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [questions.length, answeredCount, generating, data?.analysis.ready]);

  // 분석이 끝나면 애매한 전문용어 목록을 가져온다 (초안 전에 확인).
  useEffect(() => {
    if (!caseId || !data?.analysis.ready) return;
    caseApi
      .getPendingTerms(caseId)
      .then((result) => setPendingTerms(result.items || []))
      .catch(() => undefined);
    caseApi
      .getCase(caseId)
      .then((caseData) => setVisits(((caseData as any).visits as Visit[] | undefined) || []))
      .catch(() => undefined);
  }, [caseId, data?.analysis.ready, data?.pendingTermCount]);

  const pendingTermCount = pendingTerms.filter((item) => item.status === 'PENDING').length;

  /** 글로 답하거나(choice 없음) 선택지로 답한다 */
  const submitAnswer = async (choice: AnswerChoiceValue | false) => {
    if (!caseId || !pendingQuestion || sending) return;
    const answer = draft.trim();
    if (!choice && !answer) return;
    setSending(true);
    setError(null);
    try {
      const body = choice ? choiceToBody(pendingQuestion.id, choice) : { questionId: pendingQuestion.id, answer };
      const next = await caseApi.answerStudyWriteQuestion(caseId, body);
      setData(next);
      setDraft('');
      setChoicesOpen(false);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSending(false);
    }
  };

  /** 수정: 글을 쓰면 답으로, 비우고 선택지를 고르면 그 선택으로 저장 */
  const saveEdit = async (question: StudyWriteQuestion, choice?: AnswerChoiceValue) => {
    if (!caseId) return;
    const answer = editDraft.trim();
    if (!choice && !answer) {
      setError('답을 적거나 선택지를 골라 주세요.');
      return;
    }
    try {
      const next = await caseApi.answerStudyWriteQuestion(caseId, choice ? choiceToBody(question.id, choice) : { questionId: question.id, answer });
      setData(next);
      setEditingId(null);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '수정하지 못했습니다.');
    }
  };

  const items: ChatItem[] = [];
  // 미리 만든 질문(프리셋 EMR): 여쭐 질문 전체를 먼저 보여 주고, 답은 아래 채팅에서 하나씩 받는다.
  const preparedRound = interview?.rounds.find((round) => round.generation?.prepared);
  const answerHelp =
    '한두 문장이면 충분합니다. 답하기 어려우면 입력창 아래 "답하기 어려우면"에서 기록 없음 · 확인할 수 없음 · 추후 확인 필요 · 자료 확인 필요(보류) 중 하나를 고르세요. 보류한 질문은 기록을 본 뒤 다시 답할 수 있습니다.';
  items.push({
    kind: 'system',
    id: 'intro',
    text: preparedRound
      ? `기록을 미리 살펴보고 초안을 쓰기 전에 여쭐 질문 ${preparedRound.questions.length}개를 준비했습니다. 기록에 충분히 적혀 있는 내용은 묻지 않기 때문에 질문 수는 사례마다 다릅니다. 아래에서 하나씩 여쭙겠습니다. ${answerHelp}`
      : `기록을 바탕으로 증례보고 초안을 쓰기 전에 몇 가지만 여쭙겠습니다. ${answerHelp}`
  });
  if (preparedRound) {
    items.push({ kind: 'overview', id: 'overview', questions: preparedRound.questions, currentId: pendingQuestion?.id });
  }
  for (const round of interview?.rounds || []) {
    if (round.roundNo > 1) {
      items.push({
        kind: 'system',
        id: `round-${round.roundNo}`,
        text:
          round.roundNo === 2
            ? '기록 분석이 끝났습니다. 기록만으로는 쓰기 어려운 부분을 여쭙겠습니다.'
            : '앞의 답을 보고 한 가지 더 확인하겠습니다.'
      });
    }
    // 한 번에 하나씩 묻는다. 아직 답하지 않은 첫 질문까지만 보여 준다.
    let reachedPending = false;
    for (const question of round.questions) {
      if (reachedPending) break;
      items.push({ kind: 'question', id: `q-${question.id}`, question });
      if (question.status !== 'pending') items.push({ kind: 'answer', id: `a-${question.id}`, question });
      else reachedPending = true;
    }
    if (reachedPending) break;
  }

  const waitingForAnalysis = Boolean(data && roundComplete && !finished && data.nextRound.ok && !data.analysis.ready);

  return (
    <div className={`sw-interview-shell${recordPinned && recordOpen ? ' is-record-pinned' : ''}`}>
      <nav className="sw-interview-shell__rail" aria-label="기록">
        {recordPinned && recordOpen ? null : (
          <button type="button" className="sw-interview-shell__record" onClick={() => setRecordOpen(true)}>
            원문 EMR 보기
          </button>
        )}
        {caseId ? (
          <RecordViewer
            caseId={caseId}
            isOpen={recordOpen}
            onClose={() => {
              setRecordOpen(false);
              changeRecordPinned(false);
            }}
            relativeDates={Boolean(data?.interview.inputSource?.relativeDates)}
            pinned={recordPinned}
            onPinnedChange={changeRecordPinned}
          />
        ) : null}
      </nav>
      <div className="sw-interview">
        <header className="sw-interview__header">
          <div>
            <p className="sw-interview__eyebrow">실험용 Write · 질의응답</p>
            <h1>증례보고를 쓰기 전에 몇 가지 여쭙겠습니다</h1>
          </div>
          <div className="sw-interview__meta">
            {data?.experimentCode ? <span>실험번호 {data.experimentCode}</span> : null}
            <span>
              질문 {Math.min(answeredCount + (pendingQuestion ? 1 : 0), totalPlanned)} / {totalPlanned}
              {interview && interview.rounds.length < interview.questionBudget.maxRounds && !finished ? ' (더 생길 수 있음)' : ''}
            </span>
            {interview?.interviewStartedAt ? <span>경과 {formatElapsed(interview.interviewStartedAt)}</span> : null}
          </div>
        </header>

        {error ? <div className="sw-interview__error">{error}</div> : null}

        <div className="sw-interview__log" ref={logRef}>
          {items.map((item) => {
            if (item.kind === 'system') {
              return (
                <div key={item.id} className="sw-bubble sw-bubble--system">
                  {item.text}
                </div>
              );
            }
            if (item.kind === 'overview') {
              return (
                <section key={item.id} className="sw-overview" aria-label="여쭐 질문 전체">
                  <p className="sw-overview__title">여쭐 질문 {item.questions.length}개</p>
                  <ol className="sw-overview__list">
                    {item.questions.map((question) => {
                      const state = question.status !== 'pending' ? 'done' : question.id === item.currentId ? 'current' : 'todo';
                      return (
                        <li key={question.id} className={`sw-overview__item is-${state}`}>
                          <span className="sw-overview__status">{state === 'done' ? '답함' : state === 'current' ? '지금' : '남음'}</span>
                          <span>{question.text}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            }
            if (item.kind === 'question') {
              return (
                <div key={item.id} className="sw-msg sw-msg--bot">
                  <span className="sw-msg__label">
                    {item.question.chatEntryId
                      ? `수정 요청 · AI 질문${item.question.careItem ? ` (${item.question.careItem})` : ''}`
                      : item.question.source === 'care_check'
                        ? `CARE 점검 · 추가 입력 (${item.question.careItem || ''})`
                        : `AI · 질문 ${item.question.order}`}
                  </span>
                  <div className="sw-bubble sw-bubble--bot">{item.question.text}</div>
                </div>
              );
            }
            const { question } = item;
            const isEditing = editingId === question.id;
            return (
              <div key={item.id} className="sw-msg sw-msg--user">
                <span className="sw-msg__label">나</span>
                <div className="sw-bubble sw-bubble--user">
                {isEditing ? (
                  <div className="sw-bubble__edit">
                    <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} placeholder="답을 적거나 아래 선택지를 고르세요" />
                    <div className="sw-bubble__edit-choices">
                      {ANSWER_CHOICES.map((choice) => (
                        <button key={choice.value} type="button" className="is-secondary" title={choice.description} onClick={() => void saveEdit(question, choice.value)}>
                          {choice.label}
                        </button>
                      ))}
                    </div>
                    <div>
                      <button type="button" onClick={() => void saveEdit(question)}>
                        저장
                      </button>
                      <button type="button" className="is-secondary" onClick={() => setEditingId(null)}>
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {question.status === 'answered' ? (
                      question.answer
                    ) : (
                      <em className={question.status === 'deferred' ? 'is-deferred' : ''}>{answerStatusLabel(question)}</em>
                    )}
                    {!locked ? (
                      <button
                        type="button"
                        className="sw-bubble__edit-link"
                        onClick={() => {
                          setEditingId(question.id);
                          setEditDraft(question.answer);
                        }}
                      >
                        {question.status === 'deferred' ? '기록 확인 후 답하기' : '수정'}
                      </button>
                    ) : null}
                  </>
                )}
                </div>
              </div>
            );
          })}

          {waitingForAnalysis ? (
            <div className="sw-bubble sw-bubble--system sw-bubble--busy">
              {getProcessStageMessage(data?.analysis.currentStep, '기록을 분석하고 있습니다...')}
              <span>분석이 끝나면 기록에서 찾지 못한 내용을 여쭙겠습니다. 보통 1~2분 걸립니다.</span>
            </div>
          ) : null}
          {generating ? <div className="sw-bubble sw-bubble--system sw-bubble--busy">다음 질문을 고르고 있습니다...</div> : null}
          {data?.analysis.blocked ? (
            <div className="sw-bubble sw-bubble--system sw-bubble--warn">
              기록에 개인정보로 보이는 내용이 있어 분석이 멈췄습니다. 연구자에게 알려 주세요.
            </div>
          ) : null}
          {finished ? (
            <div className="sw-bubble sw-bubble--system">
              {stopReason ? `질문을 마쳤습니다. (${stopReason})` : '질문을 마쳤습니다.'} 답한 내용을 바탕으로 초안을 만듭니다. 답은 초안을 보면서도
              고칠 수 있습니다.
            </div>
          ) : null}
          {finished && pendingTermCount > 0 ? (
            <div className="sw-bubble sw-bubble--system sw-bubble--warn">
              기록에서 뜻이 애매한 전문용어 {pendingTermCount}건이 있습니다. 초안을 만들기 전에 확인해 주세요.
            </div>
          ) : null}
        </div>

        <div className="sw-interview__composer">
          {pendingQuestion && !locked ? (
            <>
              <div className="sw-interview__box">
                <textarea
                  ref={draftRef}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    event.target.style.height = 'auto';
                    event.target.style.height = `${event.target.scrollHeight}px`;
                  }}
                  placeholder="답을 적어 주세요"
                  rows={1}
                  disabled={sending}
                  onKeyDown={(event) => {
                    // Enter 보내기, Shift+Enter 줄바꿈
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (draft.trim()) void submitAnswer(false);
                    }
                  }}
                />
                <button type="button" aria-label="답변 보내기" title="보내기 (Enter)" disabled={sending || !draft.trim()} onClick={() => void submitAnswer(false)}>
                  ↑
                </button>
              </div>
              <div className="sw-interview__composer-row">
                <button type="button" className="is-secondary" disabled={sending} onClick={() => setChoicesOpen((value) => !value)}>
                  {choicesOpen ? '선택지 닫기' : '답하기 어려우면 ▾'}
                </button>
                <p>Enter 보내기 · Shift+Enter 줄바꿈</p>
              </div>
              {choicesOpen ? (
                <ul className="sw-interview__choices">
                  {ANSWER_CHOICES.map((choice) => (
                    <li key={choice.value}>
                      <button type="button" className="is-secondary" disabled={sending} onClick={() => void submitAnswer(choice.value)}>
                        <strong>{choice.label}</strong>
                        <span>{choice.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : finished ? (
            <div className="sw-interview__actions">
              {pendingTermCount > 0 ? (
                <button type="button" className="is-secondary" onClick={() => setTermModalOpen(true)}>
                  전문용어 확인 ({pendingTermCount}건)
                </button>
              ) : null}
              <button type="button" onClick={() => navigate(`/study/write/cases/${caseId}/draft`)}>
                {pendingTermCount > 0 ? '확인 없이 초안 만들기' : '초안 만들기'}
              </button>
            </div>
          ) : (
            <div className="sw-interview__actions">
              {generationFailed ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setGenerationFailed(false);
                  }}
                >
                  다시 시도
                </button>
              ) : null}
              {!data?.analysis.ready && data?.nextRound.ok ? (
                <button
                  type="button"
                  className="is-secondary"
                  onClick={() => caseId && caseApi.finishStudyWriteInterview(caseId, 'participant_button').then(setData).catch(() => undefined)}
                >
                  질문은 여기까지 (남은 질문 없이 초안으로)
                </button>
              ) : null}
            </div>
          )}
        </div>

        {caseId ? (
          <TermReviewPanel
            caseId={caseId}
            isOpen={termModalOpen}
            onClose={() => setTermModalOpen(false)}
            onResolved={async (result) => {
              setPendingTerms(result.pendingTermConfirmations || []);
            }}
            pendingTerms={pendingTerms}
            visits={visits}
            relativeDates={Boolean(data?.interview.inputSource?.relativeDates)}
          />
        ) : null}
      </div>
    </div>
  );
}
