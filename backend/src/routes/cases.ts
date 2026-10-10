import express, { Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { performance } from 'node:perf_hooks';
import { CaseModel } from '../models/caseModel';
import {
  Visit,
  CareSection,
  QnAPair,
  CaseMode,
  ResearchEvent,
  ResearchEventType,
  ResearchState,
  StudyConfig
} from '../types';
import {
  createOutboundDeidContext,
  deidentifyDraftsForOutbound,
  deidentifyOutboundField,
  deidentifyQnaForOutbound,
  deidentifyQnaMapForOutbound,
  deidentifyTimelineEventsForOutbound
} from '../deid/outbound';
import { exportCaseToDocx } from '../export/docxExporter';
import { buildResearchEventCsv, buildResearchExportPayload } from '../export/researchExport';
import { ExportLayout, ExportMode } from '../export/types';
import {
  appendPerformanceLog,
  buildChainCacheEntry,
  buildChainProgress,
  buildPerformanceLog,
  hasChainCacheHit,
  hashJoinedParts
} from '../optimization/chainRuntime';
import { parseTimelineWorkbook } from '../timelineImport/parser';
import { buildEvidenceCardsFromTimelineEvents, integrateImportedTimelineIntoDrafts } from '../timelineImport/integration';
import { summarizeError } from '../utils/errorSummary';
import { buildContentDispositionHeader } from '../utils/unicode';
import { normalizeQuestionComparisonKey, normalizeQuestionText } from '../questions/questionTemplates';
import { getWriteTerminologyRuntime } from '../rag/runtime';
import {
  preprocessVisitsForChain1,
  runEvidenceSplit,
  runInitialSectionDrafts,
  runQuestionGeneration,
  runSectionAssessment,
  runSectionDraftUpdate,
  runSectionMissingDetection,
  runFinalManuscriptCompose,
  getModelForChain
} from '../llm/chains';
import { chain3SystemPrompt, buildChain3UserPrompt } from '../llm/prompts/chain3_draft';
import { chain7SystemPrompt } from '../llm/prompts/chain7_final';
import { buildGenerationMetadata, getVersionMetadata, hashPromptParts } from '../config/researchMetadata';
import { DEFAULT_STUDY_CASE_ID, DEFAULT_STUDY_CASE_VERSION, getStudyCaseTemplate } from '../study/cases/defaultStudyCase';
import { getFixedStudyCaseAnalysis } from '../study/cases/studyCaseSnapshot';
import { getFrozenStudyCaseResult } from '../study/cases/studyCaseFrozen';

const router = express.Router();
const caseModel = new CaseModel();
const upload = multer({ storage: multer.memoryStorage() });
const runningFinalComposeJobs = new Map<string, Promise<void>>();
const runningPendingTermReprocessJobs = new Map<string, Promise<void>>();
const queuedPendingTermReprocessCaseIds = new Set<string>();

const ALL_CARE_SECTIONS = Object.values(CareSection) as CareSection[];
const CORE_AI_SECTIONS: CareSection[] = [
  CareSection.PATIENT_INFORMATION,
  CareSection.CLINICAL_FINDINGS,
  CareSection.TIMELINE,
  CareSection.DIAGNOSTIC_ASSESSMENT,
  CareSection.THERAPEUTIC_INTERVENTIONS,
  CareSection.FOLLOW_UP_OUTCOMES,
  CareSection.PATIENT_PERSPECTIVE
];
const COMMON_QUESTION_SECTIONS: CareSection[] = [
  ...CORE_AI_SECTIONS,
  CareSection.DISCUSSION_CONCLUSION
];
const NON_CORE_GENERATED_SECTIONS: CareSection[] = [
  CareSection.TITLE,
  CareSection.ABSTRACT,
  CareSection.INTRODUCTION,
  CareSection.DISCUSSION_CONCLUSION,
  CareSection.INFORMED_CONSENT
];
const COMMON_INTERACTION_KEY = '__COMMON__';

function isCareSection(value: string): value is CareSection {
  return ALL_CARE_SECTIONS.includes(value as CareSection);
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function appendExportLog(existing: any[], entry: any) {
  return [...(existing || []), entry].slice(-100);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.min(limit, items.length || 1));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runNext = async (): Promise<void> => {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  };

  const runners = Array.from({ length: safeLimit }, () => runNext());
  await Promise.all(runners);
  return results;
}

function mergeEvidenceCards(existing: any[], imported: any[]) {
  const merged = new Map<string, any>();
  for (const card of [...(existing || []), ...(imported || [])]) {
    if (!card?.id) continue;
    merged.set(card.id, card);
  }
  return Array.from(merged.values());
}

function normalizeQuestionKey(text: string): string {
  return normalizeQuestionComparisonKey(text);
}

function tokenizeQuestion(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'\-]/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isSameQuestion(a: string, b: string): boolean {
  const keyA = normalizeQuestionKey(a);
  const keyB = normalizeQuestionKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = keyA.length > keyB.length ? keyA : keyB;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;

  const tokensA = new Set(tokenizeQuestion(a));
  const tokensB = new Set(tokenizeQuestion(b));
  const overlap = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  const jaccard = overlap / Math.max(tokensA.size + tokensB.size - overlap, 1);
  return jaccard >= 0.72;
}

function deriveDraftMapFromSectionDrafts(
  sectionDrafts: any[],
  existingDraftsBySection?: Record<string, string>
): Record<string, string> {
  return (sectionDrafts || []).reduce((acc: Record<string, string>, draft: any) => {
    if (draft && typeof draft.sectionId === 'string') {
      acc[draft.sectionId] = draft.draftText || '';
    }
    return acc;
  }, { ...(existingDraftsBySection || {}) });
}

function buildSectionsOverview(sectionStates: any[], sectionDrafts: any[]) {
  return (sectionStates || []).map((state: any) => {
    const draft = (sectionDrafts || []).find((item: any) => item.sectionId === state.sectionId);
    return {
      section: state.sectionId,
      status: state.status,
      rationaleText: state.rationaleText,
      draftSnippet: draft?.draftText?.slice(0, 200) || ''
    };
  });
}

function buildCommonQuestionItems(commonQuestionSets: any[]) {
  return (commonQuestionSets || []).map((entry: any) => ({
    question: normalizeQuestionText(entry.question, entry.category),
    category: entry.category
  }));
}

function buildCaseStateResponse(caseData: any, overrides?: Partial<Record<string, any>>) {
  const merged = {
    draftsBySection: deriveDraftMapFromSectionDrafts(
      overrides?.sectionDrafts || caseData.sectionDrafts || [],
      overrides?.draftsBySection || caseData.draftsBySection || {}
    ),
    sectionStates: overrides?.sectionStates || caseData.sectionStates || [],
    commonMissingItems: overrides?.commonMissingItems || caseData.commonMissingItems || [],
    commonQuestionSets: overrides?.commonQuestionSets || caseData.commonQuestionSets || [],
    pendingTermConfirmations:
      overrides?.pendingTermConfirmations || caseData.pendingTermConfirmations || [],
    reviewRequired:
      overrides?.reviewRequired !== undefined ? overrides.reviewRequired : caseData.reviewRequired || null,
    staleState: overrides?.staleState !== undefined ? overrides.staleState : caseData.staleState || null,
    finalComposeStatus:
      overrides?.finalComposeStatus !== undefined
        ? overrides.finalComposeStatus
        : caseData.finalComposeStatus || { status: caseData.finalDraft ? 'COMPLETED' : 'IDLE' },
    finalDraft: overrides?.finalDraft !== undefined ? overrides.finalDraft : caseData.finalDraft || null,
    timelineEvents: overrides?.timelineEvents || caseData.timelineEvents || [],
    scaffoldState:
      overrides?.scaffoldState !== undefined ? overrides.scaffoldState : caseData.scaffoldState || null,
    researchState:
      overrides?.researchState !== undefined ? overrides.researchState : caseData.researchState || null,
    studyConfig:
      overrides?.studyConfig !== undefined ? overrides.studyConfig : caseData.studyConfig || null
  };

  return {
    mode: (caseData.mode || 'write') as CaseMode,
    draftsBySection: merged.draftsBySection,
    sectionStates: merged.sectionStates,
    commonMissingItems: merged.commonMissingItems,
    commonQuestionSets: merged.commonQuestionSets,
    sectionsOverview: buildSectionsOverview(merged.sectionStates, overrides?.sectionDrafts || caseData.sectionDrafts || []),
    pendingTermConfirmations: merged.pendingTermConfirmations,
    reviewRequired: merged.reviewRequired,
    staleState: merged.staleState,
    finalComposeStatus: merged.finalComposeStatus,
    finalDraft: merged.finalDraft,
    timelineEvents: merged.timelineEvents,
    scaffoldState: merged.scaffoldState,
    researchState: merged.researchState,
    studyConfig: merged.studyConfig
  };
}

function buildCaseSummaryResponseWithOptions(
  caseData: any,
  options: {
    includeDeidentifiedEMRs?: boolean;
    includePerformanceLogs?: boolean;
    includePendingTerms?: boolean;
  }
) {
  return {
    id: caseData.id,
    experiment_code: caseData.experiment_code,
    experimentCode: caseData.experiment_code,
    createdAt: caseData.createdAt,
    title: caseData.title || undefined,
    visits: [],
    deidentifiedEMRs: options.includeDeidentifiedEMRs === false ? [] : caseData.deidentifiedEMRs || [],
    chainProgress: caseData.chainProgress || null,
    chainPerformanceLogs:
      options.includePerformanceLogs === false ? [] : caseData.chainPerformanceLogs || [],
    ...buildCaseStateResponse(caseData),
    pendingTermConfirmations:
      options.includePendingTerms === false ? [] : caseData.pendingTermConfirmations || []
  };
}

type ReprocessStageName =
  | 'confirmation_save'
  | 'preprocessing'
  | 'chain1'
  | 'chain2'
  | 'chain3'
  | 'chain4'
  | 'chain5'
  | 'final_db_save'
  | 'total';

type ReprocessStageTiming = {
  stage: ReprocessStageName;
  durationMs: number;
};

function createStageTimer(onStageTiming?: (timing: ReprocessStageTiming) => void) {
  return async function measureStage<T>(
    stage: ReprocessStageName,
    work: () => Promise<T>
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await work();
    } finally {
      onStageTiming?.({
        stage,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100
      });
    }
  };
}

function buildCondensedQnaHistory(params: {
  sectionQnaHistory: QnAPair[];
  commonQnaHistory: QnAPair[];
  question: string;
  answer: string;
}) {
  const sectionTail = (params.sectionQnaHistory || []).slice(-3);
  const commonTail = (params.commonQnaHistory || []).slice(-2);
  const currentEntry = {
    question: params.question,
    answer: params.answer,
    timestamp: new Date().toISOString()
  };

  return uniqueStrings(
    [...sectionTail, ...commonTail, currentEntry].map((item) => JSON.stringify(item))
  ).map((item) => JSON.parse(item));
}

