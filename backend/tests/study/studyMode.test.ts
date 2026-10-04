import assert from 'node:assert/strict';
import { CareSection } from '../../src/types';
import { splitIntoClauses } from '../../src/llm/chains';
import { repairSplitClinicalEvidenceCards } from '../../src/utils/evidenceCardRepair';
import {
  buildProcessSectionsOverview,
  buildStudySessionId,
  reprocessCaseFromStoredTerms,
  shouldDeferStudyScaffoldDrafts
} from '../../src/routes/cases';
import {
  buildPreRevealSnapshot,
  buildLearningFeedback,
  evaluateStudyCompletionGate,
  evaluateStudyRevealGate,
  generateStudyScaffoldDraftAfterSnapshot,
  normalizeV2CaseMap,
  sanitizeSectionStatesForScaffold
} from '../../src/routes/scaffold';
import { sanitizeSectionResponse } from '../../src/routes/sections';

async function run() {
  assert.deepEqual(
    splitIntoClauses(
      'O: 조직검사상 H. pylori 양성 확인.\nA: H. pylori 관련 위염으로 판단.\nP: 제균치료 시작.'
    ).map((item) => item.text),
    [
      'O: 조직검사상 H. pylori 양성 확인.',
      'A: H. pylori 관련 위염으로 판단.',
      'P: 제균치료 시작.'
    ]
  );

  const repairedEvidence = repairSplitClinicalEvidenceCards(
    [
      { id: 'left', visitIndex: 1, sourceText: 'A: H.', normalizedText: 'A: H.', tags: [] },
      {
        id: 'right',
        visitIndex: 1,
        sourceText: 'pylori 관련 위염으로 판단.',
        normalizedText: 'pylori 관련 위염으로 판단.',
        tags: []
      }
    ],
    [{ index: 1, text: 'A: H. pylori 관련 위염으로 판단.' }]
  );
  assert.equal(repairedEvidence.cards.length, 1);
  assert.equal(repairedEvidence.cards[0].sourceText, 'A: H. pylori 관련 위염으로 판단.');
  assert.equal(repairedEvidence.idRedirects.right, 'left');

  const noteBasedCaseMap = normalizeV2CaseMap({
    currentPhase: 'case_understanding',
    caseNotes: [
      {
        id: 'note-observation',
        type: 'observation',
        text: '치료 뒤 증상이 호전되었다.',
        sourceEvidenceIds: [],
        createdAt: '2026-08-18T09:00:00.000Z'
      },
      {
        id: 'note-question',
        type: 'question',
        text: '이전 검사 결과를 더 확인하고 싶다.',
        sourceEvidenceIds: ['evidence-1'],
        createdAt: '2026-08-18T09:01:00.000Z'
      }
    ]
  });
  assert.equal(noteBasedCaseMap?.caseNotes.length, 2);
  assert.deepEqual(noteBasedCaseMap?.caseNotes[0].sourceEvidenceIds, []);
  assert.deepEqual(noteBasedCaseMap?.caseNotes[1].sourceEvidenceIds, ['evidence-1']);
  assert.equal(noteBasedCaseMap?.caseNotes[1].type, 'question');

  assert.equal(
    buildStudySessionId({
      participantCode: 'P01',
      mode: 'write',
      studyCaseId: 'default-study-case'
    }),
    'study_default-study-case_write_P01'
  );

  const baseCaseData: any = {
    sectionStates: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        recommendedQuestions: ['체중 감소 기간은?'],
        missingInfoBullets: ['보호자 진술 여부']
      }
    ],
    commonQuestionSets: [],
    sectionDrafts: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        draftText: '첫 문장이다. 두 번째 문장이다.',
        unsupportedClaims: []
      }
    ],
    sectionAdequacyReviews: {},
    evidenceCards: [
      {
        id: 'evidence-1',
        normalizedText: '6개월간 체중이 3kg 감소하였다.'
      }
    ]
  };

  const incompleteState: any = {
    reviewItems: [],
    questionTaskResults: [],
    sectionProgress: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        recordReviewCompleted: false,
        missingInfoReviewCompleted: false,
        draftRevealed: false,
        draftReviewCompleted: false
      }
    ],
    sectionReflections: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        learnerIdentifiedKeyInfo: [],
        learnerIdentifiedMissingItems: [],
        additionalConfirmationItems: [],
        teacherReviewItems: [],
        learnerNotes: ''
      }
    ],
    interactionEvents: []
  };

  const noRevealGate = evaluateStudyRevealGate(
    baseCaseData,
    incompleteState,
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(noRevealGate.canReveal, false);
  assert.equal(noRevealGate.purposeViewed, false);
  assert.equal(noRevealGate.recordReviewCompleted, false);

  const revealReadyState: any = {
    ...incompleteState,
    reviewItems: [
      {
        id: 'missing-1',
        sectionId: CareSection.PATIENT_INFORMATION,
        sourceType: 'missing_info',
        sourceText: '보호자 진술 여부',
        judgment: 'needs_additional_confirmation'
      },
      {
        id: 'question-1',
        sectionId: CareSection.PATIENT_INFORMATION,
        sourceType: 'recommended_question',
        sourceText: '체중 감소 기간은?',
        judgment: 'confirmed_in_record'
      },
      ...['pi-001', 'pi-002', 'pi-003', 'pi-004'].map((questionKey) => ({
        id: `${CareSection.PATIENT_INFORMATION}-custom-0-${questionKey}`,
        sectionId: CareSection.PATIENT_INFORMATION,
        sourceType: 'custom',
        sourceText: questionKey,
        judgment: 'available_in_record'
      }))
    ],
    questionTaskResults: [
      {
        itemId: 'question-1',
        question: '체중 감소 기간은?',
        status: 'answered',
        updatedAt: new Date('2026-08-18T10:00:00.000Z').toISOString()
      }
    ],
    sectionProgress: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        recordReviewCompleted: true,
        missingInfoReviewCompleted: true,
        draftRevealed: false,
        draftReviewCompleted: false
      }
    ],
    sectionReflections: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        selectedEvidenceIds: ['evidence-1'],
        selectedEvidence: [
          {
            id: 'evidence-1',
            sourceType: 'evidence_card',
            label: '6개월간 체중이 3kg 감소하였다.'
          }
        ],
        learnerIdentifiedKeyInfo: ['6개월간 체중 감소'],
        learnerIdentifiedMissingItems: ['보호자 진술 여부'],
        additionalConfirmationItems: ['생활습관 변화'],
        teacherReviewItems: ['진단적 해석 적절성'],
        learnerNotes: '초안 보기 전 판단'
      }
    ],
    interactionEvents: [
      {
        eventId: 'purpose',
        eventType: 'section_purpose_viewed',
        timestamp: new Date('2026-08-18T09:59:00.000Z').toISOString(),
        caseId: 'case-study',
        mode: 'scaffold',
        sectionId: CareSection.PATIENT_INFORMATION
      }
    ]
  };

  const revealGate = evaluateStudyRevealGate(
    baseCaseData,
    revealReadyState,
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(revealGate.canReveal, true);
  assert.equal(revealGate.preAiEvidencePath, 'selected_evidence');
  assert.equal(revealGate.allSufficiencyJudgmentsSaved, true);

  const directEntryGate = evaluateStudyRevealGate(
    baseCaseData,
    {
      ...revealReadyState,
      sectionReflections: [
        {
          ...revealReadyState.sectionReflections[0],
          selectedEvidenceIds: [],
          selectedEvidence: []
        }
      ]
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(directEntryGate.canReveal, true);
  assert.equal(directEntryGate.preAiEvidencePath, 'direct_entry');

  const visibleWorkflowOnlyGate = evaluateStudyRevealGate(
    baseCaseData,
    {
      ...revealReadyState,
      reviewItems: revealReadyState.reviewItems.filter((item: any) => item.sourceType === 'custom'),
      questionTaskResults: []
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(visibleWorkflowOnlyGate.canReveal, true);
  assert.equal(visibleWorkflowOnlyGate.allRequiredReviewItemsClassified, false);
  assert.equal(visibleWorkflowOnlyGate.allRequiredQuestionTasksCompleted, false);

  const incompleteSufficiencyGate = evaluateStudyRevealGate(
    baseCaseData,
    {
      ...revealReadyState,
      reviewItems: revealReadyState.reviewItems.filter(
        (item: any) => item.id !== `${CareSection.PATIENT_INFORMATION}-custom-0-pi-004`
      )
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(incompleteSufficiencyGate.canReveal, false);
  assert.equal(incompleteSufficiencyGate.allSufficiencyJudgmentsSaved, false);

  const invalidEvidenceGate = evaluateStudyRevealGate(
    baseCaseData,
    {
      ...revealReadyState,
      sectionReflections: [
        {
          ...revealReadyState.sectionReflections[0],
          selectedEvidenceIds: ['not-this-case'],
          selectedEvidence: [{ id: 'not-this-case', sourceType: 'evidence_card' }],
          learnerIdentifiedKeyInfo: []
        }
      ]
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(invalidEvidenceGate.canReveal, false);
  assert.deepEqual(invalidEvidenceGate.invalidEvidenceIds, ['not-this-case']);

  const noEvidencePathGate = evaluateStudyRevealGate(
    baseCaseData,
    {
      ...revealReadyState,
      sectionReflections: [
        {
          ...revealReadyState.sectionReflections[0],
          selectedEvidenceIds: [],
          selectedEvidence: [],
          learnerIdentifiedKeyInfo: [],
          learnerKeyInformationItems: [],
          noRelevantEvidenceConfirmed: true
        }
      ]
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(noEvidencePathGate.canReveal, true);
  assert.equal(noEvidencePathGate.preAiEvidencePath, 'no_relevant_evidence');

  const completionGateBeforeDraftJudgment = evaluateStudyCompletionGate(
    baseCaseData,
    {
      ...revealReadyState,
      sectionProgress: [
        {
          sectionId: CareSection.PATIENT_INFORMATION,
          recordReviewCompleted: true,
          missingInfoReviewCompleted: true,
          draftRevealed: true,
          draftReviewCompleted: false
        }
      ]
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(completionGateBeforeDraftJudgment.canComplete, false);
  assert.equal(completionGateBeforeDraftJudgment.allDraftJudgmentsSaved, false);

  const completionGateWithoutReason = evaluateStudyCompletionGate(
    baseCaseData,
    {
      ...revealReadyState,
      reviewItems: [
        ...revealReadyState.reviewItems,
        {
          id: 'draft-1',
          sectionId: CareSection.PATIENT_INFORMATION,
          sourceType: 'draft_sentence',
          sourceText: '첫 문장이다.',
          judgment: 'supported_by_record'
        },
        {
          id: 'draft-2',
          sectionId: CareSection.PATIENT_INFORMATION,
          sourceType: 'draft_sentence',
          sourceText: '두 번째 문장이다.',
          judgment: 'needs_instructor_review'
        }
      ],
      sectionProgress: [
        {
          sectionId: CareSection.PATIENT_INFORMATION,
          recordReviewCompleted: true,
          missingInfoReviewCompleted: true,
          draftRevealed: true,
          draftReviewCompleted: false
        }
      ]
    },
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(completionGateWithoutReason.canComplete, false);
  assert.equal(completionGateWithoutReason.allDraftJudgmentsSaved, false);

  const completionReadyState: any = {
    ...revealReadyState,
    reviewItems: [
      ...revealReadyState.reviewItems,
      {
        id: 'draft-1',
        sectionId: CareSection.PATIENT_INFORMATION,
        sourceType: 'draft_sentence',
        sourceText: '첫 문장이다.',
        judgment: 'supported_by_record',
        evidenceIds: ['evidence-1']
      },
      {
        id: 'draft-2',
        sectionId: CareSection.PATIENT_INFORMATION,
        sourceType: 'draft_sentence',
        sourceText: '두 번째 문장이다.',
        judgment: 'needs_instructor_review',
        note: '교수자 확인이 필요하다고 판단함'
      }
    ],
    sectionProgress: [
      {
        sectionId: CareSection.PATIENT_INFORMATION,
        recordReviewCompleted: true,
        missingInfoReviewCompleted: true,
        draftRevealed: true,
        draftReviewCompleted: false
      }
    ]
  };

  const completionGateWithoutReflection = evaluateStudyCompletionGate(
    baseCaseData,
    completionReadyState,
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(completionGateWithoutReflection.canComplete, false);
  assert.equal(completionGateWithoutReflection.postAiReflectionSaved, false);

  const completionReadyWithReflection: any = {
    ...completionReadyState,
    sectionReflections: completionReadyState.sectionReflections.map((item: any) => ({
      ...item,
      postAiReflection: {
        changedJudgment: 'AI 문장의 확정 표현을 다시 보았다.',
        unresolvedQuestion: '진단 근거는 교수자 확인이 필요하다.',
        transferPlan: '다음에는 시점과 수치를 먼저 대조한다.',
        savedAt: '2026-08-18T10:10:00.000Z'
      }
    }))
  };

  const completionGate = evaluateStudyCompletionGate(
    baseCaseData,
    completionReadyWithReflection,
    CareSection.PATIENT_INFORMATION
  );
  assert.equal(completionGate.canComplete, true);
  assert.equal(completionGate.allDraftJudgmentsSaved, true);
  assert.equal(completionGate.postAiReflectionSaved, true);

  const learningFeedback = buildLearningFeedback(
    baseCaseData,
    'supported_by_record',
    ['evidence-1'],
    '2026-08-18T10:05:00.000Z'
  );
  assert.equal(learningFeedback.source, 'grounded_review_coach_v1');
  assert.equal(learningFeedback.selectedEvidence[0].id, 'evidence-1');
  assert.match(learningFeedback.summary, /원기록/);
  assert.equal(learningFeedback.prompts.length, 2);

  const snapshot = buildPreRevealSnapshot(
    completionReadyWithReflection,
    CareSection.PATIENT_INFORMATION
  );
  assert.deepEqual(snapshot.learnerKeyInformationItems, ['6개월간 체중 감소']);
  assert.deepEqual(snapshot.selectedEvidenceIds, ['evidence-1']);
  assert.equal(snapshot.selectedEvidence?.[0]?.label, '6개월간 체중이 3kg 감소하였다.');
  assert.equal(snapshot.reviewItemJudgments.length >= 2, true);

  const mutatedState = {
    ...completionReadyWithReflection,
    sectionReflections: [
      {
        ...completionReadyWithReflection.sectionReflections[0],
        learnerIdentifiedKeyInfo: ['AI 확인 후 수정한 판단']
      }
    ]
  };
  assert.deepEqual(snapshot.learnerKeyInformationItems, ['6개월간 체중 감소']);
  assert.notDeepEqual(
    mutatedState.sectionReflections[0].learnerIdentifiedKeyInfo,
    snapshot.learnerKeyInformationItems
  );

  const hiddenDraftPayload = sanitizeSectionResponse(
    {
      mode: 'scaffold',
      sectionDrafts: [],
      draftsBySection: {
        [CareSection.PATIENT_INFORMATION]: '숨겨져야 하는 초안'
      },
      scaffoldState: {
        sectionProgress: []
      }
    },
    CareSection.PATIENT_INFORMATION,
    {
      currentDraft: '숨겨져야 하는 초안',
      draftsBySection: {
        [CareSection.PATIENT_INFORMATION]: '숨겨져야 하는 초안'
      },
      updatedDraftText: '숨겨져야 하는 초안'
    }
  );
  assert.equal(hiddenDraftPayload.currentDraft, '');
  assert.deepEqual(hiddenDraftPayload.draftsBySection, {});
  assert.equal(hiddenDraftPayload.updatedDraftText, '');

  const hiddenAiPayload = sanitizeSectionResponse(
    {
      mode: 'scaffold',
      studyConfig: { studyMode: true },
      sectionStates: baseCaseData.sectionStates,
      sectionDrafts: [],
      draftsBySection: {},
      scaffoldState: { sectionProgress: [] }
    },
    CareSection.PATIENT_INFORMATION,
    {
      currentDraft: '',
      status: 'READY',
      rationaleText: 'AI가 생성한 적절성 판단',
      missingInfoBullets: ['AI 누락 정보'],
      recommendedQuestions: ['AI 추천 질문'],
      sectionMissingInfo: ['AI 누락 정보'],
      commonMissingInfo: ['공통 누락 정보'],
      sectionQuestions: ['AI 추천 질문'],
      commonQuestions: [{ question: '공통 질문' }],
      qnaHistory: [{ question: '질문', answer: '답변' }],
      adequacyReview: { summary: 'AI 검토 요약' },
      caseSummary: {
        finalDraft: { fullTextBySection: {} },
        chainPerformanceLogs: [{ chainName: 'CHAIN3' }],
        sectionStates: baseCaseData.sectionStates,
        commonQuestionSets: [{ question: '공통 질문' }],
        commonMissingItems: ['공통 누락 정보']
      }
    }
  );
  assert.equal(hiddenAiPayload.rationaleText, '');
  assert.deepEqual(hiddenAiPayload.missingInfoBullets, []);
  assert.deepEqual(hiddenAiPayload.recommendedQuestions, []);
  assert.equal(hiddenAiPayload.adequacyReview, undefined);
  assert.equal(hiddenAiPayload.caseSummary.finalDraft, null);
  assert.deepEqual(hiddenAiPayload.caseSummary.chainPerformanceLogs, []);

  const sanitizedStates = sanitizeSectionStatesForScaffold(
    {
      studyConfig: { studyMode: true },
      sectionStates: baseCaseData.sectionStates
    },
    { sectionProgress: [] } as any
  );
  assert.equal(sanitizedStates[0].rationaleText, '');
  assert.deepEqual(sanitizedStates[0].missingInfoBullets, []);

  const processOverview = buildProcessSectionsOverview(
    {
      mode: 'scaffold',
      studyConfig: { studyMode: true },
      scaffoldState: { sectionProgress: [] }
    },
    baseCaseData.sectionStates,
    baseCaseData.sectionDrafts
  );
  assert.equal(processOverview[0].rationaleText, '');
  assert.equal(processOverview[0].draftSnippet, '');

  const deferredCase: any = {
    id: 'case-study-deferred',
    mode: 'scaffold',
    studyConfig: { studyMode: true },
    title: 'Study case',
    visits: [{ visitIndex: 1, visitDateTime: '2026-08-18', sanitizedText: '기록 문장' }],
    pendingTermConfirmations: [],
    timelineEvents: [],
    chainCache: {},
    chainPerformanceLogs: [],
    sectionStates: [],
    sectionDrafts: [],
    draftsBySection: {}
  };
  assert.equal(shouldDeferStudyScaffoldDrafts(deferredCase), true);
  let initialDraftCallCount = 0;
  let questionStateCallCount = 0;
  const deferredStore = { ...deferredCase };
  const deferredResult = await reprocessCaseFromStoredTerms({
    caseId: deferredCase.id,
    caseData: deferredCase,
    dependencies: {
      preprocessVisitsForChain1: async () => ({
        deidentifiedEMRs: [],
        deidentifiedVisits: [],
        preparedVisits: [
          {
            index: 1,
            date: '2026-08-18',
            text: '기록 문장',
            normalizedText: '기록 문장',
            clauses: []
          }
        ],
        pendingTermConfirmations: [],
        reviewRequired: null
      } as any),
      runEvidenceSplit: async () => ([
        {
          id: 'evidence-1',
          visitIndex: 1,
          visitDateTime: '2026-08-18',
          sourceText: '기록 문장',
          normalizedText: '기록 문장',
          tags: [CareSection.PATIENT_INFORMATION],
          sectionHints: [CareSection.PATIENT_INFORMATION],
          terms: []
        }
      ] as any),
      runSectionAssessment: async () => ([
        {
          sectionId: CareSection.PATIENT_INFORMATION,
          status: 'READY',
          rationaleText: '기록으로 작성 가능',
          missingInfoBullets: [],
          recommendedQuestions: []
        }
      ] as any),
      runInitialSectionDrafts: async () => {
        initialDraftCallCount += 1;
        return [];
      },
      recomputeQuestionState: async () => {
        questionStateCallCount += 1;
        throw new Error('Question state generation must be deferred in study scaffold mode.');
      },
      updateCase: async (_caseId, updates) => {
        Object.assign(deferredStore, updates);
      }
    }
  });
  assert.equal(deferredResult.blocked, false);
  assert.equal(initialDraftCallCount, 0);
  assert.equal(questionStateCallCount, 0);
  assert.deepEqual(deferredStore.sectionDrafts, []);
  assert.deepEqual(deferredStore.draftsBySection, {});
  assert.equal(deferredStore.chainProgress.estimatedRemainingSteps[0], 'CHAIN3_STUDY_REVEAL');

  const generationCase: any = {
    ...deferredStore,
    scaffoldState: {
      preRevealSnapshots: [{ sectionId: CareSection.PATIENT_INFORMATION }]
    }
  };
  let generatedUpdates: any = null;
  const generatedDraft = await generateStudyScaffoldDraftAfterSnapshot(
    generationCase,
    CareSection.PATIENT_INFORMATION,
    {
      runInitialSectionDrafts: async (_evidence, _states, runtimeMeta) => {
        runtimeMeta?.onUsage?.({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
        return [
          {
            sectionId: CareSection.PATIENT_INFORMATION,
            evidenceCardIdsUsed: ['evidence-1'],
            timelineEventIdsUsed: [],
            draftText: '스냅샷 이후 생성된 초안',
            openIssues: [],
            evidenceLinks: [],
            unsupportedClaims: []
          }
        ];
      },
      updateCase: async (_caseId, updates) => {
        generatedUpdates = updates;
      }
    }
  );
  assert.equal(generatedDraft.draftText, '스냅샷 이후 생성된 초안');
  assert.equal(generatedDraft.generationMetadata.promptVersion, 'CHAIN3_STUDY_REVEAL:v1');
  assert.equal(generatedUpdates.sectionDrafts.length, 1);
  assert.equal(generatedUpdates.chainPerformanceLogs.at(-1).llmCallCount, 1);

  await assert.rejects(
    () => generateStudyScaffoldDraftAfterSnapshot(
      { ...generationCase, scaffoldState: { preRevealSnapshots: [] } },
      CareSection.PATIENT_INFORMATION,
      {
        runInitialSectionDrafts: async () => [],
        updateCase: async () => undefined
      }
    ),
    /snapshot must be saved/i
  );

  console.log('study mode tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
