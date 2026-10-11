/**
 * 2순위 작업(docs/prompt_chain_review_v1.md §5-1 6~9번) 검증:
 *  - 관대한 섹션 id·배열 스키마, CHAIN7/SW-Q2 배열 완화
 *  - 전송 오류만 재시도, 형식 오류는 수정 호출 1회, 잘린 출력은 즉시 실패, 체인별 상한
 *  - 근거 범위 tags ∪ sectionHints, CHAIN4→5 갱신 단일 구현의 상태 규칙
 */
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  CHAIN_LIMITS,
  LLMOutputError,
  __setOpenAIClientForTests,
  buildRepairInstruction,
  callLLMWithSchema,
  resolveChainLimits
} from '../../src/llm/client';
import { shouldRetryLLMError } from '../../src/utils/errorSummary';
import { Chain3ModelOutputSchema } from '../../src/llm/schemas/chain3_draft';
import { Chain4MissingOutputSchema } from '../../src/llm/schemas/chain4_missing';
import { Chain5QuestionOutputSchema } from '../../src/llm/schemas/chain5_questions';
import { FinalDraftModelOutputSchema } from '../../src/llm/schemas/chain5_final';
import { SectionAdequacyReviewOutputSchema } from '../../src/llm/schemas/section_adequacy_review';
import { StudyWriteGapQuestionsOutputSchema } from '../../src/llm/schemas/studyWrite_questions';
import { coerceCareSection } from '../../src/llm/schemas/common';
import { cardMatchesSection, cardSections, getEvidenceForSections, getRelevantEvidence } from '../../src/llm/evidenceScope';
import { applyQuestionResultsToStates, buildQuestionStateInputHash } from '../../src/questions/questionState';

