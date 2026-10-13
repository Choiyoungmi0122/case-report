/**
 * 실험용 Write 사례가 학생 Scaffold 기록과 다른 컬렉션(study_write_cases)에 저장되는지,
 * 그래서 같은 참가자 코드(S2)를 두 실험이 따로 쓸 수 있는지 확인한다.
 * 실제 DB 이름 뒤에 _study_write_storage_test 를 붙인 별도 DB 를 쓰고, 끝나면 지운다.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();
process.env.LLM_USAGE_LOG_DISABLED = '1';

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_study_write_storage_test';
  const parsed = new URL(configured);
  const sourceDbName = parsed.pathname.replace(/^\//, '') || 'care';
  parsed.pathname = `/${sourceDbName}_study_write_storage_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();

  const [{ CaseModel, StudyWriteCaseModel, initDatabase }, { default: casesRouter }, { caseModel }, mongooseModule] =
    await Promise.all([
      import('../../src/db/schema'),
      import('../../src/routes/cases'),
      import('../../src/models/caseModel').then((m) => ({ caseModel: new m.CaseModel() })),
      import('mongoose')
    ]);
  const mongoose = mongooseModule.default;
  await initDatabase();
  assert.match(mongoose.connection.db!.databaseName, /_study_write_storage_test$/);

  const app = express();
  app.use(express.json());
  app.use('/api/cases', casesRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cases`;

  const post = async (body: unknown) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const visits = [{ type: 'initial', date: '2026-01-01', soapText: 'S) 테스트 기록' }];

  try {
    // 학생 Scaffold V1 에서 이미 쓴 코드
    await CaseModel.create({ id: 'case_student_s2', experiment_code: 'S2', mode: 'scaffold', visits });

    // 실험용 Write 에서 같은 코드로 시작: 막히지 않고 전용 컬렉션에 들어가야 한다.
    const created = await post({
      mode: 'write',
      visits,
      experimentCode: 'S2',
      metadata: { sessionId: 'session_test', participantCode: 'S2', experimentCode: 'S2' }
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const studyCaseId = created.body.caseId as string;
    assert.ok(await StudyWriteCaseModel.exists({ id: studyCaseId }), 'study_write_cases 에 저장');
    assert.equal(await CaseModel.exists({ id: studyCaseId }), null, 'cases 에는 없음');
    assert.ok(await CaseModel.exists({ id: 'case_student_s2' }), '학생 기록은 그대로');

    // 실험용 Write 에서 같은 코드를 또 쓰면 409, 이어서 할 사례는 실험용 Write 사례여야 한다.
    const duplicate = await post({
      mode: 'write',
      visits,
      experimentCode: 'S2',
      metadata: { sessionId: 'session_test_2', participantCode: 'S2', experimentCode: 'S2' }
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.existingCaseId, studyCaseId);
    assert.equal(duplicate.body.resumeStage, 'interview');

    // 읽기·쓰기·체인 기록이 전용 컬렉션 문서에 반영된다.
    await caseModel.updateCase(studyCaseId, { studyWrite: { startedAt: 'now' } } as any);
    await caseModel.recordChainRun(studyCaseId, { cacheEntries: { k: { hash: 'h' } as any } });
    const loaded: any = await caseModel.getCase(studyCaseId);
    assert.equal(loaded.experiment_code, 'S2');
    assert.equal(loaded.studyWrite.startedAt, 'now');
    assert.equal(loaded.chainCache.k.hash, 'h');
    await assert.rejects(caseModel.updateCase(studyCaseId, { mode: 'scaffold' } as any));

    // 목록에는 두 컬렉션이 다 나오고, 연구 세션 없는 일반 Write 는 cases 에 남는다.
    const plain = await post({ mode: 'write', visits });
    assert.equal(plain.status, 200);
    assert.ok(await CaseModel.exists({ id: plain.body.caseId }));
    const ids = (await caseModel.getAllCases()).map((item) => item.id);
    assert.ok(ids.includes(studyCaseId) && ids.includes('case_student_s2') && ids.includes(plain.body.caseId));
    assert.ok(!(await caseModel.getAllCases('scaffold')).some((item) => item.id === studyCaseId));

    await caseModel.deleteCase(studyCaseId);
    assert.equal(await caseModel.getCase(studyCaseId), null);

    console.log('caseStorage.integration: all assertions passed');
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
