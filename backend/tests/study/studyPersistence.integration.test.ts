import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import express from 'express';

dotenv.config();

function buildTestMongoUri() {
  const configured = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!configured) return 'mongodb://127.0.0.1:27017/care_scaffold_integration_test';

  const parsed = new URL(configured);
  const sourceDbName = parsed.pathname.replace(/^\//, '') || 'care';
  parsed.pathname = `/${sourceDbName}_scaffold_integration_test`;
  return parsed.toString();
}

async function run() {
  process.env.MONGODB_URI = buildTestMongoUri();

  const [{ CaseModel, initDatabase }, { default: scaffoldRouter }, mongooseModule] = await Promise.all([
    import('../../src/db/schema'),
    import('../../src/routes/scaffold'),
    import('mongoose')
  ]);
  const mongoose = mongooseModule.default;

  await initDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/cases', scaffoldRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/api/cases`;
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const caseId = `case_scaffold_persistence_${suffix}`;
  const sectionId = 'PATIENT_INFORMATION';

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {})
      }
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  try {
    await CaseModel.create({
      id: caseId,
      experiment_code: `SQIT_${suffix}`,
      mode: 'scaffold',
      title: 'Scaffold persistence integration test',
      visits: [
        {
          index: 1,
          type: '초진',
          date: '2026-09-30',
          soapText: 'S: 6개월간 체중 감소를 호소함.'
        }
      ],
      evidenceCards: [
        {
          id: 'evidence-1',
          visitIndex: 1,
          visitDateTime: '2026-09-30',
          sourceText: 'S: 6개월간 체중 감소를 호소함.',
          normalizedText: 'S: 6개월간 체중 감소를 호소함.',
          tags: [sectionId],
          sectionHints: [sectionId]
        }
      ],
      sectionStates: [
        {
          sectionId,
          status: 'READY',
          rationaleText: '기록으로 작성 가능',
          missingInfoBullets: [],
          recommendedQuestions: []
        }
      ],
      sectionDrafts: [
        {
          sectionId,
          draftText: '환자는 6개월간 체중 감소를 호소하였다.',
          evidenceCardIdsUsed: ['evidence-1'],
          timelineEventIdsUsed: [],
          openIssues: [],
          evidenceLinks: [],
          unsupportedClaims: [],
          generationMetadata: { promptVersion: 'CHAIN3_STUDY_REVEAL:v1' }
        }
      ],
      scaffoldState: {
        reviewItems: [],
        sectionProgress: [],
        instructorReviewItems: [],
        additionalConfirmationItems: [],
        sectionReflections: [],
        questionTaskResults: [],
        preRevealSnapshots: [],
        interactionEvents: [
          {
            eventId: 'purpose-viewed',
            eventType: 'section_purpose_viewed',
            timestamp: '2026-09-30T01:00:00.000Z',
            caseId,
            mode: 'scaffold',
            sectionId
          }
        ]
      },
      studyConfig: { studyMode: true, lockedMode: true, condition: 'scaffold' }
    });

    const invalidEvidence = await request(`/${caseId}/scaffold/sections/${sectionId}/reflection`, {
      method: 'PUT',
      body: JSON.stringify({
        selectedEvidenceIds: ['not-this-case'],
        selectedEvidence: [{ id: 'not-this-case', sourceType: 'evidence_card' }]
      })
    });
    assert.equal(invalidEvidence.status, 400);
    assert.deepEqual(invalidEvidence.body.invalidEvidenceIds, ['not-this-case']);

    const savedReflection = await request(`/${caseId}/scaffold/sections/${sectionId}/reflection`, {
      method: 'PUT',
      body: JSON.stringify({
        selectedEvidenceIds: ['evidence-1'],
        selectedEvidence: [{ id: 'evidence-1', sourceType: 'evidence_card', label: 'spoofed label' }],
        learnerKeyInformationItems: ['6개월간 체중 감소'],
        learnerIdentifiedKeyInfo: ['6개월간 체중 감소'],
        learnerIdentifiedMissingItems: ['감소 전 체중'],
        additionalConfirmationItems: [],
        teacherReviewItems: [],
        noRelevantEvidenceConfirmed: false
      })
    });
    assert.equal(savedReflection.status, 200);
    assert.deepEqual(savedReflection.body.reflection.selectedEvidenceIds, ['evidence-1']);
    assert.match(savedReflection.body.reflection.selectedEvidence[0].label, /2026-09-30/);
    assert.ok(!savedReflection.body.reflection.selectedEvidence[0].label.includes('spoofed'));

    const revealBypass = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ draftRevealed: true })
    });
    assert.equal(revealBypass.status, 409);
    assert.equal(revealBypass.body.revealGate.recordReviewCompleted, false);

    const recordReview = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ recordReviewCompleted: true })
    });
    assert.equal(recordReview.status, 200);

    const sufficiencyBypass = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ missingInfoReviewCompleted: true })
    });
    assert.equal(sufficiencyBypass.status, 409);
    assert.equal(sufficiencyBypass.body.revealGate.allSufficiencyJudgmentsSaved, false);

    for (const questionId of ['pi_001', 'pi_002', 'pi_003', 'pi_004']) {
      const itemId = `${sectionId}-custom-0-${questionId.replace('_', '-')}`;
      const savedJudgment = await request(`/${caseId}/scaffold/review-items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          sectionId,
          sourceType: 'custom',
          sourceText: questionId,
          judgment: 'available_in_record'
        })
      });
      assert.equal(savedJudgment.status, 200);
    }

    const sufficiencyComplete = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ missingInfoReviewCompleted: true })
    });
    assert.equal(sufficiencyComplete.status, 200);

    const revealed = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({ draftRevealed: true })
    });
    assert.equal(revealed.status, 200);

    const firstReload = await request(`/${caseId}/scaffold`);
    assert.equal(firstReload.status, 200);
    const firstSnapshot = firstReload.body.scaffoldState.preRevealSnapshots[0];
    assert.deepEqual(firstSnapshot.selectedEvidenceIds, ['evidence-1']);
    assert.match(firstSnapshot.selectedEvidence[0].label, /6개월간 체중 감소/);
    assert.deepEqual(firstSnapshot.learnerKeyInformationItems, ['6개월간 체중 감소']);
    assert.deepEqual(firstSnapshot.learnerIdentifiedMissingItems, ['감소 전 체중']);
    assert.equal(firstSnapshot.reviewItemJudgments.filter((item: any) => item.sourceType === 'custom').length, 4);

    const changedReflection = await request(`/${caseId}/scaffold/sections/${sectionId}/reflection`, {
      method: 'PUT',
      body: JSON.stringify({
        selectedEvidenceIds: ['evidence-1'],
        selectedEvidence: [{ id: 'evidence-1', sourceType: 'evidence_card' }],
        learnerKeyInformationItems: ['공개 후 변경된 내용'],
        learnerIdentifiedKeyInfo: ['공개 후 변경된 내용'],
        learnerIdentifiedMissingItems: [],
        additionalConfirmationItems: [],
        teacherReviewItems: [],
        noRelevantEvidenceConfirmed: false
      })
    });
    assert.equal(changedReflection.status, 200);

    const invalidRepeatedReveal = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({
        draftRevealed: true,
        selectedEvidenceIds: ['not-this-case'],
        selectedEvidence: [{ id: 'not-this-case', sourceType: 'evidence_card' }]
      })
    });
    assert.equal(invalidRepeatedReveal.status, 400);

    const repeatedReveal = await request(`/${caseId}/scaffold/sections/${sectionId}/progress`, {
      method: 'PUT',
      body: JSON.stringify({
        draftRevealed: true,
        selectedEvidenceIds: ['evidence-1'],
        selectedEvidence: [{ id: 'evidence-1', sourceType: 'evidence_card' }]
      })
    });
    assert.equal(repeatedReveal.status, 200);

    const secondReload = await request(`/${caseId}/scaffold`);
    const secondSnapshot = secondReload.body.scaffoldState.preRevealSnapshots[0];
    assert.equal(secondReload.body.scaffoldState.preRevealSnapshots.length, 1);
    assert.equal(secondSnapshot.createdAt, firstSnapshot.createdAt);
    assert.deepEqual(secondSnapshot.learnerKeyInformationItems, ['6개월간 체중 감소']);
    assert.deepEqual(secondSnapshot.selectedEvidenceIds, ['evidence-1']);

    const invalidDraftEvidence = await request(`/${caseId}/scaffold/review-items/draft-invalid-evidence`, {
      method: 'PUT',
      body: JSON.stringify({
        sectionId,
        sourceType: 'draft_sentence',
        sourceText: '환자는 체중 감소를 호소하였다.',
        judgment: 'supported_by_record',
        evidenceIds: ['not-this-case']
      })
    });
    assert.equal(invalidDraftEvidence.status, 400);
    assert.deepEqual(invalidDraftEvidence.body.invalidEvidenceIds, ['not-this-case']);

    console.log('study persistence integration tests passed');
  } finally {
    await CaseModel.deleteOne({ id: caseId }).exec();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
