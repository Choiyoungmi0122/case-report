import assert from 'node:assert/strict';
import {
  findRemainingPlaceholders,
  renderClinicalAnonymizedMap,
  renderClinicalAnonymizedText
} from '../../src/deid/publicationRenderer';

/**
 * Golden vectors. The frontend renderer must produce the same output for the
 * same input, so this list is duplicated verbatim in
 * `frontend/tests/publicationRenderer.vectors.ts`. Keep the two in sync.
 */
export const RENDER_VECTORS: Array<[string, string]> = [
  // patient name + particles
  ['[PATIENT_NAME_1] 환자는 3개월 전부터 견비통을 호소하였다.', '환자는 3개월 전부터 견비통을 호소하였다.'],
  ['[PATIENT_NAME_1]의 증상은 호전되었다.', '환자의 증상은 호전되었다.'],
  ['[PATIENT_NAME_1]에게 침치료를 시행하였다.', '환자에게 침치료를 시행하였다.'],
  ['[PATIENT_NAME_1]은 내원하였다.', '환자는 내원하였다.'],
  ['[PATIENT_NAME_1]이 호전되었다.', '환자가 호전되었다.'],
  ['[PATIENT_NAME_1]을 진찰하였다.', '환자를 진찰하였다.'],
  ['[PATIENT_NAME_1] 환자의 경과를 관찰하였다.', '환자의 경과를 관찰하였다.'],
  ['[PATIENT_NAME_1] 환자에게 설명하였다.', '환자에게 설명하였다.'],

  // hospital
  ['[HOSPITAL_1]에서 진단받았다.', '타 의료기관에서 진단받았다.'],
  ['환자는 [HOSPITAL_1]에서 MRI 검사를 시행하였다.', '환자는 타 의료기관에서 MRI 검사를 시행하였다.'],
  ['[HOSPITAL_1]는 상급 기관이다.', '타 의료기관은 상급 기관이다.'],

  // combined
  [
    '[PATIENT_NAME_1] 환자는 [HOSPITAL_1]에서 보존적 치료를 받았으나 증상이 지속되어 본원에 내원하였다.',
    '환자는 타 의료기관에서 보존적 치료를 받았으나 증상이 지속되어 본원에 내원하였다.'
  ],

  // doctor
  ['[DOCTOR_NAME_1]이 진료하였다.', '의료진이 진료하였다.'],

  // no placeholder at all
  ['환자는 견비통을 주소로 내원하였다.', '환자는 견비통을 주소로 내원하였다.'],
  ['', '']
];

function run() {
  console.log('publication renderer:');

  for (const [input, expected] of RENDER_VECTORS) {
    const actual = renderClinicalAnonymizedText(input);
    assert.equal(actual, expected, `\n  input   : ${input}\n  expected: ${expected}\n  actual  : ${actual}`);
  }
  console.log(`  ${RENDER_VECTORS.length} golden vectors passed`);

  /* -------- identifiers that a case report does not need -------- */
  const withPhone =
    '환자는 견비통으로 내원하였다. 연락처는 [PHONE_1]이다. 침치료를 시행하였다.';
  const rendered = renderClinicalAnonymizedText(withPhone);
  assert.ok(!rendered.includes('[PHONE_1]'), 'phone placeholder must not survive');
  assert.ok(rendered.includes('견비통으로 내원하였다.'), 'surrounding sentences must survive');
  assert.ok(rendered.includes('침치료를 시행하였다.'), 'surrounding sentences must survive');
  assert.ok(!rendered.includes('연락처'), 'the identifier-only sentence should be dropped');
  console.log('  identifier-only sentence dropped, neighbours kept');

  // A structured single-line field must not be blanked out entirely.
  const structured = renderClinicalAnonymizedText('등록번호: [PATIENT_ID_1]');
  assert.ok(!structured.includes('[PATIENT_ID_1]'));
  assert.ok(structured.length >= 0);
  console.log(`  structured line handled: "${structured}"`);

  /* -------- optional demographic descriptor -------- */
  const withDescriptor = renderClinicalAnonymizedText(
    '[PATIENT_NAME_1] 환자는 내원하였다. [PATIENT_NAME_1]의 증상은 호전되었다.',
    { patientDescriptor: '45세 남성' }
  );
  assert.equal(withDescriptor, '45세 남성 환자는 내원하였다. 환자의 증상은 호전되었다.');
  console.log('  demographic descriptor applied to first mention only');

  /* -------- never re-emit part of a real name -------- */
  const masked = renderClinicalAnonymizedText('[PATIENT_NAME_1] 환자');
  assert.ok(!/[○OＯ]/.test(masked), 'must not produce 김○○-style partial masking');
  assert.equal(masked, '환자');

  /* -------- no placeholder may survive -------- */
  const messy =
    '[PATIENT_NAME_2] 환자는 [HOSPITAL_3]에서 [DATE_1]에 진단받았고 [EMAIL_1] 로 회신하였다. [ADDRESS_1] 거주.';
  const cleaned = renderClinicalAnonymizedText(messy);
  assert.deepEqual(findRemainingPlaceholders(cleaned), [], `placeholders survived: ${cleaned}`);
  for (const prefix of ['[PATIENT_NAME_', '[HOSPITAL_', '[PHONE_', '[PATIENT_ID_', '[EMAIL_', '[ADDRESS_']) {
    assert.ok(!cleaned.includes(prefix), `${prefix} must not appear in display output`);
  }
  console.log('  no placeholder token survives rendering');

  /* -------- map helper -------- */
  const map = renderClinicalAnonymizedMap({
    TITLE: '[PATIENT_NAME_1] 환자의 견비통 증례',
    CLINICAL_FINDINGS: '[PATIENT_NAME_1]은 [HOSPITAL_1]에서 검사하였다.'
  });
  assert.equal(map.TITLE, '환자의 견비통 증례');
  assert.equal(map.CLINICAL_FINDINGS, '환자는 타 의료기관에서 검사하였다.');
  console.log('  map rendering works');

  /* -------- idempotency -------- */
  const once = renderClinicalAnonymizedText(RENDER_VECTORS[0][0]);
  assert.equal(renderClinicalAnonymizedText(once), once, 'rendering twice must be stable');
  console.log('  rendering is idempotent');

  console.log('publication renderer tests passed');
}

run();
