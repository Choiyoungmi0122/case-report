import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseApi, SectionDetail, Case } from '../services/api';
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
  FULLY_POSSIBLE: '작성 완료'
};

function SectionDetailPage() {
  const { caseId, sectionId } = useParams<{ caseId: string; sectionId: string }>();
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionDetail | null>(null);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 섹션별로 질문/답변 상태 저장
  const [sectionStates, setSectionStates] = useState<Record<string, { question: string | null; answer: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [sectionQuestions, setSectionQuestions] = useState<string[]>([]);
  const [commonQuestions, setCommonQuestions] = useState<string[]>([]);
  const [, setSectionMissingInfo] = useState<string[]>([]);
  const [, setCommonMissingInfo] = useState<string[]>([]);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  // 현재 섹션의 질문/답변 상태
  const currentQuestion = sectionId ? (sectionStates[sectionId]?.question || null) : null;
  const answerText = sectionId ? (sectionStates[sectionId]?.answer || '') : '';

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
        answered: answeredQuestionKeys.has(normalizeQuestionKey(question))
      })),
    [commonQuestions, answeredQuestionKeys]
  );

  const nextUnansweredQuestion =
    sectionQuestionItems.find((item) => !item.answered)?.question ||
    commonQuestionItems.find((item) => !item.answered)?.question ||
    null;

  const setCurrentQuestion = (question: string | null) => {
    if (sectionId) {
      setSectionStates(prev => ({
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
      setSectionStates(prev => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], answer: text }
      }));
    }
  };

  useEffect(() => {
    if (!caseId || !sectionId) return;

    const loadData = async () => {
      try {
        const [sectionData, caseDataResult] = await Promise.all([
          caseApi.getSectionDetail(caseId, sectionId),
          caseApi.getCase(caseId)
        ]);
        setSection(sectionData);
        setCaseData(caseDataResult);
        setSectionQuestions(
          (sectionData.sectionQuestions || sectionData.recommendedQuestions || []).map(ensureKoreanQuestion)
        );
        setCommonQuestions((sectionData.commonQuestions || []).map(ensureKoreanQuestion));
        setSectionMissingInfo(sectionData.sectionMissingInfo || sectionData.missingInfoBullets || []);
        setCommonMissingInfo(sectionData.commonMissingInfo || []);
        // 섹션별 질문/답변 상태 초기화 (없는 경우만, 있으면 유지)
        if (sectionId) {
          setSectionStates(prev => {
            if (!prev[sectionId]) {
              return {
                ...prev,
                [sectionId]: { question: null, answer: '' }
              };
            }
            return prev; // 이미 있으면 유지
          });
        }
      } catch (err: any) {
        setError(err.message || '데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [caseId, sectionId]);

  useEffect(() => {
    setUpdateNotice(null);
  }, [sectionId]);

  // Scroll to current section when loaded
  useEffect(() => {
    if (sectionRef.current) {
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sectionId, caseData]);

  // Scroll chat to bottom when new message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [section?.qnaHistory, currentQuestion]);

  const handleStartQuestion = async () => {
    if (!caseId || !sectionId) return;

    if (nextUnansweredQuestion) {
      setCurrentQuestion(nextUnansweredQuestion);
      return;
    }

    setIsAskingQuestion(true);
    try {
      const qnaHistory = section?.qnaHistory || [];
      const userAnswers = qnaHistory.map(qna => ({
        question: qna.question,
        answer: qna.answer
      }));

      const result = await caseApi.getNextQuestion(caseId, sectionId, userAnswers);
      const nextSectionQuestions = (result.sectionQuestions || []).map(ensureKoreanQuestion);
      const nextCommonQuestions = (result.commonQuestions || []).map(ensureKoreanQuestion);
      setSectionQuestions(nextSectionQuestions);
      setCommonQuestions(nextCommonQuestions);
      setSectionMissingInfo(result.sectionMissingInfo || []);
      setCommonMissingInfo(result.commonMissingInfo || []);
      const preferredQuestion =
        nextSectionQuestions[0] || nextCommonQuestions[0] || ensureKoreanQuestion(result.question);
      setCurrentQuestion(preferredQuestion || null);
      if (!preferredQuestion) {
        setUpdateNotice('현재 이 섹션에서 추가로 확인할 질문이 없습니다.');
      }
    } catch (err: any) {
      setError(err.message || '질문 생성 중 오류가 발생했습니다.');
    } finally {
      setIsAskingQuestion(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!caseId || !sectionId || !answerText.trim() || !currentQuestion) return;

    setIsSubmitting(true);
    try {
      const result = await caseApi.submitAnswer(
        caseId,
        sectionId,
        answerText,
        currentQuestion
      );
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

      // Instant merge: apply updated drafts so user sees change immediately (no refetch delay)
      if (result.updatedDraftsBySection && Object.keys(result.updatedDraftsBySection).length > 0) {
        setCaseData((prev) => ({
          ...prev,
          draftsBySection: {
            ...(prev?.draftsBySection || {}),
            ...result.updatedDraftsBySection
          }
        } as Case));
      }
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

      setUpdateNotice('초안이 업데이트되었습니다. 왼쪽 문서 미리보기에서 변경 내용을 확인하고, 필요하면 다음 질문을 이어서 선택하세요.');

      // 답변 제출 후에는 답변 텍스트만 초기화 (질문은 유지)
      if (sectionId) {
        setSectionStates(prev => ({
          ...prev,
          [sectionId]: { ...prev[sectionId], answer: '' }
        }));
      }

      // Lightweight path: show updated draft immediately and let the user request the next question manually.
      if (result.lightweight) {
        setCurrentQuestion(null);
      } else if (result.isComplete) {
        setCurrentQuestion(null);
        alert('섹션이 완성되었습니다!');
      } else if (result.nextQuestion) {
        const preferredQuestion =
          (result.sectionQuestions && result.sectionQuestions.length > 0
            ? ensureKoreanQuestion(result.sectionQuestions[0])
            : null) ||
          (result.commonQuestions && result.commonQuestions.length > 0
            ? ensureKoreanQuestion(result.commonQuestions[0])
            : null) ||
          ensureKoreanQuestion(result.nextQuestion);
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

  if (loading) {
    return (
      <div className="section-detail-page">
        <div className="container">로딩 중...</div>
      </div>
    );
  }

  if (error || !section) {
    return (
      <div className="section-detail-page">
        <div className="container">
          <div className="error-message">{error || '섹션을 찾을 수 없습니다.'}</div>
        </div>
      </div>
    );
  }

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

  return (
    <div className="section-detail-page">
      <div className="header-bar">
        <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back">
          ← 목록으로
        </button>
        <h1>{SECTION_NAMES[section.section] || section.section}</h1>
      </div>

      <div className="two-column-layout">
        {/* Left: Full Document Preview */}
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
                  <h2 className="section-title">
                    {SECTION_NAMES[secId] || secId}
                  </h2>
                  <div className="section-content-text">
                    {formattedDraft}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Chat Interface */}
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-title">
              <h2>{SECTION_NAMES[section.section] || section.section}</h2>
              <span className="chat-subtitle">질문 및 답변</span>
            </div>
            <div className="section-status-info">
              <span className="status-badge-small" style={{ backgroundColor: section.status === 'FULLY_POSSIBLE' ? '#28a745' : section.status === 'POSSIBLE' ? '#17a2b8' : '#ffc107' }}>
                {STATUS_LABELS[section.status] || section.status}
              </span>
            </div>
          </div>

          {(sectionQuestions.length > 0 || commonQuestions.length > 0) && (
            <div className="question-priority-panel">
              {sectionQuestions.length > 0 && (
                <div className="question-priority-group">
                  <h3>현재 섹션 우선 질문</h3>
                  <p className="question-group-description">현재 섹션 초안을 보완하는 데 직접 도움이 되는 질문입니다.</p>
                  <div className="question-chip-list">
                    {sectionQuestionItems.map(({ question, answered }, idx) => (
                      <button
                        key={`section-q-${idx}`}
                        type="button"
                        className={`question-chip ${currentQuestion === question ? 'active' : ''} ${answered ? 'answered' : ''}`}
                        onClick={() => !answered && setCurrentQuestion(question)}
                        disabled={answered}
                      >
                        {question}
                        {answered && <span className="question-chip-status">답변 완료</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {commonQuestions.length > 0 && (
                <div className="question-priority-group">
                  <h3>공통 보완 질문</h3>
                  <p className="question-group-description">여러 섹션에 영향을 줄 수 있는 보조 질문입니다.</p>
                  <div className="question-chip-list">
                    {commonQuestionItems.map(({ question, answered }, idx) => (
                      <button
                        key={`common-q-${idx}`}
                        type="button"
                        className={`question-chip question-chip-common ${currentQuestion === question ? 'active' : ''} ${answered ? 'answered' : ''}`}
                        onClick={() => !answered && setCurrentQuestion(question)}
                        disabled={answered}
                      >
                        {question}
                        {answered && <span className="question-chip-status">답변 완료</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!currentQuestion && nextUnansweredQuestion === null && (
                <div className="question-empty-state">
                  현재 이 섹션에서 추가로 확인할 질문이 없습니다.
                </div>
              )}
            </div>
          )}

          {updateNotice && <div className="question-update-notice">{updateNotice}</div>}

          <div className="chat-messages">
            {section.qnaHistory.map((qna, idx) => (
              <div key={idx} className="chat-message">
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
              <button
                onClick={handleStartQuestion}
                disabled={isAskingQuestion}
                className="btn-start-question"
              >
                {isAskingQuestion
                  ? '질문 생성 중...'
                  : nextUnansweredQuestion
                    ? '다음 질문 보기'
                    : section?.qnaHistory.length
                      ? '추가 질문 확인'
                      : '질문 시작'}
              </button>
            ) : (
              <div className="input-box">
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="답변을 입력하세요..."
                  rows={3}
                  className="answer-input"
                />
                <button
                  onClick={handleSubmitAnswer}
                  disabled={isSubmitting || !answerText.trim()}
                  className="btn-submit-answer"
                >
                  {isSubmitting ? '제출 중...' : '제출'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SectionDetailPage;
