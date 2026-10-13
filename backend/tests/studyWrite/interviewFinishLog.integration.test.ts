/**
 * 질의응답 종료 기록 (2026-10-13): "질문은 여기까지" 버튼으로 끝내면 studyWrite.interviewFinish 와
 * 연구 이벤트 interview_finished 가 남는다. 두 번 끝내도 기록은 하나다. LLM 은 부르지 않는다.
 * 실제 DB 이름 뒤에 _study_write_finish_test 를 붙인 별도 DB 를 쓰고, 끝나면 지운다.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();
process.env.LLM_USAGE_LOG_DISABLED = '1';

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_study_write_finish_test';
  const parsed = new URL(configured);
  parsed.pathname = `/${parsed.pathname.replace(/^\//, '') || 'care'}_study_write_finish_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();
  const [{ initDatabase }, { default: casesRouter }, { default: studyWriteRouter }, { CaseModel }, mongooseModule] = await Promise.all([
    import('../../src/db/schema'),
    import('../../src/routes/cases'),
    import('../../src/routes/studyWrite'),
    import('../../src/models/caseModel'),
    import('mongoose')
  ]);
  const mongoose = mongooseModule.default;
  await initDatabase();
  assert.match(mongoose.connection.db!.databaseName, /_study_write_finish_test$/);

  const app = express();
  app.use(express.json());
  app.use('/api/cases', casesRouter);
  app.use('/api/study-write', studyWriteRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = async (url: string, body: unknown = {}) => {
    const response = await fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as any };
  };

  try {
    const created = await post('/cases', {
      mode: 'write',
      visits: [{ type: '초진', date: '2026-01-01T09:00', soapText: 'S) 두통' }],
      experimentCode: 'ZZ-FINISH-TEST',
      metadata: { sessionId: 'session_finish_test', participantCode: 'ZZ-FINISH-TEST', experimentCode: 'ZZ-FINISH-TEST' }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const caseId = created.body.caseId as string;
    const started = await post(`/study-write/cases/${caseId}/interview/start`, { inputSource: { source: 'manual', visitCount: 1 } });
    for (const question of started.body.interview.rounds[0].questions) {
      const answered = await post(`/study-write/cases/${caseId}/interview/answer`, { questionId: question.id, answer: '답' });
      assert.equal(answered.status, 200);
    }

    // 분석 전(기다리는 중)에 버튼으로 끝냄
    const finished = await post(`/study-write/cases/${caseId}/interview/finish`, { reason: 'participant_button' });
    assert.equal(finished.status, 200, JSON.stringify(finished.body));
    assert.ok(finished.body.interview.interviewCompletedAt);

    const caseModel = new CaseModel();
    const saved: any = await caseModel.getCase(caseId);
    const record = saved.studyWrite.interviewFinish;
    assert.equal(record.reason, 'participant_button');
    assert.equal(record.roundCount, 1);
    assert.equal(record.answeredCount, 3);
    assert.equal(record.questionCount, 3);
    assert.equal(record.analysisReady, false);
    assert.ok(typeof record.secondsSinceLastAnswer === 'number' && record.secondsSinceLastAnswer >= 0);
    const events = saved.researchState.interactionEvents.filter((event: any) => event.eventType === 'interview_finished');
    assert.equal(events.length, 1);
    assert.equal(events[0].metadata.reason, 'participant_button');
    assert.equal(events[0].participantCode, 'ZZ-FINISH-TEST');

    // 다시 끝내도 기록은 그대로 하나
    await post(`/study-write/cases/${caseId}/interview/finish`, { reason: 'budget_reached' });
    const again: any = await caseModel.getCase(caseId);
    assert.equal(again.studyWrite.interviewFinish.reason, 'participant_button');
    assert.equal(again.researchState.interactionEvents.filter((event: any) => event.eventType === 'interview_finished').length, 1);

    // 이유 없이 오면 unspecified, 모르는 값도 unspecified
    const other = await post('/cases', { mode: 'write', visits: [{ type: '초진', date: '2026-01-01T09:00', soapText: 'S) 두통' }] });
    await post(`/study-write/cases/${other.body.caseId}/interview/start`, {});
    await post(`/study-write/cases/${other.body.caseId}/interview/finish`, { reason: 'hack' });
    const otherSaved: any = await caseModel.getCase(other.body.caseId);
    assert.equal(otherSaved.studyWrite.interviewFinish.reason, 'unspecified');
    assert.equal(otherSaved.studyWrite.interviewFinish.answeredCount, 0);

    console.log('interviewFinishLog: finish record and research event saved once');
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
