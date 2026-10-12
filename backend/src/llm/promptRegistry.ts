/**
 * 프롬프트 레지스트리: 체인마다 (1) 프롬프트 버전, (2) 시스템 프롬프트 템플릿 해시, (3) 지금 쓰는 모델을
 * 한 곳에서 묻는다.
 *
 * 왜 필요한가 (docs/prompt_chain_review_v1.md §3): 2026-10-11까지는 프롬프트를 고쳐도 promptVersion 이 그대로였고,
 * 어떤 캐시 키에도 프롬프트·모델이 들어가지 않아 옛 프롬프트의 결과가 재사용됐다. 이제
 *  - 캐시 항목에 `promptFingerprint`(버전 + 템플릿 해시 + 모델)를 남기고, 캐시 적중 판정에서 비교한다
 *    (지문이 없는 옛 항목은 호환을 위해 그대로 인정한다: 학생 V1 문서가 다시 LLM을 돌리지 않도록).
 *  - 성능 로그·생성 메타데이터·실험용 Write 이력에 promptVersion 과 promptTemplateHash 를 기록한다.
 *
 * 규칙: 시스템 프롬프트 문구를 고치면 여기의 버전을 올린다. 버전 이력은 아래 PROMPT_VERSION_HISTORY 에 적는다.
 */
import { createHash } from 'crypto';
import { chain1SystemPrompt } from './prompts/chain1_splitTag';
import { chain2SystemPrompt } from './prompts/chain2_assess';
import { chain3SystemPrompt } from './prompts/chain3_draft';
import { chain4MissingSystemPrompt } from './prompts/chain4_missing';
import { chain5QuestionSystemPrompt } from './prompts/chain5_questions';
import { chain6UpdateSystemPrompt } from './prompts/chain6_update';
import { chain7SystemPrompt } from './prompts/chain7_final';
import { sectionAdequacyReviewSystemPrompt } from './prompts/section_adequacy_review';
import {
  STUDY_WRITE_CARE_CHECK_PROMPT_VERSION,
  STUDY_WRITE_DRAFT_PROMPT_VERSION,
  STUDY_WRITE_REVISE_PROMPT_VERSION,
  studyWriteCareCheckSystemPrompt,
  studyWriteDraftSystemPrompt,
  studyWriteReviseSystemPrompt
} from './prompts/studyWrite_draft';
import { STUDY_WRITE_QUESTIONS_PROMPT_VERSION, studyWriteGapQuestionsSystemPrompt } from './prompts/studyWrite_questions';
import { STUDY_WRITE_CARE_QUESTION_PROMPT_VERSION, studyWriteCareQuestionSystemPrompt } from './prompts/studyWrite_careQuestion';
import { STUDY_WRITE_CHAT_QUESTION_PROMPT_VERSION, studyWriteChatQuestionSystemPrompt } from './prompts/studyWrite_chatQuestion';
import { getModelForChain } from './models';
import { PromptSet, SharedChainKey, SHARED_CHAIN_KEYS } from './promptSets';
import { chain1SystemPrompt as scaffoldChain1SystemPrompt } from './prompts/scaffold/chain1_splitTag';
import { chain2SystemPrompt as scaffoldChain2SystemPrompt } from './prompts/scaffold/chain2_assess';
import {
  buildScaffoldRevealSystemPrompt,
  chain3SystemPrompt as scaffoldChain3SystemPrompt
} from './prompts/scaffold/chain3_draft';
import { chain4MissingSystemPrompt as scaffoldChain4SystemPrompt } from './prompts/scaffold/chain4_missing';
import { chain5QuestionSystemPrompt as scaffoldChain5SystemPrompt } from './prompts/scaffold/chain5_questions';
import { sectionAdequacyReviewSystemPrompt as scaffoldReviewSystemPrompt } from './prompts/scaffold/section_adequacy_review';

