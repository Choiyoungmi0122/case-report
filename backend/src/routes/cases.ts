import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { Visit, CareSection, QnAPair } from '../types';
import {
  runEvidenceSplit,
  runFastSectionDraftUpdate,
  runSectionAssessment,
  runInitialSectionDrafts,
  runFinalManuscriptCompose,
  runLegacySectionDraftUpdate
} from '../llm/chains';
import {
  buildQuestionFromMissing,
  toNaturalKoreanQuestion
} from './utils/aiSectionMapping';

const router = express.Router();
const caseModel = new CaseModel();
const FAST_UPDATE_ONLY = process.env.FAST_UPDATE_ONLY !== 'false';
const AI_KEY_TO_CARE_SECTION: Record<string, CareSection> = {
  patient_information: CareSection.PATIENT_INFORMATION,
  clinical_findings: CareSection.CLINICAL_FINDINGS,
  timeline: CareSection.TIMELINE,
  diagnostic_assessment: CareSection.DIAGNOSTIC_ASSESSMENT,
  therapeutic_intervention: CareSection.THERAPEUTIC_INTERVENTIONS,
  follow_up_outcomes: CareSection.FOLLOW_UP_OUTCOMES,
  patient_perspective: CareSection.PATIENT_PERSPECTIVE
};
const CARE_SECTION_KEYWORDS: Record<CareSection, string[]> = {
  [CareSection.TITLE]: ['title', '제목'],
  [CareSection.ABSTRACT]: ['abstract', '요약'],
  [CareSection.INTRODUCTION]: ['introduction', '서론'],
  [CareSection.PATIENT_INFORMATION]: ['patient information', 'patient_information', '환자 정보'],
  [CareSection.CLINICAL_FINDINGS]: ['clinical findings', 'clinical_findings', '임상 소견'],
  [CareSection.TIMELINE]: ['timeline', '타임라인', '방문'],
  [CareSection.DIAGNOSTIC_ASSESSMENT]: ['diagnostic assessment', 'diagnostic_assessment', '진단'],
  [CareSection.THERAPEUTIC_INTERVENTIONS]: ['therapeutic intervention', 'therapeutic_intervention', '치료'],
  [CareSection.FOLLOW_UP_OUTCOMES]: ['follow up', 'follow_up_outcomes', '추적'],
  [CareSection.DISCUSSION_CONCLUSION]: ['discussion', 'conclusion', '토론', '결론'],
  [CareSection.PATIENT_PERSPECTIVE]: ['patient perspective', 'patient_perspective', '환자 관점'],
  [CareSection.INFORMED_CONSENT]: ['informed consent', 'informed_consent', '동의']
};

const NON_CORE_GENERATED_SECTIONS: CareSection[] = [
  CareSection.TITLE,
  CareSection.ABSTRACT,
  CareSection.INTRODUCTION,
  CareSection.DISCUSSION_CONCLUSION,
  CareSection.INFORMED_CONSENT
];
const COMMON_INTERACTION_KEY = '__COMMON__';

type PipelineBridgePayload = {
  chain1: any;
  chain2: any;
  chain3: any;
  chain4: any;
  chain5: any;
  chain7: any;
  qnaHistory?: Array<{ question: string; answer: string }>;
};

function deriveDraftMapFromSectionDrafts(sectionDrafts: any[]): Record<string, string> {
  return (sectionDrafts || []).reduce((acc: Record<string, string>, draft: any) => {
    if (draft && typeof draft.sectionId === 'string') {
      acc[draft.sectionId] = draft.draftText || '';
    }
    return acc;
  }, {});
}

