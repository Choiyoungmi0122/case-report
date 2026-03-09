import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { CareSection, QnAPair } from '../types';
import { runChain4_updateDraft } from '../llm/chains';

const router = express.Router();
const caseModel = new CaseModel();

// GET /api/cases/:id/sections/:sectionId - Get section details (새 체인 기반)
router.get('/:id/sections/:sectionId', async (req: Request, res: Response) => {
  try {
    const { id, sectionId } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const section = sectionId as CareSection;

    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];

    const state = sectionStates.find((s) => s.sectionId === section);
    const draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    const interaction = await caseModel.getSectionInteraction(id, section);

    if (!state) {
      return res.status(404).json({ error: 'Section not found' });
    }

    res.json({
      section: sectionId,
      status: state.status,
      rationaleText: state.rationaleText,
      missingInfoBullets: state.missingInfoBullets || [],
      recommendedQuestions: state.recommendedQuestions || [],
      currentDraft: draftEntry?.draftText || '',
      evidenceCards: relevantEvidence,
      qnaHistory: interaction?.qnaHistory || []
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

    const section = sectionId as CareSection;
    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];

    const state = sectionStates.find((s) => s.sectionId === section);
    let draftEntry = sectionDrafts.find((d) => d.sectionId === section);
    const relevantEvidence = evidenceCards.filter((c) =>
      (c.tags || []).includes(section)
    );

    if (!state) {
      return res.status(404).json({ error: 'Section not found' });
    }

    if (!draftEntry) {
      draftEntry = {
        sectionId: section,
        draftText: '',
        evidenceCardIdsUsed: [],
        openIssues: state.missingInfoBullets || []
      };
      sectionDrafts.push(draftEntry);
    }

    const pendingItems: string[] = draftEntry.openIssues || state.missingInfoBullets || [];

    const interaction = await caseModel.getSectionInteraction(id, section);
    const qnaHistory: QnAPair[] = interaction?.qnaHistory || [];

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
  } catch (error: any) {
    console.error('Error in section next-step:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