function upsertSectionDraftText(sectionDrafts: any[], sectionId: CareSection, draftText: string) {
  const existing = (sectionDrafts || []).find((draft: any) => draft.sectionId === sectionId);
  if (existing) {
    existing.draftText = draftText;
    existing.openIssues = existing.openIssues || [];
    existing.evidenceCardIdsUsed = existing.evidenceCardIdsUsed || [];
    existing.evidenceLinks = existing.evidenceLinks || [];
    existing.unsupportedClaims = existing.unsupportedClaims || [];
    return;
  }

  sectionDrafts.push({
    sectionId,
    draftText,
    evidenceCardIdsUsed: [],
    timelineEventIdsUsed: [],
    openIssues: [],
    evidenceLinks: [],
    unsupportedClaims: []
  });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function buildInitialScaffoldState(caseId: string, metadata?: any) {
  const timestamp = new Date().toISOString();
  const sessionId =
    typeof metadata?.sessionId === 'string' && metadata.sessionId.trim()
      ? metadata.sessionId.trim()
      : `scaffold_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const participantCode =
    typeof metadata?.participantCode === 'string' && metadata.participantCode.trim()
      ? metadata.participantCode.trim()
      : undefined;

  const baseEvent = {
    caseId,
    mode: 'scaffold' as const,
    sessionId,
    participantCode
  };

  return {
    reviewItems: [],
    sectionProgress: [],
    instructorReviewItems: [],
    additionalConfirmationItems: [],
    sectionReflections: [],
    interactionEvents: [
      {
        ...baseEvent,
        eventType: 'session_start',
        timestamp,
        metadata: { source: 'case_create' }
      },
      {
        ...baseEvent,
        eventType: 'case_created',
        timestamp
      },
      {
        ...baseEvent,
        eventType: 'mode_selected',
        timestamp,
        metadata: { selectedMode: 'scaffold' }
      }
    ],
    sessionId,
    participantCode,
    startedAt: timestamp
  };
}

function emptyResearchState(studyMode = false): ResearchState {
  return {
    studyMode,
    interactionEvents: []
  };
}

export function normalizeResearchState(raw: any, studyMode = false): ResearchState {
  const base = raw || {};
  return {
    studyMode: Boolean(base.studyMode ?? studyMode),
    participantCode: typeof base.participantCode === 'string' ? base.participantCode : undefined,
    sessionId: typeof base.sessionId === 'string' ? base.sessionId : undefined,
    startedAt: typeof base.startedAt === 'string' ? base.startedAt : undefined,
    completedAt: typeof base.completedAt === 'string' ? base.completedAt : undefined,
    interactionEvents: Array.isArray(base.interactionEvents) ? base.interactionEvents : []
  };
}

/**
 * A case is research-tracked when it carries a research session, regardless of
 * whether it is a locked study condition. Expert formative sessions attach a
 * participantCode/sessionId without `studyConfig.studyMode`, so that the
 * scaffold reveal gate - whose required pre-AI activities are exactly what the
 * expert study is meant to decide - is not enforced on them.
 */
export function isResearchTracked(researchState: ResearchState): boolean {
  return Boolean(researchState.studyMode || researchState.sessionId);
}

function sanitizeResearchMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const blockedKeys = new Set([
    'soapText',
    'sourceText',
    'sourceTextPreview',
    'draftText',
    'draftSentence',
    'finalDraft',
    'visits',
    'rawText',
    'evidenceText',
    'preview'
  ]);

  const entries = Object.entries(metadata as Record<string, unknown>)
    .filter(([key]) => key && !blockedKeys.has(key))
    .map(([key, value]) => {
      if (typeof value === 'string') return [key, value.slice(0, 500)];
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [key, value];
      if (Array.isArray(value)) return [key, value.slice(0, 20)];
      if (typeof value === 'object') return [key, JSON.parse(JSON.stringify(value))];
      return [key, String(value)];
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function appendResearchEvent(
  researchState: ResearchState,
  event: Omit<ResearchEvent, 'timestamp'> & { timestamp?: string }
): ResearchState {
  const timestamp = event.timestamp || new Date().toISOString();
  const nextEvent: ResearchEvent = {
    ...event,
    timestamp
  };

  if ((researchState.interactionEvents || []).some((item) => item.eventId === nextEvent.eventId)) {
    return researchState;
  }

  return {
    ...researchState,
    participantCode: nextEvent.participantCode || researchState.participantCode,
    sessionId: nextEvent.sessionId || researchState.sessionId,
    startedAt:
      nextEvent.eventType === 'session_start'
        ? researchState.startedAt || timestamp
        : researchState.startedAt,
    completedAt:
      nextEvent.eventType === 'session_completed'
        ? researchState.completedAt || timestamp
        : researchState.completedAt,
    interactionEvents: [...(researchState.interactionEvents || []), nextEvent].slice(-4000)
  };
}

export function buildInitialResearchState(params: {
  caseId: string;
  mode: CaseMode;
  studyMode: boolean;
  sessionId?: string;
  participantCode?: string;
  studyCaseId?: string;
}) {
  const timestamp = new Date().toISOString();
  const sessionId =
    params.sessionId || `study_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const baseEvent = {
    caseId: params.caseId,
    mode: params.mode,
    participantCode: params.participantCode,
    sessionId
  };

  let state = emptyResearchState(params.studyMode);
  state = appendResearchEvent(state, {
    ...baseEvent,
    eventId: randomUUID(),
    eventType: 'session_start',
    timestamp,
    metadata: params.studyCaseId ? { studyCaseId: params.studyCaseId } : undefined
  });
  state = appendResearchEvent(state, {
    ...baseEvent,
    eventId: randomUUID(),
    eventType: 'case_created',
    timestamp,
    metadata: params.studyCaseId ? { studyCaseId: params.studyCaseId } : undefined
  });
  state = appendResearchEvent(state, {
    ...baseEvent,
    eventId: randomUUID(),
    eventType: 'mode_assigned',
    timestamp,
    metadata: { selectedMode: params.mode }
  });
  return state;
}

export function buildStudySessionId(params: {
  participantCode: string;
  mode: CaseMode;
  studyCaseId: string;
}) {
  return `study_${params.studyCaseId}_${params.mode}_${params.participantCode}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeExperimentCodeForMode(value: unknown, mode: CaseMode): string | null {
  const prefix = mode === 'scaffold' ? 'SQ' : 'EQ';
  const raw = String(value || '').trim();
  if (!raw) return null;

  const compact = raw.replace(/-/g, '').toUpperCase();
  const match = compact.match(new RegExp(`^${prefix}0*(\\d+)$`));
  if (!match) {
    // 한글 이름도 번호로 쓸 수 있게 한다. 띄어쓰기는 한 칸으로 줄인다 (예: '홍길동 1').
    const customCode = raw.replace(/\s+/g, ' ').toUpperCase();
    return /^[A-Z0-9가-힣][A-Z0-9가-힣_\- ]{0,63}$/.test(customCode) ? customCode : null;
  }

  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return null;

  return `${prefix}${String(number).padStart(3, '0')}`;
}

function normalizeStudyConfig(raw: any): StudyConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    studyMode: Boolean(raw.studyMode),
    studyCaseId: typeof raw.studyCaseId === 'string' ? raw.studyCaseId : undefined,
    participantCode: typeof raw.participantCode === 'string' ? raw.participantCode : undefined,
    condition: raw.condition === 'scaffold' ? 'scaffold' : raw.condition === 'write' ? 'write' : undefined,
    lockedMode: raw.lockedMode !== false,
    fixedCase: raw.fixedCase !== false
  };
}

function normalizeStudyMetadata(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  const studyGroup = raw.studyGroup === 'expert' || raw.studyGroup === 'novice' ? raw.studyGroup : undefined;
  const phase =
    raw.phase === 'pilot' || raw.phase === 'main' || raw.phase === 'followup' ? raw.phase : undefined;
  const participationMode =
    raw.participationMode === 'online' || raw.participationMode === 'offline'
      ? raw.participationMode
      : undefined;
  const sessionNo = Number(raw.sessionNo);
  return {
    ...(studyGroup ? { studyGroup } : {}),
    ...(phase ? { phase } : {}),
    ...(Number.isFinite(sessionNo) && sessionNo > 0 ? { sessionNo } : {}),
    ...(participationMode ? { participationMode } : {})
  };
}

function normalizeSessionOutcome(raw: any, fallback: 'in_progress' | 'completed' | 'aborted' = 'in_progress') {
  if (!raw || typeof raw !== 'object') return { status: fallback };
  const status =
    raw.status === 'completed' || raw.status === 'aborted' || raw.status === 'in_progress'
      ? raw.status
      : fallback;
  return {
    status,
    stopReason: typeof raw.stopReason === 'string' ? raw.stopReason.trim() || undefined : undefined
  };
}

function normalizeCaseInputValidation(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    canonicalCaseId: String(raw.canonicalCaseId || DEFAULT_STUDY_CASE_ID),
    canonicalCaseVersion: String(raw.canonicalCaseVersion || DEFAULT_STUDY_CASE_VERSION),
    validated: Boolean(raw.validated),
    validatedAt:
      typeof raw.validatedAt === 'string'
        ? raw.validatedAt
        : raw.validated !== undefined
          ? new Date().toISOString()
          : undefined,
    mismatchCount:
      typeof raw.mismatchCount === 'number' && Number.isFinite(raw.mismatchCount)
        ? raw.mismatchCount
        : undefined,
    note: typeof raw.note === 'string' ? raw.note.trim() || undefined : undefined
  };
}

function normalizeResearcherAssistance(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  const level = raw.level === 'major' ? 'major' : raw.level === 'minor' ? 'minor' : null;
  if (!level) return null;
  return {
    sectionId: typeof raw.sectionId === 'string' && raw.sectionId.trim() ? raw.sectionId.trim() : undefined,
    level,
    reason: typeof raw.reason === 'string' ? raw.reason.trim() || undefined : undefined,
    timestamp: typeof raw.timestamp === 'string' && raw.timestamp ? raw.timestamp : new Date().toISOString()
  };
}

function normalizeTechnicalIssue(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  const allowed = new Set([
    'ai_generation_failure',
    'network',
    'save_failure',
    'refresh',
    'session_recovery',
    'ui_error',
    'other'
  ]);
  const type = allowed.has(raw.type) ? raw.type : 'other';
  return {
    sectionId: typeof raw.sectionId === 'string' && raw.sectionId.trim() ? raw.sectionId.trim() : undefined,
    type,
    description: typeof raw.description === 'string' ? raw.description.trim() || undefined : undefined,
    occurredAt: typeof raw.occurredAt === 'string' && raw.occurredAt ? raw.occurredAt : new Date().toISOString(),
    resolved: typeof raw.resolved === 'boolean' ? raw.resolved : undefined
  };
}

function pushAnswerUndoEntry(existing: any[], entry: any) {
  return [...(existing || []), entry].slice(-20);
}

function normalizeVisitDate(rawDate: string | undefined): string {
  const value = String(rawDate || '').trim();
  if (!value) return '';

  const directMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directMatch) {
    return `${directMatch[1]}-${directMatch[2]}-${directMatch[3]}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
}

function cleanupBulkVisitText(text: string): string {
  return String(text || '')
    .replace(/^\s*-{5,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitBulkVisitText(rawVisit: any): Array<{ date: string; soapText: string; type?: string; structured?: any }> {
  const sourceText = String(rawVisit?.soapText || '');
  const matches = Array.from(sourceText.matchAll(/^\[(\d{4}-\d{2}-\d{2})\]\s*$/gm));

  if (matches.length < 2) {
    return [
      {
        type: rawVisit?.type,
        date: normalizeVisitDate(rawVisit?.date),
        soapText: sourceText,
        structured: rawVisit?.structured
      }
    ];
  }

  const segments = matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index || sourceText.length : sourceText.length;
      const date = normalizeVisitDate(match[1]);
      const soapText = cleanupBulkVisitText(sourceText.slice(start, end));
      return soapText ? { date, soapText } : null;
    })
    .filter((item): item is { date: string; soapText: string; type?: string; structured?: any } => item !== null);

  return segments.length > 0
    ? segments
    : [
        {
          type: rawVisit?.type,
          date: normalizeVisitDate(rawVisit?.date),
          soapText: sourceText,
          structured: rawVisit?.structured
        }
      ];
}

function normalizeIncomingVisits(visits: any[]): Visit[] {
  const flattened = visits.flatMap((visit: any) => splitBulkVisitText(visit));

  return flattened.map((visit, index) => ({
    index: index + 1,
    type: visit.type || (index === 0 ? '초진' : '재진'),
    date: visit.date,
    soapText: visit.soapText || '',
    structured: visit.structured
  })) as Visit[];
}

export function applyDraftUpdateResultToEntry(
  draftEntry: any,
  updateResult: {
    updatedDraftText?: string;
    evidenceLinks?: Array<{ evidenceCardIds?: string[] }>;
    unsupportedClaims?: Array<{ sentence: string; reason: string }>;
  }
) {
  draftEntry.draftText = updateResult.updatedDraftText || draftEntry.draftText || '';
  draftEntry.evidenceLinks = updateResult.evidenceLinks || [];
  draftEntry.unsupportedClaims = updateResult.unsupportedClaims || [];
  draftEntry.evidenceCardIdsUsed = uniqueStrings(
    (updateResult.evidenceLinks || []).flatMap((item) => item.evidenceCardIds || [])
  );
}

export function buildStaleState(
  staleReason:
    | 'ANSWER_UPDATED'
    | 'TERM_CONFIRMATION_UPDATED'
    | 'DEIDENTIFICATION_UPDATED'
    | 'EVIDENCE_REGENERATED'
) {
  return {
    isStale: true,
    staleReason,
    staleAt: new Date().toISOString()
  };
}

export function clearStaleState() {
  return {
    isStale: false,
    staleReason: 'ANSWER_UPDATED' as const,
    staleAt: new Date().toISOString()
  };
}

export function buildFinalComposeWarning(caseData: any): string | null {
  if (!caseData?.staleState?.isStale) return null;
  return `Final manuscript input is stale (${caseData.staleState.staleReason}). A fresh compose is required.`;
}

function buildProcessInputHash(
  visits: Array<{ index: number; date: string; text: string }>,
  termConfirmations: Array<{
    pendingId?: string;
    termId: string;
    status: string;
    confirmedTerm?: string;
    customReplacement?: string;
  }> = [],
  timelineEvents: Array<{
    timelineEventId: string;
    columnOrder?: string[];
    cells?: Record<string, string>;
    date?: string;
    visitNo?: string;
    symptom?: string;
    test?: string;
    diagnosis?: string;
    treatment?: string;
    outcome?: string;
    note?: string;
  }> = []
): string {
  return hashJoinedParts([
    ...(visits || []).map((visit) => [visit.index, visit.date || '', visit.text || ''].join('|')),
    '::terms::',
    ...(termConfirmations || []).map((item) =>
      [
        item.pendingId || '',
        item.termId || '',
        item.status || '',
        item.confirmedTerm || '',
        item.customReplacement || ''
      ].join('|')
    ),
    '::timeline::',
    ...(timelineEvents || []).map((item) =>
      [
        item.timelineEventId || '',
        item.date || '',
        item.visitNo || '',
        item.symptom || '',
        item.test || '',
        item.diagnosis || '',
        item.treatment || '',
        item.outcome || '',
        item.note || '',
        JSON.stringify(item.columnOrder || []),
        JSON.stringify(item.cells || {})
      ].join('|')
    )
  ]);
}

function buildChain1InputHash(preparedVisits: any[]): string {
  return hashJoinedParts(
    (preparedVisits || []).map((visit) =>
      [
        visit.index,
        visit.date || '',
        visit.text || '',
        visit.normalizedText || '',
        JSON.stringify(visit.sectionHints || []),
        JSON.stringify(
          (visit.terms || []).map((term: any) => ({
            surface: term.surface,
            normalizedTerm: term.normalizedTerm || '',
            termId: term.termId || '',
            status: term.status || '',
            needsUserConfirmation: Boolean(term.needsUserConfirmation)
          }))
        )
      ].join('|')
    )
  );
}

function buildChain2InputHash(evidenceCards: any[]): string {
  return hashJoinedParts(
    (evidenceCards || []).map((card) =>
      [
        card.id || '',
        card.normalizedText || card.sourceText || '',
        card.evidenceType || '',
        card.confidence ?? '',
        JSON.stringify(card.tags || []),
        JSON.stringify(card.sectionHints || [])
      ].join('|')
    )
  );
}

function buildChain3InputHash(evidenceCards: any[], sectionStates: any[]): string {
  return hashJoinedParts([
    ...(evidenceCards || []).map((card) =>
      [card.id || '', card.normalizedText || card.sourceText || '', JSON.stringify(card.tags || [])].join('|')
    ),
    '::states::',
    ...(sectionStates || []).map((state) =>
      [state.sectionId || '', state.status || '', state.rationaleText || ''].join('|')
    )
  ]);
}

export function shouldDeferStudyScaffoldDrafts(caseData: any) {
  return Boolean(caseData?.studyConfig?.studyMode) && (caseData?.mode || 'write') === 'scaffold';
}

export function buildProcessSectionsOverview(
  caseData: any,
  sectionStates: any[],
  sectionDrafts: any[]
) {
  if (!shouldDeferStudyScaffoldDrafts(caseData)) {
    return buildSectionsOverview(sectionStates, sectionDrafts);
  }

  const revealedSections = new Set(
    (caseData?.scaffoldState?.sectionProgress || [])
      .filter((item: any) => item?.draftRevealed)
      .map((item: any) => item.sectionId)
  );
  return (sectionStates || []).map((state: any) => {
    if (!revealedSections.has(state.sectionId)) {
      return {
        section: state.sectionId,
        status: 'INCOMPLETE',
        rationaleText: '',
        draftSnippet: ''
      };
    }

    const draft = (sectionDrafts || []).find((item: any) => item.sectionId === state.sectionId);
    return {
      section: state.sectionId,
      status: state.status,
      rationaleText: state.rationaleText,
      draftSnippet: draft?.draftText?.slice(0, 200) || ''
    };
  });
}

function buildChain3PromptHash(evidenceCards: any[], sectionStates: any[]) {
  const statusSummary = (sectionStates || [])
    .map((item) => `[${item.sectionId}] status=${item.status}\nrationale=${item.rationaleText}`)
    .join('\n\n');
  return hashPromptParts([
    chain3SystemPrompt,
    buildChain3UserPrompt(
      'EVIDENCE_SUMMARY_OMITTED_FROM_EXPORT',
      statusSummary,
      'CARE_RUBRIC_SUMMARY_OMITTED_FROM_EXPORT'
    ),
    buildChain3InputHash(evidenceCards, sectionStates)
  ]);
}

function buildPromptTemplateHash(systemPrompt: string, promptVersion: string) {
  return hashPromptParts([promptVersion, systemPrompt]);
}

function attachDraftGenerationMetadata(params: {
  sectionDrafts: any[];
  chainName: string;
  inputHash: string;
  promptHash: string;
  model: string;
  startedAt: string;
  cacheHit: boolean;
  tokenUsage?: any;
}) {
  return (params.sectionDrafts || []).map((draft) => ({
    ...draft,
    generationMetadata: draft.generationMetadata || buildGenerationMetadata({
      chainName: params.chainName,
      provider: 'openai',
      model: params.model,
      actualModelVersion: params.model,
      inputHash: params.inputHash,
      promptHash: params.promptHash,
      promptTemplateHash: buildPromptTemplateHash(chain3SystemPrompt, `${params.chainName}:v1`),
      promptVersion: `${params.chainName}:v1`,
      temperature: 0,
      generatedAt: params.startedAt,
      cacheHit: params.cacheHit,
      generationStatus: 'success',
      tokenUsage: params.tokenUsage
    })
  }));
}

function getQuestionScopeEvidence(sectionDrafts: any[], evidenceCards: any[]) {
  const relevantSections = new Set(
    (sectionDrafts || [])
      .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
      .map((draft) => draft.sectionId)
  );

  return (evidenceCards || []).filter((card) =>
    (card.tags || []).some((tag: string) => relevantSections.has(tag))
  );
}

function buildQuestionStateInputHash(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
}) {
  const scopedEvidence = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);
  return hashJoinedParts([
    params.caseTitle || '',
    '::drafts::',
    ...(params.sectionDrafts || [])
      .filter((draft) => COMMON_QUESTION_SECTIONS.includes(draft.sectionId))
      .map((draft) =>
        [
          draft.sectionId || '',
          draft.draftText || '',
          JSON.stringify(draft.openIssues || []),
          JSON.stringify(draft.timelineEventIdsUsed || [])
        ].join('|')
      ),
    '::states::',
    ...(params.sectionStates || [])
      .filter((state) => COMMON_QUESTION_SECTIONS.includes(state.sectionId))
      .map((state) => [state.sectionId || '', state.status || '', state.rationaleText || ''].join('|')),
    '::evidence::',
    ...scopedEvidence.map((card) =>
      [card.id || '', card.normalizedText || card.sourceText || '', JSON.stringify(card.tags || [])].join('|')
    )
  ]);
}

