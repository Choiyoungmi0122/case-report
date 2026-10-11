/**
 * CARE 하위 요소(체크리스트 v2, docs/care_subelements_v1.md) 검증. 네트워크·DB 를 쓰지 않는다.
 *  - 개입 묶음 후보 고르기(detectModalities)
 *  - 네 섹션에만 붙고, 후보에 없는 9b 묶음은 빠진다
 *  - SW-C 응답의 subItems 가 항목 아래 저장되고, 빠진 요소는 판정 없음
 *  - 연구 요약의 하위 요소 집계는 해당 없음을 분모에서 뺀다
 */
import assert from 'node:assert/strict';
import { __setOpenAIClientForTests } from '../../src/llm/client';
import { normalizeSubElementId, runCareCheck } from '../../src/studyWrite/drafting';
import {
  CARE_SUB_ELEMENTS,
  conditionByEvidence,
  detectModalities,
  findSubElement,
  subElementsForSection,
  subElementsText
} from '../../src/studyWrite/careSubElements';
import { CARE_ITEMS_BY_SECTION } from '../../src/studyWrite/careItems';
import { buildStudyWriteSummary } from '../../src/studyWrite/researchSummary';

async function run() {
  // ---------------------------------------------------------------- 정의: 항목 번호가 careItems 와 맞는다
  const sectionOf: Record<string, string> = {};
  for (const [sectionId, items] of Object.entries(CARE_ITEMS_BY_SECTION)) for (const item of items) sectionOf[item.code] = sectionId;
  const ids = new Set<string>();
  for (const [code, groups] of Object.entries(CARE_SUB_ELEMENTS)) {
    assert.ok(sectionOf[code], `${code} 는 CARE_ITEMS_BY_SECTION 에 있는 항목`);
    for (const group of groups) for (const element of group.elements) {
      assert.ok(element.id.startsWith(`${code}-`), `${element.id} 는 ${code} 아래`);
      assert.ok(!ids.has(element.id), `${element.id} 중복`);
      ids.add(element.id);
    }
  }
  assert.equal(ids.size, 132, '전체 하위 요소 수 (문서 표 합계)');
  for (const [sectionId, items] of Object.entries(CARE_ITEMS_BY_SECTION)) {
    for (const item of items) assert.ok(CARE_SUB_ELEMENTS[item.code]?.length, `${sectionId} ${item.code} 에 하위 요소가 있음`);
  }

  // ---------------------------------------------------------------- 묶음 후보
  assert.deepEqual(detectModalities('귀비탕 1일 2첩 3회 복용. 침 치료 LI4, ST36 유침 15분.'), ['herbal', 'acupuncture']);
  assert.deepEqual(detectModalities('아침에 기침이 있고 침대에서 잘 못 일어남. 그리고 처음에는'), [], '아침·기침·침대·그리고·처음은 개입이 아님');
  assert.deepEqual(detectModalities('NRS 8, BDI 21점, PHQ 9'), [], '척도 약어는 혈위 코드가 아님');
  assert.ok(detectModalities('봉약침 0.1 cc').includes('pharmacopuncture'));
  assert.ok(detectModalities('amlodipine 5 mg 1일 1회').includes('western'));
  assert.deepEqual(detectModalities('소요산 투여', ['소요산']), ['herbal'], '사전 처방명으로 찾는다');
  assert.ok(detectModalities('소요산가미 투여').includes('herbal'), '가미가 붙은 산은 꼴로 찾는다');

  // ---------------------------------------------------------------- 섹션별 목록
  const tiCodes = CARE_ITEMS_BY_SECTION.THERAPEUTIC_INTERVENTIONS.map((item) => item.code);
  const ti = subElementsForSection('THERAPEUTIC_INTERVENTIONS', tiCodes, ['herbal']);
  assert.ok(ti.some((sub) => sub.id === '9b-H4'));
  assert.ok(!ti.some((sub) => sub.group === 'acupuncture'), '후보에 없는 침 묶음은 빠짐');
  assert.ok(ti.some((sub) => sub.id === '9a-1') && ti.some((sub) => sub.id === '9c-3'), '묶음 없는 요소는 늘 들어감');
  assert.equal(subElementsForSection('TITLE', ['1', '2'], ['herbal']).length, 5, '제목: 1-1~1-3, 2-1~2-2');
  assert.equal(subElementsForSection('CLINICAL_FINDINGS', ['6'], []).length, 4);
  assert.equal(subElementsForSection('UNKNOWN', ['6'], []).length, 0, '모르는 섹션은 없음');
  assert.equal(findSubElement('TIMELINE', '7-2')?.condition, '기록·답변에 발병 시점이나 관련 과거력이 있을 때');
  assert.equal(findSubElement('TIMELINE', '6-1'), null, '임상 소견 요소는 타임라인에서 못 찾음');
  const text = subElementsText(ti);
  assert.match(text, /\[9b 한약\] 적용: /);
  assert.match(text, /- 9b-H7 \(선택\) 가감 내용과 이유: .*\(조건: 가감방일 때\. conditionMet 을 반드시/);
  assert.equal(findSubElement('FOLLOW_UP_OUTCOMES', '10d-2')?.condition, '이상반응이 있었을 때');
  assert.equal(findSubElement('PATIENT_INFORMATION', '9b-H1'), null, '다른 섹션의 요소는 못 찾음');

  // ---------------------------------------------------------------- 낱말 조건
  const ea = findSubElement('THERAPEUTIC_INTERVENTIONS', '9b-A6')!;
  assert.equal(conditionByEvidence(ea, '내관-외관에 침전기자극술(전침) 병행'), true);
  assert.equal(conditionByEvidence(ea, '풍지, 내관 자침 후 15분 유침'), false);
  assert.equal(conditionByEvidence(findSubElement('PATIENT_INFORMATION', '5a-5')!, '68세 여자, 주부'), false);
  assert.equal(conditionByEvidence(findSubElement('PATIENT_INFORMATION', '5a-1')!, '아무 글'), null, '조건 낱말이 없는 요소는 모델이 정함');

  // ---------------------------------------------------------------- id 정규화
  assert.equal(normalizeSubElementId(' 9b-h4 '), '9B-H4');
  assert.equal(normalizeSubElementId('9b–H10'), '9B-H10');
  assert.equal(normalizeSubElementId('10a-6'), '10A-6');
  assert.equal(normalizeSubElementId('9bH4'), '9B-H4');

  // ---------------------------------------------------------------- SW-C 저장
  let prompt = '';
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async (body: any) => {
          prompt = body.messages.map((message: any) => message.content).join('\n');
          return {
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    items: [
                      { code: '9a', status: 'present', hint: '' },
                      { code: '9b', status: 'present', hint: '' },
                      { code: '9c', status: 'not_applicable', hint: '' }
                    ],
                    subItems: [
                      { id: '9b-h1', status: 'present', hint: '' },
                      { id: '9b-H2', status: 'in_record_not_in_draft', hint: '기록 1회차에 약재 구성이 있습니다.' },
                      { id: '9c-1', status: 'not_applicable', hint: '' },
                      // 조건이 맞지 않는다고 하면서 status 는 없음으로 둔 경우 → 해당 없음
                      { id: '9a-2', status: 'not_in_record', hint: '타 기관 치료 기록 없음', conditionMet: false },
                      // 조건은 맞고 내용이 없는 경우 → 없음 그대로
                      { id: '9b-H7', status: 'not_in_record', hint: '가감 이유 없음', conditionMet: true }
                    ]
                  })
                }
              }
            ],
            usage: null
          };
        }
      }
    }
  });
  const check = await runCareCheck({
    caseData: { id: 'test', visits: [{ soapText: '귀비탕 1일 2첩 3회 복용.' }] },
    state: { rounds: [], sections: {} } as any,
    sectionId: 'THERAPEUTIC_INTERVENTIONS',
    draftText: '귀비탕을 투여하였다.'
  });
  __setOpenAIClientForTests(null);
  assert.match(prompt, /\[점검할 하위 요소\]/);
  assert.match(prompt, /9b-H4/);
  assert.doesNotMatch(prompt, /9b-A1/, '침이 없는 사례에 침 묶음을 묻지 않음');
  assert.equal(check.checklistVersion, 'care-checklist:v2');
  assert.deepEqual(check.modalities?.checked, ['herbal']);
  assert.ok(check.modalities?.skipped.includes('acupuncture'));
  const b = check.items.find((item) => item.code === '9b')!;
  assert.equal(b.status, 'present', '항목 판정은 하위 요소와 따로');
  const sub = Object.fromEntries((b.subItems || []).map((item) => [item.id, item]));
  assert.equal(sub['9b-H1'].status, 'present', '소문자 id 도 맞춘다');
  assert.equal(sub['9b-H2'].status, 'in_record_not_in_draft');
  assert.equal(sub['9b-H3'].status, 'unchecked', '모델이 빠뜨린 요소는 판정 없음');
  assert.equal(sub['9b-H1'].groupLabel, '한약');
  assert.equal(check.items.find((item) => item.code === '9c')!.subItems![0].status, 'not_applicable');
  const a = Object.fromEntries((check.items.find((item) => item.code === '9a')!.subItems || []).map((item) => [item.id, item]));
  assert.equal(a['9a-2'].status, 'not_applicable', 'conditionMet false → 해당 없음');
  assert.equal(a['9a-2'].hint, '');
  assert.equal(a['9a-2'].conditionMet, false);
  assert.equal(sub['9b-H7'].status, 'not_in_record', 'conditionMet true 면 판정 그대로');

  // 묶음이 없는 섹션: 하위 요소는 붙고 modalities 는 없음. 모델이 하위 요소를 빠뜨리면 판정 없음
  __setOpenAIClientForTests({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: [{ code: '6', status: 'present', hint: '' }] }) } }],
          usage: null
        })
      }
    }
  });
  const cf = await runCareCheck({
    caseData: { id: 'test', visits: [{ soapText: '맥 침세.' }] },
    state: { rounds: [], sections: {} } as any,
    sectionId: 'CLINICAL_FINDINGS',
    draftText: '맥은 침세하였다.'
  });
  __setOpenAIClientForTests(null);
  assert.equal(cf.checklistVersion, 'care-checklist:v2');
  assert.equal(cf.items[0].subItems?.length, 4);
  assert.ok(cf.items[0].subItems!.every((sub) => sub.status === 'unchecked'));
  assert.equal(cf.modalities, undefined);
  assert.equal(findSubElement('PATIENT_INFORMATION', '5a-1')?.label, '나이');

  // ---------------------------------------------------------------- 연구 요약
  const summary: any = buildStudyWriteSummary({
    rounds: [],
    sections: {
      THERAPEUTIC_INTERVENTIONS: {
        sectionId: 'THERAPEUTIC_INTERVENTIONS',
        draftText: '초안',
        version: 1,
        history: [{ version: 1, text: '초안', source: 'answers', at: '2026-10-12T00:00:00.000Z' }],
        chat: [],
        attachmentIds: [],
        careCheck: check
      }
    }
  } as any);
  const row = summary.sections.find((item: any) => item.sectionId === 'THERAPEUTIC_INTERVENTIONS');
  assert.equal(row.careSubNotApplicable, 2);
  assert.equal(row.careSubPresent, 1);
  assert.ok(row.careSubUnchecked > 0);
  // 판정 받은 것 중 해당 없음을 뺀 분모: 9b-H1 present, 9b-H2·9b-H7 빠짐 → 33%
  assert.equal(row.careSubPct, 33);
  assert.equal(row.carePct, 100, '항목 단위 준수율은 그대로');

  console.log('careSubElements tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
