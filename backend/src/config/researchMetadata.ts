import { createHash } from 'crypto';
import backendPackage from '../../package.json';
import { DEFAULT_STUDY_CASE_ID, DEFAULT_STUDY_CASE_VERSION } from '../study/cases/defaultStudyCase';

export const DEFAULT_SCAFFOLD_VERSION = process.env.SCAFFOLD_VERSION || 'v2.0';
export const DEFAULT_SECTION_CONFIG_VERSION = process.env.SECTION_CONFIG_VERSION || DEFAULT_SCAFFOLD_VERSION;

/**
 * 연구에서 "Scaffold V2"(교수 평가, 학생 후속)로 부르는 교육용 Scaffold의 시스템 버전 값.
 * 학생 V1(S1~S10) 기록이 이미 scaffoldVersion 'v2.0'으로 저장되어 있어 같은 값을 쓸 수 없다.
 * 변경 이력: docs/scaffold_v2_changelog.md
 */
/**
 * 시험용 표시: 고정 연구 사례의 저장된 AI 결과(처리·공개 단계)를 건너뛰고 지금 프롬프트로 새로 생성한다 (2026-10-12).
 * `studyConfig.liveAiForTesting === true` 인 사례에만 적용된다. API 로는 설정할 수 없고(normalizeStudyConfig 가 버린다)
 * 연구자가 시험 사례 문서에 직접 넣는다. 학생 V1·V2 참가자 문서에는 없으므로 고정 결과를 그대로 쓴다.
 */
export function isLiveAiTestCase(caseData: any): boolean {
  return caseData?.studyConfig?.liveAiForTesting === true;
}

export const STUDY_SCAFFOLD_V2_VERSION = 'v3.0';

/** Scaffold V2 실습 범위. 교수 평가는 치료 개입 섹션만 실습한다. */
export const STUDY_SCAFFOLD_V2_SECTION_IDS = ['THERAPEUTIC_INTERVENTIONS'];

/** 학생 V1 실험 코드 형식(S1, S3-1 …). V2 진입에서 거부해 V1 기록으로 이어서 쓰는 일을 막는다. */
export const STUDENT_V1_CODE_PATTERN = /^S\d+(-\d+)?$/i;

export function isStudyScaffoldV2Case(caseData: any): boolean {
  return String(caseData?.versionMetadata?.scaffoldVersion || '') === STUDY_SCAFFOLD_V2_VERSION;
}

export function getAppVersion() {
  return process.env.APP_VERSION || backendPackage.version || undefined;
}

export function getVersionMetadata(caseId?: string, caseVersion?: string) {
  return {
    appVersion: getAppVersion(),
    scaffoldVersion: DEFAULT_SCAFFOLD_VERSION,
    caseVersion: caseVersion || (caseId === DEFAULT_STUDY_CASE_ID ? DEFAULT_STUDY_CASE_VERSION : undefined),
    sectionConfigVersion: DEFAULT_SECTION_CONFIG_VERSION
  };
}

export function hashPromptParts(parts: Array<string | undefined>) {
  return createHash('sha256').update(parts.filter(Boolean).join('\n\n---\n\n')).digest('hex');
}

export function buildGenerationMetadata(params: {
  chainName: string;
  provider?: string;
  model?: string;
  actualModelVersion?: string;
  inputHash?: string;
  promptHash?: string;
  promptTemplateHash?: string;
  promptVersion?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  generatedAt?: string;
  cacheHit?: boolean;
  generationStatus?: 'success' | 'failed';
  errorCode?: string | null;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  regenerationCount?: number;
}) {
  return {
    provider: params.provider,
    model: params.model,
    actualModelVersion: params.actualModelVersion,
    promptVersion: params.promptVersion || params.chainName,
    promptHash: params.promptHash,
    promptTemplateHash: params.promptTemplateHash,
    inputHash: params.inputHash,
    temperature: params.temperature,
    topP: params.topP,
    maxTokens: params.maxTokens,
    generatedAt: params.generatedAt,
    regenerationCount: params.regenerationCount ?? 0,
    cacheHit: Boolean(params.cacheHit),
    generationStatus: params.generationStatus,
    errorCode: params.errorCode ?? null,
    tokenUsage: params.tokenUsage ?? null
  };
}
