import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ScaffoldActionButton from '../components/scaffold/ScaffoldActionButton';
import ScaffoldEvidenceSelector from '../components/scaffold/ScaffoldEvidenceSelector';
import ScaffoldPanel from '../components/scaffold/ScaffoldPanel';
import ScaffoldProgressHeader from '../components/scaffold/ScaffoldProgressHeader';
import ScaffoldReviewCard from '../components/scaffold/ScaffoldReviewCard';
import ScaffoldSelfSummary, { type SelfSummaryGroup } from '../components/scaffold/ScaffoldSelfSummary';
import {
  caseApi,
  InformationStatusJudgment,
  ScaffoldInteractionEventType,
  ScaffoldReviewItem,
  ScaffoldReviewJudgment,
  ScaffoldReviewSourceType,
  ScaffoldStateResponse,
  SectionDetail
} from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import {
  buildScaffoldItemId,
  DRAFT_JUDGMENT_OPTIONS,
  splitScaffoldDraftSentences,
  getSectionConfig,
  type ScaffoldType
} from '../utils/scaffoldUi';
import './ScaffoldSectionPage.css';

// ===== Types =====

type WorkflowStep = 'step1' | 'step2' | 'step3' | 'step4';

type SectionType =
  | 'patient_information'
  | 'clinical_findings'
  | 'timeline'
  | 'diagnostic_assessment'
  | 'therapeutic_intervention'
  | 'followup_outcomes'
  | 'patient_perspective'
  | 'informed_consent'
  | 'title'
  | 'abstract'
  | 'introduction'
  | 'discussion';

type ConfirmationQuestion = {
  id: string;
  question: string;
  description?: string;
};

type SelectedEvidenceItem = {
  id: string;
  sourceType: 'visit_soap' | 'evidence_card';
  sourceText: string;
  visitIndex?: number;
  extractedContent?: string;
  timestamp: number;
  label: string;
};

type EvidenceChoice = {
  id: string;
  text: string;
  sourceLabel?: string;
  isSynthetic: boolean;
};

// ===== Section Type Detection =====

function detectSectionType(sectionId: string): SectionType {
  const lower = sectionId.toLowerCase();

  if (lower.includes('consent') || lower.includes('동의')) return 'informed_consent';
  if (lower.includes('perspective') || lower.includes('관점')) return 'patient_perspective';
  if (lower.includes('patient') || lower.includes('정보')) return 'patient_information';
  if (lower.includes('clinical') || lower.includes('findings') || lower.includes('소견')) return 'clinical_findings';
  if (lower.includes('timeline') || lower.includes('경과')) return 'timeline';
  if (lower.includes('diagnostic') || lower.includes('진단')) return 'diagnostic_assessment';
  if (lower.includes('therapeutic') || lower.includes('intervention') || lower.includes('치료')) return 'therapeutic_intervention';
  if (lower.includes('followup') || lower.includes('follow-up') || lower.includes('outcome') || lower.includes('경과')) return 'followup_outcomes';
  if (lower.includes('title') || lower.includes('제목')) return 'title';
  if (lower.includes('abstract') || lower.includes('초록')) return 'abstract';
  if (lower.includes('introduction') || lower.includes('서론')) return 'introduction';
  if (lower.includes('discussion') || lower.includes('토론')) return 'discussion';

  return 'clinical_findings'; // default
}

// ===== Confirmation Questions Configuration =====

const SECTION_CONFIRMATION_QUESTIONS: Record<SectionType, ConfirmationQuestion[]> = {
  patient_information: [
    {
      id: 'pi_001',
      question: '환자의 연령과 성별이 명확하게 기록되어 있나요?',
      description: '증례 이해에 필수적인 기본 정보입니다.'
    },
    {
      id: 'pi_002',
      question: '증례를 이해하는 데 필요한 과거 병력이 충분히 기록되어 있나요?',
      description: '관련 질환이나 이전 치료 경력을 포함합니다.'
    },
    {
      id: 'pi_003',
      question: '환자의 직업, 생활환경, 사회적 배경 등 관련 정보가 기록되어 있나요?',
      description: '임상 판단에 영향을 미칠 수 있는 배경 정보입니다.'
    },
    {
      id: 'pi_004',
      question: '현재 복용 중인 약물이나 알레르기 정보가 기록되어 있나요?',
      description: '치료 계획 수립에 중요한 정보입니다.'
    }
  ],
  clinical_findings: [
    {
      id: 'cf_001',
      question: '환자의 주요 증상이 충분히 기록되어 있나요?',
      description: '증상의 시작 시점, 양상, 강도 등을 포함합니다.'
    },
    {
      id: 'cf_002',
      question: '신체 검진 또는 이학적 소견이 명확하게 기록되어 있나요?',
      description: '진찰 소견, 측정값, 특수 검사 결과 등입니다.'
    },
    {
      id: 'cf_003',
      question: '증상의 시작 시점과 변화 양상을 시간 순서대로 확인할 수 있나요?',
      description: '경과 변화의 추이를 파악하는 것이 중요합니다.'
    },
    {
      id: 'cf_004',
      question: '추가 검사 결과(혈액검사, 영상검사 등)가 기록되어 있나요?',
      description: '진단 및 감별 진단에 필요한 객관적 자료입니다.'
    }
  ],
  timeline: [
    {
      id: 'tl_001',
      question: '각 방문이나 주요 사건의 날짜/시간이 명확하게 기록되어 있나요?',
      description: '시간 순서 파악이 정확해야 합니다.'
    },
    {
      id: 'tl_002',
      question: '질병의 시작부터 현재까지의 주요 사건들을 시간 순서대로 정렬할 수 있나요?',
      description: '진단, 치료 변경, 중요한 검사 등의 순서입니다.'
    },
    {
      id: 'tl_003',
      question: '증상의 변화와 치료 개입 사이의 시간적 관계가 명확한가요?',
      description: '치료 효과 평가에 필요한 정보입니다.'
    }
  ],
  diagnostic_assessment: [
    {
      id: 'da_001',
      question: '진단의 근거가 되는 임상 소견과 검사 결과가 기록되어 있나요?',
      description: '진단 판정의 기초가 되는 정보입니다.'
    },
    {
      id: 'da_002',
      question: '감별 진단으로 고려된 다른 질환들이 언급되어 있나요?',
      description: '임상 판단의 깊이를 보여주는 정보입니다.'
    },
    {
      id: 'da_003',
      question: '진단 기준이나 분류 체계에 따른 평가가 기록되어 있나요?',
      description: '표준화된 진단 절차의 적용 여부입니다.'
    }
  ],
  therapeutic_intervention: [
    {
      id: 'ti_001',
      question: '치료 방법, 약물, 용량 등이 명확하게 기록되어 있나요?',
      description: '어떤 치료를 했는지 명확해야 합니다.'
    },
    {
      id: 'ti_002',
      question: '치료 시작 시점과 기간/빈도가 기록되어 있나요?',
      description: '치료 경과 추적에 필요한 정보입니다.'
    },
    {
      id: 'ti_003',
      question: '치료 중 발생한 부작용이나 치료 변경이 기록되어 있나요?',
      description: '치료 과정의 변화를 이해하는 것이 중요합니다.'
    }
  ],
  followup_outcomes: [
    {
      id: 'fo_001',
      question: '치료 후 환자의 상태 변화가 구체적으로 기록되어 있나요?',
      description: '증상 호전, 검사 결과 변화 등이 포함됩니다.'
    },
    {
      id: 'fo_002',
      question: '추적 관찰의 시점과 내용이 명확하게 기록되어 있나요?',
      description: '장기 경과에 관한 정보입니다.'
    },
    {
      id: 'fo_003',
      question: '치료 결과의 평가와 예후에 대한 판단이 기록되어 있나요?',
      description: '치료 효과와 앞으로의 관리 계획입니다.'
    }
  ],
  patient_perspective: [
    {
      id: 'pp_001',
      question: '환자 자신의 증상 경험이나 진술이 기록되어 있나요?',
      description: '환자의 관점이 중요합니다.'
    },
    {
      id: 'pp_002',
      question: '환자가 느끼는 불편감, 걱정, 치료에 대한 반응이 기록되어 있나요?',
      description: '환자 중심의 임상 실천을 위해 필요합니다.'
    }
  ],
  informed_consent: [
    {
      id: 'ic_001',
      question: '증례보고 작성과 출판에 대한 환자의 명시적 동의가 확인되었나요?',
      description: '동의가 기록에 없다면 임의로 추정하지 않아야 합니다.'
    },
    {
      id: 'ic_002',
      question: '환자를 식별할 수 있는 정보가 제거되었는지 확인했나요?',
      description: '출판 전 개인정보 보호 상태를 확인합니다.'
    }
  ],
  title: [],
  abstract: [],
  introduction: [],
  discussion: []
};

// ===== Helper Functions =====

function parseMultilineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getEvidenceText(card: any): string {
  if (!card) return '';
  if (typeof card === 'string') return card;
  if (card.normalizedText) return card.normalizedText;
  if (card.sourceText) return card.sourceText;
  if (card.text) return card.text;
  if (card.content) return card.content;
  if (card.soapText) return card.soapText;
  return '';
}

