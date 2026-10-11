import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import {
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
  deidentifyOutboundField,
  deidentifyQnaForOutbound,
  deidentifyTimelineEventsForOutbound
} from '../deid/outbound';
import { summarizeError } from '../utils/errorSummary';
import { normalizeQuestionComparisonKey, normalizeQuestionText } from '../questions/questionTemplates';
import { runSectionAdequacyReview, runSectionDraftUpdate } from '../llm/chains';
import { getRelevantEvidence } from '../llm/evidenceScope';
import { buildQuestionStateCacheEntries, refreshQuestionState } from '../questions/questionState';

const router = express.Router();
const caseModel = new CaseModel();
const ALL_CARE_SECTIONS = Object.values(CareSection) as CareSection[];

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
      [
        card.id || '',
        card.normalizedText || card.sourceText || '',
        JSON.stringify(card.tags || []),
        JSON.stringify(card.sectionHints || [])
      ].join('|')
    ),
    '::history::',
    ...((params.qnaHistory || []).map((item) => `${item.question || ''}|${item.answer || ''}`))
  ]);
}

/** 같은 섹션 검토가 동시에 두 번 돌지 않게, 진행 중인 검토를 (케이스, 섹션, 입력 해시)로 공유한다. */
const inFlightReviews = new Map<string, Promise<any>>();

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
  const chainKey = `REVIEW:${params.sectionId}`;
  if (existing && existing.reviewInputHash === inputHash && hasChainCacheHit(params.caseData, chainKey, inputHash)) {
    await caseModel.recordChainRun(params.caseId, {
      cacheEntries: { [chainKey]: buildChainCacheEntry(inputHash, existing, chainKey) },
      performanceLogs: [
        buildPerformanceLog({
          chainName: chainKey,
          startedAt: new Date().toISOString(),
          inputHash,
          cacheHit: true,
          llmCallCount: 0
        })
      ]
    });
    return existing;
  }

  const flightKey = `${params.caseId}:${params.sectionId}:${inputHash}`;
  const pending = inFlightReviews.get(flightKey);
  if (pending) return pending;
  const job = runAdequacyReviewAndStore(params, inputHash);
  inFlightReviews.set(flightKey, job);
  try {
    return await job;
  } finally {
    inFlightReviews.delete(flightKey);
  }
}

