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

  // 뜻 유사 매칭은 판정기까지 가지 않고 원문을 둔다. 사용자에게 묻는 항목도 만들지 않는다 (2026-10-11).
  assert.ok(semanticCalls > 0);
  assert.equal(resolverCalls, 0);
  assert.equal(
    processed.pendingTermConfirmations.some((item) => item.surface.toLowerCase().includes('moodscore')),
    false
  );
  assert.ok(processed.deidentifiedEMRs[0]?.deidentifiedText.includes('moodscore'));

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
