import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import {
  exportCaseToDocx,
  buildTimelineTableRows,
  buildTimelineTableRowsFromEvents
} from '../../src/export/docxExporter';
import { extractDocxContent } from '../../src/manuscriptReview/parser';
import { CareSection, Case } from '../../src/types';

async function extractRawText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.replace(/\s+/g, ' ').trim();
}

function createMockCase(): Case {
  return {
    id: 'case_export_test',
    createdAt: new Date().toISOString(),
    title: '귀비탕 치료 증례보고',
    visits: [],
    timelineEvents: [
      {
        timelineEventId: 'timeline_1',
        date: '2024-03-02',
        visitNo: '1',
        symptom: '불면',
        test: 'PHQ-9',
        diagnosis: '불면증',
        treatment: '귀비탕',
        outcome: '수면 호전',
        note: '초진',
        source: 'excel_import',
        importedAt: new Date().toISOString(),
        originalRowIndex: 2
      },
      {
        timelineEventId: 'timeline_2',
        date: '2024-03-16',
        visitNo: '2',
        symptom: '가슴 답답함 감소',
        test: 'GAD-7',
        diagnosis: '경과 관찰',
        treatment: '침 치료',
        outcome: '전반적 호전',
        note: '재진',
        source: 'excel_import',
        importedAt: new Date().toISOString(),
        originalRowIndex: 3
      }
    ],
    draftsBySection: {
      [CareSection.TITLE]: '귀비탕 치료 증례보고',
      KEYWORDS: 'case report, 귀비탕, PHQ-9',
      [CareSection.ABSTRACT]: '환자 관찰 기록 한글 문단이 포함된 초록입니다.',
      [CareSection.INTRODUCTION]: '본 증례보고는 CARE guideline에 따라 작성되었다.',
      [CareSection.PATIENT_INFORMATION]: '49세 여성 환자가 불면을 호소하였다.',
      [CareSection.CLINICAL_FINDINGS]: '환자 관찰 기록 한글 문단: 불안과 수면장애가 관찰되었다.',
      [CareSection.TIMELINE]: '2024년 3월 2일 초진 후 귀비탕 복용. 2주 후 수면이 호전되었다.',
      [CareSection.DIAGNOSTIC_ASSESSMENT]: 'PHQ-9와 GAD-7 결과를 참고하였다.',
      [CareSection.THERAPEUTIC_INTERVENTIONS]: '귀비탕 복용과 침 치료를 시행하였다.',
      [CareSection.FOLLOW_UP_OUTCOMES]: '수면의 질이 호전되었고 부작용은 없었다.',
      [CareSection.DISCUSSION_CONCLUSION]: '귀비탕과 침 치료가 임상적으로 유의미할 수 있다.',
      [CareSection.PATIENT_PERSPECTIVE]: '환자는 이전보다 편안하다고 진술하였다.',
      [CareSection.INFORMED_CONSENT]: '서면 동의를 획득하였다.'
    } as any,
    evidenceCards: [
      {
        id: 'evidence_1',
        visitIndex: 1,
        visitDateTime: '2024-03-02',
        sourceText: '귀비탕 복용 후 수면이 호전되었다.',
        normalizedText: '귀비탕 복용 후 수면이 호전되었다.',
        tags: [CareSection.THERAPEUTIC_INTERVENTIONS, CareSection.FOLLOW_UP_OUTCOMES],
        sectionHints: [CareSection.THERAPEUTIC_INTERVENTIONS, CareSection.FOLLOW_UP_OUTCOMES],
        terms: [
          {
            surface: '귀비탕',
            normalizedTerm: '귀비탕',
            termId: 'term_001',
            category: 'herbal_prescription',
            matchType: 'exact',
            confidence: 0.99,
            needsUserConfirmation: false
          }
        ],
        confidence: 0.98
      }
    ] as any,
    sectionStates: [],
    commonMissingItems: [],
    commonQuestionSets: [],
    sectionDrafts: [
      {
        sectionId: CareSection.THERAPEUTIC_INTERVENTIONS,
        evidenceCardIdsUsed: ['evidence_1'],
        draftText: '귀비탕 복용과 침 치료를 시행하였다.',
        openIssues: [],
        evidenceLinks: [
          {
            sentence: '귀비탕 복용과 침 치료를 시행하였다.',
            evidenceCardIds: ['evidence_1']
          }
        ],
        unsupportedClaims: []
      }
    ] as any,
    finalDraft: {
      fullTextBySection: {
        [CareSection.TITLE]: '귀비탕 치료 증례보고',
        [CareSection.ABSTRACT]: '환자 관찰 기록 한글 문단이 포함된 초록입니다.',
        [CareSection.INTRODUCTION]: '본 증례보고는 CARE guideline에 따라 작성되었다.',
        [CareSection.PATIENT_INFORMATION]: '49세 여성 환자가 불면을 호소하였다.',
        [CareSection.CLINICAL_FINDINGS]: '환자 관찰 기록 한글 문단: 불안과 수면장애가 관찰되었다.',
        [CareSection.TIMELINE]: '2024년 3월 2일 초진 후 귀비탕 복용. 2주 후 수면이 호전되었다.',
        [CareSection.DIAGNOSTIC_ASSESSMENT]: 'PHQ-9와 GAD-7 결과를 참고하였다.',
        [CareSection.THERAPEUTIC_INTERVENTIONS]: '귀비탕 복용과 침 치료를 시행하였다.',
        [CareSection.FOLLOW_UP_OUTCOMES]: '수면의 질이 호전되었고 부작용은 없었다.',
        [CareSection.DISCUSSION_CONCLUSION]: '귀비탕과 침 치료가 임상적으로 유의미할 수 있다.',
        [CareSection.PATIENT_PERSPECTIVE]: '환자는 이전보다 편안하다고 진술하였다.',
        [CareSection.INFORMED_CONSENT]: '서면 동의를 획득하였다.'
      },
      titleSuggestions: ['귀비탕 치료 증례보고'],
      abstractSuggestion: '환자 관찰 기록 한글 문단이 포함된 초록입니다.',
      sectionTraceability: {
        [CareSection.THERAPEUTIC_INTERVENTIONS]: {
          evidenceLinks: [
            {
              sentence: '귀비탕 복용과 침 치료를 시행하였다.',
              evidenceCardIds: ['evidence_1']
            }
          ],
          unsupportedClaims: []
        }
      },
      careChecklistEvaluation: {
        [CareSection.TITLE]: { status: 'FULFILLED', rationale: 'Title present.' },
        [CareSection.ABSTRACT]: { status: 'FULFILLED', rationale: 'Abstract present.' },
        [CareSection.INTRODUCTION]: { status: 'FULFILLED', rationale: 'Introduction present.' },
        [CareSection.PATIENT_INFORMATION]: { status: 'FULFILLED', rationale: 'Patient info present.' },
        [CareSection.CLINICAL_FINDINGS]: { status: 'FULFILLED', rationale: 'Clinical findings present.' },
        [CareSection.TIMELINE]: { status: 'FULFILLED', rationale: 'Timeline present.' },
        [CareSection.DIAGNOSTIC_ASSESSMENT]: { status: 'FULFILLED', rationale: 'Diagnostic assessment present.' },
        [CareSection.THERAPEUTIC_INTERVENTIONS]: { status: 'FULFILLED', rationale: 'Therapeutic interventions present.' },
        [CareSection.FOLLOW_UP_OUTCOMES]: { status: 'FULFILLED', rationale: 'Follow-up present.' },
        [CareSection.DISCUSSION_CONCLUSION]: { status: 'FULFILLED', rationale: 'Discussion present.' },
        [CareSection.PATIENT_PERSPECTIVE]: { status: 'FULFILLED', rationale: 'Patient perspective present.' },
        [CareSection.INFORMED_CONSENT]: { status: 'FULFILLED', rationale: 'Consent present.' }
      }
    } as any
  };
}

