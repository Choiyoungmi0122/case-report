import assert from 'node:assert/strict';
import { preprocessVisitsForChain1 } from '../../src/llm/chains';
import { deidentifyCaseEMRs, deidentifyEMR } from '../../src/deid';
import { evaluateDeidentificationRisk } from '../../src/deid/detector';
import { applyPlaceholderReplacement } from '../../src/deid/replacer';

const PATIENT_NAME = '\uAE40\uCCA0\uC218';
const HOSPITAL = '\uB3D9\uC758\uB300\uBCD1\uC6D0';
const GUIBI_TANG = '\uADC0\uBE44\uD0D5';
const GUIBI = '\uADC0\uBE44';

async function run() {
  const named = await deidentifyEMR(`${PATIENT_NAME} \uD658\uC790\uB294 2024\uB144 3\uC6D4 2\uC77C ${HOSPITAL}\uC5D0 \uB0B4\uC6D0\uD558\uC600\uB2E4.`);
  assert.ok(named.deidentifiedText.includes('[PATIENT_NAME_1]'));
  assert.ok(named.deidentifiedText.includes('[DATE_1]'));
  assert.ok(named.deidentifiedText.includes('[HOSPITAL_1]'));

  const phone = await deidentifyEMR('\uC5F0\uB77D\uCC98\uB294 010-1234-5678 \uC785\uB2C8\uB2E4.');
  assert.ok(phone.deidentifiedText.includes('[PHONE_1]'));

  const hospital = await deidentifyEMR(`\uD658\uC790\uB294 ${HOSPITAL}\uC5D0\uC11C \uAC80\uC0AC \uD6C4 ${GUIBI_TANG}\uC744 \uBCF5\uC6A9\uD558\uC600\uB2E4.`);
  assert.ok(hospital.deidentifiedText.includes('[HOSPITAL_1]'));
  assert.ok(hospital.deidentifiedText.includes(GUIBI_TANG));

  const consistent = await deidentifyEMR(`${PATIENT_NAME} \uD658\uC790 \uC774\uD6C4 ${PATIENT_NAME} \uB77C\uACE0 \uC790\uC2E0\uC744 \uC18C\uAC1C\uD558\uC600\uB2E4.`);
  const replacementEntries = consistent.replacementMap.filter((item) => item.type === 'PATIENT_NAME');
  assert.ok(replacementEntries.length >= 1);
  // Both mentions of the same name must be replaced, and by the SAME placeholder.
  // The second mention carries no contextual marker of its own, so it is covered
  // by document-level propagation; before that pass it survived in the output.
  const nameEntry = replacementEntries.find((item) => item.originalText === PATIENT_NAME);
  assert.ok(nameEntry, 'the patient name should have its own replacement entry');
  assert.equal(nameEntry!.occurrences, 2);
  assert.ok(
    !consistent.deidentifiedText.includes(PATIENT_NAME),
    'no mention of the name may survive de-identification'
  );

  const contextualPatientWord = await deidentifyEMR('\uC81C3\uCC28 \uBC29\uBB38\uC5D0\uC11C \uD658\uC790\uB294 \uC218\uBA74 \uD638\uC804\uC744 \uBCF4\uACE0\uD558\uC600\uB2E4.');
  assert.ok(!contextualPatientWord.deidentifiedText.includes('[PATIENT_NAME_1]'));

  const preserve = await deidentifyEMR(`${GUIBI_TANG} \uBCF5\uC6A9 \uD6C4 PHQ-9 \uC810\uC218\uAC00 \uAC10\uC18C\uD558\uC600\uB2E4.`);
  assert.ok(preserve.deidentifiedText.includes(GUIBI_TANG));
  assert.ok(preserve.deidentifiedText.includes('PHQ-9'));

  const mixed = await deidentifyEMR(
    `${PATIENT_NAME} \uD658\uC790\uB294 2024\uB144 3\uC6D4 2\uC77C ${HOSPITAL}\uC5D0\uC11C ${GUIBI_TANG} \uBCF5\uC6A9 \uD6C4 PHQ-9 \uD3C9\uAC00\uB97C \uC2DC\uD589\uD558\uC600\uB2E4.`
  );
  assert.ok(mixed.deidentifiedText.includes('[PATIENT_NAME_1]'));
  assert.ok(mixed.deidentifiedText.includes('[DATE_1]'));
  assert.ok(mixed.deidentifiedText.includes('[HOSPITAL_1]'));
  assert.ok(mixed.deidentifiedText.includes(GUIBI_TANG));
  assert.ok(mixed.deidentifiedText.includes('PHQ-9'));

  assert.equal(evaluateDeidentificationRisk('\uC5EC\uAE30 \uC5F0\uB77D\uCC98 010-9999-1111', []), 'HIGH');
  assert.equal(
    evaluateDeidentificationRisk('\uC5EC\uAE30 \uD14D\uC2A4\uD2B8', [
      {
        type: 'OTHER',
        originalText: '\uBAA8\uD638\uD55C \uAC1C\uCCB4',
        replacement: '[OTHER_1]',
        startIndex: 0,
        endIndex: 5,
        confidence: 0.62
      }
    ]),
    'MEDIUM'
  );

  // A HIGH-risk evaluation must not leave a lastIndex behind on the shared /g rule regexes,
  // otherwise the next document is scanned from the middle and leading PHI survives.
  assert.equal(evaluateDeidentificationRisk('연락처 010-1234-5678 남음', []), 'HIGH');
  const afterHighRisk = await deidentifyEMR('010-9999-8888 로 연락 바랍니다.');
  assert.ok(afterHighRisk.deidentifiedText.includes('[PHONE_1]'));
  assert.ok(!afterHighRisk.deidentifiedText.includes('010-9999-8888'));

  // Overlapping spans from different rule groups must collapse to one placeholder and must never
  // rewind the write cursor (which would re-emit the original text).
  const overlapping = await deidentifyEMR('환자는 2024년 1월 2일에 내원하였다.');
  assert.ok(overlapping.deidentifiedText.includes('[DATE_1]'));
  assert.ok(!overlapping.deidentifiedText.includes('[DATE_2]'));
  assert.equal(overlapping.deidentifiedText, '환자는 [DATE_1]에 내원하였다.');

  // originalText containing ':' must survive the replacement-map round trip.
  const colonSpans = applyPlaceholderReplacement('id A:1 here', [
    {
      type: 'PATIENT_ID',
      originalText: 'A:1',
      replacement: '',
      startIndex: 3,
      endIndex: 6,
      confidence: 0.93
    }
  ]);
  assert.equal(colonSpans.replacementMap[0]?.originalText, 'A:1');

  const preprocessed = await preprocessVisitsForChain1([
    {
      index: 1,
      date: '2024-03-02',
      text: `${PATIENT_NAME} \uD658\uC790\uB294 ${GUIBI} \uBCF5\uC6A9 \uD6C4 PHQ-9 \uD3C9\uAC00\uB97C \uC2DC\uD589\uD558\uC600\uB2E4.`
    }
  ]);
  assert.equal(preprocessed.reviewRequired, null);
  assert.ok(preprocessed.deidentifiedEMRs[0]?.deidentifiedText.includes('[PATIENT_NAME_1]'));
  assert.equal(preprocessed.pendingTermConfirmations.length, 1);
  assert.equal(preprocessed.pendingTermConfirmations[0]?.status, 'PENDING');
  assert.ok((preprocessed.pendingTermConfirmations[0]?.candidates || []).length >= 2);

  const shared = await deidentifyCaseEMRs([
    { text: `${PATIENT_NAME} 환자가 ${HOSPITAL}에 내원하였다.` },
    { text: `${PATIENT_NAME} 환자가 ${HOSPITAL}에 재내원하였다.` }
  ]);
  assert.ok(shared[0]?.deidentifiedText.includes('[PATIENT_NAME_1]'));
  assert.ok(shared[0]?.deidentifiedText.includes('[HOSPITAL_1]'));
  assert.ok(shared[1]?.deidentifiedText.includes('[PATIENT_NAME_1]'));
  assert.ok(shared[1]?.deidentifiedText.includes('[HOSPITAL_1]'));

  console.log('deid tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
