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
      reason: '판정기가 검색된 후보 밖의 용어를 골랐습니다.'
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
      reason: '검색된 용어 후보가 없습니다.'
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
      reason: `사전 ${primary.matchType} 일치로 확정했습니다.`
    };
  }

  // 뜻이 비슷한 것(semantic)은 "같은 용어를 다르게 쓴 것"이 아니다. "가슴이"·"심장"·약재 "초과"가
  // 심계·불안의 후보로 올라와 사용자에게 묻거나 조용히 바꾸던 문제. 용어 확인은 오타·약어·별칭에만
  // 쓰고, 뜻 유사 매칭은 원문을 그대로 둔다 (사용자 결정 2026-10-11).
  if (primary.matchType === 'semantic') {
    return {
      decision: 'KEEP_ORIGINAL',
      confidence: primary.score,
      reason: '뜻이 비슷한 것은 같은 용어라는 근거가 아니므로 원문을 둡니다.'
    };
  }

  // 부분 일치("귀비" ⊂ "귀비탕", "심장" ⊂ "심장이 뜀")도 같은 용어라는 근거가 못 된다. 사전이 커지면서
  // 이런 후보가 늘어 판정 LLM 호출이 두 배가 됐다. 묻지 않고 원문을 둔다 (사용자 결정 2026-10-11).
  if (primary.matchType === 'partial') {
    return {
      decision: 'KEEP_ORIGINAL',
      confidence: primary.score,
      reason: '글자 일부가 겹치는 것은 같은 용어라는 근거가 아니므로 원문을 둡니다.'
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
      reason: `${primary.matchType} 점수가 낮아 원문을 둡니다.`
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
      reason: '후보가 하나이고 유사도가 높아 확정했습니다.'
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
      // 판정기 장애 때 ASK_USER 로 떨어지면 기록마다 확인 요청이 수십 개씩 쏟아졌다. 본문은 바꾸지 않으므로
      // (rewriteText:false) 원문을 두는 것이 안전하다. 장애는 로그로 남긴다 (2026-10-12).
      console.warn('[RAG] LLM resolver failed, keeping original text:', (error as Error)?.message || error);
      return {
        decision: 'KEEP_ORIGINAL',
        confidence: primary.score,
        reason: '용어 판정기를 호출하지 못해 원문을 둡니다.'
      };
    }
  }

  return {
    decision: 'ASK_USER',
    confidence: primary.score,
    reason: `${primary.matchType} 후보가 여럿이라 확인이 필요합니다.`
  };
}
