import express, { Request, Response } from 'express';
import { createHash } from 'crypto';
import { CaseModel } from '../models/caseModel';
import { Visit, CareSection, QnAPair } from '../types';
import {
  runEvidenceSplit,
  runInitialSectionDrafts,
  runQuestionGeneration,
  runSectionAssessment,
  runSectionDraftUpdate,
  runSectionMissingDetection,
  runFinalManuscriptCompose
} from '../llm/chains';

const router = express.Router();
const caseModel = new CaseModel();
const runningFinalComposeJobs = new Map<string, Promise<void>>();

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
const NON_CORE_GENERATED_SECTIONS: CareSection[] = [
  CareSection.TITLE,
  CareSection.ABSTRACT,
  CareSection.INTRODUCTION,
  CareSection.DISCUSSION_CONCLUSION,
  CareSection.INFORMED_CONSENT
];
const COMMON_INTERACTION_KEY = '__COMMON__';

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

function deriveDraftMapFromSectionDrafts(sectionDrafts: any[]): Record<string, string> {
  return (sectionDrafts || []).reduce((acc: Record<string, string>, draft: any) => {
    if (draft && typeof draft.sectionId === 'string') {
      acc[draft.sectionId] = draft.draftText || '';
    }
    return acc;
  }, {});
}

function omitSectionAdequacyReviews(
  reviews: Record<string, any> | undefined,
  sectionIds: string[]
): Record<string, any> {
  const next = { ...(reviews || {}) };
  for (const sectionId of sectionIds) {
    delete next[sectionId];
  }
  return next;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function pushAnswerUndoEntry(existing: any[], entry: any) {
  return [...(existing || []), entry].slice(-20);
}

function buildProcessInputHash(visits: Array<{ index: number; date: string; text: string }>): string {
  const normalized = visits.map((visit) => ({
    index: visit.index,
    date: visit.date || '',
    text: visit.text || ''
  }));

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function getRelevantEvidence(evidenceCards: any[], sectionId: CareSection) {
  return (evidenceCards || []).filter((card) => (card.tags || []).includes(sectionId));
}

function ensureAllSectionStates(sectionStates: any[]) {
  const stateBySection = new Map((sectionStates || []).map((state: any) => [state.sectionId, state]));

  return ALL_CARE_SECTIONS.map((sectionId) => {
    const existing = stateBySection.get(sectionId);
    if (existing) return existing;

    return {
      sectionId,
      status: 'IMPOSSIBLE',
      rationaleText: 'Not enough evidence was available to create this section draft.',
      missingInfoBullets: [],
      recommendedQuestions: []
    };
  });
}

function ensureAllSectionDrafts(sectionDrafts: any[]) {
  const draftBySection = new Map((sectionDrafts || []).map((draft: any) => [draft.sectionId, draft]));

  return ALL_CARE_SECTIONS.map((sectionId) => {
    const existing = draftBySection.get(sectionId);
    if (existing) return existing;

    return {
      sectionId,
      evidenceCardIdsUsed: [] as string[],
      draftText: '',
      openIssues: [] as string[]
    };
  });
}

function applyQuestionState(params: {
  sectionStates: any[];
  sectionDrafts: any[];
  sectionMissing: Array<{ sectionId: string; missingItems: string[] }>;
  commonMissing: Array<{ item: string; relatedSectionIds: string[] }>;
  commonQuestions: Array<{ question: string; targetSectionIds: string[] }>;
  sectionQuestions: Array<{ sectionId: string; questions: string[] }>;
}) {
  const missingBySection = new Map(params.sectionMissing.map((item) => [item.sectionId, item.missingItems || []]));
  const questionsBySection = new Map(params.sectionQuestions.map((item) => [item.sectionId, item.questions || []]));

  for (const state of params.sectionStates) {
    const missingItems = missingBySection.get(state.sectionId) || [];
    const questions = questionsBySection.get(state.sectionId) || [];
    const hasDraft = Boolean(
      params.sectionDrafts.find((draft) => draft.sectionId === state.sectionId)?.draftText?.trim()
    );

    state.missingInfoBullets = uniqueStrings(missingItems);
    state.recommendedQuestions = uniqueStrings(questions);

    if (CORE_AI_SECTIONS.includes(state.sectionId)) {
      if (hasDraft && missingItems.length === 0) {
        state.status = 'READY';
      } else if (hasDraft) {
        state.status = 'INCOMPLETE';
      }
    }
  }

  return {
    commonMissingItems: params.commonMissing.map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[]
    })),
    commonQuestionSets: params.commonQuestions.map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[]
    }))
  };
}

