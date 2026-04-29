import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, Case, FinalComposeStatus, FinalDraft } from '../services/api';
import './ManuscriptPage.css';

const QUESTION_STAGE_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
] as const;

const FINAL_STAGE_SECTIONS = [
  'TITLE',
  'KEYWORDS',
  'ABSTRACT',
  'INTRODUCTION',
  'DISCUSSION_CONCLUSION',
  'INFORMED_CONSENT'
] as const;

const QUESTION_STAGE_SET = new Set<string>(QUESTION_STAGE_SECTIONS);

const SECTION_NAMES: Record<string, string> = {
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
  DISCUSSION_CONCLUSION: '고찰 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '사전 동의'
};

type ManuscriptSection = {
  id: string;
  label: string;
  text: string;
  status?: 'FULFILLED' | 'INSUFFICIENT' | 'MISSING';
  rationale?: string;
  source: 'final' | 'draft';
};

function getSectionLabel(sectionId: string) {
  return SECTION_NAMES[sectionId] || sectionId;
}

function getComposeStatus(status?: FinalComposeStatus | null) {
  return status?.status || 'IDLE';
}

function getComposeStatusLabel(status?: FinalComposeStatus | null) {
  switch (getComposeStatus(status)) {
    case 'QUEUED':
      return '최종 원고 생성 대기 중';
    case 'RUNNING':
      return '최종 원고 생성 중';
    case 'COMPLETED':
      return '최종 원고 준비 완료';
    case 'FAILED':
      return '최종 원고 생성 실패';
    default:
      return '최종 원고 준비 전';
  }
}

function buildDraftPreviewSections(caseData: Case | null): ManuscriptSection[] {
  const drafts = caseData?.draftsBySection || {};

  return QUESTION_STAGE_SECTIONS.map((sectionId) => ({
    id: sectionId,
    label: getSectionLabel(sectionId),
    text: drafts[sectionId]?.trim() || '',
    source: 'draft' as const
  })).filter((section) => section.text);
}

