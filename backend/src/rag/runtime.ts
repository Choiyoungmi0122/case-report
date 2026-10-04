import { hasOpenAIApiKey } from '../llm/client';
import { EmbeddingSemanticMatcher } from './semantic';
import { createOpenAIEmbeddingProvider, getDefaultEmbeddingModel } from './openAIEmbeddingProvider';
import { OpenAITerminologyResolver } from './openAILlmResolver';
import { RetrievedTermResolver } from './resolver';

export type WriteTerminologyRuntime = {
  semanticMatcher?: EmbeddingSemanticMatcher;
  llmResolver?: RetrievedTermResolver;
};

let cachedRuntime: WriteTerminologyRuntime | null = null;

export function getWriteTerminologyRuntime(): WriteTerminologyRuntime {
  if (cachedRuntime) return cachedRuntime;

  if (!hasOpenAIApiKey()) {
    cachedRuntime = {};
    return cachedRuntime;
  }

  const provider = createOpenAIEmbeddingProvider();
  const semanticMatcher = provider
    ? new EmbeddingSemanticMatcher({
        provider,
        model: provider.model || getDefaultEmbeddingModel()
      })
    : undefined;

  let llmResolver: RetrievedTermResolver | undefined;
  try {
    llmResolver = new OpenAITerminologyResolver();
  } catch (error) {
    console.warn('[RAG] Failed to initialize terminology resolver:', error);
  }

  cachedRuntime = {
    semanticMatcher,
    llmResolver
  };
  return cachedRuntime;
}

export function resetWriteTerminologyRuntimeForTests() {
  cachedRuntime = null;
}
