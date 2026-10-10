import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, PendingTermConfirmation, StudyWriteInterviewResponse, StudyWriteQuestion } from '../services/api';
import TermReviewPanel from '../components/studyWrite/TermReviewPanel';
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
  | { kind: 'question'; id: string; question: StudyWriteQuestion }
  | { kind: 'answer'; id: string; question: StudyWriteQuestion };

function formatElapsed(fromIso?: string) {
  if (!fromIso) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

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
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [pendingTerms, setPendingTerms] = useState<PendingTermConfirmation[]>([]);
  // 전문용어 확인 화면에서 회차별 원문을 보여 주기 위한 방문 기록
  const [visits, setVisits] = useState<Visit[]>([]);
  const [termModalOpen, setTermModalOpen] = useState(false);
  const [, setTick] = useState(0);
  const processingKicked = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

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
        caseApi.finishStudyWriteInterview(caseId).then(setData).catch(() => undefined);
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

  const submitAnswer = async (skipped: boolean) => {
    if (!caseId || !pendingQuestion || sending) return;
    const answer = draft.trim();
    if (!skipped && !answer) return;
    setSending(true);
    setError(null);
    try {
      const next = await caseApi.answerStudyWriteQuestion(caseId, { questionId: pendingQuestion.id, answer, skipped });
      setData(next);
      setDraft('');
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (question: StudyWriteQuestion) => {
    if (!caseId) return;
    const answer = editDraft.trim();
    try {
      const next = await caseApi.answerStudyWriteQuestion(caseId, {
        questionId: question.id,
        answer,
        skipped: !answer
      });
      setData(next);
      setEditingId(null);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '수정하지 못했습니다.');
    }
  };

  const items: ChatItem[] = [];
  items.push({
    kind: 'system',
    id: 'intro',
    text: '기록을 바탕으로 증례보고 초안을 쓰기 전에 몇 가지만 여쭙겠습니다. 한두 문장이면 충분하고, 모르거나 기록에 없으면 "모름 / 기록에 없음"을 눌러 주세요.'
  });
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
          if (item.kind === 'question') {
            return (
              <div key={item.id} className="sw-bubble sw-bubble--bot">
                <span className="sw-bubble__label">질문 {item.question.order}</span>
                {item.question.text}
              </div>
            );
          }
          const { question } = item;
          const isEditing = editingId === question.id;
          return (
            <div key={item.id} className="sw-bubble sw-bubble--user">
              {isEditing ? (
                <div className="sw-bubble__edit">
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} />
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
                  {question.status === 'skipped' ? <em>모름 / 기록에 없음</em> : question.answer}
                  {!locked ? (
                    <button
                      type="button"
                      className="sw-bubble__edit-link"
                      onClick={() => {
                        setEditingId(question.id);
                        setEditDraft(question.answer);
                      }}
                    >
                      수정
                    </button>
                  ) : null}
                </>
              )}
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
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="한두 문장으로 답해 주세요"
              rows={3}
              disabled={sending}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submitAnswer(false);
              }}
            />
            <div className="sw-interview__actions">
              <button type="button" className="is-secondary" disabled={sending} onClick={() => void submitAnswer(true)}>
                모름 / 기록에 없음
              </button>
              <button type="button" disabled={sending || !draft.trim()} onClick={() => void submitAnswer(false)}>
                답변 보내기
              </button>
            </div>
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
                onClick={() => caseId && caseApi.finishStudyWriteInterview(caseId).then(setData).catch(() => undefined)}
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
  );
}
