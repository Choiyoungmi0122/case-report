/**
 * CHAIN4(누락 탐지) → CHAIN5(질문 생성) 갱신의 단일 구현.
 *
 * 2026-10-11까지 `routes/cases.ts`(처리·재처리·공통 답변)와 `routes/sections.ts`(섹션 답변)에 구현이 두 벌 있었고
 * 동작이 달랐다(docs/prompt_chain_review_v1.md §2-2): 초안 없는 섹션의 IMPOSSIBLE 처리, 모델이 섹션을 빠뜨렸을 때
 * 이전 값 유지 여부, rationaleText 덮어쓰기. 여기서는 다음으로 정한다.
 *  - 누락 항목·추천 질문은 모델 결과를 그대로 쓴다. CHAIN4 프롬프트가 "충분한 섹션은 missingItems 를 비워 둔다"고
 *    지시하므로 모델이 섹션을 내지 않은 것은 "없음"으로 본다(이전 값을 유지하면 답한 항목이 영원히 남는다).
 *  - 상태: 초안이 없으면 IMPOSSIBLE, 초안이 있고 누락이 남아 있으면 INCOMPLETE, 없으면 READY (핵심 AI 섹션만).
 *  - rationaleText 는 상태가 바뀔 때만 일반 문구로 바꾼다. 바뀌지 않으면 CHAIN2 의 설명을 남긴다.
 *  - 근거 범위는 `tags ∪ sectionHints` (llm/evidenceScope.ts).
 */
import { performance } from 'node:perf_hooks';
import { CareSection } from '../types';
import { createOutboundDeidContext, deidentifyDraftsForOutbound, deidentifyOutboundField } from '../deid/outbound';
import { buildChainCacheEntry, hasChainCacheHit, hashJoinedParts } from '../optimization/chainRuntime';
import { runQuestionGeneration, runSectionMissingDetection } from '../llm/chains';
import { getEvidenceForSections } from '../llm/evidenceScope';
import { CommonQuestionCategory } from '../llm/schemas/chain4_missing';

export const CORE_AI_SECTIONS: CareSection[] = [
  CareSection.PATIENT_INFORMATION,
  CareSection.CLINICAL_FINDINGS,
  CareSection.TIMELINE,
  CareSection.DIAGNOSTIC_ASSESSMENT,
  CareSection.THERAPEUTIC_INTERVENTIONS,
  CareSection.FOLLOW_UP_OUTCOMES,
  CareSection.PATIENT_PERSPECTIVE
];

export const COMMON_QUESTION_SECTIONS: CareSection[] = [...CORE_AI_SECTIONS, CareSection.DISCUSSION_CONCLUSION];

const STATUS_RATIONALE: Record<'READY' | 'INCOMPLETE' | 'IMPOSSIBLE', string> = {
  READY: '현재 기록으로 이 항목의 초안을 작성할 수 있습니다.',
  INCOMPLETE: '초안은 있으나 보완이 필요한 정보가 남아 있습니다.',
  IMPOSSIBLE: '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.'
};

export interface RefreshQuestionStateParams {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
  caseData?: any;
  onChain4Usage?: (usage: any) => void;
  onChain5Usage?: (usage: any) => void;
}

export interface QuestionStateCacheMeta {
  chain4InputHash: string;
  chain5InputHash: string;
  chain4CacheHit: boolean;
  chain5CacheHit: boolean;
  chain4DurationMs: number;
  chain5DurationMs: number;
  startedAt: string;
}

export interface RefreshQuestionStateResult {
  sectionStates: any[];
  sectionDrafts: any[];
  commonMissingItems: Array<{ item: string; relatedSectionIds: CareSection[]; category?: CommonQuestionCategory }>;
  commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: CommonQuestionCategory }>;
  cacheMeta: QuestionStateCacheMeta;
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

/** CHAIN4/5 에 보내는 근거: 공통 질문 대상 섹션 중 초안이 있는 섹션에 속한 카드(tags ∪ sectionHints). */
export function getQuestionScopeEvidence(sectionDrafts: any[], evidenceCards: any[]) {
  const relevantSections = (sectionDrafts || [])
    .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
    .map((draft) => draft.sectionId as string);
  return getEvidenceForSections(evidenceCards || [], relevantSections);
}

export function buildQuestionStateInputHash(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
}) {
  const scopedEvidence = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);
  return hashJoinedParts([
    params.caseTitle || '',
    '::drafts::',
    ...(params.sectionDrafts || [])
      .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
      .map((draft) =>
        [
          draft.sectionId || '',
          draft.draftText || '',
          JSON.stringify(draft.openIssues || []),
          JSON.stringify(draft.timelineEventIdsUsed || [])
        ].join('|')
      ),
    '::states::',
    ...(params.sectionStates || [])
      .filter((state) => COMMON_QUESTION_SECTIONS.includes(state.sectionId))
      .map((state) => [state.sectionId || '', state.status || '', state.rationaleText || ''].join('|')),
    '::evidence::',
    ...scopedEvidence.map((card) =>
      [
        card.id || '',
        card.normalizedText || card.sourceText || '',
        JSON.stringify(card.tags || []),
        JSON.stringify(card.sectionHints || [])
      ].join('|')
    )
  ]);
}

/** CHAIN4·CHAIN5 캐시 항목 (세 경로에서 똑같이 쓰던 것을 하나로). */
export function buildQuestionStateCacheEntries(result: RefreshQuestionStateResult) {
  return {
    CHAIN4: buildChainCacheEntry(
      result.cacheMeta.chain4InputHash,
      {
        commonMissingItems: result.commonMissingItems,
        sectionMissingBySection: result.sectionStates.map((state) => ({
          sectionId: state.sectionId,
          missingInfoBullets: state.missingInfoBullets || []
        }))
      },
      'CHAIN4'
    ),
    CHAIN5: buildChainCacheEntry(
      result.cacheMeta.chain5InputHash,
      {
        commonQuestionSets: result.commonQuestionSets,
        sectionQuestionsBySection: result.sectionStates.map((state) => ({
          sectionId: state.sectionId,
          recommendedQuestions: state.recommendedQuestions || []
        }))
      },
      'CHAIN5'
    )
  };
}

