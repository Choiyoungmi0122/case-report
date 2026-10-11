/**
 * Scaffold 초안 생성 뒤 거르기(SCAFFOLD-FILTER:v1) 검증. 예문은 2026-10-12 평가에서 실제로 나온 문장이다.
 */
import assert from 'node:assert/strict';
import { filterScaffoldDraftText } from '../../src/llm/postFilters/scaffoldDraftFilter';

const evidence = [
  { sourceText: '(생반하 9,복령 9,생강 4,건강 2,조구등 7.5,죽여 6,지각 9,황련 4.5,육계 3)' },
  { sourceText: '• 황련해독탕 2주 (한신, 보험한약 가루약 5.61g/3포, 1일 3회 식후 30분 복용)' },
  { sourceText: '글리아티린 연질캡슐 400mg 1C tid' }
];

function run(text: string) {
  return filterScaffoldDraftText(text, evidence);
}

function main() {
  // 1. 없는 내용만 말하는 문장은 뺀다
  {
    const { text, report } = run('침 치료는 풍지, 심수에 시행하였다. 유침 시간, 침의 규격 등 추가적인 세부사항은 기록되어 있지 않다.');
    assert.equal(text, '침 치료는 풍지, 심수에 시행하였다.');
    assert.equal(report.removedSentences.length, 1);
  }
  for (const sentence of [
    '인구학적 정보, 과거력, 가족력, 사회력 등은 기록되어 있지 않다.',
    '이상반응에 대한 구체적인 언급은 확인되지 않았다.',
    '약침의 제제, 제조 방법, 투여 속도 등 추가 정보는 확인되지 않는다.',
    '부항의 부위, 시술 시간 등은 구체적으로 명시되어 있지 않다.',
    '치료의 구체적 용량, 시술 시간 등 일부 세부사항은 기록에 나타나지 않는다.'
  ]) {
    const { text, report } = run(`한약을 처방하였다. ${sentence}`);
    assert.equal(text, '한약을 처방하였다.', sentence);
    assert.deepEqual(report.removedSentences, [sentence]);
  }

  // 2. 사실 절 뒤에 붙은 없는 내용은 잘라 사실 절만 남긴다
  const trims: Array<[string, string]> = [
    ['부항술은 건식부항 및 유관법으로 시행되었으며, 시술 부위나 시간 등은 구체적으로 기록되어 있지 않다.', '부항술은 건식부항 및 유관법으로 시행되었다.'],
    ['구술(간접구)은 모든 방문에서 시행되었으나, 사용된 기구, 시술 시간, 부위 등은 기록에 나타나지 않는다.', '구술(간접구)은 모든 방문에서 시행되었다.'],
    ['침술은 투자법, 침전기자극술로 이루어졌으며, 유침 시간이나 침의 규격에 대한 구체적 기록은 확인되지 않았다.', '침술은 투자법, 침전기자극술로 이루어졌다.'],
    ['부항치료는 건식부항 및 유관법이 병행되었으며, 부위는 명확히 기재되어 있지 않으나 반복적으로 시행되었다.', '부항치료는 건식부항 및 유관법이 병행되었으며, 반복적으로 시행되었다.']
  ];
  for (const [before, after] of trims) {
    const { text, report } = run(before);
    assert.equal(text, after, before);
    assert.equal(report.trimmedSentences.length, 1);
  }

  // 3. 기록된 음성 소견과 문서 내용을 옮긴 문장은 그대로 둔다
  for (const sentence of [
    '혈액검사에서 특이 소견은 확인되지 않았다.',
    '그 외 특이 이상반응은 보고되지 않았다.',
    '정신과 약 처방의 상병명은 우울에피소드이며, 처방 사유는 수면과 불안 조절로 기록되어 있다.'
  ]) {
    const { text, report } = run(sentence);
    assert.equal(text, sentence);
    assert.equal(report.removedSentences.length + report.trimmedSentences.length, 0);
  }
  assert.equal(run('처방 사유는 수면과 불안 조절로 기록되어 있다.').report.flaggedMetaSentences.length, 1, '사실과 섞인 자료 설명은 표시만');

  // 4. "~된/한 기록이 있다", "기록된 바와 같이"
  assert.equal(run('생맥산은 5포 또는 6포가 별도로 제공된 기록이 있으며, 아침에 복용하도록 하였다.').text, '생맥산은 5포 또는 6포가 별도로 제공되었으며, 아침에 복용하도록 하였다.');
  assert.equal(run('식단 조절을 강조한 기록이 있다.').text, '식단 조절을 강조하였다.');
  assert.equal(run('약침 5회 패키지로 1회씩 시행된 기록이 있다.').text, '약침 5회 패키지로 1회씩 시행되었다.');
  assert.equal(run('한약의 구성 약재와 용량은 각 처방별로 기록된 바와 같이 조제되었다.').text, '한약의 구성 약재와 용량은 각 처방별로 조제되었다.');

  // 5. 근거에 단위 없이 적힌 약재 양의 g 를 뗀다. 근거에 g 이 있으면 둔다
  {
    const { text, report } = run('황련온담탕에는 생반하 9g, 복령 9g, 황련 4.5g 등이 포함되었다. 황련해독탕은 가루약 5.61g/3포를 1일 3회 복용하였다.');
    assert.equal(text, '황련온담탕에는 생반하 9, 복령 9, 황련 4.5 등이 포함되었다. 황련해독탕은 가루약 5.61g/3포를 1일 3회 복용하였다.');
    assert.deepEqual(report.strippedUnits, ['생반하 9g', '복령 9g', '황련 4.5g']);
  }
  // 근거에 그 약재·양이 없으면 떼지 않고 표시한다
  {
    const { text, report } = run('당귀 12g을 더하였다.');
    assert.equal(text, '당귀 12g을 더하였다.');
    assert.deepEqual(report.flaggedNumbers, ['12g']);
  }

  // 6. "1회 3회" 오기
  {
    const { text, report } = run('도네페질정 5mg을 저녁 식후 1회, 글리아티린 연질캡슐 400mg을 1회 3회 복용하고 있었다.');
    assert.equal(text, '도네페질정 5mg을 저녁 식후 1회, 글리아티린 연질캡슐 400mg을 1일 3회 복용하고 있었다.');
    assert.equal(report.fixedTypos.length, 1);
  }

  // 7. 마지막 요약 문장
  {
    const { text, report } = run('침 치료를 시행하였다.\n\n이상의 치료들은 각 방문에서 반복적으로 시행되었으며, 치료 내용 및 방법은 환자의 증상 변화와 요청에 따라 일부 조정되었다.');
    assert.equal(text, '침 치료를 시행하였다.');
    assert.equal(report.removedSentences.length, 1);
  }
  // 중간에 있거나 치료 요약이 아니면 둔다
  assert.equal(run('이러한 임상 소견을 바탕으로 화병 가능성이 임상적으로 고려되었다.').text, '이러한 임상 소견을 바탕으로 화병 가능성이 임상적으로 고려되었다.');

  // 8. 문단 유지, 빈 입력
  assert.equal(run('첫 문단이다.\n\n둘째 문단이다.').text, '첫 문단이다.\n\n둘째 문단이다.');
  assert.equal(run('').text, '');

  console.log('scaffold draft filter tests passed');
}

main();
