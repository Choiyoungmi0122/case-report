/**
 * 1순위 보류분(docs/prompt_chain_review_v1.md §5-1 4번) 검증. 네트워크·DB 를 쓰지 않는다.
 *  - SW-C 응답에 판정이 없는 항목은 'unchecked'(판정 없음)로 저장된다
 *  - 연구 요약은 판정 없음을 누락으로 세지 않고, 준수율 분모에서 뺀다
 *  - 2026-10-11 판의 "not_in_record + 판정 못 받음 hint" 도 판정 없음으로 읽는다
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { CARE_CHECK_RUNS, mergeCareCheckOutputs, runCareCheck, timelineStructurePresent } from '../../src/studyWrite/drafting';
import { effectiveCareStatus } from '../../src/studyWrite/careStatus';
import { buildStudyWriteSummary } from '../../src/studyWrite/researchSummary';

async function run() {
  // ---------------------------------------------------------------- SW-C: 빠진 항목 → unchecked
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  items: [
                    { code: 'CARE 9a', status: 'present', hint: '' },
                    { code: '9c.', status: 'not_in_record', hint: '변경 기록 없음' }
                  ]
                })
              }
            }
          ],
          usage: null
        })
      }
    }
  });
  assert.equal(CARE_CHECK_RUNS, 2);
  const check = await runCareCheck({
    caseData: { id: 'test', visits: [{ soapText: '귀비탕 1일 2회 복용.' }] },
    state: { rounds: [], sections: {} } as any,
    sectionId: 'THERAPEUTIC_INTERVENTIONS',
    draftText: '귀비탕을 투여하였다.'
  });
  __setOpenAIClientForTests(null);
  const byCode = Object.fromEntries(check.items.map((item) => [item.code, item]));
  assert.equal(byCode['9a'].status, 'present');
  assert.equal(byCode['9b'].status, 'unchecked', '모델이 빠뜨린 항목은 판정 없음');
  assert.match(byCode['9b'].hint, /점검 결과를 받지 못했습니다/);
  assert.equal(byCode['9c'].status, 'not_in_record', '모델이 "없음"이라 한 것은 그대로');

  // ---------------------------------------------------------------- 두 번 점검 합치기
  {
    const merged = mergeCareCheckOutputs([
      { items: [{ code: '7', status: 'present', hint: '' }], subItems: [{ id: '7-2', status: 'present', hint: '' }, { id: '7-3', status: 'not_in_record', hint: '없음 1' }] },
      { items: [{ code: '7', status: 'present', hint: '' }], subItems: [{ id: '7-2', status: 'in_record_not_in_draft', hint: '빠짐' }, { id: '7-3', status: 'not_in_record', hint: '없음 2' }] }
    ] as any);
    const sub = Object.fromEntries(merged.subItems.map((item) => [item.id, item]));
    assert.equal(sub['7-2'].status, 'present', '하나라도 있음이면 있음');
    assert.ok(merged.disagreedSubIds.has('7-2'), '판정이 갈림');
    assert.equal(sub['7-3'].status, 'not_in_record', '둘 다 없음이면 없음');
    assert.ok(!merged.disagreedSubIds.has('7-3'));
    assert.equal(merged.disagreedItemCodes.size, 0);
  }

  // ---------------------------------------------------------------- 타임라인 표 구조
  {
    const table = [
      '과거력(1년 전) | 진단 | 12유도 심전도: 발작성 심방세동 | -',
      '첫 기록일 +16일 | 두근거림 | 혈압 138/86 mmHg | 황련온담탕 시작',
      '첫 기록일 +141일 | 호전 | - | 처방 변경'
    ].join('\n');
    assert.deepEqual([...timelineStructurePresent(table, 141)].sort(), ['7-1', '7-2', '7-3', '7-4', '7-5']);
    const dashes = ['첫 기록일 +16일 | 두근거림 | - | 시작', '첫 기록일 +53일 | 호전 | - | 변경'].join('\n');
    const got = timelineStructurePresent(dashes, 141);
    assert.ok(!got.has('7-2') && !got.has('7-3') && !got.has('7-5'), '과거력 행 없음, 진단 검사 칸 모두 "-", 마지막 방문 아님');
  }

  // ---------------------------------------------------------------- 옛 판 읽기
  assert.equal(effectiveCareStatus({ status: 'not_in_record', hint: '점검 결과를 받지 못한 항목입니다. 다시 점검하면 판정됩니다.' }), 'unchecked');
  assert.equal(effectiveCareStatus({ status: 'not_in_record', hint: '변경 기록 없음' }), 'not_in_record');
  assert.equal(effectiveCareStatus({ status: 'present', hint: '' }), 'present');

  // ---------------------------------------------------------------- 연구 요약
  const state: any = {
    rounds: [],
    sections: {
      THERAPEUTIC_INTERVENTIONS: {
        sectionId: 'THERAPEUTIC_INTERVENTIONS',
        draftText: '초안',
        version: 1,
        history: [{ version: 1, text: '초안', source: 'answers', at: '2026-10-12T00:00:00.000Z' }],
        chat: [],
        attachmentIds: [],
        careCheck: {
          checkedAt: '2026-10-12T00:00:00.000Z',
          promptVersion: 'SW-C:v2',
          items: [
            { code: '9a', label: 'a', required: true, status: 'present', hint: '' },
            { code: '9b', label: 'b', required: true, status: 'unchecked', hint: '' },
            // 옛 판 판정 없음
            { code: '9c', label: 'c', required: false, status: 'not_in_record', hint: '점검 결과를 받지 못한 항목입니다. 다시 점검하면 판정됩니다.' }
          ]
        }
      }
    }
  };
  const summary: any = buildStudyWriteSummary(state);
  const ti = summary.sections.find((item: any) => item.sectionId === 'THERAPEUTIC_INTERVENTIONS');
  assert.ok(ti, JSON.stringify(summary.sections));
  assert.equal(ti.careTotal, 3);
  assert.equal(ti.careUnchecked, 2);
  assert.equal(ti.careOk, 1);
  assert.equal(ti.carePct, 100, '판정 받은 1개 중 1개 충족');
  assert.equal(ti.careRequiredPct, 100);
  assert.equal(ti.careRequiredMissing, 0, '판정 없음은 누락이 아니다');
  assert.equal(ti.careOptionalMissing, 0);
  assert.equal(summary.careCompliance.unchecked, 2);
  assert.equal(summary.careCompliance.pct, 100);

  console.log('study write care unchecked tests passed');
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
