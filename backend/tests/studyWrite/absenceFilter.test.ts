import assert from 'node:assert/strict';
import { dropAbsenceSentences, isAbsenceSentence } from '../../src/studyWrite/absenceFilter';

function run() {
  // 지우는 것: 기록·언급·정보 부재 문장
  for (const s of [
    '과거력, 수술력, 복용 중인 약물에 대한 정보는 기록에 나타나지 않았다.',
    '진단의 어려움이나 예후 특성에 대한 별도의 언급은 확인되지 않는다.',
    '첫 기록일에는 증상 경과에 대한 구체적인 내용이 남아 있지 않았다.',
    '식욕, 소화, 대변에 대한 추가 기록은 확인되지 않았다.',
    '가족력에 대한 기록은 없다.'
  ]) {
    assert.equal(isAbsenceSentence(s), true, s);
  }
  // 남기는 것: 음성 소견, 환자 진술, 이상반응, 확인 필요, 사실 문장
  for (const s of [
    '흉부 X-ray에서 이상 소견은 없었다.',
    '심음은 불규칙한 리듬 외에 잡음은 없었다.',
    '환자는 이전에 한방 치료를 받은 적이 없다고 하였다.',
    '기록에 이상반응 관련 언급이 없다 [확인 필요: 이상반응 유무].',
    '치료 관련 부작용은 기록되지 않았다.',
    '환자는 첫 기록일 +16일에 2~3일에 한 번 두근거림을 호소하였다.',
    '입마름은 없었다.',
    '양약은 치료 기간 동안 변경 없이 유지하였다.'
  ]) {
    assert.equal(isAbsenceSentence(s), false, s);
  }
  // 문단·표 처리
  const text = '환자는 68세 남성이다. 과거력에 대한 기록은 없다. 비흡연자이다.\n\n가족력 정보는 확인되지 않았다.\n\n첫 기록일 +16일 | 내용 기록 없음 | - | -';
  const result = dropAbsenceSentences(text);
  assert.equal(result.text, '환자는 68세 남성이다. 비흡연자이다.\n\n첫 기록일 +16일 | 내용 기록 없음 | - | -');
  assert.equal(result.removed.length, 2);
  // 한 문장 안의 부재 절만 뺀다
  assert.equal(dropAbsenceSentences('입마름은 없었고, 식욕 및 소화, 대변에 대한 추가 기록은 확인되지 않았다.').text, '입마름은 없었다.');
  assert.equal(dropAbsenceSentences('맥은 활삭하였으며, 복진 소견에 대한 기록은 없었다.').text, '맥은 활삭하였다.');
  assert.equal(dropAbsenceSentences('가족력에 대한 정보는 없고, 음주는 주 1회였다.').text, '음주는 주 1회였다.');
  // 대비(~으나)로 이은 앞 절 뒤의 부재 절: 앞 절이 반쪽이 되므로 문장째 뺀다 (임교수 테스트 6 치료 개입에서 나온 문장)
  {
    const broken = dropAbsenceSentences(
      '5. 기타\n생활 지도, 식이 조절 등은 증상 경과 기록에서 식단 조절, 수면 습관 안내 등이 언급되어 있으나, 구체적인 지도 내용과 빈도는 명시되어 있지 않다.'
    );
    assert.equal(broken.text, '5. 기타');
    assert.equal(broken.removed.length, 1);
    assert.match(broken.removed[0], /언급되어 있으나, 구체적인/);
  }
  assert.equal(dropAbsenceSentences('침 치료를 시행하였으나, 유침 시간은 기록되지 않았다.').text, '', '"~으나" 뒤 부재 절이면 문장째');
  // "~거나"도 끝맺으면 "복용하거나."처럼 반쪽이 되므로 문장째 뺀다
  assert.equal(dropAbsenceSentences('식후 복용하거나, 복용 시점에 대한 기록은 없었다.').text, '');
  // 부재 절이 앞에 있고 "~으나"로 이으면 뒤 소견은 남긴다
  assert.equal(dropAbsenceSentences('가족력에 대한 정보는 없으나, 음주는 주 1회였다.').text, '음주는 주 1회였다.');
  // 앞 절이 "~고"·"~며"면 지금처럼 앞 절만 끝맺어 남긴다
  assert.equal(dropAbsenceSentences('침 치료를 주 2회 시행하였고, 유침 시간은 기록되지 않았다.').text, '침 치료를 주 2회 시행하였다.');
  assert.equal(dropAbsenceSentences('유침 시간, 자극 방법 등은 기록에 명시되어 있지 않다.').text, '');
  assert.equal(
    dropAbsenceSentences('부항은 유관법으로 시행하였으며, 부위는 기록상 명확히 구분되어 있지 않으나, 반복적으로 병행되었다.').text,
    '부항은 유관법으로 시행하였으며, 반복적으로 병행되었다.'
  );
  assert.equal(isAbsenceSentence('치료 기간 중 약침 부위 통증, 발적 등 국소 반응은 관찰되지 않았다.'), false);
  // 기록된 소견을 전하는 문장은 남긴다 (2026-10-12 오탐)
  assert.equal(isAbsenceSentence('맥의 리듬은 완전히 규칙적이지는 않았다고 기록되었다.'), false);
  assert.equal(isAbsenceSentence('설태는 옅어지지 않은 것으로 기록하였다.'), false);
  console.log('absenceFilter tests passed');
}

run();