/**
 * 버전 이력 (문구가 바뀐 커밋 기준).
 *  - CHAIN1~7, REVIEW v1: 2026-04-29 ~ 2026-10-04 (`c18c6e5`). 학생 V1·Scaffold V2 의 고정 AI 초안은 이 v1 chain3 로 만들었다
 *    (promptTemplateHash e4e87023…, docs/study_ai_draft_prompt_provenance_v1.md).
 *  - CHAIN1~7, REVIEW v2: 2026-10-11 `0a56cfa` "프롬프트 정비" (공통 원칙 P1~P7 도입, 4부 구조). 그때 버전을 올리지 않아 여기서 소급해 v2 로 둔다.
 *  - CHAIN6 v3: 2026-10-11 답변-기록 충돌 정책을 "기록 우선, 차이는 표시"로 통일.
 *  - SW-Q2 v3 / SW-D v3 / SW-R v3 / SW-C v2: 2026-10-11 공통 원칙을 common.ts 에서 가져오도록 통일(문구 동일화).
 *  - SCAFFOLD-CHAIN1~5, SCAFFOLD-REVIEW v2: 2026-10-12 Scaffold 전용 사본으로 분리(`prompts/scaffold/`). 본문은 분리 시점의
 *    Write v2 와 같고, 라벨이 달라 템플릿 해시는 다르다. 이후 각자 따로 버전을 올린다.
 *  - CHAIN3_STUDY_REVEAL: 2026-10-12부터 Scaffold 사본의 CHAIN3 를 가리킨다. 분리 시점 본문이 같아 해시도 그대로다.
 *  - SCAFFOLD-CHAIN3 v3, CHAIN3_STUDY_REVEAL v3: 2026-10-12 Scaffold CHAIN3 개선(평가 후보 v3.2) 적용.
 *    고정 연구 사례(학생 V1, V2)는 고정 초안을 먼저 돌려주므로(routes/scaffold.ts) 영향이 없다.
 *  - SCAFFOLD-CHAIN3 v4, CHAIN3_STUDY_REVEAL v4: 2026-10-12 v3.3 규칙(없는 내용 서술·표기 변경·마무리 문장 금지) 적용.
 *    공개 단계는 공개하는 섹션만 생성하도록 바꿨다(대표 프롬프트는 치료 개입 전용).
 *  - SW-Q2 v4 / SW-D v4 / SW-R v4: 2026-10-12 `3d6e831` 국내 한의 증례보고 5편의 서술 관례 반영(docs/case_report_style_basis_v1.md).
 *  - SW-Q3 v1: 2026-10-12 CARE 점검의 "없음" 항목 하나를 쓰기 위한 질문 (새 체인).
 *  - SW-C v3: 2026-10-12 하위 요소 판정(subItems) 추가. 환자 정보·진단 평가·치료 개입·추적 관찰만 (docs/care_subelements_v1.md).
 *  - SW-D v5 / SW-R v5: 2026-10-12 섹션별 쓰기 규칙(studyWrite/careItems.ts)을 CARE 설명 문서 원문(Riley 2017)과 대조해 빠진 요소를 더함.
 *  - SW-D v6 / SW-R v6: 2026-10-12 초록 분량을 국내 관례(6~10문장)에서 CARE 기준(영문 100~250단어 수준, 학술지 규정 우선)으로 바꿈.
 *  - SW-D v7 / SW-R v7: 2026-10-12 우선순위 블록 추가: 제1조건 CARE 세부 항목 완수, 제2조건 그 안에서 국내 증례보고 형식(사용자 결정).
 *  - SW-Q4 v1: 2026-10-12 수정 요청 채팅의 "질문 받기" (새 체인). CARE 점검의 빠진 필수 → 선택 → 세부 사항 순으로 질문 하나.
 *  - SW-Q4 v2: 2026-10-12 빠진 CARE 요소 목록 안에서만 질문(세부 사항 순서 삭제), 기전·이론적 근거·"기록에 있나요?" 질문 금지. 제목·초록·문헌 요소·빠진 것 없음은 코드가 거름.
 *  - SW-D v8 / SW-R v8: 2026-10-12 타임라인 진단 검사 칸 규칙(질의응답의 모든 답에서 검사·과거력, 타 기관 검사는 과거력 행). 타임라인은 섹션과 상관없이 모든 답을 받음(drafting.buildQaText, SW-C 입력도 같음).
 */
