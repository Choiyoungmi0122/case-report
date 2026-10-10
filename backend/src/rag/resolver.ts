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

  // 뜻이 비슷한 것(semantic)은 "같은 용어를 다르게 쓴 것"이 아니다. "가슴이"·"심장"·약재 "초과"가
  // 심계·불안의 후보로 올라와 사용자에게 묻거나 조용히 바꾸던 문제. 용어 확인은 오타·약어·별칭에만
  // 쓰고, 뜻 유사 매칭은 원문을 그대로 둔다 (사용자 결정 2026-10-11).
  if (primary.matchType === 'semantic') {
    return {
      decision: 'KEEP_ORIGINAL',
      confidence: primary.score,
      reason: 'Semantic similarity is not evidence of the same term; original text is kept.'
    };
  }

  const clearlyWeak =
    primary.matchType === 'fuzzy'
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
