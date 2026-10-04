import express, { Request, Response } from 'express';
import multer from 'multer';
import {
  assertOutboundTextIsSafe,
  createOutboundDeidContext,
  deidentifyOutboundField
} from '../deid/outbound';
import { ManuscriptReviewModel } from '../models/manuscriptReviewModel';
import { extractDocxContent } from '../manuscriptReview/parser';
import { buildSectionTextsBySection, mapBlocksToSectionCandidates } from '../manuscriptReview/sectionMapper';
import {
  ManuscriptReviewDocument,
  ManuscriptReviewSectionId,
  MANUSCRIPT_REVIEW_SECTION_IDS
} from '../manuscriptReview/types';
import { runImportedManuscriptReview } from '../manuscriptReview/adapters';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const manuscriptReviewModel = new ManuscriptReviewModel();

function isManuscriptReviewSectionId(value: string): value is ManuscriptReviewSectionId {
  return MANUSCRIPT_REVIEW_SECTION_IDS.includes(value as ManuscriptReviewSectionId);
}

/**
 * An uploaded manuscript never passed through the EMR de-identification
 * pipeline, so its extracted text is de-identified here - after local parsing,
 * before anything is sent to an external model. The .docx file itself is never
 * forwarded to a provider; only extracted, de-identified text is.
 *
 * A HIGH residual risk blocks the review outright, matching the EMR policy:
 * no outbound call is made for a document that still carries a phone number,
 * resident registration number, or e-mail address.
 */
async function buildOutboundManuscriptDocument(document: ManuscriptReviewDocument) {
  const sharedContext = createOutboundDeidContext();
  const outboundCandidates = [];

  for (const candidate of document.sectionCandidates || []) {
    outboundCandidates.push({
      ...candidate,
      detectedText: await deidentifyOutboundField(candidate.detectedText, sharedContext)
    });
  }

  const sectionTextsBySection = buildSectionTextsBySection(outboundCandidates as any);

  for (const text of Object.values(sectionTextsBySection)) {
    assertOutboundTextIsSafe(String(text || ''), 'MANUSCRIPT review');
  }

  return {
    ...document,
    sectionCandidates: outboundCandidates as any,
    sectionTextsBySection
  };
}

async function rerunReview(document: ManuscriptReviewDocument) {
  // Stored (raw) section text keeps the document readable for the user; the
  // de-identified projection is what the review chains receive.
  const sectionTextsBySection = buildSectionTextsBySection(document.sectionCandidates || []);
  const manualConfirmationRequired = (document.sectionCandidates || []).some(
    (candidate) => candidate.status === 'PENDING'
  );
  const reviewResults = await runImportedManuscriptReview(
    await buildOutboundManuscriptDocument(document)
  );

  const parseStatus = manualConfirmationRequired ? 'NEEDS_SECTION_CONFIRMATION' : 'REVIEWED';

  await manuscriptReviewModel.update(document.id, {
    sectionTextsBySection,
    manualConfirmationRequired,
    reviewResults,
    parseStatus,
    errorMessage: null
  });

  return manuscriptReviewModel.getById(document.id);
}

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No .docx file was uploaded.' });
    }

    if (!/\.docx$/i.test(file.originalname || '')) {
      return res.status(400).json({ error: 'Only .docx files are supported.' });
    }

    const parsed = await extractDocxContent(file.buffer);
    const sectionCandidates = mapBlocksToSectionCandidates(parsed.blocks);
    const sectionTextsBySection = buildSectionTextsBySection(sectionCandidates);
    const manualConfirmationRequired = sectionCandidates.some((candidate) => candidate.status === 'PENDING');

    const id = await manuscriptReviewModel.create({
      sourceType: 'imported_manuscript',
      fileName: file.originalname,
      parseStatus: manualConfirmationRequired ? 'NEEDS_SECTION_CONFIRMATION' : 'PARSED',
      rawText: parsed.rawText,
      rawHtml: parsed.rawHtml,
      blocks: parsed.blocks,
      sectionCandidates,
      sectionTextsBySection,
      reviewResults: null,
      manualConfirmationRequired,
      errorMessage: null
    });

    const created = await manuscriptReviewModel.getById(id);
    if (!created) {
      return res.status(500).json({ error: 'Imported manuscript could not be loaded after creation.' });
    }

    const reviewed = await rerunReview(created);
    return res.status(201).json({
      reviewId: id,
      review: reviewed
    });
  } catch (error: any) {
    console.error('Error importing manuscript review docx:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const review = await manuscriptReviewModel.getById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Manuscript review not found.' });
    }

    return res.json(review);
  } catch (error: any) {
    console.error('Error getting manuscript review:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/run-review', async (req: Request, res: Response) => {
  try {
    const review = await manuscriptReviewModel.getById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Manuscript review not found.' });
    }

    const rerun = await rerunReview(review);
    return res.json({
      reviewId: req.params.id,
      review: rerun
    });
  } catch (error: any) {
    console.error('Error rerunning manuscript review:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/sections/:candidateId/confirm', async (req: Request, res: Response) => {
  try {
    const { id, candidateId } = req.params;
    const { sectionId } = req.body as { sectionId?: string };
    const review = await manuscriptReviewModel.getById(id);
    if (!review) {
      return res.status(404).json({ error: 'Manuscript review not found.' });
    }

    if (!sectionId || !isManuscriptReviewSectionId(sectionId)) {
      return res.status(400).json({ error: 'A valid sectionId is required.' });
    }

    const nextCandidates = (review.sectionCandidates || []).map((candidate) => {
      if (candidate.candidateId !== candidateId) return candidate;
      return {
        ...candidate,
        matchedSection: sectionId,
        confirmedSection: sectionId,
        status: 'CONFIRMED' as const,
        needsUserConfirmation: false,
        confidence: Math.max(candidate.confidence || 0, 0.82),
        matchBasis: 'manual' as const
      };
    });

    await manuscriptReviewModel.update(id, {
      sectionCandidates: nextCandidates
    });

    const updated = await manuscriptReviewModel.getById(id);
    if (!updated) {
      return res.status(404).json({ error: 'Updated manuscript review not found.' });
    }

    const rerun = await rerunReview(updated);
    return res.json({
      reviewId: id,
      review: rerun
    });
  } catch (error: any) {
    console.error('Error confirming manuscript section candidate:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/:id/sections/:candidateId/reject', async (req: Request, res: Response) => {
  try {
    const { id, candidateId } = req.params;
    const review = await manuscriptReviewModel.getById(id);
    if (!review) {
      return res.status(404).json({ error: 'Manuscript review not found.' });
    }

    const nextCandidates = (review.sectionCandidates || []).map((candidate) => {
      if (candidate.candidateId !== candidateId) return candidate;
      return {
        ...candidate,
        matchedSection: null,
        confirmedSection: undefined,
        status: 'REJECTED' as const,
        needsUserConfirmation: false,
        rejectedReason: 'USER_REJECTED'
      };
    });

    await manuscriptReviewModel.update(id, {
      sectionCandidates: nextCandidates
    });

    const updated = await manuscriptReviewModel.getById(id);
    if (!updated) {
      return res.status(404).json({ error: 'Updated manuscript review not found.' });
    }

    const rerun = await rerunReview(updated);
    return res.json({
      reviewId: id,
      review: rerun
    });
  } catch (error: any) {
    console.error('Error rejecting manuscript section candidate:', error);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