/** 모델 결과를 섹션 상태에 반영한다(제자리 수정). */
export function applyQuestionResultsToStates(params: {
  sectionStates: any[];
  sectionDrafts: any[];
  sectionMissing: Array<{ sectionId: string; missingItems: string[] }>;
  sectionQuestions: Array<{ sectionId: string; questions: string[] }>;
}) {
  const missingBySection = new Map(params.sectionMissing.map((item) => [item.sectionId, item.missingItems || []]));
  const questionsBySection = new Map(params.sectionQuestions.map((item) => [item.sectionId, item.questions || []]));

  for (const state of params.sectionStates) {
    state.missingInfoBullets = uniqueStrings(missingBySection.get(state.sectionId) || []);
    state.recommendedQuestions = uniqueStrings(questionsBySection.get(state.sectionId) || []);

    if (!CORE_AI_SECTIONS.includes(state.sectionId)) continue;
    const hasDraft = Boolean(
      params.sectionDrafts.find((draft) => draft.sectionId === state.sectionId)?.draftText?.trim()
    );
    const nextStatus: keyof typeof STATUS_RATIONALE = !hasDraft
      ? 'IMPOSSIBLE'
      : state.missingInfoBullets.length > 0
        ? 'INCOMPLETE'
        : 'READY';
    if (state.status !== nextStatus) {
      state.status = nextStatus;
      state.rationaleText = STATUS_RATIONALE[nextStatus];
    } else if (!String(state.rationaleText || '').trim()) {
      state.rationaleText = STATUS_RATIONALE[nextStatus];
    }
  }
}

export async function refreshQuestionState(params: RefreshQuestionStateParams): Promise<RefreshQuestionStateResult> {
  const startedAt = new Date().toISOString();
  const inputHash = buildQuestionStateInputHash(params);
  const canReuse =
    params.caseData &&
    hasChainCacheHit(params.caseData, 'CHAIN4', inputHash) &&
    hasChainCacheHit(params.caseData, 'CHAIN5', inputHash) &&
    Array.isArray(params.caseData.sectionStates) &&
    Array.isArray(params.caseData.commonQuestionSets);

  if (canReuse) {
    const stateBySection = new Map<string, any>(
      (params.caseData.sectionStates || []).map((state: any) => [state.sectionId, state])
    );
    const nextSectionStates = params.sectionStates.map((state) => {
      const stored = stateBySection.get(state.sectionId);
      if (!stored) return state;
      return {
        ...state,
        missingInfoBullets: stored.missingInfoBullets || [],
        recommendedQuestions: stored.recommendedQuestions || [],
        status: stored.status || state.status,
        rationaleText: stored.rationaleText || state.rationaleText
      };
    });

    return {
      sectionStates: nextSectionStates,
      sectionDrafts: params.sectionDrafts,
      commonMissingItems: params.caseData.commonMissingItems || [],
      commonQuestionSets: params.caseData.commonQuestionSets || [],
      cacheMeta: {
        chain4InputHash: inputHash,
        chain5InputHash: inputHash,
        chain4CacheHit: true,
        chain5CacheHit: true,
        chain4DurationMs: 0,
        chain5DurationMs: 0,
        startedAt
      }
    };
  }

  const commonQuestionDrafts = params.sectionDrafts.filter((draft) =>
    COMMON_QUESTION_SECTIONS.includes(draft.sectionId)
  );
  const scopedEvidenceCards = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);

  // caseTitle and the front-matter sections of sectionDrafts are user-authored
  // and never passed through the SOAP pipeline, so they are de-identified here
  // before CHAIN4/CHAIN5 send them out.
  const outboundContext = createOutboundDeidContext();
  const outboundTitle = await deidentifyOutboundField(params.caseTitle, outboundContext);
  const outboundDrafts = await deidentifyDraftsForOutbound(commonQuestionDrafts, outboundContext);

  const chain4StartedAt = performance.now();
  const missingResult = await runSectionMissingDetection(
    { sectionDrafts: outboundDrafts, evidenceCards: scopedEvidenceCards, caseTitle: outboundTitle },
    { onUsage: params.onChain4Usage }
  );
  const chain4DurationMs = Math.round((performance.now() - chain4StartedAt) * 100) / 100;

  const chain5StartedAt = performance.now();
  const questionResult = await runQuestionGeneration(
    {
      sectionDrafts: outboundDrafts,
      sectionMissing: missingResult.sectionMissing,
      commonMissing: missingResult.commonMissing,
      caseTitle: outboundTitle
    },
    { onUsage: params.onChain5Usage }
  );
  const chain5DurationMs = Math.round((performance.now() - chain5StartedAt) * 100) / 100;

  applyQuestionResultsToStates({
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    sectionMissing: missingResult.sectionMissing,
    sectionQuestions: questionResult.sectionQuestions
  });

  return {
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    commonMissingItems: (missingResult.commonMissing || []).map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[],
      category: item.category
    })),
    commonQuestionSets: (questionResult.commonQuestions || []).map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[],
      category: item.category
    })),
    cacheMeta: {
      chain4InputHash: inputHash,
      chain5InputHash: inputHash,
      chain4CacheHit: false,
      chain5CacheHit: false,
      chain4DurationMs,
      chain5DurationMs,
      startedAt
    }
  };
}
