import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ScaffoldPageFrame from '../components/scaffold/ScaffoldPageFrame';
import {
  caseApi,
  type ScaffoldStateResponse,
  type ScaffoldV2CaseNote,
  type ScaffoldV2CaseNoteType,
  type ScaffoldV2Claim,
  type ScaffoldV2ClaimConfidence,
  type ScaffoldV2ClaimType,
  type ScaffoldV2EvidenceReflection,
  type ScaffoldV2LearnerEvidence,
  type ScaffoldV2Phase
} from '../services/api';
import {
  SECTION_GROUP_DESCRIPTIONS,
  SCAFFOLD_SECTIONS,
  getSectionsByGroup,
  type SectionGroup,
  CARE_EXAMPLE_RECORD,
  CARE_OVERVIEW,
  CARE_WRITING_EXAMPLES,
  STUDY_SECTION_IDS
} from '../utils/scaffoldUi';
import './ScaffoldOverviewPage.css';

type StudentSectionStatus = 'not_started' | 'in_progress' | 'ai_review' | 'completed';

const PHASES: Array<{
  id: ScaffoldV2Phase;
  number: number;
  label: string;
  shortDescription: string;
}> = [
  { id: 'case_understanding', number: 1, label: '증례 이해', shortDescription: '자유 메모와 궁금한 점' },
  { id: 'core_message', number: 2, label: '핵심 메시지', shortDescription: '증례표상과 교육점' },
  { id: 'claim_evidence', number: 3, label: '주장·근거 연결', shortDescription: '근거의 역할과 재사용' },
  { id: 'section_drafting', number: 4, label: '원고 작성', shortDescription: 'CARE 섹션 구성' },
  { id: 'final_review', number: 5, label: '최종 검토', shortDescription: '일관성과 누락 확인' }
];

const CLAIM_TYPE_LABELS: Record<ScaffoldV2ClaimType, string> = {
  presentation: '환자 상태',
  diagnosis: '진단 판단',
  intervention: '치료 선택',
  outcome: '치료 결과',
  novelty: '증례 의의'
};

const CLAIM_CONFIDENCE_LABELS: Record<ScaffoldV2ClaimConfidence, string> = {
  high: '높음',
  medium: '중간',
  low: '낮음',
  unresolved: '판단 보류'
};

const GROUP_TITLES: Record<SectionGroup, string> = {
  record_facts: '기록 정보',
  clinical_process: '임상 판단',
  additional_authoring: '종합 서술'
};

function getStudentStatus(progress: any): StudentSectionStatus {
  if (!progress) return 'not_started';
  if (
    progress.recordReviewCompleted &&
    progress.missingInfoReviewCompleted &&
    progress.draftRevealed &&
    progress.draftReviewCompleted
  ) {
    return 'completed';
  }
  if (progress.draftRevealed) return 'ai_review';
  if (progress.recordReviewCompleted || progress.missingInfoReviewCompleted) return 'in_progress';
  return 'not_started';
}

function getStatusLabel(status: StudentSectionStatus) {
  if (status === 'completed') return '완료';
  if (status === 'ai_review') return 'AI 초안 검토 중';
  if (status === 'in_progress') return '내 판단 작성 중';
  return '시작 전';
}

function getSectionButtonLabel(status: StudentSectionStatus) {
  if (status === 'completed') return '다시 보기';
  if (status === 'not_started') return '작성 시작';
  return '계속 작성';
}

