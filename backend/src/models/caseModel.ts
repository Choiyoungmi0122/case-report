import { Case, SectionInteraction, CareSection, ChainCacheEntry, ChainPerformanceLog } from '../types';
import {
  CaseModel as CaseMongoModel,
  SectionInteractionModel,
  advanceExperimentCounterForCode,
  reserveExperimentCode
} from '../db/schema';

function normalizeSectionStatusValue(status: any): string {
  switch (String(status || '').trim()) {
    case 'FULLY_POSSIBLE':
      return 'READY';
    case 'POSSIBLE':
    case 'PARTIAL_POSSIBLE':
    case 'PARTIAL_IMPOSSIBLE':
      return 'INCOMPLETE';
    case 'READY':
    case 'INCOMPLETE':
    case 'IMPOSSIBLE':
      return String(status);
    default:
      return 'IMPOSSIBLE';
  }
}

function normalizeSectionStatusMap(rawStatusMap: Record<string, any>) {
  return Object.entries(rawStatusMap || {}).reduce((acc: Record<string, any>, [sectionId, info]) => {
    acc[sectionId] = {
      ...(info || {}),
      status: normalizeSectionStatusValue(info?.status)
    };
    return acc;
  }, {});
}

function normalizeSectionStates(rawSectionStates: any[]) {
  return (rawSectionStates || []).map((state: any) => ({
    ...state,
    status: normalizeSectionStatusValue(state?.status),
    missingInfoBullets: state?.missingInfoBullets || [],
    recommendedQuestions: state?.recommendedQuestions || []
  }));
}

function deriveDraftsBySection(rawSectionDrafts: any[], rawDraftsBySection: Record<string, string>) {
  const merged = { ...(rawDraftsBySection || {}) };

  if (Array.isArray(rawSectionDrafts) && rawSectionDrafts.length > 0) {
    return rawSectionDrafts.reduce((acc: Record<string, string>, draft: any) => {
      if (draft && typeof draft.sectionId === 'string') {
        acc[draft.sectionId] = draft.draftText || '';
      }
      return acc;
    }, merged as Record<string, string>);
  }

  return merged;
}

export class CaseModel {
  async getAllCases(mode?: 'write' | 'scaffold'): Promise<Case[]> {
    const docs = await CaseMongoModel.find(mode ? { mode } : {}).sort({ createdAt: -1 }).exec();

    return docs.map((doc) => ({
      id: doc.id,
      experiment_code: (doc as any).experiment_code,
      experimentCode: (doc as any).experiment_code,
      createdAt: doc.createdAt.toISOString(),
      mode: ((doc as any).mode || 'write') as 'write' | 'scaffold',
      title: doc.title || undefined,
      studyMetadata: (doc as any).studyMetadata || null,
      versionMetadata: (doc as any).versionMetadata || null,
      caseInputValidation: (doc as any).caseInputValidation || null,
      sessionOutcome: (doc as any).sessionOutcome || null,
      researcherAssistance: (doc as any).researcherAssistance || [],
      technicalIssues: (doc as any).technicalIssues || [],
      visits: doc.visits,
      timelineEvents: (doc as any).timelineEvents || [],
      deidentifiedEMRs: (doc as any).deidentifiedEMRs || [],
      pendingTermConfirmations: (doc as any).pendingTermConfirmations || [],
      reviewRequired: (doc as any).reviewRequired || null,
      staleState: (doc as any).staleState || null,
      processingCache: (doc as any).processingCache || undefined,
      chainCache: (doc as any).chainCache || {},
      chainProgress: (doc as any).chainProgress || null,
      chainPerformanceLogs: (doc as any).chainPerformanceLogs || [],
      exportLogs: (doc as any).exportLogs || [],
      finalComposeStatus: (doc as any).finalComposeStatus || undefined,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: normalizeSectionStatusMap(doc.sectionStatusMap || {}),
      draftsBySection: deriveDraftsBySection((doc as any).sectionDrafts || [], doc.draftsBySection || {}),
      evidenceCards: (doc as any).evidenceCards || [],
      sectionStates: normalizeSectionStates((doc as any).sectionStates || []),
      commonMissingItems: (doc as any).commonMissingItems || [],
      commonQuestionSets: (doc as any).commonQuestionSets || [],
      answerUndoStack: (doc as any).answerUndoStack || [],
      sectionDrafts: (doc as any).sectionDrafts || [],
      sectionAdequacyReviews: (doc as any).sectionAdequacyReviews || {},
      scaffoldState: (doc as any).scaffoldState || null,
      researchState: (doc as any).researchState || null,
      studyConfig: (doc as any).studyConfig || null,
      finalDraft: (doc as any).finalDraft || null,
      studyWrite: (doc as any).studyWrite || null
    }));
  }