export const PROMPT_VERSIONS = {
  CHAIN1: 'v2',
  CHAIN2: 'v2',
  CHAIN3: 'v2',
  CHAIN4: 'v2',
  CHAIN5: 'v2',
  CHAIN6: 'v3',
  CHAIN7: 'v2',
  REVIEW: 'v2',
  /** 공개 단계는 Scaffold 세트의 chain3 프롬프트를 쓴다. */
  CHAIN3_STUDY_REVEAL: 'v4',
  SCAFFOLD_CHAIN1: 'v2',
  SCAFFOLD_CHAIN2: 'v2',
  SCAFFOLD_CHAIN3: 'v4',
  SCAFFOLD_CHAIN4: 'v2',
  SCAFFOLD_CHAIN5: 'v2',
  SCAFFOLD_REVIEW: 'v2',
  SW_Q2: STUDY_WRITE_QUESTIONS_PROMPT_VERSION.split(':')[1],
  SW_D: STUDY_WRITE_DRAFT_PROMPT_VERSION.split(':')[1],
  SW_R: STUDY_WRITE_REVISE_PROMPT_VERSION.split(':')[1],
  SW_C: STUDY_WRITE_CARE_CHECK_PROMPT_VERSION.split(':')[1],
  SW_Q3: STUDY_WRITE_CARE_QUESTION_PROMPT_VERSION.split(':')[1],
  SW_Q4: STUDY_WRITE_CHAT_QUESTION_PROMPT_VERSION.split(':')[1]
} as const;

export type PromptKey = keyof typeof PROMPT_VERSIONS;

const SYSTEM_PROMPTS: Record<PromptKey, string> = {
  CHAIN1: chain1SystemPrompt,
  CHAIN2: chain2SystemPrompt,
  CHAIN3: chain3SystemPrompt,
  CHAIN4: chain4MissingSystemPrompt,
  CHAIN5: chain5QuestionSystemPrompt,
  CHAIN6: chain6UpdateSystemPrompt,
  CHAIN7: chain7SystemPrompt,
  REVIEW: sectionAdequacyReviewSystemPrompt,
  // 공개 단계는 공개하는 섹션만 쓴다(2026-10-12 v4). V2 의 공개 섹션인 치료 개입 프롬프트를 대표로 등록한다.
  // 다른 섹션을 공개할 때의 실제 프롬프트 해시는 생성 메타데이터(routes/scaffold.ts)에 따로 남는다.
  CHAIN3_STUDY_REVEAL: buildScaffoldRevealSystemPrompt('THERAPEUTIC_INTERVENTIONS'),
  SCAFFOLD_CHAIN1: scaffoldChain1SystemPrompt,
  SCAFFOLD_CHAIN2: scaffoldChain2SystemPrompt,
  SCAFFOLD_CHAIN3: scaffoldChain3SystemPrompt,
  SCAFFOLD_CHAIN4: scaffoldChain4SystemPrompt,
  SCAFFOLD_CHAIN5: scaffoldChain5SystemPrompt,
  SCAFFOLD_REVIEW: scaffoldReviewSystemPrompt,
  SW_Q2: studyWriteGapQuestionsSystemPrompt,
  SW_D: studyWriteDraftSystemPrompt,
  SW_R: studyWriteReviseSystemPrompt,
  SW_C: studyWriteCareCheckSystemPrompt,
  SW_Q3: studyWriteCareQuestionSystemPrompt,
  SW_Q4: studyWriteChatQuestionSystemPrompt
};

