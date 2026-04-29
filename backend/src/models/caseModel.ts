import { Case, SectionInteraction, CareSection } from '../types';
import { CaseModel as CaseMongoModel, SectionInteractionModel } from '../db/schema';

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

    const newCase = new CaseMongoModel({
      id,
      createdAt,
      title: caseData.title || null,
      visits: caseData.visits,
      sectionEvidenceMap: caseData.sectionEvidenceMap || {},
      sectionStatusMap: caseData.sectionStatusMap || {}
    });

    await newCase.save();
    return id;
  }

  async getAllCases(): Promise<Case[]> {
    const docs = await CaseMongoModel.find({}).sort({ createdAt: -1 }).exec();

    return docs.map((doc) => ({
      id: doc.id,
      createdAt: doc.createdAt.toISOString(),
      title: doc.title || undefined,
      visits: doc.visits,
      processingCache: (doc as any).processingCache || undefined,
      finalComposeStatus: (doc as any).finalComposeStatus || undefined,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: normalizeSectionStatusMap(doc.sectionStatusMap || {}),
      draftsBySection: deriveDraftsBySection((doc as any).sectionDrafts || [], doc.draftsBySection || {}),
      sectionStates: normalizeSectionStates((doc as any).sectionStates || []),
      commonMissingItems: (doc as any).commonMissingItems || [],
      commonQuestionSets: (doc as any).commonQuestionSets || [],
      answerUndoStack: (doc as any).answerUndoStack || [],
      sectionDrafts: (doc as any).sectionDrafts || [],
      sectionAdequacyReviews: (doc as any).sectionAdequacyReviews || {},
      finalDraft: (doc as any).finalDraft || null
    }));
  }

  async getCase(id: string): Promise<Case | null> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) return null;

    const rawDraftsBySection = doc.draftsBySection || {};
    const rawSectionDrafts: any[] = (doc as any).sectionDrafts || [];
    const draftsBySection = deriveDraftsBySection(rawSectionDrafts, rawDraftsBySection);

    return {
      id: doc.id,
      createdAt: doc.createdAt.toISOString(),
      title: doc.title || undefined,
      visits: doc.visits,
      processingCache: (doc as any).processingCache || undefined,
      finalComposeStatus: (doc as any).finalComposeStatus || undefined,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: normalizeSectionStatusMap(doc.sectionStatusMap || {}),
      draftsBySection,
      sectionStates: normalizeSectionStates((doc as any).sectionStates || []),
      commonMissingItems: (doc as any).commonMissingItems || [],
      commonQuestionSets: (doc as any).commonQuestionSets || [],
      answerUndoStack: (doc as any).answerUndoStack || [],
      sectionDrafts: rawSectionDrafts,
      sectionAdequacyReviews: (doc as any).sectionAdequacyReviews || {},
      finalDraft: (doc as any).finalDraft || null
    } as Case & { sectionStates?: any[]; sectionDrafts?: any[]; finalDraft?: any };
  }

  async updateCase(id: string, updates: Partial<Case>): Promise<void> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) throw new Error('Case not found');

    const updateData: any = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.visits !== undefined) updateData.visits = updates.visits;
    if ((updates as any).processingCache !== undefined) updateData.processingCache = (updates as any).processingCache;
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
    if ((updates as any).finalDraft !== undefined) updateData.finalDraft = (updates as any).finalDraft;

    await CaseMongoModel.updateOne({ id }, { $set: updateData }).exec();
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
