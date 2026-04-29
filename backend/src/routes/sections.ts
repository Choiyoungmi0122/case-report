import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import {
  runQuestionGeneration,
  runSectionAdequacyReview,
  runSectionDraftUpdate,
  runSectionMissingDetection
} from '../llm/chains';

const router = express.Router();
const caseModel = new CaseModel();
const ALL_CARE_SECTIONS = Object.values(CareSection) as CareSection[];
const CORE_AI_SECTIONS: CareSection[] = [
  CareSection.PATIENT_INFORMATION,
  CareSection.CLINICAL_FINDINGS,
  CareSection.TIMELINE,
  CareSection.DIAGNOSTIC_ASSESSMENT,
  CareSection.THERAPEUTIC_INTERVENTIONS,
  CareSection.FOLLOW_UP_OUTCOMES,
  CareSection.PATIENT_PERSPECTIVE
];
const COMMON_QUESTION_SECTIONS: CareSection[] = [
  ...CORE_AI_SECTIONS,
  CareSection.DISCUSSION_CONCLUSION
];

function isCareSection(value: string): value is CareSection {
  return ALL_CARE_SECTIONS.includes(value as CareSection);
}

function deriveDraftMapFromSectionDrafts(sectionDrafts: any[]): Record<string, string> {
  return (sectionDrafts || []).reduce((acc: Record<string, string>, draft: any) => {
    if (draft && typeof draft.sectionId === 'string') {
      acc[draft.sectionId] = draft.draftText || '';
    }
    return acc;
  }, {});
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeQuestionKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'\s-]/g, '');
}

function isSameQuestion(a: string, b: string): boolean {
  const keyA = normalizeQuestionKey(a);
  const keyB = normalizeQuestionKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = keyA.length > keyB.length ? keyA : keyB;
  return shorter.length >= 10 && longer.includes(shorter);
}

function filterAnsweredQuestions(items: string[], qnaHistory: QnAPair[]): string[] {
  return (items || []).filter(
    (item) => !qnaHistory.some((historyItem) => isSameQuestion(item, historyItem.question))
  );
}

function mergeReviewerMissingItems(primary: string[], secondary: string[]): string[] {
  return uniqueStrings([...(primary || []), ...(secondary || [])]);
}

function getStoredAdequacyReview(caseData: any, sectionId: CareSection) {
  return caseData?.sectionAdequacyReviews?.[sectionId] || null;
}

function omitSectionAdequacyReview(
  reviews: Record<string, any> | undefined,
  sectionId: CareSection
): Record<string, any> {
  const next = { ...(reviews || {}) };
  delete next[sectionId];
  return next;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pushAnswerUndoEntry(existing: any[], entry: any) {
  return [...(existing || []), entry].slice(-20);
}

async function ensureAdequacyReview(params: {
  caseId: string;
  caseData: any;
  sectionId: CareSection;
  currentDraft: string;
  evidenceCards: any[];
  qnaHistory: QnAPair[];
  forceRefresh?: boolean;
}) {
  const existing = !params.forceRefresh ? getStoredAdequacyReview(params.caseData, params.sectionId) : null;
  if (existing) {
    return existing;
  }

  const review = await runSectionAdequacyReview({
    sectionId: params.sectionId,
    currentDraft: params.currentDraft,
    evidenceCards: params.evidenceCards,
    qnaHistory: params.qnaHistory
  });

  const snapshot = {
    ...review,
    reviewedAt: new Date().toISOString()
  };

  await caseModel.updateCase(params.caseId, {
    sectionAdequacyReviews: {
      ...(params.caseData.sectionAdequacyReviews || {}),
      [params.sectionId]: snapshot
    }
  } as any);

  params.caseData.sectionAdequacyReviews = {
    ...(params.caseData.sectionAdequacyReviews || {}),
    [params.sectionId]: snapshot
  };

  return snapshot;
}

async function buildCommonQuestionPayload(params: {
  caseId: string;
  commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }>;
  commonMissingItems?: Array<{ item: string; relatedSectionIds: CareSection[] }>;
}) {
  const interactionResults = await Promise.all(
    [...ALL_CARE_SECTIONS, '__COMMON__'].map((sectionId) =>
      caseModel.getInteractionByKey(params.caseId, String(sectionId))
    )
  );
  const answeredHistory = interactionResults.flatMap((interaction) => interaction?.qnaHistory || []);
  const commonInteraction = interactionResults[interactionResults.length - 1];

  return {
    commonQuestions: filterAnsweredQuestions(
      uniqueStrings((params.commonQuestionSets || []).map((entry) => entry.question)),
      answeredHistory
    ),
    commonQnaHistory: commonInteraction?.qnaHistory || [],
    commonMissingInfo: uniqueStrings((params.commonMissingItems || []).map((item) => item.item))
  };
}

