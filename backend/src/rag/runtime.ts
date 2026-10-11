import { hasOpenAIApiKey } from '../llm/client';
import { EmbeddingSemanticMatcher } from './semantic';
import { createOpenAIEmbeddingProvider, getDefaultEmbeddingModel } from './openAIEmbeddingProvider';
import { OpenAITerminologyResolver } from './openAILlmResolver';
import { RetrievedTermResolver } from './resolver';
import { PromptSet } from '../llm/promptSets';
import { scaffoldResolverSystemPrompt } from '../llm/prompts/scaffold/terminology_resolver';

export type WriteTerminologyRuntime = {
  semanticMatcher?: EmbeddingSemanticMatcher;
  llmResolver?: RetrievedTermResolver;
};

/**
 * 용어 전처리 런타임. 의미 검색(임베딩, 프롬프트 없음)은 두 세트가 같은 인스턴스를 쓰고,
 * 판정기는 세트별 프롬프트를 쓴다 (2026-10-12 Scaffold/Write 분리).
 */
const cachedRuntimes: Partial<Record<PromptSet, WriteTerminologyRuntime>> = {};
let cachedSemanticMatcher: EmbeddingSemanticMatcher | undefined;
let semanticMatcherBuilt = false;

function getSharedSemanticMatcher(): EmbeddingSemanticMatcher | undefined {
  if (semanticMatcherBuilt) return cachedSemanticMatcher;
  semanticMatcherBuilt = true;
  const provider = createOpenAIEmbeddingProvider();
  cachedSemanticMatcher = provider
    ? new EmbeddingSemanticMatcher({
        provider,
        model: provider.model || getDefaultEmbeddingModel()
      })
    : undefined;
  return cachedSemanticMatcher;
}

export function getTerminologyRuntime(set: PromptSet = 'write'): WriteTerminologyRuntime {
  const cached = cachedRuntimes[set];
  if (cached) return cached;

  if (!hasOpenAIApiKey()) {
    cachedRuntimes[set] = {};
    return cachedRuntimes[set]!;
  }

  let llmResolver: RetrievedTermResolver | undefined;
  try {
    llmResolver =
      set === 'scaffold'
        ? new OpenAITerminologyResolver(undefined, undefined, {
            systemPrompt: scaffoldResolverSystemPrompt,
            label: 'TERMINOLOGY resolver [scaffold]'
          })
        : new OpenAITerminologyResolver();
  } catch (error) {
    console.warn('[RAG] Failed to initialize terminology resolver:', error);
  }

  cachedRuntimes[set] = {
    semanticMatcher: getSharedSemanticMatcher(),
    llmResolver
  };
  return cachedRuntimes[set]!;
}

/** Write 세트 (이전 이름 유지) */
export function getWriteTerminologyRuntime(): WriteTerminologyRuntime {
  return getTerminologyRuntime('write');
}

export function getScaffoldTerminologyRuntime(): WriteTerminologyRuntime {
  return getTerminologyRuntime('scaffold');
}

export function resetWriteTerminologyRuntimeForTests() {
  delete cachedRuntimes.write;
  delete cachedRuntimes.scaffold;
  cachedSemanticMatcher = undefined;
  semanticMatcherBuilt = false;
}
