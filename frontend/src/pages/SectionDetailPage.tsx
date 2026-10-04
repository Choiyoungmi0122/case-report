import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ChainProgressBanner from '../components/ChainProgressBanner';
import PendingTermConfirmationModal from '../components/PendingTermConfirmationModal';
import TimelineDraftView from '../components/TimelineDraftView';
import { caseApi, Case, CommonAnswerSubmitResponse, CommonQuestionItem, SectionDetail } from '../services/api';
import { getReviewRequiredDescription, getReviewRequiredTitle, getStaleReasonLabel } from '../utils/caseStatusUi';
import { getCommonQuestionCategoryLabel, normalizeQuestionTextForDisplay } from '../utils/commonQuestionUi';
import { buildAcademicKeywordPreview, buildAcademicTitlePreview } from '../utils/frontMatterPreview';
import { createResearchEventId, logResearchEvent } from '../utils/research';
import { formatSectionDraftForDisplay } from '../utils/sectionDraftFormatter';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import './SectionDetailPage.css';

type QnaItem = {
  question: string;
  answer: string;
  timestamp: string;
};

type QuestionItem = {
  id: string;
  text: string;
  kind: 'common' | 'section';
  category?: string;
  answered?: boolean;
};

type SectionSubmitResult = {
  updatedDraft: string;
  updatedDraftsBySection: Record<string, string>;
  nextQuestion?: string;
  sectionQuestions: string[];
  commonQuestions: CommonQuestionItem[];
  sectionMissingInfo: string[];
  commonMissingInfo: string[];
  qnaHistory: QnaItem[];
  commonQnaHistory: QnaItem[];
  uiHints?: SectionDetail['uiHints'];
};

const SECTION_LABELS: Record<string, string> = {
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
  DISCUSSION_CONCLUSION: '논의',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '사전 동의'
};

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

const MANUSCRIPT_SECTION_ORDER = [
  'TITLE',
  'KEYWORDS',
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
] as const;

type FrontMatterPreview = {
  title: string;
  keywords: string[];
  abstract: string;
  introduction: string;
  discussion: string;
  informedConsent: string;
};

function getSectionTitle(sectionId?: string) {
  if (!sectionId) return '';
  return SECTION_LABELS[sectionId] || sectionId;
}

function splitIntoSentences(text: string) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+|(?<=[다요])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstSentence(text: string) {
  return splitIntoSentences(text)[0] || '';
}