function getEvidenceSourceLabel(card: any, detail: SectionDetail): string | undefined {
  const visitIndex = Number(card?.visitIndex);
  if (!Number.isFinite(visitIndex) || visitIndex <= 0) return undefined;

  const visit = detail.caseSummary?.visits?.[visitIndex - 1];
  const visitLabel = `${visit?.type || '방문'} #${visitIndex}`;
  const soapSection = getEvidenceText(card).match(/^\s*([SOAP]):/i)?.[1]?.toUpperCase();
  return soapSection ? `${visitLabel} · ${soapSection}` : visitLabel;
}

function buildFallbackSectionDetail(scaffoldData: ScaffoldStateResponse, sectionId: string): SectionDetail {
  const sectionState = (scaffoldData.sectionStates || []).find((item) => item.sectionId === sectionId);
  const draftEntry = (scaffoldData.sectionDrafts || []).find((item) => item.sectionId === sectionId);
  const evidenceCards = (scaffoldData.evidenceCards || []).filter((card) =>
    (card.tags || []).includes(sectionId)
  );

  return {
    section: sectionId,
    status: sectionState?.status || 'INCOMPLETE',
    rationaleText: sectionState?.rationaleText || '현재 섹션 정보를 불러오지 못했습니다.',
    missingInfoBullets: sectionState?.missingInfoBullets || [],
    recommendedQuestions: sectionState?.recommendedQuestions || [],
    sectionMissingInfo: sectionState?.missingInfoBullets || [],
    commonMissingInfo: scaffoldData.commonMissingItems || [],
    sectionQuestions: sectionState?.recommendedQuestions || [],
    commonQuestions: scaffoldData.commonQuestionSets || [],
    commonQnaHistory: [],
    currentDraft: draftEntry?.draftText || '',
    evidence: evidenceCards.map((card) => getEvidenceText(card as any)),
    evidenceCards,
    qnaHistory: [],
    caseSummary: {
      id: scaffoldData.caseId,
      mode: scaffoldData.mode,
      title: scaffoldData.title,
      visits: scaffoldData.visits || [],
      sectionStates: scaffoldData.sectionStates,
      sectionDrafts: scaffoldData.sectionDrafts,
      scaffoldState: scaffoldData.scaffoldState
    } as any
  };
}

function makeEvidenceChoiceList(detail: SectionDetail): EvidenceChoice[] {
  return (detail.evidenceCards || [])
    .map((card, index) => ({
      id: card.id || `evidence-${index}`,
      text: getEvidenceText(card as any) || `근거 ${index + 1}`,
      sourceLabel: getEvidenceSourceLabel(card, detail),
      isSynthetic: !card.id
    }))
    .filter((item) => item.text);
}

