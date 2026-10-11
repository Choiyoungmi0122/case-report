import { createHash } from 'crypto';
import { ChainCacheEntry, ChainPerformanceLog, ChainProgressState } from '../types';
import { promptMetaForChainName } from '../llm/promptRegistry';
import { PromptSet, promptSetForCase } from '../llm/promptSets';

function normalizeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc: Record<string, any>, key) => {
        acc[key] = normalizeValue(value[key]);
        return acc;
      }, {});
  }

  return value ?? null;
}

export function stableStringify(value: any): string {
  return JSON.stringify(normalizeValue(value));
}

export function hashValue(value: any): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function hashJoinedParts(parts: Array<string | number | boolean | null | undefined>): string {
  return createHash('sha256')
    .update(
      parts
        .map((part) => String(part ?? ''))
        .join('||')
    )
    .digest('hex');
}

/**
 * chainName 을 주면 그 체인의 프롬프트 지문(버전·템플릿 해시·모델)을 함께 남긴다.
 * 지문이 있는 항목은 프롬프트나 모델이 바뀌면 캐시 적중에서 빠진다.
 */
export function buildChainCacheEntry(
  inputHash: string,
  outputValue?: any,
  chainName?: string,
  promptSet: PromptSet = 'write'
): ChainCacheEntry {
  const meta = chainName ? promptMetaForChainName(chainName, promptSet) : undefined;
  return {
    inputHash,
    outputHash: outputValue === undefined ? undefined : hashValue(outputValue),
    updatedAt: new Date().toISOString(),
    ...(meta ? { promptFingerprint: meta.promptFingerprint } : {})
  };
}

/**
 * 입력 해시가 같고, 항목에 프롬프트 지문이 있으면 지금 지문과도 같아야 적중이다.
 * 지문이 없는 옛 항목(2026-10-11 이전, 학생 V1 문서 포함)은 호환을 위해 입력 해시만으로 인정한다.
 */
export function hasChainCacheHit(caseData: any, chainName: string, inputHash: string): boolean {
  const entry = caseData?.chainCache?.[chainName];
  if (!entry || entry.inputHash !== inputHash) return false;
  if (!entry.promptFingerprint) return true;
  // 사례의 mode 로 프롬프트 세트를 정한다(Scaffold 사례는 Scaffold 프롬프트의 지문과 비교).
  const meta = promptMetaForChainName(chainName, promptSetForCase(caseData));
  return !meta || entry.promptFingerprint === meta.promptFingerprint;
}

export function buildChainProgress(
  currentStep: string | undefined,
  completedSteps: string[],
  estimatedRemainingSteps: string[]
): ChainProgressState {
  return {
    currentStep,
    completedSteps,
    estimatedRemainingSteps,
    updatedAt: new Date().toISOString()
  };
}

export function appendPerformanceLog(
  existingLogs: ChainPerformanceLog[] | undefined,
  log: ChainPerformanceLog
): ChainPerformanceLog[] {
  return [...(existingLogs || []), log].slice(-200);
}

export function buildPerformanceLog(params: {
  chainName: string;
  startedAt: string;
  inputHash: string;
  cacheHit: boolean;
  llmCallCount: number;
  error?: string;
  tokenUsage?: ChainPerformanceLog['tokenUsage'];
  promptSet?: PromptSet;
}): ChainPerformanceLog {
  const endedAt = new Date().toISOString();
  // 어떤 프롬프트·모델로 돌았는지 로그마다 남긴다 (연구 재현성).
  const meta = promptMetaForChainName(params.chainName, params.promptSet || 'write');
  return {
    chainName: params.chainName,
    startedAt: params.startedAt,
    endedAt,
    durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(params.startedAt).getTime()),
    inputHash: params.inputHash,
    cacheHit: params.cacheHit,
    llmCallCount: params.llmCallCount,
    tokenUsage: params.tokenUsage ?? null,
    ...(meta ? { promptVersion: meta.promptVersion, promptTemplateHash: meta.promptTemplateHash, model: meta.model } : {}),
    ...(params.error ? { error: params.error } : {})
  };
}