function compactText(text: string, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function getReviewScoreLabel(score?: 'LOW' | 'MEDIUM' | 'HIGH') {
  if (score === 'HIGH') return '높음';
  if (score === 'MEDIUM') return '보통';
  if (score === 'LOW') return '낮음';
  return '-';
}

function getEvidenceGroundingLabel(value?: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED_OR_UNVERIFIABLE') {
  if (value === 'SUPPORTED') return '충분히 근거 기반';
  if (value === 'PARTIALLY_SUPPORTED') return '일부 근거 보완 필요';
  if (value === 'UNSUPPORTED_OR_UNVERIFIABLE') return '근거 부족 또는 검증 어려움';
  return '-';
}

function buildFrontMatterPreview(
  draftsBySection: Record<string, string>,
  evidenceCards: Case['evidenceCards'] = []
): FrontMatterPreview | null {
  const patient = draftsBySection.PATIENT_INFORMATION || '';
  const clinical = draftsBySection.CLINICAL_FINDINGS || '';
  const timeline = draftsBySection.TIMELINE || '';
  const diagnostic = draftsBySection.DIAGNOSTIC_ASSESSMENT || '';
  const intervention = draftsBySection.THERAPEUTIC_INTERVENTIONS || '';
  const followUp = draftsBySection.FOLLOW_UP_OUTCOMES || '';

  const enoughForPreview =
    [patient, clinical, timeline].filter((text) => text.trim().length > 0).length >= 2 &&
    [diagnostic, intervention, followUp].filter((text) => text.trim().length > 0).length >= 1;

  if (!enoughForPreview) {
    return null;
  }

  const title = buildAcademicTitlePreview(draftsBySection, evidenceCards || []);
  const keywords = buildAcademicKeywordPreview(draftsBySection, evidenceCards || []);

  const abstractParts = [
    firstSentence(patient),
    firstSentence(clinical),
    firstSentence(diagnostic),
    firstSentence(intervention),
    firstSentence(followUp)
  ].filter(Boolean);

  const abstract = abstractParts.join(' ');

  const introduction =
    compactText(
      [
        firstSentence(patient),
        firstSentence(diagnostic),
        '본 증례보고는 CARE guideline에 따라 작성하였다.'
      ]
        .filter(Boolean)
        .join(' '),
      240
    ) || '본 증례보고는 CARE guideline에 따라 작성하였다.';

  const discussion =
    compactText(
      [
        firstSentence(diagnostic),
        firstSentence(followUp)
      ]
        .filter(Boolean)
        .join(' '),
      220
    ) || '';

  return {
    title,
    keywords,
    abstract,
    introduction,
    discussion,
    informedConsent: '환자 또는 보호자의 서면 동의 여부를 최종 원고 단계에서 확인하여 반영합니다.'
  };
}

function getGeneratedSectionPlaceholder(sectionId: string) {
  switch (sectionId) {
    case 'TITLE':
      return '본문 핵심 정보가 더 모이면 제목 초안을 자동으로 제안합니다.';
    case 'KEYWORDS':
      return '진단, 증상, 중재, 결과 정보가 더 모이면 키워드 초안을 자동으로 제안합니다.';
    case 'ABSTRACT':
      return '배경, 증례 요약, 핵심 결과가 정리되면 초록 초안을 보여줍니다.';
    case 'INTRODUCTION':
      return '증례의 배경과 필요성 설명이 정리되면 서론 초안을 보여줍니다.';
    case 'DISCUSSION_CONCLUSION':
      return '진단 해석, 치료 반응, 임상적 시사점이 더 모이면 논의 및 결론 초안을 보여줍니다.';
    case 'INFORMED_CONSENT':
      return '환자 동의 여부가 확인되면 사전 동의 문구를 반영합니다.';
    default:
      return '아직 작성된 내용이 없습니다.';
  }
}

function getPreviewText(params: {
  sectionId: string;
  draftsBySection: Record<string, string>;
  frontMatterPreview: FrontMatterPreview | null;
}) {
  const { sectionId, draftsBySection, frontMatterPreview } = params;

  if (sectionId === 'TITLE') {
    return draftsBySection.TITLE || frontMatterPreview?.title || '';
  }

  if (sectionId === 'KEYWORDS') {
    if (draftsBySection.KEYWORDS) return draftsBySection.KEYWORDS;
    return frontMatterPreview?.keywords?.length ? frontMatterPreview.keywords.join(', ') : '';
  }

  if (sectionId === 'ABSTRACT') {
    return draftsBySection.ABSTRACT || frontMatterPreview?.abstract || '';
  }

  if (sectionId === 'INTRODUCTION') {
    return draftsBySection.INTRODUCTION || frontMatterPreview?.introduction || '';
  }

  if (sectionId === 'DISCUSSION_CONCLUSION') {
    return draftsBySection.DISCUSSION_CONCLUSION || frontMatterPreview?.discussion || '';
  }

  if (sectionId === 'INFORMED_CONSENT') {
    return draftsBySection.INFORMED_CONSENT || frontMatterPreview?.informedConsent || '';
  }

  return draftsBySection[sectionId] || '';
}

function shouldFormatSection(sectionId: string) {
  return QUESTION_STAGE_SECTIONS.includes(sectionId as (typeof QUESTION_STAGE_SECTIONS)[number]);
}

function makeQuestionItems(
  questions: Array<string | CommonQuestionItem> | undefined,
  kind: 'common' | 'section',
  qnaHistory: QnaItem[] = []
): QuestionItem[] {
  const answeredSet = new Set(
    qnaHistory.map((item) => normalizeQuestionTextForDisplay(item.question).trim())
  );
  const seenTexts = new Set<string>();

  return (questions || [])
    .map((entry) =>
      typeof entry === 'string'
        ? { text: entry, category: undefined }
        : { text: entry?.question || '', category: entry?.category }
    )
    .map((entry) => ({
      ...entry,
      text: normalizeQuestionTextForDisplay(entry.text, entry.category)
    }))
    .filter((entry) => {
      const text = String(entry.text || '').trim();
      if (!text || seenTexts.has(text)) return false;
      seenTexts.add(text);
      return true;
    })
    .map((entry, idx) => ({
      id: `${kind}-${idx}-${entry.text}`,
      text: entry.text,
      kind,
      category: entry.category,
      answered: answeredSet.has(entry.text.trim())
    }));
}

function mergeDraftMaps(
  previous: Record<string, string> | undefined,
  nextDrafts: Record<string, string> | undefined
) {
  return {
    ...(previous || {}),
    ...(nextDrafts || {})
  };
}

function HistoryList({
  items,
  emptyText
}: {
  items: QnaItem[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="question-empty-state">{emptyText}</div>;
  }

  return (
    <>
      {items
        .slice()
        .reverse()
        .map((item, idx) => (
          <div key={`${item.question}-${idx}`} className="chat-message">
            <div className="message-question">
              <div className="message-avatar">질문</div>
              <div className="message-content">
                <div className="message-text">{item.question}</div>
              </div>
            </div>
            <div className="message-answer">
              <div className="message-avatar answer">답변</div>
              <div className="message-content">
                <div className="message-text">{item.answer}</div>
              </div>
            </div>
          </div>
        ))}
    </>
  );
}

export default function SectionDetailPage({ studyMode = false }: { studyMode?: boolean }) {
  const { caseId, sectionId } = useParams();
  const navigate = useNavigate();
  const writeBasePath = studyMode ? '/study/write' : '';

  const [caseData, setCaseData] = useState<Case | null>(null);
  const [section, setSection] = useState<SectionDetail | null>(null);
  const [draftsBySection, setDraftsBySection] = useState<Record<string, string>>({});
  const [selectedCommonQuestion, setSelectedCommonQuestion] = useState<QuestionItem | null>(null);
  const [activeSectionQuestion, setActiveSectionQuestion] = useState<string | null>(null);
  const [commonAnswerText, setCommonAnswerText] = useState('');
  const [sectionAnswerText, setSectionAnswerText] = useState('');
  const [editableTitle, setEditableTitle] = useState('');
  const [editableKeywords, setEditableKeywords] = useState('');
  const [editableDiscussion, setEditableDiscussion] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingKeywords, setIsEditingKeywords] = useState(false);
  const [isEditingDiscussion, setIsEditingDiscussion] = useState(false);
  const [showCommonHistory, setShowCommonHistory] = useState(false);
  const [showSectionHistory, setShowSectionHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingFrontMatter, setIsSavingFrontMatter] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isPendingTermModalOpen, setIsPendingTermModalOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const currentPreviewSectionRef = useRef<HTMLDivElement | null>(null);
  const loggedOpenRef = useRef<string | null>(null);

  const isQuestionStageSection = sectionId
    ? QUESTION_STAGE_SECTIONS.includes(sectionId as (typeof QUESTION_STAGE_SECTIONS)[number])
    : false;

  const loadData = async () => {
    if (!caseId || !sectionId || !isQuestionStageSection) return;

    const sectionResult = await caseApi.getSectionDetail(caseId, sectionId);
    if ((sectionResult.caseSummary?.mode || 'write') === 'scaffold') {
      navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}/sections/${sectionId}`, { replace: true });
      return;
    }
    setSection(sectionResult);
    setCaseData(sectionResult.caseSummary || null);
    setDraftsBySection(sectionResult.draftsBySection || {});
    setCanUndo(Boolean(sectionResult.canUndo));
  };

  const applyCaseStatePatch = (payload: {
    draftsBySection?: Record<string, string>;
    sectionStates?: Array<{
      sectionId: string;
      status: string;
      rationaleText: string;
      missingInfoBullets: string[];
      recommendedQuestions: string[];
    }>;
    commonQuestionSets?: Array<{ question: string; category?: string }>;
    commonMissingItems?: string[];
    staleState?: any;
    finalComposeStatus?: any;
    finalDraft?: any;
    qnaHistory?: Array<{ question: string; answer: string; timestamp: string }>;
    commonQnaHistory?: Array<{ question: string; answer: string; timestamp: string }>;
  }) => {
    const nextDraftMap = mergeDraftMaps(draftsBySection, payload.draftsBySection || {});
    const nextSectionState = (payload.sectionStates || caseData?.sectionStates || []).find(
      (item) => item.sectionId === sectionId
    );
    setDraftsBySection(nextDraftMap);
    setCaseData((prev) =>
      prev
        ? {
            ...prev,
            draftsBySection: mergeDraftMaps(prev.draftsBySection || {}, payload.draftsBySection || {}),
            sectionStates: payload.sectionStates || prev.sectionStates,
            commonQuestionSets: payload.commonQuestionSets || prev.commonQuestionSets,
            commonMissingItems: payload.commonMissingItems || prev.commonMissingItems,
            staleState: payload.staleState || prev.staleState,
            finalComposeStatus: payload.finalComposeStatus || prev.finalComposeStatus,
            finalDraft: payload.finalDraft ?? prev.finalDraft
          }
        : prev
    );
    setSection((prev) =>
      prev
        ? {
            ...prev,
            draftsBySection: nextDraftMap,
            currentDraft: nextDraftMap[sectionId || ''] || prev.currentDraft,
            qnaHistory: payload.qnaHistory || prev.qnaHistory,
            commonQnaHistory: payload.commonQnaHistory || prev.commonQnaHistory,
            missingInfoBullets: nextSectionState?.missingInfoBullets || prev.missingInfoBullets,
            sectionMissingInfo: nextSectionState?.missingInfoBullets || prev.sectionMissingInfo,
            recommendedQuestions:
              nextSectionState?.recommendedQuestions || prev.recommendedQuestions,
            sectionQuestions: nextSectionState?.recommendedQuestions || prev.sectionQuestions,
            status: nextSectionState?.status || prev.status,
            rationaleText: nextSectionState?.rationaleText || prev.rationaleText,
            commonQuestions: payload.commonQuestionSets || prev.commonQuestions,
            commonMissingInfo: payload.commonMissingItems || prev.commonMissingInfo
          }
        : prev
    );
  };

  const handleReviewSection = async () => {
    if (!caseId || !sectionId || !isQuestionStageSection) return;

    setIsReviewing(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    const researchSession = caseData?.researchState;
    if (researchSession?.sessionId) {
      void logResearchEvent(caseId, {
        eventType: 'review_ai_requested',
        sectionId: String(sectionId),
        sessionId: researchSession.sessionId,
        participantCode: researchSession.participantCode
      });
    }

    try {
      const sectionResult = await caseApi.reviewSection(caseId, sectionId);
      setSection(sectionResult);
      setCaseData(sectionResult.caseSummary || null);
      setDraftsBySection(sectionResult.draftsBySection || {});
      setCanUndo(Boolean(sectionResult.canUndo));
      setFeedbackMessage('현재 섹션의 전체 검토를 다시 실행했습니다.');

      if (researchSession?.sessionId) {
        void logResearchEvent(caseId, {
          eventType: 'review_ai_result_viewed',
          sectionId: String(sectionId),
          sessionId: researchSession.sessionId,
          participantCode: researchSession.participantCode,
          metadata: {
            hasAdequacyReview: Boolean(sectionResult.adequacyReview),
            unsupportedClaimCount: sectionResult.adequacyReview?.unsupportedClaims?.length || 0
          }
        });
      }
    } catch (error: any) {
      setErrorMessage(error?.message || '섹션 전체 검토를 다시 실행하지 못했습니다.');
    } finally {
      setIsReviewing(false);
    }
  };

  useEffect(() => {
    if (!caseId || !sectionId) return;

    const run = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        if (isQuestionStageSection) {
          await loadData();
        }
      } catch (error: any) {
        setErrorMessage(error?.message || '섹션 정보를 불러오지 못했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    void run();
  }, [caseId, sectionId, isQuestionStageSection]);

  useEffect(() => {
    if (
      !caseId ||
      !sectionId ||
      !isQuestionStageSection ||
      !caseData?.chainProgress?.currentStep ||
      caseData.chainProgress.currentStep === 'BLOCKED'
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;

      try {
        await loadData();
      } catch (error: any) {
        if (!cancelled) {
          setErrorMessage(error?.message || '섹션 상태를 갱신하는 중 오류가 발생했습니다.');
        }
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    caseId,
    sectionId,
    isQuestionStageSection,
    caseData?.chainProgress?.currentStep,
    caseData?.chainProgress?.updatedAt
  ]);

  useEffect(() => {
    if (!caseId || !sectionId || !caseData?.researchState?.sessionId) return;
    const key = `${caseId}:${sectionId}`;
    if (loggedOpenRef.current === key) return;
    loggedOpenRef.current = key;
    void logResearchEvent(caseId, {
      eventId: createResearchEventId(`section-opened-${sectionId}`),
      eventType: 'section_opened',
      sectionId: String(sectionId),
      sessionId: caseData.researchState.sessionId,
      participantCode: caseData.researchState.participantCode,
      metadata: { route: 'write_section' }
    });
  }, [caseData?.researchState?.participantCode, caseData?.researchState?.sessionId, caseId, sectionId]);

  const isInlineLoading = (isLoading && Boolean(section)) || isReviewing;

  const frontMatterPreview = useMemo(
    () => buildFrontMatterPreview(draftsBySection, caseData?.evidenceCards || []),
    [draftsBySection, caseData?.evidenceCards]
  );

  useEffect(() => {
    const nextTitle = draftsBySection.TITLE || frontMatterPreview?.title || '';
    const nextKeywords =
      draftsBySection.KEYWORDS ||
      (frontMatterPreview?.keywords?.length ? frontMatterPreview.keywords.join(', ') : '');
    const nextDiscussion =
      draftsBySection.DISCUSSION_CONCLUSION || frontMatterPreview?.discussion || '';

    setEditableTitle(nextTitle);
    setEditableKeywords(nextKeywords);
    setEditableDiscussion(nextDiscussion);
  }, [
    draftsBySection.TITLE,
    draftsBySection.KEYWORDS,
    draftsBySection.DISCUSSION_CONCLUSION,
    frontMatterPreview?.title,
    frontMatterPreview?.keywords,
    frontMatterPreview?.discussion
  ]);

  useEffect(() => {
    if (!isSavingFrontMatter) {
      setIsEditingTitle(false);
      setIsEditingKeywords(false);
      setIsEditingDiscussion(false);
    }
  }, [isSavingFrontMatter]);

  useEffect(() => {
    if (!currentPreviewSectionRef.current) return;

    currentPreviewSectionRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }, [sectionId]);

  const commonQnaHistory = section?.commonQnaHistory || [];
  const sectionQnaHistory = section?.qnaHistory || [];

  const commonQuestionItems = useMemo(
    () => makeQuestionItems(section?.commonQuestions, 'common', commonQnaHistory),
    [section?.commonQuestions, commonQnaHistory]
  );

  const sectionQuestionItems = useMemo(
    () =>
      makeQuestionItems(
        section?.sectionQuestions || section?.recommendedQuestions || [],
        'section',
        sectionQnaHistory
      ),
    [section?.sectionQuestions, section?.recommendedQuestions, sectionQnaHistory]
  );

  const pendingTermCount = useMemo(
    () =>
      (caseData?.pendingTermConfirmations || []).filter((item) => item.status === 'PENDING').length,
    [caseData?.pendingTermConfirmations]
  );

  const transientProgress = useMemo(() => {
    if (isSubmitting) {
      return {
        currentStep: 'CHAIN6',
        completedSteps: [],
        estimatedRemainingSteps: ['CHAIN4', 'CHAIN5'],
        updatedAt: new Date().toISOString()
      };
    }

    if (isReviewing) {
      return {
        currentStep: `REVIEW:${sectionId || ''}`,
        completedSteps: [],
        estimatedRemainingSteps: [],
        updatedAt: new Date().toISOString()
      };
    }

    return null;
  }, [isReviewing, isSubmitting, sectionId]);

  useEffect(() => {
    setSelectedCommonQuestion((previous) => {
      if (!commonQuestionItems.length) return null;
      if (previous && commonQuestionItems.some((item) => item.text === previous.text)) {
        return previous;
      }
      return commonQuestionItems[0];
    });
  }, [commonQuestionItems]);

  useEffect(() => {
    setActiveSectionQuestion((previous) => {
      const availableQuestions = sectionQuestionItems.map((item) => item.text);
      if (!availableQuestions.length) {
        return null;
      }

      if (previous && availableQuestions.includes(previous)) {
        return previous;
      }

      return availableQuestions[0];
    });
  }, [sectionQuestionItems]);

  const sectionTitle = getSectionTitle(sectionId);
  const sectionSubtitle =
    section?.uiHints?.subtitle || '현재 초안을 확인하고 AI 질문을 통해 이 섹션을 보완해 주세요.';

  const handleSelectCommonQuestion = (question: QuestionItem) => {
    setSelectedCommonQuestion(question);
    setCommonAnswerText('');
    setFeedbackMessage(null);
    setErrorMessage(null);
    if (caseId && caseData?.researchState?.sessionId) {
      void logResearchEvent(caseId, {
        eventType: 'question_viewed',
        sectionId: String(sectionId || ''),
        sessionId: caseData.researchState.sessionId,
        participantCode: caseData.researchState.participantCode,
        metadata: { questionId: question.id, kind: question.kind, category: question.category }
      });
    }
  };

  const handleSelectSectionQuestion = (question: QuestionItem) => {
    setActiveSectionQuestion(question.text);
    setSectionAnswerText('');
    setFeedbackMessage(null);
    setErrorMessage(null);
    if (caseId && caseData?.researchState?.sessionId) {
      void logResearchEvent(caseId, {
        eventType: 'question_viewed',
        sectionId: String(sectionId || ''),
        sessionId: caseData.researchState.sessionId,
        participantCode: caseData.researchState.participantCode,
        metadata: { questionId: question.id, kind: question.kind, category: question.category }
      });
    }
  };

  const handleSubmitCommonAnswer = async () => {
    if (!caseId || !selectedCommonQuestion?.text || !commonAnswerText.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const result: CommonAnswerSubmitResponse = await caseApi.submitCommonAnswer(
        caseId,
        selectedCommonQuestion.text,
        commonAnswerText
      );

      const nextDrafts = mergeDraftMaps(draftsBySection, result.updatedDraftsBySection);
      const nextSectionState = result.sectionStates.find((state) => state.sectionId === sectionId);

      setDraftsBySection(nextDrafts);
      setSection((prev) =>
        prev
          ? {
              ...prev,
              currentDraft: nextDrafts[sectionId || ''] || prev.currentDraft,
              draftsBySection: nextDrafts,
              commonQnaHistory: result.qnaHistory,
              commonQuestions: result.commonQuestions,
              commonMissingInfo: result.commonMissingInfo,
              missingInfoBullets: nextSectionState?.missingInfoBullets || prev.missingInfoBullets,
              sectionMissingInfo: nextSectionState?.missingInfoBullets || prev.sectionMissingInfo,
              recommendedQuestions:
                nextSectionState?.recommendedQuestions || prev.recommendedQuestions,
              sectionQuestions: nextSectionState?.recommendedQuestions || prev.sectionQuestions,
              status: nextSectionState?.status || prev.status,
              rationaleText: nextSectionState?.rationaleText || prev.rationaleText
            }
          : prev
      );
      setCaseData((prev) =>
        prev
          ? {
              ...prev,
              draftsBySection: nextDrafts,
              staleState: result.staleState || prev.staleState,
              finalDraft: null,
              finalComposeStatus: { status: 'IDLE' }
            }
          : prev
      );
      setCanUndo(true);
      setFeedbackMessage('공통 답변이 반영되어 초안과 질문 목록이 갱신되었습니다.');
      setSelectedCommonQuestion(null);
      setCommonAnswerText('');
      if (caseData?.researchState?.sessionId) {
        void logResearchEvent(caseId, {
          eventType: 'question_answered',
          sectionId: String(sectionId || ''),
          sessionId: caseData.researchState.sessionId,
          participantCode: caseData.researchState.participantCode,
          metadata: {
            kind: 'common',
            question: selectedCommonQuestion?.text,
            answerLength: commonAnswerText.trim().length
          }
        });
      }
    } catch (error: any) {
      setErrorMessage(error?.message || '공통 질문 답변을 제출하지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitSectionAnswer = async () => {
    if (!caseId || !sectionId || !activeSectionQuestion || !sectionAnswerText.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const result: SectionSubmitResult = await caseApi.submitAnswer(
        caseId,
        sectionId,
        sectionAnswerText,
        activeSectionQuestion
      );

      setDraftsBySection((prev) => mergeDraftMaps(prev, result.updatedDraftsBySection));
      setActiveSectionQuestion(
        result.nextQuestion
          ? normalizeQuestionTextForDisplay(result.nextQuestion)
          : result.sectionQuestions[0]
            ? normalizeQuestionTextForDisplay(result.sectionQuestions[0])
            : null
      );
      setSection((prev) =>
        prev
          ? {
              ...prev,
              currentDraft: result.updatedDraft,
              qnaHistory: result.qnaHistory,
              recommendedQuestions: result.sectionQuestions,
              sectionQuestions: result.sectionQuestions,
              commonQuestions: result.commonQuestions,
              commonQnaHistory: result.commonQnaHistory,
              missingInfoBullets: result.sectionMissingInfo,
              sectionMissingInfo: result.sectionMissingInfo,
              commonMissingInfo: result.commonMissingInfo,
              draftsBySection: mergeDraftMaps(prev.draftsBySection, result.updatedDraftsBySection),
              uiHints: result.uiHints || prev.uiHints
            }
          : prev
      );

      setCanUndo(true);
      setFeedbackMessage('섹션 답변이 반영되어 초안과 질문 목록이 갱신되었습니다.');
      setSectionAnswerText('');
      if (caseData?.researchState?.sessionId) {
        void logResearchEvent(caseId, {
          eventType: 'question_answered',
          sectionId: String(sectionId || ''),
          sessionId: caseData.researchState.sessionId,
          participantCode: caseData.researchState.participantCode,
          metadata: {
            kind: 'section',
            question: activeSectionQuestion,
            answerLength: sectionAnswerText.trim().length
          }
        });
      }
    } catch (error: any) {
      setErrorMessage(error?.message || '섹션 질문 답변을 제출하지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveFrontMatter = async () => {
    if (!caseId) return;

    setIsSavingFrontMatter(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const keywords = editableKeywords
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const result = await caseApi.updateFrontMatter(caseId, {
        title: editableTitle.trim(),
        keywords,
        discussion: editableDiscussion.trim()
      });

      setDraftsBySection((prev) =>
        mergeDraftMaps(prev, {
          ...(result.draftsBySection || {}),
          TITLE: result.title,
          KEYWORDS: result.keywords.join(', '),
          DISCUSSION_CONCLUSION: editableDiscussion.trim()
        })
      );
      applyCaseStatePatch({
        draftsBySection: {
          ...(result.draftsBySection || {}),
          TITLE: result.title,
          KEYWORDS: result.keywords.join(', '),
          DISCUSSION_CONCLUSION: editableDiscussion.trim()
        },
        sectionStates: result.sectionStates,
        commonQuestionSets: result.commonQuestionSets,
        commonMissingItems: result.commonMissingItems,
        staleState: result.staleState,
        finalComposeStatus: result.finalComposeStatus,
        finalDraft: result.finalDraft
      });
      setFeedbackMessage('제목, 키워드, 논의 및 결론을 저장했습니다. 이후 질문 생성에도 반영됩니다.');
    } catch (error: any) {
      setErrorMessage(error?.message || '전면부 정보를 저장하지 못했습니다.');
    } finally {
      setIsSavingFrontMatter(false);
    }
  };

  const handleUndoLastAnswer = async () => {
    if (!caseId || !canUndo) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const result = await caseApi.undoLastAnswer(caseId);
      const restoredSectionInteraction = (result.restoredInteractions || []).find(
        (item) => item.sectionId === sectionId
      );
      const restoredCommonInteraction = (result.restoredInteractions || []).find(
        (item) => item.sectionId === '__COMMON__'
      );
      applyCaseStatePatch({
        draftsBySection: result.draftsBySection,
        sectionStates: result.sectionStates,
        commonQuestionSets: result.commonQuestionSets,
        commonMissingItems: result.commonMissingItems,
        staleState: result.staleState,
        finalComposeStatus: result.finalComposeStatus,
        finalDraft: result.finalDraft,
        qnaHistory: restoredSectionInteraction?.qnaHistory?.map((item) => ({
          question: item.question,
          answer: item.answer,
          timestamp: item.timestamp || new Date().toISOString()
        })),
        commonQnaHistory: restoredCommonInteraction?.qnaHistory?.map((item) => ({
          question: item.question,
          answer: item.answer,
          timestamp: item.timestamp || new Date().toISOString()
        }))
      });
      setCanUndo(result.remainingUndoCount > 0);
      setFeedbackMessage('가장 최근 답변 반영을 되돌렸습니다.');
    } catch (error: any) {
      setErrorMessage(error?.message || '최근 답변을 되돌리지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelTitleEdit = () => {
    setEditableTitle(draftsBySection.TITLE || frontMatterPreview?.title || '');
    setIsEditingTitle(false);
  };

  const handleCancelKeywordEdit = () => {
    setEditableKeywords(
      draftsBySection.KEYWORDS ||
        (frontMatterPreview?.keywords?.length ? frontMatterPreview.keywords.join(', ') : '')
    );
    setIsEditingKeywords(false);
  };

  const handleCancelDiscussionEdit = () => {
    setEditableDiscussion(
      draftsBySection.DISCUSSION_CONCLUSION || frontMatterPreview?.discussion || ''
    );
    setIsEditingDiscussion(false);
  };

  if (isLoading && !section) {
    return (
      <div className="section-detail-page">
        <div className="header-bar">
          <button type="button" className="btn-back" onClick={() => navigate(`${writeBasePath}/cases/${caseId}`)}>
            돌아가기
          </button>
          <h1>섹션 정보를 불러오는 중...</h1>
        </div>
      </div>
    );
  }

  if (!caseId || !sectionId || !section) {
    if (caseId && sectionId && !isQuestionStageSection) {
      return (
        <div className="section-detail-page">
          <div className="header-bar">
            <button type="button" className="btn-back" onClick={() => navigate(`${writeBasePath}/cases/${caseId}`)}>
              돌아가기
            </button>
            <h1>{getSectionTitle(sectionId)}</h1>
          </div>
          <div className="document-preview">
            <div className="document-paper">
              <div className="section-rationale-box">
                <h3>최종 생성 섹션</h3>
                <p>
                  이 섹션은 최종 원고 생성 단계에서 자동으로 작성됩니다. 먼저 본문 섹션을
                  충분히 보완한 뒤 최종 원고 화면에서 확인해 주세요.
                </p>
              </div>
              <div className="error-message" style={{ margin: 0 }}>
                <Link to={`${writeBasePath}/cases/${caseId}`}>케이스 개요로 돌아가기</Link>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="section-detail-page">
        <div className="error-message">섹션을 불러오지 못했습니다.</div>
      </div>
    );
  }

  return (
    <div className="section-detail-page">
      <div className="header-bar">
        <button type="button" className="btn-back" onClick={() => navigate(`${writeBasePath}/cases/${caseId}`)}>
          케이스 개요
        </button>
        <div className="chat-header-title">
          <h1>{sectionTitle}</h1>
          <span className="chat-subtitle">{sectionSubtitle}</span>
          {caseData?.experiment_code || caseData?.experimentCode ? (
            <span className="chat-subtitle">실험번호: {caseData.experiment_code || caseData.experimentCode}</span>
          ) : null}
        </div>
        <div className="header-actions">
          {isQuestionStageSection ? (
            <button
              type="button"
              className="btn-undo-answer"
              onClick={handleUndoLastAnswer}
              disabled={isSubmitting || !canUndo}
            >
              마지막 답변 되돌리기
            </button>
          ) : null}
          {isQuestionStageSection ? (
            <button
              type="button"
              className="btn-review-section"
              onClick={handleReviewSection}
              disabled={isSubmitting || isReviewing}
            >
              {isReviewing ? '검토 중...' : '전체 확인'}
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? <div className="error-message">{errorMessage}</div> : null}
      {feedbackMessage ? <div className="question-update-notice">{feedbackMessage}</div> : null}
      <ChainProgressBanner
        progress={transientProgress || caseData?.chainProgress}
        title={
          isReviewing
            ? '현재 섹션 검토 진행 상태'
            : isSubmitting
              ? '답변 반영 진행 상태'
              : '현재 처리 진행 상태'
        }
      />
      {caseData?.staleState?.isStale ? (
        <div className="status-banner status-banner-warning">
          <div className="status-banner-body">
            <strong>기존 결과가 최신 상태가 아닙니다.</strong>
            <span>{getStaleReasonLabel(caseData.staleState.staleReason)}</span>
          </div>
          <div className="status-banner-actions">
            {pendingTermCount > 0 ? (
              <button
                type="button"
                className="btn-banner-action secondary"
                onClick={() => setIsPendingTermModalOpen(true)}
              >
                전문용어 확인 {pendingTermCount}건
              </button>
            ) : null}
            <button
              type="button"
              className="btn-banner-action"
              onClick={() => navigate(`${writeBasePath}/cases/${caseId}/manuscript`)}
            >
              최종 원고 재생성
            </button>
          </div>
        </div>
      ) : null}

      {caseData?.reviewRequired ? (
        <div
          className={[
            'status-banner',
            caseData.reviewRequired.riskLevel === 'HIGH'
              ? 'status-banner-danger'
              : 'status-banner-info'
          ].join(' ')}
        >
          <div className="status-banner-body">
            <strong>{getReviewRequiredTitle(caseData.reviewRequired)}</strong>
            <span>{getReviewRequiredDescription(caseData.reviewRequired)}</span>
          </div>
          <div className="status-banner-actions">
            <button
              type="button"
              className="btn-banner-action secondary"
              onClick={() => {
                if (pendingTermCount > 0) {
                  setIsPendingTermModalOpen(true);
                  return;
                }
                navigate(`/cases/${caseId}`);
              }}
            >
              {pendingTermCount > 0 ? `전문용어 확인 ${pendingTermCount}건` : '케이스 개요에서 검토'}
            </button>
          </div>
        </div>
      ) : null}

      {pendingTermCount > 0 ? (
        <div className="status-banner status-banner-neutral">
          <div className="status-banner-body">
            <strong>확인되지 않은 전문용어가 {pendingTermCount}건 있습니다.</strong>
            <span>승인 전에는 표준 용어가 draft와 최종 원고에 반영되지 않습니다.</span>
          </div>
          <div className="status-banner-actions">
            <button
              type="button"
              className="btn-banner-action secondary"
              onClick={() => setIsPendingTermModalOpen(true)}
            >
              전문용어 확인 {pendingTermCount}건
            </button>
          </div>
        </div>
      ) : null}

      <div className={`three-panel-layout ${isInlineLoading ? 'is-inline-loading' : ''}`}>
        <aside
          className={[
            'chat-panel',
            'common-chat-panel',
            showCommonHistory ? 'has-history' : 'no-history'
          ].join(' ')}
        >
          <div className="chat-header">
            <div className="chat-header-title">
              <h2>공통 질문</h2>
              <span className="chat-subtitle">
                하나의 답변이 여러 CARE 섹션에 함께 반영될 수 있습니다.
              </span>
            </div>
          </div>

          <div className="question-priority-panel">
            {commonQuestionItems.length === 0 ? (
              <div className="question-empty-state">현재 답변할 공통 질문이 없습니다.</div>
            ) : (
              <div className="question-chip-list">
                {commonQuestionItems.map((question) => {
                  const isActive = selectedCommonQuestion?.text === question.text;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      className={[
                        'question-chip',
                        isActive ? 'active' : '',
                        question.answered ? 'answered' : ''
                      ].join(' ')}
                      onClick={() => handleSelectCommonQuestion(question)}
                    >
                      <span className="question-chip-body">
                        {question.category && getCommonQuestionCategoryLabel(question.category) ? (
                          <span className="question-category-badge">
                            {getCommonQuestionCategoryLabel(question.category)}
                          </span>
                        ) : null}
                        <span>{renderClinicalAnonymizedText(question.text)}</span>
                      </span>
                      {question.answered ? (
                        <span className="question-chip-status">답변 완료</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="question-hint-box question-selection-box">
              <strong>선택한 공통 질문</strong>
              {selectedCommonQuestion?.category &&
              getCommonQuestionCategoryLabel(selectedCommonQuestion.category) ? (
                <div className="question-selection-meta">
                  <span className="question-category-badge">
                    {getCommonQuestionCategoryLabel(selectedCommonQuestion.category)}
                  </span>
                </div>
              ) : null}
              <div>{selectedCommonQuestion?.text || '위에서 공통 질문 하나를 선택해 주세요.'}</div>
            </div>
          </div>

          {showCommonHistory ? (
            <div className="chat-messages">
              <HistoryList items={commonQnaHistory} emptyText="아직 공통 답변 이력이 없습니다." />
            </div>
          ) : null}

          <div className="chat-input-area">
            <div className="input-box">
              <textarea
                value={commonAnswerText}
                onChange={(e) => setCommonAnswerText(e.target.value)}
                className="answer-input"
                placeholder="선택한 공통 질문에 대한 답변을 입력해 주세요."
                rows={4}
              />

              <div className="input-action-row">
                <button
                  type="button"
                  className="btn-toggle-history"
                  onClick={() => setShowCommonHistory((prev) => !prev)}
                >
                  {showCommonHistory ? '공통 답변 이력 숨기기' : '공통 답변 이력 보기'}
                </button>

                <button
                  type="button"
                  className="btn-submit-answer"
                  onClick={handleSubmitCommonAnswer}
                  disabled={isSubmitting || !selectedCommonQuestion || !commonAnswerText.trim()}
                >
                  {isSubmitting ? '제출 중...' : '공통 답변 제출'}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="document-preview">
          <div className="document-paper">
            <section className="section-current-draft-box">
              <h3>전체 초안 미리보기</h3>
              {MANUSCRIPT_SECTION_ORDER.map((sid) => {
                const previewRawText = getPreviewText({
                  sectionId: sid,
                  draftsBySection,
                  frontMatterPreview
                });
                const previewText = shouldFormatSection(sid)
                  ? formatSectionDraftForDisplay(sid, previewRawText)
                  : previewRawText;
                const isCurrent = sid === sectionId;
                const canOpen = QUESTION_STAGE_SECTIONS.includes(
                  sid as (typeof QUESTION_STAGE_SECTIONS)[number]
                );

                return (
                  <div
                    key={sid}
                    ref={isCurrent ? currentPreviewSectionRef : null}
                    className={[
                      'document-section',
                      !isCurrent && canOpen ? 'clickable-section' : '',
                      isCurrent ? 'current-section' : ''
                    ].join(' ')}
                    onClick={
                      !isCurrent && canOpen
                        ? () => navigate(`/cases/${caseId}/sections/${sid}`)
                        : undefined
                    }
                  >
                    <div className="chat-header" style={{ padding: 0, borderBottom: 'none' }}>
                      <div className="chat-header-title">
                        <h2 style={{ fontSize: '1rem' }}>{getSectionTitle(sid)}</h2>
                      </div>
                      {sid === 'TITLE' ? (
                        <button
                          type="button"
                          className="frontmatter-edit-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingTitle(true);
                          }}
                          aria-label="제목 수정"
                        >
                          수정
                        </button>
                      ) : null}
                      {sid === 'KEYWORDS' ? (
                        <button
                          type="button"
                          className="frontmatter-edit-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingKeywords(true);
                          }}
                          aria-label="키워드 수정"
                        >
                          수정
                        </button>
                      ) : null}
                      {sid === 'DISCUSSION_CONCLUSION' ? (
                        <button
                          type="button"
                          className="frontmatter-edit-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEditingDiscussion(true);
                          }}
                          aria-label="논의 및 결론 수정"
                        >
                          수정
                        </button>
                      ) : null}
                    </div>
                    <div className="section-content-text">
                      {sid === 'TIMELINE' ? (
                        <TimelineDraftView
                          rawText={previewRawText}
                          events={caseData?.timelineEvents || section.timelineEvents || []}
                        />
                      ) : sid === 'TITLE' ? (
                        isEditingTitle ? (
                          <div className="frontmatter-editor" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              className="frontmatter-input"
                              value={editableTitle}
                              onChange={(e) => setEditableTitle(e.target.value)}
                              placeholder="제목을 직접 입력하거나 수정해 주세요."
                            />
                            <div className="frontmatter-actions">
                              <button
                                type="button"
                                className="btn-toggle-history"
                                onClick={handleCancelTitleEdit}
                                disabled={isSavingFrontMatter}
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                className="btn-review-section"
                                onClick={handleSaveFrontMatter}
                                disabled={isSavingFrontMatter}
                              >
                                {isSavingFrontMatter ? '저장 중...' : '저장'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          previewText || getGeneratedSectionPlaceholder(sid)
                        )
                      ) : sid === 'KEYWORDS' ? (
                        isEditingKeywords ? (
                          <div className="frontmatter-editor" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              className="frontmatter-input"
                              value={editableKeywords}
                              onChange={(e) => setEditableKeywords(e.target.value)}
                              placeholder="키워드를 쉼표로 구분해서 입력해 주세요."
                            />
                            <div className="frontmatter-actions">
                              <button
                                type="button"
                                className="btn-toggle-history"
                                onClick={handleCancelKeywordEdit}
                                disabled={isSavingFrontMatter}
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                className="btn-review-section"
                                onClick={handleSaveFrontMatter}
                                disabled={isSavingFrontMatter}
                              >
                                {isSavingFrontMatter ? '저장 중...' : '저장'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          previewText || getGeneratedSectionPlaceholder(sid)
                        )
                      ) : sid === 'DISCUSSION_CONCLUSION' ? (
                        isEditingDiscussion ? (
                          <div className="frontmatter-editor" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              className="frontmatter-input"
                              value={editableDiscussion}
                              onChange={(e) => setEditableDiscussion(e.target.value)}
                              placeholder="논의 및 결론 내용을 직접 수정해 주세요."
                              rows={7}
                            />
                            <div className="frontmatter-actions">
                              <button
                                type="button"
                                className="btn-toggle-history"
                                onClick={handleCancelDiscussionEdit}
                                disabled={isSavingFrontMatter}
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                className="btn-review-section"
                                onClick={handleSaveFrontMatter}
                                disabled={isSavingFrontMatter}
                              >
                                {isSavingFrontMatter ? '저장 중...' : '저장'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          previewText || getGeneratedSectionPlaceholder(sid)
                        )
                      ) : (
                        previewText || getGeneratedSectionPlaceholder(sid)
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        </main>

        <aside
          className={[
            'chat-panel',
            'section-chat-panel',
            showSectionHistory ? 'has-history' : 'no-history'
          ].join(' ')}
        >
          <div className="chat-header">
            <div className="chat-header-title">
              <h2>섹션 질문</h2>
              <span className="chat-subtitle">이 질문은 현재 섹션만 보완합니다.</span>
            </div>
          </div>

          <div className="section-insights">
            {caseData?.staleState?.isStale ? (
              <div className="section-review-reset-note">
                전문용어 또는 evidence가 변경되어 Review AI 캐시가 초기화되었습니다. 오른쪽 위
                <strong> 전체 확인</strong> 버튼으로 현재 섹션을 다시 검토해 주세요.
              </div>
            ) : null}

            <div className="section-rationale-box">
              <h3>섹션 설명</h3>
              <p>{section.rationaleText}</p>
            </div>

            <div className="section-missing-info">
              <h4>부족한 정보</h4>
              {section.sectionMissingInfo && section.sectionMissingInfo.length > 0 ? (
                <ul>
                  {section.sectionMissingInfo.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="section-content-text">
                  현재 이 섹션에 남아 있는 추가 부족 정보가 없습니다.
                </p>
              )}
            </div>

            {section.adequacyReview ? (
              <div className="section-review-metrics">
                <h4>Review AI 평가</h4>
                <div className="section-review-metric">
                  <div className="section-review-metric-head">
                    <strong>섹션 완성도</strong>
                    <span>{getReviewScoreLabel(section.adequacyReview.sectionCompleteness)}</span>
                  </div>
                  <p>{renderClinicalAnonymizedText(section.adequacyReview.summary)}</p>
                </div>
                <div className="section-review-metric">
                  <div className="section-review-metric-head">
                    <strong>내용 완성도</strong>
                    <span>{getReviewScoreLabel(section.adequacyReview.contentCompleteness)}</span>
                  </div>
                  <p>{renderClinicalAnonymizedText(section.adequacyReview.summary)}</p>
                </div>
                <div className="section-review-metric">
                  <div className="section-review-metric-head">
                    <strong>자연스러움</strong>
                    <span>{getReviewScoreLabel(section.adequacyReview.naturalness)}</span>
                  </div>
                  <p>{renderClinicalAnonymizedText(section.adequacyReview.summary)}</p>
                </div>
                <div className="section-review-metric">
                  <div className="section-review-metric-head">
                    <strong>근거 기반 작성 여부</strong>
                    <span>{getEvidenceGroundingLabel(section.adequacyReview.evidenceGrounding)}</span>
                  </div>
                  <p>{renderClinicalAnonymizedText(section.adequacyReview.summary)}</p>
                  {section.adequacyReview.unsupportedClaims?.length ? (
                    <ul className="section-review-unsupported-list">
                      {section.adequacyReview.unsupportedClaims.map((claim, index) => (
                        <li key={`${claim.sentence}-${index}`}>
                          <strong>{renderClinicalAnonymizedText(claim.sentence)}</strong>
                          <span>{renderClinicalAnonymizedText(claim.reason)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="question-priority-panel">
            <div>
              <strong>현재 섹션 질문</strong>
            </div>

            <div className="question-hint-box">
              <div>
                {activeSectionQuestion ||
                  '현재 이 섹션에서 이어서 물을 질문이 없습니다. 필요하면 왼쪽 공통 질문부터 답변해 주세요.'}
              </div>
            </div>

            {sectionQuestionItems.length > 1 ? (
              <div className="question-chip-list">
                {sectionQuestionItems.map((question) => {
                  const isActive = activeSectionQuestion === question.text;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      className={[
                        'question-chip',
                        isActive ? 'active' : '',
                        question.answered ? 'answered' : ''
                      ].join(' ')}
                      onClick={() => handleSelectSectionQuestion(question)}
                    >
                      <span>{renderClinicalAnonymizedText(question.text)}</span>
                      {question.answered ? (
                        <span className="question-chip-status">답변 완료</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {showSectionHistory ? (
            <div className="chat-messages">
              <HistoryList items={sectionQnaHistory} emptyText="아직 이 섹션의 답변 이력이 없습니다." />
            </div>
          ) : null}

          <div className="chat-input-area">
            <div className="input-box">
              <div className="question-empty-state">
                이 질문에 답변하면 충분한 정보가 반영된 뒤 다음 섹션 질문으로 자동 진행됩니다.
              </div>

              <textarea
                value={sectionAnswerText}
                onChange={(e) => setSectionAnswerText(e.target.value)}
                className="answer-input"
                placeholder="현재 섹션 질문에 대한 답변을 입력해 주세요."
                rows={5}
              />

              <div className="input-action-row">
                <button
                  type="button"
                  className="btn-toggle-history"
                  onClick={() => setShowSectionHistory((prev) => !prev)}
                >
                  {showSectionHistory ? '섹션 답변 이력 숨기기' : '섹션 답변 이력 보기'}
                </button>

                <button
                  type="button"
                  className="btn-submit-answer"
                  onClick={handleSubmitSectionAnswer}
                  disabled={isSubmitting || !activeSectionQuestion || !sectionAnswerText.trim()}
                >
                  {isSubmitting ? '제출 중...' : '섹션 답변 제출'}
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {caseId ? (
        <PendingTermConfirmationModal
          caseId={caseId}
          isOpen={isPendingTermModalOpen}
          onClose={() => setIsPendingTermModalOpen(false)}
          onResolved={async (result) => {
            const pendingResult = result as any;
            const nextDrafts = result.draftsBySection || draftsBySection;
            const nextState = (pendingResult.sectionStates || []).find(
              (state: any) => state.sectionId === sectionId
            );

            setCaseData((prev) =>
              prev
                ? {
                    ...prev,
                    draftsBySection: nextDrafts,
                    pendingTermConfirmations: result.pendingTermConfirmations || [],
                    reviewRequired: result.reviewRequired || null,
                    chainProgress: result.chainProgress || prev.chainProgress || null,
                    staleState: result.staleState || prev.staleState,
                    finalComposeStatus: result.finalComposeStatus || prev.finalComposeStatus,
                    finalDraft: result.finalDraft || null,
                    sectionStates: pendingResult.sectionStates || prev.sectionStates
                  }
                : prev
            );
            setDraftsBySection(nextDrafts);
            setSection((prev) =>
              prev
                ? {
                    ...prev,
                    currentDraft: nextDrafts[sectionId || ''] || prev.currentDraft,
                    draftsBySection: nextDrafts,
                    commonQuestions: pendingResult.commonQuestionSets || prev.commonQuestions,
                    commonMissingInfo: pendingResult.commonMissingItems || prev.commonMissingInfo,
                    missingInfoBullets: nextState?.missingInfoBullets || prev.missingInfoBullets,
                    sectionMissingInfo: nextState?.missingInfoBullets || prev.sectionMissingInfo,
                    recommendedQuestions:
                      nextState?.recommendedQuestions || prev.recommendedQuestions,
                    sectionQuestions: nextState?.recommendedQuestions || prev.sectionQuestions,
                    status: nextState?.status || prev.status,
                    rationaleText: nextState?.rationaleText || prev.rationaleText
                  }
                : prev
            );
            setCanUndo(true);
            setActiveSectionQuestion((prevQuestion) => {
              const nextQuestions = nextState?.recommendedQuestions || [];
              if (!nextQuestions.length) return null;
              if (prevQuestion && nextQuestions.includes(prevQuestion)) return prevQuestion;
              return nextQuestions[0];
            });
            setFeedbackMessage(
              result.httpStatus === 202
                ? '전문용어 선택을 저장했고, 현재 섹션에 반영 중입니다.'
                : '전문용어 확인 결과를 반영해 현재 섹션을 갱신했습니다.'
            );
            setErrorMessage(null);
          }}
          pendingTerms={caseData?.pendingTermConfirmations || []}
        />
      ) : null}
    </div>
  );
}
