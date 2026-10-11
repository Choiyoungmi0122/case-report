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
import { chain3SystemPrompt as scaffoldChain3 } from '../../src/llm/prompts/scaffold/chain3_draft';
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
  assert.equal(promptVersionLabel('SCAFFOLD_CHAIN3'), 'SCAFFOLD-CHAIN3:v2');
  assert.notEqual(promptTemplateHash('SCAFFOLD_CHAIN3'), promptTemplateHash('CHAIN3'));
  // 공개 단계는 Scaffold 의 CHAIN3 본문을 쓴다
  const revealExpected = createHash('sha256')
    .update([promptVersionLabel('CHAIN3_STUDY_REVEAL'), scaffoldChain3].join('\n\n---\n\n'))
    .digest('hex');
  assert.equal(promptTemplateHash('CHAIN3_STUDY_REVEAL'), revealExpected);
  // 분리 전(2026-10-12, a53e34c) 공개 단계 해시가 그대로다 — Scaffold CHAIN3 를 고치면 이 값이 바뀌므로 버전을 올리고 갱신한다
  assert.equal(promptTemplateHash('CHAIN3_STUDY_REVEAL'), 'f59a93a063739cc47acd6e18297891540a0245053409b20eff82f3a5db4549cf');

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
