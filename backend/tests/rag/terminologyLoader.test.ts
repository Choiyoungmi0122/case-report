import assert from 'node:assert/strict';
import { loadTerminologyEntries, terminologyValidationIssues } from '../../src/rag/loader';

function run() {
  const loaded = loadTerminologyEntries();
  assert.equal(loaded.entries.length, 36);
  assert.ok(loaded.dataHash.length > 10);
  assert.equal(loaded.validation.hasErrors, false);
  assert.ok(
    terminologyValidationIssues.some((issue) => issue.code === 'ALIAS_COLLISION' || issue.code === 'NORMALIZED_ALIAS_COLLISION')
  );
  console.log('terminologyLoader tests passed');
}

run();
