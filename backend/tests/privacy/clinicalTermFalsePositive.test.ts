import assert from 'node:assert/strict';
import { deidentifyEMR } from '../../src/deid';
import { getClinicalVocabularySize, isKnownClinicalTerm } from '../../src/deid/clinicalVocabulary';

/**
 * Clinical vocabulary must survive de-identification; real names must not.
 *
 * The name rule matches "2-4 Hangul characters followed by 환자", which fits
 * "견비통 환자" exactly as well as "홍길동 환자". Suppression therefore requires
 * positive evidence that the token is clinical vocabulary. Everything unknown
 * stays redacted, so the failure direction is over-redaction, never a leak.
 */

const CLINICAL_TERMS = [
  '견비통', '요통', '두통', '현훈', '오심', '구토', '불면', '소화불량',
  '상복부통', '슬통', '경항통', '요각통', '비증', '담음', '기허', '혈허',
  '어혈', '간기울결'
];

const SYNTHETIC_NAMES = ['홍길동', '김민수', '박지훈', '이영희', '최영수'];

async function assertClinicalTermsSurvive() {
  const failures: string[] = [];

  for (const term of CLINICAL_TERMS) {
    assert.ok(isKnownClinicalTerm(term), `${term} should be recognised clinical vocabulary`);

    const result = await deidentifyEMR(`${term} 환자는 3개월 전부터 증상을 호소하였다.`);
    if (!result.deidentifiedText.includes(term)) {
      failures.push(term);
    }
  }

  assert.deepEqual(failures, [], `clinical terms were redacted as names: ${failures.join(', ')}`);
  console.log(`  ${CLINICAL_TERMS.length}/${CLINICAL_TERMS.length} clinical terms preserved`);
}

async function assertNamesStillRedacted() {
  const leaks: string[] = [];

  // Contexts the name rules cover directly.
  const directContexts = (name: string) => [
    `${name} 환자는 내원하였다.`,
    `${name} 환자의 증상은 호전되었다.`,
    `환자 ${name}은 호전되었다.`,
    `성명: ${name}`,
    `환자명: ${name}`,
    `${name} 씨는 통증을 호소하였다.`
  ];

  for (const name of SYNTHETIC_NAMES) {
    for (const sentence of directContexts(name)) {
      const result = await deidentifyEMR(sentence);
      if (result.deidentifiedText.includes(name)) leaks.push(sentence);
    }
  }

  assert.deepEqual(leaks, [], `real names leaked: ${leaks.join(' | ')}`);
  console.log(`  ${SYNTHETIC_NAMES.length} names x ${directContexts('x').length} contexts: 0 leak`);
}

/**
 * A later bare mention ("홍길동에게 침치료를 시행하였다") carries no contextual
 * marker of its own. Document-level propagation covers it once the name has been
 * confirmed anywhere in the same record.
 */
async function assertPropagationCoversBareMentions() {
  for (const name of SYNTHETIC_NAMES) {
    const record = [
      `성명: ${name}`,
      `S: ${name} 환자는 견비통을 주소로 내원하였다. ${name}에게 침치료를 시행하였다.`,
      `A: ${name}의 증상은 호전되었다.`
    ].join('\n');

    const result = await deidentifyEMR(record);
    assert.ok(
      !result.deidentifiedText.includes(name),
      `bare mention of ${name} survived: ${result.deidentifiedText}`
    );
    assert.ok(result.deidentifiedText.includes('견비통'), 'clinical term must survive in the same record');
  }
  console.log('  bare later mentions covered by document-level propagation');
}

async function assertMixedSentence() {
  const result = await deidentifyEMR('홍길동 환자는 견비통을 주소로 테스트한방병원에 내원하였다.');
  assert.ok(!result.deidentifiedText.includes('홍길동'), 'name must be redacted');
  assert.ok(!result.deidentifiedText.includes('테스트한방병원'), 'hospital must be redacted');
  assert.ok(result.deidentifiedText.includes('견비통'), 'clinical term must survive');
  assert.match(result.deidentifiedText, /\[PATIENT_NAME_\d+\]/);
  assert.match(result.deidentifiedText, /\[HOSPITAL_\d+\]/);
  console.log(`  mixed sentence -> ${result.deidentifiedText}`);
}


/**
 * A real record names the patient in the initial note and refers to them bare in
 * the follow-ups. Per-visit rules cannot match those later mentions, so
 * de-identification must carry confirmed identifiers across every visit of the
 * case - otherwise the name reaches evidence cards and the external model.
 */
async function assertCaseLevelPropagation() {
  const { deidentifyCaseEMRs } = await import('../../src/deid');

  const records = await deidentifyCaseEMRs([
    { text: 'S: 홍길동 환자는 45세 남성으로 견비통으로 내원하였다. 테스트한방병원을 거쳐 왔다.' },
    { text: 'S: 홍길동에게 가동범위 운동을 교육하였다. 야간통 감소. 요통 없음.' },
    { text: 'S: 홍길동 재평가. 테스트한방병원 소견서 확인. 견비통 호전.' }
  ]);

  const combined = records.map((r) => r.deidentifiedText).join('\n');
  assert.ok(!combined.includes('홍길동'), `name survived in a later visit: ${combined}`);
  assert.ok(!combined.includes('테스트한방병원'), 'hospital survived in a later visit');
  assert.ok(combined.includes('견비통') && combined.includes('요통'), 'clinical terms must survive');

  // The same person must map to one placeholder across the whole case.
  const namePlaceholders = combined.match(/\[PATIENT_NAME_\d+\]/g) || [];
  assert.ok(namePlaceholders.length >= 3, 'every mention should be replaced');
  assert.ok(
    namePlaceholders.every((p) => p === namePlaceholders[0]),
    `one person must map to one placeholder, saw ${[...new Set(namePlaceholders)].join(',')}`
  );
  console.log(`  case-level propagation: 3 visits, 0 leak, single placeholder ${namePlaceholders[0]}`);
}

async function run() {
  console.log(`clinical term false positives (vocabulary size ${getClinicalVocabularySize()}):`);
  await assertClinicalTermsSurvive();
  await assertNamesStillRedacted();
  await assertPropagationCoversBareMentions();
  await assertMixedSentence();
  await assertCaseLevelPropagation();
  console.log('clinical term tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
