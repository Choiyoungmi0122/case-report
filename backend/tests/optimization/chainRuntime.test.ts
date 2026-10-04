import assert from 'node:assert/strict';
import {
  appendPerformanceLog,
  buildChainCacheEntry,
  buildChainProgress,
  buildPerformanceLog,
  hasChainCacheHit,
  hashValue
} from '../../src/optimization/chainRuntime';

function run() {
  const first = hashValue({
    b: 2,
    a: 1,
    nested: {
      d: 4,
      c: 3
    }
  });

  const second = hashValue({
    nested: {
      c: 3,
      d: 4
    },
    a: 1,
    b: 2
  });

  assert.equal(first, second);

  const cacheEntry = buildChainCacheEntry('hash-1', { ok: true });
  assert.equal(cacheEntry.inputHash, 'hash-1');
  assert.ok(cacheEntry.outputHash);

  assert.equal(
    hasChainCacheHit(
      {
        chainCache: {
          CHAIN1: { inputHash: 'hash-1' }
        }
      },
      'CHAIN1',
      'hash-1'
    ),
    true
  );

  const progress = buildChainProgress('CHAIN3', ['CHAIN1', 'CHAIN2'], ['CHAIN4', 'CHAIN5']);
  assert.equal(progress.currentStep, 'CHAIN3');
  assert.deepEqual(progress.completedSteps, ['CHAIN1', 'CHAIN2']);
  assert.deepEqual(progress.estimatedRemainingSteps, ['CHAIN4', 'CHAIN5']);

  const perfLog = buildPerformanceLog({
    chainName: 'CHAIN1',
    startedAt: new Date(Date.now() - 20).toISOString(),
    inputHash: 'hash-1',
    cacheHit: false,
    llmCallCount: 1
  });
  assert.equal(perfLog.chainName, 'CHAIN1');
  assert.equal(perfLog.inputHash, 'hash-1');
  assert.equal(perfLog.cacheHit, false);
  assert.equal(perfLog.llmCallCount, 1);
  assert.ok(perfLog.durationMs >= 0);

  const appended = appendPerformanceLog([], perfLog);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.chainName, 'CHAIN1');

  console.log('chain runtime optimization tests passed');
}

run();
