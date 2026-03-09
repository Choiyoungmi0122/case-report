import express, { Request, Response } from 'express';
import { CaseModel } from '../models/caseModel';
import { Visit, CareSection } from '../types';
import {
  runChain1_splitEvidence,
  runChain2_assess,
  runChain3_initialDrafts,
  runChain4_updateDraft,
  runChain5_finalCompose
} from '../llm/chains';

const router = express.Router();
const caseModel = new CaseModel();

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

    const evidenceCards = await runChain1_splitEvidence(visitsForChain1);

    // Chain 2: SectionState 평가
    const sectionStates = await runChain2_assess(evidenceCards);

    // Chain 3: 섹션별 임시 초안 생성
    const sectionDrafts = await runChain3_initialDrafts(evidenceCards, sectionStates);

    // 케이스에 새 체인 결과 저장
    await caseModel.updateCase(id, {
      // 기존 필드는 비워두지 않고, 새 필드로 별도 저장
      ...(case_ as any),
      evidenceCards,
      sectionStates,
      sectionDrafts
    } as any);

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

    const finalDraft = await runChain5_finalCompose({
      sectionDrafts,
      evidenceCards,
      qnaHistoryBySection,
      contributionAnswers
    });

    await caseModel.updateCase(id, {
      ...(anyCase as any),
      finalDraft
    } as any);

    res.json({ caseId: id, finalDraft });
  } catch (error: any) {
    console.error('Error in final-compose:', error);
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
