/**
 * Scaffold / Write 프롬프트 세트 분리(2026-10-12) 검증. 네트워크·DB 를 쓰지 않는다.
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { runInitialSectionDrafts, runSectionAssessment } from '../../src/llm/chains';
import { chainLabel, chainPrompts, promptSetForCase } from '../../src/llm/promptSets';
import {
  promptKeyForChainName,
  promptMeta,
  promptMetaForChainName,
  promptTemplateHash,
  promptVersionLabel
} from '../../src/llm/promptRegistry';
import { buildChainCacheEntry, buildPerformanceLog, hasChainCacheHit } from '../../src/optimization/chainRuntime';
import {
  buildScaffoldChain3SystemPrompt,
  buildScaffoldRevealSystemPrompt,
  chain3SystemPrompt as scaffoldChain3,
  SCAFFOLD_CHAIN3_SECTIONS
} from '../../src/llm/prompts/scaffold/chain3_draft';
import { buildChain3Inputs } from '../../src/llm/chains';
import { createHash } from 'node:crypto';

async function run() {
  // ---------------------------------------------------------------- 세트 판정
  assert.equal(promptSetForCase({ mode: 'scaffold' }), 'scaffold');
  assert.equal(promptSetForCase({ mode: 'write' }), 'write');
  assert.equal(promptSetForCase({}), 'write');
  assert.equal(promptSetForCase(null), 'write');

  // ---------------------------------------------------------------- 두 세트는 서로 다른 모듈이다
  const write = chainPrompts('write');
  const scaffold = chainPrompts('scaffold');
  for (const key of ['chain1', 'chain2', 'chain3', 'chain4', 'chain5', 'review'] as const) {
    assert.notEqual(write[key].user, scaffold[key].user, `${key}: 사용자 프롬프트 빌더가 같은 모듈을 가리키면 안 된다`);
    assert.ok(scaffold[key].system.length > 100);
  }

  // ---------------------------------------------------------------- 레지스트리
  assert.equal(promptKeyForChainName('CHAIN1', 'scaffold'), 'SCAFFOLD_CHAIN1');
  assert.equal(promptKeyForChainName('REVIEW:THERAPEUTIC_INTERVENTIONS', 'scaffold'), 'SCAFFOLD_REVIEW');
  assert.equal(promptKeyForChainName('CHAIN1'), 'CHAIN1');
  // Write 전용 체인은 scaffold 세트에서도 그대로
  assert.equal(promptKeyForChainName('CHAIN6', 'scaffold'), 'CHAIN6');
  assert.equal(promptKeyForChainName('CHAIN7', 'scaffold'), 'CHAIN7');
  assert.equal(promptKeyForChainName('CHAIN3_STUDY_REVEAL:THERAPEUTIC_INTERVENTIONS', 'scaffold'), 'CHAIN3_STUDY_REVEAL');
  assert.equal(promptVersionLabel('SCAFFOLD_CHAIN3'), 'SCAFFOLD-CHAIN3:v4');
  assert.notEqual(promptTemplateHash('SCAFFOLD_CHAIN3'), promptTemplateHash('CHAIN3'));
  // 공개 단계는 Scaffold 의 CHAIN3 본문을 쓴다
  const revealExpected = createHash('sha256')
    .update([promptVersionLabel('CHAIN3_STUDY_REVEAL'), buildScaffoldRevealSystemPrompt('THERAPEUTIC_INTERVENTIONS')].join('\n\n---\n\n'))
    .digest('hex');
  assert.equal(promptTemplateHash('CHAIN3_STUDY_REVEAL'), revealExpected);
  // 공개 단계 해시 고정값 — Scaffold CHAIN3 를 고치면 바뀌므로 버전을 올리고 이 값을 갱신한다.
  // 이력: v2 f59a93a0…(분리 시점, a53e34c) → v3 00406d6d…(Scaffold CHAIN3 개선) → v4 c9c8ca48…(v3.3 규칙, 공개 섹션만 생성)
  assert.equal(promptVersionLabel('CHAIN3_STUDY_REVEAL'), 'CHAIN3_STUDY_REVEAL:v4');
  assert.equal(promptTemplateHash('CHAIN3_STUDY_REVEAL'), 'c9c8ca485eebcabb09e5d973ecf96812b96871ccca92498bebfc01ad27f2c20a');
  // 공개 단계 대표 프롬프트는 치료 개입 하나만 쓰게 한다. CHAIN3 의 7개 섹션이 아니면 전체 프롬프트(이전 동작)
  assert.match(buildScaffoldRevealSystemPrompt('THERAPEUTIC_INTERVENTIONS'), /아래 섹션에 대해서만/);
  assert.equal(buildScaffoldRevealSystemPrompt('DISCUSSION_CONCLUSION'), scaffoldChain3);
  // v4 규칙 11~13
  for (const rule of ['11. 없는 내용:', '12. 표기 보존:', '13. 마무리 문장 금지:', '14. evidenceCardIdsUsed']) {
    assert.ok(scaffoldChain3.includes(rule), rule);
  }

  // ---------------------------------------------------------------- 섹션별 생성 프롬프트 (2026-10-12 평가용)
  // 기본값은 서비스 본문과 같다 (위 공개 단계 해시가 이것을 고정한다)
  assert.equal(buildScaffoldChain3SystemPrompt(), scaffoldChain3);
  assert.equal(buildScaffoldChain3SystemPrompt([...SCAFFOLD_CHAIN3_SECTIONS]), scaffoldChain3);
  const tiOnly = buildScaffoldChain3SystemPrompt(['THERAPEUTIC_INTERVENTIONS']);
  assert.match(tiOnly, /아래 섹션에 대해서만[^\n]*\n\s+THERAPEUTIC_INTERVENTIONS\n/);
  assert.match(tiOnly, /- THERAPEUTIC_INTERVENTIONS: /);
  assert.ok(!/- FOLLOW_UP_OUTCOMES: /.test(tiOnly), '다른 섹션 지침은 빠진다');
  assert.match(tiOnly, /"sectionId": "THERAPEUTIC_INTERVENTIONS"/);
  assert.throws(() => buildScaffoldChain3SystemPrompt([]));
  // 입력도 섹션 범위를 따른다 (기본은 7개 전체)
  const cardsForInputs: any[] = [
    { id: 'a', visitIndex: 1, visitDateTime: '2026-01-01', sourceText: '침 치료', normalizedText: '침 치료', tags: ['THERAPEUTIC_INTERVENTIONS'], sectionHints: [] },
    { id: 'b', visitIndex: 1, visitDateTime: '2026-01-01', sourceText: '두통', normalizedText: '두통', tags: ['CLINICAL_FINDINGS'], sectionHints: [] }
  ];
  const statesForInputs: any[] = [
    { sectionId: 'THERAPEUTIC_INTERVENTIONS', status: 'READY', rationaleText: '' },
    { sectionId: 'CLINICAL_FINDINGS', status: 'READY', rationaleText: '' }
  ];
  const fullInputs = buildChain3Inputs(cardsForInputs, statesForInputs);
  assert.match(fullInputs.evidenceText, /\[CLINICAL_FINDINGS\]/);
  const tiInputs = buildChain3Inputs(cardsForInputs, statesForInputs, { sectionIds: ['THERAPEUTIC_INTERVENTIONS'] });
  assert.ok(!/CLINICAL_FINDINGS/.test(tiInputs.evidenceText) && !/CLINICAL_FINDINGS/.test(tiInputs.statusSummary));
  const tiAllEvidence = buildChain3Inputs(cardsForInputs, statesForInputs, {
    sectionIds: ['THERAPEUTIC_INTERVENTIONS'],
    evidenceSectionIds: [...SCAFFOLD_CHAIN3_SECTIONS]
  });
  assert.match(tiAllEvidence.evidenceText, /\[CLINICAL_FINDINGS\]/);
  assert.ok(!/CLINICAL_FINDINGS/.test(tiAllEvidence.statusSummary));

  // ---------------------------------------------------------------- 캐시 지문과 로그
  const scaffoldEntry = buildChainCacheEntry('h', { a: 1 }, 'CHAIN1', 'scaffold');
  const writeEntry = buildChainCacheEntry('h', { a: 1 }, 'CHAIN1');
  assert.equal(scaffoldEntry.promptFingerprint, promptMeta('SCAFFOLD_CHAIN1').promptFingerprint);
  assert.notEqual(scaffoldEntry.promptFingerprint, writeEntry.promptFingerprint);
  assert.equal(hasChainCacheHit({ mode: 'scaffold', chainCache: { CHAIN1: scaffoldEntry } }, 'CHAIN1', 'h'), true);
  assert.equal(hasChainCacheHit({ mode: 'scaffold', chainCache: { CHAIN1: writeEntry } }, 'CHAIN1', 'h'), false, 'Write 지문은 Scaffold 사례에서 적중하지 않는다');
  assert.equal(hasChainCacheHit({ mode: 'write', chainCache: { CHAIN1: scaffoldEntry } }, 'CHAIN1', 'h'), false);
  // 지문 없는 옛 항목(학생 V1 등)은 계속 적중
  assert.equal(hasChainCacheHit({ mode: 'scaffold', chainCache: { CHAIN1: { inputHash: 'h', updatedAt: '' } } }, 'CHAIN1', 'h'), true);
  const log = buildPerformanceLog({ chainName: 'REVIEW:THERAPEUTIC_INTERVENTIONS', promptSet: 'scaffold', startedAt: new Date().toISOString(), inputHash: 'h', cacheHit: false, llmCallCount: 1 });
  assert.equal(log.promptVersion, 'SCAFFOLD-REVIEW:v2');
  assert.equal(log.promptVersion, promptMetaForChainName('REVIEW:X', 'scaffold')!.promptVersion);

  // ---------------------------------------------------------------- 러너가 세트를 따른다 (호출 라벨로 확인)
  assert.equal(chainLabel('CHAIN3 draft', 'scaffold'), 'CHAIN3 draft [scaffold]');
  const labels: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    const text = args.join(' ');
    if (/\] attempt \d+\/\d+ started/.test(text)) labels.push(text);
  };
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sectionDrafts: [], sectionAssessments: [] }) } }],
          usage: null
        })
      }
    }
  });
  try {
    await runInitialSectionDrafts([], [], { promptSet: 'scaffold' });
    await runInitialSectionDrafts([], []);
    const cards: any[] = [{ id: 'c1', visitIndex: 1, visitDateTime: '', sourceText: '두통 호소', normalizedText: '두통 호소', evidenceType: 'clinical_finding', tags: ['CLINICAL_FINDINGS'], sectionHints: [], terms: [], confidence: 0.9 }];
    await runSectionAssessment(cards, { promptSet: 'scaffold' });
  } finally {
    console.log = originalLog;
    __setOpenAIClientForTests(null);
  }
  assert.ok(labels[0].startsWith('[CHAIN3 draft [scaffold]]'), labels.join('\n'));
  // 섹션별 생성: 시스템 프롬프트·입력이 그 섹션으로 줄고, 다른 섹션 결과는 버린다
  {
    const bodies: any[] = [];
    __setOpenAIClientForTests({
      chat: {
        completions: {
          create: async (body: any) => {
            bodies.push(body);
            return {
              choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sectionDrafts: [
                { sectionId: 'THERAPEUTIC_INTERVENTIONS', evidenceCardIdsUsed: ['t1'], draftText: '침 치료를 시행하였다.', openIssues: [] },
                { sectionId: 'CLINICAL_FINDINGS', evidenceCardIdsUsed: [], draftText: '요청하지 않은 섹션', openIssues: [] }
              ] }) } }],
              usage: null
            };
          }
        }
      }
    });
    const sectionCards: any[] = [
      { id: 't1', visitIndex: 1, visitDateTime: '', sourceText: '침 치료', normalizedText: '침 치료', evidenceType: 'therapeutic_intervention', tags: ['THERAPEUTIC_INTERVENTIONS'], sectionHints: [], terms: [], confidence: 0.9 },
      { id: 'c1', visitIndex: 1, visitDateTime: '', sourceText: '두통', normalizedText: '두통', evidenceType: 'clinical_finding', tags: ['CLINICAL_FINDINGS'], sectionHints: [], terms: [], confidence: 0.9 }
    ];
    try {
      const drafts = await runInitialSectionDrafts(sectionCards, [], { promptSet: 'scaffold', sectionIds: ['THERAPEUTIC_INTERVENTIONS'] });
      assert.deepEqual(drafts.map((draft) => draft.sectionId), ['THERAPEUTIC_INTERVENTIONS']);
      const system = bodies[0].messages[0].content as string;
      const user = bodies[0].messages[1].content as string;
      assert.match(system, /아래 섹션에 대해서만/);
      assert.ok(!user.includes('두통'), '다른 섹션 근거는 보내지 않는다');
      assert.ok(user.includes('침 치료'));
      await assert.rejects(() => runInitialSectionDrafts(sectionCards, [], { sectionIds: ['THERAPEUTIC_INTERVENTIONS'] }), /Scaffold/);
    } finally {
      __setOpenAIClientForTests(null);
    }
  }
  assert.ok(labels[1].startsWith('[CHAIN3 draft]'), labels.join('\n'));
  if (labels[2]) assert.ok(labels[2].startsWith('[CHAIN2 assessment [scaffold]]'), labels.join('\n'));

  console.log('prompt set tests passed');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
