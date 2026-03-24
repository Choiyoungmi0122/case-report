import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import {
  buildAiDraftFromSectionDrafts,
  extractSectionDraftTextFromAiDraft,
  filterMissingForSection,
  splitSectionAndCommonItems,
  buildQuestionFromMissing,
  CARE_TO_AI_FIELD
} from './utils/aiSectionMapping';

const router = express.Router();
const caseModel = new CaseModel();
const AI_SERVER_URL = process.env.AI_SERVER_URL || 'http://127.0.0.1:8000';
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

function toKoreanQuestion(text: string): string {
  const input = String(text || '').trim();
  if (!input) return '';
  if (/[가-힣]/.test(input)) return input;
  return `다음 정보를 알려주세요: ${input}`;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).filter(Boolean)));
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

async function callAiPipelineAnswer(payload: {
  current_draft: Record<string, any>;
  question: string;
  answer: string;
  refresh_missing?: boolean;
}) {
  const response = await fetch(`${AI_SERVER_URL}/pipeline/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.detail || data?.error || `ai_server /pipeline/answer failed (${response.status})`);
  }

  if (!data || data.error) {
    throw new Error(data?.error || 'Invalid ai_server response from /pipeline/answer');
  }

  return data;
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

    let state = sectionStates.find((s) => s.sectionId === section);
    let draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    const interaction = await caseModel.getSectionInteraction(id, section);

    if (!state) {
      // Some legacy cases only have aiPipeline snapshots; provide section fallback
      const fallbackDraft = getFallbackDraftFromAiPipeline(anyCase, section);
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
        draftText: getFallbackDraftFromAiPipeline(anyCase, section),
        evidenceCardIdsUsed: [],
        openIssues: []
      };
    }

    const baselineMissing =
      (state.missingInfoBullets && state.missingInfoBullets.length > 0
        ? state.missingInfoBullets
        : anyCase?.aiPipeline?.chain4?.missing) || [];
    const baselineQuestions =
      (state.recommendedQuestions && state.recommendedQuestions.length > 0
        ? state.recommendedQuestions
        : anyCase?.aiPipeline?.chain5?.clarification_questions) || [];

    const qnaHistory = interaction?.qnaHistory || [];
    const missingSplit = splitSectionAndCommonItems(baselineMissing, section);
    const questionSplit = splitSectionAndCommonItems(baselineQuestions, section);
    const sectionQuestions = filterAnsweredQuestions(
      uniqueStrings(questionSplit.sectionItems.map(toKoreanQuestion)),
      qnaHistory
    );
    const commonQuestions = filterAnsweredQuestions(
      uniqueStrings(questionSplit.commonItems.map(toKoreanQuestion)),
      qnaHistory
    );

    res.json({
      section: sectionId,
      status: state.status,
      rationaleText: state.rationaleText,
      missingInfoBullets: uniqueStrings([
        ...missingSplit.sectionItems,
        ...missingSplit.commonItems
      ]),
      recommendedQuestions: uniqueStrings([...sectionQuestions, ...commonQuestions]),
      sectionMissingInfo: uniqueStrings(missingSplit.sectionItems),
      commonMissingInfo: uniqueStrings(missingSplit.commonItems),
      sectionQuestions: sectionQuestions,
      commonQuestions: commonQuestions,
      currentDraft: draftEntry?.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory
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

    let state = sectionStates.find((s) => s.sectionId === section);
    let draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    if (!state) {
      const fallbackDraft = getFallbackDraftFromAiPipeline(anyCase, section);
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
        draftText: getFallbackDraftFromAiPipeline(anyCase, section),
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
          toKoreanQuestion(buildQuestionFromMissing(item))
        )),
        qnaHistory
      );
      const commonQuestions = filterAnsweredQuestions(
        uniqueStrings(pendingSplit.commonItems.map((item) =>
          toKoreanQuestion(buildQuestionFromMissing(item))
        )),
        qnaHistory
      );
      const nextQuestion = sectionQuestions[0] || commonQuestions[0] || null;
      return res.json({
        nextQuestion,
        whyThisQuestion: nextQuestion ? '해당 섹션의 부족 항목을 보완하기 위한 질문입니다.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: pendingItems,
        sectionQuestions,
        commonQuestions,
        sectionMissingInfo: uniqueStrings(pendingSplit.sectionItems),
        commonMissingInfo: uniqueStrings(pendingSplit.commonItems),
        insufficiencyReason: nextQuestion ? null : '현재 섹션은 ai_server Chain6 직접 업데이트 대상이 아닙니다.',
        qnaHistory
      });
    }

    // 질문 시작 단계: 기존 계약 유지 (답변 없이 다음 질문만 반환)
    if (!userAnswer || userAnswer === 'SKIP') {
      const pendingSplit = splitSectionAndCommonItems(pendingItems, section);
      const questionSplit = splitSectionAndCommonItems(state.recommendedQuestions || [], section);
      const sectionQuestions = filterAnsweredQuestions(
        uniqueStrings([
          ...questionSplit.sectionItems.map(toKoreanQuestion),
          ...pendingSplit.sectionItems.map((item) => toKoreanQuestion(buildQuestionFromMissing(item)))
        ]),
        qnaHistory
      );
      const commonQuestions = filterAnsweredQuestions(
        uniqueStrings([
          ...questionSplit.commonItems.map(toKoreanQuestion),
          ...pendingSplit.commonItems.map((item) => toKoreanQuestion(buildQuestionFromMissing(item)))
        ]),
        qnaHistory
      );
      const nextQuestion = sectionQuestions[0] || commonQuestions[0] || null;

      return res.json({
        nextQuestion,
        whyThisQuestion: nextQuestion ? '해당 섹션의 부족 항목을 보완하기 위한 질문입니다.' : '',
        updatedDraftText: draftEntry.draftText || '',
        needMore: Boolean(nextQuestion),
        remainingItems: pendingItems,
        sectionQuestions,
        commonQuestions,
        sectionMissingInfo: uniqueStrings(pendingSplit.sectionItems),
        commonMissingInfo: uniqueStrings(pendingSplit.commonItems),
        insufficiencyReason: nextQuestion ? null : '추가 질문이 없습니다.',
        qnaHistory
      });
    }

    // 답변 제출 단계: ai_server /pipeline/answer 기반으로 업데이트
    const latestAnswer = userAnswer;
    const latestQuestion = question || '시스템 질문';

    qnaHistory.push({
      question: latestQuestion,
      answer: userAnswer,
      timestamp: new Date().toISOString()
    });

    const aiCurrentDraft = buildAiDraftFromSectionDrafts(sectionDrafts);
    const aiResult = await callAiPipelineAnswer({
      current_draft: aiCurrentDraft,
      question: latestQuestion,
      answer: latestAnswer,
      refresh_missing: false
    });

    const chain6 = aiResult.chain6 || {};
    const lightweight = Boolean(aiResult.lightweight);
    const chain4Missing: string[] = aiResult.chain4?.missing || [];
    const chain5Questions: string[] = aiResult.chain5?.clarification_questions || [];

    const sectionMissing = lightweight
      ? draftEntry.openIssues || state.missingInfoBullets || []
      : filterMissingForSection(chain4Missing, section);
    const questionSplit = splitSectionAndCommonItems(chain5Questions, section);
    const sectionQuestions = lightweight
      ? []
      : filterAnsweredQuestions(uniqueStrings(questionSplit.sectionItems.map(toKoreanQuestion)), qnaHistory);
    const commonQuestions = lightweight
      ? []
      : filterAnsweredQuestions(uniqueStrings(questionSplit.commonItems.map(toKoreanQuestion)), qnaHistory);
    const missingSplit = lightweight
      ? {
          sectionItems: state.missingInfoBullets || [],
          commonItems: [] as string[]
        }
      : splitSectionAndCommonItems(chain4Missing, section);

    // Update ALL sections from chain6 (document-aware), not just current section
    for (const [aiKey, careSection] of Object.entries(AI_TO_CARE_SECTION)) {
      const text = extractSectionDraftTextFromAiDraft(chain6, careSection);
      const entry = sectionDrafts.find((d) => d.sectionId === careSection);
      if (entry) {
        entry.draftText = text;
      } else {
        sectionDrafts.push({
          sectionId: careSection,
          draftText: text,
          evidenceCardIdsUsed: [],
          openIssues: []
        });
      }
    }
    draftEntry.openIssues = sectionMissing;

    if (lightweight) {
      state.status = draftEntry.draftText?.trim() ? 'POSSIBLE' : state.status;
      state.rationaleText = '답변 반영 후 초안이 업데이트되었습니다.';
    } else {
      state.missingInfoBullets = sectionMissing;
      state.recommendedQuestions = uniqueStrings([...sectionQuestions, ...commonQuestions]);
      state.status = sectionMissing.length === 0 ? 'FULLY_POSSIBLE' : 'POSSIBLE';
      state.rationaleText =
        sectionMissing.length === 0
          ? '답변 반영 후 해당 섹션 필수 보완 항목이 해소됨.'
          : '답변 반영 후에도 보완 항목이 남아 있음.';
    }

    const updatedDraftsBySection: Record<string, string> = {};
    for (const d of sectionDrafts) {
      if (d && typeof d.sectionId === 'string') {
        updatedDraftsBySection[d.sectionId] = d.draftText || '';
      }
    }

    anyCase.sectionDrafts = sectionDrafts;
    anyCase.sectionStates = sectionStates;
    anyCase.draftsBySection = updatedDraftsBySection;

    await caseModel.updateCase(id, {
      ...anyCase,
      sectionDrafts,
      sectionStates,
      draftsBySection: updatedDraftsBySection
    });
    await caseModel.saveSectionInteraction(id, {
      sectionId: section,
      qnaHistory
    });

    const nextQuestion = lightweight ? null : sectionQuestions[0] || commonQuestions[0] || null;

    return res.json({
      nextQuestion,
      whyThisQuestion: lightweight
        ? ''
        : nextQuestion
          ? '해당 섹션의 남은 부족 정보를 보완하기 위한 질문입니다.'
          : '',
      updatedDraftText: updatedDraftsBySection[section] || '',
      updatedDraftsBySection,
      needMore: lightweight ? true : sectionMissing.length > 0,
      remainingItems: sectionMissing,
      sectionQuestions,
      commonQuestions,
      sectionMissingInfo: uniqueStrings(missingSplit.sectionItems),
      commonMissingInfo: uniqueStrings(missingSplit.commonItems),
      insufficiencyReason: sectionMissing.length > 0 ? null : null,
      qnaHistory,
      lightweight
    });

    // Legacy backend Chain4 path removed (ai_server Chain6 path is now the source)
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
