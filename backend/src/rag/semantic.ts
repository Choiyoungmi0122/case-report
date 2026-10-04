import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { terminologyDataHash, terminologyEntries } from './loader';
import { SemanticMatchCandidate, SemanticMatchProvider, TermDbEntry } from './types';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

type CachedEmbeddingRecord = {
  termId: string;
  variant: string;
  vector: number[];
};

type EmbeddingCacheFile = {
  model: string;
  terminologyDataHash: string;
  entries: CachedEmbeddingRecord[];
};

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector.map(() => 0);
  return vector.map((value) => value / magnitude);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const limit = Math.min(a.length, b.length);
  let total = 0;
  for (let i = 0; i < limit; i += 1) total += a[i] * b[i];
  return Number(total.toFixed(6));
}

function variantKey(term: TermDbEntry, variant: string): string {
  return `${term.termId}::${variant}`;
}

function recordKey(record: CachedEmbeddingRecord): string {
  return `${record.termId}::${record.variant}`;
}

function buildVariants(entries: TermDbEntry[]): Array<{ key: string; term: TermDbEntry; variant: string }> {
  return entries.flatMap((term) => [
    { key: variantKey(term, term.standardTerm), term, variant: term.standardTerm },
    ...term.synonyms.map((variant) => ({ key: variantKey(term, variant), term, variant })),
    ...term.typoVariants.map((variant) => ({ key: variantKey(term, variant), term, variant })),
    ...term.aliases.map((variant) => ({ key: variantKey(term, variant), term, variant }))
  ]);
}

function defaultCachePath(): string {
  return path.resolve(__dirname, '../../data/terminology/embeddings.json');
}

function readCache(filePath: string): EmbeddingCacheFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as EmbeddingCacheFile;
  } catch {
    return null;
  }
}

function writeCache(filePath: string, cache: EmbeddingCacheFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf8');
}

export class EmbeddingSemanticMatcher implements SemanticMatchProvider {
  private readonly provider: EmbeddingProvider;
  private readonly model: string;
  private readonly threshold: number;
  private readonly topK: number;
  private readonly cachePath: string;
  private cachedIndex: Map<string, number[]> | null = null;
  private lastCacheState: { reused: boolean; vectorCount: number; hash: string } | null = null;

  constructor(params: {
    provider: EmbeddingProvider;
    model: string;
    threshold?: number;
    topK?: number;
    cachePath?: string;
  }) {
    this.provider = params.provider;
    this.model = params.model;
    this.threshold = params.threshold ?? 0.72;
    this.topK = params.topK ?? 3;
    this.cachePath = params.cachePath || defaultCachePath();
  }

  private async ensureIndex(entries: TermDbEntry[]): Promise<Map<string, number[]>> {
    if (this.cachedIndex) return this.cachedIndex;

    const variants = buildVariants(entries);
    const expectedHash = createHash('sha256')
      .update(`${terminologyDataHash}:${this.model}:${variants.map((item) => item.key).join('|')}`)
      .digest('hex');
    const cached = readCache(this.cachePath);

    if (
      cached &&
      cached.model === this.model &&
      cached.terminologyDataHash === expectedHash &&
      Array.isArray(cached.entries)
    ) {
      this.cachedIndex = new Map(cached.entries.map((item) => [recordKey(item), normalizeVector(item.vector)]));
      this.lastCacheState = {
        reused: true,
        vectorCount: cached.entries.length,
        hash: expectedHash
      };
      return this.cachedIndex;
    }

    const vectors = await this.provider.embed(variants.map((item) => item.variant));
    this.cachedIndex = new Map(
      variants.map((variant, index) => [variant.key, normalizeVector(vectors[index] || [])])
    );

    writeCache(this.cachePath, {
      model: this.model,
      terminologyDataHash: expectedHash,
      entries: variants.map((variant, index) => ({
        termId: variant.term.termId,
        variant: variant.variant,
        vector: normalizeVector(vectors[index] || [])
      }))
    });
    this.lastCacheState = {
      reused: false,
      vectorCount: variants.length,
      hash: expectedHash
    };

    return this.cachedIndex;
  }

  async search(surface: string, entries = terminologyEntries): Promise<SemanticMatchCandidate[]> {
    if (!surface.trim()) return [];

    const [queryVector] = await this.provider.embed([surface]);
    const normalizedQuery = normalizeVector(queryVector || []);
    const index = await this.ensureIndex(entries);
    const variants = buildVariants(entries);

    const ranked = variants
      .map((variant) => ({
        term: variant.term,
        score: cosineSimilarity(normalizedQuery, index.get(variant.key) || [])
      }))
      .filter((item) => item.score >= this.threshold)
      .sort((a, b) => b.score - a.score);

    const byTermId = new Map<string, SemanticMatchCandidate>();
    for (const item of ranked) {
      const existing = byTermId.get(item.term.termId);
      if (!existing || item.score > existing.confidence) {
        byTermId.set(item.term.termId, {
          termId: item.term.termId,
          standardTerm: item.term.standardTerm,
          confidence: Number(item.score.toFixed(3))
        });
      }
    }

    return Array.from(byTermId.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.topK);
  }

  getCacheState() {
    return this.lastCacheState;
  }
}