async function recomputeQuestionState(params: {
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

  const commonState = applyQuestionState({
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    sectionMissing: missingResult.sectionMissing,
    commonMissing: missingResult.commonMissing,
    commonQuestions: questionResult.commonQuestions,
    sectionQuestions: questionResult.sectionQuestions
  });

  return {
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    commonMissingItems: commonState.commonMissingItems,
    commonQuestionSets: commonState.commonQuestionSets
  };
}

function findTargetSectionsForCommonQuestion(params: {
  question: string;
  commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }>;
}): CareSection[] {
  const matched = (params.commonQuestionSets || []).find((entry) =>
    isSameQuestion(entry.question, params.question)
  );

  return matched?.targetSectionIds || [];
}

async function collectQnaHistoryBySection(caseId: string) {
  const qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>> = {};
  const interactionResults = await Promise.all(
    ALL_CARE_SECTIONS.map((sectionKey) => caseModel.getSectionInteraction(caseId, sectionKey))
  );

  for (const [index, sectionKey] of ALL_CARE_SECTIONS.entries()) {
    const interaction = interactionResults[index];
    if (interaction?.qnaHistory?.length) {
      qnaHistoryBySection[sectionKey] = interaction.qnaHistory.map((item) => ({
        question: item.question,
        answer: item.answer
      }));
    }
  }

  return qnaHistoryBySection;
}

