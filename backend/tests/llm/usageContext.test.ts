/**
 * LLM 사용량 기록의 사례 id(2026-10-12) 검증. 실제 기록 파일에는 쓰지 않는다(buildUsageLogEntry 만 확인).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import {
  getUsageContext,
  runWithUsageContext,
  setUsageCaseId,
  usageContextFromPath,
  usageContextMiddleware
} from '../../src/llm/usageContext';
import { buildUsageLogEntry } from '../../src/llm/usageLog';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  // ---------------------------------------------------------------- 경로 해석
  assert.deepEqual(usageContextFromPath('/api/cases/case_123/process'), { caseId: 'case_123' });
  assert.deepEqual(usageContextFromPath('/api/cases/case_123/sections/THERAPEUTIC_INTERVENTIONS?x=1'), { caseId: 'case_123' });
  assert.deepEqual(usageContextFromPath('/api/cases/study_abc_scaffold_S1/scaffold'), { caseId: 'study_abc_scaffold_S1' });
  assert.deepEqual(usageContextFromPath('/api/cases/study/start'), {});
  assert.deepEqual(usageContextFromPath('/api/cases'), {});
  assert.deepEqual(usageContextFromPath('/api/study-write/cases/case_9/drafts/generate'), { caseId: 'case_9' });
  assert.deepEqual(usageContextFromPath('/api/study-write/presets'), {});
  assert.deepEqual(usageContextFromPath('/api/manuscript-review/rev_1/run-review'), { manuscriptReviewId: 'rev_1' });
  assert.deepEqual(usageContextFromPath('/api/manuscript-review/import'), {});
  assert.deepEqual(usageContextFromPath('/health'), {});
  assert.deepEqual(usageContextFromPath('/api/cases/case%20x/process'), { caseId: 'case x' });

  // ---------------------------------------------------------------- 문맥 밖에서는 사례 id 가 없다
  assert.equal(getUsageContext(), undefined);
  assert.equal(buildUsageLogEntry({ kind: 'chat' }).caseId, undefined);
  setUsageCaseId('ignored'); // 문맥 밖이면 아무것도 하지 않는다
  assert.equal(getUsageContext(), undefined);

  // ---------------------------------------------------------------- setUsageCaseId: 비어 있을 때만 채운다
  runWithUsageContext({}, () => {
    setUsageCaseId('case_a');
    setUsageCaseId('case_b');
    assert.equal(getUsageContext()?.caseId, 'case_a');
  });
  runWithUsageContext({ caseId: 'case_path' }, () => {
    setUsageCaseId('case_other');
    assert.equal(getUsageContext()?.caseId, 'case_path');
  });

  // ---------------------------------------------------------------- Express: 요청마다 분리, 응답 뒤 작업에도 이어짐
  const background: Array<Promise<Record<string, unknown>>> = [];
  const app = express();
  app.use('/api', usageContextMiddleware);
  app.post('/api/cases/:id/process', (_req, res) => {
    // 응답을 먼저 보내고 뒤에서 계속 도는 작업 (실제 처리 경로와 같은 모양)
    background.push(
      (async () => {
        await wait(30);
        return buildUsageLogEntry({ kind: 'chat', label: 'CHAIN1 extraction' });
      })()
    );
    res.json({ started: true });
  });
  app.post('/api/cases/study/start', async (_req, res) => {
    // 경로에 사례 id 가 없는 곳은 처리 함수가 setUsageCaseId 로 채운다
    setUsageCaseId('created_case');
    await wait(5);
    res.json(buildUsageLogEntry({ kind: 'chat' }));
  });
  app.get('/api/study-write/cases/:caseId/drafts', async (_req, res) => {
    await wait(10);
    res.json(buildUsageLogEntry({ kind: 'chat' }));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // 서로 다른 사례 요청을 동시에
    await Promise.all([
      fetch(`${base}/api/cases/case_one/process`, { method: 'POST' }),
      fetch(`${base}/api/cases/case_two/process`, { method: 'POST' })
    ]);
    const entries = await Promise.all(background);
    assert.deepEqual(entries.map((entry) => entry.caseId).sort(), ['case_one', 'case_two']);
    assert.ok(entries.every((entry) => typeof entry.ts === 'string' && entry.label === 'CHAIN1 extraction'));

    const created = await (await fetch(`${base}/api/cases/study/start`, { method: 'POST' })).json();
    assert.equal(created.caseId, 'created_case');

    const sw = await (await fetch(`${base}/api/study-write/cases/case_sw/drafts`)).json();
    assert.equal(sw.caseId, 'case_sw');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  console.log('usage context tests passed');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
