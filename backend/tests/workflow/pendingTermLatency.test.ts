import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  mutatePendingTermDecision,
  reprocessCaseFromStoredTerms,
  schedulePendingTermReprocess
} from '../../src/routes/cases';

const GUIBO = '귀보탕';
const GUIBI = '귀비탕';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function createFakeCaseStore(overrides?: Record<string, any>) {
  const state: any = {
    id: 'case_latency',
    createdAt: '2026-08-24T09:00:00.000Z',
    mode: 'write',
    title: 'Latency Test Case',
    visits: [
      {
        visitIndex: 1,
        visitDateTime: '2026-08-20',
        sanitizedText: `${GUIBO} 복용 후 수면이 호전됨`
      }
    ],
    pendingTermConfirmations: [
      {
        pendingId: 'pending_1',
        termId: 'term_guibo',
        surface: GUIBO,
        normalizedTerm: GUIBO,
        sourceText: `${GUIBO} 복용 후 수면이 호전됨`,
        category: 'herbal_formula',
        visitIndex: 1,
        confidence: 0.61,
        candidates: [{ termId: 'term_guibi', standardTerm: GUIBI, confidence: 0.96 }],
        status: 'PENDING',
        needsUserConfirmation: true
      }
    ],
    chainProgress: null,
    chainCache: {},
    chainPerformanceLogs: [],
    sectionStates: [
      {
        sectionId: 'PATIENT_INFORMATION',
        status: 'INCOMPLETE',
        rationaleText: 'initial',
        missingInfoBullets: [],
        recommendedQuestions: []
      }
    ],
    sectionDrafts: [
      {
        sectionId: 'PATIENT_INFORMATION',
        draftText: '기존 초안',
        evidenceCardIdsUsed: [],
        openIssues: [],
        unsupportedClaims: [],
        evidenceLinks: []
      }
    ],
    draftsBySection: {
      PATIENT_INFORMATION: '기존 초안'
    },
    commonMissingItems: [],
    commonQuestionSets: [],
    finalComposeStatus: {
      status: 'IDLE'
    },
    finalDraft: {
      title: '기존 원고',
      sections: []
    },
    staleState: null,
    processingCache: null,
    timelineEvents: [],
    reviewRequired: null,
    sectionAdequacyReviews: {}
  };

  const store = clone({ ...state, ...(overrides || {}) });
  const model = {
    async getCase(id: string) {
      assert.equal(id, store.id);
      return clone(store);
    },
    async updateCase(id: string, updates: Record<string, any>) {
      assert.equal(id, store.id);
      Object.assign(store, clone(updates));
    }
  };

  return { store, model };
}

async function runSyntheticStageTimingMeasurement() {
  const { store, model } = createFakeCaseStore({
    pendingTermConfirmations: [
      {
        pendingId: 'pending_1',
        termId: 'term_guibo',
        surface: GUIBO,
        normalizedTerm: GUIBI,
        sourceText: `${GUIBO} 복용 후 수면이 호전됨`,
        category: 'herbal_formula',
        visitIndex: 1,
        confidence: 0.61,
        candidates: [{ termId: 'term_guibi', standardTerm: GUIBI, confidence: 0.96 }],
        status: 'CONFIRMED',
        confirmedTerm: GUIBI,
        needsUserConfirmation: false
      }
    ],
    finalDraft: null
  });

  const stageTimings = new Map<string, number>();
  await reprocessCaseFromStoredTerms({
    caseId: store.id,
    caseData: store,
    staleReason: 'TERM_CONFIRMATION_UPDATED',
    onStageTiming: (timing) => {
      stageTimings.set(timing.stage, timing.durationMs);
    },
    dependencies: {
      preprocessVisitsForChain1: async () => {
        await sleep(35);
        return {
          deidentifiedEMRs: [],
          deidentifiedVisits: [],
          preparedVisits: [
            {
              index: 1,
              date: '2026-08-20',
              text: `${GUIBO} 복용 후 수면이 호전됨`,
              normalizedText: `${GUIBI} 복용 후 수면이 호전됨`,
              clauses: []
            }
          ],
          pendingTermConfirmations: clone(store.pendingTermConfirmations),
          reviewRequired: null
        } as any;
      },
      runEvidenceSplit: async () => {
        await sleep(55);
        return [
          {
            id: 'evidence_1',
            visitIndex: 1,
            visitDateTime: '2026-08-20',
            sourceText: `${GUIBO} 복용 후 수면이 호전됨`,
            normalizedText: `${GUIBI} 복용 후 수면이 호전됨`,
            tags: ['PATIENT_INFORMATION'],
            sectionHints: ['PATIENT_INFORMATION'],
            terms: []
          }
        ] as any;
      },
      runSectionAssessment: async () => {
        await sleep(45);
        return [
          {
            sectionId: 'PATIENT_INFORMATION',
            status: 'READY',
            rationaleText: 'synthetic assessment',
            missingInfoBullets: [],
            recommendedQuestions: []
          }
        ] as any;
      },
      runInitialSectionDrafts: async () => {
        await sleep(50);
        return [
          {
            sectionId: 'PATIENT_INFORMATION',
            draftText: `${GUIBI} 복용 후 수면이 호전되었다.`,
            evidenceCardIdsUsed: ['evidence_1'],
            openIssues: [],
            unsupportedClaims: [],
            evidenceLinks: []
          }
        ] as any;
      },
      recomputeQuestionState: async (params) => {
        await sleep(30);
        await sleep(40);
        return {
          sectionStates: clone(params.sectionStates),
          sectionDrafts: clone(params.sectionDrafts),
          commonMissingItems: [],
          commonQuestionSets: [],
          cacheMeta: {
            chain4InputHash: 'chain4_hash',
            chain5InputHash: 'chain5_hash',
            chain4CacheHit: false,
            chain5CacheHit: false,
            chain4DurationMs: 30,
            chain5DurationMs: 40
          }
        } as any;
      },
      updateCase: async (caseId, updates) => {
        await sleep(12);
        await model.updateCase(caseId, updates);
      }
    }
  });

  const requiredStages = [
    'preprocessing',
    'chain1',
    'chain2',
    'chain3',
    'chain4',
    'chain5',
    'final_db_save',
    'total'
  ];
  for (const stage of requiredStages) {
    assert.ok(stageTimings.has(stage), `missing timing for ${stage}`);
  }

  console.log(
    'PENDING_TERM_STAGE_TIMINGS',
    JSON.stringify(
      Object.fromEntries(
        Array.from(stageTimings.entries()).map(([stage, durationMs]) => [
          stage,
          Number(durationMs.toFixed(2))
        ])
      )
    )
  );
}

