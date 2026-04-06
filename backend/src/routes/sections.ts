import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import { runFastSectionDraftUpdate, runLegacySectionDraftUpdate } from '../llm/chains';
import {
  splitSectionAndCommonItems,
  buildQuestionFromMissing,
  CARE_TO_AI_FIELD,
  toNaturalKoreanQuestion
} from './utils/aiSectionMapping';

const router = express.Router();
const caseModel = new CaseModel();
const FAST_UPDATE_ONLY = process.env.FAST_UPDATE_ONLY !== 'false';
const REFRESH_QUESTIONS_ON_DEMAND = process.env.REFRESH_QUESTIONS_ON_DEMAND !== 'false';
const ALL_CARE_SECTIONS = Object.values(CareSection) as CareSection[];
const AI_TO_CARE_SECTION: Record<string, CareSection> = {
  patient_information: CareSection.PATIENT_INFORMATION,
  clinical_findings: CareSection.CLINICAL_FINDINGS,
  timeline: CareSection.TIMELINE,
  diagnostic_assessment: CareSection.DIAGNOSTIC_ASSESSMENT,
  therapeutic_intervention: CareSection.THERAPEUTIC_INTERVENTIONS,
  follow_up_outcomes: CareSection.FOLLOW_UP_OUTCOMES,
  patient_perspective: CareSection.PATIENT_PERSPECTIVE
};

type SectionUiHints = {
  stage: 'empty' | 'draft_created' | 'questions_available' | 'refined_no_questions';
  subtitle: string;
  emptyMessage: string;
  hideStartButton: boolean;
};

function isCareSection(value: string): value is CareSection {
  return ALL_CARE_SECTIONS.includes(value as CareSection);
}

function getFallbackDraftFromAiPipeline(caseData: any, section: CareSection): string {
  const finalSections = caseData?.aiPipeline?.chain7?.final_sections || {};
  for (const [aiKey, careSection] of Object.entries(AI_TO_CARE_SECTION)) {
    if (careSection !== section) continue;
    const value = finalSections[aiKey];
    return typeof value === 'string' ? value : '';
  }
  return '';
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
  return Array.from(new Set((items || []).filter(Boolean)));
}

function buildSectionUiHints(params: {
  currentDraft: string;
  qnaHistory: QnAPair[];
  sectionQuestions: string[];
  sectionMissingInfo: string[];
}): SectionUiHints {
  const hasDraft = Boolean(String(params.currentDraft || '').trim());
  const hasQnaHistory = (params.qnaHistory || []).length > 0;
  const hasSectionQuestions = (params.sectionQuestions || []).length > 0;
  const hasSectionMissingInfo = (params.sectionMissingInfo || []).length > 0;

  if (hasDraft && hasQnaHistory && !hasSectionQuestions && !hasSectionMissingInfo) {
    return {
      stage: 'refined_no_questions',
      subtitle: '현재까지 반영된 답변 기준으로 추가 질문은 없습니다. 가운데 초안을 검토하고 필요 시 다시 보완하세요.',
      emptyMessage: '현재까지 반영된 답변 기준으로 이 섹션에서 추가로 확인할 질문은 없습니다.',
      hideStartButton: true
    };
  }

  if (hasDraft && !hasQnaHistory && !hasSectionQuestions && !hasSectionMissingInfo) {
    return {
      stage: 'draft_created',
      subtitle: '기본 초안이 생성되었습니다. 현재 제안할 세부 질문은 없지만, 보완 가능한 정보가 없는지 초안을 검토해 주세요.',
      emptyMessage: '기본 초안이 생성되었습니다. 현재 바로 제안할 세부 질문은 없습니다. 가운데 초안을 검토하고 필요 시 보완하세요.',
      hideStartButton: true
    };
  }

  if (hasSectionQuestions || hasSectionMissingInfo) {
    return {
      stage: 'questions_available',
      subtitle: '현재 섹션 초안을 정교하게 만드는 질문 및 답변',
      emptyMessage: '현재 이 섹션에서 추가로 확인할 세부 질문이 없습니다.',
      hideStartButton: false
    };
  }

  return {
    stage: hasDraft ? 'draft_created' : 'empty',
    subtitle: hasDraft
      ? '기본 초안이 생성되었습니다. 현재 제안할 세부 질문은 없지만, 보완 가능한 정보가 없는지 초안을 검토해 주세요.'
      : '현재 섹션 초안을 정교하게 만드는 질문 및 답변',
    emptyMessage: hasDraft
      ? '기본 초안이 생성되었습니다. 현재 바로 제안할 세부 질문은 없습니다. 가운데 초안을 검토하고 필요 시 보완하세요.'
      : '현재 이 섹션에서 추가로 확인할 세부 질문이 없습니다.',
    hideStartButton: hasDraft
  };
}

function normalizeQuestionKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/^다음 정보를 알려주세요:\s*/i, '')
    .replace(/^다음 항목을 보완할 수 있는 정보를 알려주세요:\s*/i, '')
    .replace(/[?？!！.,:;()[\]{}"'\s-]/g, '');
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

function getOptionalNextQuestion(result: { nextQuestion?: unknown }): string | null {
  return typeof result.nextQuestion === 'string' && result.nextQuestion.trim()
    ? result.nextQuestion
    : null;
}

async function runLocalSectionAnswerUpdate(params: {
  sectionId: CareSection;
  currentDraft: string;
  evidenceCards: any[];
  qnaHistory: QnAPair[];
  pendingItems: string[];
  latestAnswer: string;
}) {
  const compactEvidenceCards = (params.evidenceCards || []).slice(0, 8);
  const compactQnaHistory = (params.qnaHistory || []).slice(-3);
  const compactPendingItems = (params.pendingItems || []).slice(0, 6);

  if (FAST_UPDATE_ONLY) {
    return runFastSectionDraftUpdate({
      sectionId: params.sectionId,
      currentDraft: params.currentDraft,
      evidenceCards: compactEvidenceCards,
      qnaHistory: compactQnaHistory,
      pendingItems: compactPendingItems,
      latestAnswer: params.latestAnswer
    });
  }

  return runLegacySectionDraftUpdate({
    sectionId: params.sectionId,
    currentDraft: params.currentDraft,
    evidenceCards: compactEvidenceCards,
    qnaHistory: compactQnaHistory,
    pendingItems: compactPendingItems,
    latestAnswer: params.latestAnswer
  });
}

// GET /api/cases/:id/sections/:sectionId - Get section details (새 체인 기반)
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
    const useAiPipelineFallback = sectionStates.length === 0 && sectionDrafts.length === 0;

    let state = sectionStates.find((s) => s.sectionId === section);
    let draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    const interaction = await caseModel.getSectionInteraction(id, section);

    if (!state) {
      const fallbackDraft = useAiPipelineFallback ? getFallbackDraftFromAiPipeline(anyCase, section) : '';
      state = {
        sectionId: section,
        status: fallbackDraft.trim() ? 'FULLY_POSSIBLE' : 'IMPOSSIBLE',
        rationaleText: fallbackDraft.trim()
          ? 'AI 파이프라인 결과로 작성됨.'
          : '입력 데이터가 부족하여 해당 섹션 내용이 비어 있음.',
        missingInfoBullets: [],
        recommendedQuestions: []
      };
    }
    if (!draftEntry) {
      draftEntry = {
        sectionId: section,
        draftText: useAiPipelineFallback ? getFallbackDraftFromAiPipeline(anyCase, section) : '',
        evidenceCardIdsUsed: [],
        openIssues: []
      };
    }

    const baselineMissing =
      (state.missingInfoBullets && state.missingInfoBullets.length > 0
        ? state.missingInfoBullets
        : useAiPipelineFallback
          ? anyCase?.aiPipeline?.chain4?.missing
          : []) || [];
    const baselineQuestions =
      (state.recommendedQuestions && state.recommendedQuestions.length > 0
        ? state.recommendedQuestions
        : useAiPipelineFallback
          ? anyCase?.aiPipeline?.chain5?.clarification_questions
          : []) || [];

    const qnaHistory = interaction?.qnaHistory || [];
    const missingSplit = splitSectionAndCommonItems(baselineMissing, section);
    const questionSplit = splitSectionAndCommonItems(baselineQuestions, section);
    const sectionQuestions = filterAnsweredQuestions(
      uniqueStrings(questionSplit.sectionItems.map(toNaturalKoreanQuestion)),
      qnaHistory
    );
    const commonQuestions = filterAnsweredQuestions(
      uniqueStrings(questionSplit.commonItems.map(toNaturalKoreanQuestion)),
      qnaHistory
    );
    const sectionMissingInfo = uniqueStrings(missingSplit.sectionItems);
    const commonMissingInfo = uniqueStrings(missingSplit.commonItems);
    const uiHints = buildSectionUiHints({
      currentDraft: draftEntry?.draftText || '',
      qnaHistory,
      sectionQuestions,
      sectionMissingInfo
    });

    res.json({
      section: sectionId,
      status: state.status,
      rationaleText: state.rationaleText,
      missingInfoBullets: uniqueStrings([
        ...missingSplit.sectionItems,
        ...missingSplit.commonItems
      ]),
      recommendedQuestions: uniqueStrings([...sectionQuestions, ...commonQuestions]),
      sectionMissingInfo,
      commonMissingInfo,
      sectionQuestions: sectionQuestions,
      commonQuestions: commonQuestions,
      currentDraft: draftEntry?.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory,
      uiHints
    });
  } catch (error: any) {
    console.error('Error getting section:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases/:id/sections/:sectionId/next - Q&A 한 스텝 진행 (Chain 4)
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
    const useAiPipelineFallback = sectionStates.length === 0 && sectionDrafts.length === 0;

    let state = sectionStates.find((s) => s.sectionId === section);
    let draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    if (!state) {
      const fallbackDraft = useAiPipelineFallback ? getFallbackDraftFromAiPipeline(anyCase, section) : '';
      state = {
        sectionId: section,
        status: fallbackDraft.trim() ? 'FULLY_POSSIBLE' : 'IMPOSSIBLE',
        rationaleText: fallbackDraft.trim()
          ? 'AI 파이프라인 결과로 작성됨.'
          : '입력 데이터가 부족하여 해당 섹션 내용이 비어 있음.',
        missingInfoBullets: [],
        recommendedQuestions: []
      };
      sectionStates.push(state);
    }

    if (!draftEntry) {
      draftEntry = {
        sectionId: section,
        draftText: useAiPipelineFallback ? getFallbackDraftFromAiPipeline(anyCase, section) : '',
        evidenceCardIdsUsed: [],
        openIssues: state.missingInfoBullets || []
      };
      sectionDrafts.push(draftEntry);
    }

    const pendingItems: string[] = draftEntry.openIssues || state.missingInfoBullets || [];

    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory: QnAPair[] = interaction?.qnaHistory || [];

    const aiField = CARE_TO_AI_FIELD[section];

    if (!aiField) {
      const pendingSplit = splitSectionAndCommonItems(pendingItems, section);
      const sectionQuestions = filterAnsweredQuestions(
        uniqueStrings(pendingSplit.sectionItems.map((item) =>
          toNaturalKoreanQuestion(buildQuestionFromMissing(item))
        )),
        qnaHistory
      );
      const commonQuestions = filterAnsweredQuestions(
        uniqueStrings(pendingSplit.commonItems.map((item) =>
          toNaturalKoreanQuestion(buildQuestionFromMissing(item))
        )),
        qnaHistory
      );
      const nextQuestion = sectionQuestions[0] || commonQuestions[0] || null;
      const sectionMissingInfo = uniqueStrings(pendingSplit.sectionItems);
      const commonMissingInfo = uniqueStrings(pendingSplit.commonItems);
      const uiHints = buildSectionUiHints({
        currentDraft: draftEntry.draftText || '',
        qnaHistory,
        sectionQuestions,
        sectionMissingInfo
      });
      return res.json({
        nextQuestion,
        whyThisQuestion: nextQuestion ? '해당 섹션의 부족 항목을 보완하기 위한 질문입니다.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: pendingItems,
        sectionQuestions,
        commonQuestions,
        sectionMissingInfo,
        commonMissingInfo,
        insufficiencyReason: nextQuestion ? null : '현재 섹션에는 즉시 반영 가능한 로컬 업데이트 질문만 제공됩니다.',
        qnaHistory,
        uiHints
      });
    }

    // 질문 시작 단계: 기존 계약 유지 (답변 없이 다음 질문만 반환)
    if (!userAnswer || userAnswer === 'SKIP') {
      const pendingSplit = splitSectionAndCommonItems(pendingItems, section);
      const questionSplit = splitSectionAndCommonItems(state.recommendedQuestions || [], section);
      const sectionQuestions = filterAnsweredQuestions(
        uniqueStrings([
          ...questionSplit.sectionItems.map(toNaturalKoreanQuestion),
          ...pendingSplit.sectionItems.map((item) => toNaturalKoreanQuestion(buildQuestionFromMissing(item)))
        ]),
        qnaHistory
      );
      const commonQuestions = filterAnsweredQuestions(
        uniqueStrings([
          ...questionSplit.commonItems.map(toNaturalKoreanQuestion),
          ...pendingSplit.commonItems.map((item) => toNaturalKoreanQuestion(buildQuestionFromMissing(item)))
        ]),
        qnaHistory
      );
      const nextQuestion = sectionQuestions[0] || commonQuestions[0] || null;
      const sectionMissingInfo = uniqueStrings(pendingSplit.sectionItems);
      const commonMissingInfo = uniqueStrings(pendingSplit.commonItems);
      const uiHints = buildSectionUiHints({
        currentDraft: draftEntry.draftText || '',
        qnaHistory,
        sectionQuestions,
        sectionMissingInfo
      });

      return res.json({
        nextQuestion,
        whyThisQuestion: nextQuestion ? '해당 섹션의 부족 항목을 보완하기 위한 질문입니다.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: pendingItems,
        sectionQuestions,
        commonQuestions,
        sectionMissingInfo,
        commonMissingInfo,
        insufficiencyReason: nextQuestion ? null : '추가 질문이 없습니다.',
        qnaHistory,
        uiHints
      });
    }

    // 답변 제출 단계: local TS updater only
    const latestAnswer = userAnswer;
    const latestQuestion = question || '시스템 질문';

    qnaHistory.push({
      question: latestQuestion,
      answer: userAnswer,
      timestamp: new Date().toISOString()
    });

    let updatedDraftText = draftEntry.draftText || '';
    let sectionMissing = draftEntry.openIssues || state.missingInfoBullets || [];
    let sectionQuestions: string[] = [];
    let commonQuestions: string[] = [];
    let lightweight = false;
    const chainResult = await runLocalSectionAnswerUpdate({
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory,
      pendingItems,
      latestAnswer
    });

    updatedDraftText = chainResult.updatedDraftText || draftEntry.draftText || '';
    sectionMissing = chainResult.remainingItems || [];
    const localNextQuestion = getOptionalNextQuestion(chainResult as { nextQuestion?: unknown });
    sectionQuestions =
      localNextQuestion && !REFRESH_QUESTIONS_ON_DEMAND
        ? [toNaturalKoreanQuestion(localNextQuestion)]
        : [];
    draftEntry.draftText = updatedDraftText;
    draftEntry.openIssues = sectionMissing;
    state.missingInfoBullets = sectionMissing;
    state.recommendedQuestions = sectionQuestions;
    state.status = chainResult.needMore ? 'POSSIBLE' : 'FULLY_POSSIBLE';
    state.rationaleText = chainResult.needMore
      ? '답변 반영 후에도 보완 항목이 남아 있음.'
      : '답변 반영 후 해당 섹션 필수 보완 항목이 해소됨.';

    const updatedDraftsBySection = deriveDraftMapFromSectionDrafts(sectionDrafts);

    await caseModel.updateCase(id, {
      ...anyCase,
      sectionDrafts,
      sectionStates
    });
    await caseModel.saveSectionInteraction(id, {
      sectionId: section,
      qnaHistory
    });

    const nextQuestion =
      lightweight || REFRESH_QUESTIONS_ON_DEMAND ? null : sectionQuestions[0] || commonQuestions[0] || null;
    const sectionMissingInfo = uniqueStrings(sectionMissing);
    const commonMissingInfo = uniqueStrings(commonQuestions.length > 0 ? [] : []);
    const uiHints = buildSectionUiHints({
      currentDraft: updatedDraftsBySection[section] || '',
      qnaHistory,
      sectionQuestions,
      sectionMissingInfo
    });

    return res.json({
      nextQuestion,
      whyThisQuestion: lightweight
        ? ''
        : nextQuestion
          ? '해당 섹션의 남은 부족 정보를 보완하기 위한 질문입니다.'
          : '',
      updatedDraftText: updatedDraftsBySection[section] || '',
      updatedDraftsBySection,
      needMore: sectionMissing.length > 0,
      remainingItems: sectionMissing,
      sectionQuestions,
      commonQuestions,
      sectionMissingInfo,
      commonMissingInfo,
      insufficiencyReason: sectionMissing.length > 0 ? null : null,
      qnaHistory,
      lightweight,
      uiHints
    });

    // Legacy backend Chain4 path removed. Local TS update is now the source.
    /*
    let latestAnswer: string | undefined;
    if (userAnswer && userAnswer !== 'SKIP') {
      latestAnswer = userAnswer;
      qnaHistory.push({
        question: question || '시스템 질문',
        answer: userAnswer,
        timestamp: new Date().toISOString()
      });
    }

    const chainResult = await runChain4_updateDraft({
      sectionId: section,
      currentDraft: draftEntry.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory,
      pendingItems,
      latestAnswer
    });

    draftEntry.draftText = chainResult.updatedDraftText;
    draftEntry.openIssues = chainResult.remainingItems;

    anyCase.sectionDrafts = sectionDrafts;

    await caseModel.updateCase(id, anyCase as any);
    await caseModel.saveSectionInteraction(id, {
      sectionId: section,
      qnaHistory
    });

    res.json({
      nextQuestion: chainResult.nextQuestion,
      whyThisQuestion: chainResult.whyThisQuestion,
      updatedDraftText: chainResult.updatedDraftText,
      needMore: chainResult.needMore,
      remainingItems: chainResult.remainingItems,
      insufficiencyReason: chainResult.insufficiencyReason,
      qnaHistory
    });
    */
  } catch (error: any) {
    console.error('Error in section next-step:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
