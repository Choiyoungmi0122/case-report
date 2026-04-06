import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseApi, SectionDetail, Case, SectionUiHints } from '../services/api';
import { ensureKoreanQuestion, formatSectionDraftForDisplay } from '../utils/sectionDraftFormatter';
import './SectionDetailPage.css';

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '요약',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 결과',
  DISCUSSION_CONCLUSION: '토론 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '동의'
};

const STATUS_LABELS: Record<string, string> = {
  IMPOSSIBLE: '보완 필요',
  PARTIAL_IMPOSSIBLE: '일부 보완 필요',
  PARTIAL_POSSIBLE: '부분 작성됨',
  POSSIBLE: '작성 가능',
  FULLY_POSSIBLE: '초안 생성됨'
};

const SECTION_ORDER = [
  'TITLE',
  'ABSTRACT',
  'INTRODUCTION',
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT'
];

type QuestionItem = {
  question: string;
  answered: boolean;
};

type QuestionHistoryItem = {
  question: string;
  answer: string;
  timestamp: string;
};

type PanelBadge = {
  label: string;
  color: string;
};

type ConversationPanelProps = {
  panelClassName: string;
  title: string;
  subtitle: string;
  badge?: PanelBadge;
  questions: string[];
  questionItems: QuestionItem[];
  currentQuestion: string | null;
  nextUnansweredQuestion: string | null;
  onSelectQuestion: (question: string | null) => void;
  onStartQuestion: () => void;
  isAskingQuestion: boolean;
  emptyMessage: string;
  hintTitle?: string;
  hintItems?: string[];
  updateNotice: string | null;
  qnaHistory: QuestionHistoryItem[];
  answerText: string;
  onAnswerChange: (text: string) => void;
  onSubmitAnswer: () => void;
  isSubmitting: boolean;
  chatEndRef: RefObject<HTMLDivElement>;
  hideStartButton?: boolean;
};

