import assert from 'node:assert/strict';
import Module from 'node:module';

/**
 * Mocked-outbound privacy test.
 *
 * The real OpenAI SDK is replaced before any project module is loaded, so every
 * chat-completion and embedding request is captured instead of sent. The test
 * then drives the actual chain functions with dummy PHI and inspects the exact
 * payload each outbound call received.
 *
 * No network request is made and no API key is used.
 */

const DUMMY = {
  name: '홍길동',
  hospital: '테스트한방병원',
  phone: '010-0000-0000',
  chartNo: 'TEST-12345'
};
const DUMMY_VALUES = Object.values(DUMMY);

type Captured = { kind: 'chat' | 'embedding'; text: string };
const captured: Captured[] = [];

function resetCaptured() {
  captured.length = 0;
}

function leakingCalls(): Array<{ kind: string; leaks: string[] }> {
  return captured
    .map((call) => ({ kind: call.kind, leaks: DUMMY_VALUES.filter((v) => call.text.includes(v)) }))
    .filter((entry) => entry.leaks.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Install the OpenAI mock before the project loads it                        */
/* -------------------------------------------------------------------------- */

function jsonForSchemaLabel(label: string): string {
  // Minimal schema-valid responses per chain, enough for the call to return.
  if (label.startsWith('CHAIN6')) {
    return JSON.stringify({ sectionId: 'CLINICAL_FINDINGS', updatedDraftText: '갱신된 초안입니다.', openIssues: [] });
  }
  if (label.startsWith('SECTION review')) {
    return JSON.stringify({
      sectionId: 'CLINICAL_FINDINGS',
      adequacyStatus: 'ADEQUATE',
      sectionCompleteness: 'HIGH',
      contentCompleteness: 'HIGH',
      naturalness: 'HIGH',
      evidenceGrounding: 'SUPPORTED',
      summary: '충분합니다.',
      missingRequiredItems: [],
      depthIssues: [],
      shouldAskMore: false,
      questionFocus: ''
    });
  }
  if (label.startsWith('CHAIN4')) {
    return JSON.stringify({ sectionMissing: [], commonMissing: [] });
  }
  if (label.startsWith('CHAIN5')) {
    return JSON.stringify({ commonQuestions: [], sectionQuestions: [] });
  }
  if (label.startsWith('TERMINOLOGY')) {
    return JSON.stringify({ decision: 'KEEP_ORIGINAL', confidence: 0.9, reason: 'test' });
  }
  return JSON.stringify({});
}

let currentLabel = '';

class MockOpenAI {
  chat = {
    completions: {
      create: async (params: any) => {
        const userMessage = (params.messages || []).find((m: any) => m.role === 'user');
        captured.push({ kind: 'chat', text: String(userMessage?.content || '') });
        return {
          choices: [{ message: { content: jsonForSchemaLabel(currentLabel) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        };
      }
    }
  };

  embeddings = {
    create: async (params: any) => {
      const inputs: string[] = Array.isArray(params.input) ? params.input : [params.input];
      for (const text of inputs) captured.push({ kind: 'embedding', text: String(text) });
      return { data: inputs.map((_, index) => ({ index, embedding: [0.1, 0.2, 0.3] })) };
    }
  };
}

const originalResolve = (Module as any)._load;
(Module as any)._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'openai') {
    return { __esModule: true, default: MockOpenAI };
  }
  return originalResolve.apply(this, [request, parent, isMain]);
};

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-used';

/* eslint-disable @typescript-eslint/no-var-requires */
const { runSectionDraftUpdate, runSectionAdequacyReview } = require('../../src/llm/chains');
const {
  deidentifyOutboundField,
  deidentifyQnaForOutbound,
  deidentifyTimelineEventsForOutbound,
  createOutboundDeidContext,
  OutboundPrivacyError
} = require('../../src/deid/outbound');
const { buildEvidenceCardsFromTimelineEvents } = require('../../src/timelineImport/integration');
const { callLLMWithSchema } = require('../../src/llm/client');
const { OpenAIEmbeddingProvider } = require('../../src/rag/openAIEmbeddingProvider');
const { z } = require('zod');

const RAW_ANSWER = `${DUMMY.name} 환자는 ${DUMMY.hospital}에서 검사했고 연락처는 ${DUMMY.phone}, 등록번호 ${DUMMY.chartNo}입니다.`;

function report(name: string) {
  const bad = leakingCalls();
  assert.equal(
    bad.length,
    0,
    `${name}: ${bad.length} outbound payload(s) leaked dummy identifiers (${JSON.stringify(bad.map((b) => b.kind))})`
  );
  assert.ok(captured.length > 0, `${name}: expected at least one captured outbound call`);
  console.log(`  ${name}: ${captured.length} outbound call(s), 0 leak`);
}

async function testSectionAnswer() {
  resetCaptured();
  currentLabel = 'CHAIN6';

  // Mirrors what routes/sections.ts now does before calling the chain.
  const context = createOutboundDeidContext();
  await runSectionDraftUpdate({
    sectionId: 'CLINICAL_FINDINGS',
    currentDraft: '기존 초안입니다.',
    evidenceCards: [{ id: 'ev1', normalizedText: '[PATIENT_NAME_1] 환자 어깨 통증', tags: ['CLINICAL_FINDINGS'] }],
    qnaHistory: await deidentifyQnaForOutbound(
      [{ question: '증상은 언제부터?', answer: RAW_ANSWER }],
      context
    ),
    pendingItems: [],
    question: await deidentifyOutboundField('증상은 언제부터?', context),
    answer: await deidentifyOutboundField(RAW_ANSWER, context)
  });

  const chatCall = captured.find((c) => c.kind === 'chat');
  assert.ok(chatCall, 'CHAIN6 should have issued a chat call');
  assert.ok(/\[[A-Z][A-Z_]*_\d+\]/.test(chatCall!.text), 'CHAIN6 payload should carry placeholders');
  report('Test B — section answer -> CHAIN6');
}

async function testCommonAnswer() {
  resetCaptured();
  currentLabel = 'CHAIN6';
  const context = createOutboundDeidContext();
  await runSectionDraftUpdate({
    sectionId: 'PATIENT_INFORMATION',
    currentDraft: '기존 초안.',
    evidenceCards: [],
    qnaHistory: await deidentifyQnaForOutbound([{ question: '동의 여부는?', answer: RAW_ANSWER }], context),
    pendingItems: [],
    question: await deidentifyOutboundField('동의 여부는?', context),
    answer: await deidentifyOutboundField(RAW_ANSWER, context)
  });
  report('Test C — common answer -> CHAIN6');
}

async function testReviewAI() {
  resetCaptured();
  currentLabel = 'SECTION review';
  const context = createOutboundDeidContext();
  await runSectionAdequacyReview({
    sectionId: 'CLINICAL_FINDINGS',
    currentDraft: await deidentifyOutboundField(`${DUMMY.name} 환자의 초안, ${DUMMY.hospital} 방문`, context),
    evidenceCards: [],
    qnaHistory: await deidentifyQnaForOutbound([{ question: 'Q', answer: RAW_ANSWER }], context)
  });
  report('Test D — Review AI');
}

async function testTimelineExcel() {
  resetCaptured();
  currentLabel = 'CHAIN6';

  const rawEvents = [
    {
      timelineEventId: 'evt1',
      originalRowIndex: 1,
      source: 'excel_import',
      importedAt: new Date(0).toISOString(),
      date: '2026-03-02',
      symptom: `${DUMMY.name} 환자 어깨 통증`,
      note: `${DUMMY.hospital}, ${DUMMY.phone}`,
      columnOrder: ['환자명', '등록번호'],
      cells: { 환자명: DUMMY.name, 등록번호: DUMMY.chartNo }
    }
  ];

  const outboundEvents = await deidentifyTimelineEventsForOutbound(rawEvents);
  const cards = buildEvidenceCardsFromTimelineEvents(outboundEvents);

  assert.ok(cards.length > 0, 'timeline should produce evidence cards');
  const cardText = JSON.stringify(cards);
  assert.equal(
    DUMMY_VALUES.filter((v) => cardText.includes(v)).length,
    0,
    'evidence cards built from timeline must not carry identifiers'
  );

  await runSectionDraftUpdate({
    sectionId: 'TIMELINE',
    currentDraft: '',
    evidenceCards: cards,
    qnaHistory: [],
    pendingItems: [],
    question: '경과는?',
    answer: '호전되었습니다.'
  });
  report('Test F — timeline Excel -> CHAIN6');
}

async function testManuscript() {
  resetCaptured();
  currentLabel = 'CHAIN4';

  const extracted = `서론: ${DUMMY.name} 환자는 ${DUMMY.hospital}에 내원하였다. 연락처 ${DUMMY.phone}.`;
  const outbound = await deidentifyOutboundField(extracted);

  await callLLMWithSchema(
    z.object({ sectionMissing: z.array(z.any()), commonMissing: z.array(z.any()) }),
    'system',
    `Manuscript section text:\n${outbound}`,
    { label: 'CHAIN4 missing', retries: 0 }
  );
  report('Test G — manuscript text -> CHAIN4');
}

async function testEmbedding() {
  resetCaptured();
  const provider = new OpenAIEmbeddingProvider();
  const clean = await deidentifyOutboundField(`${DUMMY.name} 환자 어깨 통증`);
  await provider.embed([clean]);
  report('Test A — RAG embedding');
}

async function testGuardBlocksRawPayload() {
  resetCaptured();

  // A chain that forgets to de-identify must be blocked, not sent.
  await assert.rejects(
    async () =>
      callLLMWithSchema(z.object({}), 'system', `연락처는 ${DUMMY.phone} 입니다.`, {
        label: 'UNSAFE chain',
        retries: 0
      }),
    (error: unknown) => {
      assert.ok(error instanceof OutboundPrivacyError, 'should raise OutboundPrivacyError');
      assert.equal(DUMMY_VALUES.filter((v) => (error as Error).message.includes(v)).length, 0);
      return true;
    }
  );
  assert.equal(captured.length, 0, 'a blocked chat call must issue zero outbound requests');

  const provider = new OpenAIEmbeddingProvider();
  await assert.rejects(
    async () => provider.embed([`연락처 ${DUMMY.phone}`]),
    (error: unknown) => error instanceof OutboundPrivacyError
  );
  assert.equal(captured.length, 0, 'a blocked embedding call must issue zero outbound requests');

  console.log('  Guard — unsafe payload blocked, outbound calls = 0');
}

async function run() {
  console.log('mocked outbound payload inspection:');
  await testEmbedding();
  await testSectionAnswer();
  await testCommonAnswer();
  await testReviewAI();
  await testTimelineExcel();
  await testManuscript();
  await testGuardBlocksRawPayload();
  console.log('outbound payload tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