type FakeResponse = { content?: string | null; finish_reason?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
type Step = FakeResponse | { throw: unknown };

function fakeClient(steps: Step[]) {
  const calls: Array<{ body: any; options: any }> = [];
  const client = {
    chat: {
      completions: {
        create: async (body: any, options: any) => {
          calls.push({ body, options });
          const step = steps.shift();
          if (!step) throw new Error('no more fake steps');
          if ('throw' in step) throw step.throw;
          return {
            choices: [{ finish_reason: step.finish_reason || 'stop', message: { content: step.content ?? null } }],
            usage: step.usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          };
        }
      }
    }
  };
  __setOpenAIClientForTests(client);
  return calls;
}

const TestSchema = z.object({ value: z.number() });
const SYSTEM = '시스템';
const USER = '사용자 입력';

async function run() {
  // ---------- 섹션 id 정규화
  assert.equal(coerceCareSection('therapeutic_intervention'), 'THERAPEUTIC_INTERVENTIONS');
  assert.equal(coerceCareSection('Follow-up Outcomes'), 'FOLLOW_UP_OUTCOMES');
  assert.equal(coerceCareSection('discussion'), 'DISCUSSION_CONCLUSION');
  assert.equal(coerceCareSection('8'), undefined);

  // ---------- CHAIN3 모델 출력: 변형 id 허용, 빠진 배열은 빈 배열
  const chain3 = Chain3ModelOutputSchema.parse({
    sectionDrafts: [{ sectionId: 'therapeutic_intervention', draftText: '초안', evidenceCardIdsUsed: ['e1'] }]
  });
  assert.equal(chain3.sectionDrafts[0].sectionId, 'THERAPEUTIC_INTERVENTIONS');
  assert.deepEqual(chain3.sectionDrafts[0].openIssues, []);
  // 알아볼 수 없는 id 는 여전히 실패 → 수정 호출로 간다
  assert.equal(Chain3ModelOutputSchema.safeParse({ sectionDrafts: [{ sectionId: 'SOMETHING', draftText: '' }] }).success, false);

  // ---------- CHAIN4/5: 목록 안의 오타 하나로 전체가 실패하지 않는다. 허용 밖 category 는 버린다
  const chain4 = Chain4MissingOutputSchema.parse({
    sectionMissing: [{ sectionId: 'clinical_finding', missingItems: ['a'] }],
    commonMissing: [{ item: 'x', relatedSectionIds: ['PATIENT_INFORMATION', 'nonsense', 'Timeline'], category: 'made_up' }]
  });
  assert.deepEqual(chain4.commonMissing[0].relatedSectionIds, ['PATIENT_INFORMATION', 'TIMELINE']);
  assert.equal(chain4.commonMissing[0].category, undefined);
  assert.equal(chain4.sectionMissing[0].sectionId, 'CLINICAL_FINDINGS');
  const chain5 = Chain5QuestionOutputSchema.parse({
    commonQuestions: [{ question: 'q', targetSectionIds: ['follow_up_outcome'], category: 'Treatment_Response' }],
    sectionQuestions: [{ sectionId: 'TIMELINE' }]
  });
  assert.deepEqual(chain5.commonQuestions[0].targetSectionIds, ['FOLLOW_UP_OUTCOMES']);
  assert.equal(chain5.commonQuestions[0].category, 'treatment_response');
  assert.deepEqual(chain5.sectionQuestions[0].questions, []);

  // ---------- CHAIN7: 빈 핵심어 허용, 초과분 잘라내기, 변형 키 정규화·모르는 키 제거
  const chain7 = FinalDraftModelOutputSchema.parse({
    fullTextBySection: { TITLE: '제목', Keywords: 'a, b', therapeutic_interventions: '본문', UNKNOWN: 'x' },
    titleSuggestions: ['1', '2', '3', '4', '5'],
    keywordSuggestions: [],
    abstractSuggestion: '요약',
    careChecklistEvaluation: { title: { status: 'FULFILLED', rationale: '' }, NOPE: { status: 'MISSING', rationale: '' } }
  });
  assert.deepEqual(chain7.titleSuggestions, ['1', '2', '3']);
  assert.deepEqual(chain7.keywordSuggestions, []);
  assert.deepEqual(Object.keys(chain7.fullTextBySection).sort(), ['KEYWORDS', 'THERAPEUTIC_INTERVENTIONS', 'TITLE']);
  assert.deepEqual(Object.keys(chain7.careChecklistEvaluation), ['TITLE']);
  const tenKeywords = FinalDraftModelOutputSchema.parse({
    fullTextBySection: {},
    keywordSuggestions: Array.from({ length: 10 }, (_, i) => `k${i}`),
    careChecklistEvaluation: {}
  });
  assert.equal(tenKeywords.keywordSuggestions.length, 7);

  // ---------- 검토: 섹션 id 변형 허용
  const review = SectionAdequacyReviewOutputSchema.parse({
    sectionId: 'patient_perspective',
    adequacyStatus: 'N/A',
    sectionCompleteness: 'LOW',
    contentCompleteness: 'LOW',
    naturalness: 'LOW',
    evidenceGrounding: 'SUPPORTED',
    shouldAskMore: false
  });
  assert.equal(review.sectionId, 'PATIENT_PERSPECTIVE');
  assert.equal(review.adequacyStatus, 'INSUFFICIENT');

  // ---------- SW-Q2: 3개 초과도 검증 실패가 아니다(회차 예산만큼 잘라 쓴다), 빈 targetSectionIds 허용
  const swq2 = StudyWriteGapQuestionsOutputSchema.parse({
    questions: Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, targetSectionIds: [], careItem: '9a', priority: 'required', rationale: '' }))
  });
  assert.equal(swq2.questions.length, 5);

  // ---------- 체인별 상한
  assert.deepEqual(resolveChainLimits('CHAIN3 draft'), CHAIN_LIMITS.CHAIN3);
  assert.deepEqual(resolveChainLimits('CHAIN3_STUDY_REVEAL:THERAPEUTIC_INTERVENTIONS'), CHAIN_LIMITS.CHAIN3);
  assert.deepEqual(resolveChainLimits('SW-D THERAPEUTIC_INTERVENTIONS'), CHAIN_LIMITS['SW-D']);
  assert.deepEqual(resolveChainLimits('SECTION review'), CHAIN_LIMITS.SECTION);
  assert.equal(resolveChainLimits('LLM').timeoutMs > 0, true);

  // ---------- 재시도 분류
  assert.equal(shouldRetryLLMError({ status: 503 }), true);
  assert.equal(shouldRetryLLMError({ status: 429 }), true);
  assert.equal(shouldRetryLLMError({ status: 400 }), false);
  assert.equal(shouldRetryLLMError(new z.ZodError([])), false);
  assert.equal(shouldRetryLLMError(new SyntaxError('bad json')), false);
  assert.equal(shouldRetryLLMError(new LLMOutputError('llm_output_truncated', 'cut')), false);

  // ---------- 형식 오류 → 수정 호출 1회 (같은 프롬프트 재전송 없음), 토큰 사용량은 합산
  {
    const calls = fakeClient([
      { content: '{"value": "not a number"}', usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
      { content: '{"value": 7}', usage: { prompt_tokens: 120, completion_tokens: 5, total_tokens: 125 } }
    ]);
    let usage: any = undefined;
    const result = await callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN2 assessment', onUsage: (u) => (usage = u) });
    assert.deepEqual(result, { value: 7 });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.messages.length, 4);
    assert.equal(calls[1].body.messages[2].role, 'assistant');
    assert.equal(calls[1].body.messages[2].content, '{"value": "not a number"}');
    assert.match(calls[1].body.messages[3].content, /value/);
    assert.deepEqual(usage, { promptTokens: 220, completionTokens: 15, totalTokens: 235 });
    // 체인 상한이 요청에 들어간다
    assert.equal(calls[0].body.max_completion_tokens, CHAIN_LIMITS.CHAIN2.maxOutputTokens);
    assert.equal(calls[0].options.timeout, CHAIN_LIMITS.CHAIN2.timeoutMs);
  }

  // ---------- JSON 구문 오류도 수정 호출로
  {
    const calls = fakeClient([{ content: '{"value": 1' }, { content: '{"value": 1}' }]);
    const result = await callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN4 missing' });
    assert.deepEqual(result, { value: 1 });
    assert.equal(calls.length, 2);
    assert.match(calls[1].body.messages[3].content, /JSON 구문 오류/);
  }

  // ---------- 수정 호출도 실패하면 LLMOutputError, 호출은 정확히 2회
  {
    const calls = fakeClient([{ content: '{"value": "a"}' }, { content: '{"value": "b"}' }]);
    await assert.rejects(
      () => callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN5 questions' }),
      (error: any) => error instanceof LLMOutputError && error.code === 'llm_output_invalid'
    );
    assert.equal(calls.length, 2);
  }

  // ---------- 전송 오류는 같은 요청 재시도(백오프), 성공하면 끝
  {
    const calls = fakeClient([{ throw: { status: 503, message: 'unavailable' } }, { content: '{"value": 2}' }]);
    const result = await callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN6 update' });
    assert.deepEqual(result, { value: 2 });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].body.messages, calls[1].body.messages);
  }

  // ---------- 400 은 즉시 실패
  {
    const calls = fakeClient([{ throw: { status: 400, message: 'bad request' } }]);
    await assert.rejects(() => callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN1 extraction' }), (e: any) => e.status === 400);
    assert.equal(calls.length, 1);
  }

  // ---------- 잘린 출력은 재시도·수정 없이 즉시 실패
  {
    const calls = fakeClient([{ content: '{"value": 1', finish_reason: 'length' }]);
    await assert.rejects(
      () => callLLMWithSchema(TestSchema, SYSTEM, USER, { label: 'CHAIN7 final' }),
      (error: any) => error instanceof LLMOutputError && error.code === 'llm_output_truncated'
    );
    assert.equal(calls.length, 1);
  }

  // ---------- 수정 지시문에는 경로·메시지만 들어간다
  const repair = buildRepairInstruction(new z.ZodError([{ code: 'invalid_type', expected: 'number', received: 'string', path: ['value'], message: 'Expected number' }]));
  assert.match(repair, /value: Expected number/);
  __setOpenAIClientForTests(null);

  // ---------- 근거 범위: tags ∪ sectionHints
  const cards = [
    { id: 'a', tags: ['THERAPEUTIC_INTERVENTIONS'], sectionHints: [] },
    { id: 'b', tags: [], sectionHints: ['therapeutic_intervention'] },
    { id: 'c', tags: ['TIMELINE'], sectionHints: ['CLINICAL_FINDINGS'] },
    { id: 'd', tags: ['bogus'], sectionHints: ['bogus'] }
  ];
  assert.deepEqual(cardSections(cards[2]), ['TIMELINE', 'CLINICAL_FINDINGS']);
  assert.equal(cardMatchesSection(cards[1], 'THERAPEUTIC_INTERVENTIONS'), true);
  assert.deepEqual(getRelevantEvidence(cards, 'THERAPEUTIC_INTERVENTIONS').map((c) => c.id), ['a', 'b']);
  assert.deepEqual(getEvidenceForSections(cards, ['CLINICAL_FINDINGS', 'nonsense']).map((c) => c.id), ['c']);
  assert.deepEqual(getEvidenceForSections(cards, []), []);

  // ---------- 입력 해시는 sectionHints 변화에도 반응한다
  const baseParams = {
    sectionDrafts: [{ sectionId: 'THERAPEUTIC_INTERVENTIONS', draftText: '초안', openIssues: [] }],
    sectionStates: [{ sectionId: 'THERAPEUTIC_INTERVENTIONS', status: 'READY', rationaleText: '' }],
    evidenceCards: [{ id: 'a', sourceText: 't', tags: [], sectionHints: ['THERAPEUTIC_INTERVENTIONS'] }],
    caseTitle: ''
  };
  const hashA = buildQuestionStateInputHash(baseParams);
  const hashB = buildQuestionStateInputHash({ ...baseParams, evidenceCards: [{ ...baseParams.evidenceCards[0], sectionHints: [] }] });
  assert.notEqual(hashA, hashB);

  // ---------- CHAIN4→5 갱신 상태 규칙
  const states = [
    { sectionId: 'THERAPEUTIC_INTERVENTIONS', status: 'INCOMPLETE', rationaleText: 'CHAIN2: 용량이 없음', missingInfoBullets: ['용량'], recommendedQuestions: ['q'] },
    { sectionId: 'PATIENT_PERSPECTIVE', status: 'INCOMPLETE', rationaleText: 'CHAIN2 설명', missingInfoBullets: ['x'], recommendedQuestions: [] },
    { sectionId: 'TIMELINE', status: 'INCOMPLETE', rationaleText: '그대로', missingInfoBullets: [], recommendedQuestions: [] },
    { sectionId: 'TITLE', status: 'READY', rationaleText: '비핵심', missingInfoBullets: [], recommendedQuestions: [] }
  ];
  applyQuestionResultsToStates({
    sectionStates: states,
    sectionDrafts: [
      { sectionId: 'THERAPEUTIC_INTERVENTIONS', draftText: '초안 있음' },
      { sectionId: 'PATIENT_PERSPECTIVE', draftText: '' },
      { sectionId: 'TIMELINE', draftText: '초안' }
    ],
    // 모델이 TI 를 내지 않음 → 없음으로 본다 → READY (이전 bullets 유지 안 함)
    sectionMissing: [{ sectionId: 'TIMELINE', missingItems: ['날짜', '날짜'] }],
    sectionQuestions: [{ sectionId: 'TIMELINE', questions: ['언제?'] }]
  });
  assert.equal(states[0].status, 'READY');
  assert.deepEqual(states[0].missingInfoBullets, []);
  assert.match(states[0].rationaleText, /작성할 수 있습니다/);
  // 초안 없음 → IMPOSSIBLE
  assert.equal(states[1].status, 'IMPOSSIBLE');
  // 상태 그대로(INCOMPLETE 유지)면 CHAIN2 설명을 남긴다. 중복 항목은 하나로
  assert.equal(states[2].status, 'INCOMPLETE');
  assert.equal(states[2].rationaleText, '그대로');
  assert.deepEqual(states[2].missingInfoBullets, ['날짜']);
  // 비핵심 섹션은 상태를 건드리지 않는다
  assert.equal(states[3].status, 'READY');
  assert.equal(states[3].rationaleText, '비핵심');

  console.log('llm client tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
