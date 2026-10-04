import assert from 'node:assert/strict';
import {
  assertOutboundTextIsSafe,
  createOutboundDeidContext,
  deidentifyDraftsForOutbound,
  deidentifyOutboundField,
  deidentifyOutboundText,
  deidentifyQnaForOutbound,
  deidentifyQnaMapForOutbound,
  deidentifyTimelineEventsForOutbound,
  findHighRiskIdentifierFindings,
  findHighRiskIdentifierTypes,
  OutboundPrivacyError
} from '../../src/deid/outbound';

/** Obvious dummy identifiers. No real patient data is used anywhere in the suite. */
const DUMMY = {
  name: '홍길동',
  hospital: '테스트한방병원',
  phone: '010-0000-0000',
  chartNo: 'TEST-12345'
};
const DUMMY_VALUES = Object.values(DUMMY);

function leaks(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return DUMMY_VALUES.filter((item) => text.includes(item));
}

function hasPlaceholder(text: string): boolean {
  return /\[[A-Z][A-Z_]*_\d+\]/.test(text);
}

async function run() {
  /* ---------------------------------------------------------------- */
  /* 1. free-text de-identification                                     */
  /* ---------------------------------------------------------------- */
  const answer = `${DUMMY.name} 환자는 ${DUMMY.hospital}에서 촬영했고 연락처는 ${DUMMY.phone}, 등록번호 ${DUMMY.chartNo} 입니다.`;
  const deidAnswer = await deidentifyOutboundText(answer);
  assert.equal(leaks(deidAnswer.text).length, 0, 'free-text answer must not leak any dummy identifier');
  assert.ok(hasPlaceholder(deidAnswer.text), 'placeholders must replace the removed identifiers');
  assert.ok(deidAnswer.phiCount > 0);

  /* ---------------------------------------------------------------- */
  /* 2. idempotency — re-processing must not corrupt or renumber        */
  /* ---------------------------------------------------------------- */
  const secondPass = await deidentifyOutboundText(deidAnswer.text);
  assert.equal(
    secondPass.text,
    deidAnswer.text,
    'de-identifying already de-identified text must be a no-op'
  );
  assert.equal(secondPass.phiCount, 0, 'existing placeholders must not be re-detected as PHI');

  const thirdPass = await deidentifyOutboundText(secondPass.text);
  assert.equal(thirdPass.text, deidAnswer.text, 'repeated passes must remain stable');

  /* ---------------------------------------------------------------- */
  /* 3. shared context keeps one identifier on one placeholder          */
  /* ---------------------------------------------------------------- */
  const shared = createOutboundDeidContext();
  const a = await deidentifyOutboundField(`${DUMMY.name} 환자 초진`, shared);
  const b = await deidentifyOutboundField(`${DUMMY.name} 환자 재진`, shared);
  const placeholderA = (a.match(/\[PATIENT_NAME_\d+\]/) || [])[0];
  const placeholderB = (b.match(/\[PATIENT_NAME_\d+\]/) || [])[0];
  assert.ok(placeholderA && placeholderB, 'both strings should carry a name placeholder');
  assert.equal(placeholderA, placeholderB, 'the same person must map to the same placeholder');

  /* ---------------------------------------------------------------- */
  /* 4. Q&A history, drafts, qna maps                                   */
  /* ---------------------------------------------------------------- */
  const qna = await deidentifyQnaForOutbound([
    { question: `${DUMMY.name} 환자의 증상은?`, answer: `${DUMMY.hospital}에서 확인했습니다.` }
  ]);
  assert.equal(leaks(qna).length, 0, 'qna history must not leak');

  const drafts = await deidentifyDraftsForOutbound([
    { sectionId: 'TITLE', draftText: `${DUMMY.name} 환자의 증례`, evidenceCardIdsUsed: ['ev1'] } as any
  ]);
  assert.equal(leaks(drafts).length, 0, 'section drafts must not leak');
  assert.deepEqual((drafts[0] as any).evidenceCardIdsUsed, ['ev1'], 'non-text fields must survive');

  const qnaMap = await deidentifyQnaMapForOutbound({
    CLINICAL_FINDINGS: [{ question: '어디서?', answer: `${DUMMY.hospital}` }]
  });
  assert.equal(leaks(qnaMap).length, 0, 'qna map must not leak');

  /* ---------------------------------------------------------------- */
  /* 5. timeline rows                                                   */
  /* ---------------------------------------------------------------- */
  const timeline = await deidentifyTimelineEventsForOutbound([
    {
      timelineEventId: 'evt1',
      originalRowIndex: 2,
      date: '2026-03-02',
      symptom: `${DUMMY.name} 환자 어깨 통증`,
      note: `${DUMMY.hospital} 방문, 연락처 ${DUMMY.phone}`,
      // Bare cell values under identifying headers - the header supplies the context.
      cells: { 환자명: DUMMY.name, 등록번호: DUMMY.chartNo, 병원: DUMMY.hospital }
    }
  ]);
  assert.equal(leaks(timeline).length, 0, 'timeline rows must not leak');
  assert.equal(timeline[0].timelineEventId, 'evt1', 'structural fields must survive');
  assert.equal(timeline[0].originalRowIndex, 2);
  assert.equal(timeline[0].date, '2026-03-02', 'visit dates are intentionally preserved for chronology');
  assert.ok(
    hasPlaceholder(timeline[0].cells['환자명']),
    'a bare name under a 환자명 header must be replaced using the header as context'
  );
  assert.deepEqual(
    Object.keys(timeline[0].cells),
    ['환자명', '등록번호', '병원'],
    'column headers must be preserved'
  );

  /* ---------------------------------------------------------------- */
  /* 6. outbound guard blocks high-risk residuals                       */
  /* ---------------------------------------------------------------- */
  assert.deepEqual(findHighRiskIdentifierTypes(`연락처 ${DUMMY.phone}`), ['PHONE']);
  assert.deepEqual(
    findHighRiskIdentifierTypes(`evidence-id timeline-cell-${DUMMY.phone}-symptom`),
    [],
    'phone-like numeric chunks inside generated ids must not block an outbound prompt'
  );
  assert.deepEqual(findHighRiskIdentifierTypes('test@example.com'), ['EMAIL']);
  assert.ok(findHighRiskIdentifierTypes('900101-1234567').includes('RESIDENT_ID'));
  assert.deepEqual(findHighRiskIdentifierTypes(deidAnswer.text), [], 'clean text must pass the guard');
  const phoneFindings = findHighRiskIdentifierFindings(`연락처 ${DUMMY.phone}`);
  assert.equal(phoneFindings[0]?.rule, 'PHONE_REGEX');
  assert.equal(phoneFindings[0]?.type, 'PHONE');
  assert.ok(phoneFindings[0]?.matchPreview);
  assert.ok(!phoneFindings[0]?.matchPreview.includes(DUMMY.phone));

  assert.throws(
    () => assertOutboundTextIsSafe(`연락처 ${DUMMY.phone}`, 'TEST chain'),
    (error: unknown) => {
      assert.ok(error instanceof OutboundPrivacyError);
      assert.equal((error as OutboundPrivacyError).code, 'outbound_privacy_block');
      assert.equal((error as OutboundPrivacyError).findings[0]?.rule, 'PHONE_REGEX');
      // The error must name the identifier TYPE but never the value itself.
      assert.equal(leaks((error as Error).message).length, 0);
      return true;
    }
  );

  assert.doesNotThrow(() => assertOutboundTextIsSafe(deidAnswer.text, 'TEST chain'));

  /* ---------------------------------------------------------------- */
  /* 7. clinical vocabulary must survive de-identification              */
  /* ---------------------------------------------------------------- */
  const clinical = await deidentifyOutboundText(
    '우측 견관절 능동 외전 90도에서 통증. Neer test 양성. 활혈지통탕 처방. VAS 7/10.'
  );
  assert.ok(clinical.text.includes('견관절'), 'clinical terms must not be stripped');
  assert.ok(clinical.text.includes('Neer test'), 'test names must not be stripped');
  assert.ok(clinical.text.includes('활혈지통탕'), 'herbal formula names must not be stripped');
  assert.ok(clinical.text.includes('VAS 7/10'), 'scores must not be stripped');

  /* ---------------------------------------------------------------- */
  /* 8. empty / nullish input                                           */
  /* ---------------------------------------------------------------- */
  assert.equal((await deidentifyOutboundText('')).text, '');
  assert.equal(await deidentifyOutboundField(undefined), '');
  assert.equal(await deidentifyOutboundField(null), '');
  assert.deepEqual(await deidentifyTimelineEventsForOutbound([]), []);
  assert.doesNotThrow(() => assertOutboundTextIsSafe('', 'TEST chain'));

  console.log('outbound boundary tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
