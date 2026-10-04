import { assertOutboundTextsAreSafe } from '../deid/outbound';
import { getOpenAIClient, hasOpenAIApiKey } from '../llm/client';
import { EmbeddingProvider } from './semantic';

const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;

  constructor(model = DEFAULT_EMBEDDING_MODEL) {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    // An embedding request is an external AI call and sits behind the same
    // privacy boundary as a chat completion.
    assertOutboundTextsAreSafe(texts, 'RAG embedding');

    const response = await getOpenAIClient().embeddings.create({
      model: this.model,
      input: texts
    });

    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}

export function getDefaultEmbeddingModel(): string {
  return DEFAULT_EMBEDDING_MODEL;
}

export function createOpenAIEmbeddingProvider(): OpenAIEmbeddingProvider | null {
  if (!hasOpenAIApiKey()) {
    return null;
  }

  try {
    return new OpenAIEmbeddingProvider();
  } catch (error) {
    console.warn('[RAG] Failed to initialize OpenAI embedding provider:', error);
    return null;
  }
}
