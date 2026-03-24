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
      aiPipeline: (doc as any).aiPipeline || null,
      // 새 체인 필드는 Case 타입에 아직 없을 수 있으므로 any로 유지
      // (필요 시 types/index.ts 확장)
    }));
  }

  async getCase(id: string): Promise<Case | null> {
    const doc = await CaseMongoModel.findOne({ id }).exec();
    if (!doc) return null;

    // draftsBySection는 예전 체인용 필드이고,
    // sectionDrafts는 새 체인(Chain3/4)에서 사용하는 배열 필드다.
    // 기존 필드가 남아 있어도, 최신 sectionDrafts 값을 우선 반영해
    // 프론트엔드가 stale draftsBySection을 읽지 않도록 맞춘다.
    const rawDraftsBySection = doc.draftsBySection || {};
    const rawSectionDrafts: any[] = (doc as any).sectionDrafts || [];
    const draftsBySection = rawSectionDrafts.reduce(
      (acc: Record<string, string>, d: any) => {
        if (d && typeof d.sectionId === 'string') {
          acc[d.sectionId] = d.draftText || '';
        }
        return acc;
      },
      { ...rawDraftsBySection }
    );

    return {
      id: doc.id,
      createdAt: doc.createdAt.toISOString(),
      title: doc.title || undefined,
      visits: doc.visits,
      sectionEvidenceMap: doc.sectionEvidenceMap || {},
      sectionStatusMap: doc.sectionStatusMap || {},
      draftsBySection,
      // 새 체인(Chain2/3) 결과 — GET /cases/:id/sections 및 Q&A에서 사용
      sectionStates: (doc as any).sectionStates || [],
      sectionDrafts: rawSectionDrafts,
      aiPipeline: (doc as any).aiPipeline || null,
      finalDraft: (doc as any).finalDraft || null
    } as Case & { sectionStates?: any[]; sectionDrafts?: any[]; aiPipeline?: any; finalDraft?: any };
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
    if ((updates as any).aiPipeline !== undefined) updateData.aiPipeline = (updates as any).aiPipeline;

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
