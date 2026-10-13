/**
 * 미리 돌린 분석 (2026-10-13): 스냅샷이 있는 프리셋으로 시작하면 분석 결과가 복사돼 바로 분석 완료로 보이고,
 * 질문은 그대로(1회차 고정 3개, 최대 3회차). S02 가 쓴 프리셋(lim-internal)은 스냅샷이 없어 그 자리에서 분석한다.
 * 실제 DB 이름 뒤에 _study_write_analysis_test 를 붙인 별도 DB 를 쓰고, 끝나면 지운다. LLM 은 부르지 않는다.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();
process.env.LLM_USAGE_LOG_DISABLED = '1';
delete process.env.STUDY_WRITE_PREPARED_ANALYSIS;
delete process.env.STUDY_WRITE_PREPARED_QUESTIONS;

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_study_write_analysis_test';
  const parsed = new URL(configured);
  parsed.pathname = `/${parsed.pathname.replace(/^\//, '') || 'care'}_study_write_analysis_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();
  const [schema, { default: casesRouter }, { default: studyWriteRouter }, presets, preparedAnalysis, interview, mongooseModule] =
    await Promise.all([
      import('../../src/db/schema'),
      import('../../src/routes/cases'),
      import('../../src/routes/studyWrite'),
      import('../../src/studyWrite/presets'),
      import('../../src/studyWrite/preparedAnalysis'),
      import('../../src/studyWrite/interview'),
      import('mongoose')
    ]);
  const mongoose = mongooseModule.default;
  const presetId = 'jin-ophthalmology-ent-derm';
  const snapshot = preparedAnalysis.loadPreparedAnalysis(presetId);
  if (!snapshot || !presets.getStudyWritePreset(presetId)) {
    console.log(`preparedAnalysis: skipped (${presetId} snapshot not on this machine)`);
    return;
  }

  await schema.initDatabase();
  assert.match(mongoose.connection.db!.databaseName, /_study_write_analysis_test$/);
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
  const startWith = async (id: string, code: string) => {
    const preset = presets.getStudyWritePreset(id)!;
    const visits = preset.visits.map((visit, index) => ({ type: index === 0 ? '초진' : '재진', date: visit.date, soapText: visit.soapText }));
    const created = await post('/cases', {
      mode: 'write',
      visits,
      experimentCode: code,
      metadata: { sessionId: `session_${code}`, participantCode: code, experimentCode: code }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const started = await post(`/study-write/cases/${created.body.caseId}/interview/start`, {
      inputSource: { source: 'preset', presetId: id, visitCount: preset.visitCount, relativeDates: preset.relativeDates }
    });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    return { caseId: created.body.caseId as string, body: started.body };
  };

  try {
    // 1. 스냅샷이 있는 프리셋: 분석이 바로 끝난 것으로 보이고, 질문은 S01 조건 그대로
    const prepared = await startWith(presetId, 'ZZ-ANALYSIS-1');
    assert.equal(prepared.body.analysis.ready, true);
    assert.deepEqual(prepared.body.interview.rounds[0].questions.map((q: any) => q.text), interview.FIXED_CASE_QUESTIONS.map((q) => q.text));
    assert.deepEqual(prepared.body.interview.questionBudget, interview.DEFAULT_QUESTION_BUDGET);
    assert.equal(prepared.body.interview.rounds[0].generation, undefined);
    assert.equal(prepared.body.interview.analysisSource.sourceCaseId, snapshot.sourceCaseId);

    const doc: any = await schema.StudyWriteCaseModel.findOne({ id: prepared.caseId }).lean().exec();
    for (const field of preparedAnalysis.ANALYSIS_FIELDS) {
      if ((snapshot.fields as any)[field] !== undefined) assert.deepEqual(doc[field], (snapshot.fields as any)[field], field);
    }
    const processed = doc.researchState.interactionEvents.filter((event: any) => event.eventType === 'case_processed');
    assert.equal(processed.length, 1);
    assert.equal(processed[0].metadata.prepared, true);
    assert.equal(doc.experiment_code, 'ZZ-ANALYSIS-1', '참여자 기록 필드는 그대로');
    assert.equal(doc.chainPerformanceLogs.length, 0, '준비용 사례의 수행 시간은 옮기지 않음');

    // 다시 시작해도 다시 복사하지 않음
    const again = await post(`/study-write/cases/${prepared.caseId}/interview/start`, {});
    assert.equal(again.body.interview.analysisSource.copiedAt, prepared.body.interview.analysisSource.copiedAt);

    // 2. S02 가 쓴 프리셋: 스냅샷 없음 → 그 자리에서 분석 (분석 전 상태로 시작)
    if (presets.getStudyWritePreset('lim-internal')) {
      assert.equal(preparedAnalysis.loadPreparedAnalysis('lim-internal'), null);
      const live = await startWith('lim-internal', 'ZZ-ANALYSIS-2');
      assert.equal(live.body.analysis.ready, false);
      assert.equal(live.body.interview.analysisSource, undefined);
    }

    // 3. 기록을 바꾸면 쓰지 않음
    assert.equal(preparedAnalysis.preparedAnalysisForCase({ visits: [{ type: '초진', soapText: '다른 기록' }] }, presetId), null);
    // 4. 끄면 쓰지 않음
    process.env.STUDY_WRITE_PREPARED_ANALYSIS = '0';
    assert.equal(preparedAnalysis.preparedAnalysisForCase(doc, presetId), null);
    delete process.env.STUDY_WRITE_PREPARED_ANALYSIS;

    console.log('preparedAnalysis: copied on start, questions unchanged, S02 preset still live');
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
