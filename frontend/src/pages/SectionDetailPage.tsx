import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseApi, SectionDetail, Case } from '../services/api';
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  // 현재 섹션의 질문/답변 상태
  const currentQuestion = sectionId ? (sectionStates[sectionId]?.question || null) : null;
  const answerText = sectionId ? (sectionStates[sectionId]?.answer || '') : '';

  const setCurrentQuestion = (question: string | null) => {
    if (sectionId) {
      setSectionStates(prev => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], question }
      }));
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

    setIsAskingQuestion(true);
    try {
      const qnaHistory = section?.qnaHistory || [];
      const userAnswers = qnaHistory.map(qna => ({
        question: qna.question,
        answer: qna.answer
      }));

      const result = await caseApi.getNextQuestion(caseId, sectionId, userAnswers);
      setCurrentQuestion(result.question);
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

      // Reload section and case data
      const [updated, updatedCase] = await Promise.all([
        caseApi.getSectionDetail(caseId, sectionId),
        caseApi.getCase(caseId)
      ]);
      setSection(updated);
      setCaseData(updatedCase);

      // 답변 제출 후에는 답변 텍스트만 초기화 (질문은 유지)
      if (sectionId) {
        setSectionStates(prev => ({
          ...prev,
          [sectionId]: { ...prev[sectionId], answer: '' }
        }));
      }

      // Check if complete or need next question
      if (result.isComplete) {
        setCurrentQuestion(null);
        alert('섹션이 완성되었습니다!');
      } else if (result.nextQuestion) {
        setCurrentQuestion(result.nextQuestion);
      } else {
        // Get next question
        const nextQ = await caseApi.getNextQuestion(caseId, sectionId, [
          ...(section?.qnaHistory || []),
          { question: currentQuestion, answer: answerText }
        ]);
        if (!nextQ.isComplete) {
          setCurrentQuestion(nextQ.question);
        } else {
          setCurrentQuestion(null);
        }
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
                    {draft || '(초안 없음)'}
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
                {section.status}
              </span>
            </div>
          </div>

          <div className="chat-messages">
            {section.qnaHistory.map((qna, idx) => (
              <div key={idx} className="chat-message">
                <div className="message-section-label">
                  {SECTION_NAMES[section.section] || section.section}
                </div>
                <div className="message-question">
                  <div className="message-avatar">Q</div>
                  <div className="message-content">
                    <div className="message-text">{qna.question}</div>
                    <div className="message-time">{new Date(qna.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
                <div className="message-answer">
                  <div className="message-avatar answer">A</div>
                  <div className="message-content">
                    <div className="message-text">{qna.answer}</div>
                    <div className="message-time">{new Date(qna.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              </div>
            ))}

            {currentQuestion && (
              <div className="chat-message">
                <div className="message-section-label">
                  {SECTION_NAMES[section.section] || section.section}
                </div>
                <div className="message-question">
                  <div className="message-avatar">Q</div>
                  <div className="message-content">
                    <div className="message-text">{currentQuestion}</div>
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
                {isAskingQuestion ? '질문 생성 중...' : '질문 시작'}
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