function buildSectionUiHints(params: {
  currentDraft: string;
  qnaHistory: QnAPair[];
  sectionQuestions: string[];
  sectionMissingInfo: string[];
  adequacyStatus?: 'INSUFFICIENT' | 'BORDERLINE' | 'ADEQUATE';
  adequacySummary?: string;
}) {
  const hasDraft = Boolean(String(params.currentDraft || '').trim());
  const hasQnaHistory = (params.qnaHistory || []).length > 0;
  const hasSectionQuestions = (params.sectionQuestions || []).length > 0;
  const hasSectionMissingInfo = (params.sectionMissingInfo || []).length > 0;

  if (hasDraft && params.adequacyStatus === 'INSUFFICIENT') {
    return {
      stage: 'questions_available',
      subtitle: params.adequacySummary || '현재 초안만으로는 이 섹션이 충분하지 않습니다.',
      emptyMessage: '이 섹션은 아직 추가 보완이 필요합니다.',
      hideStartButton: false
    };
  }

  if (hasDraft && params.adequacyStatus === 'BORDERLINE') {
    return {
      stage: 'questions_available',
      subtitle: params.adequacySummary || '현재 초안은 작성되어 있지만, 더 구체화하면 좋습니다.',
      emptyMessage: '추가 질문이 없어도 이 섹션은 더 보완할 여지가 있습니다.',
      hideStartButton: false
    };
  }

  if (hasDraft && hasQnaHistory && !hasSectionQuestions && !hasSectionMissingInfo) {
    return {
      stage: 'refined_no_questions',
      subtitle: 'There are no more unanswered AI questions for this section.',
      emptyMessage: 'No additional section-specific questions remain.',
      hideStartButton: true
    };
  }

  if (hasDraft && !hasQnaHistory && !hasSectionQuestions && !hasSectionMissingInfo) {
    return {
      stage: 'draft_created',
      subtitle: 'A draft exists, and there are currently no AI follow-up questions for this section.',
      emptyMessage: 'No additional section-specific questions are available right now.',
      hideStartButton: true
    };
  }

  if (hasSectionQuestions || hasSectionMissingInfo) {
    return {
      stage: 'questions_available',
      subtitle: 'AI-generated questions are available to refine this section.',
      emptyMessage: 'No additional section-specific questions are available right now.',
      hideStartButton: false
    };
  }

  return {
    stage: hasDraft ? 'draft_created' : 'empty',
    subtitle: hasDraft
      ? 'Review the current draft and answer additional AI questions if they appear.'
      : 'Not enough evidence is available to draft this section yet.',
    emptyMessage: hasDraft
      ? 'No additional section-specific questions are available right now.'
      : 'No section-specific questions are available right now.',
    hideStartButton: hasDraft
  };
}

async function refreshGlobalQuestionState(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
}) {
  const commonQuestionDrafts = params.sectionDrafts.filter((draft) =>
    COMMON_QUESTION_SECTIONS.includes(draft.sectionId)
  );

  const missingResult = await runSectionMissingDetection({
    sectionDrafts: commonQuestionDrafts,
    evidenceCards: params.evidenceCards,
    caseTitle: params.caseTitle
  });
  const questionResult = await runQuestionGeneration({
    sectionDrafts: commonQuestionDrafts,
    sectionMissing: missingResult.sectionMissing,
    commonMissing: missingResult.commonMissing,
    caseTitle: params.caseTitle
  });

  const missingBySection = new Map(
    missingResult.sectionMissing.map((item) => [item.sectionId, item.missingItems || []])
  );
  const questionsBySection = new Map(
    questionResult.sectionQuestions.map((item) => [item.sectionId, item.questions || []])
  );

  for (const state of params.sectionStates) {
    state.missingInfoBullets = uniqueStrings(missingBySection.get(state.sectionId) || state.missingInfoBullets || []);
    state.recommendedQuestions = uniqueStrings(questionsBySection.get(state.sectionId) || state.recommendedQuestions || []);

    if (CORE_AI_SECTIONS.includes(state.sectionId)) {
      const draftEntry = params.sectionDrafts.find((draft) => draft.sectionId === state.sectionId);
      const hasDraft = Boolean(draftEntry?.draftText?.trim());
      const hasMissing = state.missingInfoBullets.length > 0;

      if (!hasDraft) {
        state.status = 'IMPOSSIBLE';
        state.rationaleText = 'Not enough evidence was available to create this section draft.';
      } else if (hasMissing) {
        state.status = 'INCOMPLETE';
        state.rationaleText = 'A draft exists, but some details are still missing.';
      } else {
        state.status = 'READY';
        state.rationaleText = 'The current evidence is sufficient for this section draft.';
      }
    }
  }

  return {
    commonMissingItems: (missingResult.commonMissing || []).map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[]
    })),
    commonQuestionSets: (questionResult.commonQuestions || []).map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[]
    }))
  };
}

