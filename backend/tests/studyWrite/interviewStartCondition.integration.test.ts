/**
 * 실험 조건 고정 확인 (2026-10-13): 미리 만든 질문 파일이 있는 프리셋으로 시작해도,
 * STUDY_WRITE_PREPARED_QUESTIONS 가 꺼져 있으면 S01·S02 와 같은 1회차(고정 질문 3개, 최대 3회차)로 시작한다.
 * 실제 DB 이름 뒤에 _study_write_start_test 를 붙인 별도 DB 를 쓰고, 끝나면 지운다. LLM 은 부르지 않는다.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();
process.env.LLM_USAGE_LOG_DISABLED = '1';
delete process.env.STUDY_WRITE_PREPARED_QUESTIONS;

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_study_write_start_test';
  const parsed = new URL(configured);
  parsed.pathname = `/${parsed.pathname.replace(/^\//, '') || 'care'}_study_write_start_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();
  const [{ initDatabase }, { default: casesRouter }, { default: studyWriteRouter }, { getStudyWritePreset }, { loadPreparedQuestions }, { FIXED_CASE_QUESTIONS, DEFAULT_QUESTION_BUDGET }, mongooseModule] =
    await Promise.all([
      import('../../src/db/schema'),
      import('../../src/routes/cases'),
      import('../../src/routes/studyWrite'),
      import('../../src/studyWrite/presets'),
      import('../../src/studyWrite/preparedQuestions'),
      import('../../src/studyWrite/interview'),
      import('mongoose')
    ]);
  const mongoose = mongooseModule.default;

  const presetId = 'lim-internal';
  const preset = getStudyWritePreset(presetId);
  if (!preset || !loadPreparedQuestions(presetId)) {
    console.log(`interviewStartCondition: skipped (${presetId} preset or prepared file not on this machine)`);
    return;
  }

  await initDatabase();
  assert.match(mongoose.connection.db!.databaseName, /_study_write_start_test$/);
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/cases', casesRouter);
  app.use('/api/study-write', studyWriteRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = async (url: string, body: unknown) => {
    const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as any };
  };

  try {
    const visits = preset.visits.map((visit, index) => ({ type: index === 0 ? '초진' : '재진', date: visit.date, soapText: visit.soapText }));
    const created = await post('/cases', {
      mode: 'write',
      visits,
      experimentCode: 'ZZ-START-TEST',
      metadata: { sessionId: 'session_start_test', participantCode: 'ZZ-START-TEST', experimentCode: 'ZZ-START-TEST' }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const started = await post(`/study-write/cases/${created.body.caseId}/interview/start`, {
      inputSource: { source: 'preset', presetId, visitCount: preset.visitCount, relativeDates: preset.relativeDates }
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const interview = started.body.interview;
    assert.equal(interview.rounds.length, 1);
    assert.deepEqual(interview.rounds[0].questions.map((q: any) => q.text), FIXED_CASE_QUESTIONS.map((q) => q.text));
    assert.equal(interview.rounds[0].generation, undefined, '미리 만든 질문을 쓰지 않음');
    assert.deepEqual(interview.questionBudget, DEFAULT_QUESTION_BUDGET);
    console.log('interviewStartCondition: S01 condition kept (fixed 3, max 3 rounds, no prepared questions)');
  } finally {
    server.close();
    await mongoose.connection.db!.dropDatabase();
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
