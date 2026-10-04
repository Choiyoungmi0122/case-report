import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import {
  appendPerformanceLog,
  buildChainCacheEntry,
  buildChainProgress,
  buildPerformanceLog,
  hasChainCacheHit,
  hashJoinedParts,
  hashValue
} from '../optimization/chainRuntime';
import { applyDraftUpdateResultToEntry, buildStaleState } from './cases';
import { integrateImportedTimelineIntoDrafts } from '../timelineImport/integration';
import {
  createOutboundDeidContext,
  deidentifyDraftsForOutbound,
  deidentifyOutboundField,
  deidentifyQnaForOutbound,
  deidentifyTimelineEventsForOutbound
} from '../deid/outbound';
import { summarizeError } from '../utils/errorSummary';
import { normalizeQuestionComparisonKey, normalizeQuestionText } from '../questions/questionTemplates';
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

function deriveDraftMapFromSectionDrafts(
  sectionDrafts: any[],
  existingDraftsBySection?: Record<string, string>
): Record<string, string> {
  return (sectionDrafts || []).reduce((acc: Record<string, string>, draft: any) => {
    if (draft && typeof draft.sectionId === 'string') {
      acc[draft.sectionId] = draft.draftText || '';
    }
    return acc;
  }, { ...(existingDraftsBySection || {}) });
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function normalizeQuestionKey(text: string): string {
  return normalizeQuestionComparisonKey(text);
}

function tokenizeQuestion(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'\-]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isSameQuestion(a: string, b: string): boolean {
  const keyA = normalizeQuestionKey(a);
  const keyB = normalizeQuestionKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = keyA.length > keyB.length ? keyA : keyB;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const tokensA = new Set(tokenizeQuestion(a));
  const tokensB = new Set(tokenizeQuestion(b));
  const overlap = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  const jaccard = overlap / Math.max(tokensA.size + tokensB.size - overlap, 1);
  return jaccard >= 0.72;
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildSectionCaseSummary(caseData: any) {
  return {
    id: caseData.id,
    experiment_code: caseData.experiment_code,
    experimentCode: caseData.experiment_code,
    createdAt: caseData.createdAt,
    mode: caseData.mode || 'write',
    title: caseData.title || undefined,
    visits: [],
    pendingTermConfirmations: caseData.pendingTermConfirmations || [],
    reviewRequired: caseData.reviewRequired || null,
    staleState: caseData.staleState || null,
    chainProgress: caseData.chainProgress || null,
    chainPerformanceLogs: caseData.chainPerformanceLogs || [],
    finalComposeStatus:
      caseData.finalComposeStatus || {
        status: caseData.finalDraft ? 'COMPLETED' : 'IDLE'
      },
    finalDraft: caseData.finalDraft || null,
    sectionStates: caseData.sectionStates || [],
    commonQuestionSets: caseData.commonQuestionSets || [],
    commonMissingItems: caseData.commonMissingItems || [],
    scaffoldState: caseData.scaffoldState || null
  };
}

function getRevealedDraftSectionIds(caseData: any) {
  return new Set(
    ((caseData?.scaffoldState?.sectionProgress || []) as any[])
      .filter((item) => item?.draftRevealed)
      .map((item) => item.sectionId)
  );
}

function buildVisibleDraftMap(caseData: any) {
  const allDrafts = deriveDraftMapFromSectionDrafts(caseData.sectionDrafts || [], caseData.draftsBySection || {});
  if ((caseData?.mode || 'write') !== 'scaffold') {
    return allDrafts;
  }

  const revealedSections = getRevealedDraftSectionIds(caseData);
  return Object.fromEntries(
    Object.entries(allDrafts).filter(([sectionId]) => revealedSections.has(sectionId as CareSection))
  );
}

function isDraftVisible(caseData: any, sectionId: CareSection) {
  if ((caseData?.mode || 'write') !== 'scaffold') {
    return true;
  }
  return getRevealedDraftSectionIds(caseData).has(sectionId);
}

function isStudyScaffoldSectionUnrevealed(caseData: any, sectionId: CareSection) {
  return Boolean(caseData?.studyConfig?.studyMode) && !isDraftVisible(caseData, sectionId);
}

export function sanitizeSectionResponse<T extends Record<string, any>>(caseData: any, sectionId: CareSection, payload: T): T {
  if ((caseData?.mode || 'write') !== 'scaffold') {
    return payload;
  }

  const visibleDraftsBySection = buildVisibleDraftMap(caseData);
  const rawPayload = payload as Record<string, any>;
  const nextPayload: T = {
    ...payload,
    draftsBySection: rawPayload.draftsBySection !== undefined ? visibleDraftsBySection : rawPayload.draftsBySection,
    updatedDraftsBySection:
      rawPayload.updatedDraftsBySection !== undefined ? visibleDraftsBySection : rawPayload.updatedDraftsBySection
  };

  if (!isDraftVisible(caseData, sectionId)) {
    if (rawPayload.currentDraft !== undefined) {
      (nextPayload as Record<string, any>).currentDraft = '';
    }
    if (rawPayload.updatedDraftText !== undefined) {
      (nextPayload as Record<string, any>).updatedDraftText = '';
    }

    if (caseData?.studyConfig?.studyMode) {
      const hiddenPayload = nextPayload as Record<string, any>;
      hiddenPayload.status = 'INCOMPLETE';
      hiddenPayload.rationaleText = '';
      hiddenPayload.missingInfoBullets = [];
      hiddenPayload.recommendedQuestions = [];
      hiddenPayload.sectionMissingInfo = [];
      hiddenPayload.commonMissingInfo = [];
      hiddenPayload.sectionQuestions = [];
      hiddenPayload.commonQuestions = [];
      hiddenPayload.commonQnaHistory = [];
      hiddenPayload.qnaHistory = [];
      hiddenPayload.adequacyReview = undefined;
      hiddenPayload.uiHints = {
        stage: 'empty',
        subtitle: '',
        emptyMessage: '',
        hideStartButton: true
      };
      if (hiddenPayload.caseSummary) {
        hiddenPayload.caseSummary = {
          ...hiddenPayload.caseSummary,
          finalDraft: null,
          chainPerformanceLogs: [],
          sectionStates: (hiddenPayload.caseSummary.sectionStates || []).map((state: any) => ({
            sectionId: state.sectionId,
            status: 'INCOMPLETE',
            rationaleText: '',
            missingInfoBullets: [],
            recommendedQuestions: []
          })),
          commonQuestionSets: [],
          commonMissingItems: []
        };
      }
    }
  }

  return nextPayload;
}

function pushAnswerUndoEntry(existing: any[], entry: any) {
  return [...(existing || []), entry].slice(-20);
}

function buildReviewInputHash(params: {
  sectionId: CareSection;
  currentDraft: string;
  evidenceCards: any[];
  qnaHistory: QnAPair[];
}) {
  return hashJoinedParts([
    params.sectionId,
    params.currentDraft || '',
    '::evidence::',
    ...(params.evidenceCards || []).map((card) =>
      [card.id || '', card.normalizedText || card.sourceText || '', JSON.stringify(card.tags || [])].join('|')
    ),
    '::history::',
    ...((params.qnaHistory || []).map((item) => `${item.question || ''}|${item.answer || ''}`))
  ]);
}

function getQuestionScopeEvidence(sectionDrafts: any[], evidenceCards: any[]) {
  const relevantSections = new Set(
    (sectionDrafts || [])
      .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
      .map((draft) => draft.sectionId)
  );

  return (evidenceCards || []).filter((card) =>
    (card.tags || []).some((tag: string) => relevantSections.has(tag))
  );
}

function buildQuestionStateInputHash(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
}) {
  const scopedEvidence = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);
  return hashJoinedParts([
    params.caseTitle || '',
    '::drafts::',
    ...(params.sectionDrafts || [])
      .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
      .map((draft) =>
        [
          draft.sectionId || '',
          draft.draftText || '',
          JSON.stringify(draft.openIssues || []),
          JSON.stringify(draft.timelineEventIdsUsed || [])
        ].join('|')
      ),
    '::states::',
    ...(params.sectionStates || [])
      .filter((state) => COMMON_QUESTION_SECTIONS.includes(state.sectionId))
      .map((state) => [state.sectionId || '', state.status || '', state.rationaleText || ''].join('|')),
    '::evidence::',
    ...scopedEvidence.map((card) =>
      [card.id || '', card.normalizedText || card.sourceText || '', JSON.stringify(card.tags || [])].join('|')
    )
  ]);
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
  const inputHash = buildReviewInputHash(params);
  const existing = !params.forceRefresh ? getStoredAdequacyReview(params.caseData, params.sectionId) : null;
  if (
    existing &&
    existing.reviewInputHash === inputHash &&
    hasChainCacheHit(params.caseData, `REVIEW:${params.sectionId}`, inputHash)
  ) {
    await caseModel.updateCase(params.caseId, {
      chainCache: {
        ...(params.caseData.chainCache || {}),
        [`REVIEW:${params.sectionId}`]: buildChainCacheEntry(inputHash, existing)
      },
      chainPerformanceLogs: appendPerformanceLog(
        params.caseData.chainPerformanceLogs || [],
        buildPerformanceLog({
          chainName: `REVIEW:${params.sectionId}`,
          startedAt: new Date().toISOString(),
          inputHash,
          cacheHit: true,
          llmCallCount: 0
        })
      )
    } as any);
    return existing;
  }

  const startedAt = new Date().toISOString();
  let reviewUsage: any = null;
  await caseModel.updateCase(params.caseId, {
    chainProgress: buildChainProgress(`REVIEW:${params.sectionId}`, [], [])
  } as any);
  // Review AI receives user-originated text (answers, and drafts that may carry
  // manually edited front matter), so it goes through the same boundary.
  const reviewOutboundContext = createOutboundDeidContext();
  const review = await runSectionAdequacyReview({
    sectionId: params.sectionId,
    currentDraft: await deidentifyOutboundField(params.currentDraft, reviewOutboundContext),
    evidenceCards: params.evidenceCards,
    qnaHistory: await deidentifyQnaForOutbound(params.qnaHistory, reviewOutboundContext)
  }, {
    onUsage: (usage) => {
      reviewUsage = usage;
    }
  });

  const snapshot = {
    ...review,
    reviewedAt: new Date().toISOString(),
    reviewInputHash: inputHash
  };

  await caseModel.updateCase(params.caseId, {
    sectionAdequacyReviews: {
      ...(params.caseData.sectionAdequacyReviews || {}),
      [params.sectionId]: snapshot
    },
    chainCache: {
      ...(params.caseData.chainCache || {}),
      [`REVIEW:${params.sectionId}`]: buildChainCacheEntry(inputHash, snapshot)
    },
    chainPerformanceLogs: appendPerformanceLog(
      params.caseData.chainPerformanceLogs || [],
      buildPerformanceLog({
        chainName: `REVIEW:${params.sectionId}`,
        startedAt,
        inputHash,
        cacheHit: false,
        llmCallCount: 1,
        tokenUsage: reviewUsage
      })
    ),
    chainProgress: buildChainProgress(undefined, [`REVIEW:${params.sectionId}`], [])
  } as any);

  params.caseData.sectionAdequacyReviews = {
    ...(params.caseData.sectionAdequacyReviews || {}),
    [params.sectionId]: snapshot
  };
  params.caseData.chainCache = {
    ...(params.caseData.chainCache || {}),
    [`REVIEW:${params.sectionId}`]: buildChainCacheEntry(inputHash, snapshot)
  };

  return snapshot;
}

