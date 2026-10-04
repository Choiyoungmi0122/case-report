import { randomUUID } from 'crypto';
import { CareSection, SectionStatus } from '../types';
import { careSectionRubricMap } from '../config/careSectionRubric';
import {
  runQuestionGeneration,
  runSectionAdequacyReview,
  runSectionMissingDetection
} from '../llm/chains';
import { EvidenceCard } from '../llm/schemas/chain1_splitTag';
import { SectionDraft } from '../llm/schemas/chain3_draft';
import {
  ManuscriptReviewDocument,
  ManuscriptReviewRunResult,
  ManuscriptSectionAssessment,
  ManuscriptReviewSectionId,
  ManuscriptSectionReviewResult,
  MANUSCRIPT_REVIEW_SECTION_IDS
} from './types';

const REVIEW_WRAPPER_SECTIONS: CareSection[] = [
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

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) break;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
}

function buildAssessmentStatus(text: string, confidence: number): SectionStatus {
  if (!String(text || '').trim()) return SectionStatus.IMPOSSIBLE;
  return confidence >= 0.82 ? SectionStatus.READY : SectionStatus.INCOMPLETE;
}

function buildAssessmentRationale(sectionId: ManuscriptReviewSectionId, text: string, confidence: number): string {
  if (!String(text || '').trim()) {
    return `${sectionId} section text was not detected in the imported manuscript.`;
  }
  if (confidence >= 0.82) {
    return `${sectionId} section text was detected with a relatively clear match.`;
  }
  return `${sectionId} section text was detected, but the automatic mapping confidence is low and should be reviewed.`;
}

function aggregateConfidence(
  review: ManuscriptReviewDocument,
  sectionId: ManuscriptReviewSectionId
): number {
  const matches = review.sectionCandidates.filter((candidate) => {
    const resolvedSection = candidate.confirmedSection || candidate.matchedSection;
    return candidate.status === 'CONFIRMED' && resolvedSection === sectionId;
  });

  if (matches.length === 0) return 0;
  return Number((Math.max(...matches.map((candidate) => candidate.confidence)) || 0).toFixed(3));
}

function buildImportedReferenceCards(review: ManuscriptReviewDocument): EvidenceCard[] {
  return review.sectionCandidates
    .filter((candidate) => candidate.status === 'CONFIRMED')
    .map((candidate) => {
      const resolvedSection = candidate.confirmedSection || candidate.matchedSection;
      const tags = resolvedSection && resolvedSection !== 'KEYWORDS' ? [resolvedSection as CareSection] : [];

      return {
        id: `imported_ref_${candidate.candidateId}_${randomUUID()}`,
        visitIndex: 1,
        visitDateTime: '',
        sourceText: candidate.detectedText,
        normalizedText: candidate.detectedText,
        evidenceType: 'imported_manuscript_reference',
        tags,
        sectionHints: tags,
        terms: [],
        confidence: candidate.confidence || 0.8
      };
    });
}

function buildImportedSectionDrafts(
  sectionTextsBySection: Partial<Record<ManuscriptReviewSectionId, string>>,
  evidenceCards: EvidenceCard[]
): SectionDraft[] {
  return REVIEW_WRAPPER_SECTIONS.filter((sectionId) => String(sectionTextsBySection[sectionId] || '').trim())
    .map((sectionId) => {
      const supportingIds = evidenceCards
        .filter((card) => (card.tags || []).includes(sectionId))
        .map((card) => card.id);

      return {
        sectionId,
        evidenceCardIdsUsed: supportingIds,
        timelineEventIdsUsed: [],
        draftText: sectionTextsBySection[sectionId] || '',
        openIssues: [],
        evidenceLinks: [],
        unsupportedClaims: []
      };
    });
}

function evaluateKeywordsSection(
  text: string
): Omit<
  ManuscriptSectionReviewResult,
  'sectionId' | 'matchedSection' | 'confidence' | 'assessmentStatus' | 'detectedText'
> {
  const normalized = String(text || '').toLowerCase();
  const missingItems: string[] = [];
  const suggestedQuestions: string[] = [];

  if (!normalized.includes('case report') && !normalized.includes('case study')) {
    missingItems.push("Include 'case report' or 'case study' in the keyword list.");
    suggestedQuestions.push("Please revise the keyword section so it explicitly includes 'case report'.");
  }

  const keywordCount = String(text || '')
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean).length;

  if (keywordCount < 3) {
    missingItems.push('Provide a more complete keyword list covering diagnosis, symptoms, or interventions.');
    suggestedQuestions.push('Please add more precise keywords describing the condition, symptoms, intervention, and manuscript type.');
  }

  return {
    adequacy: missingItems.length === 0 ? 'ADEQUATE' : keywordCount > 0 ? 'BORDERLINE' : 'INSUFFICIENT',
    summary:
      missingItems.length === 0
        ? 'The keyword section meets the basic CARE-oriented requirements.'
        : 'The keyword section exists, but it still needs revision to better fit CARE-oriented reporting.',
    missingItems,
    depthIssues: [],
    suggestedQuestions: uniqueStrings(suggestedQuestions)
  };
}