router.get('/:id/sections/:sectionId', async (req: Request, res: Response) => {
  try {
    const { id, sectionId } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (!isCareSection(sectionId)) {
      return res.status(400).json({ error: 'Invalid sectionId' });
    }

    const section = sectionId as CareSection;
    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state = sectionStates.find((item) => item.sectionId === section) || {
      sectionId: section,
      status: 'IMPOSSIBLE',
      rationaleText: 'Not enough evidence was available to create this section draft.',
      missingInfoBullets: [],
      recommendedQuestions: []
    };
    const draftEntry = sectionDrafts.find((item) => item.sectionId === section) || {
      sectionId: section,
      draftText: '',
      evidenceCardIdsUsed: [],
      openIssues: []
    };
    const relevantEvidence = evidenceCards.filter((card) => (card.tags || []).includes(section));
    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory = interaction?.qnaHistory || [];

    const sectionQuestions = filterAnsweredQuestions(uniqueStrings(state.recommendedQuestions || []), qnaHistory);
    const adequacyReview = await ensureAdequacyReview({
      caseId: id,
      caseData: anyCase,
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory
    });
    const sectionMissingInfo = mergeReviewerMissingItems(uniqueStrings(state.missingInfoBullets || []), [
      ...(adequacyReview.missingRequiredItems || []),
      ...(adequacyReview.depthIssues || [])
    ]);
    const effectiveSectionQuestions =
      sectionQuestions.length === 0 && adequacyReview.shouldAskMore && adequacyReview.questionFocus.trim()
        ? [adequacyReview.questionFocus.trim()]
        : sectionQuestions;
    const commonPayload = await buildCommonQuestionPayload({
      caseId: id,
      commonQuestionSets,
      commonMissingItems
    });
    const uiHints = buildSectionUiHints({
      currentDraft: draftEntry.draftText || '',
      qnaHistory,
      sectionQuestions: effectiveSectionQuestions,
      sectionMissingInfo,
      adequacyStatus: adequacyReview.adequacyStatus,
      adequacySummary: adequacyReview.summary
    });

    res.json({
      section: sectionId,
      status: state.status,
      rationaleText: adequacyReview.summary || state.rationaleText,
      missingInfoBullets: sectionMissingInfo,
      recommendedQuestions: effectiveSectionQuestions,
      draftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts),
      sectionMissingInfo,
      commonMissingInfo: commonPayload.commonMissingInfo,
      sectionQuestions: effectiveSectionQuestions,
      commonQuestions: commonPayload.commonQuestions,
      commonQnaHistory: commonPayload.commonQnaHistory,
      currentDraft: draftEntry.draftText || '',
      evidence: relevantEvidence.map((card) => card.normalizedText || ''),
      evidenceCards: relevantEvidence,
      qnaHistory,
      uiHints,
      canUndo: Boolean((anyCase.answerUndoStack || []).length)
    });
  } catch (error: any) {
    console.error('Error getting section:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/sections/:sectionId/review', async (req: Request, res: Response) => {
  try {
    const { id, sectionId } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (!isCareSection(sectionId)) {
      return res.status(400).json({ error: 'Invalid sectionId' });
    }

    const section = sectionId as CareSection;
    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state = sectionStates.find((item) => item.sectionId === section) || {
      sectionId: section,
      status: 'IMPOSSIBLE',
      rationaleText: 'Not enough evidence was available to create this section draft.',
      missingInfoBullets: [],
      recommendedQuestions: []
    };
    const draftEntry = sectionDrafts.find((item) => item.sectionId === section) || {
      sectionId: section,
      draftText: '',
      evidenceCardIdsUsed: [],
      openIssues: []
    };
    const relevantEvidence = evidenceCards.filter((card) => (card.tags || []).includes(section));
    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory = interaction?.qnaHistory || [];
    const sectionQuestions = filterAnsweredQuestions(uniqueStrings(state.recommendedQuestions || []), qnaHistory);

    const adequacyReview = await ensureAdequacyReview({
      caseId: id,
      caseData: anyCase,
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory,
      forceRefresh: true
    });
    const sectionMissingInfo = mergeReviewerMissingItems(uniqueStrings(state.missingInfoBullets || []), [
      ...(adequacyReview.missingRequiredItems || []),
      ...(adequacyReview.depthIssues || [])
    ]);
    const effectiveSectionQuestions =
      sectionQuestions.length === 0 && adequacyReview.shouldAskMore && adequacyReview.questionFocus.trim()
        ? [adequacyReview.questionFocus.trim()]
        : sectionQuestions;
    const commonPayload = await buildCommonQuestionPayload({
      caseId: id,
      commonQuestionSets,
      commonMissingItems
    });
    const uiHints = buildSectionUiHints({
      currentDraft: draftEntry.draftText || '',
      qnaHistory,
      sectionQuestions: effectiveSectionQuestions,
      sectionMissingInfo,
      adequacyStatus: adequacyReview.adequacyStatus,
      adequacySummary: adequacyReview.summary
    });

    res.json({
      section: sectionId,
      status: state.status,
      rationaleText: adequacyReview.summary || state.rationaleText,
      missingInfoBullets: sectionMissingInfo,
      recommendedQuestions: effectiveSectionQuestions,
      draftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts),
      sectionMissingInfo,
      commonMissingInfo: commonPayload.commonMissingInfo,
      sectionQuestions: effectiveSectionQuestions,
      commonQuestions: commonPayload.commonQuestions,
      commonQnaHistory: commonPayload.commonQnaHistory,
      currentDraft: draftEntry.draftText || '',
      evidence: relevantEvidence.map((card) => card.normalizedText || ''),
      evidenceCards: relevantEvidence,
      qnaHistory,
      uiHints,
      canUndo: Boolean((anyCase.answerUndoStack || []).length)
    });
  } catch (error: any) {
    console.error('Error reviewing section:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/sections/:sectionId/next', async (req: Request, res: Response) => {
  try {
    const { id, sectionId } = req.params;
    const { userAnswer, question } = req.body as { userAnswer?: string; question?: string };

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (!isCareSection(sectionId)) {
      return res.status(400).json({ error: 'Invalid sectionId' });
    }

    const section = sectionId as CareSection;
    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state =
      sectionStates.find((item) => item.sectionId === section) ||
      (() => {
        const nextState = {
          sectionId: section,
          status: 'IMPOSSIBLE',
          rationaleText: 'Not enough evidence was available to create this section draft.',
          missingInfoBullets: [],
          recommendedQuestions: []
        };
        sectionStates.push(nextState);
        return nextState;
      })();
    const draftEntry =
      sectionDrafts.find((item) => item.sectionId === section) ||
      (() => {
        const nextDraft = {
          sectionId: section,
          draftText: '',
          evidenceCardIdsUsed: [],
          openIssues: []
        };
        sectionDrafts.push(nextDraft);
        return nextDraft;
      })();
    const relevantEvidence = evidenceCards.filter((card) => (card.tags || []).includes(section));
    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory: QnAPair[] = interaction?.qnaHistory || [];

    const sectionQuestions = filterAnsweredQuestions(uniqueStrings(state.recommendedQuestions || []), qnaHistory);
    const sectionMissingInfo = uniqueStrings(state.missingInfoBullets || []);
    const commonPayload = await buildCommonQuestionPayload({
      caseId: id,
      commonQuestionSets,
      commonMissingItems
    });

    if (!userAnswer || userAnswer === 'SKIP') {
      const nextQuestion = sectionQuestions[0] || null;
      const uiHints = buildSectionUiHints({
        currentDraft: draftEntry.draftText || '',
        qnaHistory,
        sectionQuestions,
        sectionMissingInfo
      });

      return res.json({
        nextQuestion,
        whyThisQuestion: nextQuestion ? 'This is the next AI-generated question for this section.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: state.missingInfoBullets || [],
        updatedDraftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts),
        sectionQuestions,
        commonQuestions: commonPayload.commonQuestions,
        sectionMissingInfo,
        commonMissingInfo: commonPayload.commonMissingInfo,
        commonQnaHistory: commonPayload.commonQnaHistory,
        insufficiencyReason: nextQuestion ? null : 'No additional section-specific AI questions remain.',
        qnaHistory,
        uiHints
      });
    }

    const latestQuestion = question || sectionQuestions[0] || 'Section question';
    const undoEntry = {
      timestamp: new Date().toISOString(),
      kind: 'SECTION' as const,
      question: latestQuestion,
      sectionId: section,
      before: {
        draftsBySection: cloneJson((anyCase as any).draftsBySection || {}),
        sectionDrafts: cloneJson(sectionDrafts),
        sectionStates: cloneJson(sectionStates),
        commonMissingItems: cloneJson(anyCase.commonMissingItems || []),
        commonQuestionSets: cloneJson(anyCase.commonQuestionSets || []),
        sectionAdequacyReviews: cloneJson(anyCase.sectionAdequacyReviews || {}),
        interactions: [
          {
            sectionId: section,
            qnaHistory: cloneJson(qnaHistory)
          }
        ]
      }
    };
    qnaHistory.push({
      question: latestQuestion,
      answer: userAnswer,
      timestamp: new Date().toISOString()
    });

    const updateResult = await runSectionDraftUpdate({
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory,
      pendingItems: draftEntry.openIssues || state.missingInfoBullets || [],
      question: latestQuestion,
      answer: userAnswer
    });

    draftEntry.draftText = updateResult.updatedDraftText || draftEntry.draftText || '';

    const globalState = await refreshGlobalQuestionState({
      sectionDrafts,
      sectionStates,
      evidenceCards,
      caseTitle: case_.title
    });

    await caseModel.updateCase(id, {
      ...anyCase,
      sectionDrafts,
      sectionStates,
      commonMissingItems: globalState.commonMissingItems,
      commonQuestionSets: globalState.commonQuestionSets,
      answerUndoStack: pushAnswerUndoEntry(anyCase.answerUndoStack || [], undoEntry),
      sectionAdequacyReviews: omitSectionAdequacyReview(anyCase.sectionAdequacyReviews, section)
    });
    await caseModel.saveSectionInteraction(id, {
      sectionId: section,
      qnaHistory
    });

    const nextSectionMissingInfo = uniqueStrings(state.missingInfoBullets || []);
    const nextCommonPayload = await buildCommonQuestionPayload({
      caseId: id,
      commonQuestionSets: globalState.commonQuestionSets,
      commonMissingItems: globalState.commonMissingItems
    });
    const finalSectionQuestions = filterAnsweredQuestions(uniqueStrings(state.recommendedQuestions || []), qnaHistory);
    const finalNextQuestion = finalSectionQuestions[0] || null;
    const uiHints = buildSectionUiHints({
      currentDraft: draftEntry.draftText || '',
      qnaHistory,
      sectionQuestions: finalSectionQuestions,
      sectionMissingInfo: nextSectionMissingInfo
    });

    return res.json({
      nextQuestion: finalNextQuestion,
      whyThisQuestion: finalNextQuestion ? 'This is the next AI-generated question for this section.' : '',
      updatedDraftText: draftEntry.draftText || '',
      updatedDraftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts),
      needMore: finalSectionQuestions.length > 0,
      remainingItems: nextSectionMissingInfo,
      sectionQuestions: finalSectionQuestions,
      commonQuestions: nextCommonPayload.commonQuestions,
      sectionMissingInfo: nextSectionMissingInfo,
      commonMissingInfo: nextCommonPayload.commonMissingInfo,
      commonQnaHistory: nextCommonPayload.commonQnaHistory,
      insufficiencyReason: null,
      qnaHistory,
      lightweight: false,
      uiHints,
      canUndo: true
    });
  } catch (error: any) {
    console.error('Error in section next-step:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