/**
 * Adequacy review enriches a section but is not required to render it. When the
 * reviewer output cannot be parsed (the model occasionally answers with a status
 * outside the schema for sections the record cannot support), reading the
 * section must still succeed instead of returning 500 and leaving the section
 * unreachable. The explicit "전체 확인" action still surfaces the error.
 */
function emptyAdequacyReview(sectionId: CareSection) {
  return {
    sectionId,
    adequacyStatus: 'INSUFFICIENT' as const,
    sectionCompleteness: 'LOW' as const,
    contentCompleteness: 'LOW' as const,
    naturalness: 'LOW' as const,
    evidenceGrounding: 'UNSUPPORTED_OR_UNVERIFIABLE' as const,
    summary: '',
    missingRequiredItems: [] as string[],
    depthIssues: [] as string[],
    shouldAskMore: false,
    questionFocus: '',
    reviewUnavailable: true
  };
}

async function ensureAdequacyReviewSafe(params: Parameters<typeof ensureAdequacyReview>[0]) {
  try {
    return await ensureAdequacyReview(params);
  } catch (error: any) {
    console.error(
      `[SECTION ${params.sectionId}] adequacy review unavailable, continuing without it - ${summarizeError(error)}`
    );
    const stored = getStoredAdequacyReview(params.caseData, params.sectionId);
    return stored || emptyAdequacyReview(params.sectionId);
  }
}