async function runBeforeAfterHttpMeasurement() {
  const simulatedReprocessMs = 260;
  const syncStore = createFakeCaseStore();
  const syncStart = performance.now();
  const syncResult = await mutatePendingTermDecision(
    {
      caseId: syncStore.store.id,
      pendingId: 'pending_1',
      action: 'confirm',
      confirmedTerm: GUIBI
    },
    {
      caseModel: syncStore.model as any,
      getTerminologyRuntime: () => ({ semanticMatcher: undefined, llmResolver: undefined }) as any,
      scheduleReprocess: async () => {
        await sleep(simulatedReprocessMs);
        await syncStore.model.updateCase(syncStore.store.id, {
          chainProgress: null,
          draftsBySection: { PATIENT_INFORMATION: `${GUIBI} 반영 완료` },
          finalDraft: null
        });
        return { started: true };
      }
    }
  );
  const beforeHttpMs = performance.now() - syncStart;

  assert.equal(syncResult.httpStatus, 202);
  assert.equal(syncStore.store.pendingTermConfirmations[0].confirmedTerm, GUIBI);

  const asyncStore = createFakeCaseStore();
  let resolveBackground: (() => void) | null = null;
  const backgroundFinished = new Promise<void>((resolve) => {
    resolveBackground = resolve;
  });
  const asyncStart = performance.now();
  const asyncResult = await mutatePendingTermDecision(
    {
      caseId: asyncStore.store.id,
      pendingId: 'pending_1',
      action: 'confirm',
      confirmedTerm: GUIBI
    },
    {
      caseModel: asyncStore.model as any,
      getTerminologyRuntime: () => ({ semanticMatcher: undefined, llmResolver: undefined }) as any,
      scheduleReprocess: async () => {
        void (async () => {
          await sleep(simulatedReprocessMs);
          await asyncStore.model.updateCase(asyncStore.store.id, {
            chainProgress: null,
            draftsBySection: { PATIENT_INFORMATION: `${GUIBI} 반영 완료` },
            sectionStates: [
              {
                sectionId: 'PATIENT_INFORMATION',
                status: 'READY',
                rationaleText: 'updated',
                missingInfoBullets: [],
                recommendedQuestions: []
              }
            ],
            finalDraft: null
          });
          resolveBackground?.();
        })();

        return { started: true };
      }
    }
  );
  const afterHttpMs = performance.now() - asyncStart;

  assert.equal(asyncResult.httpStatus, 202);
  assert.equal(asyncStore.store.pendingTermConfirmations[0].confirmedTerm, GUIBI);
  assert.equal(asyncStore.store.chainProgress?.currentStep, 'PREPROCESS');

  await backgroundFinished;
  assert.equal(asyncStore.store.draftsBySection.PATIENT_INFORMATION, `${GUIBI} 반영 완료`);
  assert.ok(beforeHttpMs >= simulatedReprocessMs * 0.85);
  assert.ok(afterHttpMs < 80);

  console.log(
    'PENDING_TERM_HTTP_TIMINGS',
    JSON.stringify({
      beforeHttpMs: Number(beforeHttpMs.toFixed(2)),
      afterHttpMs: Number(afterHttpMs.toFixed(2)),
      totalReprocessMs: simulatedReprocessMs
    })
  );
}