function normalizeText(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractChain3SectionText(chain3: any, sectionId: CareSection): string {
  const aiKey = Object.keys(AI_KEY_TO_CARE_SECTION).find((k) => AI_KEY_TO_CARE_SECTION[k] === sectionId);
  if (!aiKey) return '';
  const value = chain3?.[aiKey];
  if (aiKey === 'timeline') {
    if (!Array.isArray(value)) return '';
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        return normalizeText(item);
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text;
  }
  return normalizeText(value);
}

function pickBySection(items: string[], sectionId: CareSection): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const keywords = (CARE_SECTION_KEYWORDS[sectionId] || []).map((k) => k.toLowerCase());
  const matched = items.filter((item) =>
    keywords.some((kw) => String(item || '').toLowerCase().includes(kw))
  );
  return matched.length > 0 ? matched : items.slice(0, 1);
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function getOptionalNextQuestion(result: { nextQuestion?: unknown }): string | null {
  return typeof result.nextQuestion === 'string' && result.nextQuestion.trim()
    ? result.nextQuestion
    : null;
}

function normalizeChain7SectionsSnapshot(chain7: any) {
  return chain7 && typeof chain7 === 'object'
    ? { final_sections: (chain7 as any).final_sections || {} }
    : null;
}

function savePipelineSnapshot(payload: PipelineBridgePayload) {
  const chain7SectionsOnly = normalizeChain7SectionsSnapshot(payload.chain7);

  return {
    chain1: payload.chain1,
    chain2: payload.chain2,
    chain3: payload.chain3,
    chain4: payload.chain4,
    chain5: payload.chain5,
    chain7: chain7SectionsOnly,
    qnaHistory: payload.qnaHistory || [],
    savedAt: new Date().toISOString()
  };
}

function hydrateCanonicalCaseDataFromPipeline(payload: PipelineBridgePayload) {
  const chain7SectionsOnly = normalizeChain7SectionsSnapshot(payload.chain7);
  const finalSections = chain7SectionsOnly?.final_sections || {};
  const draftBySection = new Map<string, string>();

  if (Object.keys(finalSections).length > 0) {
    Object.entries(AI_KEY_TO_CARE_SECTION).forEach(([aiKey, careSection]) => {
      const value = finalSections[aiKey];
      draftBySection.set(careSection, typeof value === 'string' ? value : '');
    });
  } else {
    // Initial submit flow: hydrate canonical drafts from Chain3 before section Q&A begins.
    Object.values(CareSection).forEach((sectionId) => {
      draftBySection.set(sectionId, extractChain3SectionText(payload.chain3, sectionId));
    });
  }

  const allSections = Object.values(CareSection);
  const missingItems: string[] = Array.isArray((payload.chain4 as any)?.missing) ? (payload.chain4 as any).missing : [];
  const clarificationQuestions: string[] = Array.isArray((payload.chain5 as any)?.clarification_questions)
    ? (payload.chain5 as any).clarification_questions
    : [];

  const sectionStates = allSections.map((sectionId) => {
    const hasDraft = (draftBySection.get(sectionId) || '').trim().length > 0;
    const sectionMissing = pickBySection(missingItems, sectionId);
    const sectionQuestions = pickBySection(clarificationQuestions, sectionId).map(toNaturalKoreanQuestion);
    return {
      sectionId,
      status: hasDraft ? 'FULLY_POSSIBLE' : 'IMPOSSIBLE',
      rationaleText: hasDraft
        ? 'AI 파이프라인 결과로 작성됨.'
        : '입력 데이터가 부족하여 해당 섹션 내용이 비어 있음.',
      missingInfoBullets: sectionMissing,
      recommendedQuestions: sectionQuestions
    };
  });

  const sectionDrafts = allSections.map((sectionId) => ({
    sectionId,
    evidenceCardIdsUsed: [] as string[],
    draftText: draftBySection.get(sectionId) || '',
    openIssues: [] as string[]
  }));

  return {
    sectionStates,
    sectionDrafts
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

function getQuestionMatchCount(question: string): number {
  return Object.values(CareSection).filter((sectionId) => pickBySection([question], sectionId as CareSection).length > 0)
    .length;
}

function splitCommonQuestions(questions: string[]): { commonQuestions: string[]; sectionSpecificQuestions: string[] } {
  const commonQuestions: string[] = [];
  const sectionSpecificQuestions: string[] = [];

  for (const question of questions || []) {
    const matchCount = getQuestionMatchCount(question);
    if (matchCount === 0 || matchCount > 1) {
      commonQuestions.push(question);
    } else {
      sectionSpecificQuestions.push(question);
    }
  }

  return {
    commonQuestions: uniqueStrings(commonQuestions),
    sectionSpecificQuestions: uniqueStrings(sectionSpecificQuestions)
  };
}

function splitCommonMissingItems(items: string[]): { commonItems: string[]; sectionSpecificItems: string[] } {
  const commonItems: string[] = [];
  const sectionSpecificItems: string[] = [];

  for (const item of items || []) {
    const matchCount = getQuestionMatchCount(item);
    if (matchCount === 0 || matchCount > 1) {
      commonItems.push(item);
    } else {
      sectionSpecificItems.push(item);
    }
  }

  return {
    commonItems: uniqueStrings(commonItems),
    sectionSpecificItems: uniqueStrings(sectionSpecificItems)
  };
}

function getCoreAiUpdatableSections(): CareSection[] {
  return Array.from(new Set(Object.values(AI_KEY_TO_CARE_SECTION)));
}

function findTargetSectionsForCommonQuestion(params: {
  question: string;
  sectionStates: any[];
  sectionDrafts: any[];
}): CareSection[] {
  const normalizedQuestion = toNaturalKoreanQuestion(params.question);
  const matched = getCoreAiUpdatableSections().filter((sectionId) => {
    const state = (params.sectionStates || []).find((item) => item.sectionId === sectionId);
    const draft = (params.sectionDrafts || []).find((item) => item.sectionId === sectionId);
    const candidateQuestions = uniqueStrings([
      ...((state?.recommendedQuestions || []).map(toNaturalKoreanQuestion)),
      ...((state?.missingInfoBullets || []).map((item: string) => toNaturalKoreanQuestion(buildQuestionFromMissing(item)))),
      ...((draft?.openIssues || []).map((item: string) => toNaturalKoreanQuestion(buildQuestionFromMissing(item))))
    ]);

    return candidateQuestions.some((candidate) => isSameQuestion(candidate, normalizedQuestion));
  });

  return matched.length > 0 ? matched : getCoreAiUpdatableSections();
}

async function runCrossSectionDraftUpdate(params: {
  question: string;
  answer: string;
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  qnaHistoryBySection: Record<string, QnAPair[]>;
}) {
  const targetSections = findTargetSectionsForCommonQuestion({
    question: params.question,
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts
  });

  const updateResults = await Promise.all(
    targetSections.map(async (sectionId) => {
    const draftEntry =
      params.sectionDrafts.find((draft) => draft.sectionId === sectionId) ||
      (() => {
        const nextDraft = {
          sectionId,
          evidenceCardIdsUsed: [] as string[],
          draftText: '',
          openIssues: [] as string[]
        };
        params.sectionDrafts.push(nextDraft);
        return nextDraft;
      })();

    const state =
      params.sectionStates.find((item) => item.sectionId === sectionId) ||
      (() => {
        const nextState = {
          sectionId,
          status: 'POSSIBLE',
          rationaleText: '',
          missingInfoBullets: [] as string[],
          recommendedQuestions: [] as string[]
        };
        params.sectionStates.push(nextState);
        return nextState;
      })();

    const relevantEvidence = (params.evidenceCards || []).filter((card) => (card.tags || []).includes(sectionId));
    const compactEvidence = relevantEvidence.slice(0, 8);
    const combinedHistory = (params.qnaHistoryBySection[sectionId] || []).slice(-3);
    const pendingItems = (draftEntry.openIssues || state.missingInfoBullets || []).slice(0, 6);
    const result = FAST_UPDATE_ONLY
      ? await runFastSectionDraftUpdate({
          sectionId,
          currentDraft: draftEntry.draftText || '',
          evidenceCards: compactEvidence,
          qnaHistory: combinedHistory,
          pendingItems,
          latestAnswer: params.answer
        })
      : await runLegacySectionDraftUpdate({
          sectionId,
          currentDraft: draftEntry.draftText || '',
          evidenceCards: compactEvidence,
          qnaHistory: combinedHistory,
          pendingItems,
          latestAnswer: params.answer
        });

    return { sectionId, draftEntry, state, result };
  })
  );

  for (const { draftEntry, state, result } of updateResults) {
    draftEntry.draftText = result.updatedDraftText || draftEntry.draftText || '';
    draftEntry.openIssues = result.remainingItems || [];
    state.missingInfoBullets = result.remainingItems || [];
    const nextQuestion = getOptionalNextQuestion(result as { nextQuestion?: unknown });
    state.recommendedQuestions =
      nextQuestion ? [toNaturalKoreanQuestion(nextQuestion)] : [];
    state.status = result.needMore ? 'POSSIBLE' : 'FULLY_POSSIBLE';
    state.rationaleText = result.needMore
      ? '공통 답변 반영 후에도 추가 보완 항목이 남아 있음.'
      : '공통 답변이 반영되어 해당 섹션 초안이 업데이트됨.';
  }

  return {
    sectionDrafts: params.sectionDrafts,
    sectionStates: params.sectionStates
  };
}

// GET /api/cases - Get all cases
router.get('/', async (req: Request, res: Response) => {
  try {
    const cases = await caseModel.getAllCases();
    res.json({ cases });
  } catch (error: any) {
    console.error('Error getting all cases:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases - Create new case
router.post('/', async (req: Request, res: Response) => {
  try {
    const { visits, metadata, title } = req.body;

    if (!visits || !Array.isArray(visits) || visits.length === 0) {
      return res.status(400).json({ error: 'visits array is required' });
    }

    // 현재는 비식별화 없이 원본 EMR 텍스트를 그대로 저장
    const processedVisits: Visit[] = visits.map((visit: any, index: number) => ({
      index: index + 1,
      type: visit.type || '재진',
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
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: error.message || 'Failed to create case',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// POST /api/cases/:id/process - Run Chain 1/2/3 (Evidence -> SectionStates -> SectionDraft v0)
router.post('/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // Chain 1: EvidenceCard 생성
    const visitsForChain1 = case_.visits.map((v: any, idx: number) => ({
      index: v.index ?? v.visitIndex ?? idx + 1,
      date: v.date ?? v.visitDateTime ?? v.dateTime ?? '',
      text: v.soapText ?? v.sanitizedText ?? ''
    }));
    console.log('[Chain1] Input visits count:', visitsForChain1.length);

    const evidenceCards = await runEvidenceSplit(visitsForChain1);
    console.log(
      '[Chain1] Output evidenceCards:',
      Array.isArray(evidenceCards) ? evidenceCards.length : 'INVALID',
    );

    // Chain 2: SectionState 평가
    let sectionStates = await runSectionAssessment(evidenceCards);
    console.log(
      '[Chain2] Output sectionStates:',
      Array.isArray(sectionStates) ? sectionStates.map(s => `${s.sectionId}:${s.status}`) : 'INVALID',
    );

    // 항상 13개 CARE 섹션 전체를 채움. LLM이 안 준 섹션은 IMPOSSIBLE로 보충
    const allSectionIds = Object.values(CareSection);
    const stateBySection = new Map(sectionStates.map((s: any) => [s.sectionId, s]));
    sectionStates = allSectionIds.map((sectionId) => {
      const existing = stateBySection.get(sectionId);
      if (existing) return existing;
      return {
        sectionId,
        status: 'IMPOSSIBLE',
        rationaleText: 'EMR에 해당 섹션 관련 기록 없음.',
        missingInfoBullets: [] as string[],
        recommendedQuestions: [] as string[]
      };
    });
    console.log('[Chain2] After fill:', sectionStates.map((s: any) => `${s.sectionId}:${s.status}`).join(', '));

    // Chain 3: 섹션별 임시 초안 생성
    let sectionDrafts = await runInitialSectionDrafts(evidenceCards, sectionStates);
    console.log(
      '[Chain3] Output sectionDrafts:',
      Array.isArray(sectionDrafts) ? sectionDrafts.map((d: any) => d.sectionId) : 'INVALID',
    );

    // 항상 13개 CARE 섹션 전체를 채움. LLM이 안 준 섹션은 빈 초안으로 보충
    const draftBySection = new Map(sectionDrafts.map((d: any) => [d.sectionId, d]));
    sectionDrafts = allSectionIds.map((sectionId) => {
      const existing = draftBySection.get(sectionId);
      if (existing) return existing;
      return {
        sectionId,
        evidenceCardIdsUsed: [] as string[],
        draftText: '',
        openIssues: [] as string[]
      };
    });
    console.log('[Chain3] After fill:', sectionDrafts.length, 'sections');

    // 케이스에 새 체인 결과 저장
    await caseModel.updateCase(id, {
      // 기존 필드는 비워두지 않고, 새 필드로 별도 저장
      ...(case_ as any),
      evidenceCards,
      sectionStates,
      sectionDrafts
    } as any);
    console.log('[Process] Case updated with chain1–3 results for caseId:', id);

    // 섹션 개요(상태 + 초안 snippet) 반환
    const sectionsOverview = sectionStates.map((state) => {
      const draft = sectionDrafts.find(d => d.sectionId === state.sectionId);
      return {
        section: state.sectionId,
        status: state.status,
        rationaleText: state.rationaleText,
        draftSnippet: draft?.draftText.slice(0, 200) || ''
      };
    });

    res.json({ caseId: id, sectionsOverview });
  } catch (error: any) {
    console.error('Error processing case:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/cases/:id/title - Update case title (must be before /:id route)
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

// GET /api/cases/:id/common-questions - case-level common questions before section-detailing
router.get('/:id/common-questions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const useAiPipelineFallback = sectionStates.length === 0;
    const baselineQuestions: string[] = useAiPipelineFallback && Array.isArray(anyCase?.aiPipeline?.chain5?.clarification_questions)
      ? anyCase.aiPipeline.chain5.clarification_questions
      : [];
    const baselineMissing: string[] = useAiPipelineFallback && Array.isArray(anyCase?.aiPipeline?.chain4?.missing)
      ? anyCase.aiPipeline.chain4.missing
      : [];

    const collectedQuestions = uniqueStrings([
      ...baselineQuestions,
      ...sectionStates.flatMap((state) => state.recommendedQuestions || [])
    ]);
    const collectedMissing = uniqueStrings([
      ...baselineMissing,
      ...sectionStates.flatMap((state) => state.missingInfoBullets || [])
    ]);

    const { commonQuestions } = splitCommonQuestions(collectedQuestions);
    const { commonItems } = splitCommonMissingItems(collectedMissing);
    const fallbackQuestions = commonItems.map((item) => toNaturalKoreanQuestion(buildQuestionFromMissing(item)));

    const answeredHistory: QnAPair[] = [];
    for (const sectionId of [...Object.values(CareSection), COMMON_INTERACTION_KEY]) {
      const interaction = await caseModel.getInteractionByKey(id, sectionId);
      if (interaction?.qnaHistory?.length) {
        answeredHistory.push(...interaction.qnaHistory);
      }
    }

    const filteredQuestions = filterAnsweredQuestions(
      uniqueStrings([...commonQuestions.map(toNaturalKoreanQuestion), ...fallbackQuestions]),
      answeredHistory
    );
    const commonInteraction = await caseModel.getInteractionByKey(id, COMMON_INTERACTION_KEY);

    res.json({
      questions: filteredQuestions,
      qnaHistory: commonInteraction?.qnaHistory || [],
      missingInfo: commonItems
    });
  } catch (error: any) {
    console.error('Error getting common questions:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases/:id/common-questions/answer - answer common question and update all drafts
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
    const interaction = await caseModel.getInteractionByKey(id, COMMON_INTERACTION_KEY);
    const qnaHistory: QnAPair[] = interaction?.qnaHistory || [];

    qnaHistory.push({
      question,
      answer,
      timestamp: new Date().toISOString()
    });

    const qnaHistoryBySection: Record<string, QnAPair[]> = {};
    for (const sectionId of getCoreAiUpdatableSections()) {
      const sectionInteraction = await caseModel.getInteractionByKey(id, sectionId);
      qnaHistoryBySection[sectionId] = uniqueStrings([
        ...(sectionInteraction?.qnaHistory || []).map((item) => JSON.stringify(item)),
        ...qnaHistory.map((item) => JSON.stringify(item))
      ]).map((item) => JSON.parse(item));
    }

    await runCrossSectionDraftUpdate({
      question,
      answer,
      sectionDrafts,
      sectionStates,
      evidenceCards,
      qnaHistoryBySection
    });

    const updatedDraftsBySection = deriveDraftMapFromSectionDrafts(sectionDrafts);

    await caseModel.updateCase(id, {
      ...(anyCase as any),
      sectionDrafts,
      sectionStates
    } as any);
    await caseModel.saveInteractionByKey(id, {
      sectionId: COMMON_INTERACTION_KEY,
      qnaHistory
    });

    res.json({
      updatedDraftsBySection,
      qnaHistory
    });
  } catch (error: any) {
    console.error('Error answering common question:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cases/:id - Get case
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

// DELETE /api/cases/:id - Delete case (must be before /:id/sections route)
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

// GET /api/cases/:id/sections - Get all sections (새 체인 기반 요약)
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
      const draft = sectionDrafts.find((d) => d.sectionId === state.sectionId);
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

// POST /api/cases/:id/final-compose - Run Chain 5 (최종 조합 및 CARE 체크리스트)
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
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];

    // 섹션별 Q&A 히스토리 수집
    const qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>> = {};
    for (const sectionKey of Object.values(CareSection)) {
      const interaction = await caseModel.getSectionInteraction(id, sectionKey as CareSection);
      if (interaction?.qnaHistory?.length) {
        qnaHistoryBySection[sectionKey] = interaction.qnaHistory.map((q) => ({
          question: q.question,
          answer: q.answer
        }));
      }
    }

    const finalDraft = await runFinalManuscriptCompose({
      sectionDrafts,
      evidenceCards,
      qnaHistoryBySection,
      contributionAnswers
    });

    const nextSectionDrafts = [...sectionDrafts];
    const existingSectionStates: any[] = anyCase.sectionStates || [];
    const nextSectionStates = [...existingSectionStates];

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
        status: text.trim() ? 'POSSIBLE' : 'IMPOSSIBLE',
        rationaleText: text.trim()
          ? '현재까지 정리된 핵심 섹션 초안을 바탕으로 생성된 문안입니다. 본문 보완 후 다시 생성할 수 있습니다.'
          : '핵심 섹션 정보가 아직 충분하지 않아 자동 문안을 만들지 못했습니다.',
        missingInfoBullets: existingState?.missingInfoBullets || [],
        recommendedQuestions: []
      };

      if (existingState) {
        Object.assign(existingState, nextState);
      } else {
        nextSectionStates.push(nextState);
      }
    }

    await caseModel.updateCase(id, {
      ...(anyCase as any),
      finalDraft,
      sectionDrafts: nextSectionDrafts,
      sectionStates: nextSectionStates
    } as any);

    res.json({ caseId: id, finalDraft });
  } catch (error: any) {
    console.error('Error in final-compose:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases/:id/ai-pipeline
// Bridge route kept for compatibility:
// 1) save ai_server snapshot for debug/reference
// 2) hydrate canonical case fields used by runtime routes
router.post('/:id/ai-pipeline', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      chain1,
      chain2,
      chain3,
      chain4,
      chain5,
      chain7,
      qnaHistory
    } = req.body as PipelineBridgePayload;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const pipelinePayload: PipelineBridgePayload = {
      chain1,
      chain2,
      chain3,
      chain4,
      chain5,
      chain7,
      qnaHistory
    };
    const pipelineSnapshot = savePipelineSnapshot(pipelinePayload);
    const { sectionStates, sectionDrafts } = hydrateCanonicalCaseDataFromPipeline(pipelinePayload);

    await caseModel.updateCase(id, {
      ...(case_ as any),
      aiPipeline: pipelineSnapshot,
      sectionStates,
      sectionDrafts
    } as any);

    res.json({ success: true, caseId: id });
  } catch (error: any) {
    console.error('Error saving ai pipeline result:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cases/:id/export?format=txt - Export final draft as plain text
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

    // 섹션 순서 정의 (CARE 순서)
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
      lines.push(''); // 빈 줄
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