async function buildCommonQuestionPayload(params: {
  caseId: string;
  commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: string }>;
  commonMissingItems?: Array<{ item: string; relatedSectionIds: CareSection[] }>;
}) {
  const interactionResults = await caseModel.getInteractionsByKeys(params.caseId, [
    ...ALL_CARE_SECTIONS,
    '__COMMON__'
  ]);
  const answeredHistory = interactionResults.flatMap((interaction) => interaction?.qnaHistory || []);
  const commonInteraction =
    interactionResults.find((interaction) => interaction.sectionId === '__COMMON__') || null;
  const seenQuestions = new Set<string>();
  const commonQuestions = (params.commonQuestionSets || []).filter((entry) => {
    const question = String(entry?.question || '').trim();
    if (!question) return false;
    if (seenQuestions.has(question)) return false;
    if (answeredHistory.some((historyItem) => isSameQuestion(question, historyItem.question))) {
      return false;
    }
    seenQuestions.add(question);
    return true;
  });

  return {
    commonQuestions: commonQuestions.map((entry) => ({
      question: normalizeQuestionText(entry.question, entry.category),
      category: entry.category
    })).filter((entry) => entry.question),
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
  caseData?: any;
  onChain4Usage?: (usage: any) => void;
  onChain5Usage?: (usage: any) => void;
}) {
  const inputHash = buildQuestionStateInputHash(params);
  const canReuse =
    params.caseData &&
    hasChainCacheHit(params.caseData, 'CHAIN4', inputHash) &&
    hasChainCacheHit(params.caseData, 'CHAIN5', inputHash) &&
    Array.isArray(params.caseData.sectionStates) &&
    Array.isArray(params.caseData.commonQuestionSets);

  if (canReuse) {
    const stateBySection = new Map<string, any>(
      (params.caseData.sectionStates || []).map((state: any) => [state.sectionId, state])
    );
    const nextSectionStates = params.sectionStates.map((state) => {
      const stored = stateBySection.get(state.sectionId);
      if (!stored) return state;
      return {
        ...state,
        missingInfoBullets: stored.missingInfoBullets || [],
        recommendedQuestions: stored.recommendedQuestions || [],
        status: stored.status || state.status,
        rationaleText: stored.rationaleText || state.rationaleText
      };
    });

    return {
      commonMissingItems: params.caseData.commonMissingItems || [],
      commonQuestionSets: params.caseData.commonQuestionSets || [],
      sectionStates: nextSectionStates,
      cacheMeta: {
        chain4InputHash: inputHash,
        chain5InputHash: inputHash,
        chain4CacheHit: true,
        chain5CacheHit: true
      }
    };
  }

  const startedAt = new Date().toISOString();
  const commonQuestionDrafts = params.sectionDrafts.filter((draft) =>
    COMMON_QUESTION_SECTIONS.includes(draft.sectionId)
  );
  const scopedEvidenceCards = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);

  // User-authored title and front-matter drafts cross the boundary here.
  const outboundContext = createOutboundDeidContext();
  const outboundTitle = await deidentifyOutboundField(params.caseTitle, outboundContext);
  const outboundDrafts = await deidentifyDraftsForOutbound(commonQuestionDrafts, outboundContext);

  const missingResult = await runSectionMissingDetection({
    sectionDrafts: outboundDrafts,
    evidenceCards: scopedEvidenceCards,
    caseTitle: outboundTitle
  }, {
    onUsage: params.onChain4Usage
  });
  const questionResult = await runQuestionGeneration({
    sectionDrafts: outboundDrafts,
    sectionMissing: missingResult.sectionMissing,
    commonMissing: missingResult.commonMissing,
    caseTitle: outboundTitle
  }, {
    onUsage: params.onChain5Usage
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
        state.rationaleText = '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.';
      } else if (hasMissing) {
        state.status = 'INCOMPLETE';
        state.rationaleText = '초안은 있으나 보완이 필요한 정보가 남아 있습니다.';
      } else {
        state.status = 'READY';
        state.rationaleText = '현재 기록으로 이 항목의 초안을 작성할 수 있습니다.';
      }
    }
  }

  return {
    commonMissingItems: (missingResult.commonMissing || []).map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[],
      category: item.category
    })),
    commonQuestionSets: (questionResult.commonQuestions || []).map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[],
      category: item.category
    })),
    sectionStates: params.sectionStates,
    cacheMeta: {
      chain4InputHash: inputHash,
      chain5InputHash: inputHash,
      chain4CacheHit: false,
      chain5CacheHit: false,
      startedAt
    }
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
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: string }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state = sectionStates.find((item) => item.sectionId === section) || {
        sectionId: section,
      status: 'IMPOSSIBLE',
      rationaleText: '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.',
        missingInfoBullets: [],
        recommendedQuestions: []
      };
    const draftEntry = sectionDrafts.find((item) => item.sectionId === section) || {
        sectionId: section,
      draftText: '',
        evidenceCardIdsUsed: [],
      openIssues: [],
      evidenceLinks: [],
      unsupportedClaims: []
    };
    const relevantEvidence = evidenceCards.filter((card) => (card.tags || []).includes(section));
    const preRevealStudySection = isStudyScaffoldSectionUnrevealed(anyCase, section);
    const interaction = preRevealStudySection
      ? null
      : await caseModel.getSectionInteraction(id, section);
    const qnaHistory = interaction?.qnaHistory || [];

    const sectionQuestions = preRevealStudySection
      ? []
      : filterAnsweredQuestions(
          uniqueStrings((state.recommendedQuestions || []).map((item: string) => normalizeQuestionText(item)).filter(Boolean)),
          qnaHistory
        );
    // Page entry must not fail because the reviewer output was unparsable.
    const adequacyReview = preRevealStudySection
      ? emptyAdequacyReview(section)
      : await ensureAdequacyReviewSafe({
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
    const commonPayload = preRevealStudySection
      ? { commonQuestions: [], commonQnaHistory: [], commonMissingInfo: [] }
      : await buildCommonQuestionPayload({
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

    res.json(sanitizeSectionResponse(anyCase, section, {
      section: sectionId,
      status: state.status,
      rationaleText: adequacyReview.summary || state.rationaleText,
      missingInfoBullets: sectionMissingInfo,
      recommendedQuestions: effectiveSectionQuestions,
      draftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts, anyCase.draftsBySection || {}),
      sectionMissingInfo,
      commonMissingInfo: commonPayload.commonMissingInfo,
      sectionQuestions: effectiveSectionQuestions,
      commonQuestions: commonPayload.commonQuestions,
      commonQnaHistory: commonPayload.commonQnaHistory,
      currentDraft: draftEntry.draftText || '',
      timelineEvents: anyCase.timelineEvents || [],
      evidence: relevantEvidence.map((card) => card.normalizedText || ''),
      evidenceCards: relevantEvidence,
      qnaHistory,
      adequacyReview: {
        adequacyStatus: adequacyReview.adequacyStatus,
        sectionCompleteness: adequacyReview.sectionCompleteness,
        contentCompleteness: adequacyReview.contentCompleteness,
        naturalness: adequacyReview.naturalness,
        evidenceGrounding: adequacyReview.evidenceGrounding,
        summary: adequacyReview.summary,
        missingRequiredItems: adequacyReview.missingRequiredItems || [],
        depthIssues: adequacyReview.depthIssues || [],
        shouldAskMore: adequacyReview.shouldAskMore,
        questionFocus: adequacyReview.questionFocus,
        unsupportedClaims: draftEntry.unsupportedClaims || []
      },
      uiHints,
      canUndo: Boolean((anyCase.answerUndoStack || []).length),
      caseSummary: buildSectionCaseSummary(anyCase)
    }));
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
    if (isStudyScaffoldSectionUnrevealed(anyCase, section)) {
      return res.status(409).json({
        error: 'AI review is available only after the learner snapshot and draft reveal.'
      });
    }
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: string }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state = sectionStates.find((item) => item.sectionId === section) || {
      sectionId: section,
      status: 'IMPOSSIBLE',
      rationaleText: '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.',
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
    const sectionQuestions = filterAnsweredQuestions(
      uniqueStrings((state.recommendedQuestions || []).map((item: string) => normalizeQuestionText(item)).filter(Boolean)),
      qnaHistory
    );

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

    res.json(sanitizeSectionResponse(anyCase, section, {
      section: sectionId,
      status: state.status,
      rationaleText: adequacyReview.summary || state.rationaleText,
      missingInfoBullets: sectionMissingInfo,
      recommendedQuestions: effectiveSectionQuestions,
      draftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts, anyCase.draftsBySection || {}),
      sectionMissingInfo,
      commonMissingInfo: commonPayload.commonMissingInfo,
      sectionQuestions: effectiveSectionQuestions,
      commonQuestions: commonPayload.commonQuestions,
      commonQnaHistory: commonPayload.commonQnaHistory,
      currentDraft: draftEntry.draftText || '',
      timelineEvents: anyCase.timelineEvents || [],
      evidence: relevantEvidence.map((card) => card.normalizedText || ''),
      evidenceCards: relevantEvidence,
      qnaHistory,
      adequacyReview: {
        adequacyStatus: adequacyReview.adequacyStatus,
        sectionCompleteness: adequacyReview.sectionCompleteness,
        contentCompleteness: adequacyReview.contentCompleteness,
        naturalness: adequacyReview.naturalness,
        evidenceGrounding: adequacyReview.evidenceGrounding,
        summary: adequacyReview.summary,
        missingRequiredItems: adequacyReview.missingRequiredItems || [],
        depthIssues: adequacyReview.depthIssues || [],
        shouldAskMore: adequacyReview.shouldAskMore,
        questionFocus: adequacyReview.questionFocus,
        unsupportedClaims: draftEntry.unsupportedClaims || []
      },
      uiHints,
      canUndo: Boolean((anyCase.answerUndoStack || []).length),
      caseSummary: buildSectionCaseSummary(anyCase)
    }));
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
    if (isStudyScaffoldSectionUnrevealed(anyCase, section)) {
      return res.status(409).json({
        error: 'AI follow-up is available only after the learner snapshot and draft reveal.'
      });
    }
    let sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: string }> =
      anyCase.commonQuestionSets || [];
    const commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[] }> =
      anyCase.commonMissingItems || [];
    const state =
      sectionStates.find((item) => item.sectionId === section) ||
      (() => {
        const nextState = {
        sectionId: section,
          status: 'IMPOSSIBLE',
          rationaleText: '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.',
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
          openIssues: [],
          evidenceLinks: [],
          unsupportedClaims: []
        };
        sectionDrafts.push(nextDraft);
        return nextDraft;
      })();
    const relevantEvidence = evidenceCards.filter((card) => (card.tags || []).includes(section));
    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory: QnAPair[] = interaction?.qnaHistory || [];

    const sectionQuestions = filterAnsweredQuestions(
      uniqueStrings((state.recommendedQuestions || []).map((item: string) => normalizeQuestionText(item)).filter(Boolean)),
      qnaHistory
    );
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

      return res.json(sanitizeSectionResponse(anyCase, section, {
        nextQuestion,
        whyThisQuestion: nextQuestion ? 'This is the next AI-generated question for this section.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: state.missingInfoBullets || [],
        updatedDraftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts, anyCase.draftsBySection || {}),
        sectionQuestions,
        commonQuestions: commonPayload.commonQuestions,
        sectionMissingInfo,
        commonMissingInfo: commonPayload.commonMissingInfo,
        commonQnaHistory: commonPayload.commonQnaHistory,
        insufficiencyReason: nextQuestion ? null : 'No additional section-specific AI questions remain.',
        qnaHistory,
        uiHints
      }));
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

    const chain6InputHash = hashValue({
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence.map((card) => ({
        id: card.id,
        normalizedText: card.normalizedText || card.sourceText || ''
      })),
      qnaHistory,
      pendingItems: draftEntry.openIssues?.length ? draftEntry.openIssues : state.missingInfoBullets || [],
      question: latestQuestion,
      answer: userAnswer
    });
    const chain6StartedAt = new Date().toISOString();
    let chain6Usage: any = null;

    // The raw answer stays in the database (existing retention policy is
    // unchanged); only a de-identified copy is sent to the external model.
    const outboundContext = createOutboundDeidContext();
    const outboundAnswer = await deidentifyOutboundField(userAnswer, outboundContext);
    const outboundQuestion = await deidentifyOutboundField(latestQuestion, outboundContext);
    const outboundQnaHistory = await deidentifyQnaForOutbound(qnaHistory, outboundContext);

    const updateResult = await runSectionDraftUpdate({
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory: outboundQnaHistory,
      pendingItems: draftEntry.openIssues?.length ? draftEntry.openIssues : state.missingInfoBullets || [],
      question: outboundQuestion,
      answer: outboundAnswer
    }, {
      onUsage: (usage) => {
        chain6Usage = usage;
      }
    });

    applyDraftUpdateResultToEntry(draftEntry, updateResult);

    if (section === CareSection.TIMELINE && (anyCase.timelineEvents || []).length > 0) {
      // sectionDrafts is mutated in place, but sectionStates may come back as a new array when a
      // TIMELINE state had to be appended - take the returned value so that state is not dropped.
      // Timeline rows are raw spreadsheet text, so de-identify before they enter a draft.
      const integrated = integrateImportedTimelineIntoDrafts({
        sectionDrafts,
        sectionStates,
        timelineEvents: await deidentifyTimelineEventsForOutbound(anyCase.timelineEvents || [])
      });
      sectionStates = integrated.sectionStates;
    }

    let chain4Usage: any = null;
    let chain5Usage: any = null;
    const globalState = await refreshGlobalQuestionState({
      sectionDrafts,
      sectionStates,
      evidenceCards,
      caseTitle: case_.title,
      caseData: anyCase,
      onChain4Usage: (usage) => {
        chain4Usage = usage;
      },
      onChain5Usage: (usage) => {
        chain5Usage = usage;
      }
    });

    await caseModel.updateCase(id, {
      sectionDrafts,
      sectionStates,
      draftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts, anyCase.draftsBySection || {}),
      commonMissingItems: globalState.commonMissingItems,
      commonQuestionSets: globalState.commonQuestionSets,
      answerUndoStack: pushAnswerUndoEntry(anyCase.answerUndoStack || [], undoEntry),
      sectionAdequacyReviews: {},
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      staleState: buildStaleState('ANSWER_UPDATED'),
      chainCache: {
        ...(anyCase.chainCache || {}),
        CHAIN6: buildChainCacheEntry(chain6InputHash, {
          sectionId: section,
          updatedDraftText: draftEntry.draftText || '',
          evidenceLinks: draftEntry.evidenceLinks || [],
          unsupportedClaims: draftEntry.unsupportedClaims || []
        }),
        CHAIN4: buildChainCacheEntry(globalState.cacheMeta.chain4InputHash, {
          commonMissingItems: globalState.commonMissingItems,
          sectionMissingBySection: sectionStates.map((item) => ({
            sectionId: item.sectionId,
            missingInfoBullets: item.missingInfoBullets || []
          }))
        }),
        CHAIN5: buildChainCacheEntry(globalState.cacheMeta.chain5InputHash, {
          commonQuestionSets: globalState.commonQuestionSets,
          sectionQuestionsBySection: sectionStates.map((item) => ({
            sectionId: item.sectionId,
            recommendedQuestions: item.recommendedQuestions || []
          }))
        })
      },
      chainPerformanceLogs: appendPerformanceLog(
        appendPerformanceLog(
          appendPerformanceLog(
            anyCase.chainPerformanceLogs || [],
            buildPerformanceLog({
              chainName: 'CHAIN6',
              startedAt: chain6StartedAt,
              inputHash: chain6InputHash,
              cacheHit: false,
              llmCallCount: 1,
              tokenUsage: chain6Usage
            })
          ),
          buildPerformanceLog({
            chainName: 'CHAIN4',
            startedAt: globalState.cacheMeta.startedAt || new Date().toISOString(),
            inputHash: globalState.cacheMeta.chain4InputHash,
            cacheHit: globalState.cacheMeta.chain4CacheHit,
            llmCallCount: globalState.cacheMeta.chain4CacheHit ? 0 : 1,
            tokenUsage: chain4Usage
          })
        ),
        buildPerformanceLog({
          chainName: 'CHAIN5',
          startedAt: globalState.cacheMeta.startedAt || new Date().toISOString(),
          inputHash: globalState.cacheMeta.chain5InputHash,
          cacheHit: globalState.cacheMeta.chain5CacheHit,
          llmCallCount: globalState.cacheMeta.chain5CacheHit ? 0 : 1,
          tokenUsage: chain5Usage
        })
      ),
      chainProgress: buildChainProgress(undefined, ['CHAIN6', 'CHAIN4', 'CHAIN5'], [])
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

    return res.json(sanitizeSectionResponse(anyCase, section, {
      nextQuestion: finalNextQuestion,
      whyThisQuestion: finalNextQuestion ? 'This is the next AI-generated question for this section.' : '',
      updatedDraftText: draftEntry.draftText || '',
      updatedDraftsBySection: deriveDraftMapFromSectionDrafts(sectionDrafts, anyCase.draftsBySection || {}),
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
    }));
  } catch (error: any) {
    console.error(`[SECTION NEXT] failed - ${summarizeError(error)}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