function buildChain7InputHash(params: {
  sectionDrafts: any[];
  evidenceCards: any[];
  qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>>;
  contributionAnswers?: Array<{ question: string; answer: string }>;
}) {
  return hashJoinedParts([
    '::drafts::',
    ...(params.sectionDrafts || []).map((draft) =>
      [
        draft.sectionId || '',
        draft.draftText || '',
        JSON.stringify(draft.evidenceCardIdsUsed || []),
        JSON.stringify(draft.timelineEventIdsUsed || [])
      ].join('|')
    ),
    '::evidence::',
    ...(params.evidenceCards || []).map((card) =>
      [card.id || '', card.normalizedText || card.sourceText || '', JSON.stringify(card.tags || [])].join('|')
    ),
    '::history::',
    ...Object.entries(params.qnaHistoryBySection || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sectionId, items]) => `${sectionId}|${JSON.stringify(items || [])}`),
    '::contrib::',
    ...((params.contributionAnswers || []).map((item) => `${item.question || ''}|${item.answer || ''}`))
  ]);
}

function getRelevantEvidence(evidenceCards: any[], sectionId: CareSection) {
  return (evidenceCards || []).filter((card) => (card.tags || []).includes(sectionId));
}

function ensureAllSectionStates(sectionStates: any[]) {
  const stateBySection = new Map((sectionStates || []).map((state: any) => [state.sectionId, state]));

  return ALL_CARE_SECTIONS.map((sectionId) => {
    const existing = stateBySection.get(sectionId);
    if (existing) return existing;

    return {
      sectionId,
      status: 'IMPOSSIBLE',
      rationaleText: '현재 기록만으로는 이 항목의 초안을 작성하기 어렵습니다.',
      missingInfoBullets: [],
      recommendedQuestions: []
    };
  });
}

function ensureAllSectionDrafts(sectionDrafts: any[]) {
  const draftBySection = new Map((sectionDrafts || []).map((draft: any) => [draft.sectionId, draft]));

  return ALL_CARE_SECTIONS.map((sectionId) => {
    const existing = draftBySection.get(sectionId);
    if (existing) return existing;

    return {
      sectionId,
      evidenceCardIdsUsed: [] as string[],
      draftText: '',
      openIssues: [] as string[],
      evidenceLinks: [] as Array<{ sentence: string; evidenceCardIds: string[] }>,
      unsupportedClaims: [] as Array<{ sentence: string; reason: string }>
    };
  });
}

function applyQuestionState(params: {
  sectionStates: any[];
  sectionDrafts: any[];
  sectionMissing: Array<{ sectionId: string; missingItems: string[] }>;
  commonMissing: Array<{ item: string; relatedSectionIds: string[]; category?: string }>;
  commonQuestions: Array<{ question: string; targetSectionIds: string[]; category?: string }>;
  sectionQuestions: Array<{ sectionId: string; questions: string[] }>;
}) {
  const missingBySection = new Map(params.sectionMissing.map((item) => [item.sectionId, item.missingItems || []]));
  const questionsBySection = new Map(params.sectionQuestions.map((item) => [item.sectionId, item.questions || []]));

  for (const state of params.sectionStates) {
    const missingItems = missingBySection.get(state.sectionId) || [];
    const questions = questionsBySection.get(state.sectionId) || [];
    const hasDraft = Boolean(
      params.sectionDrafts.find((draft) => draft.sectionId === state.sectionId)?.draftText?.trim()
    );

    state.missingInfoBullets = uniqueStrings(missingItems);
    state.recommendedQuestions = uniqueStrings(questions);

    if (CORE_AI_SECTIONS.includes(state.sectionId)) {
      if (hasDraft && missingItems.length === 0) {
        state.status = 'READY';
      } else if (hasDraft) {
        state.status = 'INCOMPLETE';
      }
    }
  }

  return {
    commonMissingItems: params.commonMissing.map((item) => ({
      item: item.item,
      relatedSectionIds: item.relatedSectionIds as CareSection[],
      category: item.category
    })),
    commonQuestionSets: params.commonQuestions.map((item) => ({
      question: item.question,
      targetSectionIds: item.targetSectionIds as CareSection[],
      category: item.category
    }))
  };
}

async function recomputeQuestionState(params: {
  sectionDrafts: any[];
  sectionStates: any[];
  evidenceCards: any[];
  caseTitle?: string;
  caseData?: any;
  onChain4Usage?: (usage: any) => void;
  onChain5Usage?: (usage: any) => void;
}) {
  const inputHash = buildQuestionStateInputHash(params);
  const canReuse =
    params.caseData &&
    hasChainCacheHit(params.caseData, 'CHAIN4', inputHash) &&
    hasChainCacheHit(params.caseData, 'CHAIN5', inputHash) &&
    Array.isArray(params.caseData.sectionStates) &&
    Array.isArray(params.caseData.commonQuestionSets);

  if (canReuse) {
    const stateBySection = new Map<string, any>(
      (params.caseData.sectionStates || []).map((state: any) => [state.sectionId, state])
    );
    const nextSectionStates = params.sectionStates.map((state) => {
      const stored = stateBySection.get(state.sectionId);
      if (!stored) return state;
      return {
        ...state,
        missingInfoBullets: stored.missingInfoBullets || [],
        recommendedQuestions: stored.recommendedQuestions || [],
        status: stored.status || state.status,
        rationaleText: stored.rationaleText || state.rationaleText
      };
    });

    return {
      sectionStates: nextSectionStates,
      sectionDrafts: params.sectionDrafts,
      commonMissingItems: params.caseData.commonMissingItems || [],
      commonQuestionSets: params.caseData.commonQuestionSets || [],
      cacheMeta: {
        chain4InputHash: inputHash,
        chain5InputHash: inputHash,
        chain4CacheHit: true,
        chain5CacheHit: true,
        chain4DurationMs: 0,
        chain5DurationMs: 0
      }
    };
  }

  const commonQuestionDrafts = params.sectionDrafts.filter((draft) =>
    COMMON_QUESTION_SECTIONS.includes(draft.sectionId)
  );
  const scopedEvidenceCards = getQuestionScopeEvidence(params.sectionDrafts, params.evidenceCards);

  // caseTitle and the front-matter sections of sectionDrafts are user-authored
  // and never passed through the SOAP pipeline, so they are de-identified here
  // before CHAIN4/CHAIN5 send them out.
  const outboundContext = createOutboundDeidContext();
  const outboundTitle = await deidentifyOutboundField(params.caseTitle, outboundContext);
  const outboundDrafts = await deidentifyDraftsForOutbound(commonQuestionDrafts, outboundContext);

  const chain4StartedAt = performance.now();
  const missingResult = await runSectionMissingDetection(
    {
      sectionDrafts: outboundDrafts,
      evidenceCards: scopedEvidenceCards,
      caseTitle: outboundTitle
    },
    {
      onUsage: params.onChain4Usage
    }
  );
  const chain4DurationMs = Math.round((performance.now() - chain4StartedAt) * 100) / 100;
  const chain5StartedAt = performance.now();
  const questionResult = await runQuestionGeneration(
    {
      sectionDrafts: outboundDrafts,
      sectionMissing: missingResult.sectionMissing,
      commonMissing: missingResult.commonMissing,
      caseTitle: outboundTitle
    },
    {
      onUsage: params.onChain5Usage
    }
  );
  const chain5DurationMs = Math.round((performance.now() - chain5StartedAt) * 100) / 100;

  const commonState = applyQuestionState({
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    sectionMissing: missingResult.sectionMissing,
    commonMissing: missingResult.commonMissing,
    commonQuestions: questionResult.commonQuestions,
    sectionQuestions: questionResult.sectionQuestions
  });

  return {
    sectionStates: params.sectionStates,
    sectionDrafts: params.sectionDrafts,
    commonMissingItems: commonState.commonMissingItems,
    commonQuestionSets: commonState.commonQuestionSets,
    cacheMeta: {
      chain4InputHash: inputHash,
      chain5InputHash: inputHash,
      chain4CacheHit: false,
      chain5CacheHit: false,
      chain4DurationMs,
      chain5DurationMs
    }
  };
}

