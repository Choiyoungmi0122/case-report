import assert from 'node:assert/strict';
import { terminologyEntries } from '../../src/rag/loader';
import { retrieveTermCandidates } from '../../src/rag/retriever';

const GUIBO_TANG = '\uADC0\uBCF4\uD0D5';
const GUIBI = '\uADC0\uBE44';

async function run() {
  const exact = await retrieveTermCandidates('PHQ-9', { entries: terminologyEntries });
  assert.equal(exact[0]?.matchType, 'exact');
  assert.equal(exact[0]?.termId, 'term_008');

  const typo = await retrieveTermCandidates('PHQ9', { entries: terminologyEntries });
  assert.ok(['synonym', 'typo'].includes(typo[0]?.matchType || ''));
  assert.equal(typo[0]?.standardTerm, 'PHQ-9');

  const fuzzy = await retrieveTermCandidates(GUIBO_TANG, { entries: terminologyEntries });
  assert.equal(fuzzy[0]?.matchType, 'typo');
  assert.ok(fuzzy.some((item) => item.termId === 'term_001'));

  const partial = await retrieveTermCandidates(GUIBI, { entries: terminologyEntries });
  assert.equal(partial[0]?.matchType, 'partial');
  assert.ok(partial.length >= 2);

  console.log('hybridRetriever tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