function parseMultiline(value: string) {
  return Array.from(
    new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function createClaim(): ScaffoldV2Claim {
  return {
    id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'presentation',
    text: '',
    rationale: '',
    evidenceIds: [],
    targetSectionIds: [],
    confidence: 'unresolved',
    missingInformation: ''
  };
}

function evidenceText(card: NonNullable<ScaffoldStateResponse['evidenceCards']>[number]) {
  return card.normalizedText || card.sourceText || '';
}

export default function ScaffoldOverviewPage({ studyMode = false }: { studyMode?: boolean }) {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ScaffoldStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [currentPhase, setCurrentPhase] = useState<ScaffoldV2Phase>('case_understanding');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [evidenceReflections, setEvidenceReflections] = useState<ScaffoldV2EvidenceReflection[]>([]);
  const [learnerAddedEvidence, setLearnerAddedEvidence] = useState<ScaffoldV2LearnerEvidence[]>([]);
  const [evidenceFeedbackRevealedAt, setEvidenceFeedbackRevealedAt] = useState<string | undefined>();
  const [caseNotes, setCaseNotes] = useState<ScaffoldV2CaseNote[]>([]);
  const [noteFeedbackRevealedAt, setNoteFeedbackRevealedAt] = useState<string | undefined>();
  const [newCaseNoteType, setNewCaseNoteType] = useState<ScaffoldV2CaseNoteType>('observation');
  const [newCaseNoteText, setNewCaseNoteText] = useState('');
  const [problemRepresentation, setProblemRepresentation] = useState('');
  const [reportabilityRationale, setReportabilityRationale] = useState('');
  const [teachingPointsDraft, setTeachingPointsDraft] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [claims, setClaims] = useState<ScaffoldV2Claim[]>([]);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;

    const loadScaffold = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextData = await caseApi.getScaffoldState(caseId);
        if (cancelled) return;
        if (nextData.mode !== 'scaffold') {
          navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}`, { replace: true });
          return;
        }
        setData(nextData);
      } catch (nextError: any) {
        if (cancelled) return;
        setError(nextError.message || 'Scaffold 정보를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadScaffold();
    return () => {
      cancelled = true;
    };
  }, [caseId, navigate, studyMode]);

  useEffect(() => {
    const caseMap = data?.scaffoldState.caseMap;
    if (!caseMap) return;
    setCurrentPhase(caseMap.currentPhase);
    setSelectedEvidenceIds(caseMap.selectedEvidenceIds || []);
    setEvidenceReflections(caseMap.evidenceReflections || []);
    setLearnerAddedEvidence(caseMap.learnerAddedEvidence || []);
    setEvidenceFeedbackRevealedAt(caseMap.evidenceFeedbackRevealedAt);
    setCaseNotes(caseMap.caseNotes || []);
    setNoteFeedbackRevealedAt(caseMap.noteFeedbackRevealedAt);
    setProblemRepresentation(caseMap.problemRepresentation || '');
    setReportabilityRationale(caseMap.reportabilityRationale || '');
    setTeachingPointsDraft((caseMap.teachingPoints || []).join('\n'));
    setTargetAudience(caseMap.targetAudience || '');
    setClaims(caseMap.claims || []);
  }, [data?.scaffoldState.caseMap]);

  const evidenceItems = useMemo(
    () => {
      const generatedItems = (data?.evidenceCards || [])
        .filter((card) => card.evidenceType !== 'learner_added_scaffold')
        .filter((card) => Boolean(card.id && evidenceText(card)))
        .map((card) => ({
          ...card,
          id: String(card.id),
          text: evidenceText(card)
        }));
      const learnerItems = learnerAddedEvidence.map((item) => ({
        ...item,
        normalizedText: item.sourceText,
        evidenceType: 'learner_added_scaffold',
        tags: [] as string[],
        sectionHints: [] as string[],
        text: item.sourceText
      }));
      return [...generatedItems, ...learnerItems];
    },
    [data, learnerAddedEvidence]
  );

  const observationNotes = caseNotes.filter((note) => note.type === 'observation');
  const questionNotes = caseNotes.filter((note) => note.type === 'question');

  // 실험용 경로에서는 정해진 몇 개 항목만 다룬다.
  const studySectionIds = useMemo(
    () =>
      STUDY_SECTION_IDS.filter((id) => (data?.sectionStates || []).some((state) => state.sectionId === id)),
    [data]
  );

  const completedCount = useMemo(
    () =>
      (data?.scaffoldState.sectionProgress || []).filter(
        (progress) =>
          (!studyMode || studySectionIds.includes(progress.sectionId)) &&
          progress.recordReviewCompleted &&
          progress.missingInfoReviewCompleted &&
          progress.draftRevealed &&
          progress.draftReviewCompleted
      ).length,
    [data, studyMode, studySectionIds]
  );

  const totalSections = studyMode ? studySectionIds.length : data?.sectionStates?.length || 0;
  const validClaims = claims.filter(
    (claim) => claim.text.trim() && claim.evidenceIds.length > 0 && claim.targetSectionIds.length > 0
  );
  const unresolvedClaims = claims.filter(
    (claim) => claim.confidence === 'unresolved' || Boolean(claim.missingInformation?.trim())
  );
  const teachingPoints = parseMultiline(teachingPointsDraft);

  const phaseComplete: Record<ScaffoldV2Phase, boolean> = {
    case_understanding: observationNotes.some((note) => note.text.trim().length > 0),
    core_message: Boolean(
      problemRepresentation.trim() && reportabilityRationale.trim() && teachingPoints.length > 0
    ),
    claim_evidence: validClaims.length > 0,
    section_drafting: totalSections > 0 && completedCount >= totalSections,
    final_review: totalSections > 0 && completedCount >= totalSections && unresolvedClaims.length === 0
  };

  const logEvent = async (
    eventType: 'case_map_saved' | 'workflow_phase_changed' | 'claim_map_saved',
    metadata?: Record<string, unknown>
  ) => {
    if (!caseId) return;
    try {
      await caseApi.logScaffoldEvent(caseId, { eventType, metadata });
    } catch (eventError) {
      console.error(`Failed to log ${eventType}:`, eventError);
    }
  };

  const persistCaseMap = async (
    nextPhase = currentPhase,
    successMessage = '저장되었습니다.',
    // 방금 바뀐 메모를 바로 저장할 때 쓴다. state는 다음 렌더에서야 바뀌기 때문이다.
    notesOverride?: ScaffoldV2CaseNote[]
  ) => {
    if (!caseId) return false;
    setSaving(true);
    setError(null);
    try {
      const result = await caseApi.updateScaffoldCaseMap(caseId, {
        currentPhase: nextPhase,
        selectedEvidenceIds,
        evidenceReflections,
        learnerAddedEvidence,
        evidenceFeedbackRevealedAt: evidenceFeedbackRevealedAt || null,
        caseNotes: notesOverride || caseNotes,
        noteFeedbackRevealedAt: noteFeedbackRevealedAt || null,
        problemRepresentation,
        reportabilityRationale,
        teachingPoints,
        targetAudience,
        claims: claims.filter((claim) => claim.text.trim())
      });
      setData((previous) =>
        previous ? { ...previous, scaffoldState: result.scaffoldState } : previous
      );
      setCurrentPhase(nextPhase);
      setFeedback(successMessage);
      window.setTimeout(() => setFeedback(null), 2400);
      await logEvent(nextPhase === 'claim_evidence' ? 'claim_map_saved' : 'case_map_saved', {
        phase: nextPhase,
        noteCount: caseNotes.length,
        selectedEvidenceCount: selectedEvidenceIds.length,
        claimCount: claims.filter((claim) => claim.text.trim()).length
      });
      return true;
    } catch (nextError: any) {
      setError(nextError.message || 'Scaffold v2 내용을 저장하지 못했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changePhase = async (nextPhase: ScaffoldV2Phase) => {
    if (nextPhase === currentPhase || saving) return;
    const previousPhase = currentPhase;
    const saved = await persistCaseMap(nextPhase, '작업 내용을 저장했습니다.');
    if (saved) await logEvent('workflow_phase_changed', { from: previousPhase, to: nextPhase });
  };

  const continueTo = async (nextPhase: ScaffoldV2Phase) => {
    // 실험용 경로에서는 메모가 없어도 다음 단계로 넘어갈 수 있다.
    const memoOptional = studyMode && currentPhase === 'case_understanding';
    if (!memoOptional && !phaseComplete[currentPhase]) {
      const messages: Partial<Record<ScaffoldV2Phase, string>> = {
        case_understanding: '눈에 띈 점을 메모로 하나 이상 남겨주세요.',
        core_message: '증례표상, 보고 가치, 핵심 교육 메시지를 모두 작성해주세요.',
        claim_evidence: '근거와 CARE 섹션이 연결된 주장을 하나 이상 완성해주세요.'
      };
      setError(messages[currentPhase] || '현재 단계를 먼저 완료해주세요.');
      return;
    }
    await changePhase(nextPhase);
  };

  const syncEvidenceIdsFromNotes = (nextNotes: ScaffoldV2CaseNote[]) => {
    setSelectedEvidenceIds(
      Array.from(
        new Set([
          ...evidenceReflections.map((item) => item.evidenceId),
          ...nextNotes.flatMap((note) => note.sourceEvidenceIds),
          ...claims.flatMap((claim) => claim.evidenceIds)
        ])
      )
    );
  };

  const addCaseNote = () => {
    const text = newCaseNoteText.trim();
    if (!text) {
      setError('메모 내용을 입력해주세요.');
      return;
    }
    const nextNote: ScaffoldV2CaseNote = {
      id: `case-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: newCaseNoteType,
      text,
      sourceEvidenceIds: [],
      createdAt: new Date().toISOString()
    };
    const nextNotes = [...caseNotes, nextNote];
    setCaseNotes(nextNotes);
    syncEvidenceIdsFromNotes(nextNotes);
    setNewCaseNoteText('');
    setNoteFeedbackRevealedAt(undefined);
    setError(null);
    // 추가하는 즉시 저장한다. 새로고침하거나 창을 닫아도 메모가 남는다.
    void persistCaseMap(currentPhase, '메모를 저장했습니다.', nextNotes);
  };

  // AI 메모 추천을 내 메모로 가져온다. id에 'ai'와 추천 id를 넣어 두어
  // 나중에 학습자가 직접 쓴 메모와 구분할 수 있게 한다.
  const AI_NOTE_PREFIX = 'case-note-ai-';
  const isSuggestionAdded = (suggestionId: string) =>
    caseNotes.some((note) => note.id.startsWith(`${AI_NOTE_PREFIX}${suggestionId}-`));

  const addSuggestedNote = (suggestion: { id: string; type: ScaffoldV2CaseNote['type']; text: string }) => {
    if (isSuggestionAdded(suggestion.id)) return;
    const nextNotes = [
      ...caseNotes,
      {
        id: `${AI_NOTE_PREFIX}${suggestion.id}-${Date.now()}`,
        type: suggestion.type,
        text: suggestion.text,
        sourceEvidenceIds: [],
        createdAt: new Date().toISOString()
      }
    ];
    setCaseNotes(nextNotes);
    syncEvidenceIdsFromNotes(nextNotes);
    setNoteFeedbackRevealedAt(undefined);
    setError(null);
    void persistCaseMap(currentPhase, '추천 메모를 내 메모에 추가했습니다.', nextNotes);
  };

  const visitListRef = useRef<HTMLDivElement | null>(null);
  const jumpToVisit = (index: number) => {
    const container = visitListRef.current;
    const target = container?.querySelector<HTMLDetailsElement>(`[data-visit-index="${index}"]`);
    if (!container || !target) return;
    target.open = true;
    // 목록 안에서의 실제 위치 차이만큼 옮긴다. 부드러운 스크롤은 창이 가려져 있으면 멈추므로 쓰지 않는다.
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  };

  const updateCaseNote = (noteId: string, updates: Partial<ScaffoldV2CaseNote>) => {
    const nextNotes = caseNotes.map((note) =>
      note.id === noteId ? { ...note, ...updates } : note
    );
    setCaseNotes(nextNotes);
    syncEvidenceIdsFromNotes(nextNotes);
    setNoteFeedbackRevealedAt(undefined);
  };

  const removeCaseNote = (noteId: string) => {
    const nextNotes = caseNotes.filter((note) => note.id !== noteId);
    setCaseNotes(nextNotes);
    syncEvidenceIdsFromNotes(nextNotes);
    setNoteFeedbackRevealedAt(undefined);
    void persistCaseMap(currentPhase, '메모를 삭제했습니다.', nextNotes);
  };

  const revealNoteFeedback = () => {
    if (caseNotes.length === 0) {
      setError('먼저 자신의 메모를 하나 이상 작성해주세요.');
      return;
    }
    setNoteFeedbackRevealedAt(new Date().toISOString());
    setError(null);
  };

  const updateClaim = (claimId: string, updates: Partial<ScaffoldV2Claim>) => {
    setClaims((previous) =>
      previous.map((claim) => (claim.id === claimId ? { ...claim, ...updates } : claim))
    );
  };

  const toggleClaimEvidence = (claimId: string, evidenceId: string) => {
    const claim = claims.find((item) => item.id === claimId);
    if (!claim) return;
    updateClaim(claimId, {
      evidenceIds: claim.evidenceIds.includes(evidenceId)
        ? claim.evidenceIds.filter((id) => id !== evidenceId)
        : [...claim.evidenceIds, evidenceId]
    });
  };

  const toggleClaimSection = (claimId: string, sectionId: string) => {
    const claim = claims.find((item) => item.id === claimId);
    if (!claim) return;
    updateClaim(claimId, {
      targetSectionIds: claim.targetSectionIds.includes(sectionId)
        ? claim.targetSectionIds.filter((id) => id !== sectionId)
        : [...claim.targetSectionIds, sectionId]
    });
  };

  if (loading) return <div className="scaffold-v2-loading">Scaffold v2를 불러오는 중입니다...</div>;
  if (!data) return <div className="scaffold-v2-error">{error || '데이터를 찾을 수 없습니다.'}</div>;

  // 실험용 경로에서는 '기록 읽기 -> CARE 섹션 작성' 두 단계만 보여준다.
  // 핵심 메시지, 주장·근거 연결, 주장 중심 전체 검토는 일반 학습 경로에만 둔다.
  const visiblePhases = studyMode
    ? PHASES.filter((phase) => phase.id === 'case_understanding' || phase.id === 'section_drafting')
    : PHASES;
  const currentPhaseIndex = Math.max(
    0,
    visiblePhases.findIndex((phase) => phase.id === currentPhase)
  );
  const visits = data.visits || [];
  const aiComparisonCandidates = evidenceItems
    .filter((item) => item.evidenceType !== 'learner_added_scaffold')
    .slice(0, 3);

  return (
    <ScaffoldPageFrame>
      <main className="scaffold-v2">
        <header className="scaffold-v2__header">
          <div>
            <div className="scaffold-v2__kicker">Scaffold v2</div>
            <h1>{data.title || '증례보고 작성'}</h1>
            <p>{studyMode ? '환자 기록을 먼저 읽고, CARE 항목별로 내 정리와 AI 초안을 비교합니다.' : '전체 증례의 근거와 핵심 메시지를 먼저 구성한 뒤 CARE 원고로 전환합니다.'}</p>
          </div>
          <div className="scaffold-v2__case-meta">
            <span>실험번호</span>
            <strong>{data.experiment_code || data.experimentCode || '일반 학습'}</strong>
          </div>
        </header>

        <nav
          className="scaffold-v2__phases"
          aria-label="Scaffold v2 진행 단계"
          style={{ gridTemplateColumns: `repeat(${visiblePhases.length}, minmax(0, 1fr))` }}
        >
          {visiblePhases.map((phase, index) => {
            const isCurrent = phase.id === currentPhase;
            const isDone = phaseComplete[phase.id];
            return (
              <button
                key={phase.id}
                type="button"
                className={`scaffold-v2__phase${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => void changePhase(phase.id)}
                disabled={saving}
              >
                <span className="scaffold-v2__phase-number">{isDone && !isCurrent ? '완료' : studyMode ? index + 1 : phase.number}</span>
                <span>
                  <strong>{phase.label}</strong>
                  <small>{phase.shortDescription}</small>
                </span>
                {index < visiblePhases.length - 1 ? <span className="scaffold-v2__phase-line" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </nav>

        <div
          className="scaffold-v2__metrics"
          aria-label="증례 작업 현황"
          style={studyMode ? { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' } : undefined}
        >
          <div><strong>{visits.length}</strong><span>방문 기록</span></div>
          <div><strong>{evidenceItems.length}</strong><span>AI 추출 문장</span></div>
          <div><strong>{caseNotes.length}</strong><span>증례 메모</span></div>
          {studyMode ? null : <div><strong>{validClaims.length}</strong><span>연결된 주장</span></div>}
          <div><strong>{completedCount}/{totalSections}</strong><span>완료 섹션</span></div>
        </div>

        {error ? <div className="scaffold-v2__notice is-error" role="alert">{error}</div> : null}
        {feedback ? <div className="scaffold-v2__notice is-success" role="status">{feedback}</div> : null}

        {currentPhase === 'case_understanding' ? (
          <section className="scaffold-v2__stage" aria-labelledby="case-understanding-title">
            <div className="scaffold-v2__stage-heading">
              <div>
                <span>1단계</span>
                <h2 id="case-understanding-title">기록을 읽고 내 말로 메모하기</h2>
                <p>{studyMode ? '이 환자를 증례보고로 쓴다면 중요하다고 생각하는 점과 더 확인하고 싶은 점을 짧게 적어 보세요. 메모는 추가하는 즉시 저장되고, 마지막 학습 기록에 함께 실립니다.' : '정답을 고르거나 분류하지 않아도 됩니다. 눈에 띈 점과 더 확인하고 싶은 점을 짧게 남겨보세요.'}</p>
              </div>
              <strong>{caseNotes.length}개 메모</strong>
            </div>

            <div className="scaffold-v2__memo-workspace">
              <section className="scaffold-v2__record-column" aria-labelledby="record-column-title">
                <div className="scaffold-v2__column-heading">
                  <h3 id="record-column-title">방문 기록</h3>
                  <span>{visits.length}회</span>
                </div>
                <div className="scaffold-v2__visit-jump" role="group" aria-label="방문 회차로 이동">
                  {visits.map((visit, index) => (
                    <button key={`${visit.date}-jump-${index}`} type="button" onClick={() => jumpToVisit(index)}>
                      {index + 1}회차
                    </button>
                  ))}
                </div>
                <div className="scaffold-v2__visit-list" ref={visitListRef}>
                  {visits.map((visit, index) => {
                    const suggestions = (data.memoSuggestions || []).filter(
                      (item) => item.visitIndex === index + 1
                    );
                    return (
                      <details key={`${visit.date}-${index}`} data-visit-index={index} open>
                        <summary>
                          <span>{index + 1}회차 · {visit.type}</span>
                          <time>{visit.date || '날짜 미상'}</time>
                        </summary>
                        {suggestions.length > 0 ? (
                          <details className="scaffold-v2__memo-suggest">
                            <summary>AI 메모 추천 {suggestions.length}개</summary>
                            <p>기록을 읽고 내 생각을 먼저 적은 뒤 참고하세요. 살펴볼 만한 곳을 알려줄 뿐 정답은 아닙니다.</p>
                            <ul>
                              {suggestions.map((suggestion) => {
                                const added = isSuggestionAdded(suggestion.id);
                                return (
                                  <li key={suggestion.id}>
                                    <span>
                                      <em>{suggestion.type === 'question' ? '더 확인할 점' : '눈에 띈 점'}</em>
                                      {suggestion.text}
                                    </span>
                                    <button type="button" onClick={() => addSuggestedNote(suggestion)} disabled={added || saving}>
                                      {added ? '추가됨' : '내 메모에 추가'}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ) : null}
                        <pre>{visit.soapText || '기록 내용이 없습니다.'}</pre>
                      </details>
                    );
                  })}
                </div>
              </section>

              <section className="scaffold-v2__memo-column" aria-labelledby="case-note-title">
                <div className="scaffold-v2__column-heading">
                  <div>
                    <h3 id="case-note-title">내 증례 메모</h3>
                    <p>기록을 읽으며 떠오른 생각을 짧게 적으세요. 원문 근거 연결은 이후 단계에서 합니다.</p>
                  </div>
                  <span>{caseNotes.length}개</span>
                </div>
                <form className="scaffold-v2__memo-composer" onSubmit={(event) => { event.preventDefault(); addCaseNote(); }}>
                  <div className="scaffold-v2__memo-types" role="group" aria-label="메모 종류">
                    <button type="button" className={newCaseNoteType === 'observation' ? 'is-active' : ''} onClick={() => setNewCaseNoteType('observation')}>눈에 띈 점</button>
                    <button type="button" className={newCaseNoteType === 'question' ? 'is-active' : ''} onClick={() => setNewCaseNoteType('question')}>더 확인할 점</button>
                  </div>
                  <label>
                    <span>{newCaseNoteType === 'observation' ? '어떤 점이 눈에 띄었나요?' : '무엇을 더 확인하고 싶나요?'}</span>
                    <textarea
                      rows={4}
                      value={newCaseNoteText}
                      onChange={(event) => setNewCaseNoteText(event.target.value)}
                      placeholder={newCaseNoteType === 'observation' ? '예: 치료 뒤 증상은 좋아졌지만 검사 소견은 남아 있다.' : '예: 이 검사가 시행된 이유와 이전 결과를 더 확인하고 싶다.'}
                    />
                  </label>
                  <button type="submit" className="scaffold-v2__button is-primary">
                    메모 추가
                  </button>
                </form>

                <div className="scaffold-v2__memo-list">
                  {caseNotes.map((note, index) => (
                      <article key={note.id} className="scaffold-v2__memo-item">
                        <div>
                          <span>{note.type === 'observation' ? '눈에 띈 점' : '더 확인할 점'} {index + 1}</span>
                          <button type="button" className="scaffold-v2__remove" title="메모 삭제" aria-label={`메모 ${index + 1} 삭제`} onClick={() => removeCaseNote(note.id)}>×</button>
                        </div>
                        <textarea rows={3} value={note.text} onChange={(event) => updateCaseNote(note.id, { text: event.target.value })} aria-label={`메모 ${index + 1} 내용`} />
                      </article>
                  ))}
                  {caseNotes.length === 0 ? <div className="scaffold-v2__empty">아직 메모가 없습니다. 기록에서 먼저 눈에 띈 한 가지를 적어보세요.</div> : null}
                </div>
              </section>
            </div>

            {/* 실험용 경로에서는 숨긴다: 메모 내용과 무관하게 앞의 추출 문장 3개만 보여주어
                학습자가 비교의 의미를 알 수 없다. AI와의 비교는 CARE 항목 화면에서 한다. */}
            <section
              className="scaffold-v2__memo-check"
              aria-labelledby="memo-check-title"
              style={studyMode ? { display: 'none' } : undefined}
            >
              <div>
                <span>선택 학습</span>
                <h3 id="memo-check-title">내 메모를 AI 추출 기록과 비교</h3>
                <p>내 생각을 먼저 적은 뒤 사용하세요. AI 문장은 정답이 아니라 기록을 다시 살펴보게 하는 참고 자료입니다.</p>
              </div>
              <button
                type="button"
                className="scaffold-v2__button is-secondary"
                onClick={revealNoteFeedback}
                disabled={caseNotes.length === 0}
              >
                AI 기록과 비교
              </button>
              {noteFeedbackRevealedAt ? (
                <div className="scaffold-v2__memo-feedback" role="status">
                  <div>
                    <strong>{observationNotes.length}개 관찰 메모</strong>
                    <span>기록에서 직접 알아차린 내용을 내 말로 남겼습니다.</span>
                  </div>
                  <div>
                    <strong>{questionNotes.length}개 확인 질문</strong>
                    <span>{questionNotes.length > 0 ? '모르는 점을 질문으로 분리했습니다.' : '더 확인해야 할 정보가 있는지 한 번 생각해보세요.'}</span>
                  </div>
                  {aiComparisonCandidates.length > 0 ? (
                    <section>
                      <h4>기록에서 함께 살펴볼 문장</h4>
                      <p>빠뜨린 정답이라는 뜻은 아닙니다. 내 메모와 관련이 있는지만 비교해보세요.</p>
                      <ul>{aiComparisonCandidates.map((item) => <li key={item.id}>{item.text}</li>)}</ul>
                    </section>
                  ) : null}
                </div>
              ) : null}
            </section>

            <div className="scaffold-v2__stage-actions">
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void persistCaseMap()} disabled={saving}>
                {saving ? '저장 중...' : '수정한 메모 저장'}
              </button>
              <button type="button" className="scaffold-v2__button is-primary" onClick={() => void continueTo(studyMode ? 'section_drafting' : 'core_message')} disabled={saving}>
                {studyMode ? '다음: CARE 항목 작성' : '다음: 핵심 메시지 작성'}
              </button>
            </div>
          </section>
        ) : null}

        {currentPhase === 'core_message' ? (
          <section className="scaffold-v2__stage scaffold-v2__message-stage" aria-labelledby="core-message-title">
            <div className="scaffold-v2__stage-heading">
              <div>
                <span>2단계</span>
                <h2 id="core-message-title">증례를 한 문장으로 설명하기</h2>
                <p>앞에서 남긴 메모를 종합해 증례의 임상적 특징과 독자가 가져갈 메시지를 정리합니다.</p>
              </div>
              <strong>{caseNotes.length}개 메모 사용 가능</strong>
            </div>

            <div className="scaffold-v2__message-layout">
              <form className="scaffold-v2__form" onSubmit={(event) => event.preventDefault()}>
                <label>
                  <span>증례표상</span>
                  <small>환자의 핵심 특성, 문제, 시간 경과를 한두 문장으로 요약합니다.</small>
                  <textarea value={problemRepresentation} onChange={(event) => setProblemRepresentation(event.target.value)} rows={4} placeholder="예: 기저질환이 있는 중년 환자에서 반복되는 증상과 치료 후 변화를 관찰한 증례" />
                </label>
                <label>
                  <span>이 증례를 보고할 가치</span>
                  <small>희귀성만이 아니라 진단적 어려움, 예상 밖의 경과, 실무적 교훈을 적습니다.</small>
                  <textarea value={reportabilityRationale} onChange={(event) => setReportabilityRationale(event.target.value)} rows={4} placeholder="이 증례가 기존 진료나 학습에 더하는 점을 적으세요." />
                </label>
                <label>
                  <span>핵심 교육 메시지</span>
                  <small>한 줄에 하나씩 작성합니다.</small>
                  <textarea value={teachingPointsDraft} onChange={(event) => setTeachingPointsDraft(event.target.value)} rows={5} placeholder={'초기 증상만으로 판단하지 않아야 한다.\n치료 반응을 시간 순서로 확인해야 한다.'} />
                </label>
                <label>
                  <span>주요 독자</span>
                  <input value={targetAudience} onChange={(event) => setTargetAudience(event.target.value)} placeholder="예: 일차진료 의사, 전공의, 관련 전문과" />
                </label>
              </form>

              <aside className="scaffold-v2__selection-summary" aria-label="내 증례 메모 요약">
                <div className="scaffold-v2__column-heading">
                  <h3>내 증례 메모</h3>
                  <span>{caseNotes.length}개</span>
                </div>
                <ol>
                  {caseNotes.map((note) => (
                      <li key={note.id}>
                        <span>{note.type === 'observation' ? '눈에 띈 점' : '더 확인할 점'}</span>
                        <strong>{note.text}</strong>
                      </li>
                  ))}
                </ol>
                {caseNotes.length === 0 ? <div className="scaffold-v2__empty">앞 단계에서 증례 메모를 작성해주세요.</div> : null}
              </aside>
            </div>

            <div className="scaffold-v2__stage-actions">
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void changePhase('case_understanding')} disabled={saving}>이전: 증례 이해</button>
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void persistCaseMap()} disabled={saving}>{saving ? '저장 중...' : '핵심 메시지 저장'}</button>
              <button type="button" className="scaffold-v2__button is-primary" onClick={() => void continueTo('claim_evidence')} disabled={saving}>다음: 주장·근거 연결</button>
            </div>
          </section>
        ) : null}

        {currentPhase === 'claim_evidence' ? (
          <section className="scaffold-v2__stage" aria-labelledby="claim-map-title">
            <div className="scaffold-v2__stage-heading">
              <div>
                <span>3단계</span>
                <h2 id="claim-map-title">주장과 근거의 관계 만들기</h2>
                <p>같은 근거를 여러 주장과 CARE 섹션에 연결할 수 있습니다. 연결 이유와 불확실성도 함께 남깁니다.</p>
              </div>
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => setClaims((previous) => [...previous, createClaim()])}>주장 추가</button>
            </div>

            <div className="scaffold-v2__claim-list">
              {claims.map((claim, index) => (
                <article key={claim.id} className="scaffold-v2__claim">
                  <div className="scaffold-v2__claim-heading">
                    <strong>주장 {index + 1}</strong>
                    <button type="button" className="scaffold-v2__remove" title="주장 삭제" aria-label={`주장 ${index + 1} 삭제`} onClick={() => setClaims((previous) => previous.filter((item) => item.id !== claim.id))}>×</button>
                  </div>

                  <div className="scaffold-v2__claim-grid">
                    <label>
                      <span>주장 유형</span>
                      <select value={claim.type} onChange={(event) => updateClaim(claim.id, { type: event.target.value as ScaffoldV2ClaimType })}>
                        {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>근거 확실성</span>
                      <select value={claim.confidence} onChange={(event) => updateClaim(claim.id, { confidence: event.target.value as ScaffoldV2ClaimConfidence })}>
                        {Object.entries(CLAIM_CONFIDENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>

                  <label className="scaffold-v2__claim-text">
                    <span>원고에서 말하려는 내용</span>
                    <textarea value={claim.text} onChange={(event) => updateClaim(claim.id, { text: event.target.value })} rows={3} placeholder="기록을 근거로 주장할 수 있는 내용을 작성하세요." />
                  </label>
                  <label className="scaffold-v2__claim-text">
                    <span>이 근거들이 주장을 뒷받침하는 이유</span>
                    <textarea value={claim.rationale || ''} onChange={(event) => updateClaim(claim.id, { rationale: event.target.value })} rows={2} placeholder="사실과 해석을 구분해 연결 이유를 적으세요." />
                  </label>

                  <fieldset>
                    <legend>연결할 SOAP 근거</legend>
                    <div className="scaffold-v2__claim-evidence">
                      {evidenceItems.map((item) => (
                        <label key={item.id}>
                          <input type="checkbox" checked={claim.evidenceIds.includes(item.id)} onChange={() => toggleClaimEvidence(claim.id, item.id)} />
                          <span>{item.text}</span>
                        </label>
                      ))}
                      {evidenceItems.length === 0 ? <div className="scaffold-v2__empty">연결할 수 있는 SOAP 근거가 없습니다.</div> : null}
                    </div>
                  </fieldset>

                  <fieldset>
                    <legend>이 주장이 사용될 CARE 섹션</legend>
                    <div className="scaffold-v2__section-options">
                      {SCAFFOLD_SECTIONS.filter((section) => (data.sectionStates || []).some((state) => state.sectionId === section.sectionId)).map((section) => (
                        <label key={section.sectionId}>
                          <input type="checkbox" checked={claim.targetSectionIds.includes(section.sectionId)} onChange={() => toggleClaimSection(claim.id, section.sectionId)} />
                          <span>{section.displayName}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="scaffold-v2__claim-text">
                    <span>부족하거나 추가 확인이 필요한 정보</span>
                    <input value={claim.missingInformation || ''} onChange={(event) => updateClaim(claim.id, { missingInformation: event.target.value })} placeholder="없다면 비워둘 수 있습니다." />
                  </label>
                </article>
              ))}
              {claims.length === 0 ? (
                <div className="scaffold-v2__empty is-large">
                  핵심 메시지를 뒷받침할 첫 주장을 추가하세요.
                  <button type="button" className="scaffold-v2__button is-primary" onClick={() => setClaims([createClaim()])}>첫 주장 만들기</button>
                </div>
              ) : null}
            </div>

            <div className="scaffold-v2__stage-actions">
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void changePhase('core_message')} disabled={saving}>이전: 핵심 메시지</button>
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void persistCaseMap()} disabled={saving}>{saving ? '저장 중...' : '주장 지도 저장'}</button>
              <button type="button" className="scaffold-v2__button is-primary" onClick={() => void continueTo('section_drafting')} disabled={saving}>다음: CARE 원고 작성</button>
            </div>
          </section>
        ) : null}

        {currentPhase === 'section_drafting' ? (
          <section className="scaffold-v2__stage" aria-labelledby="section-drafting-title">
            <div className="scaffold-v2__stage-heading">
              <div>
                <span>{studyMode ? '2단계' : '4단계'}</span>
                <h2 id="section-drafting-title">{studyMode ? 'CARE 항목별로 정리하고 AI 초안과 비교하기' : 'CARE 섹션별 원고 작성'}</h2>
                <p>{studyMode ? '위에서부터 차례로 진행하세요. 내 생각을 먼저 적은 뒤 AI 초안을 확인합니다. 시간 안에 모두 하지 않아도 됩니다.' : '앞에서 만든 증례지도에 따라 각 섹션을 작성하고 AI 초안과 자신의 판단을 비교합니다.'}</p>
              </div>
              <strong>{completedCount} / {totalSections} 완료</strong>
            </div>

            <div className="scaffold-v2__section-progress" aria-hidden="true">
              <span style={{ width: `${totalSections ? Math.round((completedCount / totalSections) * 100) : 0}%` }} />
            </div>

            {studyMode ? (
              <details className="scaffold-v2__howto" open>
                <summary>진행 방법과 예시 (시작 전에 읽어 주세요)</summary>
                <ol className="scaffold-v2__howto-steps">
                  <li>
                    <strong>내가 먼저 써 봅니다.</strong>
                    <span>왼쪽 원기록을 보고 그 항목을 두세 문장으로 직접 씁니다. 잘 쓰려고 하지 않아도 됩니다. 이때는 AI 초안이 보이지 않습니다.</span>
                  </li>
                  <li>
                    <strong>AI 초안을 원기록과 비교하며 읽습니다.</strong>
                    <span>기록과 다르거나 확인이 필요한 문장만 눌러 표시하고 이유를 적습니다. 다시 누르면 표시가 풀립니다. 문제없는 문장은 그대로 둡니다.</span>
                  </li>
                  <li>
                    <strong>내 초안과 AI 초안을 비교합니다.</strong>
                    <span>AI 초안에 빠진 내용이 있으면 적고, 두 초안이 무엇이 달랐는지 한 줄로 남깁니다.</span>
                  </li>
                </ol>

                <div className="scaffold-v2__howto-example">
                  <div className="scaffold-v2__howto-example-title">예시 (오늘 실습할 환자와 다른 환자입니다)</div>
                  <div className="scaffold-v2__howto-grid">
                    <div className="scaffold-v2__howto-box is-record">
                      <em>원기록</em>
                      {CARE_EXAMPLE_RECORD.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                    <div className="scaffold-v2__howto-box is-ai">
                      <em>AI가 쓴 초안</em>
                      <p>
                        45세 남자가 3일 전 발생한 요통으로 내원하였다.{' '}
                        <mark>내원 당시 통증은 NRS 5였다.</mark> 1주 뒤 통증은 NRS 4로 감소하였다.
                      </p>
                    </div>
                    <div className="scaffold-v2__howto-box is-mine">
                      <em>이렇게 표시하고 적습니다</em>
                      <p><b>표시한 문장</b>: “내원 당시 통증은 NRS 5였다.” → 기록과 다름</p>
                      <p><b>이유</b>: 1차 기록에는 NRS 7로 적혀 있음.</p>
                      <p><b>초안에 빠진 내용</b>: 2차의 “아침에 뻣뻣함 남아 있음”이 초안에 없음.</p>
                    </div>
                  </div>
                  <div className="scaffold-v2__howto-writing">
                    <div className="scaffold-v2__howto-example-title">이 환자라면 이렇게 씁니다</div>
                    <table>
                      <thead>
                        <tr>
                          <th>항목</th>
                          <th>꼭 들어가는 정보</th>
                          <th>작성 예</th>
                        </tr>
                      </thead>
                      <tbody>
                        {CARE_WRITING_EXAMPLES.map((item) => (
                          <tr key={item.sectionId}>
                            <td>{item.name}</td>
                            <td>{item.mustHave}</td>
                            <td>{item.example}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="scaffold-v2__howto-note">
                    정답을 맞히는 과제가 아닙니다. 두세 문장이면 충분하고, 표시할 문장이 없다고 판단하면 표시하지 않아도 됩니다.
                  </p>
                </div>
              </details>
            ) : null}

            {studyMode ? (
              <details className="scaffold-v2__care-map" open>
                <summary>증례보고는 이렇게 구성됩니다 (CARE 지침)</summary>
                <p>
                  CARE 지침은 증례보고에 무엇을 적어야 하는지 정리한 국제 보고 기준입니다. 13개 항목으로 이루어져 있고,
                  오늘은 그중 표시된 {studySectionIds.length}개 항목을 연습합니다.
                </p>
                <ol>
                  {CARE_OVERVIEW.map((item) => {
                    const isToday = studySectionIds.includes(item.sectionId);
                    return (
                      <li key={item.sectionId} className={isToday ? 'is-today' : ''}>
                        <strong>{item.name}</strong>
                        <span>{item.summary}</span>
                        {isToday ? <em>오늘 연습</em> : null}
                      </li>
                    );
                  })}
                </ol>
              </details>
            ) : null}

            {studyMode ? (
              <div className="scaffold-v2__study-sections">
                {studySectionIds.map((studySectionId, index) => {
                  const progress = data.scaffoldState.sectionProgress.find((item) => item.sectionId === studySectionId);
                  const status = getStudentStatus(progress);
                  const displayName =
                    (['record_facts', 'clinical_process', 'additional_authoring'] as SectionGroup[])
                      .flatMap((groupId) => getSectionsByGroup(groupId))
                      .find((section) => section.sectionId === studySectionId)?.displayName || studySectionId;
                  return (
                    <div key={studySectionId} className="scaffold-v2__study-section">
                      <span className="scaffold-v2__study-section-number">{index + 1}</span>
                      <strong>{displayName}</strong>
                      <span className={`scaffold-v2__status is-${status}`}>{getStatusLabel(status)}</span>
                      <button
                        type="button"
                        className={`scaffold-v2__button ${status === 'completed' ? 'is-secondary' : 'is-primary'}`}
                        onClick={() => navigate(`/study/scaffold/cases/${caseId}/sections/${studySectionId}`)}
                      >
                        {getSectionButtonLabel(status)}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="scaffold-v2__section-groups" style={studyMode ? { display: 'none' } : undefined}>
              {(['record_facts', 'clinical_process', 'additional_authoring'] as SectionGroup[]).map((groupId) => {
                const sections = getSectionsByGroup(groupId).filter((section) => (data.sectionStates || []).some((state) => state.sectionId === section.sectionId));
                if (sections.length === 0) return null;
                return (
                  <section key={groupId} className="scaffold-v2__section-group">
                    <div>
                      <h3>{GROUP_TITLES[groupId]}</h3>
                      <p>{SECTION_GROUP_DESCRIPTIONS[groupId]}</p>
                    </div>
                    <div className="scaffold-v2__section-list">
                      {sections.map((section) => {
                        const progress = data.scaffoldState.sectionProgress.find((item) => item.sectionId === section.sectionId);
                        const status = getStudentStatus(progress);
                        const linkedClaimCount = claims.filter((claim) => claim.targetSectionIds.includes(section.sectionId)).length;
                        return (
                          <div key={section.sectionId} className="scaffold-v2__section-row">
                            <div>
                              <strong>{section.displayName}</strong>
                              {studyMode ? null : <span>{linkedClaimCount > 0 ? `연결된 주장 ${linkedClaimCount}개` : '연결된 주장 없음'}</span>}
                            </div>
                            <span className={`scaffold-v2__status is-${status}`}>{getStatusLabel(status)}</span>
                            <button type="button" className="scaffold-v2__button is-secondary" onClick={() => navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/sections/${section.sectionId}`)}>{getSectionButtonLabel(status)}</button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="scaffold-v2__stage-actions">
              {studyMode ? (
                <>
                  <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void changePhase('case_understanding')} disabled={saving}>이전: 기록 읽기</button>
                  <button type="button" className="scaffold-v2__button is-primary" onClick={() => navigate(`/study/scaffold/cases/${caseId}/summary`)}>내 학습 기록 보기</button>
                </>
              ) : (
                <>
                  <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void changePhase('claim_evidence')} disabled={saving}>이전: 주장·근거 연결</button>
                  <button type="button" className="scaffold-v2__button is-primary" onClick={() => void changePhase('final_review')} disabled={saving}>전체 검토 보기</button>
                </>
              )}
            </div>
          </section>
        ) : null}

        {currentPhase === 'final_review' ? (
          <section className="scaffold-v2__stage" aria-labelledby="final-review-title">
            <div className="scaffold-v2__stage-heading">
              <div>
                <span>5단계</span>
                <h2 id="final-review-title">전체 원고 검토 준비</h2>
                <p>주장과 근거의 연결, 추가 확인 항목, CARE 섹션 완료 상태를 함께 확인합니다.</p>
              </div>
              <strong>{phaseComplete.final_review ? '검토 준비 완료' : '확인 필요'}</strong>
            </div>

            <div className="scaffold-v2__review-grid">
              <section><span>근거 연결</span><strong>{validClaims.length} / {claims.filter((claim) => claim.text.trim()).length}</strong><p>근거와 사용 섹션이 모두 지정된 주장</p></section>
              <section><span>추가 확인</span><strong>{unresolvedClaims.length}</strong><p>판단 보류 또는 부족 정보가 남은 주장</p></section>
              <section><span>CARE 작성</span><strong>{completedCount} / {totalSections}</strong><p>AI 초안 검토까지 완료한 섹션</p></section>
            </div>

            {unresolvedClaims.length > 0 ? (
              <section className="scaffold-v2__review-list">
                <h3>추가 확인이 필요한 주장</h3>
                <ul>
                  {unresolvedClaims.map((claim) => (
                    <li key={claim.id}><strong>{claim.text || CLAIM_TYPE_LABELS[claim.type]}</strong><span>{claim.missingInformation || '근거 확실성을 판단해야 합니다.'}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="scaffold-v2__stage-actions">
              <button type="button" className="scaffold-v2__button is-secondary" onClick={() => void changePhase('section_drafting')} disabled={saving}>이전: 원고 작성</button>
              <button type="button" className="scaffold-v2__button is-primary" onClick={() => navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/summary`)}>최종 요약 열기</button>
            </div>
          </section>
        ) : null}

        <footer className="scaffold-v2__footer">
          <span>현재 단계 {currentPhaseIndex + 1} / {visiblePhases.length}</span>
          <span>마지막 저장 {data.scaffoldState.caseMap?.updatedAt ? new Date(data.scaffoldState.caseMap.updatedAt).toLocaleString('ko-KR') : '저장 전'}</span>
        </footer>
      </main>
    </ScaffoldPageFrame>
  );
}
