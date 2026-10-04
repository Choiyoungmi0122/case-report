import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import { exportCaseToDocx } from '../../src/export/docxExporter';

/**
 * The exported .docx must never contain an internal privacy token. This builds a
 * case whose canonical text is full of placeholders, exports it, and inspects
 * the real document XML.
 */

const PLACEHOLDER_PREFIXES = [
  '[PATIENT_NAME_',
  '[HOSPITAL_',
  '[PHONE_',
  '[PATIENT_ID_',
  '[EMAIL_',
  '[ADDRESS_',
  '[DOCTOR_NAME_',
  '[RESIDENT_ID_'
];

/** Reads the real visible text out of the generated document. */
async function extractDocumentText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function buildCase(): any {
  const canonical =
    '[PATIENT_NAME_1] 환자는 [HOSPITAL_1]에서 보존적 치료를 받았으나 증상이 지속되어 본원에 내원하였다. ' +
    '연락처는 [PHONE_1]이다. 등록번호는 [PATIENT_ID_1]이다.';

  return {
    id: 'case_docx_placeholder_test',
    createdAt: new Date(0).toISOString(),
    mode: 'write',
    title: '[PATIENT_NAME_1] 환자의 견비통 증례',
    visits: [],
    evidenceCards: [
      {
        id: 'ev1',
        visitIndex: 1,
        visitDateTime: '2026-03-02',
        sourceText: '[PATIENT_NAME_1] 환자 어깨 통증',
        normalizedText: '[PATIENT_NAME_1] 환자 어깨 통증',
        tags: ['CLINICAL_FINDINGS']
      }
    ],
    sectionStates: [
      { sectionId: 'CLINICAL_FINDINGS', status: 'READY', rationaleText: '충분함', missingInfoBullets: [], recommendedQuestions: [] }
    ],
    sectionDrafts: [
      { sectionId: 'PATIENT_INFORMATION', draftText: canonical, evidenceCardIdsUsed: [], openIssues: [], evidenceLinks: [], unsupportedClaims: [] },
      { sectionId: 'CLINICAL_FINDINGS', draftText: canonical, evidenceCardIdsUsed: [], openIssues: [], evidenceLinks: [], unsupportedClaims: [] }
    ],
    draftsBySection: {
      PATIENT_INFORMATION: canonical,
      CLINICAL_FINDINGS: canonical
    },
    finalDraft: {
      fullTextBySection: {
        TITLE: '[PATIENT_NAME_1] 환자의 견비통 증례',
        PATIENT_INFORMATION: canonical,
        CLINICAL_FINDINGS: canonical,
        DISCUSSION_CONCLUSION: '[HOSPITAL_1]에서의 경과를 고려하면 의미가 있다.'
      },
      titleSuggestions: ['[PATIENT_NAME_1] 환자의 증례'],
      keywordSuggestions: ['견비통'],
      abstractSuggestion: '[PATIENT_NAME_1] 환자는 견비통으로 내원하였다.',
      sectionTraceability: {},
      careChecklistEvaluation: {}
    },
    scaffoldState: null,
    timelineEvents: []
  };
}

async function assertNoPlaceholders(mode: string) {
  const result = await exportCaseToDocx(buildCase(), mode as any, 'one_paragraph');
  const content = await extractDocumentText(result.buffer);

  assert.ok(content.trim().length > 0, `${mode}: export produced an empty document`);

  for (const prefix of PLACEHOLDER_PREFIXES) {
    assert.ok(
      !content.includes(prefix),
      `${mode}: exported .docx still contains ${prefix}`
    );
  }

  // The publication phrasing must actually be there, not just the token removed.
  if (mode !== 'current_section_drafts') {
    assert.ok(content.includes('환자'), `${mode}: expected the 환자 label in the output`);
    assert.ok(
      content.includes('타 의료기관'),
      `${mode}: expected hospital placeholders to render as 타 의료기관`
    );
  }

  console.log(`  ${mode}: no placeholder token, ${content.length} chars of text`);
}

async function run() {
  console.log('docx placeholder absence:');
  await assertNoPlaceholders('final_manuscript');
  await assertNoPlaceholders('current_section_drafts');
  await assertNoPlaceholders('final_manuscript_with_traceability');
  console.log('docx placeholder tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
