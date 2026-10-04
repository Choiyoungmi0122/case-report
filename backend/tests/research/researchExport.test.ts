import assert from 'node:assert/strict';
import { CareSection, ResearchState } from '../../src/types';
import { buildResearchEventCsv, buildResearchExportPayload } from '../../src/export/researchExport';

const RAW_NAME = '홍길동';
const RAW_PHONE = '010-1234-5678';

function buildResearchState(): ResearchState {
  return {
    studyMode: false,
    participantCode: 'E01',
    sessionId: 'write_session_expert_01',
    startedAt: '2026-08-27T01:00:00.000Z',
    completedAt: '2026-08-27T02:00:00.000Z',
    interactionEvents: [
      {
        eventId: 'e1',
        eventType: 'session_start',
        timestamp: '2026-08-27T01:00:00.000Z',
        caseId: 'case-1',
        mode: 'write',
        participantCode: 'E01',
        sessionId: 'write_session_expert_01'
      },
      {
        eventId: 'e2',
        eventType: 'case_processed',
        timestamp: '2026-08-27T01:05:00.000Z',
        caseId: 'case-1',
        mode: 'write',
        metadata: { cached: false, quote: 'has "quotes"' }
      },
      {
        eventId: 'e3',
        eventType: 'section_opened',
        timestamp: '2026-08-27T01:10:00.000Z',
        caseId: 'case-1',
        mode: 'write',
        sectionId: CareSection.PATIENT_INFORMATION
      },
      {
        eventId: 'e4',
        eventType: 'question_answered',
        timestamp: '2026-08-27T01:20:00.000Z',
        caseId: 'case-1',
        mode: 'write'
      },
      {
        eventId: 'e5',
        eventType: 'final_output_viewed',
        timestamp: '2026-08-27T01:50:00.000Z',
        caseId: 'case-1',
        mode: 'write'
      }
    ]
  };
}

function buildCaseData() {
  return {
    id: 'case-1',
    experiment_code: 'EQ001',
    mode: 'write',
    title: '증례 1',
    createdAt: new Date('2026-08-27T00:59:00.000Z'),
    // Raw records stay local; they must never reach the export payload.
    visits: [{ index: 1, date: '2026-08-01', soapText: `${RAW_NAME} 환자가 내원함` }],
    deidentifiedEMRs: [
      {
        visitIndex: 1,
        visitDate: '2026-08-01',
        emrId: 'visit_1',
        deidentifiedText: '[PATIENT_NAME_1] 환자가 내원함',
        riskLevel: 'LOW',
        // The stored record keeps the local re-identification map; the export
        // must never carry these two fields.
        phiSpans: [
          { type: 'PATIENT_NAME', text: RAW_NAME, replacement: '[PATIENT_NAME_1]', start: 0, end: 3 }
        ],
        replacementMap: { '[PATIENT_NAME_1]': RAW_NAME }
      }
    ],
    evidenceCards: [
      {
        id: 'ev1',
        sourceText: `${RAW_NAME} 환자가 내원함`,
        normalizedText: `${RAW_NAME} 환자 내원`,
        tags: [CareSection.PATIENT_INFORMATION]
      }
    ],
    sectionStates: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        status: 'INCOMPLETE',
        missingInfoBullets: ['보호자 진술 여부'],
        recommendedQuestions: ['체중 감소 기간은?']
      }
    ],
    sectionDrafts: [{ sectionId: CareSection.PATIENT_INFORMATION, draftText: '최종 초안 문장.' }],
    commonMissingItems: [{ item: '동의 여부', relatedSectionIds: [CareSection.PATIENT_INFORMATION] }],
    commonQuestionSets: [{ question: '동의를 받았습니까?', targetSectionIds: [CareSection.PATIENT_INFORMATION] }],
    sectionAdequacyReviews: {
      [CareSection.PATIENT_INFORMATION]: { summary: '보강 필요', missingRequiredItems: ['보호자 진술 여부'] }
    },
    answerUndoStack: [
      {
        timestamp: '2026-08-27T01:20:00.000Z',
        kind: 'SECTION',
        sectionId: CareSection.PATIENT_INFORMATION,
        question: '체중 감소 기간은?',
        before: {
          sectionDrafts: [{ sectionId: CareSection.PATIENT_INFORMATION, draftText: '초기 초안 문장.' }],
          sectionStates: [{ sectionId: CareSection.PATIENT_INFORMATION, status: 'IMPOSSIBLE' }],
          commonMissingItems: [],
          commonQuestionSets: []
        }
      }
    ],
    finalDraft: { fullTextBySection: { TITLE: '최종 제목' } },
    finalComposeStatus: { status: 'COMPLETED' },
    exportLogs: [{ exportMode: 'final_manuscript', exportedAt: '2026-08-27T01:55:00.000Z' }],
    chainPerformanceLogs: [
      { chainName: 'CHAIN1', durationMs: 1200, startedAt: '2026-08-27T01:01:00.000Z', cacheHit: false }
    ],
    studyConfig: null,
    scaffoldState: null
  };
}

