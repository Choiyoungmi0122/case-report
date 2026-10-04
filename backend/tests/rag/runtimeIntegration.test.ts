import assert from 'node:assert/strict';
import { preprocessVisitsForChain1 } from '../../src/llm/chains';

async function run() {
  let semanticCalls = 0;
  let resolverCalls = 0;

  const processed = await preprocessVisitsForChain1(
    [
      {
        index: 1,
        date: '2024-03-02',
        text: 'moodscore 검사를 다시 시행하였다.'
      }
    ],
    {
      semanticMatcher: {
        search(surface) {
          semanticCalls += 1;
          if (surface.toLowerCase().includes('moodscore')) {
            return [
              { termId: 'term_008', standardTerm: 'PHQ-9', confidence: 0.82 },
              { termId: 'term_009', standardTerm: 'GAD-7', confidence: 0.79 }
            ];
          }
          return [];
        }
      },
      llmResolver: {
        resolve() {
          resolverCalls += 1;
          return {
            decision: 'ASK_USER',
            confidence: 0.8,
            reason: 'needs confirmation'
          };
        }
      }
    }
  );

  assert.ok(semanticCalls > 0);
  assert.ok(resolverCalls > 0);
  assert.ok(
    processed.pendingTermConfirmations.some(
      (item) => item.surface.toLowerCase().includes('moodscore') && item.matchType === 'semantic'
    )
  );

  const fallback = await preprocessVisitsForChain1(
    [
      {
        index: 1,
        date: '2024-03-02',
        text: 'moodscore 검사를 다시 시행하였다.'
      }
    ],
    {
      semanticMatcher: {
        search() {
          throw new Error('provider unavailable');
        }
      }
    }
  );

  assert.equal(
    fallback.pendingTermConfirmations.some((item) => item.surface.toLowerCase().includes('moodscore')),
    false
  );

  console.log('runtimeIntegration tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