  async getInteractionsByKeys(
    caseId: string,
    sectionKeys: string[]
  ): Promise<Array<{ sectionId: string; qnaHistory: any[] }>> {
    const normalizedKeys = Array.from(
      new Set((sectionKeys || []).map((key) => String(key || '').trim()).filter(Boolean))
    );

    if (normalizedKeys.length === 0) {
      return [];
    }

    const docs = await SectionInteractionModel.find({
      caseId,
      sectionId: { $in: normalizedKeys }
    }).exec();

    return docs.map((doc) => ({
      sectionId: doc.sectionId,
      qnaHistory: doc.qnaHistory || []
    }));
  }

  async getInteractionByKey(caseId: string, sectionKey: string): Promise<{ sectionId: string; qnaHistory: any[] } | null> {
    const doc = await SectionInteractionModel.findOne({ caseId, sectionId: sectionKey }).exec();
    if (!doc) return null;

    return {
      sectionId: doc.sectionId,
      qnaHistory: doc.qnaHistory || []
    };
  }

  async saveInteractionByKey(
    caseId: string,
    interaction: { sectionId: string; qnaHistory: any[] }
  ): Promise<void> {
    await SectionInteractionModel.findOneAndUpdate(
      { caseId, sectionId: interaction.sectionId },
      {
        caseId,
        sectionId: interaction.sectionId,
        qnaHistory: interaction.qnaHistory
      },
      { upsert: true, new: true }
    ).exec();
  }