/** getModelForChain 의 키. */
const MODEL_KEYS: Record<PromptKey, string> = {
  CHAIN1: 'chain1',
  CHAIN2: 'chain2',
  CHAIN3: 'chain3',
  CHAIN4: 'chain4',
  CHAIN5: 'chain5',
  CHAIN6: 'chain6',
  CHAIN7: 'chain7',
  REVIEW: 'review',
  CHAIN3_STUDY_REVEAL: 'chain3',
  SCAFFOLD_CHAIN1: 'chain1',
  SCAFFOLD_CHAIN2: 'chain2',
  SCAFFOLD_CHAIN3: 'chain3',
  SCAFFOLD_CHAIN4: 'chain4',
  SCAFFOLD_CHAIN5: 'chain5',
  SCAFFOLD_REVIEW: 'review',
  SW_Q2: 'chain5',
  SW_D: 'chain6',
  SW_R: 'chain6',
  SW_C: 'chain4',
  SW_Q3: 'chain4',
  SW_Q4: 'chain4'
};

/** 기존 generationMetadata.promptTemplateHash 와 같은 방식: sha256(version + system prompt, 구분자 포함). */
export function promptTemplateHash(key: PromptKey): string {
  return templateHashOf(promptVersionLabel(key), SYSTEM_PROMPTS[key]);
}

/** 버전 라벨과 시스템 프롬프트 본문으로 템플릿 해시를 낸다(promptTemplateHash 와 같은 계산). 섹션별 프롬프트처럼 등록 본문과 다른 실제 본문에 쓴다. */
export function templateHashOf(versionLabel: string, systemPrompt: string): string {
  return createHash('sha256').update([versionLabel, systemPrompt].join('\n\n---\n\n')).digest('hex');
}

/** 예: "CHAIN3:v2", "SW-D:v3", "SCAFFOLD-CHAIN3:v2" */
export function promptVersionLabel(key: PromptKey): string {
  const name = key.startsWith('SW_')
    ? key.replace('SW_', 'SW-')
    : key.startsWith('SCAFFOLD_')
      ? key.replace('SCAFFOLD_', 'SCAFFOLD-')
      : key;
  return `${name}:${PROMPT_VERSIONS[key]}`;
}

/** 세트에 맞는 키. scaffold 세트의 CHAIN1~5·REVIEW 는 SCAFFOLD_* 키, 나머지는 그대로. */
export function promptKeyFor(key: SharedChainKey, set: PromptSet = 'write'): PromptKey {
  return set === 'scaffold' ? (`SCAFFOLD_${key}` as PromptKey) : key;
}

export function promptModel(key: PromptKey): string {
  return getModelForChain(MODEL_KEYS[key]);
}

/** 캐시 항목에 남기는 지문. 버전·템플릿·모델 중 하나라도 바뀌면 달라진다. */
export function promptFingerprint(key: PromptKey): string {
  return `${promptVersionLabel(key)}|${promptTemplateHash(key).slice(0, 16)}|${promptModel(key)}`;
}

/**
 * chainCache / chainPerformanceLogs 의 chainName 에서 프롬프트 키를 찾는다.
 * 예: "CHAIN1", "REVIEW:THERAPEUTIC_INTERVENTIONS", "CHAIN3_STUDY_REVEAL:THERAPEUTIC_INTERVENTIONS".
 */
export function promptKeyForChainName(chainName: string, set: PromptSet = 'write'): PromptKey | undefined {
  const head = String(chainName || '').split(':')[0].toUpperCase();
  if (head === 'CHAIN3_STUDY_REVEAL') return 'CHAIN3_STUDY_REVEAL';
  if ((SHARED_CHAIN_KEYS as string[]).includes(head)) return promptKeyFor(head as SharedChainKey, set);
  if (head in PROMPT_VERSIONS) return head as PromptKey;
  return undefined;
}

export function promptMetaForChainName(chainName: string, set: PromptSet = 'write'):
  | { promptVersion: string; promptTemplateHash: string; model: string; promptFingerprint: string }
  | undefined {
  const key = promptKeyForChainName(chainName, set);
  if (!key) return undefined;
  return {
    promptVersion: promptVersionLabel(key),
    promptTemplateHash: promptTemplateHash(key),
    model: promptModel(key),
    promptFingerprint: promptFingerprint(key)
  };
}

export function promptMeta(key: PromptKey) {
  return {
    promptVersion: promptVersionLabel(key),
    promptTemplateHash: promptTemplateHash(key),
    model: promptModel(key),
    promptFingerprint: promptFingerprint(key)
  };
}