function toggleId(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Step 2 라디오 값을 백엔드가 허용하는 information status judgment로 옮긴다.
 * UI의 'cannot_confirm_in_record'는 백엔드의 'unavailable'에 해당한다.
 */
function toInformationStatusJudgment(value: string): InformationStatusJudgment {
  switch (value) {
    case 'available_in_record':
    case 'needs_additional_confirmation':
    case 'needs_instructor_review':
      return value;
    case 'cannot_confirm_in_record':
    case 'unavailable':
      return 'unavailable';
    default:
      return 'pending';
  }
}

function uniqueTexts(items: Array<string | undefined>) {
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
}

/**
 * 학습자가 입력·선택한 값을 오른쪽 요약 그룹으로 재구성한다.
 * 새로운 판단을 만들지 않으며, 비어 있는 그룹은 화면에서 그대로 빠진다.
 */
function buildSelfSummaryGroups(parts: {
  evidenceLabels: string[];
  keyInformation: string[];
  missingInformation: string[];
  additionalConfirmation: string[];
  teacherReview: string[];
  unavailable: string[];
  notes: string;
}): SelfSummaryGroup[] {
  return [
    { key: 'evidence', label: '선택한 근거', items: uniqueTexts(parts.evidenceLabels) },
    { key: 'key', label: '핵심정보', items: uniqueTexts(parts.keyInformation) },
    { key: 'missing', label: '누락정보', items: uniqueTexts(parts.missingInformation) },
    { key: 'confirm', label: '추가 확인 필요', items: uniqueTexts(parts.additionalConfirmation) },
    { key: 'teacher', label: '전문가 검토 필요', items: uniqueTexts(parts.teacherReview) },
    { key: 'unavailable', label: '현재 기록으로 확인 불가', items: uniqueTexts(parts.unavailable) },
    { key: 'notes', label: '자유 메모', items: [], text: parts.notes || '' }
  ];
}

/** 저장된 information status judgment를 Step 2 라디오 값으로 되돌린다. */
function fromInformationStatusJudgment(value: string): string {
  return value === 'unavailable' ? 'cannot_confirm_in_record' : value;
}

function isCompleteDraftSentenceReview(item?: ScaffoldReviewItem) {
  if (!item || item.sourceType !== 'draft_sentence') return false;
  if (!item.judgment || item.judgment === 'pending') return false;
  return Boolean(String(item.note || '').trim() || (item.evidenceIds || []).length > 0);
}

const CONFIRMATION_JUDGMENT_OPTIONS = [
  { value: 'available_in_record', label: '기록에서 확인 가능' },
  { value: 'needs_additional_confirmation', label: '추가 확인 필요' },
  { value: 'needs_instructor_review', label: '교수자에게 확인 필요' },
  { value: 'cannot_confirm_in_record', label: '현재 기록으로 확인할 수 없음' }
] as const;

// ===== Main Component =====

export default function ScaffoldSectionPage() {
  const navigate = useNavigate();
  const { caseId, sectionId } = useParams<{ caseId?: string; sectionId?: string }>();
  const studyMode = location.pathname.includes('/study/');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [scaffoldData, setScaffoldData] = useState<ScaffoldStateResponse | null>(null);
  const [detail, setDetail] = useState<SectionDetail | null>(null);

  // Workflow step state
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('step1');

  // Step 1: Evidence Selection
  const [selectedEvidenceItems, setSelectedEvidenceItems] = useState<SelectedEvidenceItem[]>([]);
  const [keyInformationDraft, setKeyInformationDraft] = useState('');
  const [missingInformationDraft, setMissingInformationDraft] = useState('');
  const [keyInformationItems, setKeyInformationItems] = useState<string[]>([]);
  const [missingInformationItems, setMissingInformationItems] = useState<string[]>([]);
  const [noRelevantEvidenceConfirmed, setNoRelevantEvidenceConfirmed] = useState(false);

  // Step 2: Confirmation Questions
  const [confirmationQuestionJudgments, setConfirmationQuestionJudgments] = useState<Record<string, string>>({});
  const [savingConfirmationQuestionIds, setSavingConfirmationQuestionIds] = useState<Set<string>>(
    new Set()
  );

  // Draft review (Step 4)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [judgmentDrafts, setJudgmentDrafts] = useState<Record<string, ScaffoldReviewJudgment>>({});
  const [evidenceDrafts, setEvidenceDrafts] = useState<Record<string, string[]>>({});
  const [changedJudgmentReflection, setChangedJudgmentReflection] = useState('');
  const [unresolvedQuestionReflection, setUnresolvedQuestionReflection] = useState('');
  const [transferPlanReflection, setTransferPlanReflection] = useState('');

  // additional_authoring 섹션의 직접 작성 내용 (learnerNotes에 저장된다)
  const [authoringNotes, setAuthoringNotes] = useState('');

  const [savingProgressKey, setSavingProgressKey] = useState<string | null>(null);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const loggedPurposeRef = useRef<string | null>(null);
  const hydratedCaseMapEvidenceRef = useRef<string | null>(null);

  // 2-column layout state
  const [expandedVisits, setExpandedVisits] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const toggleVisitExpanded = (index: number) => {
    setExpandedVisits((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const patchScaffoldState = (nextState: ScaffoldStateResponse['scaffoldState']) => {
    setScaffoldData((prev) => (prev ? { ...prev, scaffoldState: nextState } : prev));
  };

  const navigateToWriteSection = () => {
    if (!caseId || !sectionId) return;
    navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}/sections/${sectionId}`, { replace: true });
  };

  const loadData = async (showLoader = true) => {
    if (!caseId || !sectionId) return;
    if (showLoader) setLoading(true);
    setError(null);

    try {
      const nextScaffold = await caseApi.getScaffoldState(caseId);
      if (nextScaffold.mode !== 'scaffold') {
        navigateToWriteSection();
        return;
      }

      let nextDetail: SectionDetail;
      try {
        nextDetail = await caseApi.getSectionDetail(caseId, sectionId);
        if ((nextDetail.caseSummary?.mode || 'write') === 'write') {
          navigateToWriteSection();
          return;
        }
        if (!nextDetail.caseSummary?.visits || nextDetail.caseSummary.visits.length === 0) {
          if (nextDetail.caseSummary) {
            nextDetail.caseSummary.visits = nextScaffold.visits || [];
          }
        }
      } catch (detailError: any) {
        nextDetail = buildFallbackSectionDetail(nextScaffold, sectionId);
        setError(detailError.message || '섹션 세부 정보를 불러오지 못했습니다.');
      }

      setScaffoldData(nextScaffold);
      setDetail(nextDetail);
    } catch (nextError: any) {
      if (nextError?.response?.data?.mode === 'write') {
        navigateToWriteSection();
        return;
      }
      setError(nextError.message || 'Scaffold 섹션 정보를 불러오지 못했습니다.');
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(true);
  }, [caseId, sectionId]);

  useEffect(() => {
    const reviewItems = scaffoldData?.scaffoldState.reviewItems || [];
    const nextNotes: Record<string, string> = {};
    const nextJudgments: Record<string, ScaffoldReviewJudgment> = {};
    const nextEvidence: Record<string, string[]> = {};

    reviewItems.forEach((item) => {
      nextNotes[item.id] = item.note || '';
      nextJudgments[item.id] = item.judgment;
      nextEvidence[item.id] = item.evidenceIds || [];
    });

    setNoteDrafts((prev) => ({ ...nextNotes, ...prev }));
    setJudgmentDrafts((prev) => ({ ...nextJudgments, ...prev }));
    setEvidenceDrafts((prev) => ({ ...nextEvidence, ...prev }));
  }, [scaffoldData]);

  const sectionProgress = useMemo(
    () =>
      scaffoldData?.scaffoldState.sectionProgress.find((item) => item.sectionId === sectionId) || {
        sectionId: sectionId || '',
        recordReviewCompleted: false,
        missingInfoReviewCompleted: false,
        draftRevealed: false,
        draftReviewCompleted: false
      },
    [scaffoldData, sectionId]
  );

  const sectionReflection = useMemo(
    () =>
      scaffoldData?.scaffoldState.sectionReflections.find((item) => item.sectionId === sectionId) || {
        sectionId: sectionId || '',
        learnerIdentifiedKeyInfo: [],
        learnerIdentifiedMissingItems: [],
        additionalConfirmationItems: [],
        teacherReviewItems: [],
        learnerNotes: '',
        draftReviewStatus: 'not_reviewed' as const
      },
    [scaffoldData, sectionId]
  );

  /**
   * 이미 AI 초안이 공개된 섹션을 다시 열면 currentStep이 기본값 'step1'이라
   * 가운데에 Step 1 입력 화면과 Step 4 검토 화면이 함께 떴다.
   * 공개 이후 가운데의 역할은 'AI 초안 검토'이므로 진입 단계를 맞춘다.
   * (reveal gate나 저장 로직은 그대로다.)
   */
  useEffect(() => {
    if (sectionProgress.draftRevealed) setCurrentStep('step4');
  }, [sectionProgress.draftRevealed, sectionId]);

  useEffect(() => {
    setKeyInformationItems(
      sectionReflection.learnerKeyInformationItems || sectionReflection.learnerIdentifiedKeyInfo || []
    );
    setMissingInformationItems(sectionReflection.learnerIdentifiedMissingItems || []);
    setNoRelevantEvidenceConfirmed(Boolean(sectionReflection.noRelevantEvidenceConfirmed));
    setAuthoringNotes(sectionReflection.learnerNotes || '');
    setChangedJudgmentReflection(sectionReflection.postAiReflection?.changedJudgment || '');
    setUnresolvedQuestionReflection(sectionReflection.postAiReflection?.unresolvedQuestion || '');
    setTransferPlanReflection(sectionReflection.postAiReflection?.transferPlan || '');
  }, [sectionReflection]);

  const sectionDraftEntry = useMemo(
    () => (scaffoldData?.sectionDrafts || []).find((item) => item.sectionId === sectionId),
    [scaffoldData, sectionId]
  );

  const sectionOrder = useMemo(
    () => (scaffoldData?.sectionStates || []).map((item) => item.sectionId),
    [scaffoldData]
  );

  const sectionIndex = useMemo(
    () => (sectionId ? sectionOrder.findIndex((item) => item === sectionId) : -1),
    [sectionId, sectionOrder]
  );

  const nextSectionId = sectionIndex >= 0 ? sectionOrder[sectionIndex + 1] : undefined;

  // Get scaffoldType for this section
  const scaffoldConfig = useMemo(
    () => (sectionId ? getSectionConfig(sectionId) : undefined),
    [sectionId]
  );
  const scaffoldType: ScaffoldType = scaffoldConfig?.scaffoldType || 'record_selection';
  const isAdditionalAuthoring = scaffoldType === 'additional_authoring';

  const mappedEvidenceIds = useMemo(() => {
    if (!sectionId) return [];
    const caseMap = scaffoldData?.scaffoldState.caseMap;
    if (!caseMap) return [];

    const directlyMapped = Array.from(
      new Set(
        caseMap.claims
          .filter((claim) => claim.targetSectionIds.includes(sectionId))
          .flatMap((claim) => claim.evidenceIds)
      )
    );
    if (directlyMapped.length > 0) return directlyMapped;

    return (scaffoldData.evidenceCards || [])
      .filter(
        (card) =>
          card.id &&
          caseMap.selectedEvidenceIds.includes(card.id) &&
          [...(card.tags || []), ...(card.sectionHints || [])].includes(sectionId)
      )
      .map((card) => String(card.id));
  }, [scaffoldData, sectionId]);

  const evidenceChoices = useMemo(() => {
    if (!detail) return [];
    const choices = makeEvidenceChoiceList(detail).filter((item) => !item.isSynthetic);
    const seen = new Set(choices.map((item) => item.id));

    (scaffoldData?.evidenceCards || [])
      .filter((card) => card.id && mappedEvidenceIds.includes(card.id))
      .forEach((card) => {
        const id = String(card.id);
        if (seen.has(id)) return;
        const text = getEvidenceText(card);
        if (!text) return;
        choices.push({
          id,
          text,
          sourceLabel: getEvidenceSourceLabel(card, detail),
          isSynthetic: false
        });
        seen.add(id);
      });

    return choices;
  }, [detail, scaffoldData?.evidenceCards, mappedEvidenceIds]);

  useEffect(() => {
    if (!caseId || !sectionId || sectionProgress.draftRevealed) return;
    const hydrationKey = `${caseId}:${sectionId}`;
    if (hydratedCaseMapEvidenceRef.current === hydrationKey) return;
    hydratedCaseMapEvidenceRef.current = hydrationKey;

    const persistedSelection = sectionReflection.selectedEvidence || [];
    if (persistedSelection.length > 0) {
      setSelectedEvidenceItems(
        persistedSelection.map((selected) => {
          const choice = evidenceChoices.find((item) => item.id === selected.id);
          const visit =
            selected.sourceType === 'visit_soap' && typeof selected.visitIndex === 'number'
              ? detail?.caseSummary?.visits?.[selected.visitIndex]
              : undefined;
          const sourceText = choice?.text || visit?.soapText || selected.label || selected.id;
          return {
            id: selected.id,
            sourceType: selected.sourceType,
            sourceText,
            extractedContent: sourceText,
            visitIndex: selected.visitIndex,
            label: selected.label || choice?.sourceLabel || selected.id,
            timestamp: Date.now()
          };
        })
      );
      return;
    }

    if (
      sectionReflection.noRelevantEvidenceConfirmed ||
      (sectionReflection.learnerKeyInformationItems || sectionReflection.learnerIdentifiedKeyInfo || []).length > 0
    ) {
      setSelectedEvidenceItems([]);
      return;
    }

    const mappedChoices = evidenceChoices.filter((choice) => mappedEvidenceIds.includes(choice.id));
    if (mappedChoices.length === 0) return;
    setSelectedEvidenceItems(
      mappedChoices.map((choice) => ({
        id: choice.id,
        sourceType: 'evidence_card' as const,
        sourceText: choice.text,
        extractedContent: choice.text,
        label: [choice.sourceLabel, choice.text].filter(Boolean).join(' · ').slice(0, 120),
        timestamp: Date.now()
      }))
    );
  }, [
    caseId,
    sectionId,
    sectionProgress.draftRevealed,
    evidenceChoices,
    mappedEvidenceIds,
    sectionReflection,
    detail
  ]);
  const draftSentences = useMemo(
    () => splitScaffoldDraftSentences(detail?.currentDraft || sectionDraftEntry?.draftText || ''),
    [detail, sectionDraftEntry]
  );

  const existingReviewMap = useMemo(() => {
    const map = new Map<string, ScaffoldReviewItem>();
    (scaffoldData?.scaffoldState.reviewItems || []).forEach((item) => map.set(item.id, item));
    return map;
  }, [scaffoldData]);

  /* const reviewCandidates = useMemo(() => {
    if (!sectionId || !detail) return [];

    const candidates: ReviewCandidate[] = [];

    (detail.missingInfoBullets || []).forEach((text, index) => {
      candidates.push({
        id: buildScaffoldItemId(sectionId, 'missing_info', text, index),
        sourceType: 'missing_info',
        sourceText: text,
        helperText: '현재 기록만으로 바로 확인되지 않는 정보입니다.'
      });
    });

    (detail.adequacyReview?.missingRequiredItems || []).forEach((text, index) => {
      candidates.push({
        id: buildScaffoldItemId(sectionId, 'missing_info', `review:${text}`, index),
        sourceType: 'missing_info',
        sourceText: text,
        helperText: '기록을 보강할 필요가 있는 항목입니다.'
      });
    });

    (detail.adequacyReview?.depthIssues || []).forEach((text, index) => {
      candidates.push({
        id: buildScaffoldItemId(sectionId, 'depth_issue', text, index),
        sourceType: 'depth_issue',
        sourceText: text,
        helperText: '해석이나 설명을 더 신중하게 검토해야 하는 부분입니다.'
      });
    });

    (sectionDraftEntry?.unsupportedClaims || []).forEach((item, index) => {
      candidates.push({
        id: buildScaffoldItemId(sectionId, 'unsupported_claim', item.sentence, index),
        sourceType: 'unsupported_claim',
        sourceText: item.sentence,
        helperText: item.reason || '기록 근거가 충분하지 않은 문장입니다.'
      });
    });

    return uniqueById(candidates);
  }, [detail, sectionDraftEntry, sectionId]);
  void reviewCandidates; */

  // Get section-specific confirmation questions
  const sectionType = detectSectionType(sectionId || '');
  const confirmationQuestions = SECTION_CONFIRMATION_QUESTIONS[sectionType] || [];

  /**
   * Step 2 판단은 reviewItem으로 서버에 저장되지만 화면 state로는 복구되지 않아,
   * 새로고침하면 라디오와 오른쪽 요약이 모두 비어 보였다. 저장된 값에서 되살린다.
   * (읽기 전용 복원이며 판단 값 자체는 바꾸지 않는다.)
   */
  useEffect(() => {
    if (!sectionId || confirmationQuestions.length === 0) return;

    const restored: Record<string, string> = {};
    confirmationQuestions.forEach((question) => {
      const stored = existingReviewMap.get(buildScaffoldItemId(sectionId, 'custom', question.id, 0));
      if (stored?.judgment && stored.judgment !== 'pending') {
        restored[question.id] = fromInformationStatusJudgment(stored.judgment);
      }
    });

    // 화면에서 방금 고른 값이 서버 응답보다 우선한다.
    setConfirmationQuestionJudgments(restored);
  }, [sectionId, existingReviewMap, confirmationQuestions]);

  const draftJudgmentCount = draftSentences.filter((sentence, index) => {
    const itemId = buildScaffoldItemId(sectionId || '', 'draft_sentence', sentence, index);
    const stored = existingReviewMap.get(itemId);
    return isCompleteDraftSentenceReview(stored);
  }).length;

  const allDraftJudgmentsSaved = draftSentences.length === 0 || draftJudgmentCount >= draftSentences.length;
  const postAiReflectionComplete = Boolean(
    changedJudgmentReflection.trim() &&
      unresolvedQuestionReflection.trim() &&
      transferPlanReflection.trim()
  );

  const sectionTitle = sectionId || '섹션';
  const visits = useMemo(() => detail?.caseSummary?.visits || [], [detail]);

  // Step completion conditions
  const step1Complete =
    selectedEvidenceItems.length > 0 ||
    keyInformationItems.length > 0 ||
    noRelevantEvidenceConfirmed;
  const step2Complete = confirmationQuestions.every(
    (question) => Boolean(confirmationQuestionJudgments[question.id])
  ) && savingConfirmationQuestionIds.size === 0;

  // ===== "내가 정리한 내용" (right panel) =====
  //
  // 이 요약은 전적으로 학습자가 입력하거나 선택한 값만 사용한다.
  // AI 호출도, 요약 생성도 하지 않는다.

  const preRevealSnapshot = useMemo(
    () =>
      (scaffoldData?.scaffoldState.preRevealSnapshots || []).find(
        (item) => item.sectionId === sectionId
      ),
    [scaffoldData, sectionId]
  );

  const liveSummaryGroups = useMemo<SelfSummaryGroup[]>(() => {
    const byJudgment = (target: string) =>
      confirmationQuestions
        .filter((question) => confirmationQuestionJudgments[question.id] === target)
        .map((question) => question.question);

    return buildSelfSummaryGroups({
      evidenceLabels: noRelevantEvidenceConfirmed
        ? ['관련 근거 없음으로 판단']
        : selectedEvidenceItems.map((item) => item.label),
      keyInformation: keyInformationItems,
      missingInformation: missingInformationItems,
      additionalConfirmation: [
        ...byJudgment('needs_additional_confirmation'),
        ...(sectionReflection.additionalConfirmationItems || [])
      ],
      teacherReview: [
        ...byJudgment('needs_instructor_review'),
        ...(sectionReflection.teacherReviewItems || [])
      ],
      unavailable: byJudgment('cannot_confirm_in_record'),
      notes: isAdditionalAuthoring ? authoringNotes : sectionReflection.learnerNotes || ''
    });
  }, [
    selectedEvidenceItems,
    keyInformationItems,
    missingInformationItems,
    confirmationQuestions,
    confirmationQuestionJudgments,
    sectionReflection,
    authoringNotes,
    isAdditionalAuthoring,
    noRelevantEvidenceConfirmed
  ]);

  /**
   * AI 공개 이후에도 오른쪽에는 "공개 전" 상태가 남아야 한다.
   * study/research mode에서는 서버가 만든 immutable preRevealSnapshot을 쓰고,
   * snapshot이 없는 일반 prototype mode에서는 reveal 직전 화면 상태를 얼려 둔다.
   */
  const frozenSummaryRef = useRef<SelfSummaryGroup[] | null>(null);

  const snapshotSummaryGroups = useMemo<SelfSummaryGroup[] | null>(() => {
    if (!preRevealSnapshot) return null;

    const textFor = (itemId: string) => existingReviewMap.get(itemId)?.sourceText || '';
    const byJudgment = (target: string) =>
      (preRevealSnapshot.reviewItemJudgments || [])
        .filter((item) => item.judgment === target)
        .map((item) => textFor(item.itemId))
        .filter(Boolean);

    return buildSelfSummaryGroups({
      evidenceLabels: preRevealSnapshot.noRelevantEvidenceConfirmed
        ? ['관련 근거 없음으로 판단']
        : (preRevealSnapshot.selectedEvidence || []).map((item) => item.label || item.id),
      keyInformation: preRevealSnapshot.learnerKeyInformationItems || [],
      missingInformation: preRevealSnapshot.learnerIdentifiedMissingItems || [],
      additionalConfirmation: [
        ...byJudgment('needs_additional_confirmation'),
        ...(preRevealSnapshot.additionalConfirmationItems || [])
      ],
      teacherReview: [
        ...byJudgment('needs_instructor_review'),
        ...(preRevealSnapshot.teacherReviewItems || [])
      ],
      unavailable: byJudgment('unavailable'),
      notes: preRevealSnapshot.learnerNotes || ''
    });
  }, [preRevealSnapshot, existingReviewMap]);

  const summaryGroups = sectionProgress.draftRevealed
    ? snapshotSummaryGroups || frozenSummaryRef.current || liveSummaryGroups
    : liveSummaryGroups;

  // ===== Event Handlers =====

  const logScaffoldEvent = async (
    eventType: ScaffoldInteractionEventType,
    metadata?: Record<string, any>
  ) => {
    if (!caseId || !sectionId) return;

    try {
      await caseApi.logScaffoldEvent(caseId, {
        eventType,
        sectionId,
        metadata
      });
    } catch (err) {
      console.error(`Failed to log event ${eventType}:`, err);
    }
  };

  // 섹션의 목적/요구사항을 실제로 본 시점을 기록한다. reveal gate가
  // purposeViewed를 요구하므로, 이 이벤트가 없으면 gate가 절대 열리지 않는다.
  useEffect(() => {
    if (!caseId || !sectionId || !scaffoldData) return;
    const key = `${caseId}:${sectionId}`;
    if (loggedPurposeRef.current === key) return;
    loggedPurposeRef.current = key;
    // section_opened는 서버가 reflection.firstOpenedAt을 채우는 데 사용하므로
    // 섹션별 소요 시간 분석에 필요하다.
    void (async () => {
      await logScaffoldEvent('section_opened', { scaffoldType });
      await logScaffoldEvent('section_purpose_viewed', {
        scaffoldType,
        displayName: scaffoldConfig?.displayName
      });
    })();
  }, [caseId, sectionId, scaffoldData, scaffoldType, scaffoldConfig?.displayName]);

  /**
   * Step 1에서 학습자가 정리한 내용을 서버에 저장한다.
   * 이전에는 화면 상태로만 존재해서 새로고침하면 사라졌고,
   * preRevealSnapshot(서버가 reveal 시점에 reflection에서 생성)도 비어 있었다.
   */
  const persistSectionReflection = async (overrides?: {
    learnerNotes?: string;
    postAiReflection?: {
      changedJudgment: string;
      unresolvedQuestion: string;
      transferPlan: string;
    };
  }) => {
    if (!caseId || !sectionId) return null;

    // 이 엔드포인트는 보내지 않은 필드를 undefined로 덮어쓴다.
    // 따라서 바꾸지 않는 값도 현재 값 그대로 함께 보낸다.
    const nextState = await caseApi.updateScaffoldSectionReflection(caseId, sectionId, {
      selectedEvidenceIds: selectedEvidenceItems.map((item) => item.id),
      selectedEvidence: selectedEvidenceItems.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        label: item.label,
        visitIndex: item.visitIndex
      })),
      noRelevantEvidenceConfirmed,
      learnerKeyInformationItems: keyInformationItems,
      learnerIdentifiedKeyInfo: keyInformationItems,
      learnerIdentifiedMissingItems: missingInformationItems,
      additionalConfirmationItems: sectionReflection.additionalConfirmationItems || [],
      teacherReviewItems: sectionReflection.teacherReviewItems || [],
      postAiReflection:
        overrides?.postAiReflection ||
        (sectionReflection.postAiReflection
          ? {
              changedJudgment: sectionReflection.postAiReflection.changedJudgment,
              unresolvedQuestion: sectionReflection.postAiReflection.unresolvedQuestion,
              transferPlan: sectionReflection.postAiReflection.transferPlan
            }
          : undefined),
      draftRevealedAt: sectionReflection.draftRevealedAt,
      draftReviewStatus: sectionReflection.draftReviewStatus,
      completedAt: sectionReflection.completedAt,
      learnerNotes:
        overrides?.learnerNotes !== undefined ? overrides.learnerNotes : sectionReflection.learnerNotes
    });
    patchScaffoldState(nextState.scaffoldState);
    await logScaffoldEvent('learner_reflection_saved', {
      keyInfoCount: keyInformationItems.length,
      missingCount: missingInformationItems.length
    });
    return nextState;
  };

  /** Step 1 → Step 2: 기록 검토 완료를 저장한다. */
  const handleCompleteRecordReview = async () => {
    if (!caseId || !sectionId) return;
    setSavingProgressKey('recordReviewCompleted');
    setError(null);

    try {
      await persistSectionReflection();
      let nextState = await caseApi.updateScaffoldSectionProgress(caseId, sectionId, {
        recordReviewCompleted: true
      });
      if (confirmationQuestions.length === 0) {
        nextState = await caseApi.updateScaffoldSectionProgress(caseId, sectionId, {
          missingInfoReviewCompleted: true
        });
      }
      patchScaffoldState(nextState.scaffoldState);
      await logScaffoldEvent('record_review_completed', {
        selectedEvidenceCount: selectedEvidenceItems.length
      });
      setCurrentStep(confirmationQuestions.length === 0 ? 'step3' : 'step2');
    } catch (err: any) {
      setError(err.message || '기록 검토 내용을 저장하지 못했습니다.');
    } finally {
      setSavingProgressKey(null);
    }
  };

  /** additional_authoring 섹션의 직접 작성 내용을 저장한다. */
  const handleSaveAuthoringNotes = async () => {
    if (!caseId || !sectionId) return;
    setSavingProgressKey('learnerNotes');
    setError(null);

    try {
      await persistSectionReflection({ learnerNotes: authoringNotes });
      setFeedback('작성 내용이 저장되었습니다.');
      setTimeout(() => setFeedback(null), 2000);
    } catch (err: any) {
      setError(err.message || '작성 내용을 저장하지 못했습니다.');
    } finally {
      setSavingProgressKey(null);
    }
  };

  const handleAddEvidenceFromVisit = (visitIndex: number) => {
    const visit = visits[visitIndex];
    if (!visit) return;

    const newItem: SelectedEvidenceItem = {
      id: `visit:${visitIndex}`,
      sourceType: 'visit_soap',
      sourceText: visit.soapText || '',
      visitIndex,
      label: `${visit.type} #${visitIndex + 1}`,
      timestamp: Date.now()
    };

    setSelectedEvidenceItems((prev) =>
      prev.some((item) => item.id === newItem.id) ? prev : [...prev, newItem]
    );
    setNoRelevantEvidenceConfirmed(false);
  };

  const handleToggleEvidenceChoice = (choiceId: string) => {
    const choice = evidenceChoices.find((item) => item.id === choiceId);
    if (!choice) return;

    setSelectedEvidenceItems((prev) => {
      if (prev.some((item) => item.id === choiceId)) {
        return prev.filter((item) => item.id !== choiceId);
      }

      return [
        ...prev,
        {
          id: choice.id,
          sourceType: 'evidence_card',
          sourceText: choice.text,
          extractedContent: choice.text,
          label: [choice.sourceLabel, choice.text].filter(Boolean).join(' · ').slice(0, 120),
          timestamp: Date.now()
        }
      ];
    });
    setNoRelevantEvidenceConfirmed(false);
  };

  const handleRemoveEvidenceItem = (id: string) => {
    setSelectedEvidenceItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleAddKeyInformation = () => {
    const items = parseMultilineList(keyInformationDraft);
    if (items.length > 0) {
      setKeyInformationItems((prev) => [...new Set([...prev, ...items])]);
      setKeyInformationDraft('');
      setNoRelevantEvidenceConfirmed(false);
    }
  };

  const handleRemoveKeyInformation = (item: string) => {
    setKeyInformationItems((prev) => prev.filter((i) => i !== item));
  };

  const handleAddMissingInformation = () => {
    const items = parseMultilineList(missingInformationDraft);
    if (items.length > 0) {
      setMissingInformationItems((prev) => [...new Set([...prev, ...items])]);
      setMissingInformationDraft('');
    }
  };

  const handleRemoveMissingInformation = (item: string) => {
    setMissingInformationItems((prev) => prev.filter((i) => i !== item));
  };

  const handleConfirmationQuestionJudgment = async (questionId: string, judgment: string) => {
    setConfirmationQuestionJudgments((prev) => ({ ...prev, [questionId]: judgment }));

    const question = confirmationQuestions.find((item) => item.id === questionId);
    if (!caseId || !sectionId || !question) return;

    // 판단을 서버에 저장한다. 저장하지 않으면 새로고침 시 사라지고
    // preRevealSnapshot에도 남지 않는다.
    setSavingConfirmationQuestionIds((prev) => new Set(prev).add(questionId));
    try {
      const nextState = await caseApi.upsertScaffoldReviewItem(
        caseId,
        buildScaffoldItemId(sectionId, 'custom', questionId, 0),
        {
          sectionId,
          sourceType: 'custom',
          sourceText: question.question,
          judgment: toInformationStatusJudgment(judgment)
        }
      );
      patchScaffoldState(nextState.scaffoldState);
      await logScaffoldEvent('information_status_judgment_saved', {
        questionId,
        judgment
      });
    } catch (err: any) {
      setError(err.message || '확인 항목 판단을 저장하지 못했습니다.');
    } finally {
      setSavingConfirmationQuestionIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
  };

  const handleProceedToStep3 = async () => {
    // 화면에 보여줄 요약은 아래 Step 3에서 그대로 렌더링되고,
    // 실제 pre-reveal snapshot은 reveal 시점에 서버가 저장된 reflection과
    // review item에서 생성한다. 따라서 여기서는 reflection만 확실히 저장한다.
    if (!caseId || !sectionId) return;
    setSavingProgressKey('preRevealSummary');
    setError(null);

    try {
      await persistSectionReflection();
      // Step 2(정보 충분성 확인) 완료. 이 플래그가 없으면 개요 화면에서
      // 섹션이 영영 '완료'로 집계되지 않는다.
      const nextState = await caseApi.updateScaffoldSectionProgress(caseId, sectionId, {
        missingInfoReviewCompleted: true
      });
      patchScaffoldState(nextState.scaffoldState);
      setCurrentStep('step3');
    } catch (err: any) {
      setError(err.message || '정리 내용을 저장하지 못했습니다.');
    } finally {
      setSavingProgressKey(null);
    }
  };

  const handleRevealAI = async () => {
    if (!caseId || !sectionId) return;
    setSavingProgressKey('draftRevealed');

    // snapshot이 없는 prototype mode에서도 오른쪽 패널이 공개 전 상태를 유지하도록
    // 지금 화면의 정리 내용을 얼려 둔다. study mode에서는 서버 snapshot이 우선한다.
    frozenSummaryRef.current = liveSummaryGroups;

    try {
      const nextState = await caseApi.updateScaffoldSectionProgress(caseId, sectionId, {
        draftRevealed: true
      });
      patchScaffoldState(nextState.scaffoldState);

      await logScaffoldEvent('ai_draft_revealed', {
        selectedEvidenceCount: selectedEvidenceItems.length,
        keyInfoCount: keyInformationItems.length,
        missingCount: missingInformationItems.length
      });
      await logScaffoldEvent('post_ai_review_started', {
        source: 'ai_reveal_transition'
      });

      // reveal 전에는 서버가 초안을 빈 문자열로 내려주므로, reveal 직후
      // 다시 불러오지 않으면 Step 4에 "초안이 없습니다"만 표시된다.
      await loadData(false);

      setCurrentStep('step4');
      setFeedback('AI 초안을 확인할 수 있습니다.');
      setTimeout(() => setFeedback(null), 3000);
    } catch (err: any) {
      const gate = err?.response?.data?.revealGate;
      if (gate) {
        const missing = [
          !gate.purposeViewed && '섹션 목적 확인',
          !gate.reflectionSaved && '내가 정리한 내용 저장',
          !gate.recordReviewCompleted && '기록 검토 완료',
          !gate.sufficiencyReviewCompleted && '정보 충분성 확인 완료',
          !gate.allSufficiencyJudgmentsSaved && '모든 충분성 판단 저장'
        ].filter(Boolean);
        setError(`AI 초안을 보기 전에 완료해야 하는 단계가 있습니다: ${missing.join(', ')}`);
      } else {
        setError(err.message || 'AI 초안 표시에 실패했습니다.');
      }
    } finally {
      setSavingProgressKey(null);
    }
  };

  const saveReviewItem = async (
    itemId: string,
    sourceType: ScaffoldReviewSourceType,
    sourceText: string,
    judgment?: ScaffoldReviewJudgment
  ) => {
    if (!caseId || !sectionId) return;
    if (sourceType === 'draft_sentence') {
      const nextJudgment = judgment || 'pending';
      const nextEvidenceIds = evidenceDrafts[itemId] || [];
      const nextNote = noteDrafts[itemId] || '';

      if (nextJudgment === 'pending') {
        setError('AI 초안 문장의 판단을 먼저 선택해주세요.');
        return;
      }

      if (!nextNote.trim() && nextEvidenceIds.length === 0) {
        setError('판단 이유를 입력하거나 SOAP 근거를 선택해주세요.');
        return;
      }
    }
    setSavingItemId(itemId);

    try {
      const nextState = await caseApi.upsertScaffoldReviewItem(caseId, itemId, {
        sectionId,
        sourceType,
        sourceText,
        judgment: judgment || 'pending',
        note: noteDrafts[itemId] || '',
        evidenceIds: evidenceDrafts[itemId] || []
      });
      patchScaffoldState(nextState.scaffoldState);

      setFeedback('검토 내용이 저장되었습니다.');
      setTimeout(() => setFeedback(null), 2000);

      await logScaffoldEvent('draft_judgment_saved', {
        sourceType,
        judgment
      });
    } catch (err: any) {
      setError(err.message || '저장에 실패했습니다.');
    } finally {
      setSavingItemId(null);
    }
  };

  const handleCompleteSection = async () => {
    if (!caseId || !sectionId) return;
    if (!postAiReflectionComplete && draftSentences.length > 0) {
      setError('AI 검토 후 회고 세 항목을 모두 작성해주세요. 변화가 없다면 “변화 없음”으로 적을 수 있습니다.');
      return;
    }
    setSavingProgressKey('draftReviewCompleted');
    setError(null);

    try {
      if (draftSentences.length > 0) {
        await persistSectionReflection({
          postAiReflection: {
            changedJudgment: changedJudgmentReflection.trim(),
            unresolvedQuestion: unresolvedQuestionReflection.trim(),
            transferPlan: transferPlanReflection.trim()
          }
        });
        await logScaffoldEvent('post_ai_reflection_saved', {
          changedJudgmentLength: changedJudgmentReflection.trim().length,
          unresolvedQuestionLength: unresolvedQuestionReflection.trim().length,
          transferPlanLength: transferPlanReflection.trim().length
        });
      }

      const nextState = await caseApi.updateScaffoldSectionProgress(caseId, sectionId, {
        draftReviewCompleted: true
      });
      patchScaffoldState(nextState.scaffoldState);

      setFeedback('섹션이 완료되었습니다.');
      setTimeout(() => setFeedback(null), 2000);

      await logScaffoldEvent('draft_review_completed', {
        draftJudgmentCount
      });
      await logScaffoldEvent('section_completed', {
        draftJudgmentCount
      });

      setTimeout(() => {
        if (nextSectionId) {
          navigate(
            `${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/sections/${nextSectionId}`
          );
        } else {
          navigate(
            `${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/summary`
          );
        }
      }, 1000);
    } catch (err: any) {
      setError(err.message || '완료 저장에 실패했습니다.');
    } finally {
      setSavingProgressKey(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#4a5d73' }}>
        로딩 중...
      </div>
    );
  }

  // ===== Render =====

  return (
    <div className="scaffold-workspace">
      <ScaffoldProgressHeader
        currentSectionId={sectionId || ''}
        availableSectionIds={sectionOrder}
        progressItems={scaffoldData?.scaffoldState.sectionProgress || []}
        onNavigate={(nextId) =>
          navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/sections/${nextId}`)
        }
      />
      {scaffoldData?.experiment_code || scaffoldData?.experimentCode ? (
        <div style={{ margin: '10px 0 18px 0', color: '#5a6c81', fontSize: 13, fontWeight: 600 }}>
          실험번호: {scaffoldData.experiment_code || scaffoldData.experimentCode}
        </div>
      ) : null}

      <div className="scaffold-workspace__grid">
      {/* PANEL 1: SOURCE RECORD */}
      <section className="scaffold-pane scaffold-pane--source" aria-label="환자 원기록">
        <div className="scaffold-pane__head">
          <h2 className="scaffold-pane__title">환자 원기록</h2>
          <p className="scaffold-pane__hint">
            {sectionProgress.draftRevealed
              ? '진료 방문 기록 (AI 초안과 대조)'
              : '진료 방문 기록 (정보 선택)'}
          </p>
        </div>

        <div className="scaffold-pane__body" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
          {visits.map((visit: any, index: number) => {
            const isExpanded = expandedVisits.has(index);
            const visitDate = visit.date
              ? new Date(visit.date).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : '날짜 없음';

            return (
              <div
                key={index}
                style={{
                  border: '1px solid #d7e0e8',
                  borderRadius: 6,
                  background: '#fcfdff',
                  overflow: 'hidden'
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleVisitExpanded(index)}
                  style={{
                    width: '100%',
                    padding: 12,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    textAlign: 'left',
                    gap: 8
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        color: '#000000',
                        fontWeight: 700,
                        marginBottom: 4,
                        fontSize: 15
                      }}
                    >
                      {visit.type} #{index + 1}
                    </div>
                    <div style={{ color: '#333333', fontSize: 13 }}>{visitDate}</div>
                  </div>
                  <div style={{ color: '#5a6c81', fontSize: 14, flexShrink: 0 }}>
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </button>

                {isExpanded && (
                  <div
                    style={{
                      padding: 16,
                      borderTop: '1px solid #d7e0e8',
                      background: '#ffffff',
                      // 방문 카드마다 별도 스크롤을 만들지 않는다. 스크롤은
                      // 왼쪽 패널 하나만 담당한다.
                      fontSize: 14,
                      lineHeight: 1.8,
                      color: '#000000',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: 'system-ui, -apple-system, sans-serif'
                    }}
                  >
                    {visit.soapText || '기록 없음'}
                  </div>
                )}

                {/* Add Evidence Button - Only show in Step 1 */}
                {!sectionProgress.draftRevealed && currentStep === 'step1' && evidenceChoices.length === 0 && (
                  <div style={{ padding: '8px 16px', borderTop: '1px solid #d7e0e8', background: '#f8fafc' }}>
                    <button
                      type="button"
                      onClick={() => handleAddEvidenceFromVisit(index)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: 4,
                        border: '1px solid #5a9eca',
                        background: '#e8f3ff',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: '#244a86',
                        fontWeight: 500
                      }}
                    >
                      이 기록 사용
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {visits.length === 0 && (
            <div style={{ padding: 12, borderRadius: 6, background: '#f8fafc', color: '#5a6c81', fontSize: 12 }}>
              진료 기록이 없습니다.
            </div>
          )}
        </div>
      </section>

      {/* PANEL 2: CURRENT WORK (post-reveal: AI draft review) */}
      <section
        className="scaffold-pane scaffold-pane--work"
        aria-label={sectionProgress.draftRevealed ? 'AI 초안 검토' : '현재 작업'}
      >
        <div className="scaffold-pane__head">
          <h2 className="scaffold-pane__title">
            {sectionProgress.draftRevealed ? 'AI 초안 검토' : '현재 작업'}
          </h2>
          <p className="scaffold-pane__hint">
            {sectionProgress.draftRevealed
              ? '왼쪽 원기록, 오른쪽 내 판단과 대조하며 검토하세요.'
              : '왼쪽 환자 원기록을 확인하면서 진행하세요.'}
          </p>
        </div>

        <div className="scaffold-pane__body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {feedback ? (
            <div style={{ padding: 14, borderRadius: 8, background: '#eef8f1', color: '#23663a', marginBottom: 16 }}>
              {feedback}
            </div>
          ) : null}
          {error ? (
            <div style={{ padding: 14, borderRadius: 8, background: '#fdecec', color: '#b42318', marginBottom: 16 }}>
              {error}
            </div>
          ) : null}

          {/* GROUP 3: SIMPLIFIED WORKFLOW FOR ADDITIONAL AUTHORING SECTIONS */}
          {isAdditionalAuthoring ? (
            <div style={{ display: 'grid', gap: 20 }}>
              {/* Info: EMR-independent authoring */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 8,
                  background: '#fffaf0',
                  border: '1px solid #d9a656',
                  color: '#7a4e00'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
                  💡 의료 기록 외 정보 필요
                </div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  이 항목은 의료 기록에 직접 나타나지 않는 정보가 필요합니다. 좌측 기록을 참고하되, 의학적 지식, 학습 포인트, 임상적 의의 등을 바탕으로 작성해주세요.
                </p>
              </div>

              {/* Direct Draft Input */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', color: '#17324d', fontSize: 14, fontWeight: 600 }}>
                  {scaffoldConfig?.displayName || sectionTitle} 작성
                </h3>
                <p style={{ margin: '0 0 12px 0', color: '#5a6c81', fontSize: 13, lineHeight: 1.6 }}>
                  {scaffoldConfig?.description}
                </p>

                {scaffoldConfig?.requirements && scaffoldConfig.requirements.length > 0 && (
                  <div style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: '#f8fafc', borderLeft: '3px solid #5a9eca' }}>
                    <div style={{ fontWeight: 600, color: '#17324d', marginBottom: 8, fontSize: 12 }}>
                      필수 항목:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#5a6c81', lineHeight: 1.8 }}>
                      {scaffoldConfig.requirements.map((req) => (
                        <li key={req}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <textarea
                  value={authoringNotes}
                  onChange={(event) => setAuthoringNotes(event.target.value)}
                  placeholder="여기에 작성 내용을 입력하세요..."
                  style={{
                    width: '100%',
                    minHeight: 300,
                    padding: 12,
                    borderRadius: 6,
                    border: '1px solid #d7e0e8',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: 14,
                    color: '#17324d',
                    lineHeight: 1.6,
                    resize: 'vertical'
                  }}
                />

                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <ScaffoldActionButton
                    variant="primary"
                    onClick={() => void handleSaveAuthoringNotes()}
                    disabled={savingProgressKey === 'learnerNotes'}
                  >
                    {savingProgressKey === 'learnerNotes' ? '저장 중...' : '저장'}
                  </ScaffoldActionButton>
                  <ScaffoldActionButton
                    variant="secondary"
                    onClick={() => navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}`)}
                  >
                    목록으로 돌아가기
                  </ScaffoldActionButton>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* STEP 1: Evidence Selection */}
          {(currentStep === 'step1' || !sectionProgress.draftRevealed) && (
            <ScaffoldPanel
              title="Step 1: 기록에서 필요한 정보 찾기"
              description="왼쪽 환자 기록을 확인하고, 이 항목을 작성하는 데 필요한 정보를 선택하거나 정리해보세요."
            >
              <div style={{ display: 'grid', gap: 20 }}>
                {evidenceChoices.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 8px 0', color: '#17324d', fontSize: 13, fontWeight: 600 }}>
                      SOAP 구체 근거 선택
                    </h4>
                    {mappedEvidenceIds.length > 0 ? (
                      <div
                        style={{
                          marginBottom: 10,
                          padding: '9px 10px',
                          border: '1px solid #bfdccb',
                          borderRadius: 6,
                          background: '#eff6f2',
                          color: '#256247',
                          fontSize: 12,
                          lineHeight: 1.5
                        }}
                      >
                        Scaffold v2 증례지도에서 이 섹션에 연결한 근거 {mappedEvidenceIds.length}개를 가져왔습니다.
                      </div>
                    ) : null}
                    <ScaffoldEvidenceSelector
                      choices={evidenceChoices}
                      selectedIds={selectedEvidenceItems
                        .filter((item) => item.sourceType === 'evidence_card')
                        .map((item) => item.id)}
                      onToggle={handleToggleEvidenceChoice}
                      helperText={
                        mappedEvidenceIds.length > 0
                          ? '증례지도에서 가져온 근거를 확인하고, 이 섹션에 필요한 경우 조정하세요.'
                          : '방문 전체가 아니라 SOAP에서 추출된 구체 근거를 선택하세요.'
                      }
                    />
                  </div>
                )}

                {/* Selected Evidence Items */}
                {selectedEvidenceItems.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 8px 0', color: '#17324d', fontSize: 13, fontWeight: 600 }}>
                      선택한 SOAP 근거
                    </h4>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {selectedEvidenceItems.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            padding: 12,
                            borderRadius: 6,
                            background: '#e8f3ff',
                            border: '1px solid #5a9eca',
                            fontSize: 12,
                            color: '#244a86'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.label}</div>
                              <div style={{ color: '#5a7a9e', fontSize: 11, lineHeight: 1.5 }}>
                                {item.sourceText.substring(0, 80)}...
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveEvidenceItem(item.id)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: 16,
                                color: '#5a9eca',
                                padding: '0 4px'
                              }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Information */}
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: '#17324d', fontSize: 13, fontWeight: 600 }}>
                    작성에 사용할 정보
                  </h4>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                    {keyInformationItems.map((item) => (
                      <div
                        key={item}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: 10,
                          borderRadius: 6,
                          background: '#f0f5fb',
                          border: '1px solid #d7e0e8',
                          fontSize: 13,
                          color: '#17324d'
                        }}
                      >
                        <span>{item}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveKeyInformation(item)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: 16,
                            color: '#7a8fa1',
                            padding: '0 4px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={keyInformationDraft}
                      onChange={(e) => setKeyInformationDraft(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddKeyInformation();
                        }
                      }}
                      placeholder="직접 정보를 입력하고 엔터를 누르세요"
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: '1px solid #c8d2dd',
                        fontSize: 13,
                        fontFamily: 'inherit'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddKeyInformation}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 6,
                        border: '1px solid #d7e0e8',
                        background: '#fcfdff',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#17324d',
                        fontWeight: 500
                      }}
                    >
                      + 추가
                    </button>
                  </div>
                </div>

                {/* Missing Information */}
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: '#17324d', fontSize: 13, fontWeight: 600 }}>
                    작성하면서 부족하다고 느낀 정보
                  </h4>
                  <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                    {missingInformationItems.map((item) => (
                      <div
                        key={item}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: 10,
                          borderRadius: 6,
                          background: '#fff5f0',
                          border: '1px solid #e8c8c0',
                          fontSize: 13,
                          color: '#17324d'
                        }}
                      >
                        <span>{item}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMissingInformation(item)}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: 16,
                            color: '#7a8fa1',
                            padding: '0 4px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={missingInformationDraft}
                      onChange={(e) => setMissingInformationDraft(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddMissingInformation();
                        }
                      }}
                      placeholder="부족한 정보를 입력하고 엔터를 누르세요"
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: '1px solid #c8d2dd',
                        fontSize: 13,
                        fontFamily: 'inherit'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddMissingInformation}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 6,
                        border: '1px solid #d7e0e8',
                        background: '#fcfdff',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#17324d',
                        fontWeight: 500
                      }}
                    >
                      + 추가
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    padding: 12,
                    border: '1px solid #d7e0e8',
                    borderRadius: 8,
                    background: '#f8fafc'
                  }}
                >
                  <div style={{ color: '#17324d', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    Step 1 완료 기준
                  </div>
                  <div style={{ color: '#52606d', fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
                    SOAP 근거를 선택하거나, 작성에 사용할 정보를 직접 입력하세요. 둘 다 어렵다면 아래 항목을 확인하세요.
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: '#17324d',
                      fontSize: 13,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={noRelevantEvidenceConfirmed}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setNoRelevantEvidenceConfirmed(checked);
                        if (checked) {
                          setSelectedEvidenceItems([]);
                          setKeyInformationItems([]);
                          setKeyInformationDraft('');
                        }
                      }}
                    />
                    현재 기록에서 이 항목에 사용할 관련 근거를 찾지 못했습니다.
                  </label>
                </div>
              </div>

              {/* Action Button */}
              <div style={{ marginTop: 20 }}>
                <ScaffoldActionButton
                  variant="primary"
                  onClick={() => void handleCompleteRecordReview()}
                  disabled={!step1Complete || savingProgressKey === 'recordReviewCompleted'}
                >
                  {savingProgressKey === 'recordReviewCompleted'
                    ? '저장 중...'
                    : '다음: 정보 충분성 확인'}
                </ScaffoldActionButton>
              </div>
            </ScaffoldPanel>
          )}

          {/* STEP 2: Confirmation Questions */}
          {(currentStep === 'step2' || !sectionProgress.draftRevealed) && confirmationQuestions.length > 0 && (
            <ScaffoldPanel
              title="Step 2: 이 정보만으로 충분한지 확인하기"
              description="증례보고를 작성하기 전에, 필요한 정보가 충분한지 확인해보세요."
            >
              <div style={{ display: 'grid', gap: 20 }}>
                {confirmationQuestions.map((question) => (
                  <div
                    key={question.id}
                    style={{
                      padding: 16,
                      borderRadius: 8,
                      border: '1px solid #d7e0e8',
                      background: '#fcfdff'
                    }}
                  >
                    <div style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#17324d',
                          marginBottom: 4
                        }}
                      >
                        {question.question}
                      </div>
                      {question.description && (
                        <div style={{ fontSize: 12, color: '#5a6c81', lineHeight: 1.5 }}>
                          {question.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                      {CONFIRMATION_JUDGMENT_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                            cursor: 'pointer',
                            color: '#17324d'
                          }}
                        >
                          <input
                            type="radio"
                            name={`question-${question.id}`}
                            value={option.value}
                            checked={confirmationQuestionJudgments[question.id] === option.value}
                            onChange={(e) =>
                              void handleConfirmationQuestionJudgment(question.id, e.target.value)
                            }
                            style={{ cursor: 'pointer' }}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Checklist */}
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  borderRadius: 8,
                  background: '#f8fafc',
                  border: '1px solid #d7e0e8'
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: '#17324d', marginBottom: 12 }}>
                  AI 초안을 보기 전에 다음을 확인해주세요
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#17324d' }}>
                    <span>{step1Complete ? '✓' : '○'}</span>
                    <span>정보 선택 및 정리</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#17324d' }}>
                    <span>{step2Complete ? '✓' : '○'}</span>
                    <span>정보 충분성 확인</span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div style={{ marginTop: 20 }}>
                <ScaffoldActionButton
                  variant="primary"
                  onClick={() => void handleProceedToStep3()}
                  disabled={!step1Complete || !step2Complete || savingProgressKey === 'preRevealSummary'}
                >
                  {savingProgressKey === 'preRevealSummary' ? '저장 중...' : '다음: 정리 내용 검토'}
                </ScaffoldActionButton>
              </div>
            </ScaffoldPanel>
          )}

          {/* STEP 3: AI reveal. 정리내용은 오른쪽 패널에 상시 보이므로
              여기서 다시 열거하지 않고 기존 reveal 흐름만 유지한다. */}
          {(currentStep === 'step3' || (!sectionProgress.draftRevealed && currentStep !== 'step1' && currentStep !== 'step2')) && (
            <ScaffoldPanel
              title="AI 초안 확인"
              description="AI 초안을 확인하기 전에 오른쪽 ‘내가 정리한 내용’을 확인해주세요. 이 내용이 현재 기록을 보고 판단한 결과입니다."
            >
              <div style={{ marginTop: 4 }}>
                <ScaffoldActionButton
                  variant="primary"
                  onClick={handleRevealAI}
                  disabled={savingProgressKey === 'draftRevealed'}
                >
                  {savingProgressKey === 'draftRevealed' ? 'AI 초안 생성 중...' : 'AI 초안 생성 및 확인'}
                </ScaffoldActionButton>
              </div>
            </ScaffoldPanel>
          )}

          {/* STEP 4: AI Draft Review (Post-reveal) */}
          {sectionProgress.draftRevealed && (
            <ScaffoldPanel title="Step 4: AI 초안 검토">
              <div style={{ display: 'grid', gap: 16 }}>
                {/* 공개 전 내 판단은 오른쪽 패널에 얼려진 상태로 계속 보이므로
                    여기서 다시 보여주지 않는다. 세 영역을 나란히 두는 것이
                    원기록 ↔ AI ↔ 내 판단 비교의 목적이다. */}

                {/* AI Draft */}
                <div
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    border: '1px solid #d7e0e8',
                    background: '#fcfdff'
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#17324d', marginBottom: 12 }}>
                    AI 초안
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.8,
                      color: '#17324d',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {renderClinicalAnonymizedText(
                      detail?.currentDraft || sectionDraftEntry?.draftText
                    ) || '초안이 없습니다.'}
                  </div>
                </div>

                {/* Draft Sentences Review */}
                {draftSentences.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: '#17324d',
                        marginBottom: 12
                      }}
                    >
                      초안 검토 ({draftJudgmentCount} / {draftSentences.length} 완료)
                    </div>

                    <div style={{ display: 'grid', gap: 12 }}>
                      {draftSentences.map((sentence, index) => {
                        const itemId = buildScaffoldItemId(sectionId || '', 'draft_sentence', sentence, index);
                        const stored = existingReviewMap.get(itemId);
                        const selectedJudgment = judgmentDrafts[itemId] || stored?.judgment || 'pending';
                        const note = noteDrafts[itemId] ?? stored?.note ?? '';
                        const selectedEvidenceIds = evidenceDrafts[itemId] ?? stored?.evidenceIds ?? [];
                        const learningFeedback = stored?.learningFeedback;
                        const hasSupport = Boolean(note.trim() || selectedEvidenceIds.length > 0);
                        const validationMessage =
                          selectedJudgment === 'pending'
                            ? '판단을 선택해야 저장할 수 있습니다.'
                            : hasSupport
                              ? undefined
                              : '판단 이유를 입력하거나 SOAP 근거를 선택해야 저장할 수 있습니다.';

                        return (
                          <ScaffoldReviewCard
                            key={itemId}
                            badgeLabel="문장"
                            title={sentence}
                            judgmentValue={selectedJudgment}
                            judgmentOptions={DRAFT_JUDGMENT_OPTIONS}
                            onJudgmentChange={(value) =>
                              setJudgmentDrafts((prev) => ({ ...prev, [itemId]: value as ScaffoldReviewJudgment }))
                            }
                            noteValue={note}
                            onNoteChange={(value) => setNoteDrafts((prev) => ({ ...prev, [itemId]: value }))}
                            notePlaceholder="판단 사유"
                            saveLabel="저장"
                            saveDisabled={Boolean(validationMessage)}
                            validationMessage={validationMessage}
                            onSave={() =>
                              void saveReviewItem(itemId, 'draft_sentence', sentence, selectedJudgment)
                            }
                            saving={savingItemId === itemId}
                          >
                            <ScaffoldEvidenceSelector
                              choices={evidenceChoices}
                              selectedIds={selectedEvidenceIds}
                              onToggle={(id) =>
                                setEvidenceDrafts((prev) => ({
                                  ...prev,
                                  [itemId]: toggleId(prev[itemId] || [], id)
                                }))
                              }
                            />
                            {learningFeedback ? (
                              <div className="scaffold-learning-feedback" aria-live="polite">
                                <div className="scaffold-learning-feedback__label">검토 코치</div>
                                <p>{learningFeedback.summary}</p>
                                {learningFeedback.selectedEvidence.length > 0 ? (
                                  <div className="scaffold-learning-feedback__evidence">
                                    <strong>다시 볼 선택 근거</strong>
                                    {learningFeedback.selectedEvidence.map((evidence) => (
                                      <blockquote key={evidence.id}>
                                        {renderClinicalAnonymizedText(evidence.text)}
                                      </blockquote>
                                    ))}
                                  </div>
                                ) : null}
                                <ul>
                                  {learningFeedback.prompts.map((prompt) => (
                                    <li key={prompt}>{prompt}</li>
                                  ))}
                                </ul>
                                <small>정답 판정이 아니라, 저장한 판단을 원기록과 다시 대조하기 위한 안내입니다.</small>
                              </div>
                            ) : null}
                          </ScaffoldReviewCard>
                        );
                      })}
                    </div>
                  </div>
                )}

                {allDraftJudgmentsSaved && draftSentences.length > 0 ? (
                  <section className="scaffold-post-ai-reflection" aria-labelledby="post-ai-reflection-title">
                    <div>
                      <div className="scaffold-post-ai-reflection__eyebrow">Step 5</div>
                      <h3 id="post-ai-reflection-title">AI 검토 후 내 판단 정리</h3>
                      <p>AI 초안을 본 뒤 무엇이 달라졌는지 적어야 이번 검토가 다음 작성 경험으로 이어집니다.</p>
                    </div>

                    <label>
                      <span>AI를 보기 전과 비교해 달라진 판단</span>
                      <textarea
                        value={changedJudgmentReflection}
                        onChange={(event) => setChangedJudgmentReflection(event.target.value)}
                        placeholder="달라진 판단과 그 이유를 적으세요. 변화가 없다면 그 이유를 적으세요."
                        rows={3}
                      />
                    </label>

                    <label>
                      <span>아직 확인이 필요한 내용</span>
                      <textarea
                        value={unresolvedQuestionReflection}
                        onChange={(event) => setUnresolvedQuestionReflection(event.target.value)}
                        placeholder="추가 기록, 검사 또는 교수자 확인이 필요한 내용을 적으세요. 없다면 ‘없음’으로 적으세요."
                        rows={3}
                      />
                    </label>

                    <label>
                      <span>다음 증례보고 작성에 적용할 점</span>
                      <textarea
                        value={transferPlanReflection}
                        onChange={(event) => setTransferPlanReflection(event.target.value)}
                        placeholder="다음에는 원기록을 어떻게 탐색하고 AI 초안을 어떻게 검토할지 적으세요."
                        rows={3}
                      />
                    </label>
                  </section>
                ) : null}

                {/* Complete Section Button */}
                <div style={{ marginTop: 20 }}>
                  <ScaffoldActionButton
                    variant="primary"
                    onClick={handleCompleteSection}
                    disabled={
                      !allDraftJudgmentsSaved ||
                      (draftSentences.length > 0 && !postAiReflectionComplete) ||
                      savingProgressKey === 'draftReviewCompleted'
                    }
                  >
                    {savingProgressKey === 'draftReviewCompleted' ? '저장 중...' : '회고 저장 후 이 항목 완료'}
                  </ScaffoldActionButton>
                  {allDraftJudgmentsSaved && draftSentences.length > 0 && !postAiReflectionComplete ? (
                    <p className="scaffold-post-ai-reflection__helper">회고 세 항목을 모두 작성하면 완료할 수 있습니다.</p>
                  ) : null}
                </div>
              </div>
            </ScaffoldPanel>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <ScaffoldActionButton
              onClick={() =>
                navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}`)
              }
            >
              개요로 돌아가기
            </ScaffoldActionButton>
            {nextSectionId && sectionProgress.draftRevealed && (
              <ScaffoldActionButton
                variant="primary"
                onClick={() =>
                  navigate(
                    `${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/sections/${nextSectionId}`
                  )
                }
              >
                다음 항목
              </ScaffoldActionButton>
            )}
          </div>
            </>
          )}
          </div>
        </div>
      </section>

      {/* PANEL 3: THE LEARNER'S OWN SUMMARY - read-only, never AI-generated */}
      <section
        className="scaffold-pane scaffold-pane--summary"
        aria-label={sectionProgress.draftRevealed ? 'AI 공개 전 내가 정리한 내용' : '내가 정리한 내용'}
      >
        <div className="scaffold-pane__head">
          <h2 className="scaffold-pane__title">
            {sectionProgress.draftRevealed ? 'AI 공개 전 내가 정리한 내용' : '내가 정리한 내용'}
          </h2>
          <p className="scaffold-pane__hint">
            {sectionProgress.draftRevealed
              ? '이 내용은 AI 초안을 보기 전에 판단한 것으로 더 이상 바뀌지 않습니다.'
              : '가운데에서 입력하거나 선택한 내용이 여기에 정리됩니다.'}
          </p>
        </div>

        <div className="scaffold-pane__body">
          <ScaffoldSelfSummary
            groups={summaryGroups}
            frozen={sectionProgress.draftRevealed}
            frozenNote={
              sectionProgress.draftRevealed && !snapshotSummaryGroups
                ? 'AI 초안을 확인하기 직전의 정리 내용입니다.'
                : undefined
            }
            emptyMessage={
              sectionProgress.draftRevealed
                ? 'AI 초안을 보기 전에 정리한 내용이 없습니다.'
                : '아직 정리한 내용이 없습니다. 왼쪽 기록을 확인하면서 필요한 정보를 선택하고 판단해보세요.'
            }
          />
        </div>
      </section>
      </div>
    </div>
  );
}