  async createCase(caseData: Omit<Case, 'id' | 'createdAt'>): Promise<string> {
    const id = `case_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const createdAt = new Date();
    const mode = ((caseData as any).mode || 'write') as 'write' | 'scaffold';
    const requestedExperimentCode =
      typeof (caseData as any).experiment_code === 'string'
        ? (caseData as any).experiment_code.trim().toUpperCase()
        : '';
    const experimentCode = requestedExperimentCode || (await reserveExperimentCode(mode));

    const newCase = new CaseMongoModel({
      id,
      experiment_code: experimentCode,
      createdAt,
      mode,
      title: caseData.title || null,
      studyMetadata: (caseData as any).studyMetadata || null,
      versionMetadata: (caseData as any).versionMetadata || null,
      caseInputValidation: (caseData as any).caseInputValidation || null,
      sessionOutcome: (caseData as any).sessionOutcome || null,
      researcherAssistance: (caseData as any).researcherAssistance || [],
      technicalIssues: (caseData as any).technicalIssues || [],
      visits: caseData.visits,
      timelineEvents: (caseData as any).timelineEvents || [],
      deidentifiedEMRs: caseData.deidentifiedEMRs || [],
      pendingTermConfirmations: caseData.pendingTermConfirmations || [],
      reviewRequired: caseData.reviewRequired || null,
      staleState: caseData.staleState || null,
      chainCache: (caseData as any).chainCache || {},
      chainProgress: (caseData as any).chainProgress || null,
      chainPerformanceLogs: (caseData as any).chainPerformanceLogs || [],
      exportLogs: (caseData as any).exportLogs || [],
      sectionEvidenceMap: caseData.sectionEvidenceMap || {},
      sectionStatusMap: caseData.sectionStatusMap || {},
      scaffoldState: (caseData as any).scaffoldState || null,
      researchState: (caseData as any).researchState || null,
      studyConfig: (caseData as any).studyConfig || null
    });

    await newCase.save();
    if (requestedExperimentCode) {
      await advanceExperimentCounterForCode(mode, requestedExperimentCode);
    }
    return id;
  }

  async getCase(id: string): Promise<Case | null> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) return null;

    const rawDraftsBySection = doc.draftsBySection || {};
    const rawSectionDrafts: any[] = (doc as any).sectionDrafts || [];
    const draftsBySection = deriveDraftsBySection(rawSectionDrafts, rawDraftsBySection);

    return {
      id: doc.id,
      experiment_code: (doc as any).experiment_code,
      experimentCode: (doc as any).experiment_code,
      createdAt: doc.createdAt.toISOString(),
      mode: ((doc as any).mode || 'write') as 'write' | 'scaffold',
      title: doc.title || undefined,
      studyMetadata: (doc as any).studyMetadata || null,
      versionMetadata: (doc as any).versionMetadata || null,
      caseInputValidation: (doc as any).caseInputValidation || null,
      sessionOutcome: (doc as any).sessionOutcome || null,
      researcherAssistance: (doc as any).researcherAssistance || [],
      technicalIssues: (doc as any).technicalIssues || [],
      visits: doc.visits,
      timelineEvents: (doc as any).timelineEvents || [],
      deidentifiedEMRs: (doc as any).deidentifiedEMRs || [],
      pendingTermConfirmations: (doc as any).pendingTermConfirmations || [],
      reviewRequired: (doc as any).reviewRequired || null,
      staleState: (doc as any).staleState || null,
      processingCache: (doc as any).processingCache || undefined,
      chainCache: (doc as any).chainCache || {},
      chainProgress: (doc as any).chainProgress || null,
      chainPerformanceLogs: (doc as any).chainPerformanceLogs || [],
      exportLogs: (doc as any).exportLogs || [],
      finalComposeStatus: (doc as any).finalComposeStatus || undefined,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: normalizeSectionStatusMap(doc.sectionStatusMap || {}),
      draftsBySection,
      evidenceCards: (doc as any).evidenceCards || [],
      sectionStates: normalizeSectionStates((doc as any).sectionStates || []),
      commonMissingItems: (doc as any).commonMissingItems || [],
      commonQuestionSets: (doc as any).commonQuestionSets || [],
      answerUndoStack: (doc as any).answerUndoStack || [],
      sectionDrafts: rawSectionDrafts,
      sectionAdequacyReviews: (doc as any).sectionAdequacyReviews || {},
      scaffoldState: (doc as any).scaffoldState || null,
      researchState: (doc as any).researchState || null,
      studyConfig: (doc as any).studyConfig || null,
      finalDraft: (doc as any).finalDraft || null,
      studyWrite: (doc as any).studyWrite || null
    } as Case & { sectionStates?: any[]; sectionDrafts?: any[]; finalDraft?: any };
  }

  async updateCase(id: string, updates: Partial<Case>): Promise<void> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) throw new Error('Case not found');

    const updateData: any = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if ((updates as any).studyMetadata !== undefined) updateData.studyMetadata = (updates as any).studyMetadata;
    if ((updates as any).versionMetadata !== undefined) updateData.versionMetadata = (updates as any).versionMetadata;
    if ((updates as any).caseInputValidation !== undefined) updateData.caseInputValidation = (updates as any).caseInputValidation;
    if ((updates as any).sessionOutcome !== undefined) updateData.sessionOutcome = (updates as any).sessionOutcome;
    if ((updates as any).researcherAssistance !== undefined) updateData.researcherAssistance = (updates as any).researcherAssistance;
    if ((updates as any).technicalIssues !== undefined) updateData.technicalIssues = (updates as any).technicalIssues;
    if ((updates as any).mode !== undefined) updateData.mode = (updates as any).mode;
    if (updates.visits !== undefined) updateData.visits = updates.visits;
    if ((updates as any).timelineEvents !== undefined) updateData.timelineEvents = (updates as any).timelineEvents;
    if ((updates as any).deidentifiedEMRs !== undefined) updateData.deidentifiedEMRs = (updates as any).deidentifiedEMRs;
    if ((updates as any).pendingTermConfirmations !== undefined) {
      updateData.pendingTermConfirmations = (updates as any).pendingTermConfirmations;
    }
    if ((updates as any).reviewRequired !== undefined) updateData.reviewRequired = (updates as any).reviewRequired;
    if ((updates as any).staleState !== undefined) updateData.staleState = (updates as any).staleState;
    if ((updates as any).processingCache !== undefined) updateData.processingCache = (updates as any).processingCache;
    if ((updates as any).chainCache !== undefined) updateData.chainCache = (updates as any).chainCache;
    if ((updates as any).chainProgress !== undefined) updateData.chainProgress = (updates as any).chainProgress;
    if ((updates as any).chainPerformanceLogs !== undefined) {
      updateData.chainPerformanceLogs = (updates as any).chainPerformanceLogs;
    }
    if ((updates as any).exportLogs !== undefined) updateData.exportLogs = (updates as any).exportLogs;
    if ((updates as any).finalComposeStatus !== undefined) updateData.finalComposeStatus = (updates as any).finalComposeStatus;
    if (updates.sectionEvidenceMap !== undefined) updateData.sectionEvidenceMap = updates.sectionEvidenceMap;
    if (updates.sectionStatusMap !== undefined) updateData.sectionStatusMap = updates.sectionStatusMap;
    if ((updates as any).draftsBySection !== undefined) updateData.draftsBySection = (updates as any).draftsBySection;
    if ((updates as any).evidenceCards !== undefined) updateData.evidenceCards = (updates as any).evidenceCards;
    if ((updates as any).sectionStates !== undefined) updateData.sectionStates = (updates as any).sectionStates;
    if ((updates as any).commonMissingItems !== undefined) updateData.commonMissingItems = (updates as any).commonMissingItems;
    if ((updates as any).commonQuestionSets !== undefined) updateData.commonQuestionSets = (updates as any).commonQuestionSets;
    if ((updates as any).answerUndoStack !== undefined) updateData.answerUndoStack = (updates as any).answerUndoStack;
    if ((updates as any).sectionDrafts !== undefined) updateData.sectionDrafts = (updates as any).sectionDrafts;
    if ((updates as any).sectionAdequacyReviews !== undefined) updateData.sectionAdequacyReviews = (updates as any).sectionAdequacyReviews;
    if ((updates as any).scaffoldState !== undefined) updateData.scaffoldState = (updates as any).scaffoldState;
    if ((updates as any).researchState !== undefined) updateData.researchState = (updates as any).researchState;
    if ((updates as any).studyConfig !== undefined) updateData.studyConfig = (updates as any).studyConfig;
    if ((updates as any).finalDraft !== undefined) updateData.finalDraft = (updates as any).finalDraft;
    if ((updates as any).studyWrite !== undefined) updateData.studyWrite = (updates as any).studyWrite;

    await CaseMongoModel.updateOne({ id }, { $set: updateData }).exec();
  }

  /**
   * 체인 캐시 항목·성능 로그·섹션 검토를 **원자적으로 병합**한다.
   *
   * 이전에는 요청 시작 때 읽은 문서에서 `chainCache: { ...old, X }`, `chainPerformanceLogs: [...old, log]` 를 만들어
   * 통째로 덮어써, 동시에 돈 다른 요청(예: 다른 섹션 검토, 긴 CHAIN7 작업 중의 답변)의 항목이 사라졌다
   * (docs/prompt_chain_review_v1.md §2-8). 여기서는 `$set: { 'chainCache.X': … }` 와 `$push … $slice: -200` 만 쓴다.
   * 값이 null 인 키는 지운다.
   */
  async recordChainRun(
    id: string,
    params: {
      cacheEntries?: Record<string, ChainCacheEntry | null>;
      performanceLogs?: ChainPerformanceLog[];
      sectionAdequacyReviews?: Record<string, unknown>;
    }
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    const assignAll = (field: string, values: Record<string, unknown> | undefined) => {
      for (const [key, value] of Object.entries(values || {})) {
        if (!key || key.includes('.') || key.startsWith('$')) throw new Error(`invalid ${field} key: ${key}`);
        if (value === null) unset[`${field}.${key}`] = '';
        else if (value !== undefined) set[`${field}.${key}`] = value;
      }
    };
    assignAll('chainCache', params.cacheEntries as Record<string, unknown> | undefined);
    assignAll('sectionAdequacyReviews', params.sectionAdequacyReviews);
    const logs = (params.performanceLogs || []).filter(Boolean);

    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;
    if (logs.length > 0) update.$push = { chainPerformanceLogs: { $each: logs, $slice: -200 } };
    if (Object.keys(update).length === 0) return;

    try {
      await CaseMongoModel.updateOne({ id }, update).exec();
    } catch (error) {
      // 옛 문서에서 필드가 null 이면 점 경로 갱신이 실패한다. 그때만 읽어서 합친 값으로 쓴다.
      const doc: any = await CaseMongoModel.findOne({ id }).lean().exec();
      if (!doc) throw error;
      const chainCache = { ...(doc.chainCache || {}) };
      for (const [key, value] of Object.entries(params.cacheEntries || {})) {
        if (value === null) delete chainCache[key];
        else if (value !== undefined) chainCache[key] = value;
      }
      const reviews = { ...(doc.sectionAdequacyReviews || {}), ...(params.sectionAdequacyReviews || {}) };
      await CaseMongoModel.updateOne(
        { id },
        {
          $set: {
            chainCache,
            sectionAdequacyReviews: reviews,
            chainPerformanceLogs: [...(Array.isArray(doc.chainPerformanceLogs) ? doc.chainPerformanceLogs : []), ...logs].slice(-200)
          }
        }
      ).exec();
    }
  }

  async getSectionInteraction(caseId: string, sectionId: CareSection): Promise<SectionInteraction | null> {
    const interaction = await this.getInteractionByKey(caseId, sectionId);
    if (!interaction) return null;

    return {
      sectionId: interaction.sectionId as CareSection,
      qnaHistory: interaction.qnaHistory || []
    };
  }

  async saveSectionInteraction(caseId: string, interaction: SectionInteraction): Promise<void> {
    await this.saveInteractionByKey(caseId, interaction);
  }

  async deleteCase(id: string): Promise<void> {
    await SectionInteractionModel.deleteMany({ caseId: id }).exec();
    await CaseMongoModel.deleteOne({ id }).exec();
  }
}
