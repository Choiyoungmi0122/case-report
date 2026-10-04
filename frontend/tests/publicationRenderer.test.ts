import assert from 'node:assert/strict';
import {
  findRemainingPlaceholders,
  renderClinicalAnonymizedText
} from '../src/utils/publicationRenderer';

/**
 * Parity test. These vectors are the same list asserted by the backend suite
 * (backend/tests/privacy/publicationRenderer.test.ts). The manuscript preview
 * and the .docx export must never show different sentences, so both renderers
 * are held to one set of expectations.
 */
const RENDER_VECTORS: Array<[string, string]> = [
  ['[PATIENT_NAME_1] 환자는 3개월 전부터 견비통을 호소하였다.', '환자는 3개월 전부터 견비통을 호소하였다.'],
  ['[PATIENT_NAME_1]의 증상은 호전되었다.', '환자의 증상은 호전되었다.'],
  ['[PATIENT_NAME_1]에게 침치료를 시행하였다.', '환자에게 침치료를 시행하였다.'],
  ['[PATIENT_NAME_1]은 내원하였다.', '환자는 내원하였다.'],
  ['[PATIENT_NAME_1]이 호전되었다.', '환자가 호전되었다.'],
  ['[PATIENT_NAME_1]을 진찰하였다.', '환자를 진찰하였다.'],
  ['[PATIENT_NAME_1] 환자의 경과를 관찰하였다.', '환자의 경과를 관찰하였다.'],
  ['[PATIENT_NAME_1] 환자에게 설명하였다.', '환자에게 설명하였다.'],
  ['[HOSPITAL_1]에서 진단받았다.', '타 의료기관에서 진단받았다.'],
  ['환자는 [HOSPITAL_1]에서 MRI 검사를 시행하였다.', '환자는 타 의료기관에서 MRI 검사를 시행하였다.'],
  ['[HOSPITAL_1]는 상급 기관이다.', '타 의료기관은 상급 기관이다.'],
  [
    '[PATIENT_NAME_1] 환자는 [HOSPITAL_1]에서 보존적 치료를 받았으나 증상이 지속되어 본원에 내원하였다.',
    '환자는 타 의료기관에서 보존적 치료를 받았으나 증상이 지속되어 본원에 내원하였다.'
  ],
  ['[DOCTOR_NAME_1]이 진료하였다.', '의료진이 진료하였다.'],
  ['환자는 견비통을 주소로 내원하였다.', '환자는 견비통을 주소로 내원하였다.'],
  ['', '']
];

for (const [input, expected] of RENDER_VECTORS) {
  const actual = renderClinicalAnonymizedText(input);
  assert.equal(actual, expected, `\n  input   : ${input}\n  expected: ${expected}\n  actual  : ${actual}`);
}

const messy = '[PATIENT_NAME_2] 환자는 [HOSPITAL_3]에서 [DATE_1]에 진단받았고 [EMAIL_1] 로 회신하였다.';
assert.deepEqual(findRemainingPlaceholders(renderClinicalAnonymizedText(messy)), []);

console.log(`frontend publication renderer parity: ${RENDER_VECTORS.length} vectors passed`);
