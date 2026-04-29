import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { caseApi, SectionDetail } from '../services/api';
import { formatSectionDraftForDisplay } from '../utils/sectionDraftFormatter';
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
  answered?: boolean;
};

type SectionSubmitResult = {
  updatedDraft: string;
  updatedDraftsBySection: Record<string, string>;
  nextQuestion?: string;
  sectionQuestions: string[];
  commonQuestions: string[];
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
  DISCUSSION_CONCLUSION: '논의 및 결론',
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
    .flatMap((line) => line.split(/(?<=[.!??ㅼ슂])\s+/))
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

function extractKeywordCandidates(text: string) {
  const source = String(text || '');
  const matches = source.match(/[\uAC00-\uD7A3A-Za-z0-9()/-]{2,}/g) || [];
  return matches.filter((item) => item.length >= 2);
}

function buildFrontMatterPreview(draftsBySection: Record<string, string>): FrontMatterPreview | null {
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

  const titleSeed =
    compactText(firstSentence(diagnostic), 46) ||
    compactText(firstSentence(clinical), 46) ||
    compactText(firstSentence(patient), 46);

  const title = titleSeed ? `${titleSeed} 증례보고` : '현재 초안 기반 증례보고';

  const keywordPool = [
    ...extractKeywordCandidates(diagnostic),
    ...extractKeywordCandidates(clinical),
    ...extractKeywordCandidates(intervention),
    ...extractKeywordCandidates(followUp)
  ];

  const keywords = Array.from(new Set(keywordPool))
    .filter((item) => !['?섏옄', '利앹긽', '移섎즺', '利앸?', '蹂닿퀬', '寃쎌슦'].includes(item))
    .slice(0, 5);

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
  questions: string[] | undefined,
  kind: 'common' | 'section',
  qnaHistory: QnaItem[] = []
): QuestionItem[] {
  const answeredSet = new Set(qnaHistory.map((item) => item.question.trim()));

  return (questions || [])
    .filter((text) => String(text || '').trim().length > 0)
    .map((text, idx) => ({
      id: `${kind}-${idx}-${text}`,
      text,
      kind,
      answered: answeredSet.has(text.trim())
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
              <div className="message-avatar">Q</div>
              <div className="message-content">
                <div className="message-text">{item.question}</div>
              </div>
            </div>
            <div className="message-answer">
              <div className="message-avatar answer">A</div>
              <div className="message-content">
                <div className="message-text">{item.answer}</div>
              </div>
            </div>
          </div>
        ))}
    </>
  );
}

export default function SectionDetailPage() {
  const { caseId, sectionId } = useParams();
  const navigate = useNavigate();

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
  const [canUndo, setCanUndo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const currentPreviewSectionRef = useRef<HTMLDivElement | null>(null);

  const isQuestionStageSection = sectionId
    ? QUESTION_STAGE_SECTIONS.includes(sectionId as (typeof QUESTION_STAGE_SECTIONS)[number])
    : false;

  const loadData = async () => {
    if (!caseId || !sectionId || !isQuestionStageSection) return;

    const sectionResult = await caseApi.getSectionDetail(caseId, sectionId);
    setSection(sectionResult);
    setDraftsBySection(sectionResult.draftsBySection || {});
    setCanUndo(Boolean(sectionResult.canUndo));
  };

  const handleReviewSection = async () => {
    if (!caseId || !sectionId || !isQuestionStageSection) return;

    setIsReviewing(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const sectionResult = await caseApi.reviewSection(caseId, sectionId);
      setSection(sectionResult);
      setDraftsBySection(sectionResult.draftsBySection || {});
      setCanUndo(Boolean(sectionResult.canUndo));
      setFeedbackMessage('?꾩옱 ?뱀뀡???꾩껜 寃?좊? ?ㅼ떆 ?ㅽ뻾?덉뒿?덈떎.');
    } catch (error: any) {
      setErrorMessage(error?.message || '?뱀뀡 ?꾩껜 寃?좊? ?ㅼ떆 ?ㅽ뻾?섏? 紐삵뻽?듬땲??');
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
        setErrorMessage(error?.message || '?뱀뀡 ?뺣낫瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??');
      } finally {
        setIsLoading(false);
      }
    };

    void run();
  }, [caseId, sectionId, isQuestionStageSection]);

  const isInlineLoading = (isLoading && Boolean(section)) || isReviewing;

  const frontMatterPreview = useMemo(
    () => buildFrontMatterPreview(draftsBySection),
    [draftsBySection]
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
  };

  const handleSelectSectionQuestion = (question: QuestionItem) => {
    setActiveSectionQuestion(question.text);
    setSectionAnswerText('');
    setFeedbackMessage(null);
    setErrorMessage(null);
  };

  const handleSubmitCommonAnswer = async () => {
    if (!caseId || !selectedCommonQuestion?.text || !commonAnswerText.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    try {
      const result = await caseApi.submitCommonAnswer(caseId, selectedCommonQuestion.text, commonAnswerText);

      setDraftsBySection((prev) => mergeDraftMaps(prev, result.updatedDraftsBySection));
      setSection((prev) =>
        prev
          ? {
              ...prev,
              commonQnaHistory: result.qnaHistory
            }
          : prev
      );

      await loadData();
      setCanUndo(true);
      setFeedbackMessage('공통 답변이 반영되어 초안과 질문 목록이 갱신되었습니다.');
      setSelectedCommonQuestion(null);
      setCommonAnswerText('');
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
      setActiveSectionQuestion(result.nextQuestion || result.sectionQuestions[0] || null);
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
      await loadData();
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
      await loadData();
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
          <button type="button" className="btn-back" onClick={() => navigate(`/cases/${caseId}`)}>
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
            <button type="button" className="btn-back" onClick={() => navigate(`/cases/${caseId}`)}>
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
                <Link to={`/cases/${caseId}`}>케이스 개요로 돌아가기</Link>
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
        <button type="button" className="btn-back" onClick={() => navigate(`/cases/${caseId}`)}>
          케이스 개요
        </button>
        <div className="chat-header-title">
          <h1>{sectionTitle}</h1>
          <span className="chat-subtitle">{sectionSubtitle}</span>
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
            <div>
              <strong>공통 질문 목록</strong>
            </div>
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
                      <span>{question.text}</span>
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
                          ??                        </button>
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
                          ??                        </button>
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
                          ??
                        </button>
                      ) : null}
                    </div>
                    <div className="section-content-text">
                      {sid === 'TITLE' ? (
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
                                痍⑥냼
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
                                痍⑥냼
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
          </div>

          <div className="question-priority-panel">
            <div>
              <strong>현재 섹션 질문</strong>
            </div>

            <div className="question-hint-box">
              <strong>현재 질문</strong>
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
                      <span>{question.text}</span>
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
    </div>
  );
}

