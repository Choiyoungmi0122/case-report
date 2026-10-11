import assert from 'node:assert/strict';
import {
  PROMPT_VERSIONS,
  promptFingerprint,
  promptKeyForChainName,
  promptMetaForChainName,
  promptTemplateHash,
  promptVersionLabel
} from '../../src/llm/promptRegistry';
import { buildChainCacheEntry, buildPerformanceLog, hasChainCacheHit } from '../../src/optimization/chainRuntime';
import { normalizeCareItemCode } from '../../src/studyWrite/drafting';
import { sectionsForCareItem } from '../../src/studyWrite/interview';
import { chain3SystemPrompt } from '../../src/llm/prompts/chain3_draft';
import { createHash } from 'node:crypto';

function run() {
  // 버전 라벨과 템플릿 해시
  assert.equal(promptVersionLabel('CHAIN3'), `CHAIN3:${PROMPT_VERSIONS.CHAIN3}`);
  assert.equal(promptVersionLabel('SW_D'), `SW-D:${PROMPT_VERSIONS.SW_D}`);
  const expectedChain3 = createHash('sha256')
    .update([`CHAIN3:${PROMPT_VERSIONS.CHAIN3}`, chain3SystemPrompt].join('\n\n---\n\n'))
    .digest('hex');
  assert.equal(promptTemplateHash('CHAIN3'), expectedChain3);
  // 공개 단계는 chain3 프롬프트를 쓰지만 라벨이 달라 해시도 다르다 (라벨 포함 해시).
  assert.notEqual(promptTemplateHash('CHAIN3_STUDY_REVEAL'), promptTemplateHash('CHAIN3'));
  // 고정 초안(2026-10-04, chain3 v1)의 템플릿 해시와 지금 프롬프트는 다르다 — 재생성하면 다른 초안이 된다.
  assert.notEqual(promptTemplateHash('CHAIN3'), 'e4e8702303adcfa17f9b27bd62418b144ec68d119269d22ff1f988b7748a9aa2');

  // chainName → 프롬프트 키
  assert.equal(promptKeyForChainName('CHAIN1'), 'CHAIN1');
  assert.equal(promptKeyForChainName('REVIEW:THERAPEUTIC_INTERVENTIONS'), 'REVIEW');
  assert.equal(promptKeyForChainName('CHAIN3_STUDY_REVEAL:THERAPEUTIC_INTERVENTIONS'), 'CHAIN3_STUDY_REVEAL');
  assert.equal(promptKeyForChainName('PREPROCESS'), undefined);

  // 캐시 항목: chainName 을 주면 지문이 붙고, 지문이 다르면 적중하지 않는다. 옛 항목(지문 없음)은 입력 해시만으로 적중.
  const stamped = buildChainCacheEntry('hash-1', { a: 1 }, 'CHAIN1');
  assert.equal(stamped.promptFingerprint, promptFingerprint('CHAIN1'));
  assert.equal(hasChainCacheHit({ chainCache: { CHAIN1: stamped } }, 'CHAIN1', 'hash-1'), true);
  assert.equal(hasChainCacheHit({ chainCache: { CHAIN1: stamped } }, 'CHAIN1', 'hash-2'), false);
  assert.equal(
    hasChainCacheHit({ chainCache: { CHAIN1: { ...stamped, promptFingerprint: 'CHAIN1:v0|deadbeef|gpt-x' } } }, 'CHAIN1', 'hash-1'),
    false
  );
  const legacy = buildChainCacheEntry('hash-1', { a: 1 });
  assert.equal(legacy.promptFingerprint, undefined);
  assert.equal(hasChainCacheHit({ chainCache: { CHAIN1: legacy } }, 'CHAIN1', 'hash-1'), true);
  // 프롬프트 키가 없는 체인 이름은 지문 없이 입력 해시만 비교
  assert.equal(hasChainCacheHit({ chainCache: { PREPROCESS: { inputHash: 'x', updatedAt: '' } } }, 'PREPROCESS', 'x'), true);

  // 성능 로그에 프롬프트 버전·템플릿 해시·모델이 남는다
  const log = buildPerformanceLog({ chainName: 'REVIEW:THERAPEUTIC_INTERVENTIONS', startedAt: new Date().toISOString(), inputHash: 'h', cacheHit: false, llmCallCount: 1 });
  const meta = promptMetaForChainName('REVIEW:THERAPEUTIC_INTERVENTIONS');
  assert.ok(meta);
  assert.equal(log.promptVersion, meta!.promptVersion);
  assert.equal(log.promptTemplateHash, meta!.promptTemplateHash);
  assert.equal(typeof log.model, 'string');

  // SW-C 코드 정규화: 표기가 달라도 같은 항목으로 맞춘다
  for (const raw of ['9a', '9a.', 'CARE 9a', '9-a', ' 9 a ', '9A']) assert.equal(normalizeCareItemCode(raw), '9a', raw);
  assert.equal(normalizeCareItemCode('10'), '10');
  assert.equal(normalizeCareItemCode('없음'), '');

  // SW-Q2: careItem 코드로 섹션을 찾는 대체 경로
  assert.deepEqual(sectionsForCareItem('9b'), ['THERAPEUTIC_INTERVENTIONS']);
  assert.ok(sectionsForCareItem('8a·8c').includes('DIAGNOSTIC_ASSESSMENT'));
  assert.deepEqual(sectionsForCareItem('없음'), []);

  console.log('prompt registry tests passed');
}

run();