export async function runImportedManuscriptReview(
  review: ManuscriptReviewDocument
): Promise<ManuscriptReviewRunResult> {
  const sectionTextsBySection = review.sectionTextsBySection || {};
  const referenceCards = buildImportedReferenceCards(review);
  const sectionDrafts = buildImportedSectionDrafts(sectionTextsBySection, referenceCards);

  const sectionAssessments: ManuscriptSectionAssessment[] = MANUSCRIPT_REVIEW_SECTION_IDS.map((sectionId) => {
    const text = sectionTextsBySection[sectionId] || '';
    const confidence = aggregateConfidence(review, sectionId);
    return {
      sectionId,
      status: buildAssessmentStatus(text, confidence),
      rationaleText: buildAssessmentRationale(sectionId, text, confidence)
    };
  });

  const titleText = sectionTextsBySection.TITLE || '';
  const chain4Result = sectionDrafts.length
    ? await runSectionMissingDetection({
        sectionDrafts,
        evidenceCards: referenceCards,
        caseTitle: titleText
      })
    : { sectionMissing: [], commonMissing: [] };

  const chain5Result = sectionDrafts.length
    ? await runQuestionGeneration({
        sectionDrafts,
        sectionMissing: chain4Result.sectionMissing,
        commonMissing: chain4Result.commonMissing,
        caseTitle: titleText
      })
    : { commonQuestions: [], sectionQuestions: [] };

  const adequacyPairs = await mapWithConcurrency(sectionDrafts, 3, async (draft) => {
    const relevantCards = referenceCards.filter((card) => (card.tags || []).includes(draft.sectionId));
    const reviewResult = await runSectionAdequacyReview({
      sectionId: draft.sectionId,
      currentDraft: draft.draftText,
      evidenceCards: relevantCards,
      qnaHistory: []
    });
    return [draft.sectionId, reviewResult] as const;
  });
  const adequacyBySection = new Map<string, Awaited<ReturnType<typeof runSectionAdequacyReview>>>(
    adequacyPairs
  );

  const missingBySection = new Map(
    (chain4Result.sectionMissing || []).map((entry) => [entry.sectionId, entry.missingItems || []] as const)
  );
  const questionsBySection = new Map(
    (chain5Result.sectionQuestions || []).map((entry) => [entry.sectionId, entry.questions || []] as const)
  );
  const commonQuestions = chain5Result.commonQuestions || [];

  const sectionResults: ManuscriptSectionReviewResult[] = MANUSCRIPT_REVIEW_SECTION_IDS.map((sectionId) => {
    const detectedText = sectionTextsBySection[sectionId] || '';
    const confidence = aggregateConfidence(review, sectionId);
    const assessment = sectionAssessments.find((item) => item.sectionId === sectionId)!;

    if (sectionId === 'KEYWORDS') {
      const keywordReview = evaluateKeywordsSection(detectedText);
      return {
        sectionId,
        detectedText,
        matchedSection: detectedText ? 'KEYWORDS' : null,
        confidence,
        assessmentStatus: assessment.status,
        adequacy: keywordReview.adequacy,
        summary: keywordReview.summary,
        missingItems: keywordReview.missingItems,
        depthIssues: keywordReview.depthIssues,
        suggestedQuestions: keywordReview.suggestedQuestions
      };
    }

    const adequacy = adequacyBySection.get(sectionId);
    const sectionSpecificQuestions = questionsBySection.get(sectionId as CareSection) || [];
    const relatedCommonQuestions = commonQuestions
      .filter((entry) => (entry.targetSectionIds || []).includes(sectionId as CareSection))
      .map((entry) => entry.question);
    const rubric = careSectionRubricMap[sectionId as keyof typeof careSectionRubricMap];

    if (!detectedText.trim() || !adequacy) {
      return {
        sectionId,
        detectedText,
        matchedSection: detectedText ? sectionId : null,
        confidence,
        assessmentStatus: assessment.status,
        adequacy: 'INSUFFICIENT',
        summary: `${sectionId} section text was not confidently detected, so the CARE completeness review is limited.`,
        missingItems: rubric?.requiredItems || [],
        depthIssues: [],
        suggestedQuestions: uniqueStrings([...sectionSpecificQuestions, ...relatedCommonQuestions])
      };
    }

    return {
      sectionId,
      detectedText,
      matchedSection: sectionId,
      confidence,
      assessmentStatus: assessment.status,
      adequacy: adequacy.adequacyStatus,
      summary: adequacy.summary,
      missingItems: uniqueStrings([
        ...(missingBySection.get(sectionId as CareSection) || []),
        ...(adequacy.missingRequiredItems || [])
      ]),
      depthIssues: adequacy.depthIssues || [],
      suggestedQuestions: uniqueStrings([...sectionSpecificQuestions, ...relatedCommonQuestions])
    };
  });

  return {
    sectionAssessments,
    sectionResults,
    commonMissingItems: (chain4Result.commonMissing || []).map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[],
      category: item.category
    })),
    commonQuestionSets: (chain5Result.commonQuestions || []).map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[],
      category: item.category
    })),
    sectionTextsBySection
  };
}