function SectionDetailPage() {
  const { caseId, sectionId } = useParams<{ caseId: string; sectionId: string }>();
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionDetail | null>(null);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSwitchingSection, setIsSwitchingSection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionStates, setSectionStates] = useState<Record<string, { question: string | null; answer: string }>>({});
  const [commonQuestionState, setCommonQuestionState] = useState<{ question: string | null; answer: string }>({
    question: null,
    answer: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [isSubmittingCommon, setIsSubmittingCommon] = useState(false);
  const [isAskingCommonQuestion, setIsAskingCommonQuestion] = useState(false);
  const [sectionQuestions, setSectionQuestions] = useState<string[]>([]);
  const [sectionMissingInfo, setSectionMissingInfo] = useState<string[]>([]);
  const [commonQuestions, setCommonQuestions] = useState<string[]>([]);
  const [, setCommonMissingInfo] = useState<string[]>([]);
  const [commonQnaHistory, setCommonQnaHistory] = useState<QuestionHistoryItem[]>([]);
  const [sectionUiHints, setSectionUiHints] = useState<SectionUiHints | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [commonUpdateNotice, setCommonUpdateNotice] = useState<string | null>(null);
  const sectionChatEndRef = useRef<HTMLDivElement>(null);
  const commonChatEndRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const currentQuestion = sectionId ? sectionStates[sectionId]?.question || null : null;
  const answerText = sectionId ? sectionStates[sectionId]?.answer || '' : '';
  const currentCommonQuestion = commonQuestionState.question;
  const commonAnswerText = commonQuestionState.answer;

  const normalizeQuestionKey = (text: string) =>
    String(text || '')
      .trim()
      .toLowerCase()
      .replace(/^다음 정보를 알려주세요:\s*/i, '')
      .replace(/^다음 항목을 보완할 수 있는 정보를 알려주세요:\s*/i, '')
      .replace(/[?？!！.,:;()[\]{}"'\s-]/g, '');

  const answeredQuestionKeys = useMemo(
    () => new Set((section?.qnaHistory || []).map((qna) => normalizeQuestionKey(qna.question))),
    [section?.qnaHistory]
  );

  const answeredCommonQuestionKeys = useMemo(
    () => new Set(commonQnaHistory.map((qna) => normalizeQuestionKey(qna.question))),
    [commonQnaHistory]
  );

  const sectionQuestionItems = useMemo(
    () =>
      sectionQuestions.map((question) => ({
        question,
        answered: answeredQuestionKeys.has(normalizeQuestionKey(question))
      })),
    [sectionQuestions, answeredQuestionKeys]
  );

  const commonQuestionItems = useMemo(
    () =>
      commonQuestions.map((question) => ({
        question,
        answered: answeredCommonQuestionKeys.has(normalizeQuestionKey(question))
      })),
    [commonQuestions, answeredCommonQuestionKeys]
  );

  const nextUnansweredQuestion = sectionQuestionItems.find((item) => !item.answered)?.question || null;
  const nextUnansweredCommonQuestion =
    commonQuestionItems.find((item) => !item.answered)?.question || null;
  const sectionPanelSubtitle =
    sectionUiHints?.subtitle || '현재 섹션 초안을 정교하게 만드는 질문 및 답변';
  const sectionEmptyMessage =
    sectionUiHints?.emptyMessage || '현재 이 섹션에서 추가로 확인할 세부 질문이 없습니다.';

  const setCurrentQuestion = (question: string | null) => {
    if (sectionId) {
      setSectionStates((prev) => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], question }
      }));
    }
    if (question) {
      setUpdateNotice(null);
    }
  };

  const setAnswerText = (text: string) => {
    if (sectionId) {
      setSectionStates((prev) => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], answer: text }
      }));
    }
  };

  const setCurrentCommonQuestion = (question: string | null) => {
    setCommonQuestionState((prev) => ({
      ...prev,
      question
    }));
    if (question) {
      setCommonUpdateNotice(null);
    }
  };

  const setCommonAnswerText = (text: string) => {
    setCommonQuestionState((prev) => ({
      ...prev,
      answer: text
    }));
  };

  const mergeUpdatedDrafts = (updatedDraftsBySection?: Record<string, string>) => {
    if (!updatedDraftsBySection || Object.keys(updatedDraftsBySection).length === 0) {
      return;
    }

    setCaseData((prev) => ({
      ...prev,
      draftsBySection: {
        ...(prev?.draftsBySection || {}),
        ...updatedDraftsBySection
      }
    } as Case));

    if (sectionId && updatedDraftsBySection[sectionId]) {
      setSection((prev) =>
        prev
          ? {
              ...prev,
              currentDraft: updatedDraftsBySection[sectionId]
            }
          : prev
      );
    }
  };

  const loadCommonQuestionData = async (preserveSelection = true) => {
    if (!caseId) return null;

    const result = await caseApi.getCommonQuestions(caseId);
    const nextQuestions = (result.questions || []).map(ensureKoreanQuestion);
    setCommonQuestions(nextQuestions);
    setCommonMissingInfo(result.missingInfo || []);
    setCommonQnaHistory(result.qnaHistory || []);
    setCommonQuestionState((prev) => ({
      ...prev,
      question:
        preserveSelection && prev.question && nextQuestions.includes(prev.question)
          ? prev.question
          : prev.question,
      answer: prev.answer
    }));
    return result;
  };

  useEffect(() => {
    if (!caseId || !sectionId) return;

    let isCancelled = false;
    const preserveLayout = Boolean(caseData);
    if (preserveLayout) {
      setIsSwitchingSection(true);
    } else {
      setLoading(true);
    }
    setError(null);
    setSection(null);
    setSectionQuestions([]);
    setSectionMissingInfo([]);
    setSectionUiHints(null);
    setUpdateNotice(null);

    const loadData = async () => {
      try {
        const [sectionData, caseDataResult, commonQuestionResult] = await Promise.all([
          caseApi.getSectionDetail(caseId, sectionId),
          caseApi.getCase(caseId),
          caseApi.getCommonQuestions(caseId)
        ]);
        if (isCancelled) return;

        setSection(sectionData);
        setCaseData(caseDataResult);
        setSectionQuestions(
          (sectionData.sectionQuestions || sectionData.recommendedQuestions || []).map(ensureKoreanQuestion)
        );
        setSectionMissingInfo(sectionData.sectionMissingInfo || sectionData.missingInfoBullets || []);
        setSectionUiHints(sectionData.uiHints || null);
        setCommonQuestions((commonQuestionResult.questions || []).map(ensureKoreanQuestion));
        setCommonMissingInfo(commonQuestionResult.missingInfo || []);
        setCommonQnaHistory(commonQuestionResult.qnaHistory || []);

        if (sectionId) {
          setSectionStates((prev) => {
            if (!prev[sectionId]) {
              return {
                ...prev,
                [sectionId]: { question: null, answer: '' }
              };
            }
            return prev;
          });
        }
      } catch (err: any) {
        if (isCancelled) return;
        setError(err.message || '데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        if (!isCancelled) {
          setLoading(false);
          setIsSwitchingSection(false);
        }
      }
    };

    loadData();
    return () => {
      isCancelled = true;
    };
  }, [caseId, sectionId]);

  useEffect(() => {
    setUpdateNotice(null);
    setCommonUpdateNotice(null);
  }, [sectionId]);

  useEffect(() => {
    if (sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sectionId, caseData]);

  useEffect(() => {
    if (sectionChatEndRef.current) {
      sectionChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [section?.qnaHistory, currentQuestion]);

  useEffect(() => {
    if (commonChatEndRef.current) {
      commonChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [commonQnaHistory, currentCommonQuestion]);

  const handleStartQuestion = async () => {
    if (!caseId || !sectionId) return;

    if (nextUnansweredQuestion) {
      setCurrentQuestion(nextUnansweredQuestion);
      return;
    }

    setIsAskingQuestion(true);
    try {
      const qnaHistory = section?.qnaHistory || [];
      const userAnswers = qnaHistory.map((qna) => ({
        question: qna.question,
        answer: qna.answer
      }));

      const result = await caseApi.getNextQuestion(caseId, sectionId, userAnswers);
      const nextSectionQuestions = (result.sectionQuestions || []).map(ensureKoreanQuestion);
      setSectionQuestions(nextSectionQuestions);
      setSectionMissingInfo(result.sectionMissingInfo || []);
      setSectionUiHints(result.uiHints || null);

      const preferredQuestion = nextSectionQuestions[0] || null;
      setCurrentQuestion(preferredQuestion);
      if (!preferredQuestion) {
        setUpdateNotice('현재 이 섹션에서 추가로 확인할 세부 질문이 없습니다.');
      }
    } catch (err: any) {
      setError(err.message || '질문 생성 중 오류가 발생했습니다.');
    } finally {
      setIsAskingQuestion(false);
    }
  };

  const handleStartCommonQuestion = async () => {
    if (!caseId) return;

    if (nextUnansweredCommonQuestion) {
      setCurrentCommonQuestion(nextUnansweredCommonQuestion);
      return;
    }

    setIsAskingCommonQuestion(true);
    try {
      const commonData = await loadCommonQuestionData(false);
      const nextQuestions = (commonData?.questions || []).map(ensureKoreanQuestion);
      const preferredQuestion = nextQuestions[0] || null;
      setCurrentCommonQuestion(preferredQuestion);
      if (!preferredQuestion) {
        setCommonUpdateNotice('현재 공통적으로 확인할 질문이 없습니다. 오른쪽에서 섹션별 질문을 이어서 진행할 수 있습니다.');
      }
    } catch (err: any) {
      setError(err.message || '공통 질문을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsAskingCommonQuestion(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!caseId || !sectionId || !answerText.trim() || !currentQuestion) return;

    setIsSubmitting(true);
    try {
      const result = await caseApi.submitAnswer(caseId, sectionId, answerText, currentQuestion);
      const nextQnaHistory =
        Array.isArray(result.qnaHistory) && result.qnaHistory.length > 0
          ? result.qnaHistory
          : [
              ...(section?.qnaHistory || []),
              {
                question: currentQuestion,
                answer: answerText,
                timestamp: new Date().toISOString()
              }
            ];

      mergeUpdatedDrafts(result.updatedDraftsBySection);

      if (result.updatedDraft && section) {
        setSection((prev) =>
          prev
            ? {
                ...prev,
                currentDraft: result.updatedDraft,
                qnaHistory: nextQnaHistory
              }
            : prev
        );
      } else if (result.qnaHistory?.length) {
        setSection((prev) =>
          prev
            ? {
                ...prev,
                qnaHistory: nextQnaHistory
              }
            : prev
        );
      }
      setSectionUiHints(result.uiHints || null);

      setUpdateNotice('초안이 업데이트되었습니다. 가운데 문서 미리보기에서 변경 내용을 확인하고, 필요하면 다음 질문을 이어서 선택하세요.');

      if (sectionId) {
        setSectionStates((prev) => ({
          ...prev,
          [sectionId]: { ...prev[sectionId], answer: '' }
        }));
      }

      if (result.lightweight) {
        setCurrentQuestion(null);
      } else if (result.isComplete) {
        setCurrentQuestion(null);
        alert('섹션이 완성되었습니다!');
      } else if (result.nextQuestion) {
        const preferredQuestion =
          result.sectionQuestions && result.sectionQuestions.length > 0
            ? ensureKoreanQuestion(result.sectionQuestions[0])
            : null;
        setCurrentQuestion(preferredQuestion);
      } else {
        setCurrentQuestion(null);
      }
    } catch (err: any) {
      setError(err.message || '답변 제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitCommonAnswer = async () => {
    if (!caseId || !currentCommonQuestion || !commonAnswerText.trim()) return;

    setIsSubmittingCommon(true);
    try {
      const result = await caseApi.submitCommonAnswer(caseId, currentCommonQuestion, commonAnswerText);
      const nextHistory =
        Array.isArray(result.qnaHistory) && result.qnaHistory.length > 0
          ? result.qnaHistory
          : [
              ...commonQnaHistory,
              {
                question: currentCommonQuestion,
                answer: commonAnswerText,
                timestamp: new Date().toISOString()
              }
            ];

      mergeUpdatedDrafts(result.updatedDraftsBySection);
      setCommonQnaHistory(nextHistory);
      setCommonQuestionState((prev) => ({
        ...prev,
        question: null,
        answer: ''
      }));
      setCommonUpdateNotice('공통 답변이 전체 초안에 반영되었습니다. 가운데 문서에서 여러 섹션의 변경 내용을 함께 확인하세요.');
      await loadCommonQuestionData(false);
    } catch (err: any) {
      setError(err.message || '공통 질문 답변 제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingCommon(false);
    }
  };

  const renderConversationPanel = ({
    panelClassName,
    title,
    subtitle,
    badge,
    questions,
    questionItems,
    currentQuestion,
    nextUnansweredQuestion,
    onSelectQuestion,
    onStartQuestion,
    isAskingQuestion,
    emptyMessage,
    hintTitle,
    hintItems = [],
    updateNotice,
    qnaHistory,
    answerText,
    onAnswerChange,
    onSubmitAnswer,
    isSubmitting,
    chatEndRef,
    hideStartButton = false
  }: ConversationPanelProps) => (
    <div className={`chat-panel ${panelClassName}`}>
      <div className="chat-header">
        <div className="chat-header-title">
          <h2>{title}</h2>
          <span className="chat-subtitle">{subtitle}</span>
        </div>
        {badge && (
          <div className="section-status-info">
            <span className="status-badge-small" style={{ backgroundColor: badge.color }}>
              {badge.label}
            </span>
          </div>
        )}
      </div>

      <div className="question-priority-panel">
        {hintItems.length > 0 && (
          <div className="question-hint-box">
            {hintTitle && <strong>{hintTitle}</strong>}
            <ul>
              {hintItems.map((item, idx) => (
                <li key={`${title}-hint-${idx}`}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {questions.length > 0 ? (
          <div className="question-priority-group">
            <div className="question-chip-list">
              {questionItems.map(({ question, answered }, idx) => (
                <button
                  key={`${title}-q-${idx}`}
                  type="button"
                  className={`question-chip ${currentQuestion === question ? 'active' : ''} ${answered ? 'answered' : ''}`}
                  onClick={() => !answered && onSelectQuestion(question)}
                  disabled={answered}
                >
                  {question}
                  {answered && <span className="question-chip-status">답변 완료</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="question-empty-state">{emptyMessage}</div>
        )}

        {!currentQuestion && questions.length > 0 && nextUnansweredQuestion === null && (
          <div className="question-empty-state">{emptyMessage}</div>
        )}
      </div>

      {updateNotice && <div className="question-update-notice">{updateNotice}</div>}

      <div className="chat-messages">
        {qnaHistory.map((qna, idx) => (
          <div key={`${title}-history-${idx}`} className="chat-message">
            <div className="message-question">
              <div className="message-avatar">질문</div>
              <div className="message-content">
                <div className="message-text">{ensureKoreanQuestion(qna.question)}</div>
                <div className="message-time">{new Date(qna.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
            <div className="message-answer">
              <div className="message-avatar answer">답변</div>
              <div className="message-content">
                <div className="message-text">{qna.answer}</div>
                <div className="message-time">{new Date(qna.timestamp).toLocaleTimeString()}</div>
              </div>
            </div>
          </div>
        ))}

        {currentQuestion && (
          <div className="chat-message">
            <div className="message-question">
              <div className="message-avatar">질문</div>
              <div className="message-content">
                <div className="message-text">{ensureKoreanQuestion(currentQuestion)}</div>
                <div className="message-time">지금</div>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div className="chat-input-area">
        {!currentQuestion ? (
          !hideStartButton ? (
          <button
            onClick={onStartQuestion}
            disabled={isAskingQuestion}
            className="btn-start-question"
          >
            {isAskingQuestion
              ? '질문 불러오는 중...'
              : nextUnansweredQuestion
                ? '다음 질문 보기'
                : qnaHistory.length
                  ? '추가 질문 확인'
                  : '질문 시작'}
          </button>
          ) : null
        ) : (
          <div className="input-box">
            <textarea
              value={answerText}
              onChange={(e) => onAnswerChange(e.target.value)}
              placeholder="답변을 입력하세요..."
              rows={3}
              className="answer-input"
            />
            <button
              onClick={onSubmitAnswer}
              disabled={isSubmitting || !answerText.trim()}
              className="btn-submit-answer"
            >
              {isSubmitting ? '제출 중...' : '제출'}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const currentSectionTitle = sectionId
    ? SECTION_NAMES[sectionId] || sectionId
    : section
      ? SECTION_NAMES[section.section] || section.section
      : '섹션';

  const sectionBadgeLabel = section?.status
    ? STATUS_LABELS[section.status] || section.status
    : isSwitchingSection
      ? '불러오는 중'
      : '보완 필요';

  const sectionBadgeColor = section?.status
    ? section.status === 'FULLY_POSSIBLE'
      ? '#28a745'
      : section.status === 'POSSIBLE'
        ? '#17a2b8'
        : '#ffc107'
    : '#6c757d';

  if (loading && !caseData) {
    return (
      <div className="section-detail-page">
        <div className="container">로딩 중...</div>
      </div>
    );
  }

  if (error && !caseData) {
    return (
      <div className="section-detail-page">
        <div className="container">
          <div className="error-message">{error || '섹션을 찾을 수 없습니다.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="section-detail-page">
      <div className="header-bar">
        <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back">
          ← 목록으로
        </button>
        <h1>{currentSectionTitle}</h1>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="three-panel-layout">
        {renderConversationPanel({
          panelClassName: 'common-chat-panel',
          title: '공통적으로 확인할 내용',
          subtitle: '여러 섹션 초안에 함께 반영되는 질문 및 답변',
          badge: {
            label: '전체 반영',
            color: '#6f42c1'
          },
          questions: commonQuestions,
          questionItems: commonQuestionItems,
          currentQuestion: currentCommonQuestion,
          nextUnansweredQuestion: nextUnansweredCommonQuestion,
          onSelectQuestion: setCurrentCommonQuestion,
          onStartQuestion: handleStartCommonQuestion,
          isAskingQuestion: isAskingCommonQuestion,
          emptyMessage: isSwitchingSection
            ? '선택한 섹션 정보를 불러오는 중입니다.'
            : '현재 공통적으로 확인할 질문이 없습니다.',
          updateNotice: isSwitchingSection ? '선택한 섹션 정보를 불러오는 중입니다.' : commonUpdateNotice,
          qnaHistory: commonQnaHistory,
          answerText: commonAnswerText,
          onAnswerChange: setCommonAnswerText,
          onSubmitAnswer: handleSubmitCommonAnswer,
          isSubmitting: isSubmittingCommon,
          chatEndRef: commonChatEndRef,
          hideStartButton: isSwitchingSection
        })}

        <div className="document-preview">
          <div className="document-paper">
            {SECTION_ORDER.map((secId) => {
              const draft = caseData?.draftsBySection?.[secId] || '';
              const formattedDraft = formatSectionDraftForDisplay(secId, draft);
              const isCurrentSection = secId === sectionId;

              return (
                <div
                  key={secId}
                  ref={isCurrentSection ? sectionRef : null}
                  className={`document-section ${isCurrentSection ? 'current-section' : ''} ${!isCurrentSection ? 'clickable-section' : ''}`}
                  onClick={() => !isCurrentSection && navigate(`/cases/${caseId}/sections/${secId}`)}
                >
                  <h2 className="section-title">{SECTION_NAMES[secId] || secId}</h2>
                  <div className="section-content-text">{formattedDraft}</div>
                </div>
              );
            })}
          </div>
        </div>

        {renderConversationPanel({
          panelClassName: 'section-chat-panel',
          title: '이 섹션에서 확인할 내용',
          subtitle: isSwitchingSection
            ? '선택한 섹션의 질문과 초안을 불러오는 중입니다.'
            : sectionPanelSubtitle,
          badge: {
            label: sectionBadgeLabel,
            color: sectionBadgeColor
          },
          questions: sectionQuestions,
          questionItems: sectionQuestionItems,
          currentQuestion,
          nextUnansweredQuestion,
          onSelectQuestion: setCurrentQuestion,
          onStartQuestion: handleStartQuestion,
          isAskingQuestion,
          emptyMessage: isSwitchingSection
            ? '선택한 섹션 정보를 불러오는 중입니다.'
            : sectionEmptyMessage,
          hintTitle: '현재 섹션 누락 정보',
          hintItems: sectionMissingInfo,
          updateNotice: isSwitchingSection ? '선택한 섹션 정보를 불러오는 중입니다.' : updateNotice,
          qnaHistory: section?.qnaHistory || [],
          answerText,
          onAnswerChange: setAnswerText,
          onSubmitAnswer: handleSubmitAnswer,
          isSubmitting,
          chatEndRef: sectionChatEndRef,
          hideStartButton:
            isSwitchingSection ||
            Boolean(sectionUiHints?.hideStartButton && !currentQuestion && nextUnansweredQuestion === null)
        })}
      </div>
    </div>
  );
}

export default SectionDetailPage;
