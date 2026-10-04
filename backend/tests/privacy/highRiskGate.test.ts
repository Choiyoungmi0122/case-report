import assert from 'node:assert/strict';
import Module from 'node:module';

/**
 * HIGH-risk gate test.
 *
 * Requirement: when the pipeline classifies de-identification as HIGH risk, the
 * external call count must be zero - no embedding, no terminology resolver, no
 * chat completion. Before this fix the RAG stage ran BEFORE the gate, so an
 * embedding request was already issued by the time HIGH was decided.
 *
 * The OpenAI SDK is mocked; nothing leaves the machine and no key is used.
 */

let embeddingCalls = 0;
let chatCalls = 0;

class MockOpenAI {
  chat = {
    completions: {
      create: async () => {
        chatCalls += 1;
        return {
          choices: [{ message: { content: '{}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        };
      }
    }
  };

  embeddings = {
    create: async (params: any) => {
      embeddingCalls += 1;
      const inputs: string[] = Array.isArray(params.input) ? params.input : [params.input];
      return { data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3] })) };
    }
  };
}

/**
 * `chains.ts` binds `deidentifyCaseEMRs` at import time, so patching the module
 * object afterwards has no effect. The de-identification module is therefore
 * wrapped at resolution time, before `chains.ts` is loaded, and the override is
 * toggled through `forcedHighRisk`.
 */
let forcedHighRisk = false;

const originalLoad = (Module as any)._load;
(Module as any)._load = function patched(request: string, parent: any, isMain: boolean) {
  if (request === 'openai') return { __esModule: true, default: MockOpenAI };

  const loaded = originalLoad.apply(this, [request, parent, isMain]);

  const isDeidIndex =
    typeof request === 'string' &&
    (request === '../deid' || request.endsWith('/deid')) &&
    loaded &&
    typeof loaded.deidentifyCaseEMRs === 'function';

  if (isDeidIndex) {
    const real = loaded.deidentifyCaseEMRs;
    return new Proxy(loaded, {
      get(target, prop, receiver) {
        if (prop === 'deidentifyCaseEMRs') {
          return async (visits: Array<{ text: string; emrId?: string }>, options?: unknown) => {
            if (!forcedHighRisk) return real(visits, options);
            return visits.map((visit, index) => ({
              emrId: visit.emrId || `emr_${index}`,
              originalTextStoredLocalOnly: true,
              deidentifiedText: '연락처 010-0000-0000 이 남아있는 비식별 실패 텍스트',
              phiSpans: [],
              replacementMap: [],
              riskLevel: 'HIGH' as const
            }));
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  return loaded;
};

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

/* eslint-disable @typescript-eslint/no-var-requires */
const { evaluateDeidentificationRisk } = require('../../src/deid/detector');
const { preprocessVisitsForChain1 } = require('../../src/llm/chains');

/** The risk rule itself: a residual high-risk identifier means HIGH. */
function assertRiskRule() {
  assert.equal(evaluateDeidentificationRisk('연락처 010-0000-0000 남아있음', []), 'HIGH');
  assert.equal(evaluateDeidentificationRisk('메일 test@example.com 남아있음', []), 'HIGH');
  assert.equal(evaluateDeidentificationRisk('주민 900101-1234567 남아있음', []), 'HIGH');
  assert.equal(
    evaluateDeidentificationRisk('[PATIENT_NAME_1] 환자 어깨 통증', [
      { type: 'PATIENT_NAME', originalText: 'x', replacement: '[PATIENT_NAME_1]', startIndex: 0, endIndex: 1, confidence: 0.9 }
    ]),
    'LOW'
  );
  console.log('  risk rule: residual phone / e-mail / RRN -> HIGH');
}

/**
 * Forces the de-identification stage to report a HIGH-risk record, which is how
 * a real "de-identification did not fully succeed" case surfaces. Stubbing here
 * keeps the test deterministic and independent of which regex happens to miss.
 */
async function assertZeroOutboundOnHighRisk() {
  embeddingCalls = 0;
  chatCalls = 0;
  let resolverCalls = 0;
  let matcherCalls = 0;

  forcedHighRisk = true;

  try {
    const preprocessed = await preprocessVisitsForChain1(
      [{ index: 1, date: '2026-03-02', text: 'S: 우측 견관절 통증.' }],
      {
        // Both runtimes are supplied, so a zero count proves the GATE stopped
        // them rather than a missing dependency.
        semanticMatcher: {
          async search() {
            matcherCalls += 1;
            return [];
          }
        },
        llmResolver: {
          async resolve() {
            resolverCalls += 1;
            return { decision: 'KEEP_ORIGINAL', confidence: 0.9, reason: 'test' };
          }
        }
      }
    );

    assert.equal(preprocessed.reviewRequired?.riskLevel, 'HIGH', 'pipeline must report HIGH');
    assert.deepEqual(
      preprocessed.preparedVisits,
      [],
      'HIGH risk must short-circuit before any RAG preparation'
    );
    assert.ok(
      preprocessed.deidentifiedEMRs.length > 0,
      'de-identified records are still returned so the user can review the block'
    );

    assert.equal(embeddingCalls, 0, `embedding calls must be 0, was ${embeddingCalls}`);
    assert.equal(matcherCalls, 0, `semantic matcher calls must be 0, was ${matcherCalls}`);
    assert.equal(resolverCalls, 0, `resolver calls must be 0, was ${resolverCalls}`);
    assert.equal(chatCalls, 0, `LLM calls must be 0, was ${chatCalls}`);

    console.log(`  HIGH risk -> embedding=${embeddingCalls} resolver=${resolverCalls} matcher=${matcherCalls} llm=${chatCalls}`);
  } finally {
    forcedHighRisk = false;
  }
}

/** The gate must not block ordinary input. */
async function assertNonHighStillProcesses() {
  embeddingCalls = 0;
  chatCalls = 0;
  let matcherCalls = 0;

  const preprocessed = await preprocessVisitsForChain1(
    [{ index: 1, date: '2026-03-02', text: 'S: 우측 견관절 통증. 활혈지통탕 처방.' }],
    {
      semanticMatcher: {
        async search() {
          matcherCalls += 1;
          return [];
        }
      }
    }
  );

  assert.notEqual(preprocessed.reviewRequired?.riskLevel, 'HIGH');
  assert.ok(
    preprocessed.preparedVisits.length > 0,
    'non-HIGH input must still be prepared for the chains'
  );
  console.log(`  non-HIGH -> preparedVisits=${preprocessed.preparedVisits.length}, matcher invoked ${matcherCalls}x`);
}

async function run() {
  console.log('HIGH risk gate:');
  assertRiskRule();
  await assertZeroOutboundOnHighRisk();
  await assertNonHighStillProcesses();
  console.log('high risk gate tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
