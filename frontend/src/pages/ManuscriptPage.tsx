import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ChainProgressBanner from '../components/ChainProgressBanner';
import ChainPerformancePanel from '../components/ChainPerformancePanel';
import PendingTermConfirmationModal from '../components/PendingTermConfirmationModal';
import TimelineDraftView from '../components/TimelineDraftView';
import {
  caseApi,
  Case,
  ExportLayout,
  ExportMode,
  FinalComposeStatus,
  FinalDraft,
  StaleState
} from '../services/api';
import {
  getReviewRequiredDescription,
  getReviewRequiredTitle,
  getStaleReasonLabel
} from '../utils/caseStatusUi';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import { createResearchEventId, logResearchEvent } from '../utils/research';
import { SECTION_NAMES } from '../utils/uiLabels';
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
      return '최종 원고 준비 중';
  }
}

function buildDraftPreviewSections(caseData: Case | null): ManuscriptSection[] {
  const drafts = caseData?.draftsBySection || {};

  return QUESTION_STAGE_SECTIONS.map((sectionId) => ({
    id: sectionId,
    label: getSectionLabel(sectionId),
    text: renderClinicalAnonymizedText(drafts[sectionId]).trim(),
    source: 'draft' as const
  })).filter((section) => section.text);
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export default function ManuscriptPage({ studyMode = false }: { studyMode?: boolean }) {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const writeBasePath = studyMode ? '/study/write' : '';

  const [caseData, setCaseData] = useState<Case | null>(null);
  const [finalDraft, setFinalDraft] = useState<FinalDraft | null>(null);
  const [finalComposeStatus, setFinalComposeStatus] = useState<FinalComposeStatus>({ status: 'IDLE' });
  const [staleState, setStaleState] = useState<StaleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [composeWarning, setComposeWarning] = useState<string | null>(null);
  const [isPendingTermModalOpen, setIsPendingTermModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>('final_manuscript');
  const [exportLayout, setExportLayout] = useState<ExportLayout>('one_paragraph');
  const [isExporting, setIsExporting] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [isExportingResearch, setIsExportingResearch] = useState(false);
  const [hasLoggedFinalView, setHasLoggedFinalView] = useState(false);

  const syncComposeStatus = async () => {
    if (!caseId) return null;

    const statusResult = await caseApi.getFinalComposeStatus(caseId);
    setCaseData((prev) =>
      prev
        ? {
            ...prev,
            title: statusResult.title || prev.title,
            displayTitle: (statusResult as any).displayTitle ?? prev.displayTitle
          }
        : prev
    );
    setFinalDraft(statusResult.finalDraft || null);
    setStaleState(statusResult.staleState || null);
    setComposeWarning((prev) => (statusResult.staleState?.isStale ? prev : null));
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
      setStaleState(result.staleState || null);
      setComposeWarning(result.warning || null);
      setFeedback(
        result.started
          ? '최종 원고 생성을 시작했습니다. 생성이 끝나면 자동으로 최신 내용으로 바뀝니다.'
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
        const caseResult = await caseApi.getCaseSummary(caseId, {
          includeDeidentifiedEMRs: false,
          includePerformanceLogs: true,
          includePendingTerms: true
        });
        if (cancelled) return;

        if ((caseResult.mode || 'write') === 'scaffold') {
          navigate(`/scaffold/cases/${caseId}/summary`, { replace: true });
          return;
        }

        setCaseData(caseResult);
        setFinalDraft(caseResult.finalDraft || null);
        setStaleState(caseResult.staleState || null);
        setComposeWarning(null);
        setFinalComposeStatus(
          caseResult.finalComposeStatus || {
            status: caseResult.finalDraft ? 'COMPLETED' : 'IDLE'
          }
        );
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

    void run();

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

    let cancelled = false;
    let attempt = 0;
    let timer: number | null = null;

    const scheduleNext = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        const statusResult = await syncComposeStatus();
        const nextStatus = getComposeStatus(statusResult?.finalComposeStatus);

        if (nextStatus === 'COMPLETED') {
          setFeedback('최종 원고 생성이 완료되어 최신 내용으로 갱신됐습니다.');
          return;
        }

        if (nextStatus === 'FAILED') {
          setError(
            statusResult?.finalComposeStatus?.errorMessage || '최종 원고 생성 중 오류가 발생했습니다.'
          );
          return;
        }

        attempt += 1;
        const baseDelay = Math.min(2500 + attempt * 1000, 9000);
        const visibilityDelay = document.visibilityState === 'hidden' ? 4000 : 0;
        scheduleNext(baseDelay + visibilityDelay);
      } catch (err: any) {
        attempt += 1;
        setError(err.message || '최종 원고 상태를 확인하는 중 오류가 발생했습니다.');
        scheduleNext(Math.min(5000 + attempt * 1000, 12000));
      }
    };

    scheduleNext(1800);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [caseId, finalComposeStatus]);

  useEffect(() => {
    if (!caseId || !caseData?.chainProgress?.currentStep || caseData.chainProgress.currentStep === 'BLOCKED') {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;

      try {
        const caseResult = await caseApi.getCaseSummary(caseId, {
          includeDeidentifiedEMRs: false,
          includePerformanceLogs: true,
          includePendingTerms: true
        });
        if (cancelled) return;
        setCaseData(caseResult);
        setFinalDraft(caseResult.finalDraft || null);
        setStaleState(caseResult.staleState || null);
        setFinalComposeStatus(
          caseResult.finalComposeStatus || {
            status: caseResult.finalDraft ? 'COMPLETED' : 'IDLE'
          }
        );
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || '케이스 상태를 갱신하는 중 오류가 발생했습니다.');
        }
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [caseId, caseData?.chainProgress?.currentStep, caseData?.chainProgress?.updatedAt]);

  useEffect(() => {
    if (
      !caseId ||
      hasLoggedFinalView ||
      !caseData?.researchState?.sessionId ||
      (!finalDraft && !caseData?.finalDraft)
    ) {
      return;
    }

    setHasLoggedFinalView(true);
    // 최종 원고를 본 것이 세션 종료를 뜻하지는 않는다. session_completed는
    // 연구자가 명시적으로 종료할 때만 기록한다.
    void logResearchEvent(caseId, {
      eventId: createResearchEventId('write-final-output'),
      eventType: 'final_output_viewed',
      sessionId: caseData.researchState.sessionId,
      participantCode: caseData.researchState.participantCode,
      metadata: { finalDraftReady: true }
    });
  }, [caseData?.finalDraft, caseData?.researchState?.participantCode, caseData?.researchState?.sessionId, caseId, finalDraft, hasLoggedFinalView]);

  const generatedTitle = useMemo(() => {
    const raw = finalDraft?.fullTextBySection?.TITLE?.trim() || finalDraft?.titleSuggestions?.[0]?.trim() || '';
    return renderClinicalAnonymizedText(raw).trim();
  }, [finalDraft]);

  // The case title is user-authored, so it never carried privacy placeholders
  // and the renderer alone cannot clean it. The backend supplies a
  // de-identified `displayTitle` for publication-facing use; fall back to the
  // rendered raw title only when it is absent.
  const selectedTitle = useMemo(
    () => renderClinicalAnonymizedText(caseData?.displayTitle ?? caseData?.title).trim(),
    [caseData?.displayTitle, caseData?.title]
  );
  const titleText = selectedTitle || generatedTitle || '최종 원고 생성 중';
  const keywordText = useMemo(
    () => renderClinicalAnonymizedText(finalDraft?.fullTextBySection?.KEYWORDS).trim(),
    [finalDraft]
  );

  const titleSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          (finalDraft?.titleSuggestions || [])
            .map((title) => renderClinicalAnonymizedText(title).trim())
            .filter(Boolean)
        )
      ),
    [finalDraft?.titleSuggestions]
  );

  const questionStageSections = useMemo<ManuscriptSection[]>(() => {
    if (finalDraft) {
      return QUESTION_STAGE_SECTIONS.map((sectionId) => ({
        id: sectionId,
        label: getSectionLabel(sectionId),
        text: renderClinicalAnonymizedText(finalDraft.fullTextBySection?.[sectionId]).trim(),
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
        text: renderClinicalAnonymizedText(finalDraft.fullTextBySection?.[sectionId]).trim(),
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
  const pendingTermCount = (caseData?.pendingTermConfirmations || []).filter(
    (item) => item.status === 'PENDING'
  ).length;
  const manuscriptActionHint = pendingTermCount > 0
    ? `확인이 필요한 전문용어 ${pendingTermCount}건이 있습니다. 먼저 확인하면 최종 원고 재생성 결과가 더 안정적입니다.`
    : staleState?.isStale
      ? '초안이나 근거가 바뀌어 최종 원고를 다시 생성해야 합니다.'
      : '현재 초안과 최종 원고를 비교하며 필요한 때만 다시 생성해 주세요.';

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
        description: finalDraft ? '추천 제목과 완성본 검토 가능' : '생성 완료 후 검토 가능',
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

  /**
   * 연구자가 명시적으로 세션을 종료한다. 브라우저를 그냥 닫은 경우까지
   * 자동 추정하지는 않는다.
   */
  const handleEndResearchSession = async () => {
    const session = caseData?.researchState;
    if (!caseId || !session?.sessionId || session.completedAt) return;

    setIsEndingSession(true);
    setError(null);
    setFeedback(null);

    try {
      const result = await logResearchEvent(caseId, {
        eventId: createResearchEventId('write-session-complete'),
        eventType: 'session_completed',
        sessionId: session.sessionId,
        participantCode: session.participantCode,
        metadata: {
          totalDurationMs: session.startedAt
            ? Date.now() - new Date(session.startedAt).getTime()
            : undefined
        }
      });
      setCaseData((prev) => (prev ? { ...prev, researchState: result.researchState } : prev));
      setFeedback('연구 세션을 종료했습니다.');
    } catch (err: any) {
      setError(err.message || '연구 세션을 종료하지 못했습니다.');
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleExportResearchData = async () => {
    if (!caseId) return;

    setIsExportingResearch(true);
    setError(null);
    setFeedback(null);

    try {
      const payload = await caseApi.exportResearchData(caseId, 'json');
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      downloadBlob(blob, `case_${caseId}_research.json`);
      setFeedback('연구 데이터를 내려받았습니다.');
    } catch (err: any) {
      setError(err.message || '연구 데이터를 내보내지 못했습니다.');
    } finally {
      setIsExportingResearch(false);
    }
  };

  const handleExportDocx = async () => {
    if (!caseId) return;

    setIsExporting(true);
    setError(null);
    setFeedback(null);

    try {
      if (caseData?.researchState?.sessionId) {
        await logResearchEvent(caseId, {
          eventId: createResearchEventId('write-export'),
          eventType: 'export_requested',
          sessionId: caseData.researchState.sessionId,
          participantCode: caseData.researchState.participantCode,
          metadata: { exportMode, exportLayout }
        });
      }
      const result = await caseApi.exportDocx(caseId, exportMode, exportLayout);
      downloadBlob(result.blob, result.fileName);
      setFeedback(`Word 문서를 내려받았습니다. (${result.fileName})`);
    } catch (err: any) {
      setError(err.message || 'Word 문서를 내보내지 못했습니다.');
    } finally {
      setIsExporting(false);
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
            <button onClick={() => navigate(`${writeBasePath}/cases/${caseId}`)} className="btn-back-overview">
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
            <button onClick={() => navigate(studyMode ? '/study/write' : '/write')} className="btn-back-overview">
              {studyMode ? 'Study Write' : 'Write 홈'}
            </button>
            {!studyMode ? (
              <button onClick={() => navigate('/')} className="btn-back-overview">
                모드 선택
              </button>
            ) : null}
            <button onClick={() => navigate(`${writeBasePath}/cases/${caseId}`)} className="btn-back-overview">
              섹션 개요
            </button>
            <button
              onClick={() => requestCompose(true)}
              className="btn-refresh-manuscript"
              disabled={isRefreshing || getComposeStatus(finalComposeStatus) === 'RUNNING'}
            >
              {isRefreshing ? '생성 요청 중...' : '최신 초안으로 다시 생성'}
            </button>
              <div className="manuscript-export-controls">
                <select
                  value={exportMode}
                  onChange={(event) => setExportMode(event.target.value as ExportMode)}
                  className="manuscript-export-select"
              >
                <option value="current_section_drafts">현재 섹션 초안 Word</option>
                <option value="final_manuscript">최종 원고 Word</option>
                <option value="final_manuscript_with_checklist">
                  최종 원고 Word + CARE 체크리스트
                </option>
                  <option value="final_manuscript_with_traceability">
                    최종 원고 Word + 근거 부록
                  </option>
                </select>
                <select
                  value={exportLayout}
                  onChange={(event) => setExportLayout(event.target.value as ExportLayout)}
                  className="manuscript-export-select"
                >
                  <option value="one_paragraph">1단락</option>
                  <option value="two_paragraph">2단락</option>
                </select>
                <button
                  type="button"
                  className="btn-export-docx"
                disabled={
                  isExporting ||
                  (exportMode !== 'current_section_drafts' && !finalDraft && !caseData?.finalDraft)
                }
                onClick={handleExportDocx}
              >
                {isExporting ? 'Word 문서 준비 중...' : 'Word 저장'}
              </button>
            </div>
          </div>
          <div className="manuscript-toolbar-right">
            <span className="manuscript-status">{getComposeStatusLabel(finalComposeStatus)}</span>
          </div>
        </div>
        <p className="manuscript-toolbar-hint">{manuscriptActionHint}</p>

        {/*
          연구 세션(참가자 코드가 연결된 케이스)에서만 노출되는 연구자용 영역.
          일반 사용자 화면에는 나타나지 않는다.
        */}
        {caseData?.researchState?.sessionId ? (
          <div className="manuscript-research-panel">
            <div className="manuscript-research-meta">
              <span>
                참가자 <strong>{caseData.researchState.participantCode || '(코드 없음)'}</strong>
              </span>
              <span>세션 {caseData.researchState.sessionId}</span>
              <span>
                {caseData.researchState.completedAt
                  ? `종료됨 (${new Date(caseData.researchState.completedAt).toLocaleString()})`
                  : '진행 중'}
              </span>
            </div>
            <div className="manuscript-research-actions">
              <button
                type="button"
                className="btn-back-overview"
                disabled={isEndingSession || Boolean(caseData.researchState.completedAt)}
                onClick={() => void handleEndResearchSession()}
              >
                {isEndingSession ? '종료 처리 중...' : '연구 세션 종료'}
              </button>
              <button
                type="button"
                className="btn-back-overview"
                disabled={isExportingResearch}
                onClick={() => void handleExportResearchData()}
              >
                {isExportingResearch ? '내보내는 중...' : '연구 데이터 내보내기 (JSON)'}
              </button>
            </div>
          </div>
        ) : null}

        {feedback ? <div className="manuscript-success">{feedback}</div> : null}
        {error ? <div className="manuscript-error">{error}</div> : null}
        <ChainProgressBanner progress={caseData?.chainProgress} title="현재 처리 진행 상태" />
        <ChainPerformancePanel logs={caseData?.chainPerformanceLogs} title="최근 처리 로그" />

        {composeWarning ? (
          <div className="manuscript-warning-banner">
            <strong>최종 원고 재생성이 권장됩니다.</strong>
            <span>{composeWarning}</span>
            <div className="manuscript-warning-banner-actions">
              <button
                type="button"
                className="btn-refresh-manuscript"
                onClick={() => requestCompose(true)}
              >
                지금 다시 생성
              </button>
              {pendingTermCount > 0 ? (
                <button
                  type="button"
                  className="btn-refresh-manuscript btn-refresh-manuscript-secondary"
                  onClick={() => setIsPendingTermModalOpen(true)}
                >
                  전문용어 확인 {pendingTermCount}건
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {staleState?.isStale ? (
          <div className="manuscript-warning-banner manuscript-warning-banner-strong">
            <strong>현재 표시 중인 최종 원고는 이전 결과일 수 있습니다.</strong>
            <span>{getStaleReasonLabel(staleState.staleReason)}</span>
            <div className="manuscript-warning-banner-actions">
              <button
                type="button"
                className="btn-refresh-manuscript"
                onClick={() => requestCompose(true)}
              >
                최신 원고 다시 생성
              </button>
              {pendingTermCount > 0 ? (
                <button
                  type="button"
                  className="btn-refresh-manuscript btn-refresh-manuscript-secondary"
                  onClick={() => setIsPendingTermModalOpen(true)}
                >
                  전문용어 확인 {pendingTermCount}건
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {caseData?.reviewRequired ? (
          <div className="manuscript-warning-banner manuscript-warning-banner-info">
            <strong>{getReviewRequiredTitle(caseData.reviewRequired)}</strong>
            <span>{getReviewRequiredDescription(caseData.reviewRequired)}</span>
            {pendingTermCount > 0 ? (
              <div className="manuscript-warning-banner-actions">
                <button
                  type="button"
                  className="btn-refresh-manuscript btn-refresh-manuscript-secondary"
                  onClick={() => setIsPendingTermModalOpen(true)}
                >
                  전문용어 확인 {pendingTermCount}건
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingTermCount > 0 ? (
          <div className="manuscript-warning-banner manuscript-warning-banner-neutral">
            <strong>확인되지 않은 전문용어가 {pendingTermCount}건 있습니다.</strong>
            <span>
              여기에서 바로 전문용어를 확인하고 필요하면 최종 원고를 다시 생성할 수 있습니다.
            </span>
            <div className="manuscript-warning-banner-actions">
              <button
                type="button"
                className="btn-refresh-manuscript btn-refresh-manuscript-secondary"
                onClick={() => setIsPendingTermModalOpen(true)}
              >
                전문용어 확인 {pendingTermCount}건
              </button>
            </div>
          </div>
        ) : null}

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
              본문 초안을 먼저 보여주고 있습니다. 제목, 초록, 서론, 논의 및 결론 생성이
              끝나면 자동으로 반영됩니다.
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

          <div className={['manuscript-paper', staleState?.isStale ? 'manuscript-paper-stale' : ''].join(' ').trim()}>
            <header className="manuscript-header">
              <p className="manuscript-kicker">Final Draft</p>
              {caseData?.experiment_code || caseData?.experimentCode ? (
                <p className="manuscript-subtitle">실험번호: {caseData.experiment_code || caseData.experimentCode}</p>
              ) : null}
              {staleState?.isStale ? <span className="manuscript-previous-pill">이전 결과</span> : null}
              <h1 id="section-TITLE">{titleText}</h1>
              {selectedTitle && generatedTitle && selectedTitle !== generatedTitle ? (
                <p className="manuscript-subtitle">자동 생성 제목: {generatedTitle}</p>
              ) : null}
              {hasProgressivePreview ? (
                <p className="manuscript-subtitle">
                  본문 섹션 초안을 먼저 보여주고 있습니다. 자동 생성 섹션은 준비되는 대로
                  채워집니다.
                </p>
              ) : null}
            </header>

            <div className="manuscript-generation-note">
              제목, 키워드, 초록, 서론, 논의 및 결론은 본문 섹션 초안을 바탕으로 자동
              생성됩니다. 본문 초안을 먼저 보여주고, 최종 생성이 끝나면 전체 원고가 최신
              상태로 갱신됩니다.
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
                          {isSelected ? '현재 선택' : isSavingTitle ? '저장 중...' : '이 제목 사용'}
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
                <p>본문 초안을 바탕으로 최종 단계에서 자동 작성되는 섹션입니다.</p>
              </div>

              {finalStageSections.length > 0 ? (
                finalStageSections.map((section) => (
                  <section id={`#section-${section.id}`} key={section.id} className="manuscript-section">
                    <div className="manuscript-section-heading">
                      <div className="manuscript-section-heading-text">
                        <h2>{section.label}</h2>
                        <span className="manuscript-auto-pill">자동 생성</span>
                        {section.status && section.status !== 'FULFILLED' ? (
                          <span className="manuscript-section-note">검토 권장</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="manuscript-body-text">
                        {section.id === 'TIMELINE' ? (
                          <TimelineDraftView
                            rawText={section.text}
                            events={caseData?.timelineEvents || []}
                            showImportedTable={false}
                          />
                        ) : (
                          section.text
                        )}
                    </div>
                  </section>
                ))
              ) : (
                FINAL_STAGE_SECTIONS.filter((sectionId) => sectionId !== 'TITLE' && sectionId !== 'KEYWORDS').map(
                  (sectionId) => (
                    <section
                      id={`section-${sectionId}`}
                      key={sectionId}
                      className="manuscript-section manuscript-placeholder-section"
                    >
                      <div className="manuscript-section-heading">
                        <div className="manuscript-section-heading-text">
                          <h2>{getSectionLabel(sectionId)}</h2>
                          <span className="manuscript-auto-pill">생성 대기</span>
                        </div>
                      </div>
                      <div className="manuscript-placeholder-text">
                        이 섹션은 본문 초안을 바탕으로 자동 생성됩니다.
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
                      ? '최종 원고가 완성되기 전에 현재 본문 초안을 먼저 확인할 수 있습니다.'
                      : '질문과 답변으로 직접 보완하는 본문 섹션입니다.'}
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
                    <div className="manuscript-body-text">
                        {section.id === 'TIMELINE' ? (
                          <TimelineDraftView
                            rawText={section.text}
                            events={caseData?.timelineEvents || []}
                            showImportedTable={false}
                          />
                        ) : (
                          section.text
                        )}
                    </div>
                  </section>
                ))}
              </section>
            ) : null}
          </div>
        </div>

        {caseId ? (
          <PendingTermConfirmationModal
            caseId={caseId}
            isOpen={isPendingTermModalOpen}
            onClose={() => setIsPendingTermModalOpen(false)}
            onResolved={async (result) => {
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
              setStaleState(result.staleState || null);
              setFinalComposeStatus(result.finalComposeStatus || { status: 'IDLE' });
              setFinalDraft(result.finalDraft || null);
              setFeedback(
                result.httpStatus === 202
                  ? '전문용어 선택을 저장했고, 지금 반영 중입니다.'
                  : '전문용어 확인 결과를 반영했습니다.'
              );
              setError(null);
            }}
            pendingTerms={caseData?.pendingTermConfirmations || []}
          />
        ) : null}
      </div>
    </div>
  );
}