async function runFinalComposeJob(params: {
  caseId: string;
  contributionAnswers?: Array<{ question: string; answer: string }>;
}) {
  const { caseId, contributionAnswers } = params;

  if (runningFinalComposeJobs.has(caseId)) {
    return runningFinalComposeJobs.get(caseId)!;
  }

  const jobPromise = (async () => {
    try {
      const queuedCase = await caseModel.getCase(caseId);
      const queuedStatus = (queuedCase as any)?.finalComposeStatus;
      const startedAt = new Date().toISOString();

      await caseModel.updateCase(caseId, {
        finalComposeStatus: {
          status: 'RUNNING',
          requestedAt: queuedStatus?.requestedAt || startedAt,
          startedAt
        }
      } as any);

      const case_ = await caseModel.getCase(caseId);
      if (!case_) {
        throw new Error('Case not found');
      }

      const anyCase: any = case_;
      const sectionDrafts: any[] = anyCase.sectionDrafts || [];
      const evidenceCards: any[] = anyCase.evidenceCards || [];
      const qnaHistoryBySection = await collectQnaHistoryBySection(caseId);

      const finalDraft = await runFinalManuscriptCompose({
        sectionDrafts,
        evidenceCards,
        qnaHistoryBySection,
        contributionAnswers
      });

      const nextSectionDrafts = [...sectionDrafts];
      const nextSectionStates = [...(anyCase.sectionStates || [])];

      for (const sectionId of NON_CORE_GENERATED_SECTIONS) {
        const text = finalDraft.fullTextBySection?.[sectionId] || '';
        const existingDraft = nextSectionDrafts.find((draft) => draft.sectionId === sectionId);
        if (existingDraft) {
          existingDraft.draftText = text;
        } else {
          nextSectionDrafts.push({
            sectionId,
            evidenceCardIdsUsed: [] as string[],
            draftText: text,
            openIssues: [] as string[]
          });
        }

        const existingState = nextSectionStates.find((state) => state.sectionId === sectionId);
        const nextState = {
          sectionId,
          status: text.trim() ? 'READY' : 'IMPOSSIBLE',
          rationaleText: text.trim()
            ? 'This section was composed from the final manuscript generation step.'
            : 'Not enough evidence was available to generate this final section.',
          missingInfoBullets: existingState?.missingInfoBullets || [],
          recommendedQuestions: []
        };

        if (existingState) {
          Object.assign(existingState, nextState);
        } else {
          nextSectionStates.push(nextState);
        }
      }

      await caseModel.updateCase(caseId, {
        ...(anyCase as any),
        finalDraft,
        sectionDrafts: nextSectionDrafts,
        sectionStates: nextSectionStates,
        finalComposeStatus: {
          status: 'COMPLETED',
          requestedAt: (anyCase.finalComposeStatus as any)?.requestedAt || startedAt,
          startedAt: (anyCase.finalComposeStatus as any)?.startedAt || startedAt,
          completedAt: new Date().toISOString()
        }
      } as any);
    } catch (error: any) {
      const failedCase = await caseModel.getCase(caseId);
      const failedStatus = (failedCase as any)?.finalComposeStatus;
      await caseModel.updateCase(caseId, {
        finalComposeStatus: {
          status: 'FAILED',
          requestedAt: failedStatus?.requestedAt || new Date().toISOString(),
          startedAt: failedStatus?.startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: error?.message || 'Failed to compose final manuscript.'
        }
      } as any);
      throw error;
    } finally {
      runningFinalComposeJobs.delete(caseId);
    }
  })();

  runningFinalComposeJobs.set(caseId, jobPromise);
  return jobPromise;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const cases = await caseModel.getAllCases();
    res.json({ cases });
  } catch (error: any) {
    console.error('Error getting all cases:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { visits, title } = req.body;

    if (!visits || !Array.isArray(visits) || visits.length === 0) {
      return res.status(400).json({ error: 'visits array is required' });
    }

    const processedVisits: Visit[] = visits.map((visit: any, index: number) => ({
      index: index + 1,
      type: visit.type || '초진',
      date: visit.date,
      soapText: visit.soapText || '',
      structured: visit.structured
    }));

    const caseId = await caseModel.createCase({
      title: title || undefined,
      visits: processedVisits
    });

    res.json({ caseId });
  } catch (error: any) {
    console.error('Error creating case:', error);
    res.status(500).json({
      error: error.message || 'Failed to create case',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.post('/:id/process', async (req: Request, res: Response) => {
  const processStartedAt = Date.now();
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const visitsForChain1 = case_.visits.map((visit: any, idx: number) => ({
      index: visit.index ?? visit.visitIndex ?? idx + 1,
      date: visit.date ?? visit.visitDateTime ?? '',
      text: visit.soapText ?? visit.sanitizedText ?? ''
    }));
    const inputHash = buildProcessInputHash(visitsForChain1);
    const anyCase: any = case_;

    const hasReusableProcessingResult =
      anyCase.processingCache?.inputHash === inputHash &&
      Array.isArray(anyCase.sectionStates) &&
      anyCase.sectionStates.length > 0 &&
      Array.isArray(anyCase.sectionDrafts) &&
      anyCase.sectionDrafts.length > 0;

    if (hasReusableProcessingResult) {
      console.log(`[PROCESS ${id}] cache hit in ${Date.now() - processStartedAt}ms`);
      const sectionsOverview = anyCase.sectionStates.map((state: any) => {
        const draft = (anyCase.sectionDrafts || []).find((item: any) => item.sectionId === state.sectionId);
        return {
          section: state.sectionId,
          status: state.status,
          rationaleText: state.rationaleText,
          draftSnippet: draft?.draftText?.slice(0, 200) || ''
        };
      });

      return res.json({
        caseId: id,
        sectionsOverview,
        cached: true
      });
    }

    const evidenceCards = await runEvidenceSplit(visitsForChain1);
    const sectionStates = ensureAllSectionStates(await runSectionAssessment(evidenceCards));
    const sectionDrafts = ensureAllSectionDrafts(await runInitialSectionDrafts(evidenceCards, sectionStates));

    const nextState = await recomputeQuestionState({
      sectionDrafts,
      sectionStates,
      evidenceCards,
      caseTitle: case_.title
    });

    await caseModel.updateCase(id, {
      ...(case_ as any),
      processingCache: {
        inputHash,
        processedAt: new Date().toISOString()
      },
      evidenceCards,
      sectionStates: nextState.sectionStates,
      sectionDrafts: nextState.sectionDrafts,
      commonMissingItems: nextState.commonMissingItems,
      commonQuestionSets: nextState.commonQuestionSets
    } as any);

    const sectionsOverview = nextState.sectionStates.map((state) => {
      const draft = nextState.sectionDrafts.find((item) => item.sectionId === state.sectionId);
      return {
        section: state.sectionId,
        status: state.status,
        rationaleText: state.rationaleText,
        draftSnippet: draft?.draftText.slice(0, 200) || ''
      };
    });

    console.log(
      `[PROCESS ${id}] completed in ${Date.now() - processStartedAt}ms ` +
        `(visits=${visitsForChain1.length}, evidence=${evidenceCards.length})`
    );
    res.json({ caseId: id, sectionsOverview, cached: false });
  } catch (error: any) {
    console.error('Error processing case:', error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/title', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    await caseModel.updateCase(id, { title: title || undefined });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating case title:', error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/front-matter', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, keywords, discussion } = req.body;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }
    const anyCase: any = case_;

    const rawDraftsBySection = ((case_ as any).draftsBySection || {}) as Record<string, string>;
    const normalizedTitle = String(title || '').trim();
    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : String(keywords || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    const normalizedDiscussion = String(discussion || '').trim();

    const nextDraftsBySection = {
      ...rawDraftsBySection,
      TITLE: normalizedTitle,
      KEYWORDS: normalizedKeywords.join(', '),
      DISCUSSION_CONCLUSION: normalizedDiscussion
    };
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const sectionStates: any[] = anyCase.sectionStates || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];

    const nextState =
      sectionDrafts.length > 0 && sectionStates.length > 0
        ? await recomputeQuestionState({
            sectionDrafts,
            sectionStates,
            evidenceCards,
            caseTitle: normalizedTitle
          })
        : null;

    await caseModel.updateCase(id, {
      title: normalizedTitle || undefined,
      draftsBySection: nextDraftsBySection as any,
      ...(nextState
        ? {
            sectionStates: nextState.sectionStates,
            sectionDrafts: nextState.sectionDrafts,
            commonMissingItems: nextState.commonMissingItems,
            commonQuestionSets: nextState.commonQuestionSets
          }
        : {})
    } as any);

    res.json({
      success: true,
      title: normalizedTitle,
      keywords: normalizedKeywords,
      draftsBySection: nextDraftsBySection
    });
  } catch (error: any) {
    console.error('Error updating front matter:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/common-questions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const commonQuestionSets = anyCase.commonQuestionSets || [];
    const commonMissingItems = anyCase.commonMissingItems || [];

    const interactionResults = await Promise.all(
      [...ALL_CARE_SECTIONS, COMMON_INTERACTION_KEY as any].map((sectionId) =>
        caseModel.getInteractionByKey(id, String(sectionId))
      )
    );
    const answeredHistory = interactionResults.flatMap((interaction) => interaction?.qnaHistory || []);
    const filteredQuestions = filterAnsweredQuestions(
      uniqueStrings(commonQuestionSets.map((entry: any) => entry.question)),
      answeredHistory
    );
    const commonInteraction = interactionResults[interactionResults.length - 1];

    res.json({
      questions: filteredQuestions,
      qnaHistory: commonInteraction?.qnaHistory || [],
      missingInfo: uniqueStrings(commonMissingItems.map((item: any) => item.item))
    });
  } catch (error: any) {
    console.error('Error getting common questions:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/common-questions/answer', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body as { question?: string; answer?: string };

    if (!question || !answer?.trim()) {
      return res.status(400).json({ error: 'question and answer are required' });
    }

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const sectionStates: any[] = anyCase.sectionStates || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }> =
      anyCase.commonQuestionSets || [];
    const commonInteraction = await caseModel.getInteractionByKey(id, COMMON_INTERACTION_KEY);
    const commonQnaHistory: QnAPair[] = commonInteraction?.qnaHistory || [];
    const undoEntry = {
      timestamp: new Date().toISOString(),
      kind: 'COMMON' as const,
      question,
      sectionId: COMMON_INTERACTION_KEY,
      before: {
        draftsBySection: cloneJson((anyCase as any).draftsBySection || {}),
        sectionDrafts: cloneJson(sectionDrafts),
        sectionStates: cloneJson(sectionStates),
        commonMissingItems: cloneJson(anyCase.commonMissingItems || []),
        commonQuestionSets: cloneJson(anyCase.commonQuestionSets || []),
        sectionAdequacyReviews: cloneJson(anyCase.sectionAdequacyReviews || {}),
        interactions: [
          {
            sectionId: COMMON_INTERACTION_KEY,
            qnaHistory: cloneJson(commonQnaHistory)
          }
        ]
      }
    };

    commonQnaHistory.push({
      question,
      answer,
      timestamp: new Date().toISOString()
    });

    const targetSections = findTargetSectionsForCommonQuestion({
      question,
      commonQuestionSets
    });

    const sectionInteractions = await Promise.all(
      targetSections.map((sectionId) => caseModel.getSectionInteraction(id, sectionId))
    );

    await Promise.all(
      targetSections.map(async (sectionId, index) => {
        const draftEntry = sectionDrafts.find((draft) => draft.sectionId === sectionId);
        const state = sectionStates.find((item) => item.sectionId === sectionId);
        if (!draftEntry || !state) return;

        const sectionQnaHistory = sectionInteractions[index]?.qnaHistory || [];
        const mergedQnaHistory = uniqueStrings([
          ...sectionQnaHistory.map((item) => JSON.stringify(item)),
          ...commonQnaHistory.map((item) => JSON.stringify(item))
        ]).map((item) => JSON.parse(item));

        const updateResult = await runSectionDraftUpdate({
          sectionId,
          currentDraft: draftEntry.draftText || '',
          evidenceCards: getRelevantEvidence(evidenceCards, sectionId),
          qnaHistory: mergedQnaHistory,
          pendingItems: draftEntry.openIssues || state.missingInfoBullets || [],
          question,
          answer
        });

        draftEntry.draftText = updateResult.updatedDraftText || draftEntry.draftText || '';
      })
    );

    const nextState = await recomputeQuestionState({
      sectionDrafts,
      sectionStates,
      evidenceCards,
      caseTitle: case_.title
    });

    await caseModel.updateCase(id, {
      ...(anyCase as any),
      sectionDrafts: nextState.sectionDrafts,
      sectionStates: nextState.sectionStates,
      commonMissingItems: nextState.commonMissingItems,
      commonQuestionSets: nextState.commonQuestionSets,
      answerUndoStack: pushAnswerUndoEntry(anyCase.answerUndoStack || [], undoEntry),
      sectionAdequacyReviews: omitSectionAdequacyReviews(
        anyCase.sectionAdequacyReviews,
        targetSections
      )
    } as any);
    await caseModel.saveInteractionByKey(id, {
      sectionId: COMMON_INTERACTION_KEY,
      qnaHistory: commonQnaHistory
    });

    res.json({
      updatedDraftsBySection: deriveDraftMapFromSectionDrafts(nextState.sectionDrafts),
      qnaHistory: commonQnaHistory
    });
  } catch (error: any) {
    console.error('Error answering common question:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/undo-last-answer', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const undoStack = anyCase.answerUndoStack || [];
    const latestEntry = undoStack[undoStack.length - 1];

    if (!latestEntry) {
      return res.status(400).json({ error: 'There is no answer to undo.' });
    }

    await caseModel.updateCase(id, {
      draftsBySection: latestEntry.before.draftsBySection || {},
      sectionDrafts: latestEntry.before.sectionDrafts || [],
      sectionStates: latestEntry.before.sectionStates || [],
      commonMissingItems: latestEntry.before.commonMissingItems || [],
      commonQuestionSets: latestEntry.before.commonQuestionSets || [],
      sectionAdequacyReviews: latestEntry.before.sectionAdequacyReviews || {},
      answerUndoStack: undoStack.slice(0, -1)
    } as any);

    await Promise.all(
      (latestEntry.before.interactions || []).map((interaction: any) =>
        caseModel.saveInteractionByKey(id, {
          sectionId: interaction.sectionId,
          qnaHistory: interaction.qnaHistory || []
        })
      )
    );

    res.json({
      success: true,
      undone: {
        kind: latestEntry.kind,
        question: latestEntry.question,
        sectionId: latestEntry.sectionId
      },
      remainingUndoCount: Math.max(0, undoStack.length - 1)
    });
  } catch (error: any) {
    console.error('Error undoing last answer:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    res.json(case_);
  } catch (error: any) {
    console.error('Error getting case:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    await caseModel.deleteCase(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting case:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/sections', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];

    const sections = sectionStates.map((state) => {
      const draft = sectionDrafts.find((item) => item.sectionId === state.sectionId);
      return {
        section: state.sectionId,
        status: state.status,
        rationaleText: state.rationaleText,
        missingInfoBullets: state.missingInfoBullets || [],
        recommendedQuestions: state.recommendedQuestions || [],
        draftSnippet: draft?.draftText?.substring(0, 200) || ''
      };
    });

    res.json({ sections });
  } catch (error: any) {
    console.error('Error getting sections:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/final-compose-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;

    res.json({
      caseId: id,
      title: case_.title || '',
      finalDraft: anyCase.finalDraft || null,
      finalComposeStatus:
        anyCase.finalComposeStatus || {
          status: anyCase.finalDraft ? 'COMPLETED' : 'IDLE'
        }
    });
  } catch (error: any) {
    console.error('Error getting final-compose status:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/final-compose', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contributionAnswers } = req.body as {
      contributionAnswers?: Array<{ question: string; answer: string }>;
    };

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const previousStatus = anyCase.finalComposeStatus;
    const now = new Date().toISOString();
    const isAlreadyRunning = runningFinalComposeJobs.has(id);
    const nextStatus = isAlreadyRunning
      ? previousStatus || {
          status: 'RUNNING',
          requestedAt: now,
          startedAt: now
        }
      : {
          status: 'QUEUED',
          requestedAt: now,
          startedAt: previousStatus?.startedAt,
          completedAt: undefined,
          errorMessage: undefined
        };

    if (!isAlreadyRunning) {
      await caseModel.updateCase(id, {
        finalComposeStatus: nextStatus
      } as any);

      runFinalComposeJob({
        caseId: id,
        contributionAnswers
      }).catch((error) => {
        console.error('Background final-compose failed:', error);
      });
    }

    res.status(202).json({
      caseId: id,
      started: !isAlreadyRunning,
      finalComposeStatus: nextStatus
    });
  } catch (error: any) {
    console.error('Error in final-compose:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string) || 'txt';

    if (format !== 'txt') {
      return res.status(400).json({ error: 'Only txt export is supported in this MVP.' });
    }

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const finalDraft = anyCase.finalDraft;
    if (!finalDraft || !finalDraft.fullTextBySection) {
      return res.status(400).json({ error: 'Final draft not found. Run final-compose first.' });
    }

    const sectionOrder: CareSection[] = [
      CareSection.TITLE,
      CareSection.ABSTRACT,
      CareSection.INTRODUCTION,
      CareSection.PATIENT_INFORMATION,
      CareSection.CLINICAL_FINDINGS,
      CareSection.TIMELINE,
      CareSection.DIAGNOSTIC_ASSESSMENT,
      CareSection.THERAPEUTIC_INTERVENTIONS,
      CareSection.FOLLOW_UP_OUTCOMES,
      CareSection.DISCUSSION_CONCLUSION,
      CareSection.PATIENT_PERSPECTIVE,
      CareSection.INFORMED_CONSENT
    ];

    const lines: string[] = [];
    for (const section of sectionOrder) {
      const text = finalDraft.fullTextBySection[section] || '';
      if (!text) continue;
      lines.push(`# ${section}`);
      lines.push(text);
      lines.push('');
    }

    const body = lines.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="case_${id}.txt"`);
    res.send(body);
  } catch (error: any) {
    console.error('Error exporting case:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
