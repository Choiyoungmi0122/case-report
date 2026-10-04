import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { terminologyEntries } from '../../src/rag/loader';
import { EmbeddingSemanticMatcher, EmbeddingProvider } from '../../src/rag/semantic';

class MockEmbeddingProvider implements EmbeddingProvider {
  calls: string[][] = [];

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push([...texts]);
    return texts.map((text) => {
      const normalized = text.toLowerCase();
      if (
        normalized.includes('depression') ||
        normalized.includes('phq') ||
        normalized.includes('patient health questionnaire')
      ) {
        return [1, 0, 0];
      }
      if (
        normalized.includes('anxiety') ||
        normalized.includes('gad') ||
        normalized.includes('generalized anxiety disorder')
      ) {
        return [0, 1, 0];
      }
      return [0, 0, 1];
    });
  }
}

async function run() {
  const cachePath = path.resolve(__dirname, '../../data/terminology/embeddings.test.json');
  if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);

  const provider = new MockEmbeddingProvider();
  const matcher = new EmbeddingSemanticMatcher({
    provider,
    model: 'mock-embedding',
    cachePath,
    threshold: 0.5,
    topK: 3
  });

  const results = await matcher.search('Patient Health Questionnaire', terminologyEntries);
  assert.equal(results[0]?.termId, 'term_008');
  assert.ok(fs.existsSync(cachePath));
  assert.ok(provider.calls.length >= 2);
  assert.ok(provider.calls.some((call) => call.length > 10));

  const resultsSecond = await matcher.search('Generalized Anxiety Disorder', terminologyEntries);
  assert.equal(resultsSecond[0]?.termId, 'term_009');
  assert.equal(provider.calls.length, 3);
  assert.deepEqual(provider.calls[2], ['Generalized Anxiety Disorder']);

  const cachePayload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(cachePayload.model, 'mock-embedding');
  assert.ok(typeof cachePayload.terminologyDataHash === 'string');
  assert.ok(Array.isArray(cachePayload.entries));
  assert.ok(cachePayload.entries.length >= terminologyEntries.length);

  const providerWithDifferentModel = new MockEmbeddingProvider();
  const matcherWithDifferentModel = new EmbeddingSemanticMatcher({
    provider: providerWithDifferentModel,
    model: 'mock-embedding-v2',
    cachePath,
    threshold: 0.5,
    topK: 3
  });
  await matcherWithDifferentModel.search('Patient Health Questionnaire', terminologyEntries);
  assert.ok(providerWithDifferentModel.calls.length >= 2);

  fs.writeFileSync(cachePath, '{"broken": true}', 'utf8');
  const providerWithMalformedCache = new MockEmbeddingProvider();
  const matcherWithMalformedCache = new EmbeddingSemanticMatcher({
    provider: providerWithMalformedCache,
    model: 'mock-embedding',
    cachePath,
    threshold: 0.5,
    topK: 3
  });
  await matcherWithMalformedCache.search('Patient Health Questionnaire', terminologyEntries);
  assert.ok(providerWithMalformedCache.calls.length >= 2);

  fs.unlinkSync(cachePath);
  console.log('semanticMatcher tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
