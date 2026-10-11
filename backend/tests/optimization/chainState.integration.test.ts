/**
 * caseModel.recordChainRun 이 동시에 들어온 쓰기를 지우지 않는지 실제 MongoDB 에서 확인한다.
 * 연구 데이터와 다른 테스트 전용 DB(<원래 DB>_scaffold_integration_test)를 쓰고, 만든 문서는 지운다.
 */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

dotenv.config();

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_scaffold_integration_test';
  const parsed = new URL(configured);
  const sourceDbName = parsed.pathname.replace(/^\//, '') || 'care';
  parsed.pathname = `/${sourceDbName}_scaffold_integration_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();
  const [{ CaseModel: CaseMongoModel, initDatabase }, { CaseModel }, { buildChainCacheEntry, buildPerformanceLog }, mongooseModule] =
    await Promise.all([
      import('../../src/db/schema'),
      import('../../src/models/caseModel'),
      import('../../src/optimization/chainRuntime'),
      import('mongoose')
    ]);
  const mongoose = mongooseModule.default;
  await initDatabase();
  const model = new CaseModel();
  const id = `case_chainstate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nullId = `${id}_null`;

  try {
    await CaseMongoModel.create({
      id,
      experiment_code: `CSIT_${id.slice(-10)}`,
      mode: 'write',
      title: 'chain state integration',
      visits: [],
      chainCache: { CHAIN1: buildChainCacheEntry('h1', { a: 1 }, 'CHAIN1') },
      chainPerformanceLogs: []
    });

    const log = (name: string) =>
      buildPerformanceLog({ chainName: name, startedAt: new Date().toISOString(), inputHash: name, cacheHit: false, llmCallCount: 1 });

    // 서로 다른 키를 동시에 쓴다: 이전 방식(읽고 통째로 덮기)이면 마지막 것만 남는다.
    await Promise.all([
      model.recordChainRun(id, {
        cacheEntries: { 'REVIEW:THERAPEUTIC_INTERVENTIONS': buildChainCacheEntry('r1', {}, 'REVIEW:THERAPEUTIC_INTERVENTIONS') },
        sectionAdequacyReviews: { THERAPEUTIC_INTERVENTIONS: { summary: 'TI' } },
        performanceLogs: [log('REVIEW:THERAPEUTIC_INTERVENTIONS')]
      }),
      model.recordChainRun(id, {
        cacheEntries: { 'REVIEW:FOLLOW_UP_OUTCOMES': buildChainCacheEntry('r2', {}, 'REVIEW:FOLLOW_UP_OUTCOMES') },
        sectionAdequacyReviews: { FOLLOW_UP_OUTCOMES: { summary: 'FU' } },
        performanceLogs: [log('REVIEW:FOLLOW_UP_OUTCOMES')]
      }),
      model.recordChainRun(id, { cacheEntries: { CHAIN7: buildChainCacheEntry('c7', {}, 'CHAIN7') }, performanceLogs: [log('CHAIN7')] })
    ]);

    let doc: any = await CaseMongoModel.findOne({ id }).lean().exec();
    assert.deepEqual(
      Object.keys(doc.chainCache).sort(),
      ['CHAIN1', 'CHAIN7', 'REVIEW:FOLLOW_UP_OUTCOMES', 'REVIEW:THERAPEUTIC_INTERVENTIONS']
    );
    assert.equal(doc.chainCache.CHAIN1.inputHash, 'h1', '기존 항목이 남는다');
    assert.deepEqual(Object.keys(doc.sectionAdequacyReviews).sort(), ['FOLLOW_UP_OUTCOMES', 'THERAPEUTIC_INTERVENTIONS']);
    assert.equal(doc.chainPerformanceLogs.length, 3);

    // null 은 키 삭제
    await model.recordChainRun(id, { cacheEntries: { CHAIN7: null } });
    doc = await CaseMongoModel.findOne({ id }).lean().exec();
    assert.equal(doc.chainCache.CHAIN7, undefined);

    // 로그는 200개까지만
    await model.recordChainRun(id, { performanceLogs: Array.from({ length: 205 }, (_, i) => log(`L${i}`)) });
    doc = await CaseMongoModel.findOne({ id }).lean().exec();
    assert.equal(doc.chainPerformanceLogs.length, 200);
    assert.equal(doc.chainPerformanceLogs[199].chainName, 'L204');

    // 잘못된 키는 거부
    await assert.rejects(() => model.recordChainRun(id, { cacheEntries: { 'a.b': null } }));

    // 옛 문서처럼 필드가 null 이어도 실패하지 않는다(읽어서 합치는 대체 경로)
    await CaseMongoModel.collection.insertOne({ id: nullId, experiment_code: `CSIT_${nullId.slice(-10)}`, chainCache: null, chainPerformanceLogs: null } as any);
    await model.recordChainRun(nullId, { cacheEntries: { CHAIN4: buildChainCacheEntry('c4', {}, 'CHAIN4') }, performanceLogs: [log('CHAIN4')] });
    const nullDoc: any = await CaseMongoModel.findOne({ id: nullId }).lean().exec();
    assert.equal(nullDoc.chainCache.CHAIN4.inputHash, 'c4');
    assert.equal(nullDoc.chainPerformanceLogs.length, 1);

    console.log('chain state integration tests passed');
  } finally {
    await CaseMongoModel.deleteMany({ id: { $in: [id, nullId] } }).exec();
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
