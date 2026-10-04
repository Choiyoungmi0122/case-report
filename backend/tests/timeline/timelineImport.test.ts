import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parseTimelineWorkbook } from '../../src/timelineImport/parser';
import { integrateImportedTimelineIntoDrafts } from '../../src/timelineImport/integration';
import { exportCaseToDocx, buildTimelineTableRowsFromEvents } from '../../src/export/docxExporter';
import { CareSection, Case } from '../../src/types';

function makeWorkbookBuffer(rows: Array<Record<string, unknown>>) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Timeline');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function extractRawText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\s+/g, ' ').trim();
}

function createBaseCase(): Case {
  return {
    id: 'case_timeline_import_test',
    createdAt: new Date().toISOString(),
    title: 'Timeline import case',
    visits: [],
    timelineEvents: [],
    draftsBySection: {
      [CareSection.TITLE]: 'Timeline import case',
      [CareSection.TIMELINE]: '초기 타임라인 문장'
    } as any,
    evidenceCards: [],
    sectionStates: [
      {
        sectionId: CareSection.TIMELINE,
        status: 'INCOMPLETE',
        rationaleText: 'Timeline needs refinement.',
        missingInfoBullets: [],
        recommendedQuestions: []
      }
    ] as any,
    commonMissingItems: [],
    commonQuestionSets: [],
    sectionDrafts: [
      {
        sectionId: CareSection.TIMELINE,
        evidenceCardIdsUsed: [],
        timelineEventIdsUsed: [],
        draftText: '초기 타임라인 문장',
        openIssues: [],
        evidenceLinks: [],
        unsupportedClaims: []
      }
    ] as any
  };
}

async function run() {
  const englishBuffer = makeWorkbookBuffer([
    {
      date: '2024-03-02',
      visit_no: '1',
      symptom: '가슴 답답함',
      test: 'PHQ9',
      diagnosis: '불안 의심',
      treatment: '귀비탕',
      outcome: '수면 호전',
      note: '초진'
    },
    {
      date: '2024-03-16',
      visit_no: '2',
      symptom: '상열감 감소',
      test: 'GAD-7',
      diagnosis: '경과 관찰',
      treatment: '침 치료',
      outcome: '전반적 호전',
      note: '재진'
    }
  ]);

  const englishResult = parseTimelineWorkbook(englishBuffer);
  assert.equal(englishResult.importedRows, 2);
  assert.equal(englishResult.skippedRows, 0);
  assert.equal(englishResult.timelineEvents[0]?.source, 'excel_import');
  assert.equal(englishResult.timelineEvents[0]?.test, 'PHQ9');

  const koreanBuffer = makeWorkbookBuffer([
    {
      시점: '2024-03-02',
      방문차수: '1',
      '주요 증상': '불면',
      '검사/평가': 'GAD－7',
      '진단/판단': '불면증',
      치료: '가미귀비탕',
      경과: '개선',
      비고: '초진'
    }
  ]);

  const koreanResult = parseTimelineWorkbook(koreanBuffer);
  assert.equal(koreanResult.importedRows, 1);
  assert.equal(koreanResult.columnMapping.symptom, '주요 증상');
  assert.equal(koreanResult.timelineEvents[0]?.treatment, '가미귀비탕');
  assert.equal(koreanResult.timelineEvents[0]?.test, 'GAD-7');

  const malformedBuffer = makeWorkbookBuffer([
    {
      date: '',
      visit_no: '',
      symptom: '',
      test: '',
      diagnosis: '',
      treatment: '',
      outcome: '',
      note: ''
    },
    {
      date: 'not-a-date',
      visit_no: '3',
      symptom: '피로',
      test: '',
      diagnosis: '',
      treatment: '',
      outcome: '',
      note: ''
    }
  ]);

  const malformedResult = parseTimelineWorkbook(malformedBuffer);
  assert.equal(malformedResult.importedRows, 1);
  assert.equal(malformedResult.skippedRows, 1);
  assert.ok(
    malformedResult.warnings.some((warning) => warning.reason.includes('Invalid date value')),
    'invalid date warning should be included'
  );

  const caseData = createBaseCase();
  caseData.timelineEvents = englishResult.timelineEvents as any;

  const integrated = integrateImportedTimelineIntoDrafts({
    sectionDrafts: caseData.sectionDrafts as any[],
    sectionStates: caseData.sectionStates as any[],
    timelineEvents: caseData.timelineEvents as any[]
  });

  const timelineDraft = integrated.sectionDrafts.find((draft) => draft.sectionId === CareSection.TIMELINE);
  assert.ok(timelineDraft?.draftText.includes('가져온 타임라인'));
  assert.ok(timelineDraft?.draftText.includes('경과가 추적 관찰되었다'));
  assert.equal(timelineDraft?.timelineEventIdsUsed?.length, 2);

  const integratedAgain = integrateImportedTimelineIntoDrafts({
    sectionDrafts: integrated.sectionDrafts as any[],
    sectionStates: integrated.sectionStates as any[],
    timelineEvents: caseData.timelineEvents as any[]
  });
  const timelineDraftAgain = integratedAgain.sectionDrafts.find(
    (draft) => draft.sectionId === CareSection.TIMELINE
  );
  assert.equal(
    (timelineDraftAgain?.draftText.match(/가져온 타임라인/g) || []).length,
    1,
    'imported timeline block should not be duplicated after repeated integration'
  );

  const rowsFromEvents = buildTimelineTableRowsFromEvents(caseData.timelineEvents);
  assert.equal(rowsFromEvents?.rows.length, 2);
  assert.equal(rowsFromEvents?.rows[0]?.[0], '2024-03-02');

  const exportCase: Case = {
    ...caseData,
    sectionDrafts: integrated.sectionDrafts as any,
    sectionStates: integrated.sectionStates as any,
    finalDraft: {
      fullTextBySection: {
        [CareSection.TITLE]: 'Timeline import case',
        [CareSection.TIMELINE]:
          '초진부터 재진까지의 경과가 추적 관찰되었고, 주요 증상은 점진적으로 완화되는 양상을 보였다.'
      },
      titleSuggestions: ['Timeline import case'],
      abstractSuggestion: '',
      careChecklistEvaluation: {
        [CareSection.TIMELINE]: {
          status: 'FULFILLED',
          rationale: 'Timeline imported from Excel.'
        }
      }
    } as any
  };

  const exported = await exportCaseToDocx(exportCase, 'final_manuscript');
  const exportedText = await extractRawText(exported.buffer);
  assert.match(exportedText, /추적 관찰되었고/);
  assert.doesNotMatch(exportedText, /Imported timeline table/);

  console.log('timeline import tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
