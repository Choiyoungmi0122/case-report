import { CareSection, CaseMode, ResearchState } from '../types';
import { getVersionMetadata } from '../config/researchMetadata';
import { deidentifyEMR, createDeidReplacementContext } from '../deid';
import { KnownIdentifier } from '../deid/types';
import { PLACEHOLDER_PATTERN } from '../deid/publicationRenderer';

/**
 * Researcher-facing trajectory export for the expert formative study.
 *
 * Design constraints (expert formative study, not the student main study):
 * - Raw patient identifiers never leave the local DB, so the payload carries
 *   de-identified display text but never the raw `visits` array or local
 *   re-identification data.
 * - `participantCode` is treated as a pseudonym, exactly like the DB stores it.
 * - Everything else is read from what the pipeline already persists; this module
 *   introduces no new storage and no new version-control system.
 */

export type SectionQnaHistory = {
  sectionId: string;
  qnaHistory: Array<{ question: string; answer: string; timestamp?: string }>;
};

type BuildResearchExportParams = {
  caseId: string;
  caseData: any;
  researchState: ResearchState;
  sectionInteractions: SectionQnaHistory[];
};

/**
 * A stored DeidentifiedVisitRecord keeps `phiSpans` and `replacementMap` so the
 * original record can be reconstructed locally. Those two fields hold the RAW
 * identifiers, so they must never leave the server in a research export - only
 * the substituted text does. Counts and PHI types are kept because they carry
 * research value (de-identification coverage) without carrying identifiers.
 */
async function sanitizeDeidentifiedEMR(record: any, sanitizer: ResearchSanitizer) {
  return {
    visitIndex: record?.visitIndex,
    visitDate: record?.visitDate,
    emrId: record?.emrId,
    deidentifiedText: await sanitizer.text(record?.deidentifiedText),
    riskLevel: record?.riskLevel,
    phiSpanCount: Array.isArray(record?.phiSpans) ? record.phiSpans.length : 0,
    phiTypes: Array.isArray(record?.phiSpans)
      ? Array.from(new Set(record.phiSpans.map((span: any) => String(span?.type || '')).filter(Boolean)))
      : [],
    placeholders: Array.isArray(record?.phiSpans)
      ? Array.from(
          new Set(
            record.phiSpans
              .map((span: any) => String(span?.replacement || span?.placeholder || ''))
              .filter(Boolean)
          )
        )
      : []
  };
}

function getStoredPhiEntries(record: any): any[] {
  const spans = Array.isArray(record?.phiSpans) ? record.phiSpans : [];
  if (Array.isArray(record?.replacementMap)) return [...spans, ...record.replacementMap];
  if (!record?.replacementMap || typeof record.replacementMap !== 'object') return spans;

  const legacyEntries = Object.entries(record.replacementMap).map(([replacement, originalText]) => ({
    type: replacement.match(/^\[([A-Z][A-Z_]*)_\d+\]$/)?.[1],
    originalText,
    replacement
  }));
  return [...spans, ...legacyEntries];
}

function collectKnownIdentifiers(caseData: any): KnownIdentifier[] {
  const identifiers = new Map<string, KnownIdentifier>();
  for (const record of caseData?.deidentifiedEMRs || []) {
    for (const span of getStoredPhiEntries(record)) {
      const type = span?.type;
      const text = String(span?.originalText || span?.text || '').trim();
      if (!text || !['PATIENT_NAME', 'DOCTOR_NAME', 'HOSPITAL'].includes(type)) continue;
      identifiers.set(`${type}:${text}`, { type, text } as KnownIdentifier);
    }
  }
  return Array.from(identifiers.values());
}

