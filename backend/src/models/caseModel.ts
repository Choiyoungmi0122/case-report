import { Case, SectionInteraction, CareSection } from '../types';
import { CaseModel as CaseMongoModel, SectionInteractionModel } from '../db/schema';

export class CaseModel {
  async createCase(caseData: Omit<Case, 'id' | 'createdAt'>): Promise<string> {
    const id = `case_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date();

    try {
      const newCase = new CaseMongoModel({
        id,
        createdAt,
        title: caseData.title || null,
        visits: caseData.visits,
        sectionEvidenceMap: caseData.sectionEvidenceMap || {},
        sectionStatusMap: caseData.sectionStatusMap || {},
        draftsBySection: caseData.draftsBySection || {}
      });

      await newCase.save();
      return id;
    } catch (error: any) {
      console.error('Error in createCase:', error);
      throw error;
    }
  }

  async getAllCases(): Promise<Case[]> {
    const docs = await CaseMongoModel.find({}).sort({ createdAt: -1 }).exec();
    
    return docs.map(doc => ({
      id: doc.id,
      createdAt: doc.createdAt.toISOString(),
      title: doc.title || undefined,
      visits: doc.visits,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: doc.sectionStatusMap || {},
      draftsBySection: doc.draftsBySection || {},
      // 새 체인 필드는 Case 타입에 아직 없을 수 있으므로 any로 유지
      // (필요 시 types/index.ts 확장)
    }));
  }

  async getCase(id: string): Promise<Case | null> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) return null;

    return {
      id: doc.id,
      createdAt: doc.createdAt.toISOString(),
      title: doc.title || undefined,
      visits: doc.visits,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: doc.sectionStatusMap || {},
      draftsBySection: doc.draftsBySection || {}
    };
  }

  async updateCase(id: string, updates: Partial<Case>): Promise<void> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) throw new Error('Case not found');

    const updateData: any = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.visits !== undefined) updateData.visits = updates.visits;
    if (updates.sectionEvidenceMap !== undefined) updateData.sectionEvidenceMap = updates.sectionEvidenceMap;
    if (updates.sectionStatusMap !== undefined) updateData.sectionStatusMap = updates.sectionStatusMap;
    if (updates.draftsBySection !== undefined) updateData.draftsBySection = updates.draftsBySection;
    // 새 체인용 필드 (Case 타입에 없을 수 있으므로 any로 처리)
    if ((updates as any).evidenceCards !== undefined) updateData.evidenceCards = (updates as any).evidenceCards;
    if ((updates as any).sectionStates !== undefined) updateData.sectionStates = (updates as any).sectionStates;
    if ((updates as any).sectionDrafts !== undefined) updateData.sectionDrafts = (updates as any).sectionDrafts;
    if ((updates as any).finalDraft !== undefined) updateData.finalDraft = (updates as any).finalDraft;

    await CaseMongoModel.updateOne({ id }, { $set: updateData }).exec();
  }

  async getSectionInteraction(caseId: string, sectionId: CareSection): Promise<SectionInteraction | null> {
    const doc = await SectionInteractionModel.findOne({ caseId, sectionId }).exec();

    if (!doc) return null;

    return {
      sectionId: doc.sectionId as CareSection,
      qnaHistory: doc.qnaHistory || []
    };
  }

  async saveSectionInteraction(caseId: string, interaction: SectionInteraction): Promise<void> {
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

  async deleteCase(id: string): Promise<void> {
    // 먼저 관련된 section_interactions 삭제
    await SectionInteractionModel.deleteMany({ caseId: id }).exec();
    // 그 다음 case 삭제
    await CaseMongoModel.deleteOne({ id }).exec();
  }
}