/** Minimal RFC4180 row parser, enough to verify the export's quoting. */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (inQuotes) {
      if (char === '"') {
        if (row[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

async function run() {
  const researchState = buildResearchState();
  const caseData = buildCaseData();

  const payload = await buildResearchExportPayload({
    caseId: 'case-1',
    caseData,
    researchState,
    sectionInteractions: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        qnaHistory: [
          { question: '체중 감소 기간은?', answer: '약 6개월', timestamp: '2026-08-27T01:20:00.000Z' }
        ]
      }
    ]
  });

  // --- identification ------------------------------------------------------
  assert.equal(payload.caseId, 'case-1');
  assert.equal(payload.experiment_code, 'EQ001');
  assert.equal(payload.participantCode, 'E01');
  assert.equal(payload.sessionId, 'write_session_expert_01');
  assert.equal(payload.mode, 'write');
  assert.equal(payload.schemaVersion, 'expert-formative-3');

  // --- privacy: de-identified input only, never the raw visits --------------
  assert.equal(payload.deidentifiedEMRs.length, 1);
  assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'visits'));
  assert.ok(!JSON.stringify(payload).includes(RAW_NAME));

  // The re-identification map must be stripped, while the substituted text and
  // non-identifying coverage stats survive.
  const exportedEmr = payload.deidentifiedEMRs[0];
  assert.ok(!Object.prototype.hasOwnProperty.call(exportedEmr, 'phiSpans'));
  assert.ok(!Object.prototype.hasOwnProperty.call(exportedEmr, 'replacementMap'));
  assert.equal(exportedEmr.deidentifiedText, '[PATIENT_NAME_1] 환자가 내원함');
  assert.equal(exportedEmr.riskLevel, 'LOW');
  assert.equal(exportedEmr.phiSpanCount, 1);
  assert.deepEqual(exportedEmr.phiTypes, ['PATIENT_NAME']);
  assert.deepEqual(exportedEmr.placeholders, ['[PATIENT_NAME_1]']);

  // --- trajectory ----------------------------------------------------------
  assert.equal(payload.evidenceCards.length, 1);
  assert.equal(payload.evidenceCards[0].sourceText, '[PATIENT_NAME_1] 환자가 내원함');
  assert.equal(payload.evidenceCards[0].normalizedText, '[PATIENT_NAME_1] 환자 내원');
  assert.equal(payload.sectionStates.length, 1);
  assert.equal(payload.commonMissingItems.length, 1);
  assert.equal(payload.commonQuestionSets.length, 1);
  assert.ok(payload.sectionAdequacyReviews[CareSection.PATIENT_INFORMATION]);
  assert.equal(payload.sectionQnaHistory[0].qnaHistory[0].answer, '약 6개월');

  // initial -> answer -> final must be distinguishable
  assert.equal(payload.draftTrajectory.steps.length, 1);
  assert.equal(
    payload.draftTrajectory.steps[0].draftsBeforeAnswer[0].draftText,
    '초기 초안 문장.'
  );
  assert.equal(payload.draftTrajectory.steps[0].question, '체중 감소 기간은?');
  assert.equal(payload.sectionDrafts[0].draftText, '최종 초안 문장.');
  assert.equal(payload.draftTrajectory.truncated, false);

  // --- final output --------------------------------------------------------
  assert.equal(payload.finalDraft.fullTextBySection.TITLE, '최종 제목');
  assert.equal(payload.exportLogs.length, 1);

  // --- timing --------------------------------------------------------------
  assert.equal(payload.timing.totalSessionMs, 60 * 60 * 1000);
  assert.equal(payload.timing.timeToProcessedMs, 5 * 60 * 1000);
  assert.equal(payload.timing.timeToFinalManuscriptMs, 50 * 60 * 1000);
  assert.equal(payload.timing.sectionOpenCount, 1);
  assert.equal(payload.timing.questionsAnsweredCount, 1);
  assert.equal(payload.timing.chainDurationsMs[0].durationMs, 1200);

  // --- truncation is reported, not silently hidden -------------------------
  const truncatedPayload = await buildResearchExportPayload({
    caseId: 'case-1',
    caseData: { ...caseData, answerUndoStack: new Array(20).fill(caseData.answerUndoStack[0]) },
    researchState,
    sectionInteractions: []
  });
  assert.equal(truncatedPayload.draftTrajectory.truncated, true);

  // --- scaffold payload ----------------------------------------------------
  const scaffoldPayload = await buildResearchExportPayload({
    caseId: 'case-2',
    caseData: {
      ...caseData,
      mode: 'scaffold',
      scaffoldState: {
        sessionId: 'scaffold_session_1',
        participantCode: 'E02',
        sectionProgress: [{ sectionId: CareSection.PATIENT_INFORMATION, recordReviewCompleted: true }],
        sectionReflections: [
          {
            sectionId: CareSection.PATIENT_INFORMATION,
            learnerNotes: '메모',
            postAiReflection: {
              changedJudgment: '확정 표현을 다시 검토함',
              unresolvedQuestion: '추가 검사 확인 필요',
              transferPlan: '다음에는 시점과 수치를 먼저 대조',
              savedAt: '2026-08-27T01:40:00.000Z'
            }
          }
        ],
        preRevealSnapshots: [{ sectionId: CareSection.PATIENT_INFORMATION }],
        caseMap: {
          version: 'scaffold-v2',
          currentPhase: 'claim_evidence',
          selectedEvidenceIds: ['ev1'],
          caseNotes: [
            {
              id: 'note-1',
              type: 'observation',
              text: `${RAW_NAME} 환자의 치료 뒤 증상 변화를 확인함`,
              sourceEvidenceIds: ['ev1'],
              createdAt: '2026-08-27T01:25:00.000Z'
            }
          ],
          noteFeedbackRevealedAt: '2026-08-27T01:26:00.000Z',
          problemRepresentation: `${RAW_NAME} 환자의 핵심 증례표상`,
          reportabilityRationale: '진단 과정의 교육적 가치',
          teachingPoints: ['시점과 수치를 대조한다.'],
          targetAudience: '전공의',
          claims: [
            {
              id: 'claim-1',
              type: 'diagnosis',
              text: `${RAW_NAME} 환자의 진단 근거`,
              rationale: `확인 연락처 ${RAW_PHONE}`,
              evidenceIds: ['ev1'],
              targetSectionIds: [CareSection.DIAGNOSTIC_ASSESSMENT],
              confidence: 'medium'
            }
          ],
          createdAt: '2026-08-27T01:20:00.000Z',
          updatedAt: '2026-08-27T01:30:00.000Z'
        },
        reviewItems: [
          {
            id: 'r1',
            judgment: 'available_in_record',
            sourceText: `${RAW_NAME} 환자가 내원함`,
            normalizedText: `${RAW_NAME} 환자 내원`,
            note: `보호자 연락처 ${RAW_PHONE}`,
            learningFeedback: {
              source: 'grounded_review_coach_v1',
              summary: '원기록과 다시 대조하세요.',
              prompts: ['시점과 수치가 일치하나요?'],
              selectedEvidence: [{ id: 'ev1', text: `${RAW_NAME} 환자가 내원함` }],
              generatedAt: '2026-08-27T01:35:00.000Z'
            }
          }
        ],
        questionTaskResults: [{ itemId: 'q1', status: 'answered' }],
        interactionEvents: []
      }
    },
    researchState,
    sectionInteractions: []
  });
  assert.equal(scaffoldPayload.scaffoldData?.participantCode, 'E02');
  assert.equal(scaffoldPayload.scaffoldData?.preRevealSnapshots.length, 1);
  assert.equal(scaffoldPayload.scaffoldData?.sectionReflections.length, 1);
  assert.equal(scaffoldPayload.scaffoldData?.caseMap.version, 'scaffold-v2');
  assert.equal(scaffoldPayload.scaffoldData?.caseMap.problemRepresentation, '[PATIENT_NAME_1] 환자의 핵심 증례표상');
  assert.equal(scaffoldPayload.scaffoldData?.caseMap.claims[0].rationale, '확인 연락처 [PHONE_1]');
  assert.equal(
    scaffoldPayload.scaffoldData?.caseMap.caseNotes[0].text,
    '[PATIENT_NAME_1] 환자의 치료 뒤 증상 변화를 확인함'
  );
  assert.deepEqual(scaffoldPayload.scaffoldData?.caseMap.caseNotes[0].sourceEvidenceIds, ['ev1']);
  assert.equal(
    scaffoldPayload.scaffoldData?.sectionReflections[0].postAiReflection.transferPlan,
    '다음에는 시점과 수치를 먼저 대조'
  );
  assert.equal(scaffoldPayload.scaffoldData?.reviewItems[0].sourceText, '[PATIENT_NAME_1] 환자가 내원함');
  assert.equal(scaffoldPayload.scaffoldData?.reviewItems[0].normalizedText, '[PATIENT_NAME_1] 환자 내원');
  assert.equal(scaffoldPayload.scaffoldData?.reviewItems[0].note, '보호자 연락처 [PHONE_1]');
  assert.equal(
    scaffoldPayload.scaffoldData?.reviewItems[0].learningFeedback.selectedEvidence[0].text,
    '[PATIENT_NAME_1] 환자가 내원함'
  );
  assert.ok(!JSON.stringify(scaffoldPayload).includes(RAW_NAME));
  assert.ok(!JSON.stringify(scaffoldPayload).includes(RAW_PHONE));

  // --- CSV -----------------------------------------------------------------
  const csv = buildResearchEventCsv({ caseId: 'case-1', experimentCode: 'EQ001', mode: 'write', researchState });
  const csvLines = csv.split('\n');
  assert.equal(csvLines.length, 6); // header + 5 events
  assert.ok(csvLines[0].startsWith('participantCode,sessionId,mode,caseId'));
  assert.ok(csvLines[1].includes('"E01"'));
  assert.ok(csvLines[3].includes(`"${CareSection.PATIENT_INFORMATION}"`));
  assert.ok(!csv.includes(RAW_NAME));

  // A metadata value containing quotes must stay inside one field, so the row
  // still parses as exactly 9 columns and the JSON survives unescaping.
  const metadataRowFields = parseCsvRow(csvLines[2]);
  assert.equal(metadataRowFields.length, 9);
  assert.equal(metadataRowFields[4], 'EQ001');
  assert.equal(metadataRowFields[6], 'case_processed');
  assert.deepEqual(JSON.parse(metadataRowFields[8]), { cached: false, quote: 'has "quotes"' });

  console.log('research export tests passed');
}

void run();