export default function ManuscriptPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();

  const [caseData, setCaseData] = useState<Case | null>(null);
  const [finalDraft, setFinalDraft] = useState<FinalDraft | null>(null);
  const [finalComposeStatus, setFinalComposeStatus] = useState<FinalComposeStatus>({ status: 'IDLE' });
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const syncComposeStatus = async () => {
    if (!caseId) return null;

    const statusResult = await caseApi.getFinalComposeStatus(caseId);
    setCaseData((prev) => (prev ? { ...prev, title: statusResult.title || prev.title } : prev));
    setFinalDraft(statusResult.finalDraft || null);
    setFinalComposeStatus(statusResult.finalComposeStatus || { status: 'IDLE' });
    return statusResult;
  };

  const requestCompose = async (showRefreshState = false) => {
    if (!caseId) return;

    if (showRefreshState) {
      setIsRefreshing(true);
    }

    setError(null);

    try {
      const result = await caseApi.composeFinalDraft(caseId);
      setFinalComposeStatus(result.finalComposeStatus || { status: 'QUEUED' });
      setFeedback(
        result.started
          ? '최종 원고 생성을 시작했습니다. 생성이 완료되면 자동으로 최신 원고가 반영됩니다.'
          : '이미 최종 원고 생성이 진행 중입니다. 완료되면 자동으로 갱신됩니다.'
      );
    } catch (err: any) {
      setError(err.message || '최종 원고 생성을 시작하지 못했습니다.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!caseId) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const caseResult = await caseApi.getCase(caseId);
        if (cancelled) return;

        setCaseData(caseResult);
        setFinalDraft(caseResult.finalDraft || null);
        setFinalComposeStatus(
          caseResult.finalComposeStatus || {
            status: caseResult.finalDraft ? 'COMPLETED' : 'IDLE'
          }
        );

        const currentStatus = getComposeStatus(caseResult.finalComposeStatus);
        if (!caseResult.finalDraft && currentStatus !== 'QUEUED' && currentStatus !== 'RUNNING') {
          await requestCompose();
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || '최종 원고 화면을 불러오는 중 오류가 발생했습니다.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;

    const status = getComposeStatus(finalComposeStatus);
    if (status !== 'QUEUED' && status !== 'RUNNING') {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const statusResult = await syncComposeStatus();
        const nextStatus = getComposeStatus(statusResult?.finalComposeStatus);

        if (nextStatus === 'COMPLETED') {
          setFeedback('최종 원고 생성이 완료되어 최신 내용으로 갱신했습니다.');
        } else if (nextStatus === 'FAILED') {
          setError(
            statusResult?.finalComposeStatus?.errorMessage ||
              '최종 원고 생성 중 오류가 발생했습니다.'
          );
        }
      } catch (err: any) {
        setError(err.message || '최종 원고 상태를 확인하는 중 오류가 발생했습니다.');
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [caseId, finalComposeStatus]);

  const generatedTitle = useMemo(() => {
    return (
      finalDraft?.fullTextBySection?.TITLE?.trim() ||
      finalDraft?.titleSuggestions?.[0]?.trim() ||
      ''
    );
  }, [finalDraft]);

  const selectedTitle = useMemo(() => {
    return caseData?.title?.trim() || '';
  }, [caseData?.title]);

  const titleText = selectedTitle || generatedTitle || '최종 원고 생성 중';

  const keywordText = useMemo(() => {
    return finalDraft?.fullTextBySection?.KEYWORDS?.trim() || '';
  }, [finalDraft]);

  const titleSuggestions = useMemo(() => {
    return Array.from(
      new Set((finalDraft?.titleSuggestions || []).map((title) => title.trim()).filter(Boolean))
    );
  }, [finalDraft?.titleSuggestions]);

  const questionStageSections = useMemo<ManuscriptSection[]>(() => {
    if (finalDraft) {
      return QUESTION_STAGE_SECTIONS.map((sectionId) => ({
        id: sectionId,
        label: getSectionLabel(sectionId),
        text: finalDraft.fullTextBySection?.[sectionId]?.trim() || '',
        status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
        rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale,
        source: 'final' as const
      })).filter((section) => section.text);
    }

    return buildDraftPreviewSections(caseData);
  }, [caseData, finalDraft]);

  const finalStageSections = useMemo<ManuscriptSection[]>(() => {
    if (!finalDraft) return [];

    return FINAL_STAGE_SECTIONS.filter((sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS')
      .map((sectionId) => ({
        id: sectionId,
        label: getSectionLabel(sectionId),
        text: finalDraft.fullTextBySection?.[sectionId]?.trim() || '',
        status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
        rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale,
        source: 'final' as const
      }))
      .filter((section) => section.text);
  }, [finalDraft]);

  const insufficientQuestionSections = useMemo(() => {
    if (!finalDraft) return [];

    return QUESTION_STAGE_SECTIONS.map((sectionId) => ({
      id: sectionId,
      label: getSectionLabel(sectionId),
      status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
      rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale
    })).filter((section) => section.status && section.status !== 'FULFILLED');
  }, [finalDraft]);

  const insufficientFinalSections = useMemo(() => {
    if (!finalDraft) return [];

    return FINAL_STAGE_SECTIONS.filter((sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS')
      .map((sectionId) => ({
        id: sectionId,
        label: getSectionLabel(sectionId),
        status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
        rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale
      }))
      .filter((section) => section.status && section.status !== 'FULFILLED');
  }, [finalDraft]);

  const hasProgressivePreview = !finalDraft && questionStageSections.length > 0;
  const isComposeInFlight =
    getComposeStatus(finalComposeStatus) === 'QUEUED' || getComposeStatus(finalComposeStatus) === 'RUNNING';
  const finalStageReadyCount = finalStageSections.length;
  const totalFinalStageCount = FINAL_STAGE_SECTIONS.filter(
    (sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS'
  ).length;
  const progressSteps = useMemo(
    () => [
      {
        key: 'body',
        label: '본문 초안 준비',
        description: `${questionStageSections.length}개 섹션 표시 가능`,
        state: questionStageSections.length > 0 ? 'done' : 'current'
      },
      {
        key: 'generated',
        label: '자동 섹션 생성',
        description: `${finalStageReadyCount}/${totalFinalStageCount}개 생성`,
        state: finalDraft
          ? 'done'
          : isComposeInFlight
            ? 'current'
            : questionStageSections.length > 0
              ? 'upcoming'
              : 'current'
      },
      {
        key: 'review',
        label: '최종 원고 검토',
        description: finalDraft
          ? '추천 제목과 완성본 검토 가능'
          : '생성 완료 후 검토 가능',
        state: finalDraft ? 'done' : 'upcoming'
      }
    ] as const,
    [finalDraft, finalStageReadyCount, isComposeInFlight, questionStageSections.length, totalFinalStageCount]
  );

  const handleSelectTitle = async (title: string) => {
    if (!caseId || !title.trim()) return;

    setIsSavingTitle(true);
    setError(null);
    setFeedback(null);

    try {
      await caseApi.updateCaseTitle(caseId, title.trim());
      setCaseData((prev) => (prev ? { ...prev, title: title.trim() } : prev));
      setFeedback('추천 제목을 현재 케이스 제목으로 저장했습니다.');
    } catch (err: any) {
      setError(err.message || '제목 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingTitle(false);
    }
  };

  if (loading) {
    return (
      <div className="manuscript-page">
        <div className="manuscript-container">최종 원고 화면을 준비하는 중입니다...</div>
      </div>
    );
  }

  if (error && !finalDraft && !hasProgressivePreview) {
    return (
      <div className="manuscript-page">
        <div className="manuscript-container">
          <div className="manuscript-error">{error}</div>
          <div className="manuscript-error-actions">
            <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back-overview">
              섹션 개요로 돌아가기
            </button>
            <button onClick={() => requestCompose(true)} className="btn-refresh-manuscript">
              다시 생성 시작
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="manuscript-page">
      <div className="manuscript-container">
        <div className="manuscript-toolbar">
          <div className="manuscript-toolbar-left">
            <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back-overview">
              섹션 개요
            </button>
            <button
              onClick={() => requestCompose(true)}
              className="btn-refresh-manuscript"
              disabled={isRefreshing || getComposeStatus(finalComposeStatus) === 'RUNNING'}
            >
              {isRefreshing ? '생성 요청 중...' : '최신 초안으로 다시 생성'}
            </button>
          </div>
          <div className="manuscript-toolbar-right">
            <span className="manuscript-status">{getComposeStatusLabel(finalComposeStatus)}</span>
          </div>
        </div>

        {feedback ? <div className="manuscript-success">{feedback}</div> : null}
        {error ? <div className="manuscript-error">{error}</div> : null}

        {isComposeInFlight ? (
          <div
            className={[
              'manuscript-job-banner',
              getComposeStatus(finalComposeStatus) === 'RUNNING'
                ? 'manuscript-job-banner-running'
                : 'manuscript-job-banner-queued'
            ].join(' ')}
          >
            <strong>{getComposeStatusLabel(finalComposeStatus)}</strong>
            <span>
              본문 초안은 먼저 보여주고 있습니다. 제목, 초록, 서론, 고찰 및 결론은 생성이 끝나는 즉시
              자동으로 반영됩니다.
            </span>
          </div>
        ) : null}

        <div className="manuscript-progress-panel">
          <div className="manuscript-progress-header">
            <div>
              <h3>생성 진행 상태</h3>
              <p>본문 초안을 먼저 보여주고, 자동 생성 섹션은 준비되는 대로 채워집니다.</p>
            </div>
            <div className="manuscript-progress-summary">
              <span>본문 {questionStageSections.length}개</span>
              <span>자동 섹션 {finalStageReadyCount}/{totalFinalStageCount}</span>
            </div>
          </div>
          <div className="manuscript-progress-steps">
            {progressSteps.map((step, index) => (
              <div
                key={step.key}
                className={[
                  'manuscript-progress-step',
                  step.state === 'done'
                    ? 'manuscript-progress-step-done'
                    : step.state === 'current'
                      ? 'manuscript-progress-step-current'
                      : 'manuscript-progress-step-upcoming'
                ].join(' ')}
              >
                <div className="manuscript-progress-step-top">
                  <span className="manuscript-progress-step-index">{index + 1}</span>
                  <strong>{step.label}</strong>
                </div>
                <p>{step.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="manuscript-layout">
          <aside className="manuscript-sidebar">
            <div className="manuscript-sidebar-card">
              <h3>문서 목차</h3>
              <nav className="manuscript-toc">
                <a href="#section-TITLE" className="manuscript-toc-link">
                  제목
                </a>
                {keywordText ? (
                  <a href="#section-KEYWORDS" className="manuscript-toc-link">
                    키워드
                  </a>
                ) : null}

                <div className="manuscript-toc-group-label">자동 생성 섹션</div>
                {FINAL_STAGE_SECTIONS.filter((sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS').map(
                  (sectionId) => (
                    <a key={sectionId} href={`#section-${sectionId}`} className="manuscript-toc-link">
                      {getSectionLabel(sectionId)}
                    </a>
                  )
                )}

                <div className="manuscript-toc-group-label">본문 기반 섹션</div>
                {questionStageSections.map((section) => (
                  <a key={section.id} href={`#section-${section.id}`} className="manuscript-toc-link">
                    {section.label}
                  </a>
                ))}
              </nav>
            </div>

            {finalDraft && insufficientQuestionSections.length > 0 ? (
              <div className="manuscript-sidebar-card">
                <h3>보완이 필요한 본문 섹션</h3>
                <ul className="manuscript-warning-list">
                  {insufficientQuestionSections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        className="manuscript-inline-link"
                        onClick={() => navigate(`/cases/${caseId}/sections/${section.id}`)}
                      >
                        {section.label} 보완하기
                      </button>
                      {section.rationale ? (
                        <p className="manuscript-warning-rationale">{section.rationale}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {finalDraft && insufficientFinalSections.length > 0 ? (
              <div className="manuscript-sidebar-card">
                <h3>자동 생성 섹션 참고</h3>
                <ul className="manuscript-warning-list">
                  {insufficientFinalSections.map((section) => (
                    <li key={section.id}>
                      <div className="manuscript-static-label">{section.label}</div>
                      {section.rationale ? (
                        <p className="manuscript-warning-rationale">{section.rationale}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>

          <div className="manuscript-paper">
            <header className="manuscript-header">
              <p className="manuscript-kicker">Final Draft</p>
              <h1 id="section-TITLE">{titleText}</h1>
              {selectedTitle && generatedTitle && selectedTitle !== generatedTitle ? (
                <p className="manuscript-subtitle">자동 생성 제목: {generatedTitle}</p>
              ) : null}
              {hasProgressivePreview ? (
                <p className="manuscript-subtitle">
                  본문 섹션 초안을 먼저 표시하는 중입니다. 자동 생성 섹션은 완료되는 대로 채워집니다.
                </p>
              ) : null}
            </header>

            <div className="manuscript-generation-note">
              제목, 키워드, 초록, 서론, 고찰 및 결론은 본문 섹션 초안을 바탕으로 자동 생성됩니다.
              본문 초안은 먼저 보여주고, 최종 생성이 끝나면 전체 원고가 최신 상태로 갱신됩니다.
            </div>

            {titleSuggestions.length > 0 ? (
              <section className="manuscript-support-panel">
                <div className="manuscript-title-panel-header">
                  <div>
                    <h3>추천 제목</h3>
                    <p>아래 제목 중 하나를 선택하면 현재 케이스 제목으로 저장됩니다.</p>
                  </div>
                </div>
                <div className="manuscript-title-list">
                  {titleSuggestions.map((title, idx) => {
                    const isSelected = selectedTitle ? selectedTitle === title : titleText === title;

                    return (
                      <div
                        key={`${title}-${idx}`}
                        className={[
                          'manuscript-title-card',
                          isSelected ? 'manuscript-title-card-selected' : ''
                        ].join(' ')}
                      >
                        <div className="manuscript-title-card-text">{title}</div>
                        <button
                          type="button"
                          className="btn-select-title"
                          disabled={isSavingTitle || isSelected}
                          onClick={() => handleSelectTitle(title)}
                        >
                          {isSelected ? '현재 선택됨' : isSavingTitle ? '저장 중...' : '이 제목 사용'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {keywordText ? (
              <section id="section-KEYWORDS" className="manuscript-support-panel">
                <h3>키워드</h3>
                <div className="manuscript-body-text">{keywordText}</div>
              </section>
            ) : null}

            <section className="manuscript-stage-block">
              <div className="manuscript-stage-header">
                <h2>자동 생성 섹션</h2>
                <p>본문 초안을 바탕으로 후반 단계에서 자동 작성되는 섹션입니다.</p>
              </div>

              {finalStageSections.length > 0 ? (
                finalStageSections.map((section) => (
                  <section id={`section-${section.id}`} key={section.id} className="manuscript-section">
                    <div className="manuscript-section-heading">
                      <div className="manuscript-section-heading-text">
                        <h2>{section.label}</h2>
                        <span className="manuscript-auto-pill">자동 생성</span>
                        {section.status && section.status !== 'FULFILLED' ? (
                          <span className="manuscript-section-note">검토 권장</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="manuscript-body-text">{section.text}</div>
                  </section>
                ))
              ) : (
                FINAL_STAGE_SECTIONS.filter((sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS').map(
                  (sectionId) => (
                    <section id={`section-${sectionId}`} key={sectionId} className="manuscript-section manuscript-placeholder-section">
                      <div className="manuscript-section-heading">
                        <div className="manuscript-section-heading-text">
                          <h2>{getSectionLabel(sectionId)}</h2>
                          <span className="manuscript-auto-pill">생성 대기</span>
                        </div>
                      </div>
                      <div className="manuscript-placeholder-text">
                        이 섹션은 본문 초안을 바탕으로 자동 생성 중입니다.
                      </div>
                    </section>
                  )
                )
              )}
            </section>

            {questionStageSections.length > 0 ? (
              <section className="manuscript-stage-block">
                <div className="manuscript-stage-header">
                  <h2>본문 기반 섹션</h2>
                  <p>
                    {hasProgressivePreview
                      ? '최종 원고가 완성되기 전에도 현재 본문 초안을 먼저 확인할 수 있습니다.'
                      : '질문과 답변으로 직접 보완하는 핵심 본문 섹션입니다.'}
                  </p>
                </div>

                {questionStageSections.map((section) => (
                  <section id={`section-${section.id}`} key={section.id} className="manuscript-section">
                    <div className="manuscript-section-heading">
                      <div className="manuscript-section-heading-text">
                        <h2>{section.label}</h2>
                        {section.source === 'draft' ? (
                          <span className="manuscript-draft-pill">본문 초안 미리보기</span>
                        ) : null}
                        {section.status && section.status !== 'FULFILLED' ? (
                          <span className="manuscript-section-note">추가 보완 가능</span>
                        ) : null}
                      </div>
                      {QUESTION_STAGE_SET.has(section.id) ? (
                        <button
                          type="button"
                          className="btn-edit-section"
                          onClick={() => navigate(`/cases/${caseId}/sections/${section.id}`)}
                        >
                          이 섹션 보완하기
                        </button>
                      ) : null}
                    </div>
                    <div className="manuscript-body-text">{section.text}</div>
                  </section>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