async function run() {
  const caseData = createMockCase();

  const finalExport = await exportCaseToDocx(caseData, 'final_manuscript');
  const finalText = await extractRawText(finalExport.buffer);
  assert.match(finalText, /귀비탕 치료 증례보고/);
  assert.match(finalText, /환자 관찰 기록 한글 문단/);
  assert.match(finalText, /PHQ-9/);
  assert.match(finalText, /GAD-7/);

  const imported = await extractDocxContent(finalExport.buffer);
  assert.match(imported.rawText, /귀비탕 치료 증례보고/);
  assert.ok(imported.blocks.some((block) => /환자 관찰 기록 한글 문단/.test(block.text)));
  assert.ok(imported.blocks.some((block) => /2024/.test(block.text) || /2/.test(block.text)));

  const currentDraftExport = await exportCaseToDocx(caseData, 'current_section_drafts');
  const currentDraftText = await extractRawText(currentDraftExport.buffer);
  assert.match(currentDraftText, /Keywords/);
  assert.match(currentDraftText, /귀비탕/);

  const checklistExport = await exportCaseToDocx(caseData, 'final_manuscript_with_checklist');
  const checklistText = await extractRawText(checklistExport.buffer);
  assert.match(checklistText, /CARE Checklist/);
  assert.match(checklistText, /Patient Information/);

  const traceabilityExport = await exportCaseToDocx(caseData, 'final_manuscript_with_traceability');
  const traceabilityText = await extractRawText(traceabilityExport.buffer);
  assert.match(traceabilityText, /Evidence Traceability/);
  assert.match(traceabilityText, /evidence_1/);
  assert.match(traceabilityText, /귀비탕/);

  const timelineRows = buildTimelineTableRows(caseData.draftsBySection?.[CareSection.TIMELINE] || '');
  assert.ok((timelineRows?.rows.length || 0) >= 1, 'timeline text should be parsed into rows');

  const timelineRowsFromEvents = buildTimelineTableRowsFromEvents(caseData.timelineEvents);
  assert.equal(timelineRowsFromEvents?.rows.length, 2, 'imported timeline events should build timeline rows');
  assert.equal(timelineRowsFromEvents?.rows[0]?.[0], '2024-03-02');

  const emptyCase = createMockCase();
  emptyCase.draftsBySection = {
    [CareSection.TITLE]: 'Minimal case report'
  } as any;
  emptyCase.sectionDrafts = [];
  emptyCase.finalDraft = {
    ...emptyCase.finalDraft,
    fullTextBySection: {
      [CareSection.TITLE]: 'Minimal case report'
    }
  } as any;
  const emptyExport = await exportCaseToDocx(emptyCase, 'final_manuscript');
  const emptyText = await extractRawText(emptyExport.buffer);
  assert.match(emptyText, /No content available yet\./);

  console.log('docx export tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