function seedStoredReplacements(caseData: any, context: ReturnType<typeof createDeidReplacementContext>) {
  for (const record of caseData?.deidentifiedEMRs || []) {
    for (const entry of getStoredPhiEntries(record)) {
      const type = entry?.type as KnownIdentifier['type'] | undefined;
      const originalText = String(entry?.originalText || entry?.text || '').trim();
      const replacement = String(entry?.replacement || entry?.placeholder || '').trim();
      const match = replacement.match(/^\[([A-Z][A-Z_]*)_(\d+)\]$/);
      if (!type || !originalText || !match || match[1] !== type) continue;

      const key = `${type}:${originalText}`;
      if (!context.replacementByKey.has(key)) context.replacementByKey.set(key, replacement);
      context.countByType.set(type, Math.max(context.countByType.get(type) || 0, Number(match[2])));
    }
  }
}

type ResearchSanitizer = {
  text(value: unknown): Promise<string>;
  object<T>(value: T, options?: { skipKeys?: Set<string> }): Promise<T>;
};

function createResearchSanitizer(caseData: any): ResearchSanitizer {
  const sharedContext = createDeidReplacementContext();
  seedStoredReplacements(caseData, sharedContext);
  const knownIdentifiers = collectKnownIdentifiers(caseData);
  const cache = new Map<string, string>();

  async function sanitizeText(value: unknown): Promise<string> {
    const source = String(value ?? '');
    if (!source) return '';
    const cached = cache.get(source);
    if (cached !== undefined) return cached;

    const result = await deidentifyEMR(source, {
      sharedContext,
      knownIdentifiers,
      detectionProfile: 'research_export',
      preserveTerms: Array.from(new Set(source.match(PLACEHOLDER_PATTERN) || []))
    });
    cache.set(source, result.deidentifiedText);
    return result.deidentifiedText;
  }

  async function sanitizeObject<T>(value: T, options: { skipKeys?: Set<string> } = {}): Promise<T> {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return (await sanitizeText(value)) as T;
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value;

    if (Array.isArray(value)) {
      return (await Promise.all(value.map((item) => sanitizeObject(item, options)))) as T;
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = options.skipKeys?.has(key) ? item : await sanitizeObject(item, options);
    }
    return output as T;
  }

  return {
    text: sanitizeText,
    object: sanitizeObject
  };
}

async function sanitizeEvidenceCard(card: any, sanitizer: ResearchSanitizer) {
  return {
    id: card?.id,
    visitIndex: card?.visitIndex,
    visitDateTime: card?.visitDateTime,
    evidenceType: card?.evidenceType,
    sourceText: await sanitizer.text(card?.sourceText),
    normalizedText: await sanitizer.text(card?.normalizedText),
    tags: card?.tags || [],
    sectionHints: card?.sectionHints || [],
    sourceRef: card?.sourceRef,
    confidence: card?.confidence
  };
}

function sanitizePendingTermConfirmation(item: any) {
  return {
    pendingId: item?.pendingId,
    visitIndex: item?.visitIndex,
    visitDate: item?.visitDate,
    surface: item?.surface,
    normalizedTerm: item?.normalizedTerm,
    termId: item?.termId,
    category: item?.category,
    matchType: item?.matchType,
    confidence: item?.confidence,
    needsUserConfirmation: item?.needsUserConfirmation,
    candidates: item?.candidates || [],
    status: item?.status,
    decisionReuseKey: item?.decisionReuseKey,
    reuseEligible: item?.reuseEligible,
    confirmedTerm: item?.confirmedTerm,
    customReplacement: item?.customReplacement,
    resolvedAt: item?.resolvedAt
  };
}

function toIsoString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function firstEventTimestamp(researchState: ResearchState, eventType: string): string | undefined {
  const match = (researchState.interactionEvents || []).find((item) => item.eventType === eventType);
  return match?.timestamp;
}

function firstSectionEventTimestamp(events: any[], sectionId: string, eventType: string): string | undefined {
  const match = (events || []).find((item) => item.sectionId === sectionId && item.eventType === eventType);
  return match?.timestamp;
}

