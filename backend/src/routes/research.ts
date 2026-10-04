import express, { Request, Response } from 'express';
import { buildResearchExportPayload } from '../export/researchExport';
import { CaseModel } from '../models/caseModel';
import { CareSection } from '../types';

const router = express.Router();
const caseModel = new CaseModel();
const ALL_CARE_SECTIONS = Object.values(CareSection) as CareSection[];
const COMMON_INTERACTION_KEY = '__COMMON__';

function normalizeExperimentCode(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const compact = raw.replace(/-/g, '').toUpperCase();
  const match = compact.match(/^(EQ|SQ)0*(\d+)$/);
  if (!match) {
    const customCode = raw.toUpperCase();
    return /^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(customCode) ? customCode : null;
  }

  const number = Number(match[2]);
  if (!Number.isFinite(number) || number <= 0) return null;

  return `${match[1]}${String(number).padStart(3, '0')}`;
}

function assertResearcherAccess(req: Request, res: Response): boolean {
  const expected = String(process.env.RESEARCH_EXPORT_TOKEN || '').trim();
  if (!expected) return true;

  const provided =
    String(req.header('x-research-token') || '').trim() || String(req.query.token || '').trim();

  if (provided !== expected) {
    res.status(403).json({ error: 'Researcher access token is required for research history.' });
    return false;
  }

  return true;
}

router.get('/cases/by-experiment-code/:experimentCode', async (req: Request, res: Response) => {
  try {
    if (!assertResearcherAccess(req, res)) return;

    const experimentCode = normalizeExperimentCode(req.params.experimentCode);
    if (!experimentCode) {
      return res.status(400).json({ error: 'A valid experimentCode is required.' });
    }

    const cases = await caseModel.getAllCases();
    const caseData = cases.find((item) => String(item.experiment_code || '').toUpperCase() === experimentCode);
    if (!caseData) {
      return res.status(404).json({ error: 'Case not found', experimentCode });
    }

    const researchState = (caseData as any).researchState || {
      studyMode: Boolean((caseData as any).studyConfig?.studyMode),
      interactionEvents: []
    };
    const sectionInteractions = await caseModel.getInteractionsByKeys(caseData.id, [
      ...ALL_CARE_SECTIONS,
      COMMON_INTERACTION_KEY
    ]);

    res.json({
      experimentCode,
      caseId: caseData.id,
      case: {
        id: caseData.id,
        experiment_code: caseData.experiment_code,
        experimentCode: caseData.experiment_code,
        mode: caseData.mode || 'write',
        title: caseData.title,
        createdAt: caseData.createdAt,
        studyConfig: (caseData as any).studyConfig || null,
        studyMetadata: (caseData as any).studyMetadata || null,
        versionMetadata: (caseData as any).versionMetadata || null,
        caseInputValidation: (caseData as any).caseInputValidation || null,
        sessionOutcome: (caseData as any).sessionOutcome || null,
        researcherAssistance: (caseData as any).researcherAssistance || [],
        technicalIssues: (caseData as any).technicalIssues || []
      },
      researchExport: await buildResearchExportPayload({
        caseId: caseData.id,
        caseData,
        researchState,
        sectionInteractions
      })
    });
  } catch (error: any) {
    console.error('Error getting case by experiment code:', error);
    res.status(500).json({ error: error.message || 'Failed to get research history.' });
  }
});

export default router;
