import { createHash } from 'crypto';
import backendPackage from '../../package.json';
import { DEFAULT_STUDY_CASE_ID, DEFAULT_STUDY_CASE_VERSION } from '../study/cases/defaultStudyCase';

export const DEFAULT_SCAFFOLD_VERSION = process.env.SCAFFOLD_VERSION || 'v2.0';
export const DEFAULT_SECTION_CONFIG_VERSION = process.env.SECTION_CONFIG_VERSION || DEFAULT_SCAFFOLD_VERSION;

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
