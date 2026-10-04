import { AMBIGUOUS_DELTA } from './retriever';
import { RetrievedTermCandidate, TerminologyResolverDecision } from './types';

export interface RetrievedTermResolver {
  resolve(input: {
    original: string;
    candidates: RetrievedTermCandidate[];
  }): Promise<TerminologyResolverDecision> | TerminologyResolverDecision;
}

function clampConfidence(score: number): number {
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function validateDecision(
  decision: TerminologyResolverDecision,
  candidates: RetrievedTermCandidate[]
): TerminologyResolverDecision {
  const validIds = new Set(candidates.map((candidate) => candidate.termId));
  if (decision.decision === 'USE_CANDIDATE' && (!decision.selectedTermId || !validIds.has(decision.selectedTermId))) {
    return {
      decision: 'ASK_USER',
      confidence: clampConfidence(decision.confidence),
      reason: 'Resolver selected a term outside the retrieved candidate set.'
    };
  }

  return {
    ...decision,
    confidence: clampConfidence(decision.confidence)
  };
}

export async function resolveRetrievedTerminology(params: {
  original: string;
  candidates: RetrievedTermCandidate[];
  llmResolver?: RetrievedTermResolver;
}): Promise<TerminologyResolverDecision> {
  const candidates = (params.candidates || []).slice(0, 3);
  if (candidates.length === 0) {
    return {
      decision: 'KEEP_ORIGINAL',
      confidence: 1,
      reason: 'No retrieved terminology candidate was available.'
    };
  }

  const primary = candidates[0];
  const runnerUp = candidates[1];
  const isDeterministic =
    ['exact', 'synonym', 'typo', 'alias'].includes(primary.matchType) &&
    (!runnerUp || runnerUp.score < primary.score - AMBIGUOUS_DELTA);

  if (isDeterministic) {
    return {
      decision: 'USE_CANDIDATE',
      selectedTermId: primary.termId,
      confidence: primary.score,
      reason: `Deterministic ${primary.matchType} match.`
    };
  }

  const clearlyWeak =
    primary.matchType === 'semantic'
      ? primary.score < 0.65
      : primary.matchType === 'fuzzy'
        ? primary.score < primary.term.confidenceThreshold
        : false;

  if (clearlyWeak) {
    return {
      decision: 'KEEP_ORIGINAL',
      confidence: primary.score,
      reason: `${primary.matchType} score is too weak to normalize safely.`
    };
  }

  const confidentlySingleMatch =
    candidates.length === 1 &&
    primary.matchType === 'fuzzy' &&
    primary.score >= Math.max(primary.term.confidenceThreshold, 0.9);

  if (confidentlySingleMatch) {
    return {
      decision: 'USE_CANDIDATE',
      selectedTermId: primary.termId,
      confidence: primary.score,
      reason: 'Single high-confidence fuzzy match.'
    };
  }

  if (params.llmResolver) {
    try {
      const resolved = await Promise.resolve(
        params.llmResolver.resolve({
          original: params.original,
          candidates
        })
      );
      return validateDecision(resolved, candidates);
    } catch (error) {
      console.warn('[RAG] LLM resolver failed, falling back to ASK_USER:', error);
    }
  }

  return {
    decision: 'ASK_USER',
    confidence: primary.score,
    reason: `Multiple plausible ${primary.matchType} candidates require confirmation.`
  };
}