export async function reprocessCaseFromStoredTerms(params: {
  caseId: string;
  caseData: any;
  staleReason?:
    | 'ANSWER_UPDATED'
    | 'TERM_CONFIRMATION_UPDATED'
    | 'DEIDENTIFICATION_UPDATED'
    | 'EVIDENCE_REGENERATED';
  semanticMatcher?: NonNullable<Parameters<typeof preprocessVisitsForChain1>[1]>['semanticMatcher'];
  llmResolver?: NonNullable<Parameters<typeof preprocessVisitsForChain1>[1]>['llmResolver'];
  onStageTiming?: (timing: ReprocessStageTiming) => void;
  dependencies?: {
    preprocessVisitsForChain1?: typeof preprocessVisitsForChain1;
    runEvidenceSplit?: typeof runEvidenceSplit;
    runSectionAssessment?: typeof runSectionAssessment;
    runInitialSectionDrafts?: typeof runInitialSectionDrafts;
    recomputeQuestionState?: typeof recomputeQuestionState;
    updateCase?: (caseId: string, updates: any) => Promise<void>;
  };
}) {
  const measureStage = createStageTimer(params.onStageTiming);
  const totalStartedAt = performance.now();
  const preprocessVisitsForChain1Impl =
    params.dependencies?.preprocessVisitsForChain1 || preprocessVisitsForChain1;
  const runEvidenceSplitImpl = params.dependencies?.runEvidenceSplit || runEvidenceSplit;
  const runSectionAssessmentImpl =
    params.dependencies?.runSectionAssessment || runSectionAssessment;
  const runInitialSectionDraftsImpl =
    params.dependencies?.runInitialSectionDrafts || runInitialSectionDrafts;
  const recomputeQuestionStateImpl =
    params.dependencies?.recomputeQuestionState || recomputeQuestionState;
  const updateCaseImpl = params.dependencies?.updateCase || ((caseId: string, updates: any) => caseModel.updateCase(caseId, updates));
  let nextChainCache = { ...(params.caseData.chainCache || {}) };
  let nextPerformanceLogs = [...(params.caseData.chainPerformanceLogs || [])];
  const visitsForChain1 = params.caseData.visits.map((visit: any, idx: number) => ({
    index: visit.index ?? visit.visitIndex ?? idx + 1,
    date: visit.date ?? visit.visitDateTime ?? '',
    text: visit.soapText ?? visit.sanitizedText ?? ''
  }));

  const inputHash = buildProcessInputHash(
    visitsForChain1,
    (params.caseData.pendingTermConfirmations || []).map((item: any) => ({
      pendingId: item.pendingId,
      termId: item.termId,
      status: item.status,
      confirmedTerm: item.confirmedTerm,
      customReplacement: item.customReplacement
    })),
    (params.caseData.timelineEvents || []).map((item: any) => ({
      timelineEventId: item.timelineEventId,
      columnOrder: item.columnOrder || [],
      cells: item.cells || {},
      date: item.date,
      visitNo: item.visitNo,
      symptom: item.symptom,
      test: item.test,
      diagnosis: item.diagnosis,
      treatment: item.treatment,
      outcome: item.outcome,
      note: item.note
    }))
  );

  // The fixed study EMR is identical for every participant, so its
  // preprocessing + CHAIN1 + CHAIN2 result is computed once and reused. It only
  // applies to the untouched case: a term decision or an imported timeline
  // changes the input, and tests that inject their own stages must run them.
  const hasTermDecisions = (params.caseData.pendingTermConfirmations || []).some(
    (item: any) => item?.status === 'CONFIRMED' || item?.status === 'REJECTED'
  );
  // 저장해 둔 분석 결과는 Scaffold 실험에서만 쓴다. Write 실험은 같은 방문 기록이라도
  // 참여자 기록과 같은 경로로 새로 분석한다 (사용자 결정 2026-10-10).
  const fixedStudyAnalysis =
    (params.caseData.mode || 'write') === 'scaffold' &&
    !params.dependencies?.preprocessVisitsForChain1 &&
    !params.dependencies?.runEvidenceSplit &&
    !params.dependencies?.runSectionAssessment &&
    !hasTermDecisions &&
    (params.caseData.timelineEvents || []).length === 0
      ? getFixedStudyCaseAnalysis(visitsForChain1)
      : null;

  const preprocessedChain1 = await measureStage('preprocessing', async () =>
    fixedStudyAnalysis
      ? (fixedStudyAnalysis.preprocessed as Awaited<ReturnType<typeof preprocessVisitsForChain1>>)
      : preprocessVisitsForChain1Impl(visitsForChain1, {
          storedConfirmations: params.caseData.pendingTermConfirmations || [],
          semanticMatcher: params.semanticMatcher,
          llmResolver: params.llmResolver,
          // 실험용 Write 사례는 날짜를 가리지 않는다 (사용자 결정 2026-10-10)
          keepDates: Boolean((params.caseData as any).studyWrite)
        })
  );

  const chain1InputHash = buildChain1InputHash(preprocessedChain1.preparedVisits);

  await updateCaseImpl(params.caseId, {
    chainProgress: buildChainProgress('CHAIN1', ['PREPROCESS'], ['CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5'])
  } as any);

  if (preprocessedChain1.reviewRequired?.riskLevel === 'HIGH') {
    await updateCaseImpl(params.caseId, {
      deidentifiedEMRs: preprocessedChain1.deidentifiedEMRs,
      pendingTermConfirmations: preprocessedChain1.pendingTermConfirmations,
      reviewRequired: preprocessedChain1.reviewRequired,
      processingCache: null,
      chainProgress: buildChainProgress('BLOCKED', ['PREPROCESS'], []),
      chainPerformanceLogs: appendPerformanceLog(
        nextPerformanceLogs,
        buildPerformanceLog({
          chainName: 'CHAIN1',
          startedAt: new Date().toISOString(),
          inputHash: chain1InputHash,
          cacheHit: false,
          llmCallCount: 0,
          error: 'Blocked by HIGH de-identification risk before Chain1 execution.'
        })
      ),
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      sectionAdequacyReviews: {},
      staleState: buildStaleState(params.staleReason || 'EVIDENCE_REGENERATED')
    } as any);

    params.onStageTiming?.({
      stage: 'total',
      durationMs: Math.round((performance.now() - totalStartedAt) * 100) / 100
    });

    return {
      blocked: true as const,
      inputHash,
      preprocessedChain1
    };
  }

  const chain1StartedAt = new Date().toISOString();
  let chain1Usage: any = null;
  const reuseChain1 =
    Boolean(fixedStudyAnalysis) ||
    (hasChainCacheHit(params.caseData, 'CHAIN1', chain1InputHash) &&
      Array.isArray(params.caseData.evidenceCards) &&
      params.caseData.evidenceCards.length > 0);
  const chain1EvidenceCards = await measureStage('chain1', async () =>
    fixedStudyAnalysis
      ? fixedStudyAnalysis.evidenceCards
      : reuseChain1
      ? params.caseData.evidenceCards || []
      : runEvidenceSplitImpl(preprocessedChain1.preparedVisits, {
          onUsage: (usage) => {
            chain1Usage = usage;
          }
        })
  );
  // Stored timeline rows are raw spreadsheet content (retention unchanged), so
  // they are de-identified here before becoming evidence that chains consume.
  const outboundTimelineEvents = await deidentifyTimelineEventsForOutbound(
    (params.caseData.timelineEvents || []) as any[]
  );
  const importedTimelineEvidenceCards = buildEvidenceCardsFromTimelineEvents(outboundTimelineEvents);
  const evidenceCards = mergeEvidenceCards(chain1EvidenceCards, importedTimelineEvidenceCards);
  nextChainCache = {
    ...nextChainCache,
    CHAIN1: buildChainCacheEntry(chain1InputHash, evidenceCards)
  };
  nextPerformanceLogs = appendPerformanceLog(
    nextPerformanceLogs,
    buildPerformanceLog({
      chainName: 'CHAIN1',
      startedAt: chain1StartedAt,
      inputHash: chain1InputHash,
      cacheHit: reuseChain1,
      llmCallCount: reuseChain1 ? 0 : 1,
      tokenUsage: chain1Usage
    })
  );

  await updateCaseImpl(params.caseId, {
    chainProgress: buildChainProgress('CHAIN2', ['PREPROCESS', 'CHAIN1'], ['CHAIN3', 'CHAIN4', 'CHAIN5'])
  } as any);

  const chain2InputHash = buildChain2InputHash(evidenceCards);
  const chain2StartedAt = new Date().toISOString();
  let chain2Usage: any = null;
  const reuseChain2 =
    Boolean(fixedStudyAnalysis) ||
    (hasChainCacheHit(params.caseData, 'CHAIN2', chain2InputHash) &&
      Array.isArray(params.caseData.sectionStates) &&
      params.caseData.sectionStates.length > 0);
  const sectionStates = await measureStage('chain2', async () =>
    fixedStudyAnalysis
      ? ensureAllSectionStates(fixedStudyAnalysis.sectionStates)
      : reuseChain2
      ? ensureAllSectionStates(cloneJson(params.caseData.sectionStates || []))
      : ensureAllSectionStates(
          await runSectionAssessmentImpl(evidenceCards, {
            onUsage: (usage) => {
              chain2Usage = usage;
            }
          })
        )
  );
  nextChainCache = {
    ...nextChainCache,
    CHAIN2: buildChainCacheEntry(chain2InputHash, sectionStates.map((state) => ({
      sectionId: state.sectionId,
      status: state.status,
      rationaleText: state.rationaleText
    })))
  };
  nextPerformanceLogs = appendPerformanceLog(
    nextPerformanceLogs,
    buildPerformanceLog({
      chainName: 'CHAIN2',
      startedAt: chain2StartedAt,
      inputHash: chain2InputHash,
      cacheHit: reuseChain2,
      llmCallCount: reuseChain2 ? 0 : 1,
      tokenUsage: chain2Usage
    })
  );

  if (shouldDeferStudyScaffoldDrafts(params.caseData)) {
    const nextState = {
      sectionStates,
      sectionDrafts: [] as any[],
      commonMissingItems: [] as any[],
      commonQuestionSets: [] as any[],
      cacheMeta: {
        deferredDraftGeneration: true
      }
    };

    await measureStage('final_db_save', () =>
      updateCaseImpl(params.caseId, {
        processingCache: {
          inputHash,
          processedAt: new Date().toISOString()
        },
        draftsBySection: {},
        chainCache: nextChainCache,
        chainProgress: buildChainProgress(
          undefined,
          ['PREPROCESS', 'CHAIN1', 'CHAIN2'],
          ['CHAIN3_STUDY_REVEAL']
        ),
        chainPerformanceLogs: nextPerformanceLogs,
        deidentifiedEMRs: preprocessedChain1.deidentifiedEMRs,
        pendingTermConfirmations: preprocessedChain1.pendingTermConfirmations,
        reviewRequired: preprocessedChain1.reviewRequired,
        evidenceCards,
        sectionStates,
        sectionDrafts: [],
        commonMissingItems: [],
        commonQuestionSets: [],
        finalDraft: null,
        finalComposeStatus: {
          status: 'IDLE',
          requestedAt: undefined,
          startedAt: undefined,
          completedAt: undefined,
          errorMessage: undefined
        },
        sectionAdequacyReviews: {},
        staleState: buildStaleState(params.staleReason || 'EVIDENCE_REGENERATED')
      } as any)
    );

    params.onStageTiming?.({
      stage: 'total',
      durationMs: Math.round((performance.now() - totalStartedAt) * 100) / 100
    });

    return {
      blocked: false as const,
      inputHash,
      preprocessedChain1,
      evidenceCards,
      nextState
    };
  }

  await updateCaseImpl(params.caseId, {
    chainProgress: buildChainProgress('CHAIN3', ['PREPROCESS', 'CHAIN1', 'CHAIN2'], ['CHAIN4', 'CHAIN5'])
  } as any);

  const chain3InputHash = buildChain3InputHash(evidenceCards, sectionStates);
  const chain3PromptHash = buildChain3PromptHash(evidenceCards, sectionStates);
  const chain3StartedAt = new Date().toISOString();
  let chain3Usage: any = null;
  const reuseChain3 =
    hasChainCacheHit(params.caseData, 'CHAIN3', chain3InputHash) &&
    Array.isArray(params.caseData.sectionDrafts) &&
    params.caseData.sectionDrafts.length > 0;
  let sectionDrafts = await measureStage('chain3', async () =>
    reuseChain3
      ? ensureAllSectionDrafts(cloneJson(params.caseData.sectionDrafts || []))
      : ensureAllSectionDrafts(
          await runInitialSectionDraftsImpl(evidenceCards, sectionStates, {
            onUsage: (usage) => {
              chain3Usage = usage;
            }
          })
        )
  );
  sectionDrafts = attachDraftGenerationMetadata({
    sectionDrafts,
    chainName: 'CHAIN3',
    inputHash: chain3InputHash,
    promptHash: chain3PromptHash,
    model: getModelForChain('chain3'),
    startedAt: chain3StartedAt,
    cacheHit: reuseChain3,
    tokenUsage: chain3Usage
  });
  nextChainCache = {
    ...nextChainCache,
    CHAIN3: buildChainCacheEntry(
      chain3InputHash,
      sectionDrafts.map((draft) => ({
        sectionId: draft.sectionId,
        draftText: draft.draftText || ''
      }))
    )
  };
  nextPerformanceLogs = appendPerformanceLog(
    nextPerformanceLogs,
    buildPerformanceLog({
      chainName: 'CHAIN3',
      startedAt: chain3StartedAt,
      inputHash: chain3InputHash,
      cacheHit: reuseChain3,
      llmCallCount: reuseChain3 ? 0 : 1,
      tokenUsage: chain3Usage
    })
  );

  const integratedTimelineState = integrateImportedTimelineIntoDrafts({
    sectionDrafts,
    sectionStates,
    timelineEvents: outboundTimelineEvents
  });

  await updateCaseImpl(params.caseId, {
    chainProgress: buildChainProgress(
      'CHAIN4',
      ['PREPROCESS', 'CHAIN1', 'CHAIN2', 'CHAIN3'],
      ['CHAIN5']
    )
  } as any);

  const chain45StartedAt = new Date().toISOString();
  let chain4Usage: any = null;
  let chain5Usage: any = null;
  const chain45Timings: ReprocessStageTiming[] = [];
  const nextState = await recomputeQuestionStateImpl({
    sectionDrafts: integratedTimelineState.sectionDrafts,
    sectionStates: integratedTimelineState.sectionStates,
    evidenceCards,
    caseTitle: params.caseData.title,
    caseData: params.caseData,
    onChain4Usage: (usage) => {
      chain4Usage = usage;
    },
    onChain5Usage: (usage) => {
      chain5Usage = usage;
    }
  });
  chain45Timings.push(
    {
      stage: 'chain4',
      durationMs: nextState.cacheMeta.chain4DurationMs ?? 0
    },
    {
      stage: 'chain5',
      durationMs: nextState.cacheMeta.chain5DurationMs ?? 0
    }
  );
  for (const timing of chain45Timings) {
    params.onStageTiming?.(timing);
  }
  nextChainCache = {
    ...nextChainCache,
    CHAIN4: buildChainCacheEntry(nextState.cacheMeta.chain4InputHash, {
      commonMissingItems: nextState.commonMissingItems,
      sectionMissingBySection: nextState.sectionStates.map((state) => ({
        sectionId: state.sectionId,
        missingInfoBullets: state.missingInfoBullets || []
      }))
    }),
    CHAIN5: buildChainCacheEntry(nextState.cacheMeta.chain5InputHash, {
      commonQuestionSets: nextState.commonQuestionSets,
      sectionQuestionsBySection: nextState.sectionStates.map((state) => ({
        sectionId: state.sectionId,
        recommendedQuestions: state.recommendedQuestions || []
      }))
    })
  };
  nextPerformanceLogs = appendPerformanceLog(
    nextPerformanceLogs,
    buildPerformanceLog({
      chainName: 'CHAIN4',
      startedAt: chain45StartedAt,
      inputHash: nextState.cacheMeta.chain4InputHash,
      cacheHit: nextState.cacheMeta.chain4CacheHit,
      llmCallCount: nextState.cacheMeta.chain4CacheHit ? 0 : 1,
      tokenUsage: chain4Usage
    })
  );
  nextPerformanceLogs = appendPerformanceLog(
    nextPerformanceLogs,
    buildPerformanceLog({
      chainName: 'CHAIN5',
      startedAt: chain45StartedAt,
      inputHash: nextState.cacheMeta.chain5InputHash,
      cacheHit: nextState.cacheMeta.chain5CacheHit,
      llmCallCount: nextState.cacheMeta.chain5CacheHit ? 0 : 1,
      tokenUsage: chain5Usage
    })
  );

  await measureStage('final_db_save', () =>
    updateCaseImpl(params.caseId, {
      processingCache: {
        inputHash,
        processedAt: new Date().toISOString()
      },
      draftsBySection: deriveDraftMapFromSectionDrafts(nextState.sectionDrafts),
      chainCache: nextChainCache,
      chainProgress: buildChainProgress(undefined, ['PREPROCESS', 'CHAIN1', 'CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5'], []),
      chainPerformanceLogs: nextPerformanceLogs,
      deidentifiedEMRs: preprocessedChain1.deidentifiedEMRs,
      pendingTermConfirmations: preprocessedChain1.pendingTermConfirmations,
      reviewRequired: preprocessedChain1.reviewRequired,
      evidenceCards,
      sectionStates: nextState.sectionStates,
      sectionDrafts: nextState.sectionDrafts,
      commonMissingItems: nextState.commonMissingItems,
      commonQuestionSets: nextState.commonQuestionSets,
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      sectionAdequacyReviews: {},
      staleState: buildStaleState(params.staleReason || 'EVIDENCE_REGENERATED')
    } as any)
  );

  params.onStageTiming?.({
    stage: 'total',
    durationMs: Math.round((performance.now() - totalStartedAt) * 100) / 100
  });

  return {
    blocked: false as const,
    inputHash,
    preprocessedChain1,
    evidenceCards,
    nextState
  };
}

function buildPendingTermReprocessProgress() {
  return buildChainProgress('PREPROCESS', [], ['CHAIN1', 'CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5']);
}

export async function schedulePendingTermReprocess(params: {
  caseId: string;
  semanticMatcher?: NonNullable<Parameters<typeof preprocessVisitsForChain1>[1]>['semanticMatcher'];
  llmResolver?: NonNullable<Parameters<typeof preprocessVisitsForChain1>[1]>['llmResolver'];
}, deps?: {
  caseModel?: Pick<CaseModel, 'getCase' | 'updateCase'>;
  reprocessCase?: typeof reprocessCaseFromStoredTerms;
}) {
  const model = deps?.caseModel || caseModel;
  const reprocessCase = deps?.reprocessCase || reprocessCaseFromStoredTerms;
  if (runningPendingTermReprocessJobs.has(params.caseId)) {
    queuedPendingTermReprocessCaseIds.add(params.caseId);
    return { started: false };
  }

  const jobPromise = (async () => {
    try {
      do {
        queuedPendingTermReprocessCaseIds.delete(params.caseId);
        const latestCase = await model.getCase(params.caseId);
        if (!latestCase) {
          return;
        }

        try {
          await reprocessCase({
            caseId: params.caseId,
            caseData: latestCase as any,
            staleReason: 'TERM_CONFIRMATION_UPDATED',
            semanticMatcher: params.semanticMatcher,
            llmResolver: params.llmResolver
          });
        } catch (error: any) {
          console.error(
            `[PENDING TERM REPROCESS ${params.caseId}] background reprocess failed:`,
            summarizeError(error)
          );
          await model.updateCase(params.caseId, {
            chainProgress: null as any,
            processingCache: null as any,
            staleState: buildStaleState('TERM_CONFIRMATION_UPDATED')
          } as any);
        }
      } while (queuedPendingTermReprocessCaseIds.has(params.caseId));
    } finally {
      queuedPendingTermReprocessCaseIds.delete(params.caseId);
      runningPendingTermReprocessJobs.delete(params.caseId);
    }
  })();

  runningPendingTermReprocessJobs.set(params.caseId, jobPromise);
  return { started: true };
}

function buildPendingTermMutationResponse(params: {
  pendingId: string;
  status: 'CONFIRMED' | 'REJECTED';
  confirmedTerm?: string;
  customReplacement?: string | null;
  caseData: any;
  httpStatus: 200 | 202;
  processingStarted?: boolean;
}) {
  const responseState = buildCaseStateResponse(params.caseData);
  return {
    success: true,
    pendingId: params.pendingId,
    status: params.status,
    confirmedTerm: params.confirmedTerm,
    customReplacement: params.customReplacement,
    blocked: false,
    reviewRequired: responseState.reviewRequired,
    pendingTermConfirmations: responseState.pendingTermConfirmations,
    staleState: responseState.staleState,
    finalComposeStatus: responseState.finalComposeStatus,
    finalDraft: responseState.finalDraft,
    draftsBySection: responseState.draftsBySection,
    sectionStates: responseState.sectionStates.map((state: any) => ({
      sectionId: state.sectionId,
      status: state.status,
      rationaleText: state.rationaleText || '',
      missingInfoBullets: state.missingInfoBullets || [],
      recommendedQuestions: state.recommendedQuestions || []
    })),
    commonQuestionSets: buildCommonQuestionItems(responseState.commonQuestionSets || []),
    commonMissingItems: uniqueStrings(
      (responseState.commonMissingItems || []).map((item: any) => item.item || item)
    ),
    sectionsOverview: responseState.sectionsOverview,
    chainProgress: params.caseData.chainProgress || null,
    httpStatus: params.httpStatus,
    processingStarted: Boolean(params.processingStarted)
  };
}

