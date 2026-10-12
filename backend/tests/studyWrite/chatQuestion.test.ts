/**
 * 수정 요청 채팅 "질문 받기"(SW-Q4) 거르기 규칙. 네트워크·DB 를 쓰지 않는다.
 *  - 제목·초록은 체인을 부르지 않는다
 *  - 문헌 요소는 빠진 목록에서 뺀다, 빠진 것이 없으면 체인을 부르지 않는다
 *  - 고른 요소가 빠진 목록에 없으면 질문을 버린다
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { asksAboutRecord, generateSectionChatQuestion, missingCareElements, validTargets } from '../../src/studyWrite/chatQuestion';

const sub = (id: string, status: string, required: boolean, criterion = '기준') => ({
  id, label: id, required, group: 'base', groupLabel: '', criterion, source: 'CARE', status, hint: ''
});
const section = (sectionId: string, subs: any[]) => ({
  sectionId,
  draftText: '초안',
  version: 1,
  history: [],
  chat: [],
  attachmentIds: [],
  careCheck: { checkedAt: '', promptVersion: 'SW-C:v3', checklistVersion: 'care-checklist:v2', items: [{ code: 'x', label: 'x', required: true, status: 'present', hint: '', subItems: subs }] }
});

async function run() {
  let calls = 0;
  let reply: any = {};
  __setOpenAIClientForTests({
    chat: { completions: { create: async () => { calls += 1; return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }], usage: null }; } } }
  });
  const caseData = { id: 't', visits: [{ soapText: '기록' }] };

  // 문헌 요소 제외, 필수 먼저
  const intro: any = section('INTRODUCTION', [
    sub('4-1', 'not_in_record', true, '질환의 배경. [문헌 보완 필요] 표시만 있으면 present 가 아님'),
    sub('4-2', 'present', true),
    sub('4b-1', 'not_in_record', false, '문헌 인용. [문헌 보완 필요] 표시만 있으면 present 가 아님')
  ]);
  assert.deepEqual(missingCareElements(intro), [], '서론의 문헌 요소는 묻지 않음');
  const ti: any = section('THERAPEUTIC_INTERVENTIONS', [sub('9b-A7', 'not_in_record', false), sub('9b-A3', 'not_in_record', true), sub('9b-A1', 'present', true)]);
  assert.deepEqual(missingCareElements(ti).map((item) => item.id), ['9b-A3', '9b-A7'], '필수 먼저');

  // 대상 코드 검사
  const missing = missingCareElements(ti);
  assert.deepEqual(validTargets('9b-a3', missing), ['9b-A3']);
  assert.deepEqual(validTargets('9b-A2, 9b-A3', missing), ['9b-A3'], '목록에 없는 것은 뺌');
  assert.deepEqual(validTargets('5a-4', missing), [], '다른 섹션 요소');

  // 제목·초록: 체인을 부르지 않음
  const title = await generateSectionChatQuestion({ caseData, state: { rounds: [], sections: { TITLE: section('TITLE', []) } } as any, sectionId: 'TITLE' });
  assert.equal(title.kind, 'none');
  assert.equal(calls, 0);

  // 빠진 것 없음(문헌 요소뿐): 체인을 부르지 않음
  const none = await generateSectionChatQuestion({ caseData, state: { rounds: [], sections: { INTRODUCTION: intro } } as any, sectionId: 'INTRODUCTION' });
  assert.equal(none.kind, 'none');
  assert.match((none as any).message, /채워져 있어/);
  assert.equal(calls, 0);

  // 정상 질문
  reply = { question: '유침 시간은 몇 분이었나요?', hint: '분', targetCode: '9b-A3', reason: 'CARE 9b-A3 유침 시간이 없습니다.' };
  const ok = await generateSectionChatQuestion({ caseData, state: { rounds: [], sections: { THERAPEUTIC_INTERVENTIONS: ti } } as any, sectionId: 'THERAPEUTIC_INTERVENTIONS' });
  assert.equal(ok.kind, 'question');
  assert.equal((ok as any).targetCode, '9b-A3');
  assert.equal(calls, 1);

  // 기록 여부를 묻는 질문 판별
  assert.equal(asksAboutRecord('이 환자가 한의 진료를 처음 찾은 구체적인 동기나 경로가 기록에 있나요?'), true);
  assert.equal(asksAboutRecord('기록되어 있나요?'), true);
  assert.equal(asksAboutRecord('환자가 본원을 처음 찾은 계기는 무엇이었나요?'), false);
  assert.equal(asksAboutRecord('검사 결과를 기록해 두셨나요?'), false);

  // 기록 여부 질문이면 한 번 다시 묻는다
  const before = calls;
  let turn = 0;
  __setOpenAIClientForTests({
    chat: { completions: { create: async () => { calls += 1; turn += 1; const content = turn === 1 ? { question: '유침 시간이 기록에 있나요?', targetCode: '9b-A3' } : { question: '유침 시간은 몇 분이었나요?', targetCode: '9b-A3' }; return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: null }; } } }
  });
  const retried = await generateSectionChatQuestion({ caseData, state: { rounds: [], sections: { THERAPEUTIC_INTERVENTIONS: ti } } as any, sectionId: 'THERAPEUTIC_INTERVENTIONS' });
  assert.equal(retried.kind, 'question');
  assert.equal((retried as any).question, '유침 시간은 몇 분이었나요?');
  assert.equal(calls - before, 2);
  __setOpenAIClientForTests({
    chat: { completions: { create: async () => { calls += 1; return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }], usage: null }; } } }
  });

  // 다른 섹션 요소를 고르면 버림
  reply = { question: '처방 용량은?', hint: '', targetCode: '9b-H2', reason: '' };
  const dropped = await generateSectionChatQuestion({ caseData, state: { rounds: [], sections: { THERAPEUTIC_INTERVENTIONS: ti } } as any, sectionId: 'THERAPEUTIC_INTERVENTIONS' });
  assert.equal(dropped.kind, 'none');

  __setOpenAIClientForTests(null);
  console.log('chatQuestion tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
