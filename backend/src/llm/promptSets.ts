/**
 * 프롬프트 세트: Scaffold 모드와 Write 모드가 서로 다른 프롬프트 파일을 쓴다 (2026-10-12 분리).
 *
 *  - write    : `llm/prompts/*.ts` — 일반 Write(CHAIN1~7, 검토)와 실험용 Write(SW-*)
 *  - scaffold : `llm/prompts/scaffold/*.ts` — Scaffold 가 실제로 부르는 CHAIN1~5, 검토, 용어 판정기
 *
 * 사례의 `mode` 가 'scaffold' 이면 scaffold 세트, 그 밖에는 write 세트다. CHAIN6·CHAIN7·SW-* 는 Write 에서만 쓰므로
 * scaffold 사본이 없다. 공개 단계(CHAIN3_STUDY_REVEAL)는 scaffold 세트의 CHAIN3 프롬프트를 쓴다.
 * 규칙·파일 지도: docs/prompt_sets_scaffold_write_v1.md
 */
import * as writeChain1 from './prompts/chain1_splitTag';
import * as writeChain2 from './prompts/chain2_assess';
import * as writeChain3 from './prompts/chain3_draft';
import * as writeChain4 from './prompts/chain4_missing';
import * as writeChain5 from './prompts/chain5_questions';
import * as writeReview from './prompts/section_adequacy_review';
import * as scaffoldChain1 from './prompts/scaffold/chain1_splitTag';
import * as scaffoldChain2 from './prompts/scaffold/chain2_assess';
import * as scaffoldChain3 from './prompts/scaffold/chain3_draft';
import * as scaffoldChain4 from './prompts/scaffold/chain4_missing';
import * as scaffoldChain5 from './prompts/scaffold/chain5_questions';
import * as scaffoldReview from './prompts/scaffold/section_adequacy_review';

export type PromptSet = 'write' | 'scaffold';

/** 두 세트가 모두 가진 체인 */
export type SharedChainKey = 'CHAIN1' | 'CHAIN2' | 'CHAIN3' | 'CHAIN4' | 'CHAIN5' | 'REVIEW';
export const SHARED_CHAIN_KEYS: SharedChainKey[] = ['CHAIN1', 'CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5', 'REVIEW'];

export function promptSetForCase(caseData: { mode?: string } | null | undefined): PromptSet {
  return (caseData?.mode || 'write') === 'scaffold' ? 'scaffold' : 'write';
}

export function chainPrompts(set: PromptSet = 'write') {
  if (set === 'scaffold') {
    return {
      chain1: { system: scaffoldChain1.chain1SystemPrompt, user: scaffoldChain1.buildChain1UserPrompt },
      chain2: { system: scaffoldChain2.chain2SystemPrompt, user: scaffoldChain2.buildChain2UserPrompt },
      chain3: { system: scaffoldChain3.chain3SystemPrompt, user: scaffoldChain3.buildChain3UserPrompt },
      chain4: { system: scaffoldChain4.chain4MissingSystemPrompt, user: scaffoldChain4.buildChain4MissingUserPrompt },
      chain5: { system: scaffoldChain5.chain5QuestionSystemPrompt, user: scaffoldChain5.buildChain5QuestionUserPrompt },
      review: {
        system: scaffoldReview.sectionAdequacyReviewSystemPrompt,
        user: scaffoldReview.buildSectionAdequacyReviewUserPrompt
      }
    };
  }
  return {
    chain1: { system: writeChain1.chain1SystemPrompt, user: writeChain1.buildChain1UserPrompt },
    chain2: { system: writeChain2.chain2SystemPrompt, user: writeChain2.buildChain2UserPrompt },
    chain3: { system: writeChain3.chain3SystemPrompt, user: writeChain3.buildChain3UserPrompt },
    chain4: { system: writeChain4.chain4MissingSystemPrompt, user: writeChain4.buildChain4MissingUserPrompt },
    chain5: { system: writeChain5.chain5QuestionSystemPrompt, user: writeChain5.buildChain5QuestionUserPrompt },
    review: { system: writeReview.sectionAdequacyReviewSystemPrompt, user: writeReview.buildSectionAdequacyReviewUserPrompt }
  };
}

/** LLM 호출 라벨. 접두어(CHAIN3 등)는 유지해 체인별 시간·토큰 상한이 그대로 적용되고, 사용량 기록에서 세트를 구분한다. */
export function chainLabel(label: string, set: PromptSet = 'write'): string {
  return set === 'scaffold' ? `${label} [scaffold]` : label;
}
