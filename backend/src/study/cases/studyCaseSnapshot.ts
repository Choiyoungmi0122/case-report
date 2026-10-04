import { createHash } from 'crypto';
import { getModelForChain } from '../../llm/chains';
import { chain1SystemPrompt, buildChain1UserPrompt } from '../../llm/prompts/chain1_splitTag';
import { chain2SystemPrompt, buildChain2UserPrompt } from '../../llm/prompts/chain2_assess';
import { isFixedStudyCaseText } from './defaultStudyCase';
import { FIXED_STUDY_CASE_ANALYSIS } from './defaultStudyCaseAnalysis.generated';

/**
 * Pre-computed analysis (preprocessing + CHAIN1 + CHAIN2) of the fixed
 * virtual-patient study case.
 *
 * Every participant starts from the same EMR, so running the extraction again
 * per participant only adds a ~1 minute wait and lets model nondeterminism give
 * participants slightly different evidence cards. The snapshot makes the
 * analysis instant and identical for everyone.
 *
 * Regenerate with `npm run study:snapshot` whenever the study EMR, the
 * CHAIN1/CHAIN2 prompts or their models change; a stale snapshot is detected by
 * its key and ignored, which falls back to the live pipeline.
 */
export type FixedStudyCaseAnalysis = {
  key: string;
  generatedAt: string;
  models: { chain1: string; chain2: string };
  preprocessed: any;
  evidenceCards: any[];
  sectionStates: any[];
};

type SnapshotVisit = { index: number; date: string; text: string };

export function buildStudySnapshotKey(visits: SnapshotVisit[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        visits: visits.map((visit) => [
          visit.index,
          visit.date || '',
          String(visit.text || '').replace(/\r\n/g, '\n').trim()
        ]),
        chain1: [chain1SystemPrompt, buildChain1UserPrompt('{{input}}'), getModelForChain('chain1')],
        chain2: [
          chain2SystemPrompt,
          buildChain2UserPrompt({ evidenceSummary: '{{input}}' }),
          getModelForChain('chain2')
        ]
      })
    )
    .digest('hex');
}

export function getFixedStudyCaseAnalysis(visits: SnapshotVisit[]): FixedStudyCaseAnalysis | null {
  const snapshot = FIXED_STUDY_CASE_ANALYSIS as FixedStudyCaseAnalysis | null;
  if (!snapshot) return null;
  if (!isFixedStudyCaseText(visits.map((visit) => visit.text || ''))) return null;

  if (snapshot.key !== buildStudySnapshotKey(visits)) {
    console.warn(
      '[STUDY SNAPSHOT] stored analysis no longer matches the study EMR / CHAIN1-2 prompts; ' +
        'running the live pipeline. Regenerate with `npm run study:snapshot`.'
    );
    return null;
  }

  // Callers mutate and persist these structures per case.
  return JSON.parse(JSON.stringify(snapshot)) as FixedStudyCaseAnalysis;
}