async function runBackgroundSchedulerTests() {
  const failureStore = createFakeCaseStore({
    pendingTermConfirmations: [
      {
        pendingId: 'pending_1',
        termId: 'term_guibo',
        surface: GUIBO,
        normalizedTerm: GUIBI,
        sourceText: `${GUIBO} 복용 후 수면이 호전됨`,
        category: 'herbal_formula',
        visitIndex: 1,
        confidence: 0.61,
        candidates: [{ termId: 'term_guibi', standardTerm: GUIBI, confidence: 0.96 }],
        status: 'CONFIRMED',
        confirmedTerm: GUIBI,
        needsUserConfirmation: false
      }
    ],
    chainProgress: {
      currentStep: 'PREPROCESS',
      completedSteps: [],
      estimatedRemainingSteps: ['CHAIN1', 'CHAIN2'],
      updatedAt: '2026-08-24T09:01:00.000Z'
    }
  });
  await schedulePendingTermReprocess(
    {
      caseId: failureStore.store.id
    },
    {
      caseModel: failureStore.model as any,
      reprocessCase: async () => {
        await sleep(10);
        throw new Error('synthetic reprocess failure');
      }
    }
  );
  await sleep(40);
  assert.equal(failureStore.store.pendingTermConfirmations[0].confirmedTerm, GUIBI);
  assert.equal(failureStore.store.chainProgress, null);
  assert.equal(failureStore.store.staleState?.staleReason, 'TERM_CONFIRMATION_UPDATED');

  const queueStore = createFakeCaseStore({
    pendingTermConfirmations: [
      {
        pendingId: 'pending_1',
        termId: 'term_guibo',
        surface: GUIBO,
        normalizedTerm: GUIBI,
        sourceText: `${GUIBO} 복용 후 수면이 호전됨`,
        category: 'herbal_formula',
        visitIndex: 1,
        confidence: 0.61,
        candidates: [{ termId: 'term_guibi', standardTerm: GUIBI, confidence: 0.96 }],
        status: 'CONFIRMED',
        confirmedTerm: GUIBI,
        needsUserConfirmation: false
      }
    ]
  });

  const seenConfirmedTerms: string[] = [];
  const firstRun = schedulePendingTermReprocess(
    {
      caseId: queueStore.store.id
    },
    {
      caseModel: queueStore.model as any,
      reprocessCase: async ({ caseData }) => {
        seenConfirmedTerms.push(caseData.pendingTermConfirmations[0].confirmedTerm);
        await sleep(35);
      }
    }
  );
  await sleep(5);
  await queueStore.model.updateCase(queueStore.store.id, {
    pendingTermConfirmations: [
      {
        ...queueStore.store.pendingTermConfirmations[0],
        confirmedTerm: `${GUIBI}-재확인`
      }
    ]
  });
  const secondRun = await schedulePendingTermReprocess(
    {
      caseId: queueStore.store.id
    },
    {
      caseModel: queueStore.model as any,
      reprocessCase: async ({ caseData }) => {
        seenConfirmedTerms.push(caseData.pendingTermConfirmations[0].confirmedTerm);
        await sleep(35);
      }
    }
  );
  const firstResult = await firstRun;
  await sleep(90);

  assert.equal(firstResult.started, true);
  assert.equal(secondRun.started, false);
  assert.deepEqual(seenConfirmedTerms, [GUIBI, `${GUIBI}-재확인`]);

  const duplicateStore = createFakeCaseStore();
  const duplicateFirst = await mutatePendingTermDecision(
    {
      caseId: duplicateStore.store.id,
      pendingId: 'pending_1',
      action: 'confirm',
      confirmedTerm: GUIBI
    },
    {
      caseModel: duplicateStore.model as any,
      getTerminologyRuntime: () => ({ semanticMatcher: undefined, llmResolver: undefined }) as any,
      scheduleReprocess: async () => ({ started: true })
    }
  );
  const duplicateSecond = await mutatePendingTermDecision(
    {
      caseId: duplicateStore.store.id,
      pendingId: 'pending_1',
      action: 'confirm',
      confirmedTerm: GUIBI
    },
    {
      caseModel: duplicateStore.model as any,
      getTerminologyRuntime: () => ({ semanticMatcher: undefined, llmResolver: undefined }) as any,
      scheduleReprocess: async () => ({ started: false })
    }
  );

  assert.equal(duplicateFirst.httpStatus, 202);
  assert.equal(duplicateSecond.httpStatus, 202);
  assert.equal(duplicateStore.store.pendingTermConfirmations.length, 1);
  assert.equal(duplicateStore.store.pendingTermConfirmations[0].confirmedTerm, GUIBI);

  console.log('PENDING_TERM_REGRESSION_TESTS', 'passed');
}

async function run() {
  await runSyntheticStageTimingMeasurement();
  await runBeforeAfterHttpMeasurement();
  await runBackgroundSchedulerTests();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
