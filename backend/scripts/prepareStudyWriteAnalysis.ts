/**
 * 실험용 Write 프리셋 EMR 의 기록 분석을 실험 전에 미리 돌려 둔다 (2026-10-13).
 *
 *   npm run study-write:prepare-analysis -- <presetId>                         새로 분석
 *   npm run study-write:prepare-analysis -- <presetId> --reuse-case <caseId>   이미 분석한 준비용 사례에서 뜨기
 *
 * 결과: backend/data/study-write-analysis/<presetId>.json. 참여자가 이 프리셋으로 질의응답을 시작하면 분석 결과를 복사해
 * 분석을 기다리지 않게 한다. 질문은 그대로 실시간이다 (studyWrite/preparedAnalysis.ts).
 * S01(virtual-68f-neuropsychiatry)·S02(lim-internal)가 쓴 프리셋은 만들지 않는다.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EXCLUDED_PRESETS = ['virtual-68f-neuropsychiatry', 'lim-internal'];

async function main() {
  const presetId = process.argv[2];
  const reuseIndex = process.argv.indexOf('--reuse-case');
  const reuseCaseId = reuseIndex >= 0 ? process.argv[reuseIndex + 1] : '';
  const [{ initDatabase, CaseModel: CaseMongoModel }, { getStudyWritePreset, listStudyWritePresets }] = await Promise.all([
    import('../src/db/schema'),
    import('../src/studyWrite/presets')
  ]);
  if (!presetId) {
    console.log('사용법: npm run study-write:prepare-analysis -- <presetId> [--reuse-case <caseId>]\n\n프리셋:');
    for (const preset of listStudyWritePresets()) {
      console.log(`  ${preset.id}  (${preset.label})${EXCLUDED_PRESETS.includes(preset.id) ? '  ← S01·S02 가 쓴 프리셋, 만들지 않음' : ''}`);
    }
    return;
  }
  if (EXCLUDED_PRESETS.includes(presetId)) throw new Error(`${presetId} 는 S01·S02 가 실시간 분석으로 쓴 프리셋이라 미리 분석하지 않습니다.`);
  const preset = getStudyWritePreset(presetId);
  if (!preset) throw new Error(`프리셋을 찾지 못했습니다: ${presetId}`);

  const { buildPreparedAnalysis, savePreparedAnalysis } = await import('../src/studyWrite/preparedAnalysis');
  const { isAnalysisReady } = await import('../src/studyWrite/interview');
  const { visitsFingerprint } = await import('../src/studyWrite/preparedQuestions');
  const { CaseModel } = await import('../src/models/caseModel');
  const mongoose = (await import('mongoose')).default;
  await initDatabase();

  // 입력 화면(CaseInputPage normalizeVisits)과 같은 모양. 그래야 지문이 참여자 사례와 같다.
  const visits = preset.visits.map((visit, index) => ({
    type: index === 0 ? '초진' : '재진',
    date: visit.date,
    soapText: visit.soapText.replace(/\\n/g, '\n')
  }));

  let server: any = null;
  try {
    let caseId = reuseCaseId;
    if (!caseId) {
      const [{ default: express }, { default: casesRouter }, { default: studyWriteRouter }, { usageContextMiddleware }] =
        await Promise.all([
          import('express'),
          import('../src/routes/cases'),
          import('../src/routes/studyWrite'),
          import('../src/llm/usageContext')
        ]);
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      app.use('/api', usageContextMiddleware);
      app.use('/api/cases', casesRouter);
      app.use('/api/study-write', studyWriteRouter);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', () => resolve()));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      const call = async (method: string, url: string, body?: unknown) => {
        const response = await fetch(`${base}${url}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const json: any = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${method} ${url} → ${response.status}: ${json?.error || JSON.stringify(json)}`);
        return json;
      };
      const created = await call('POST', '/cases', { mode: 'write', title: `[사전 준비] ${preset.label}`, visits });
      caseId = created.caseId;
      console.log(`준비용 사례 ${caseId} (${created.experimentCode || '-'})`);
      await call('POST', `/study-write/cases/${caseId}/interview/start`, {
        inputSource: { source: 'preset', presetId: preset.id, visitCount: preset.visitCount, relativeDates: preset.relativeDates },
        processingRequested: true
      });
      console.log('기록 분석 중… (몇 분 걸립니다)');
      const processed = await call('POST', `/cases/${caseId}/process`);
      if (processed?.blocked) throw new Error('분석이 비식별 확인에서 멈췄습니다. 화면에서 확인한 뒤 --reuse-case 로 다시 돌려 주세요.');
    }

    const caseData: any = await new CaseModel().getCase(caseId);
    if (!caseData) throw new Error(`사례를 찾지 못했습니다: ${caseId}`);
    if (!isAnalysisReady(caseData)) throw new Error(`${caseId} 의 분석이 끝나지 않았습니다.`);
    const expected = visitsFingerprint(visits);
    if (visitsFingerprint(caseData.visits) !== expected) throw new Error(`${caseId} 의 방문 기록이 프리셋 ${presetId} 와 다릅니다.`);

    // 정규화 전 원본 그대로 뜬다 (getCase 는 상태 값을 바꿔 돌려준다).
    const raw: any = await CaseMongoModel.findOne({ id: caseId }).lean().exec();
    const snapshot = buildPreparedAnalysis(presetId, raw);
    const file = savePreparedAnalysis(snapshot);
    const fields = snapshot.fields as any;
    console.log(`\n저장: ${file}`);
    console.log(`출처 사례 ${snapshot.sourceCaseId} (${snapshot.sourceExperimentCode}), 방문 지문 ${snapshot.visitsFingerprint}`);
    console.log(`섹션 초안 ${fields.sectionDrafts?.length || 0}개, 근거 카드 ${fields.evidenceCards?.length || 0}개, 확인할 전문용어 ${(fields.pendingTermConfirmations || []).length}개`);
    for (const [key, value] of Object.entries(snapshot.chainFingerprints)) console.log(`  ${key} ${value}`);
  } finally {
    server?.close();
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