export async function mutatePendingTermDecision(params: {
  caseId: string;
  pendingId: string;
  action: 'confirm' | 'reject';
  confirmedTerm?: string;
  customReplacement?: string;
}, deps?: {
  caseModel?: Pick<CaseModel, 'getCase' | 'updateCase'>;
  getTerminologyRuntime?: typeof getWriteTerminologyRuntime;
  scheduleReprocess?: typeof schedulePendingTermReprocess;
}) {
  const model = deps?.caseModel || caseModel;
  const scheduleReprocess = deps?.scheduleReprocess || schedulePendingTermReprocess;
  const getTerminologyRuntime = deps?.getTerminologyRuntime || getWriteTerminologyRuntime;
  const measureStage = createStageTimer();

  const case_ = await model.getCase(params.caseId);
  if (!case_) {
    return {
      httpStatus: 404 as const,
      body: { error: 'Case not found' }
    };
  }

  const anyCase: any = case_;
  const pendingTermConfirmations = (anyCase.pendingTermConfirmations || []) as any[];
  const target = pendingTermConfirmations.find((item) => item.pendingId === params.pendingId);
  if (!target) {
    return {
      httpStatus: 404 as const,
      body: { error: 'Pending term not found' }
    };
  }

  const resolvedTerm =
    params.action === 'confirm'
      ? String(params.confirmedTerm || '').trim() ||
        target?.candidates?.[0]?.standardTerm ||
        target?.normalizedTerm ||
        ''
      : '';

  if (params.action === 'confirm' && !resolvedTerm) {
    return {
      httpStatus: 400 as const,
      body: { error: 'confirmedTerm is required when no candidate is available.' }
    };
  }

  const cleanedReplacement =
    params.action === 'reject' ? String(params.customReplacement || '').trim() : '';
  const nextPendingTerms = pendingTermConfirmations.map((item) => {
    if (item.pendingId !== params.pendingId) {
      return item;
    }

    if (params.action === 'confirm') {
      return {
        ...item,
        status: 'CONFIRMED',
        confirmedTerm: resolvedTerm,
        normalizedTerm: resolvedTerm,
        needsUserConfirmation: false,
        resolvedAt: new Date().toISOString()
      };
    }

    return {
      ...item,
      status: 'REJECTED',
      customReplacement: cleanedReplacement || undefined,
      normalizedTerm: '',
      needsUserConfirmation: false,
      resolvedAt: new Date().toISOString()
    };
  });

  await measureStage('confirmation_save', () =>
    model.updateCase(params.caseId, {
      pendingTermConfirmations: nextPendingTerms,
      processingCache: null as any,
      chainProgress: buildPendingTermReprocessProgress() as any,
      staleState: buildStaleState('TERM_CONFIRMATION_UPDATED') as any
    } as any)
  );

  const refreshedCase = await model.getCase(params.caseId);
  if (!refreshedCase) {
    return {
      httpStatus: 404 as const,
      body: { error: 'Case not found after update.' }
    };
  }

  const terminologyRuntime = getTerminologyRuntime();
  const scheduleResult = await scheduleReprocess({
    caseId: params.caseId,
    semanticMatcher: terminologyRuntime.semanticMatcher,
    llmResolver: terminologyRuntime.llmResolver
  });

  return {
    httpStatus: 202 as const,
    body: buildPendingTermMutationResponse({
      pendingId: params.pendingId,
      status: params.action === 'confirm' ? 'CONFIRMED' : 'REJECTED',
      confirmedTerm: params.action === 'confirm' ? resolvedTerm : undefined,
      customReplacement: params.action === 'reject' ? cleanedReplacement || null : undefined,
      caseData: refreshedCase as any,
      httpStatus: 202,
      processingStarted: scheduleResult.started
    })
  };
}

function findTargetSectionsForCommonQuestion(params: {
  question: string;
  commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[] }>;
}): CareSection[] {
  const matched = (params.commonQuestionSets || []).find((entry) =>
    isSameQuestion(entry.question, params.question)
  );

  return matched?.targetSectionIds || [];
}

async function collectQnaHistoryBySection(caseId: string) {
  const qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>> = {};
  const interactionResults = await caseModel.getInteractionsByKeys(caseId, ALL_CARE_SECTIONS);
  const interactionMap = new Map(
    interactionResults.map((interaction) => [interaction.sectionId, interaction])
  );

  for (const sectionKey of ALL_CARE_SECTIONS) {
    const interaction = interactionMap.get(sectionKey);
    if (interaction?.qnaHistory?.length) {
      qnaHistoryBySection[sectionKey] = interaction.qnaHistory.map((item) => ({
        question: item.question,
        answer: item.answer
      }));
    }
  }

  return qnaHistoryBySection;
}

async function runFinalComposeJob(params: {
  caseId: string;
  contributionAnswers?: Array<{ question: string; answer: string }>;
  inputHash: string;
}) {
  const { caseId, contributionAnswers, inputHash } = params;

  if (runningFinalComposeJobs.has(caseId)) {
    return runningFinalComposeJobs.get(caseId)!;
  }

  const jobPromise = (async () => {
    let baseCase: any = null;
    let requestedAt: string | undefined;
    let startedAt = new Date().toISOString();
    try {
      const queuedCase = await caseModel.getCase(caseId);
      baseCase = queuedCase as any;
      const queuedStatus = baseCase?.finalComposeStatus;
      requestedAt = queuedStatus?.requestedAt || startedAt;

      await caseModel.updateCase(caseId, {
        finalComposeStatus: {
          status: 'RUNNING',
          requestedAt,
          startedAt
        }
      } as any);

      if (!baseCase) {
        throw new Error('Case not found');
      }

      const sectionDrafts: any[] = baseCase.sectionDrafts || [];
      const evidenceCards: any[] = baseCase.evidenceCards || [];
      const qnaHistoryBySection = await collectQnaHistoryBySection(caseId);
      const chain7StartedAt = new Date().toISOString();
      let chain7Usage: any = null;

      // CHAIN7 merges every user-authored surface at once - drafts (including
      // manually edited front matter), all answers, and free-text contribution
      // answers - so the whole outbound payload is de-identified under one
      // shared context before it is assembled into the prompt.
      const composeOutboundContext = createOutboundDeidContext();
      const outboundContributionAnswers = await deidentifyQnaForOutbound(
        contributionAnswers || [],
        composeOutboundContext
      );

      const finalDraft = await runFinalManuscriptCompose({
        sectionDrafts: await deidentifyDraftsForOutbound(sectionDrafts, composeOutboundContext),
        evidenceCards,
        qnaHistoryBySection: await deidentifyQnaMapForOutbound(
          qnaHistoryBySection,
          composeOutboundContext
        ),
        contributionAnswers: outboundContributionAnswers as Array<{ question: string; answer: string }>
      }, {
        onUsage: (usage) => {
          chain7Usage = usage;
        }
      });
      (finalDraft as any).generationMetadata = buildGenerationMetadata({
        chainName: 'CHAIN7',
        provider: 'openai',
        model: getModelForChain('chain7'),
        actualModelVersion: getModelForChain('chain7'),
        inputHash,
        promptHash: hashPromptParts([chain7SystemPrompt, inputHash]),
        promptTemplateHash: buildPromptTemplateHash(chain7SystemPrompt, 'CHAIN7:v1'),
        promptVersion: 'CHAIN7:v1',
        temperature: 0,
        generatedAt: chain7StartedAt,
        cacheHit: false,
        generationStatus: 'success',
        tokenUsage: chain7Usage
      });
      const authoredDiscussion =
        sectionDrafts.find((draft) => draft.sectionId === CareSection.DISCUSSION_CONCLUSION)?.draftText ||
        (baseCase.draftsBySection || {})[CareSection.DISCUSSION_CONCLUSION] ||
        '';
      if (authoredDiscussion.trim()) {
        finalDraft.fullTextBySection = {
          ...(finalDraft.fullTextBySection || {}),
          [CareSection.DISCUSSION_CONCLUSION]: authoredDiscussion
        };
      }

      const nextSectionDrafts = [...sectionDrafts];
      const nextSectionStates = [...(baseCase.sectionStates || [])];

      for (const sectionId of NON_CORE_GENERATED_SECTIONS) {
        const text = finalDraft.fullTextBySection?.[sectionId] || '';
        const existingDraft = nextSectionDrafts.find((draft) => draft.sectionId === sectionId);
        if (existingDraft) {
          existingDraft.draftText = text;
        } else {
          nextSectionDrafts.push({
            sectionId,
            evidenceCardIdsUsed: [] as string[],
            draftText: text,
            openIssues: [] as string[],
            evidenceLinks: [] as Array<{ sentence: string; evidenceCardIds: string[] }>,
            unsupportedClaims: [] as Array<{ sentence: string; reason: string }>
          });
        }

        const existingState = nextSectionStates.find((state) => state.sectionId === sectionId);
        const nextState = {
          sectionId,
          status: text.trim() ? 'READY' : 'IMPOSSIBLE',
          rationaleText: text.trim()
            ? 'This section was composed from the final manuscript generation step.'
            : '현재 기록만으로는 이 항목을 작성하기 어렵습니다.',
          missingInfoBullets: existingState?.missingInfoBullets || [],
          recommendedQuestions: []
        };

        if (existingState) {
          Object.assign(existingState, nextState);
        } else {
          nextSectionStates.push(nextState);
        }
      }

      await caseModel.updateCase(caseId, {
        finalDraft,
        chainCache: {
          ...(baseCase.chainCache || {}),
          CHAIN7: buildChainCacheEntry(inputHash, finalDraft)
        },
        chainProgress: buildChainProgress(undefined, ['CHAIN7'], []),
        chainPerformanceLogs: appendPerformanceLog(
          baseCase.chainPerformanceLogs || [],
          buildPerformanceLog({
            chainName: 'CHAIN7',
            startedAt: chain7StartedAt,
            inputHash,
            cacheHit: false,
            llmCallCount: 1,
          tokenUsage: chain7Usage
        })
      ),
        sectionDrafts: nextSectionDrafts,
        sectionStates: nextSectionStates,
        staleState: clearStaleState(),
        finalComposeStatus: {
          status: 'COMPLETED',
          requestedAt: requestedAt || startedAt,
          startedAt,
          completedAt: new Date().toISOString()
        }
      } as any);
    } catch (error: any) {
      await caseModel.updateCase(caseId, {
        staleState: buildStaleState('EVIDENCE_REGENERATED'),
        chainPerformanceLogs: appendPerformanceLog(
          baseCase?.chainPerformanceLogs || [],
          buildPerformanceLog({
            chainName: 'CHAIN7',
            startedAt,
            inputHash,
            cacheHit: false,
            llmCallCount: 1,
            error: error?.message || 'Failed to compose final manuscript.'
          })
        ),
        finalComposeStatus: {
          status: 'FAILED',
          requestedAt: requestedAt || startedAt,
          startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: error?.message || 'Failed to compose final manuscript.'
        }
      } as any);
      throw error;
    } finally {
      runningFinalComposeJobs.delete(caseId);
    }
  })();

  runningFinalComposeJobs.set(caseId, jobPromise);
  return jobPromise;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const modeQuery = typeof req.query.mode === 'string' ? req.query.mode.trim() : '';
    const mode =
      modeQuery === 'write' || modeQuery === 'scaffold'
        ? (modeQuery as CaseMode)
        : undefined;
    const cases = await caseModel.getAllCases(mode);
    res.json({ cases });
  } catch (error: any) {
    console.error('Error getting all cases:', error);
    res.status(500).json({ error: error.message });
  }
});

// 실험용 입력 화면의 '실험 사례 불러오기'가 사용한다. 모든 참여자가 같은 날짜와
// 본문으로 시작하도록 고정 사례의 방문 기록만 내려준다.
router.get('/study/template', (req: Request, res: Response) => {
  const template = getStudyCaseTemplate(
    typeof req.query.studyCaseId === 'string' ? req.query.studyCaseId : undefined
  );
  res.json({
    studyCaseId: template.id,
    version: template.version,
    title: template.title,
    visits: template.visits.map((visit) => ({
      type: visit.type,
      date: visit.date,
      soapText: visit.soapText
    }))
  });
});

