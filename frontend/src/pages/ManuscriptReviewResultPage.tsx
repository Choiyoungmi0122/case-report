import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import {
  ManuscriptReviewDocument,
  ManuscriptSectionCandidate,
  ManuscriptReviewSectionId,
  manuscriptReviewApi
} from '../services/api';
import './ManuscriptReviewResultPage.css';

const SECTION_LABELS: Record<ManuscriptReviewSectionId, string> = {
  TITLE: '제목',
  KEYWORDS: '키워드',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 결과',
  DISCUSSION_CONCLUSION: '논의 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '사전 동의'
};

function getAdequacyLabel(value: string) {
  switch (value) {
    case 'ADEQUATE':
      return '충분';
    case 'BORDERLINE':
      return '보완 권장';
    default:
      return '부족';
  }
}

function getStatusLabel(value: string) {
  switch (value) {
    case 'READY':
      return '구조 감지';
    case 'INCOMPLETE':
      return '불확실';
    default:
      return '미감지';
  }
}

export default function ManuscriptReviewResultPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const [review, setReview] = useState<ManuscriptReviewDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSubmittingCandidate, setIsSubmittingCandidate] = useState<string | null>(null);
  const [isRerunning, setIsRerunning] = useState(false);

  const loadReview = async (showLoader = false) => {
    if (!reviewId) return;
    if (showLoader) setLoading(true);

    try {
      const nextReview = await manuscriptReviewApi.getReview(reviewId);
      setReview(nextReview);
      setError(null);
    } catch (nextError: any) {
      setError(nextError?.message || '원고 검토 결과를 불러오지 못했습니다.');
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    if (!reviewId) return;
    void loadReview(true);
  }, [reviewId]);

  const pendingCandidates = useMemo(
    () => (review?.sectionCandidates || []).filter((candidate) => candidate.status === 'PENDING'),
    [review]
  );

  const handleConfirm = async (candidate: ManuscriptSectionCandidate, sectionId: ManuscriptReviewSectionId) => {
    if (!reviewId) return;
    setIsSubmittingCandidate(candidate.candidateId);
    setFeedback(null);

    try {
      const result = await manuscriptReviewApi.confirmSectionCandidate(reviewId, candidate.candidateId, sectionId);
      setReview(result.review);
      setFeedback('섹션 후보를 확정하고 CARE review 결과를 다시 계산했습니다.');
    } catch (nextError: any) {
      setError(nextError?.message || '섹션 후보를 확정하지 못했습니다.');
    } finally {
      setIsSubmittingCandidate(null);
    }
  };

  const handleReject = async (candidate: ManuscriptSectionCandidate) => {
    if (!reviewId) return;
    setIsSubmittingCandidate(candidate.candidateId);
    setFeedback(null);

    try {
      const result = await manuscriptReviewApi.rejectSectionCandidate(reviewId, candidate.candidateId);
      setReview(result.review);
      setFeedback('해당 후보를 제외하고 CARE review 결과를 다시 계산했습니다.');
    } catch (nextError: any) {
      setError(nextError?.message || '섹션 후보를 제외하지 못했습니다.');
    } finally {
      setIsSubmittingCandidate(null);
    }
  };

  const handleRerun = async () => {
    if (!reviewId) return;
    setIsRerunning(true);
    setFeedback(null);

    try {
      const result = await manuscriptReviewApi.runReview(reviewId);
      setReview(result.review);
      setFeedback('문서 검토를 다시 실행했습니다.');
    } catch (nextError: any) {
      setError(nextError?.message || '문서 검토를 다시 실행하지 못했습니다.');
    } finally {
      setIsRerunning(false);
    }
  };

  if (loading) {
    return <div className="manuscript-review-result-page manuscript-review-loading">Word 원고를 분석하는 중입니다...</div>;
  }

  if (!review) {
    return <div className="manuscript-review-result-page manuscript-review-loading">{error || '검토 결과를 찾을 수 없습니다.'}</div>;
  }

  return (
    <div className="manuscript-review-result-page">
      <div className="manuscript-review-result-container">
        <div className="manuscript-review-result-header">
          <div>
            <button type="button" className="manuscript-review-link" onClick={() => navigate('/manuscript-review')}>
              다른 Word 원고 업로드
            </button>
            <h1>{review.fileName}</h1>
            <p>EMR evidence 생성 모드와 분리된 manuscript review mode입니다.</p>
          </div>
          <button
            type="button"
            className="manuscript-review-primary"
            onClick={() => void handleRerun()}
            disabled={isRerunning}
          >
            {isRerunning ? '재검토 중...' : 'CARE 검토 다시 실행'}
          </button>
        </div>

        {feedback ? <div className="manuscript-review-feedback">{feedback}</div> : null}
        {error ? <div className="manuscript-review-error">{error}</div> : null}

        <div className="manuscript-review-meta-grid">
          <div className="manuscript-review-meta-card">
            <strong>sourceType</strong>
            <span>{review.sourceType}</span>
          </div>
          <div className="manuscript-review-meta-card">
            <strong>parseStatus</strong>
            <span>{review.parseStatus}</span>
          </div>
          <div className="manuscript-review-meta-card">
            <strong>block 수</strong>
            <span>{review.blocks.length}</span>
          </div>
          <div className="manuscript-review-meta-card">
            <strong>수동 확인 필요</strong>
            <span>{review.manualConfirmationRequired ? '예' : '아니오'}</span>
          </div>
        </div>

        {pendingCandidates.length > 0 ? (
          <section className="manuscript-review-panel">
            <div className="manuscript-review-panel-header">
              <div>
                <h2>자동 섹션 분리 확인 필요</h2>
                <p>아래 문단은 어떤 CARE 섹션으로 볼지 애매해서 사용자 확인이 필요합니다.</p>
              </div>
            </div>

            <div className="manuscript-review-candidate-list">
              {pendingCandidates.map((candidate) => (
                <div key={candidate.candidateId} className="manuscript-review-candidate-card">
                  <div className="manuscript-review-candidate-top">
                    <strong>{candidate.headingText || `문단 후보 ${candidate.candidateId}`}</strong>
                    <span className="manuscript-review-confidence">
                      confidence {candidate.confidence.toFixed(2)}
                    </span>
                  </div>
                  <pre className="manuscript-review-detected-text">{candidate.detectedText}</pre>
                  <div className="manuscript-review-chip-row">
                    {candidate.candidateSections.map((sectionId) => (
                      <button
                        key={`${candidate.candidateId}-${sectionId}`}
                        type="button"
                        className="manuscript-review-chip"
                        disabled={isSubmittingCandidate === candidate.candidateId}
                        onClick={() => void handleConfirm(candidate, sectionId)}
                      >
                        {SECTION_LABELS[sectionId]}
                      </button>
                    ))}
                  </div>
                  <div className="manuscript-review-candidate-actions">
                    <button
                      type="button"
                      className="manuscript-review-secondary"
                      disabled={isSubmittingCandidate === candidate.candidateId}
                      onClick={() => void handleReject(candidate)}
                    >
                      이 후보 제외
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="manuscript-review-panel">
          <div className="manuscript-review-panel-header">
            <div>
              <h2>CARE 섹션별 completeness review</h2>
              <p>detected text, adequacy, missing items, depth issues, suggested questions를 함께 표시합니다.</p>
            </div>
          </div>

          <div className="manuscript-review-section-grid">
            {(review.reviewResults?.sectionResults || []).map((section) => (
              <article key={section.sectionId} className="manuscript-review-section-card">
                <div className="manuscript-review-section-top">
                  <div>
                    <h3>{SECTION_LABELS[section.sectionId]}</h3>
                    <div className="manuscript-review-inline-meta">
                      <span>{getStatusLabel(section.assessmentStatus)}</span>
                      <span>{getAdequacyLabel(section.adequacy)}</span>
                      <span>confidence {section.confidence.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="manuscript-review-field">
                  <strong>detected text</strong>
                  <pre>{renderClinicalAnonymizedText(section.detectedText) || '감지된 텍스트 없음'}</pre>
                </div>

                <div className="manuscript-review-field">
                  <strong>summary</strong>
                  <p>{renderClinicalAnonymizedText(section.summary)}</p>
                </div>

                <div className="manuscript-review-field">
                  <strong>missing items</strong>
                  {section.missingItems.length > 0 ? (
                    <ul>
                      {section.missingItems.map((item, index) => (
                        <li key={`${section.sectionId}-missing-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>추가 누락 항목 없음</p>
                  )}
                </div>

                <div className="manuscript-review-field">
                  <strong>depth issues</strong>
                  {section.depthIssues.length > 0 ? (
                    <ul>
                      {section.depthIssues.map((item, index) => (
                        <li key={`${section.sectionId}-depth-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>깊이 문제 없음</p>
                  )}
                </div>

                <div className="manuscript-review-field">
                  <strong>suggested questions</strong>
                  {section.suggestedQuestions.length > 0 ? (
                    <ul>
                      {section.suggestedQuestions.map((item, index) => (
                        <li key={`${section.sectionId}-question-${index}`}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>제안 질문 없음</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