function durationMs(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

function nullIfMissing<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Timing summary for the expert session. This is supplementary data, not
 * behavioural-experiment grade instrumentation: every value is derived from
 * timestamps that the existing event log already records, and is `undefined`
 * whenever the corresponding event was never logged.
 */
function buildTimingSummary(researchState: ResearchState, caseData: any) {
  const startedAt = researchState.startedAt || firstEventTimestamp(researchState, 'session_start');
  const processedAt = firstEventTimestamp(researchState, 'case_processed');
  const finalViewedAt = firstEventTimestamp(researchState, 'final_output_viewed');
  const exportedAt = firstEventTimestamp(researchState, 'export_requested');

  const sectionOpenEvents = (researchState.interactionEvents || []).filter(
    (item) => item.eventType === 'section_opened' && item.sectionId
  );
  const questionAnsweredEvents = (researchState.interactionEvents || []).filter(
    (item) => item.eventType === 'question_answered'
  );

  return {
    startedAt,
    processedAt,
    finalManuscriptViewedAt: finalViewedAt,
    exportRequestedAt: exportedAt,
    completedAt: researchState.completedAt,
    totalSessionMs: durationMs(startedAt, researchState.completedAt),
    timeToProcessedMs: durationMs(startedAt, processedAt),
    timeToFinalManuscriptMs: durationMs(startedAt, finalViewedAt),
    sectionOpenCount: sectionOpenEvents.length,
    questionsAnsweredCount: questionAnsweredEvents.length,
    // Wall-clock spent inside each chain, already measured by the optimisation runtime.
    chainDurationsMs: (caseData.chainPerformanceLogs || []).map((log: any) => ({
      chain: log.chainName || log.chain,
      durationMs: log.durationMs,
      startedAt: log.startedAt,
      cacheHit: Boolean(log.cacheHit)
    }))
  };
}

function buildSectionTiming(scaffoldState: any, sectionId: string) {
  const events = scaffoldState?.interactionEvents || [];
  const reflection = (scaffoldState?.sectionReflections || []).find((item: any) => item.sectionId === sectionId);
  const progress = (scaffoldState?.sectionProgress || []).find((item: any) => item.sectionId === sectionId);
  const snapshot = (scaffoldState?.preRevealSnapshots || []).find((item: any) => item.sectionId === sectionId);

  const enteredAt = reflection?.firstOpenedAt || firstSectionEventTimestamp(events, sectionId, 'section_opened');
  const preRevealConfirmedAt =
    snapshot?.createdAt ||
    firstSectionEventTimestamp(events, sectionId, 'pre_reveal_snapshot_created') ||
    firstSectionEventTimestamp(events, sectionId, 'ai_draft_revealed');
  const aiRevealedAt =
    reflection?.draftRevealedAt || firstSectionEventTimestamp(events, sectionId, 'ai_draft_revealed');
  const postAiReviewStartedAt =
    firstSectionEventTimestamp(events, sectionId, 'post_ai_review_started') || aiRevealedAt;
  const postAiReviewCompletedAt =
    firstSectionEventTimestamp(events, sectionId, 'draft_review_completed') ||
    (progress?.draftReviewCompleted ? progress?.completedAt || reflection?.completedAt : undefined);
  const completedAt =
    reflection?.completedAt ||
    firstSectionEventTimestamp(events, sectionId, 'section_completed') ||
    progress?.completedAt;

  return {
    sectionTiming: {
      enteredAt: nullIfMissing(enteredAt),
      preRevealConfirmedAt: nullIfMissing(preRevealConfirmedAt),
      aiRevealedAt: nullIfMissing(aiRevealedAt),
      postAiReviewStartedAt: nullIfMissing(postAiReviewStartedAt),
      postAiReviewCompletedAt: nullIfMissing(postAiReviewCompletedAt),
      completedAt: nullIfMissing(completedAt)
    },
    durationSummary: {
      preAiReasoningMs: durationMs(enteredAt, preRevealConfirmedAt),
      postAiReviewMs: durationMs(aiRevealedAt, postAiReviewCompletedAt),
      sectionTotalMs: durationMs(enteredAt, completedAt)
    }
  };
}

function buildScaffoldSections(scaffoldState: any, sectionDrafts: any[]) {
  const ids = Array.from(
    new Set([
      ...(scaffoldState?.sectionProgress || []).map((item: any) => item.sectionId),
      ...(scaffoldState?.sectionReflections || []).map((item: any) => item.sectionId),
      ...(scaffoldState?.preRevealSnapshots || []).map((item: any) => item.sectionId),
      ...(sectionDrafts || []).map((item: any) => item.sectionId)
    ].filter(Boolean))
  );

  return ids.reduce((acc: Record<string, any>, sectionId: any) => {
    const draft = (sectionDrafts || []).find((item: any) => item.sectionId === sectionId);
    acc[String(sectionId)] = {
      generationMetadata: draft?.generationMetadata || null,
      ...buildSectionTiming(scaffoldState, String(sectionId))
    };
    return acc;
  }, {});
}

function deriveTechnicalIssues(caseData: any) {
  const manualIssues = Array.isArray(caseData.technicalIssues) ? caseData.technicalIssues : [];
  const aiFailures = (caseData.chainPerformanceLogs || [])
    .filter((log: any) => log?.error)
    .map((log: any) => ({
      type: 'ai_generation_failure',
      description: String(log.error || '').slice(0, 500),
      occurredAt: log.startedAt || log.endedAt || new Date().toISOString(),
      resolved: false
    }));
  return [...manualIssues, ...aiFailures];
}

/**
 * The Write trajectory is reconstructed from `answerUndoStack`, which the answer
 * route already writes: every entry holds the pre-answer snapshot of the section
 * drafts/states. Combined with the current (final) drafts this yields
 * `initial state -> user answer -> final state` without a new versioning system.
 *
 * Caveat surfaced to the researcher in `truncated`: the stack is capped at 20
 * entries by the answer route, so sessions with more than 20 answers lose the
 * earliest snapshots — including, in that case, the true initial draft.
 */
async function buildDraftTrajectory(caseData: any, sanitizer: ResearchSanitizer) {
  const undoStack: any[] = caseData.answerUndoStack || [];

  const steps = await Promise.all(undoStack.map(async (entry, index) => ({
    stepIndex: index,
    timestamp: entry.timestamp,
    kind: entry.kind,
    sectionId: entry.sectionId,
    question: await sanitizer.text(entry.question),
    draftsBeforeAnswer: await sanitizeSectionDrafts(entry.before?.sectionDrafts || [], sanitizer),
    sectionStatesBeforeAnswer: await sanitizer.object(entry.before?.sectionStates || []),
    commonMissingItemsBeforeAnswer: await sanitizer.object(entry.before?.commonMissingItems || []),
    commonQuestionSetsBeforeAnswer: await sanitizer.object(entry.before?.commonQuestionSets || [])
  })));

  return {
    // The oldest retained snapshot is the earliest draft state still recoverable.
    earliestRecoverableDrafts: steps[0]?.draftsBeforeAnswer || [],
    steps,
    truncated: undoStack.length >= 20,
    note:
      'Draft history is reconstructed from answerUndoStack (pre-answer snapshots, capped at 20 by the answer route). ' +
      'If truncated is true, the earliest draft state predates the retained window and is not recoverable.'
  };
}

async function sanitizeSectionDrafts(sectionDrafts: any[], sanitizer: ResearchSanitizer) {
  return Promise.all(
    (sectionDrafts || []).map(async (draft) => ({
      ...draft,
      draftText: await sanitizer.text(draft?.draftText),
      evidenceLinks: await sanitizer.object(draft?.evidenceLinks || []),
      unsupportedClaims: await sanitizer.object(draft?.unsupportedClaims || [])
    }))
  );
}

async function sanitizeSectionInteractions(sectionInteractions: SectionQnaHistory[], sanitizer: ResearchSanitizer) {
  return Promise.all(
    (sectionInteractions || []).map(async (section) => ({
      ...section,
      qnaHistory: await Promise.all(
        (section.qnaHistory || []).map(async (item) => ({
          ...item,
          question: await sanitizer.text(item.question),
          answer: await sanitizer.text(item.answer)
        }))
      )
    }))
  );
}

async function sanitizeScaffoldData(scaffoldState: any, sectionDrafts: any[], sanitizer: ResearchSanitizer) {
  if (!scaffoldState) return undefined;
  return {
    sessionId: scaffoldState.sessionId,
    participantCode: scaffoldState.participantCode,
    startedAt: scaffoldState.startedAt,
    completedAt: scaffoldState.completedAt,
    sectionProgress: scaffoldState.sectionProgress || [],
    sectionReflections: await sanitizer.object(scaffoldState.sectionReflections || [], {
      skipKeys: new Set(['sectionId', 'draftReviewStatus', 'firstOpenedAt', 'draftRevealedAt', 'completedAt'])
    }),
    preRevealSnapshots: await sanitizer.object(scaffoldState.preRevealSnapshots || [], {
      skipKeys: new Set([
        'sectionId',
        'createdAt',
        'itemId',
        'learnerItemId',
        'reviewItemId',
        'sourceType',
        'judgment',
        'evidenceIds',
        'sourceEvidenceIds',
        'selectedEvidenceIds',
        'id',
        'visitIndex'
      ])
    }),
    reviewItems: await sanitizer.object(scaffoldState.reviewItems || [], {
      skipKeys: new Set([
        'id',
        'sectionId',
        'sourceType',
        'judgment',
        'evidenceIds',
        'learnerItemId',
        'reviewItemId',
        'aiSentenceId',
        'sourceLearnerItemIds',
        'sourceEvidenceIds',
        'updatedAt'
      ])
    }),
    questionTaskResults: await sanitizer.object(scaffoldState.questionTaskResults || [], {
      skipKeys: new Set(['itemId', 'status', 'updatedAt'])
    }),
    instructorReviewItems: await sanitizer.object(scaffoldState.instructorReviewItems || []),
    additionalConfirmationItems: await sanitizer.object(scaffoldState.additionalConfirmationItems || []),
    caseMap: scaffoldState.caseMap
      ? await sanitizer.object(scaffoldState.caseMap, {
          skipKeys: new Set([
            'version',
            'currentPhase',
            'selectedEvidenceIds',
            'evidenceId',
            'role',
            'visitIndex',
            'visitDateTime',
            'evidenceFeedbackRevealedAt',
            'sourceEvidenceIds',
            'noteFeedbackRevealedAt',
            'id',
            'type',
            'evidenceIds',
            'targetSectionIds',
            'confidence',
            'createdAt',
            'updatedAt'
          ])
        })
      : undefined,
    interactionEvents: scaffoldState.interactionEvents || [],
    sections: buildScaffoldSections(scaffoldState, sectionDrafts || [])
  };
}

export async function buildResearchExportPayload(params: BuildResearchExportParams) {
  const { caseId, caseData, researchState, sectionInteractions } = params;

  const scaffoldState = caseData.scaffoldState || null;
  const sanitizer = createResearchSanitizer(caseData);
  const sanitizedSectionDrafts = await sanitizeSectionDrafts(caseData.sectionDrafts || [], sanitizer);

  return {
    schemaVersion: 'expert-formative-3',
    exportedAt: new Date().toISOString(),

    // --- identification -----------------------------------------------------
    caseId,
    experiment_code: caseData.experiment_code,
    experimentCode: caseData.experiment_code,
    participantCode: researchState.participantCode,
    sessionId: researchState.sessionId,
    mode: (caseData.mode || 'write') as CaseMode,
    title: caseData.title ? await sanitizer.text(caseData.title) : undefined,
    studyConfig: caseData.studyConfig || null,
    studyMetadata: caseData.studyMetadata || null,
    versionMetadata: {
      ...getVersionMetadata(caseData.studyConfig?.studyCaseId, caseData.studyConfig?.caseVersion),
      ...(caseData.versionMetadata || {})
    },
    caseInputValidation: caseData.caseInputValidation || null,
    sessionOutcome:
      caseData.sessionOutcome ||
      (researchState.completedAt || scaffoldState?.completedAt
        ? { status: 'completed' }
        : { status: 'in_progress' }),
    researcherAssistance: caseData.researcherAssistance || [],
    technicalIssues: deriveTechnicalIssues(caseData),
    createdAt: toIsoString(caseData.createdAt),
    startedAt: researchState.startedAt,
    completedAt: researchState.completedAt,

    // --- input (de-identified only; raw visits and the re-identification map
    //     are deliberately excluded) -----------------------------------------
    deidentifiedEMRs: await Promise.all(
      (caseData.deidentifiedEMRs || []).map((record: any) => sanitizeDeidentifiedEMR(record, sanitizer))
    ),
    timelineEvents: await sanitizer.object(caseData.timelineEvents || [], {
      skipKeys: new Set(['timelineEventId', 'visitNo', 'date', 'columnOrder'])
    }),
    deidentificationReview: caseData.reviewRequired || null,
    pendingTermConfirmations: (caseData.pendingTermConfirmations || []).map(sanitizePendingTermConfirmation),

    // --- AI pipeline output -------------------------------------------------
    evidenceCards: await Promise.all(
      (caseData.evidenceCards || []).map((card: any) => sanitizeEvidenceCard(card, sanitizer))
    ),
    sectionStates: await sanitizer.object(caseData.sectionStates || [], {
      skipKeys: new Set(['sectionId', 'status'])
    }),
    sectionDrafts: sanitizedSectionDrafts,
    commonMissingItems: await sanitizer.object(caseData.commonMissingItems || []),
    commonQuestionSets: await sanitizer.object(caseData.commonQuestionSets || [], {
      skipKeys: new Set(['targetSectionIds', 'category'])
    }),
    sectionAdequacyReviews: await sanitizer.object(caseData.sectionAdequacyReviews || {}),

    // --- user answers -------------------------------------------------------
    sectionQnaHistory: await sanitizeSectionInteractions(sectionInteractions, sanitizer),

    // --- version history ----------------------------------------------------
    draftTrajectory: await buildDraftTrajectory(caseData, sanitizer),

    // --- final output -------------------------------------------------------
    finalDraft: caseData.finalDraft
      ? await sanitizer.object(caseData.finalDraft, { skipKeys: new Set(['generationMetadata']) })
      : null,
    finalComposeStatus: caseData.finalComposeStatus || null,
    exportLogs: caseData.exportLogs || [],

    // --- behaviour ----------------------------------------------------------
    interactionEvents: researchState.interactionEvents || [],
    timing: buildTimingSummary(researchState, caseData),

    // --- scaffold-only ------------------------------------------------------
    scaffoldData: await sanitizeScaffoldData(scaffoldState, sanitizedSectionDrafts, sanitizer)
  };
}

function escapeCsvValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildResearchEventCsv(params: {
  caseId: string;
  experimentCode?: string;
  mode: CaseMode;
  researchState: ResearchState;
}): string {
  const lines = [
    ['participantCode', 'sessionId', 'mode', 'caseId', 'experiment_code', 'sectionId', 'eventType', 'timestamp', 'metadata'].join(',')
  ];

  for (const event of params.researchState.interactionEvents || []) {
    lines.push(
      [
        params.researchState.participantCode || '',
        params.researchState.sessionId || '',
        params.mode,
        params.caseId,
        params.experimentCode || '',
        (event.sectionId as CareSection | undefined) || '',
        event.eventType,
        event.timestamp,
        JSON.stringify(event.metadata || {})
      ]
        .map(escapeCsvValue)
        .join(',')
    );
  }

  return lines.join('\n');
}