router.post('/study/start', async (req: Request, res: Response) => {
  try {
    const mode = req.body?.mode === 'scaffold' ? 'scaffold' : 'write';
    const requestedExperimentCode = normalizeExperimentCodeForMode(req.body?.experimentCode, mode);
    const participantCode = String(req.body?.participantCode || requestedExperimentCode || '').trim();
    const studyCaseId = String(req.body?.studyCaseId || DEFAULT_STUDY_CASE_ID).trim() || DEFAULT_STUDY_CASE_ID;
    const template = getStudyCaseTemplate(studyCaseId);
    const studyMetadata = normalizeStudyMetadata(req.body?.studyMetadata);
    const versionMetadata = getVersionMetadata(template.id, template.version);

    if (mode === 'scaffold' && !requestedExperimentCode) {
      return res.status(400).json({ error: 'A valid scaffold experiment code is required.' });
    }

    if (!participantCode) {
      return res.status(400).json({ error: 'participantCode is required.' });
    }

    const sessionId = buildStudySessionId({ participantCode, mode, studyCaseId });
    const cases = await caseModel.getAllCases(mode);
    const existingByExperimentCode = requestedExperimentCode
      ? cases.find((item) => String((item as any).experiment_code || '').toUpperCase() === requestedExperimentCode)
      : null;

    if (existingByExperimentCode) {
      return res.json({
        caseId: existingByExperimentCode.id,
        experiment_code: (existingByExperimentCode as any).experiment_code,
        experimentCode: (existingByExperimentCode as any).experiment_code,
        sessionId:
          normalizeResearchState(
            (existingByExperimentCode as any).researchState,
            Boolean(normalizeStudyConfig((existingByExperimentCode as any).studyConfig)?.studyMode)
          ).sessionId || sessionId,
        mode,
        existing: true,
        processed: Boolean(existingByExperimentCode.sectionStates?.length || existingByExperimentCode.sectionDrafts?.length)
      });
    }

    const existing = cases.find((item) => {
      const studyConfig = normalizeStudyConfig((item as any).studyConfig);
      const researchState = normalizeResearchState((item as any).researchState, Boolean(studyConfig?.studyMode));
      return (
        studyConfig?.studyMode &&
        studyConfig.condition === mode &&
        studyConfig.studyCaseId === studyCaseId &&
        researchState.sessionId === sessionId
      );
    });

    if (existing) {
      return res.json({
        caseId: existing.id,
        experiment_code: (existing as any).experiment_code,
        experimentCode: (existing as any).experiment_code,
        sessionId,
        mode,
        existing: true,
        processed: Boolean(existing.sectionStates?.length || existing.sectionDrafts?.length)
      });
    }

    const caseId = await caseModel.createCase({
      title: template.title,
      visits: template.visits,
      mode,
      experiment_code: requestedExperimentCode || undefined,
      studyMetadata,
      versionMetadata,
      caseInputValidation:
        mode === 'scaffold'
          ? {
              canonicalCaseId: template.id,
              canonicalCaseVersion: template.version,
              validated: false
            }
          : null,
      sessionOutcome: { status: 'in_progress' },
      studyConfig: {
        studyMode: true,
        studyCaseId: template.id,
        participantCode,
        condition: mode,
        lockedMode: true,
        fixedCase: true
      } as any,
      researchState: null
    } as any);

    const researchState = buildInitialResearchState({
      caseId,
      mode,
      studyMode: true,
      participantCode,
      sessionId,
      studyCaseId
    });

    await caseModel.updateCase(caseId, {
      studyConfig: {
        studyMode: true,
        studyCaseId: template.id,
        participantCode,
        condition: mode,
        lockedMode: true,
        fixedCase: true
      } as any,
      studyMetadata,
      versionMetadata,
      researchState: researchState as any,
      scaffoldState: mode === 'scaffold' ? (buildInitialScaffoldState(caseId, { participantCode, sessionId }) as any) : null
    } as any);

    const createdCase = await caseModel.getCase(caseId);
    res.json({
      caseId,
      experiment_code: (createdCase as any)?.experiment_code,
      experimentCode: (createdCase as any)?.experiment_code,
      sessionId,
      mode,
      existing: false,
      processed: false
    });
  } catch (error: any) {
    console.error('Error starting study session:', error);
    if (error?.code === 11000 && error?.keyPattern?.experiment_code) {
      return res.status(409).json({ error: 'This experiment code is already in use.' });
    }
    res.status(500).json({ error: error.message || 'Failed to start study session.' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { visits, title, metadata } = req.body;
    const mode = req.body?.mode === 'scaffold' ? 'scaffold' : 'write';
    const hasRequestedExperimentCode =
      typeof req.body?.experimentCode === 'string' || typeof metadata?.experimentCode === 'string';
    const requestedExperimentCode = normalizeExperimentCodeForMode(
      req.body?.experimentCode || metadata?.experimentCode,
      mode
    );

    if (!visits || !Array.isArray(visits) || visits.length === 0) {
      return res.status(400).json({ error: 'visits array is required' });
    }

    if (hasRequestedExperimentCode && !requestedExperimentCode) {
      return res.status(400).json({
        error: mode === 'scaffold'
          ? 'A valid scaffold experiment code is required.'
          : 'A valid write experiment code such as EQ005 is required.'
      });
    }

    const processedVisits: Visit[] = normalizeIncomingVisits(visits);
    const studyMetadata = normalizeStudyMetadata(metadata?.studyMetadata);
    const metadataStudyCase = getStudyCaseTemplate(metadata?.studyConfig?.studyCaseId);
    const versionMetadata = {
      ...getVersionMetadata(metadataStudyCase.id, metadataStudyCase.version),
      ...(metadata?.versionMetadata && typeof metadata.versionMetadata === 'object' ? metadata.versionMetadata : {})
    };

    const caseId = await caseModel.createCase({
      title: title || undefined,
      visits: processedVisits,
      mode,
      experiment_code: requestedExperimentCode || undefined,
      studyMetadata,
      versionMetadata,
      caseInputValidation: normalizeCaseInputValidation(metadata?.caseInputValidation),
      sessionOutcome: metadata?.sessionOutcome
        ? normalizeSessionOutcome(metadata.sessionOutcome)
        : metadata?.sessionId
          ? { status: 'in_progress' }
          : null,
      studyConfig: normalizeStudyConfig(metadata?.studyConfig) as any,
      researchState:
        metadata?.researchState
          ? normalizeResearchState(metadata.researchState, Boolean(metadata?.studyConfig?.studyMode))
          : null
    });

    // A research session is attached whenever the caller supplies a sessionId
    // (researcher-run session on the participant's own EMR). This is what links
    // participantCode <-> sessionId <-> caseId <-> mode for later recovery, and
    // it works for both write and scaffold.
    const researchSessionId =
      typeof metadata?.sessionId === 'string' && metadata.sessionId.trim()
        ? metadata.sessionId.trim()
        : undefined;
    const researchParticipantCode =
      typeof metadata?.participantCode === 'string' && metadata.participantCode.trim()
        ? metadata.participantCode.trim()
        : undefined;

    if (!metadata?.researchState && researchSessionId) {
      await caseModel.updateCase(caseId, {
        researchState: buildInitialResearchState({
          caseId,
          mode,
          studyMode: Boolean(metadata?.studyConfig?.studyMode),
          sessionId: researchSessionId,
          participantCode: researchParticipantCode
        }) as any
      } as any);
    }

    if (mode === 'scaffold') {
      await caseModel.updateCase(caseId, {
        scaffoldState: buildInitialScaffoldState(caseId, metadata) as any
      });
    }

    const createdCase = await caseModel.getCase(caseId);
    res.json({
      caseId,
      experiment_code: (createdCase as any)?.experiment_code,
      experimentCode: (createdCase as any)?.experiment_code
    });
  } catch (error: any) {
    console.error('Error creating case:', error);
    if (error?.code === 11000 && error?.keyPattern?.experiment_code) {
      return res.status(409).json({ error: 'This experiment code is already in use.' });
    }
    res.status(500).json({
      error: error.message || 'Failed to create case',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { visits, title } = req.body;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const mode =
      req.body?.mode === 'write' || req.body?.mode === 'scaffold'
        ? (req.body.mode as CaseMode)
        : ((case_.mode || 'write') as CaseMode);

    if (!visits || !Array.isArray(visits) || visits.length === 0) {
      return res.status(400).json({ error: 'visits array is required' });
    }

    const processedVisits: Visit[] = normalizeIncomingVisits(visits);

    await caseModel.updateCase(id, {
      mode,
      title: title || undefined,
      visits: processedVisits,
      processingCache: null as any,
      deidentifiedEMRs: [] as any,
      pendingTermConfirmations: [] as any,
      reviewRequired: null as any,
      evidenceCards: [] as any,
      sectionStates: [] as any,
      sectionDrafts: [] as any,
      commonMissingItems: [] as any,
      commonQuestionSets: [] as any,
      finalDraft: null as any,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      } as any,
      staleState: null as any,
      chainCache: {} as any,
      chainProgress: null as any,
      chainPerformanceLogs: [] as any,
      sectionAdequacyReviews: {} as any
    });

    res.json({ success: true, caseId: id });
  } catch (error: any) {
    console.error('Error updating case:', error);
    res.status(500).json({
      error: error.message || 'Failed to update case',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.post('/:id/timeline-import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No .xlsx file was uploaded.' });
    }

    if (!/\.xlsx$/i.test(file.originalname || '')) {
      return res.status(400).json({ error: 'Only .xlsx files are supported.' });
    }

    // Local parse first, then de-identification, then anything that can reach an
    // external model. The uploaded workbook itself is never forwarded anywhere;
    // only extracted, de-identified cell text is used downstream.
    const importResult = parseTimelineWorkbook(file.buffer);
    const deidentifiedTimelineEvents = await deidentifyTimelineEventsForOutbound(
      importResult.timelineEvents as any[]
    );
    const anyCase: any = case_;
    const nextSectionDrafts = [...(anyCase.sectionDrafts || [])];
    const nextSectionStates = [...(anyCase.sectionStates || [])];

    let nextState:
      | {
          sectionStates: any[];
          sectionDrafts: any[];
          commonMissingItems: any[];
          commonQuestionSets: any[];
        }
      | null = null;
    const mergedEvidenceCards = mergeEvidenceCards(
      anyCase.evidenceCards || [],
      buildEvidenceCardsFromTimelineEvents(deidentifiedTimelineEvents)
    );

    if (nextSectionDrafts.length > 0 && nextSectionStates.length > 0) {
      const integrated = integrateImportedTimelineIntoDrafts({
        sectionDrafts: nextSectionDrafts,
        sectionStates: nextSectionStates,
        timelineEvents: deidentifiedTimelineEvents
      });

      nextState = await recomputeQuestionState({
        sectionDrafts: integrated.sectionDrafts,
        sectionStates: integrated.sectionStates,
        evidenceCards: mergedEvidenceCards,
        caseTitle: anyCase.title,
        caseData: anyCase
      });
    }

    await caseModel.updateCase(id, {
      timelineEvents: importResult.timelineEvents as any,
      evidenceCards: mergedEvidenceCards,
      ...(nextState
        ? {
            sectionDrafts: nextState.sectionDrafts,
            sectionStates: nextState.sectionStates,
            commonMissingItems: nextState.commonMissingItems,
            commonQuestionSets: nextState.commonQuestionSets,
            draftsBySection: deriveDraftMapFromSectionDrafts(nextState.sectionDrafts)
          }
        : {}),
      processingCache: null,
      chainCache: {},
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      sectionAdequacyReviews: {},
      staleState: buildStaleState('EVIDENCE_REGENERATED')
    } as any);

    const responseState = buildCaseStateResponse(anyCase, {
      timelineEvents: importResult.timelineEvents as any,
      sectionDrafts: nextState?.sectionDrafts || nextSectionDrafts,
      sectionStates: nextState?.sectionStates || nextSectionStates,
      commonMissingItems: nextState?.commonMissingItems || anyCase.commonMissingItems || [],
      commonQuestionSets: nextState?.commonQuestionSets || anyCase.commonQuestionSets || [],
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      staleState: buildStaleState('EVIDENCE_REGENERATED')
    });

    res.json({
      importedRows: importResult.importedRows,
      skippedRows: importResult.skippedRows,
      columnMapping: importResult.columnMapping,
      detectedColumns: importResult.detectedColumns,
      previewRows: importResult.previewRows,
      warnings: importResult.warnings,
      ...responseState
    });
  } catch (error: any) {
    console.error('Error importing timeline excel:', error);
    res.status(500).json({ error: error.message || 'Failed to import timeline Excel file.' });
  }
});

router.post('/:id/process', async (req: Request, res: Response) => {
  const processStartedAt = Date.now();
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const visitsForChain1 = case_.visits.map((visit: any, idx: number) => ({
      index: visit.index ?? visit.visitIndex ?? idx + 1,
      date: visit.date ?? visit.visitDateTime ?? '',
      text: visit.soapText ?? visit.sanitizedText ?? ''
    }));
    const anyCase: any = case_;
    const inputHash = buildProcessInputHash(
      visitsForChain1,
      // Must mirror reprocessCaseFromStoredTerms exactly (pendingId included), otherwise the hash
      // stored in processingCache can never match and the cache always misses.
      (anyCase.pendingTermConfirmations || []).map((item: any) => ({
        pendingId: item.pendingId,
        termId: item.termId,
        status: item.status,
        confirmedTerm: item.confirmedTerm,
        customReplacement: item.customReplacement
      })),
      (anyCase.timelineEvents || []).map((item: any) => ({
        timelineEventId: item.timelineEventId,
        columnOrder: item.columnOrder || [],
        cells: item.cells || {},
        date: item.date,
        visitNo: item.visitNo,
        symptom: item.symptom,
        test: item.test,
        diagnosis: item.diagnosis,
        treatment: item.treatment,
        outcome: item.outcome,
        note: item.note
      }))
    );

    const hasReusableProcessingResult =
      anyCase.processingCache?.inputHash === inputHash &&
      Array.isArray(anyCase.sectionStates) &&
      anyCase.sectionStates.length > 0 &&
      (shouldDeferStudyScaffoldDrafts(anyCase) ||
        (Array.isArray(anyCase.sectionDrafts) && anyCase.sectionDrafts.length > 0));

    if (hasReusableProcessingResult) {
      const researchState = normalizeResearchState(anyCase.researchState, Boolean(anyCase.studyConfig?.studyMode));
      if (isResearchTracked(researchState) && !researchState.interactionEvents.some((item) => item.eventType === 'case_processed')) {
        await caseModel.updateCase(id, {
          researchState: appendResearchEvent(researchState, {
            eventId: randomUUID(),
            eventType: 'case_processed',
            caseId: id,
            mode: anyCase.mode || 'write',
            sessionId: researchState.sessionId,
            participantCode: researchState.participantCode,
            metadata: { cached: true }
          }) as any
        } as any);
      }
      console.log(`[PROCESS ${id}] cache hit in ${Date.now() - processStartedAt}ms`);
      const sectionsOverview = buildProcessSectionsOverview(
        anyCase,
        anyCase.sectionStates || [],
        anyCase.sectionDrafts || []
      );

      return res.json({
        caseId: id,
        sectionsOverview,
        cached: true,
        riskLevel: anyCase.reviewRequired?.riskLevel || 'LOW',
        reviewRequired: anyCase.reviewRequired || null,
        pendingTermConfirmations: anyCase.pendingTermConfirmations || []
      });
    }

    // The fixed study EMR gets one frozen, reviewed result so that every
    // participant judges the same evidence cards and the same AI drafts.
    const hasTermDecisionsForFrozen = (anyCase.pendingTermConfirmations || []).some(
      (item: any) => item?.status === 'CONFIRMED' || item?.status === 'REJECTED'
    );
    const frozenStudyResult =
      (anyCase.mode || 'write') === 'scaffold' &&
      (anyCase.timelineEvents || []).length === 0 &&
      !hasTermDecisionsForFrozen
        ? getFrozenStudyCaseResult(visitsForChain1.map((visit: any) => visit.text))
        : null;

    if (frozenStudyResult) {
      const frozenAt = new Date().toISOString();
      const researchState = normalizeResearchState(anyCase.researchState, Boolean(anyCase.studyConfig?.studyMode));
      await caseModel.updateCase(id, {
        ...frozenStudyResult,
        staleState: { isStale: true, staleReason: 'EVIDENCE_REGENERATED', staleAt: frozenAt },
        chainProgress: {
          currentStep: null,
          completedSteps: ['PREPROCESS', 'CHAIN1', 'CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5'],
          estimatedRemainingSteps: [],
          updatedAt: frozenAt
        },
        chainPerformanceLogs: [],
        ...(isResearchTracked(researchState)
          ? {
              researchState: appendResearchEvent(researchState, {
                eventId: randomUUID(),
                eventType: 'case_processed',
                caseId: id,
                mode: anyCase.mode || 'write',
                sessionId: researchState.sessionId,
                participantCode: researchState.participantCode,
                metadata: { cached: true, frozenStudyCase: true }
              })
            }
          : {})
      } as any);

      console.log(`[PROCESS ${id}] frozen study case result applied in ${Date.now() - processStartedAt}ms`);
      return res.json({
        caseId: id,
        sectionsOverview: buildProcessSectionsOverview(
          anyCase,
          (frozenStudyResult.sectionStates as any[]) || [],
          (frozenStudyResult.sectionDrafts as any[]) || []
        ),
        cached: true,
        frozenStudyCase: true,
        riskLevel: 'LOW',
        reviewRequired: null,
        pendingTermConfirmations: frozenStudyResult.pendingTermConfirmations || []
      });
    }

    const terminologyRuntime = getWriteTerminologyRuntime();
    const result = await reprocessCaseFromStoredTerms({
      caseId: id,
      caseData: anyCase,
      staleReason: 'EVIDENCE_REGENERATED',
      semanticMatcher: terminologyRuntime.semanticMatcher,
      llmResolver: terminologyRuntime.llmResolver
    });

    if (result.blocked) {
      console.log(
        `[PROCESS ${id}] blocked by HIGH de-identification risk in ${Date.now() - processStartedAt}ms`
      );
      return res.status(409).json({
        caseId: id,
        blocked: true,
        stage: 'DEIDENTIFICATION_REVIEW',
        riskLevel: 'HIGH',
        reviewRequired: result.preprocessedChain1.reviewRequired,
        pendingTermConfirmations: result.preprocessedChain1.pendingTermConfirmations
      });
    }

    const sectionsOverview = buildProcessSectionsOverview(
      anyCase,
      result.nextState.sectionStates,
      result.nextState.sectionDrafts
    );
    const researchState = normalizeResearchState(anyCase.researchState, Boolean(anyCase.studyConfig?.studyMode));
    if (isResearchTracked(researchState)) {
      await caseModel.updateCase(id, {
        researchState: appendResearchEvent(researchState, {
          eventId: randomUUID(),
          eventType: 'case_processed',
          caseId: id,
          mode: anyCase.mode || 'write',
          sessionId: researchState.sessionId,
          participantCode: researchState.participantCode,
          metadata: { cached: false }
        }) as any
      } as any);
    }

    console.log(
      `[PROCESS ${id}] completed in ${Date.now() - processStartedAt}ms ` +
        `(visits=${visitsForChain1.length}, evidence=${result.evidenceCards.length})`
    );
    res.json({
      caseId: id,
      sectionsOverview,
      cached: false,
      riskLevel: result.preprocessedChain1.reviewRequired?.riskLevel || 'LOW',
      reviewRequired: result.preprocessedChain1.reviewRequired,
      pendingTermConfirmations: result.preprocessedChain1.pendingTermConfirmations
    });
  } catch (error: any) {
    console.error(`[PROCESS] failed - ${summarizeError(error)}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Attach (or refresh) the research session on an existing case. Needed because
 * the input page may create a draft case before the researcher metadata is
 * known, and because re-entering a session must not mint a new sessionId.
 */
router.put('/:id/research/session', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required.' });
    }

    const participantCode = String(req.body?.participantCode || '').trim() || undefined;
    const anyCase: any = case_;
    const existing = normalizeResearchState(anyCase.researchState, Boolean(anyCase.studyConfig?.studyMode));
    const studyMetadata = normalizeStudyMetadata(req.body?.studyMetadata);

    // Keep the already-recorded trajectory: only seed a fresh state when this
    // case has never carried one.
    const nextState = existing.interactionEvents.length
      ? {
          ...existing,
          sessionId: existing.sessionId || sessionId,
          participantCode: participantCode || existing.participantCode
        }
      : buildInitialResearchState({
          caseId: id,
          mode: (anyCase.mode || 'write') as CaseMode,
          studyMode: existing.studyMode,
          sessionId,
          participantCode
        });

    await caseModel.updateCase(id, {
      researchState: nextState as any,
      ...(studyMetadata ? { studyMetadata } : {})
    } as any);
    res.json({ success: true, researchState: nextState });
  } catch (error: any) {
    console.error('Error saving research session:', error);
    res.status(500).json({ error: error.message || 'Failed to save research session.' });
  }
});

router.put('/:id/research/metadata', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const updates: any = {};

    if (req.body?.studyMetadata !== undefined) {
      updates.studyMetadata = normalizeStudyMetadata(req.body.studyMetadata);
    }

    if (req.body?.caseInputValidation !== undefined) {
      updates.caseInputValidation = normalizeCaseInputValidation(req.body.caseInputValidation);
    }

    if (req.body?.sessionOutcome !== undefined) {
      updates.sessionOutcome = normalizeSessionOutcome(req.body.sessionOutcome);
    }

    if (req.body?.researcherAssistance !== undefined && Array.isArray(req.body.researcherAssistance)) {
      updates.researcherAssistance = req.body.researcherAssistance
        .map(normalizeResearcherAssistance)
        .filter(Boolean);
    }

    const assistanceEntry = normalizeResearcherAssistance(req.body?.appendResearcherAssistance);
    if (assistanceEntry) {
      updates.researcherAssistance = [...(anyCase.researcherAssistance || []), assistanceEntry].slice(-200);
    }

    if (req.body?.technicalIssues !== undefined && Array.isArray(req.body.technicalIssues)) {
      updates.technicalIssues = req.body.technicalIssues.map(normalizeTechnicalIssue).filter(Boolean);
    }

    const issueEntry = normalizeTechnicalIssue(req.body?.appendTechnicalIssue);
    if (issueEntry) {
      updates.technicalIssues = [...(anyCase.technicalIssues || []), issueEntry].slice(-200);
    }

    if (Object.keys(updates).length === 0) {
      return res.json({
        success: true,
        studyMetadata: anyCase.studyMetadata || null,
        caseInputValidation: anyCase.caseInputValidation || null,
        sessionOutcome: anyCase.sessionOutcome || null,
        researcherAssistance: anyCase.researcherAssistance || [],
        technicalIssues: anyCase.technicalIssues || []
      });
    }

    await caseModel.updateCase(id, updates as any);
    const updated = await caseModel.getCase(id);

    res.json({
      success: true,
      studyMetadata: (updated as any)?.studyMetadata || null,
      caseInputValidation: (updated as any)?.caseInputValidation || null,
      sessionOutcome: (updated as any)?.sessionOutcome || null,
      researcherAssistance: (updated as any)?.researcherAssistance || [],
      technicalIssues: (updated as any)?.technicalIssues || []
    });
  } catch (error: any) {
    console.error('Error updating research metadata:', error);
    res.status(500).json({ error: error.message || 'Failed to update research metadata.' });
  }
});

router.post('/:id/research/events', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const eventType = String(req.body?.eventType || '').trim() as ResearchEventType;
    const allowedEventTypes = new Set<ResearchEventType>([
      'session_start',
      'case_created',
      'mode_assigned',
      'case_processed',
      'section_opened',
      'evidence_opened',
      'question_viewed',
      'question_answered',
      'review_ai_requested',
      'review_ai_result_viewed',
      'section_completed',
      'final_output_viewed',
      'export_requested',
      'session_completed',
      'section_purpose_viewed',
      'learner_reflection_saved',
      'record_review_completed',
      'missing_item_viewed',
      'missing_item_classified',
      'question_task_completed',
      'additional_confirmation_marked',
      'teacher_review_marked',
      'pre_reveal_snapshot_created',
      'ai_draft_revealed',
      'post_ai_review_started',
      'draft_judgment_saved',
      'draft_review_completed',
      'record_review_started'
    ]);

    if (!allowedEventTypes.has(eventType)) {
      return res.status(400).json({ error: 'A valid eventType is required.' });
    }

    const sectionId =
      typeof req.body?.sectionId === 'string' && isCareSection(req.body.sectionId)
        ? (req.body.sectionId as CareSection)
        : undefined;
    const studyConfig = normalizeStudyConfig((case_ as any).studyConfig);
    const researchState = normalizeResearchState((case_ as any).researchState, Boolean(studyConfig?.studyMode));
    const eventId =
      typeof req.body?.eventId === 'string' && req.body.eventId.trim() ? req.body.eventId.trim() : randomUUID();
    const nextState = appendResearchEvent(researchState, {
      eventId,
      eventType,
      caseId: id,
      mode: ((case_ as any).mode || 'write') as CaseMode,
      sectionId,
      sessionId:
        typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
          ? req.body.sessionId.trim()
          : researchState.sessionId,
      participantCode:
        typeof req.body?.participantCode === 'string' && req.body.participantCode.trim()
          ? req.body.participantCode.trim()
          : researchState.participantCode,
      metadata: sanitizeResearchMetadata(req.body?.metadata)
    });

    await caseModel.updateCase(id, { researchState: nextState as any } as any);
    res.json({ success: true, researchState: nextState });
  } catch (error: any) {
    console.error('Error logging research event:', error);
    res.status(500).json({ error: error.message || 'Failed to log research event.' });
  }
});

/**
 * Researcher-only guard. No new authentication system: when RESEARCH_EXPORT_TOKEN
 * is unset (local development, the default) the route behaves exactly as before.
 * When the researcher sets it on the deployed instance, the export endpoints
 * require it via `x-research-token` or `?token=`.
 */
function assertResearcherAccess(req: Request, res: Response): boolean {
  const expected = String(process.env.RESEARCH_EXPORT_TOKEN || '').trim();
  if (!expected) return true;

  const provided =
    String(req.header('x-research-token') || '').trim() || String(req.query.token || '').trim();

  if (provided !== expected) {
    res.status(403).json({ error: 'Researcher access token is required for research export.' });
    return false;
  }

  return true;
}

router.get('/:id/research/export', async (req: Request, res: Response) => {
  try {
    if (!assertResearcherAccess(req, res)) return;

    const { id } = req.params;
    const format = String(req.query.format || 'json').trim().toLowerCase();
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const researchState = normalizeResearchState(anyCase.researchState, Boolean(anyCase.studyConfig?.studyMode));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', buildContentDispositionHeader(`case_${id}_research.csv`));
      return res.send(
        buildResearchEventCsv({
          caseId: id,
          experimentCode: (case_ as any).experiment_code,
          mode: (case_.mode || 'write') as CaseMode,
          researchState
        })
      );
    }

    const sectionInteractions = await caseModel.getInteractionsByKeys(id, [
      ...ALL_CARE_SECTIONS,
      COMMON_INTERACTION_KEY
    ]);

    res.json(
      await buildResearchExportPayload({
        caseId: id,
        caseData: anyCase,
        researchState,
        sectionInteractions
      })
    );
  } catch (error: any) {
    console.error('Error exporting research data:', error);
    res.status(500).json({ error: error.message || 'Failed to export research data.' });
  }
});

router.patch('/:id/title', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    await caseModel.updateCase(id, { title: title || undefined });
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating case title:', error);
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/front-matter', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, keywords, discussion } = req.body;

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }
    const anyCase: any = case_;

    const rawDraftsBySection = ((case_ as any).draftsBySection || {}) as Record<string, string>;
    const normalizedTitle = String(title || '').trim();
    const normalizedKeywords = Array.isArray(keywords)
      ? keywords.map((item) => String(item || '').trim()).filter(Boolean)
      : String(keywords || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
    const normalizedDiscussion = String(discussion || '').trim();

    const nextDraftsBySection = {
      ...rawDraftsBySection,
      TITLE: normalizedTitle,
      KEYWORDS: normalizedKeywords.join(', '),
      DISCUSSION_CONCLUSION: normalizedDiscussion
    };
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    upsertSectionDraftText(sectionDrafts, CareSection.TITLE, normalizedTitle);
    upsertSectionDraftText(sectionDrafts, CareSection.DISCUSSION_CONCLUSION, normalizedDiscussion);
    const sectionStates: any[] = anyCase.sectionStates || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];

    const nextState =
      sectionDrafts.length > 0 && sectionStates.length > 0
        ? await recomputeQuestionState({
            sectionDrafts,
            sectionStates,
            evidenceCards,
            caseTitle: normalizedTitle,
            caseData: anyCase
          })
        : null;

    await caseModel.updateCase(id, {
      title: normalizedTitle || undefined,
      draftsBySection: nextDraftsBySection as any,
      chainCache: nextState
        ? {
            ...(anyCase.chainCache || {}),
            CHAIN4: buildChainCacheEntry(nextState.cacheMeta.chain4InputHash, {
              commonMissingItems: nextState.commonMissingItems,
              sectionMissingBySection: nextState.sectionStates.map((state) => ({
                sectionId: state.sectionId,
                missingInfoBullets: state.missingInfoBullets || []
              }))
            }),
            CHAIN5: buildChainCacheEntry(nextState.cacheMeta.chain5InputHash, {
              commonQuestionSets: nextState.commonQuestionSets,
              sectionQuestionsBySection: nextState.sectionStates.map((state) => ({
                sectionId: state.sectionId,
                recommendedQuestions: state.recommendedQuestions || []
              }))
            })
          }
        : anyCase.chainCache || {},
      ...(nextState
        ? {
            sectionStates: nextState.sectionStates,
            sectionDrafts: nextState.sectionDrafts,
            commonMissingItems: nextState.commonMissingItems,
            commonQuestionSets: nextState.commonQuestionSets
          }
        : {}),
      staleState: buildStaleState('ANSWER_UPDATED'),
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE'
      }
    } as any);

    res.json({
      success: true,
      title: normalizedTitle,
      keywords: normalizedKeywords,
      ...buildCaseStateResponse(anyCase, {
        draftsBySection: nextDraftsBySection,
        sectionDrafts: nextState?.sectionDrafts || sectionDrafts,
        sectionStates: nextState?.sectionStates || sectionStates,
        commonMissingItems: nextState?.commonMissingItems || anyCase.commonMissingItems || [],
        commonQuestionSets: nextState?.commonQuestionSets || anyCase.commonQuestionSets || [],
        staleState: buildStaleState('ANSWER_UPDATED'),
        finalDraft: null,
        finalComposeStatus: {
          status: 'IDLE'
        }
      })
    });
  } catch (error: any) {
    console.error('Error updating front matter:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/common-questions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const commonQuestionSets = anyCase.commonQuestionSets || [];
    const commonMissingItems = anyCase.commonMissingItems || [];

    const interactionResults = await Promise.all(
      [...ALL_CARE_SECTIONS, COMMON_INTERACTION_KEY as any].map((sectionId) =>
        caseModel.getInteractionByKey(id, String(sectionId))
      )
    );
    const answeredHistory = interactionResults.flatMap((interaction) => interaction?.qnaHistory || []);
    const seenQuestions = new Set<string>();
    const filteredQuestions = (commonQuestionSets || []).filter((entry: any) => {
      const question = String(entry?.question || '').trim();
      if (!question) return false;
      if (seenQuestions.has(question)) return false;
      if (answeredHistory.some((historyItem) => isSameQuestion(question, historyItem.question))) {
        return false;
      }
      seenQuestions.add(question);
      return true;
    });
    const commonInteraction = interactionResults[interactionResults.length - 1];

    res.json({
      questions: filteredQuestions.map((entry: any) => ({
        question: normalizeQuestionText(entry.question, entry.category),
        category: entry.category
      })).filter((entry: any) => entry.question),
      qnaHistory: commonInteraction?.qnaHistory || [],
      missingInfo: uniqueStrings(commonMissingItems.map((item: any) => item.item))
    });
  } catch (error: any) {
    console.error('Error getting common questions:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/pending-terms', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const pendingTermConfirmations = ((case_ as any).pendingTermConfirmations || []).sort((a: any, b: any) => {
      if (a.status === b.status) {
        return String(a.surface || '').localeCompare(String(b.surface || ''));
      }
      return String(a.status).localeCompare(String(b.status));
    });

    res.json({
      items: pendingTermConfirmations,
      pendingCount: pendingTermConfirmations.filter((item: any) => item.status === 'PENDING').length
    });
  } catch (error: any) {
    console.error('Error getting pending terms:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pending-terms/:pendingId/confirm', async (req: Request, res: Response) => {
  try {
    const { id, pendingId } = req.params;
    const { confirmedTerm } = req.body as { confirmedTerm?: string };
    const result = await mutatePendingTermDecision({
      caseId: id,
      pendingId,
      action: 'confirm',
      confirmedTerm
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('Error confirming pending term:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pending-terms/:pendingId/reject', async (req: Request, res: Response) => {
  try {
    const { id, pendingId } = req.params;
    const { customReplacement } = req.body as { customReplacement?: string };
    const result = await mutatePendingTermDecision({
      caseId: id,
      pendingId,
      action: 'reject',
      customReplacement
    });

    return res.status(result.httpStatus).json(result.body);
  } catch (error: any) {
    console.error('Error rejecting pending term:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/common-questions/answer', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body as { question?: string; answer?: string };

    if (!question || !answer?.trim()) {
      return res.status(400).json({ error: 'question and answer are required' });
    }

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];
    const sectionStates: any[] = anyCase.sectionStates || [];
    const evidenceCards: any[] = anyCase.evidenceCards || [];
    const commonQuestionSets: Array<{ question: string; targetSectionIds: CareSection[]; category?: string }> =
      anyCase.commonQuestionSets || [];
    const commonInteraction = await caseModel.getInteractionByKey(id, COMMON_INTERACTION_KEY);
    const commonQnaHistory: QnAPair[] = commonInteraction?.qnaHistory || [];
    const undoEntry = {
      timestamp: new Date().toISOString(),
      kind: 'COMMON' as const,
      question,
      sectionId: COMMON_INTERACTION_KEY,
      before: {
        draftsBySection: cloneJson((anyCase as any).draftsBySection || {}),
        sectionDrafts: cloneJson(sectionDrafts),
        sectionStates: cloneJson(sectionStates),
        commonMissingItems: cloneJson(anyCase.commonMissingItems || []),
        commonQuestionSets: cloneJson(anyCase.commonQuestionSets || []),
        sectionAdequacyReviews: cloneJson(anyCase.sectionAdequacyReviews || {}),
        interactions: [
          {
            sectionId: COMMON_INTERACTION_KEY,
            qnaHistory: cloneJson(commonQnaHistory)
          }
        ]
      }
    };

    commonQnaHistory.push({
      question,
      answer,
      timestamp: new Date().toISOString()
    });

    const targetSections = findTargetSectionsForCommonQuestion({
      question,
      commonQuestionSets
    });

    const sectionInteractions = await caseModel.getInteractionsByKeys(id, targetSections);
    const sectionInteractionMap = new Map(
      sectionInteractions.map((interaction) => [interaction.sectionId, interaction])
    );

    await mapWithConcurrency(targetSections, 2, async (sectionId) => {
        const draftEntry = sectionDrafts.find((draft) => draft.sectionId === sectionId);
        const state = sectionStates.find((item) => item.sectionId === sectionId);
        if (!draftEntry || !state) return null;

        const sectionQnaHistory = sectionInteractionMap.get(sectionId)?.qnaHistory || [];
        const mergedQnaHistory =
          targetSections.length > 2
            ? buildCondensedQnaHistory({
                sectionQnaHistory,
                commonQnaHistory,
                question,
                answer
              })
            : uniqueStrings([
                ...sectionQnaHistory.map((item) => JSON.stringify(item)),
                ...commonQnaHistory.map((item) => JSON.stringify(item))
              ]).map((item) => JSON.parse(item));

        // Raw common answer is already persisted above; only a de-identified
        // copy crosses the external boundary.
        const outboundContext = createOutboundDeidContext();
        const updateResult = await runSectionDraftUpdate({
          sectionId,
          currentDraft: draftEntry.draftText || '',
          evidenceCards: getRelevantEvidence(evidenceCards, sectionId),
          qnaHistory: await deidentifyQnaForOutbound(mergedQnaHistory, outboundContext),
          pendingItems: draftEntry.openIssues?.length ? draftEntry.openIssues : state.missingInfoBullets || [],
          question: await deidentifyOutboundField(question, outboundContext),
          answer: await deidentifyOutboundField(answer, outboundContext)
        });

        applyDraftUpdateResultToEntry(draftEntry, updateResult);
        return null;
      });

    const nextState = await recomputeQuestionState({
      sectionDrafts,
      sectionStates,
      evidenceCards,
      caseTitle: case_.title,
      caseData: anyCase
    });

    await caseModel.updateCase(id, {
      sectionDrafts: nextState.sectionDrafts,
      sectionStates: nextState.sectionStates,
      draftsBySection: deriveDraftMapFromSectionDrafts(nextState.sectionDrafts),
      commonMissingItems: nextState.commonMissingItems,
      commonQuestionSets: nextState.commonQuestionSets,
      answerUndoStack: pushAnswerUndoEntry(anyCase.answerUndoStack || [], undoEntry),
      finalDraft: null,
      finalComposeStatus: {
        status: 'IDLE',
        requestedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: undefined
      },
      staleState: buildStaleState('ANSWER_UPDATED'),
      chainCache: {
        ...(anyCase.chainCache || {}),
        CHAIN4: buildChainCacheEntry(nextState.cacheMeta.chain4InputHash, {
          commonMissingItems: nextState.commonMissingItems,
          sectionMissingBySection: nextState.sectionStates.map((state) => ({
            sectionId: state.sectionId,
            missingInfoBullets: state.missingInfoBullets || []
          }))
        }),
        CHAIN5: buildChainCacheEntry(nextState.cacheMeta.chain5InputHash, {
          commonQuestionSets: nextState.commonQuestionSets,
          sectionQuestionsBySection: nextState.sectionStates.map((state) => ({
            sectionId: state.sectionId,
            recommendedQuestions: state.recommendedQuestions || []
          }))
        })
      },
      sectionAdequacyReviews: {}
    } as any);
    await caseModel.saveInteractionByKey(id, {
      sectionId: COMMON_INTERACTION_KEY,
      qnaHistory: commonQnaHistory
    });

    res.json({
      updatedDraftsBySection: deriveDraftMapFromSectionDrafts(nextState.sectionDrafts),
      qnaHistory: commonQnaHistory,
      commonQuestions: nextState.commonQuestionSets.map((entry: any) => ({
        question: normalizeQuestionText(entry.question, entry.category),
        category: entry.category
      })),
      commonMissingInfo: uniqueStrings(nextState.commonMissingItems.map((item: any) => item.item)),
      sectionStates: nextState.sectionStates.map((state: any) => ({
        sectionId: state.sectionId,
        status: state.status,
        rationaleText: state.rationaleText || '',
        missingInfoBullets: state.missingInfoBullets || [],
        recommendedQuestions: state.recommendedQuestions || []
      })),
      canUndo: true,
      staleState: buildStaleState('ANSWER_UPDATED')
    });
  } catch (error: any) {
    console.error('Error answering common question:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/undo-last-answer', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const undoStack = anyCase.answerUndoStack || [];
    const latestEntry = undoStack[undoStack.length - 1];

    if (!latestEntry) {
      return res.status(400).json({ error: 'There is no answer to undo.' });
    }

    await caseModel.updateCase(id, {
      draftsBySection: latestEntry.before.draftsBySection || {},
      sectionDrafts: latestEntry.before.sectionDrafts || [],
      sectionStates: latestEntry.before.sectionStates || [],
      commonMissingItems: latestEntry.before.commonMissingItems || [],
      commonQuestionSets: latestEntry.before.commonQuestionSets || [],
      sectionAdequacyReviews: latestEntry.before.sectionAdequacyReviews || {},
      answerUndoStack: undoStack.slice(0, -1)
    } as any);

    await Promise.all(
      (latestEntry.before.interactions || []).map((interaction: any) =>
        caseModel.saveInteractionByKey(id, {
          sectionId: interaction.sectionId,
          qnaHistory: interaction.qnaHistory || []
        })
      )
    );

    res.json({
      success: true,
      undone: {
        kind: latestEntry.kind,
        question: latestEntry.question,
        sectionId: latestEntry.sectionId
      },
      remainingUndoCount: Math.max(0, undoStack.length - 1),
      restoredInteractions: latestEntry.before.interactions || [],
      ...buildCaseStateResponse(anyCase, {
        draftsBySection: latestEntry.before.draftsBySection || {},
        sectionDrafts: latestEntry.before.sectionDrafts || [],
        sectionStates: latestEntry.before.sectionStates || [],
        commonMissingItems: latestEntry.before.commonMissingItems || [],
        commonQuestionSets: latestEntry.before.commonQuestionSets || []
      })
    });
  } catch (error: any) {
    console.error('Error undoing last answer:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    res.json(case_);
  } catch (error: any) {
    console.error('Error getting case:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/summary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const includeDeidentifiedEMRs = req.query.includeDeidentifiedEMRs !== 'false';
    const includePerformanceLogs = req.query.includePerformanceLogs !== 'false';
    const includePendingTerms = req.query.includePendingTerms !== 'false';

    // The stored title is user-authored and never carried privacy placeholders,
    // so the display renderer cannot clean it. Supply a de-identified copy for
    // publication-facing surfaces; `title` itself is returned unchanged.
    res.json(
      Object.assign(
        buildCaseSummaryResponseWithOptions(case_, {
          includeDeidentifiedEMRs,
          includePerformanceLogs,
          includePendingTerms
        }),
        { displayTitle: await deidentifyOutboundField(case_.title) }
      )
    );
  } catch (error: any) {
    console.error('Error getting case summary:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    await caseModel.deleteCase(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting case:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/sections', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const sectionStates: any[] = anyCase.sectionStates || [];
    const sectionDrafts: any[] = anyCase.sectionDrafts || [];

    const sections = sectionStates.map((state) => {
      const draft = sectionDrafts.find((item) => item.sectionId === state.sectionId);
      return {
        section: state.sectionId,
        status: state.status,
        rationaleText: state.rationaleText,
        missingInfoBullets: state.missingInfoBullets || [],
        recommendedQuestions: state.recommendedQuestions || [],
        draftSnippet: draft?.draftText?.substring(0, 200) || ''
      };
    });

    res.json({ sections });
  } catch (error: any) {
    console.error('Error getting sections:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/final-compose-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const case_ = await caseModel.getCase(id);

    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;

    res.json({
      caseId: id,
      experiment_code: (case_ as any).experiment_code,
      experimentCode: (case_ as any).experiment_code,
      title: case_.title || '',
      displayTitle: await deidentifyOutboundField(case_.title),
      finalDraft: anyCase.finalDraft || null,
      staleState: anyCase.staleState || null,
      finalComposeStatus:
        anyCase.finalComposeStatus || {
          status: anyCase.finalDraft ? 'COMPLETED' : 'IDLE'
        }
    });
  } catch (error: any) {
    console.error('Error getting final-compose status:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/final-compose', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { contributionAnswers } = req.body as {
      contributionAnswers?: Array<{ question: string; answer: string }>;
    };

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const staleWarning = buildFinalComposeWarning(anyCase);
    const qnaHistoryBySection = await collectQnaHistoryBySection(id);
    const chain7InputHash = buildChain7InputHash({
      sectionDrafts: anyCase.sectionDrafts || [],
      evidenceCards: anyCase.evidenceCards || [],
      qnaHistoryBySection,
      contributionAnswers
    });
    const canReuseFinalDraft =
      Boolean(anyCase.finalDraft) &&
      !anyCase.staleState?.isStale &&
      hasChainCacheHit(anyCase, 'CHAIN7', chain7InputHash);

    if (canReuseFinalDraft) {
      await caseModel.updateCase(id, {
        chainCache: {
          ...(anyCase.chainCache || {}),
          CHAIN7: buildChainCacheEntry(chain7InputHash, anyCase.finalDraft)
        },
        chainPerformanceLogs: appendPerformanceLog(
          anyCase.chainPerformanceLogs || [],
          buildPerformanceLog({
            chainName: 'CHAIN7',
            startedAt: new Date().toISOString(),
            inputHash: chain7InputHash,
            cacheHit: true,
            llmCallCount: 0
          })
        ),
        finalComposeStatus: {
          status: 'COMPLETED',
          requestedAt: (anyCase.finalComposeStatus as any)?.requestedAt,
          startedAt: (anyCase.finalComposeStatus as any)?.startedAt,
          completedAt: new Date().toISOString()
        }
      } as any);

      return res.status(200).json({
        caseId: id,
        started: false,
        cached: true,
        finalComposeStatus: {
          status: 'COMPLETED',
          requestedAt: (anyCase.finalComposeStatus as any)?.requestedAt,
          startedAt: (anyCase.finalComposeStatus as any)?.startedAt,
          completedAt: new Date().toISOString()
        },
        staleState: anyCase.staleState || null,
        warning: null
      });
    }

    const previousStatus = anyCase.finalComposeStatus;
    const now = new Date().toISOString();
    const isAlreadyRunning = runningFinalComposeJobs.has(id);
    const nextStatus = isAlreadyRunning
      ? previousStatus || {
          status: 'RUNNING',
          requestedAt: now,
          startedAt: now
        }
      : {
          status: 'QUEUED',
          requestedAt: now,
          startedAt: previousStatus?.startedAt,
          completedAt: undefined,
          errorMessage: undefined
        };

    if (!isAlreadyRunning) {
      await caseModel.updateCase(id, {
        finalComposeStatus: nextStatus
      } as any);

      runFinalComposeJob({
        caseId: id,
        contributionAnswers,
        inputHash: chain7InputHash
      }).catch((error) => {
        console.error('Background final-compose failed:', error);
      });
    }

    res.status(202).json({
      caseId: id,
      started: !isAlreadyRunning,
      finalComposeStatus: nextStatus,
      staleState: anyCase.staleState || null,
      warning: staleWarning
    });
  } catch (error: any) {
    console.error('Error in final-compose:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/export-docx', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { mode, layout } = req.body as { mode?: ExportMode; layout?: ExportLayout };

    const exportMode = (mode || 'final_manuscript') as ExportMode;
    const exportLayout = (layout || 'one_paragraph') as ExportLayout;
    const supportedModes: ExportMode[] = [
      'current_section_drafts',
      'final_manuscript',
      'final_manuscript_with_checklist',
      'final_manuscript_with_traceability',
      'scaffold_review'
    ];
    const supportedLayouts: ExportLayout[] = ['one_paragraph', 'two_paragraph'];

    if (!supportedModes.includes(exportMode)) {
      return res.status(400).json({ error: 'Unsupported export mode.' });
    }

    if (!supportedLayouts.includes(exportLayout)) {
      return res.status(400).json({ error: 'Unsupported export layout.' });
    }

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const requestedAt = new Date().toISOString();
    const exportId = `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // The case title is typed by the author and is stored raw, so it never
    // acquired privacy placeholders and the publication renderer cannot clean
    // it. De-identify it here so an identifier the author typed does not end up
    // printed on the exported manuscript. The stored title is left untouched.
    const exportCaseData = {
      ...(case_ as any),
      title: await deidentifyOutboundField((case_ as any).title)
    };

    const { buffer, fileName } = await exportCaseToDocx(exportCaseData, exportMode, exportLayout);

    await caseModel.updateCase(id, {
      exportLogs: appendExportLog((case_ as any).exportLogs || [], {
        exportId,
        requestedAt,
        mode: exportMode,
        layout: exportLayout,
        succeeded: true,
        fileName
      })
    } as any);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', buildContentDispositionHeader(fileName));
    res.send(buffer);
  } catch (error: any) {
    console.error('Error exporting case as docx:', error);
    try {
      const { id } = req.params;
      const case_ = await caseModel.getCase(id);
      if (case_) {
        const { mode, layout } = req.body as { mode?: ExportMode; layout?: ExportLayout };
        await caseModel.updateCase(id, {
          exportLogs: appendExportLog((case_ as any).exportLogs || [], {
            exportId: `export_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            requestedAt: new Date().toISOString(),
            mode: (mode || 'final_manuscript') as ExportMode,
            layout: (layout || 'one_paragraph') as ExportLayout,
            succeeded: false,
            errorMessage: error.message || 'Failed to export .docx file.'
          })
        } as any);
      }
    } catch (logError) {
      console.error('Failed to persist export log:', logError);
    }
    res.status(500).json({ error: error.message || 'Failed to export .docx file.' });
  }
});

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string) || 'txt';

    if (format !== 'txt') {
      return res.status(400).json({ error: 'Only txt export is supported in this MVP.' });
    }

    const case_ = await caseModel.getCase(id);
    if (!case_) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const anyCase: any = case_;
    const finalDraft = anyCase.finalDraft;
    if (!finalDraft || !finalDraft.fullTextBySection) {
      return res.status(400).json({ error: 'Final draft not found. Run final-compose first.' });
    }

    const sectionOrder: CareSection[] = [
      CareSection.TITLE,
      CareSection.ABSTRACT,
      CareSection.INTRODUCTION,
      CareSection.PATIENT_INFORMATION,
      CareSection.CLINICAL_FINDINGS,
      CareSection.TIMELINE,
      CareSection.DIAGNOSTIC_ASSESSMENT,
      CareSection.THERAPEUTIC_INTERVENTIONS,
      CareSection.FOLLOW_UP_OUTCOMES,
      CareSection.DISCUSSION_CONCLUSION,
      CareSection.PATIENT_PERSPECTIVE,
      CareSection.INFORMED_CONSENT
    ];

    const lines: string[] = [];
    for (const section of sectionOrder) {
      const text = finalDraft.fullTextBySection[section] || '';
      if (!text) continue;
      lines.push(`# ${section}`);
      lines.push(text);
      lines.push('');
    }

    const body = lines.join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', buildContentDispositionHeader(`case_${id}.txt`));
    res.send(body);
  } catch (error: any) {
    console.error('Error exporting case:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
