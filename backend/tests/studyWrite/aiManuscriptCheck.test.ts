/**
 * AI 원고 검사(studyWrite/aiManuscriptCheck.ts)의 코드 거르기와 결과 조립. 가짜 클라이언트, 네트워크·DB 없음.
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { crossConflicts, excerptInText, runAiManuscriptCheck } from '../../src/studyWrite/aiManuscriptCheck';

async function run() {
  // 원고에 그대로 있는지 (띄어쓰기 차이 무시)
  assert.equal(excerptInText('간접구는 복부(IR)와  배수혈', '…간접구는 복부(IR)와 배수혈(건부)에 시행되었다.'), true);
  assert.equal(excerptInText('지어낸 문장입니다', '간접구는 복부에 시행되었다.'), false);

  // 섹션 사이: 실제로 어긋나는 것만
  assert.equal(crossConflicts('+24일에 복약 후 통증', '+29일에 복약 후 통증'), true, '날짜가 다름');
  assert.equal(crossConflicts('반하후박탕(半夏厚朴湯)으로 변경', '반하후박탕합생맥산으로 변경'), true, '처방명 앞부분만 같음');
  assert.equal(crossConflicts('그 외의 이상반응은 없었다.', '[확인 필요: 그 외 이상반응 유무]'), true, '유무 단정 ↔ 확인 필요');
  assert.equal(
    crossConflicts('+24~+29일에 복약 후 아랫배 통증이 있었다.', '+24일~+29일에 복약 후 아랫배가 살살 아픈 증상이 반복적으로 보고되었고'),
    false,
    '자세함 차이'
  );
  assert.equal(crossConflicts('+137일부터 생맥산을 아침에', '+137일 | 생맥산 5포 추가 … +141일 생맥산 6포'), false, '요약이 덜 자세함');

  // 결과 조립: 원고에 없는 문장·어긋나지 않는 섹션 비교는 버린다
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async (body: any) => {
          const label = JSON.stringify(body.messages);
          const content = label.includes('같은 사실이 섹션마다 다르게')
            ? { findings: [
                { sectionA: 'ABSTRACT', excerptA: '아랫배 통증이 있었다', sectionB: 'FOLLOW_UP_OUTCOMES', excerptB: '아랫배 통증이 반복적으로 보고되었다', explanation: '빈도', suggestion: '' },
                { sectionA: 'TIMELINE', excerptA: '반하후박탕으로 변경', sectionB: 'THERAPEUTIC_INTERVENTIONS', excerptB: '반하후박탕합생맥산을 투여', explanation: '처방명', suggestion: '' }
              ] }
            : label.includes('검사할 섹션] 치료 개입')
              ? { findings: [
                  { type: 'misread', excerpt: '간접구는 복부와 배수혈에 시행되었다', evidence: '14회차: IR : 복부 / 건부 : 배수혈', explanation: '부위가 섞임', suggestion: '나눠 쓴다' },
                  { type: 'unsupported', excerpt: '원고에 없는 지어낸 문장', evidence: '', explanation: 'x', suggestion: '' }
                ] }
              : { findings: [] };
          return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: null };
        }
      }
    }
  });
  const section = (sectionId: string, draftText: string) => ({ sectionId, draftText, version: 1, history: [], chat: [], attachmentIds: [], careCheck: null });
  const result = await runAiManuscriptCheck({
    caseData: { visits: [{ date: '2026-01-01', soapText: '기록' }], deidentifiedEMRs: [{ deidentifiedText: '두근거림이 있어 내원하였다. 혈압을 쟀다.' }] },
    state: {
      rounds: [],
      sections: {
        THERAPEUTIC_INTERVENTIONS: section('THERAPEUTIC_INTERVENTIONS', '반하후박탕합생맥산을 투여하였다. 간접구는 복부와 배수혈에 시행되었다.'),
        ABSTRACT: section('ABSTRACT', '아랫배 통증이 있었다.'),
        FOLLOW_UP_OUTCOMES: section('FOLLOW_UP_OUTCOMES', '아랫배 통증이 반복적으로 보고되었다.'),
        TIMELINE: section('TIMELINE', '+141일 | 호전 | - | 반하후박탕으로 변경')
      }
    } as any
  });
  __setOpenAIClientForTests(null);
  const kinds = result.findings.map((f) => `${f.sectionId}:${f.kind}:${f.severity}`);
  assert.deepEqual(kinds, ['THERAPEUTIC_INTERVENTIONS:ai_misread:error', 'TIMELINE:ai_cross:warn']);
  assert.equal(result.droppedCount, 2, '지어낸 문장 1 + 자세함 차이 1');
  assert.deepEqual(result.failedSections, []);
  console.log('aiManuscriptCheck tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