async function runAdequacyReviewAndStore(params: Parameters<typeof ensureAdequacyReview>[0], inputHash: string) {
  const chainKey = `REVIEW:${params.sectionId}`;
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

  const cacheEntry = buildChainCacheEntry(inputHash, snapshot, chainKey);
  await caseModel.recordChainRun(params.caseId, {
    sectionAdequacyReviews: { [params.sectionId]: snapshot },
    cacheEntries: { [chainKey]: cacheEntry },
    performanceLogs: [
      buildPerformanceLog({
        chainName: chainKey,
        startedAt,
        inputHash,
        cacheHit: false,
        llmCallCount: 1,
        tokenUsage: reviewUsage
      })
    ]
  });
  await caseModel.updateCase(params.caseId, {
    chainProgress: buildChainProgress(undefined, [chainKey], [])
  } as any);

  params.caseData.sectionAdequacyReviews = {
    ...(params.caseData.sectionAdequacyReviews || {}),
    [params.sectionId]: snapshot
  };
  params.caseData.chainCache = {
    ...(params.caseData.chainCache || {}),
    [chainKey]: cacheEntry
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
      subtitle: '이 섹션에 남은 AI 질문이 없습니다.',
      emptyMessage: '이 섹션에 더 답할 질문이 없습니다.',
      hideStartButton: true
    };
  }

  if (hasDraft && !hasQnaHistory && !hasSectionQuestions && !hasSectionMissingInfo) {
    return {
      stage: 'draft_created',
      subtitle: '초안이 작성되어 있고, 지금은 이 섹션의 추가 AI 질문이 없습니다.',
      emptyMessage: '지금은 이 섹션의 추가 질문이 없습니다.',
      hideStartButton: true
    };
  }

  if (hasSectionQuestions || hasSectionMissingInfo) {
    return {
      stage: 'questions_available',
      subtitle: '이 섹션을 보완할 AI 질문이 있습니다.',
      emptyMessage: '지금은 이 섹션의 추가 질문이 없습니다.',
      hideStartButton: false
    };
  }

  return {
    stage: hasDraft ? 'draft_created' : 'empty',
    subtitle: hasDraft
      ? '현재 초안을 확인하고, 추가 AI 질문이 나오면 답해 주세요.'
      : '아직 이 섹션의 초안을 쓸 만한 기록 근거가 없습니다.',
    emptyMessage: hasDraft
      ? '지금은 이 섹션의 추가 질문이 없습니다.'
      : '지금은 이 섹션의 질문이 없습니다.',
    hideStartButton: hasDraft
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
    const relevantEvidence = getRelevantEvidence(evidenceCards, section);
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
    // 연구자 다시 보기(읽기 전용)에서는 저장된 검토만 보여 주고, 캐시·성능 로그 갱신이나
    // LLM 호출처럼 참가자 문서를 바꾸는 일은 하지 않는다.
    // 실험용 Scaffold(studyMode) 케이스도 마찬가지다: 실험 화면은 적정성 검토를 쓰지 않는데,
    // 공개 뒤 첫 조회에서 캐시 해시가 맞지 않아 LLM 검토가 새로 돌면서(수 초 지연, 세션 중 LLM 호출,
    // 참가자별로 다른 산출물) 고정 자료 원칙이 깨진다. 고정 결과에 든 검토만 돌려준다.
    const readOnlyView = req.get('X-Read-Only-View') === '1';
    const studyScaffoldCase = Boolean(anyCase?.studyConfig?.studyMode) && (anyCase?.mode || 'write') === 'scaffold';
    const adequacyReview = preRevealStudySection
      ? emptyAdequacyReview(section)
      : readOnlyView || studyScaffoldCase
        ? getStoredAdequacyReview(anyCase, section) || emptyAdequacyReview(section)
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
    const relevantEvidence = getRelevantEvidence(evidenceCards, section);
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
    const relevantEvidence = getRelevantEvidence(evidenceCards, section);
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
        insufficiencyReason: nextQuestion ? null : '이 섹션에 남은 AI 질문이 없습니다.',
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
    const globalState = await refreshQuestionState({
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
    // 캐시 적중 시 새 배열이 돌아온다. 저장은 돌아온 상태로 한다.
    sectionStates = globalState.sectionStates;

    // CHAIN6 캐시 항목은 남기지 않는다(읽는 곳이 없었다. 갱신된 초안은 sectionDrafts 에, 실행 기록은 성능 로그에 있다).
    // CHAIN4/5 캐시와 로그는 원자적으로 병합해 동시에 돈 다른 요청의 항목을 지우지 않는다.
    await caseModel.recordChainRun(id, {
      cacheEntries: buildQuestionStateCacheEntries(globalState),
      performanceLogs: [
        buildPerformanceLog({
          chainName: 'CHAIN6',
          startedAt: chain6StartedAt,
          inputHash: chain6InputHash,
          cacheHit: false,
          llmCallCount: 1,
          tokenUsage: chain6Usage
        }),
        buildPerformanceLog({
          chainName: 'CHAIN4',
          startedAt: globalState.cacheMeta.startedAt || new Date().toISOString(),
          inputHash: globalState.cacheMeta.chain4InputHash,
          cacheHit: globalState.cacheMeta.chain4CacheHit,
          llmCallCount: globalState.cacheMeta.chain4CacheHit ? 0 : 1,
          tokenUsage: chain4Usage
        }),
        buildPerformanceLog({
          chainName: 'CHAIN5',
          startedAt: globalState.cacheMeta.startedAt || new Date().toISOString(),
          inputHash: globalState.cacheMeta.chain5InputHash,
          cacheHit: globalState.cacheMeta.chain5CacheHit,
          llmCallCount: globalState.cacheMeta.chain5CacheHit ? 0 : 1,
          tokenUsage: chain5Usage
        })
      ]
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
