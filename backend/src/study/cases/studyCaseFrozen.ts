import { createHash } from 'crypto';
import { DEFAULT_STUDY_CASE, isFixedStudyCaseText } from './defaultStudyCase';
import { FIXED_STUDY_CASE_PROCESSED } from './defaultStudyCaseProcessed.generated';

/**
 * Frozen processing result for the fixed virtual-patient study case.
 *
 * The live pipeline is not deterministic: two participants given the same EMR
 * get differently worded AI drafts and a different set of evidence cards, which
 * makes their sentence-level judgments impossible to compare. For the study the
 * result of one reviewed run is stored and handed to every participant, so all
 * of them judge exactly the same drafts (and nobody waits for processing).
 *
 * Regenerate with `npm run study:freeze -- <caseId>` after the study EMR
 * changes; a frozen result for a different EMR text is ignored.
 */
type FrozenStudyCase = {
  emrTextHash: string;
  sourceCaseId: string;
  sourceExperimentCode: string | null;
  frozenAt: string;
  fields: Record<string, unknown>;
};

export function studyEmrTextHash(texts: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify(texts.map((text) => String(text || '').replace(/\r\n/g, '\n').trim())))
    .digest('hex');
}

export function getFrozenStudyCaseResult(visitTexts: string[]): Record<string, unknown> | null {
  const frozen = FIXED_STUDY_CASE_PROCESSED as FrozenStudyCase | null;
  if (!frozen?.fields) return null;
  if (!isFixedStudyCaseText(visitTexts)) return null;

  const currentHash = studyEmrTextHash(DEFAULT_STUDY_CASE.visits.map((visit) => visit.soapText));
  if (frozen.emrTextHash !== currentHash) {
    console.warn(
      '[STUDY FROZEN] frozen result was made for a different study EMR; running the live pipeline. ' +
        'Regenerate with `npm run study:freeze -- <caseId>`.'
    );
    return null;
  }

  // Callers persist these structures per case.
  return JSON.parse(JSON.stringify(frozen.fields));
}
