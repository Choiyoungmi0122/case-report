/**
 * 3순위 작업(docs/prompt_chain_review_v1.md §5-1 10~13번) 검증. 네트워크·DB 를 쓰지 않는다.
 *  - CHAIN1: 카드 본문을 다시 치환하지 않는다, 입력 해시가 절 단위 용어를 본다
 *  - CHAIN7: 저자가 쓴 섹션을 덮어쓰지 않는다, 생성한 섹션은 다음에 다시 쓴다, 저자 핵심어 유지
 *  - 용어 판정기: 메모이제이션, 연속 실패 시 잠시 끄기, 장애 시 원문 유지
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { runEvidenceSplit } from '../../src/llm/chains';
import { applyFinalDraftToSections, buildChain1InputHash } from '../../src/routes/cases';
import { OpenAITerminologyResolver } from '../../src/rag/openAILlmResolver';
import { resolveRetrievedTerminology } from '../../src/rag/resolver';

function fakeChat(content: string) {
  const calls: any[] = [];
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async (body: any) => {
          calls.push(body);
          return { choices: [{ finish_reason: 'stop', message: { content } }], usage: null };
        }
      }
    }
  });
  return calls;
}

async function run() {
  // ---------------------------------------------------------------- CHAIN1 카드 본문
  const clauseText = '두근거림이 심하다고 호소함.';
  const preparedVisits: any[] = [
    {
      index: 1,
      date: '2026-01-01',
      text: clauseText,
      normalizedText: clauseText,
      clauses: [
        { sourceText: clauseText, normalizedText: clauseText, terms: [], sectionHints: ['CLINICAL_FINDINGS'], start: 0, end: clauseText.length, score: 1 }
      ]
    }
  ];
  fakeChat(
    JSON.stringify({
      evidenceCards: [
        {
          id: 'card-1',
          visitIndex: 1,
          visitDateTime: '2026-01-01',
          sourceText: '두근거림이 심하다고 호소함',
          // 모델이 본문을 바꿔 내도 쓰지 않는다
          normalizedText: '심계가 심하다고 호소함',
          evidenceType: 'clinical_finding',
          tags: ['CLINICAL_FINDINGS'],
          confidence: 0.9
        }
      ]
    })
  );
  const cards = await runEvidenceSplit(preparedVisits);
  __setOpenAIClientForTests(null);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sourceText, clauseText);
  assert.equal(cards[0].normalizedText, clauseText, '카드 본문은 기록 표기 그대로');

  // ---------------------------------------------------------------- CHAIN1 입력 해시
  const withTerm = JSON.parse(JSON.stringify(preparedVisits));
  withTerm[0].clauses[0].terms = [{ surface: '두근거림', normalizedTerm: '심계', termId: 't1', status: 'CONFIRMED', needsUserConfirmation: false }];
  assert.notEqual(buildChain1InputHash(preparedVisits), buildChain1InputHash(withTerm), '절 단위 용어가 바뀌면 해시도 바뀐다');
  const confirmed = JSON.parse(JSON.stringify(withTerm));
  confirmed[0].clauses[0].normalizedText = '심계가 심하다고 호소함.';
  assert.notEqual(buildChain1InputHash(withTerm), buildChain1InputHash(confirmed), '용어 확정으로 절 본문이 바뀌면 해시도 바뀐다');
  assert.equal(buildChain1InputHash(preparedVisits), buildChain1InputHash(JSON.parse(JSON.stringify(preparedVisits))));

  // ---------------------------------------------------------------- CHAIN7 반영 규칙
  {
    const finalDraft: any = {
      fullTextBySection: { TITLE: '모델 제목', KEYWORDS: '모델, 핵심어', DISCUSSION_CONCLUSION: '모델 고찰', INTRODUCTION: '모델 서론', ABSTRACT: '모델 초록' },
      titleSuggestions: ['모델 제목'],
      keywordSuggestions: ['모델', '핵심어']
    };
    const sectionDrafts: any[] = [
      { sectionId: 'TITLE', draftText: '저자 제목', authoredBy: 'user' },
      { sectionId: 'DISCUSSION_CONCLUSION', draftText: '이전 모델 고찰', authoredBy: 'chain7' },
      { sectionId: 'INTRODUCTION', draftText: '' }
    ];
    const sectionStates: any[] = [{ sectionId: 'TITLE', status: 'READY', missingInfoBullets: [] }];
    applyFinalDraftToSections({ finalDraft, sectionDrafts, sectionStates, authoredKeywords: '저자, 키워드' });

    const byId = (id: string) => sectionDrafts.find((draft) => draft.sectionId === id);
    // 저자 제목은 그대로, 최종 원고 본문도 저자 제목으로
    assert.equal(byId('TITLE').draftText, '저자 제목');
    assert.equal(byId('TITLE').authoredBy, 'user');
    assert.equal(finalDraft.fullTextBySection.TITLE, '저자 제목');
    // 이전에 CHAIN7 이 쓴 고찰은 새로 쓴다 (예전에는 한 번 생성되면 굳었다)
    assert.equal(byId('DISCUSSION_CONCLUSION').draftText, '모델 고찰');
    assert.equal(byId('DISCUSSION_CONCLUSION').authoredBy, 'chain7');
    // 빈 섹션은 생성 결과로 채우고, 없던 섹션은 만든다
    assert.equal(byId('INTRODUCTION').draftText, '모델 서론');
    assert.equal(byId('ABSTRACT').draftText, '모델 초록');
    assert.equal(byId('INFORMED_CONSENT').draftText, '');
    // 저자 핵심어 유지
    assert.equal(finalDraft.fullTextBySection.KEYWORDS, '저자, 키워드');
    // 상태 문구는 한국어
    const titleState = sectionStates.find((state) => state.sectionId === 'TITLE');
    assert.equal(titleState.status, 'READY');
    assert.match(titleState.rationaleText, /저자가 작성한/);
    assert.match(sectionStates.find((state) => state.sectionId === 'INTRODUCTION').rationaleText, /최종 원고 구성/);
    assert.equal(sectionStates.find((state) => state.sectionId === 'INFORMED_CONSENT').status, 'IMPOSSIBLE');
  }
  {
    // 2026-10-12 이전 문서: 표시 없는 고찰은 이전 동작대로 둔다
    const finalDraft: any = { fullTextBySection: { DISCUSSION_CONCLUSION: '모델 고찰' } };
    const sectionDrafts: any[] = [{ sectionId: 'DISCUSSION_CONCLUSION', draftText: '옛 문서 고찰' }];
    applyFinalDraftToSections({ finalDraft, sectionDrafts, sectionStates: [] });
    assert.equal(sectionDrafts[0].draftText, '옛 문서 고찰');
    assert.equal(finalDraft.fullTextBySection.DISCUSSION_CONCLUSION, '옛 문서 고찰');
    // 표시 없는 제목은 생성 결과로 바꾼다
    const titleDraft: any = { fullTextBySection: { TITLE: '모델 제목' } };
    const titleDrafts: any[] = [{ sectionId: 'TITLE', draftText: '이전 생성 제목' }];
    applyFinalDraftToSections({ finalDraft: titleDraft, sectionDrafts: titleDrafts, sectionStates: [] });
    assert.equal(titleDrafts[0].draftText, '모델 제목');
  }

  // ---------------------------------------------------------------- 용어 판정기
  const candidates: any[] = [
    { termId: 'a', standardTerm: '심계', score: 0.8, matchType: 'fuzzy', term: { category: 'symptom', confidenceThreshold: 0.7 } },
    { termId: 'b', standardTerm: '심번', score: 0.79, matchType: 'fuzzy', term: { category: 'symptom', confidenceThreshold: 0.7 } }
  ];
  {
    let calls = 0;
    const resolver = new OpenAITerminologyResolver('test-model', async () => {
      calls += 1;
      return { decision: 'ASK_USER', confidence: 0.6, reason: '둘 다 맞음' };
    });
    const [first, second] = await Promise.all([
      resolver.resolve({ original: '심게', candidates }),
      resolver.resolve({ original: '심게', candidates: [...candidates].reverse() })
    ]);
    await resolver.resolve({ original: ' 심게 ', candidates });
    assert.equal(calls, 1, '같은 표현·후보는 한 번만 묻는다(진행 중인 호출도 공유)');
    assert.deepEqual(first, second);
    await resolver.resolve({ original: '심게2', candidates });
    assert.equal(calls, 2);
  }
  {
    let calls = 0;
    const resolver = new OpenAITerminologyResolver('test-model', async () => {
      calls += 1;
      throw Object.assign(new Error('503'), { status: 503 });
    });
    for (const word of ['가', '나', '다']) {
      await assert.rejects(() => resolver.resolve({ original: word, candidates }));
    }
    assert.equal(calls, 3);
    // 연속 3회 실패 → 잠시 꺼짐: 호출하지 않고 바로 실패
    await assert.rejects(() => resolver.resolve({ original: '라', candidates }), /temporarily disabled/);
    assert.equal(calls, 3);
    // 실패는 메모에 남지 않는다(꺼짐이 풀리면 다시 묻는다)
    // resolver.ts 는 판정기 실패를 원문 유지로 처리한다
    const decision = await resolveRetrievedTerminology({ original: '라', candidates, llmResolver: resolver });
    assert.equal(decision.decision, 'KEEP_ORIGINAL');
    assert.match(decision.reason, /원문/);
  }

  console.log('chain hygiene tests passed');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
