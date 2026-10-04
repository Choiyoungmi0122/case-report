import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ChainProgressBanner from '../components/ChainProgressBanner';
import ChainPerformancePanel from '../components/ChainPerformancePanel';
import PendingTermConfirmationModal from '../components/PendingTermConfirmationModal';
import TimelineImportModal from '../components/TimelineImportModal';
import {
  Case,
  caseApi,
  PendingTermConfirmation,
  SectionOverview,
  TimelineEvent,
  TimelineImportResponse
} from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import {
  getReviewRequiredDescription,
  getReviewRequiredTitle,
  getStaleReasonLabel
} from '../utils/caseStatusUi';
import {
  DEFAULT_TIMELINE_COLUMNS,
  SECTION_NAMES,
  SECTION_STATUS_LABELS
} from '../utils/uiLabels';
import { getModeBasePath } from '../utils/research';
import './CaseOverviewPage.css';

const QUESTION_STAGE_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE'
] as const;

const STATUS_COLORS: Record<string, string> = {
  IMPOSSIBLE: 'var(--danger)',
  INCOMPLETE: 'var(--warning)',
  READY: 'var(--success)',
  PARTIAL_IMPOSSIBLE: 'var(--warning)',
  PARTIAL_POSSIBLE: 'var(--warning)',
  POSSIBLE: 'var(--warning)',
  FULLY_POSSIBLE: 'var(--success)',
  AUTO: 'var(--neutral)'
};

function getProblematicPhiEntries(caseData: Case | null) {
  return (caseData?.deidentifiedEMRs || [])
    .flatMap((record) =>
      (record.phiSpans || []).map((span) => ({
        visitIndex: record.visitIndex,
        visitDate: record.visitDate,
        riskLevel: record.riskLevel,
        ...span
      }))
    )
    .filter((span) => (caseData?.reviewRequired?.riskLevel === 'HIGH' ? true : span.confidence < 0.95))
    .slice(0, 12);
}

function renderTimelineCell(value?: string | number | null) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function getTimelineColumns(events: TimelineEvent[]) {
  const explicit = events.find(
    (event) => Array.isArray(event.columnOrder) && event.columnOrder.length > 0
  )?.columnOrder;
  if (explicit && explicit.length > 0) return explicit;
  return DEFAULT_TIMELINE_COLUMNS;
}

function getTimelineCellValue(event: TimelineEvent, header: string) {
  if (event.cells && header in event.cells) {
    return renderTimelineCell(event.cells[header]);
  }

  switch (header) {
    case '시점':
      return renderTimelineCell(event.date);
    case '방문차수':
      return renderTimelineCell(event.visitNo);
    case '주요 증상':
      return renderTimelineCell(event.symptom);
    case '검사/평가':
      return renderTimelineCell(event.test);
    case '진단/판단':
      return renderTimelineCell(event.diagnosis);
    case '치료':
      return renderTimelineCell(event.treatment);
    case '경과':
      return renderTimelineCell(event.outcome);
    case '비고':
      return renderTimelineCell(event.note);
    default:
      return '-';
  }
}

