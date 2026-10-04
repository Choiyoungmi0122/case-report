import assert from 'node:assert/strict';
import { preprocessVisitsForChain1 } from '../../src/llm/chains';

const RAW_NAME = '홍길동';
const RAW_HOSPITAL = '동의병원';
const RAW_PHONE = '010-1234-5678';

async function run() {
  const seenSemanticInputs: string[] = [];
  const seenResolverInputs: string[] = [];

  await preprocessVisitsForChain1(
    [
      {
        index: 1,
        date: '2024-03-02',
        text: `${RAW_NAME} 환자가 ${RAW_HOSPITAL}에 내원하였다. 연락처는 ${RAW_PHONE}이다. moodscore 기록 및 PHQ9 검사를 시행하였다.`
      }
    ],
    {
      semanticMatcher: {
        search(surface) {
          seenSemanticInputs.push(surface);
          return [
            {
              termId: 'term_001',
              standardTerm: '귀비탕',
              confidence: 0.81
            },
            {
              termId: 'term_002',
              standardTerm: '가미귀비탕',
              confidence: 0.79
            }
          ];
        }
      },
      llmResolver: {
        resolve(input) {
          seenResolverInputs.push(JSON.stringify(input));
          return {
            decision: 'ASK_USER',
            confidence: 0.8,
            reason: 'ambiguous'
          };
        }
      }
    }
  );

  const joinedSemantic = seenSemanticInputs.join(' || ');
  const joinedResolver = seenResolverInputs.join(' || ');

  assert.ok(seenSemanticInputs.length > 0);
  assert.ok(seenResolverInputs.length > 0);
  assert.ok(!joinedSemantic.includes(RAW_NAME));
  assert.ok(!joinedSemantic.includes(RAW_HOSPITAL));
  assert.ok(!joinedSemantic.includes(RAW_PHONE));
  assert.ok(!joinedResolver.includes(RAW_NAME));
  assert.ok(!joinedResolver.includes(RAW_HOSPITAL));
  assert.ok(!joinedResolver.includes(RAW_PHONE));
  assert.ok(!joinedSemantic.includes('PATIENT_NAME'));
  assert.ok(!joinedSemantic.includes('PHONE'));
  assert.ok(!joinedSemantic.includes('EMAIL'));
  assert.ok(!joinedSemantic.includes('[PATIENT_NAME_1]'));
  assert.ok(!joinedSemantic.includes('[PHONE_1]'));
  assert.ok(joinedSemantic.includes('moodscore') || joinedSemantic.includes('PHQ9'));

  console.log('privacyIntegration tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
