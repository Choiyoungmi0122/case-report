/**
 * 실험용 Write 프리셋 EMR 의 기록 빈칸 질문을 실험 전에 미리 만든다 (2026-10-13).
 *
 *   npm run study-write:prepare -- <presetId>      (presetId 를 빼면 프리셋 목록을 보여 준다)
 *   npm run study-write:prepare -- <presetId> --reuse-case <caseId>   (분석한 준비용 사례로 질문만 다시)
 *
 * 하는 일:
 * 1. 프리셋 방문 기록으로 준비용 사례를 만든다 (cases 컬렉션, 제목 "[사전 준비] ...", 연구 세션 없음).
 *    입력 화면과 같은 경로(POST /api/cases → 질의응답 시작 → 분석)를 이 프로세스 안에서 그대로 돈다.
 * 2. 분석이 끝나면 SW-Q2 로 질문 2~4개를 만든다. 고정 질문 3개와 합쳐 5~7개를 한 회차로 묻는다.
 * 3. backend/data/study-write-prepared/<presetId>.json 에 저장한다. 준비용 사례는 출처로 남겨 둔다.
 *
 * 프리셋을 고치면 다시 돌린다 (방문 기록 지문이 달라지면 서버가 옛 질문을 쓰지 않는다).
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const presetId = process.argv[2];
  const [{ initDatabase }, { getStudyWritePreset, listStudyWritePresets }] = await Promise.all([
    import('../src/db/schema'),
    import('../src/studyWrite/presets')
  ]);

  if (!presetId) {
    console.log('사용법: npm run study-write:prepare -- <presetId>\n\n프리셋:');
    for (const preset of listStudyWritePresets()) console.log(`  ${preset.id}  (${preset.label}, 방문 ${preset.visitCount}회)`);
    return;
  }
  const preset = getStudyWritePreset(presetId);
  if (!preset) throw new Error(`프리셋을 찾지 못했습니다: ${presetId}`);

  const [{ default: express }, { default: casesRouter }, { default: studyWriteRouter }, { usageContextMiddleware }] =
    await Promise.all([
      import('express'),
      import('../src/routes/cases'),
      import('../src/routes/studyWrite'),
      import('../src/llm/usageContext')
    ]);
  const { CaseModel } = await import('../src/models/caseModel');
  const { generatePreparedQuestions, isAnalysisReady, FIXED_CASE_QUESTIONS } = await import('../src/studyWrite/interview');
  const { savePreparedQuestions, visitsFingerprint } = await import('../src/studyWrite/preparedQuestions');
  const mongoose = (await import('mongoose')).default;

  await initDatabase();
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', usageContextMiddleware);
  app.use('/api/cases', casesRouter);
  app.use('/api/study-write', studyWriteRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
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

  const caseModel = new CaseModel();
  const reuseIndex = process.argv.indexOf('--reuse-case');
  const reuseCaseId = reuseIndex >= 0 ? process.argv[reuseIndex + 1] : '';
  try {
    if (reuseCaseId) {
      // 이미 분석한 준비용 사례로 질문만 다시 만든다 (분석 비용·시간을 다시 쓰지 않는다).
      const caseData: any = await caseModel.getCase(reuseCaseId);
      if (!caseData) throw new Error(`사례를 찾지 못했습니다: ${reuseCaseId}`);
      if (caseData.studyWrite?.inputSource?.presetId !== preset.id) throw new Error(`${reuseCaseId} 는 ${preset.id} 준비용 사례가 아닙니다.`);
      if (!isAnalysisReady(caseData)) throw new Error(`${reuseCaseId} 의 분석이 끝나지 않았습니다.`);
      await saveAndPrint(caseData);
      return;
    }

    // 입력 화면(CaseInputPage normalizeVisits)과 같은 모양으로 넣는다. 그래야 지문이 참여자 사례와 같다.
    const visits = preset.visits.map((visit, index) => ({
      type: index === 0 ? '초진' : '재진',
      date: visit.date,
      soapText: visit.soapText.replace(/\\n/g, '\n')
    }));
    const created = await call('POST', '/cases', {
      mode: 'write',
      title: `[사전 준비] ${preset.label}`,
      visits
    });
    const caseId: string = created.caseId;
    console.log(`준비용 사례 ${caseId} (${created.experimentCode || '-'})`);

    await call('POST', `/study-write/cases/${caseId}/interview/start`, {
      inputSource: { source: 'preset', presetId: preset.id, visitCount: preset.visitCount, relativeDates: preset.relativeDates },
      processingRequested: true
    });

    console.log('기록 분석 중… (몇 분 걸립니다)');
    const startedAt = Date.now();
    const processed = await call('POST', `/cases/${caseId}/process`);
    if (processed?.blocked) {
      throw new Error('분석이 전문용어 확인에서 멈췄습니다. 화면에서 이 사례의 용어를 확인한 뒤 다시 돌려 주세요.');
    }
    let caseData: any = await caseModel.getCase(caseId);
    while (!isAnalysisReady(caseData)) {
      if (Date.now() - startedAt > 30 * 60 * 1000) throw new Error('분석이 30분 안에 끝나지 않았습니다.');
      await new Promise((resolve) => setTimeout(resolve, 5000));
      caseData = await caseModel.getCase(caseId);
    }
    console.log(`분석 끝 (${Math.round((Date.now() - startedAt) / 1000)}초)`);
    await saveAndPrint(caseData);
  } finally {
    server.close();
    await mongoose.disconnect();
  }

  async function saveAndPrint(caseData: any) {
    const caseId: string = caseData.id;
    const generated = await generatePreparedQuestions(caseData);
    const file = savePreparedQuestions({
      presetId: preset.id,
      preparedCaseId: caseId,
      visitsFingerprint: visitsFingerprint(caseData.visits),
      generation: generated.generation,
      ...(generated.discussionGeneration ? { discussionGeneration: generated.discussionGeneration } : {}),
      questions: generated.questions
    });

    console.log(`\n저장: ${file}\n`);
    const isDiscussion = (careItem: string) => /^11[abc]$/i.test(careItem.trim());
    const discussionCount = generated.questions.filter((question) => isDiscussion(question.careItem)).length;
    console.log(
      `질문 ${FIXED_CASE_QUESTIONS.length + generated.questions.length}개 (고정 ${FIXED_CASE_QUESTIONS.length} + 기록 빈칸 ${generated.questions.length - discussionCount} + 고찰 ${discussionCount})`
    );
    FIXED_CASE_QUESTIONS.forEach((question, index) => console.log(`  ${index + 1}. [고정] ${question.text}`));
    generated.questions.forEach((question, index) =>
      console.log(`  ${FIXED_CASE_QUESTIONS.length + index + 1}. [${isDiscussion(question.careItem) ? "고찰 " : ""}${question.careItem}] ${question.text}\n       └ 이유: ${question.rationale || '-'}`)
    );
    if (generated.questions.length < 2) {
      console.warn(`\n기록 빈칸 질문이 ${generated.questions.length}개뿐입니다 (5개 미만). 체인 설명: ${generated.stopReason || '-'}`);
    }
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
