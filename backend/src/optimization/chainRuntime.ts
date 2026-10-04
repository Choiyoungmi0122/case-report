import { createHash } from 'crypto';
import { ChainCacheEntry, ChainPerformanceLog, ChainProgressState } from '../types';

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

export function buildChainCacheEntry(inputHash: string, outputValue?: any): ChainCacheEntry {
  return {
    inputHash,
    outputHash: outputValue === undefined ? undefined : hashValue(outputValue),
    updatedAt: new Date().toISOString()
  };
}

export function hasChainCacheHit(caseData: any, chainName: string, inputHash: string): boolean {
  return caseData?.chainCache?.[chainName]?.inputHash === inputHash;
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
}): ChainPerformanceLog {
  const endedAt = new Date().toISOString();
  return {
    chainName: params.chainName,
    startedAt: params.startedAt,
    endedAt,
    durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(params.startedAt).getTime()),
    inputHash: params.inputHash,
    cacheHit: params.cacheHit,
    llmCallCount: params.llmCallCount,
    tokenUsage: params.tokenUsage ?? null,
    ...(params.error ? { error: params.error } : {})
  };
}
