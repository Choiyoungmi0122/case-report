import assert from 'node:assert/strict';
import { terminologyEntries } from '../../src/rag/loader';
import { resolveRetrievedTerminology } from '../../src/rag/resolver';
import { RetrievedTermCandidate } from '../../src/rag/types';

function makeCandidate(termId: string, score: number, matchType: RetrievedTermCandidate['matchType']): RetrievedTermCandidate {
  const term = terminologyEntries.find((entry) => entry.termId === termId);
  if (!term) throw new Error(`Missing term: ${termId}`);
  return {
    termId,
    original: '귀보탕',
    standardTerm: term.standardTerm,
    score,
    matchType,
    variant: term.standardTerm,
    term
  };
}

async function run() {
  const deterministic = await resolveRetrievedTerminology({
    original: 'PHQ9',
    candidates: [makeCandidate('term_008', 0.93, 'typo')]
  });
  assert.equal(deterministic.decision, 'USE_CANDIDATE');

  const ambiguous = await resolveRetrievedTerminology({
    original: '귀비',
    candidates: [makeCandidate('term_001', 0.81, 'semantic'), makeCandidate('term_002', 0.79, 'semantic')]
  });
  assert.equal(ambiguous.decision, 'ASK_USER');

  const invalidSelection = await resolveRetrievedTerminology({
    original: '귀비',
    candidates: [makeCandidate('term_001', 0.81, 'semantic'), makeCandidate('term_002', 0.79, 'semantic')],
    llmResolver: {
      resolve: () => ({
        decision: 'USE_CANDIDATE',
        selectedTermId: 'term_not_in_candidates',
        confidence: 0.99,
        reason: 'invalid'
      })
    }
  });
  assert.equal(invalidSelection.decision, 'ASK_USER');

  let resolverCalled = false;
  const fuzzyDeterministic = await resolveRetrievedTerminology({
    original: 'close fuzzy',
    candidates: [makeCandidate('term_008', 0.94, 'fuzzy')],
    llmResolver: {
      resolve: () => {
        resolverCalled = true;
        return {
          decision: 'ASK_USER',
          confidence: 0.5,
          reason: 'should not be used'
        };
      }
    }
  });
  assert.equal(fuzzyDeterministic.decision, 'USE_CANDIDATE');
  assert.equal(resolverCalled, false);

  const llmFailureFallback = await resolveRetrievedTerminology({
    original: 'ambiguous semantic',
    candidates: [makeCandidate('term_001', 0.81, 'semantic'), makeCandidate('term_002', 0.79, 'semantic')],
    llmResolver: {
      resolve: () => {
        throw new Error('resolver unavailable');
      }
    }
  });
  assert.equal(llmFailureFallback.decision, 'ASK_USER');

  const keepOriginal = await resolveRetrievedTerminology({
    original: 'weak semantic',
    candidates: [makeCandidate('term_001', 0.5, 'semantic')]
  });
  assert.equal(keepOriginal.decision, 'KEEP_ORIGINAL');

  console.log('resolver tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