export default function CaseOverviewPage({ studyMode = false }: { studyMode?: boolean }) {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();

  const [sections, setSections] = useState<SectionOverview[]>([]);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [pendingTerms, setPendingTerms] = useState<PendingTermConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isPendingTermModalOpen, setIsPendingTermModalOpen] = useState(false);
  const [isTimelineImportModalOpen, setIsTimelineImportModalOpen] = useState(false);
  const [timelineImportFeedback, setTimelineImportFeedback] = useState<TimelineImportResponse | null>(
    null
  );

  const loadData = async (showLoader = false) => {
    if (!caseId) return;

    if (showLoader) {
      setLoading(true);
    }

      try {
        const nextCase = await caseApi.getCaseSummary(caseId, {
          includeDeidentifiedEMRs: true,
          includePendingTerms: true,
          includePerformanceLogs: false
        });

        if ((nextCase.mode || 'write') === 'scaffold') {
          navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}`, { replace: true });
          return;
        }

        setSections(nextCase.sectionsOverview || []);
        setCaseData(nextCase);
      setPendingTerms(nextCase.pendingTermConfirmations || []);
      // Keep the edit field empty for untitled cases; 'CARE 섹션 목록' is only a display fallback and
      // must not be saved as the case title.
      setTitleValue(nextCase.title || '');
      setError(null);

      void caseApi
        .getCaseSummary(caseId, {
          includeDeidentifiedEMRs: false,
          includePendingTerms: false,
          includePerformanceLogs: true
        })
        .then((logCase) => {
          setCaseData((prev) =>
            prev
              ? {
                  ...prev,
                  chainPerformanceLogs: logCase.chainPerformanceLogs || prev.chainPerformanceLogs
                }
              : prev
          );
        })
        .catch(() => {
          // Keep the fast path result even if the deferred log fetch fails.
        });
    } catch (nextError: any) {
      setError(nextError?.message || '케이스 정보를 불러오지 못했습니다.');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!caseId) return;
    void loadData(true);
  }, [caseId]);

  useEffect(() => {
    if (!caseId || !caseData?.chainProgress?.currentStep || caseData.chainProgress.currentStep === 'BLOCKED') {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void loadData(false);
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [caseId, caseData?.chainProgress?.currentStep, caseData?.chainProgress?.updatedAt]);

  const handleSaveTitle = async () => {
    if (!caseId || !titleValue.trim()) return;

    setIsSavingTitle(true);
    setError(null);
    setFeedback(null);

    try {
      await caseApi.updateCaseTitle(caseId, titleValue.trim());
      setCaseData((prev) => (prev ? { ...prev, title: titleValue.trim() } : prev));
      setFeedback('케이스 제목을 저장했습니다.');
      setIsEditingTitle(false);
    } catch (nextError: any) {
      setError(nextError?.message || '제목을 저장하지 못했습니다.');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleCancelTitleEdit = () => {
    setTitleValue(caseData?.title || '');
    setIsEditingTitle(false);
  };

  const questionStageSections = useMemo(
    () =>
      sections.filter((section) =>
        QUESTION_STAGE_SECTIONS.includes(section.section as (typeof QUESTION_STAGE_SECTIONS)[number])
      ),
    [sections]
  );

  const problematicPhiEntries = useMemo(() => getProblematicPhiEntries(caseData), [caseData]);
  const pendingCount = pendingTerms.filter((item) => item.status === 'PENDING').length;
  const timelineEvents = caseData?.timelineEvents || [];
  const timelineColumns = getTimelineColumns(timelineEvents);
  const latestTimelineFeedback = timelineImportFeedback;
  const overviewActionHint = caseData?.reviewRequired
    ? '개인정보 검토가 끝나면 다시 처리할 수 있습니다.'
    : pendingCount > 0
      ? `확인이 필요한 전문용어 ${pendingCount}건이 있습니다. 먼저 확인하면 초안과 최종 원고가 더 안정적으로 갱신됩니다.`
      : caseData?.staleState?.isStale
        ? '초안이 바뀌어 최종 원고를 다시 생성해야 합니다.'
        : '';

  if (loading) {
    return (
      <div className="case-overview-page">
        <div className="container">케이스 정보를 불러오는 중입니다...</div>
      </div>
    );
  }

  if (error && !caseData) {
    return (
      <div className="case-overview-page">
        <div className="container">
          <div className="error-message">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="case-overview-page">
      <div className="container">
        <div className="header">
          <div className="header-top">
            <div className="header-top-actions">
              <div className="header-top-actions-secondary">
                <button type="button" onClick={() => navigate(getModeBasePath('write', studyMode))} className="btn-home">
                  {studyMode ? 'Study Write' : 'Write 홈'}
                </button>
                {!studyMode ? (
                  <button type="button" onClick={() => navigate('/')} className="btn-home">
                    모드 선택
                  </button>
                ) : null}
              </div>
              <div className="header-top-actions-primary">
                <button
                  type="button"
                  onClick={() => navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}/manuscript`)}
                  className="btn-manuscript"
                >
                  최종 원고 확인
                </button>
              </div>
            </div>
            {overviewActionHint ? <p className="header-top-hint">{overviewActionHint}</p> : null}
          </div>

          <div className="header-title-section">
            {caseData?.experiment_code || caseData?.experimentCode ? (
              <p className="case-id">실험번호: {caseData.experiment_code || caseData.experimentCode}</p>
            ) : null}
            <p className="case-id">Case ID: {caseId}</p>
            {isEditingTitle ? (
              <div className="title-edit-box">
                <input
                  type="text"
                  value={titleValue}
                  onChange={(event) => setTitleValue(event.target.value)}
                  className="title-input"
                  placeholder="케이스 제목을 입력해 주세요."
                  autoFocus
                />
                <div className="title-edit-actions">
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    disabled={isSavingTitle || !titleValue.trim()}
                    className="btn-save-title"
                  >
                    {isSavingTitle ? '저장 중...' : '저장'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelTitleEdit}
                    disabled={isSavingTitle}
                    className="btn-cancel-title"
                  >
                    취소
                  </button>
                </div>
              </div>
              ) : (
                <div className="title-display-box">
                  <h1>{caseData?.title || 'CARE 섹션 목록'}</h1>
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(true)}
                    className="btn-edit-title"
                    title="제목 수정"
                  >
                    수정
                  </button>
                </div>
              )}
            </div>
        </div>

        {feedback ? <div className="status-panel status-panel-success">{feedback}</div> : null}
        {error ? <div className="error-message">{error}</div> : null}
        <ChainProgressBanner progress={caseData?.chainProgress} />
        <ChainPerformancePanel logs={caseData?.chainPerformanceLogs} />

        {caseData?.staleState?.isStale ? (
          <div className="status-panel status-panel-warning">
            <div className="status-panel-header">
              <div>
                <h3>기존 결과가 최신 상태가 아닙니다.</h3>
                <p>{getStaleReasonLabel(caseData.staleState.staleReason)}</p>
              </div>
              <div className="header-top-actions">
                {pendingCount > 0 ? (
                  <button
                    type="button"
                    className="btn-status-action"
                    onClick={() => setIsPendingTermModalOpen(true)}
                  >
                    전문용어 확인 {pendingCount}건
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-status-action"
                  onClick={() => navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}/manuscript`)}
                >
                  최종 원고 확인
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {caseData?.reviewRequired ? (
          <div
            className={[
              'status-panel',
              caseData.reviewRequired.riskLevel === 'HIGH'
                ? 'status-panel-danger'
                : 'status-panel-review'
            ].join(' ')}
          >
            <div className="status-panel-header">
              <div>
                <h3>{getReviewRequiredTitle(caseData.reviewRequired)}</h3>
                <p>{getReviewRequiredDescription(caseData.reviewRequired)}</p>
              </div>
              <div className="header-top-actions">
                <span
                  className={
                    caseData.reviewRequired.riskLevel === 'HIGH'
                      ? 'risk-pill risk-pill-high'
                      : 'risk-pill risk-pill-medium'
                  }
                >
                  {caseData.reviewRequired.riskLevel}
                </span>
                {pendingCount > 0 ? (
                  <button
                    type="button"
                    className="btn-status-action"
                    onClick={() => setIsPendingTermModalOpen(true)}
                  >
                    전문용어 확인 {pendingCount}건
                  </button>
                ) : null}
              </div>
            </div>

            {caseData.reviewRequired.reasons?.length ? (
              <ul className="status-bullet-list">
                {caseData.reviewRequired.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`}>{reason}</li>
                ))}
              </ul>
            ) : null}

            {problematicPhiEntries.length > 0 ? (
              <div className="phi-review-list">
                {problematicPhiEntries.map((span, index) => (
                  <div
                    key={`${span.originalText}-${span.startIndex}-${index}`}
                    className="phi-review-item"
                  >
                    <div className="phi-review-top">
                      <strong>{span.type}</strong>
                      <span>{span.originalText}</span>
                      <span className="phi-arrow">→</span>
                      <span>{span.replacement}</span>
                    </div>
                    <div className="phi-review-meta">
                      방문 {span.visitIndex + 1}회 · {span.visitDate || '날짜 미상'} · confidence{' '}
                      {span.confidence.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="status-panel-footer">
              EMR의 개인정보 표기를 수정하거나 현재 비식별화 결과를 검토한 뒤 다시 처리해 주세요.
            </div>
          </div>
        ) : null}

        <div className="status-panel status-panel-neutral">
          <div className="status-panel-header">
            <div>
              <h3>애매한 전문용어 확인</h3>
              <p>
                후보가 여러 개인 전문용어는 확인 전까지 draft와 최종 원고에 자동 반영되지
                않습니다.
              </p>
            </div>
            <span className="risk-pill risk-pill-neutral">확인 필요 {pendingCount}건</span>
          </div>

          {pendingTerms.length === 0 ? (
            <div className="empty-sections-state">현재 확인이 필요한 전문용어가 없습니다.</div>
          ) : (
            <div className="status-panel-footer">
              <button
                type="button"
                className="btn-status-action"
                onClick={() => setIsPendingTermModalOpen(true)}
              >
                전문용어 확인 {pendingCount}건
              </button>
            </div>
          )}
        </div>

        <div className="status-panel timeline-summary-panel">
          <div className="status-panel-header">
            <div>
              <h3>타임라인 Excel 가져오기</h3>
              <p>
                Excel 표 형태의 timeline을 업로드하면 Timeline 섹션 초안과 미리보기에
                반영됩니다.
              </p>
            </div>
            <button
              type="button"
              className="btn-status-action"
              onClick={() => setIsTimelineImportModalOpen(true)}
            >
              Excel 업로드
            </button>
          </div>

          {latestTimelineFeedback ? (
            <div className="timeline-import-feedback">
              <strong>최근 가져오기 결과</strong>
              <p>
                불러온 행 {latestTimelineFeedback.importedRows}개 / 건너뛴 행{' '}
                {latestTimelineFeedback.skippedRows}개
              </p>
            </div>
          ) : null}

          {timelineEvents.length > 0 ? (
            <div className="timeline-preview-table-wrap">
              <table className="timeline-preview-table">
                <thead>
                  <tr>
                    {timelineColumns.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timelineEvents.slice(0, 8).map((event: TimelineEvent) => (
                    <tr key={event.timelineEventId}>
                      {timelineColumns.map((header) => (
                        <td key={`${event.timelineEventId}-${header}`}>
                          {getTimelineCellValue(event, header)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {timelineEvents.length > 8 ? (
                <div className="timeline-preview-caption">
                  총 {timelineEvents.length}개 이벤트 중 최근 8개만 미리 보여줍니다.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-sections-state">아직 import된 timeline event가 없습니다.</div>
          )}
        </div>

        {questionStageSections.length === 0 ? (
          <div className="empty-sections-state">
            현재 표시할 질문 단계 섹션이 없습니다. 초기 처리 결과를 다시 확인해 주세요.
          </div>
        ) : (
          <>
            <div className="section-group-header">
              <h2>질문 및 보완 섹션</h2>
              <p>본문 초안을 직접 보완하는 섹션입니다.</p>
            </div>

            <div className="sections-grid">
              {questionStageSections.map((section) => (
                <div
                  key={section.section}
                  className="section-card"
                  onClick={() => navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}/sections/${section.section}`)}
                >
                  <div className="section-header">
                    <h3>{SECTION_NAMES[section.section] || section.section}</h3>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[section.status] || 'var(--neutral)' }}
                    >
                      {SECTION_STATUS_LABELS[section.status] || section.status}
                    </span>
                  </div>

                  <div className="section-rationale">
                    <strong>판정 근거</strong>
                    <p>{section.rationaleText}</p>
                  </div>

                  {section.draftSnippet ? (
                    <div className="section-draft-preview">
                      <strong>초안 미리보기</strong>
                      <p>{renderClinicalAnonymizedText(section.draftSnippet)}...</p>
                    </div>
                  ) : null}

                  <div className="section-footer">
                    <span className="click-hint">클릭하여 섹션 보완</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {caseId ? (
          <>
            <PendingTermConfirmationModal
              caseId={caseId}
              isOpen={isPendingTermModalOpen}
              onClose={() => setIsPendingTermModalOpen(false)}
              onResolved={async (result) => {
                setPendingTerms(result.pendingTermConfirmations || []);
                setSections(result.sectionsOverview || []);
                setCaseData((prev) =>
                  prev
                    ? {
                        ...prev,
                        draftsBySection: result.draftsBySection || prev.draftsBySection,
                        pendingTermConfirmations: result.pendingTermConfirmations || [],
                        reviewRequired: result.reviewRequired || null,
                        chainProgress: result.chainProgress || prev.chainProgress || null,
                        staleState: result.staleState || prev.staleState,
                        finalComposeStatus: result.finalComposeStatus || prev.finalComposeStatus,
                        finalDraft: result.finalDraft || null
                      }
                    : prev
                );
                setFeedback(
                  result.httpStatus === 202
                    ? '전문용어 선택을 저장했고, 지금 반영 중입니다.'
                    : '전문용어 확인 결과를 반영했습니다.'
                );
                setError(null);
              }}
              pendingTerms={pendingTerms}
            />

            <TimelineImportModal
              caseId={caseId}
              isOpen={isTimelineImportModalOpen}
              onClose={() => setIsTimelineImportModalOpen(false)}
              onImported={async (result: TimelineImportResponse) => {
                setTimelineImportFeedback(result);
                setSections(result.sectionsOverview || []);
                setCaseData((prev) =>
                  prev
                    ? {
                        ...prev,
                        timelineEvents: result.timelineEvents || prev.timelineEvents,
                        draftsBySection: result.draftsBySection || prev.draftsBySection,
                        sectionStates: result.sectionStates || prev.sectionStates,
                        commonQuestionSets: result.commonQuestionSets || prev.commonQuestionSets,
                        commonMissingItems: result.commonMissingItems || prev.commonMissingItems,
                        staleState: result.staleState || prev.staleState,
                        finalComposeStatus: result.finalComposeStatus || prev.finalComposeStatus,
                        finalDraft: result.finalDraft || null
                      }
                    : prev
                );
                setFeedback(
                  `타임라인 Excel 가져오기가 완료되었습니다. 불러온 행 ${result.importedRows}개 / 건너뛴 행 ${result.skippedRows}개`
                );
                setError(null);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
