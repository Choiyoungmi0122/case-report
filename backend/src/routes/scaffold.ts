import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CaseModel } from '../models/caseModel';
import { CareSection, ResearchEventType, ResearchState } from '../types';
import { getModelForChain, runInitialSectionDrafts } from '../llm/chains';
import { chain3SystemPrompt } from '../llm/prompts/chain3_draft';
import {
  appendPerformanceLog,
  buildChainCacheEntry,
  buildChainProgress,
  buildPerformanceLog,
  hashJoinedParts
} from '../optimization/chainRuntime';
import { buildGenerationMetadata, hashPromptParts } from '../config/researchMetadata';
import {
  ScaffoldInteractionEvent,
  ScaffoldInteractionEventType,
  ScaffoldReviewItem,
  ScaffoldLearningFeedback,
  ScaffoldReviewJudgment,
  InformationStatusJudgment,
  DraftJudgment,
  ScaffoldReviewSourceType,
  ScaffoldSectionProgress,
  ScaffoldSectionReflection,
  ScaffoldSelectedEvidence,
  ScaffoldState,
  ScaffoldV2CaseMap,
  ScaffoldV2CaseNote,
  ScaffoldV2CaseNoteType,
  ScaffoldV2Claim,
  ScaffoldV2ClaimConfidence,
  ScaffoldV2ClaimType,
  ScaffoldV2EvidenceReflection,
  ScaffoldV2EvidenceRole,
  ScaffoldV2LearnerEvidence,
  ScaffoldV2Phase
} from '../types/scaffold';
import { repairSplitClinicalEvidenceCards } from '../utils/evidenceCardRepair';

const router = express.Router();
const caseModel = new CaseModel();
const runningStudyDraftJobs = new Map<string, Promise<any>>();

const VALID_SOURCE_TYPES = new Set<ScaffoldReviewSourceType>([
  'missing_info',
  'recommended_question',
  'depth_issue',
  'unsupported_claim',
  'draft_sentence',
  'custom'
]);

const VALID_INFORMATION_STATUS_JUDGMENTS = new Set<InformationStatusJudgment>([
  'available_in_record',
  'needs_additional_confirmation',
  'needs_instructor_review',
  'unavailable',
  'pending'
]);

const VALID_DRAFT_JUDGMENTS = new Set<DraftJudgment>([
  'pending',
  'supported_by_record',
  'differs_from_record',
  'needs_additional_confirmation',
  'needs_instructor_review',
  'uncertain'
]);

const VALID_JUDGMENTS = new Set<ScaffoldReviewJudgment>([
  ...VALID_INFORMATION_STATUS_JUDGMENTS,
  ...VALID_DRAFT_JUDGMENTS
]);

const VALID_V2_PHASES = new Set<ScaffoldV2Phase>([
  'case_understanding',
  'core_message',
  'claim_evidence',
  'section_drafting',
  'final_review'
]);

const VALID_V2_CLAIM_TYPES = new Set<ScaffoldV2ClaimType>([
  'presentation',
  'diagnosis',
  'intervention',
  'outcome',
  'novelty'
]);

const VALID_V2_EVIDENCE_ROLES = new Set<ScaffoldV2EvidenceRole>(VALID_V2_CLAIM_TYPES);
const VALID_V2_CASE_NOTE_TYPES = new Set<ScaffoldV2CaseNoteType>(['observation', 'question']);

const VALID_V2_CLAIM_CONFIDENCE = new Set<ScaffoldV2ClaimConfidence>([
  'high',
  'medium',
  'low',
  'unresolved'
]);

const REQUIRED_SUFFICIENCY_QUESTION_IDS: Partial<Record<CareSection, string[]>> = {
  [CareSection.PATIENT_INFORMATION]: ['pi_001', 'pi_002', 'pi_003', 'pi_004'],
  [CareSection.CLINICAL_FINDINGS]: ['cf_001', 'cf_002', 'cf_003', 'cf_004'],
  [CareSection.TIMELINE]: ['tl_001', 'tl_002', 'tl_003'],
  [CareSection.DIAGNOSTIC_ASSESSMENT]: ['da_001', 'da_002', 'da_003'],
  [CareSection.THERAPEUTIC_INTERVENTIONS]: ['ti_001', 'ti_002', 'ti_003'],
  [CareSection.FOLLOW_UP_OUTCOMES]: ['fo_001', 'fo_002', 'fo_003'],
  [CareSection.PATIENT_PERSPECTIVE]: ['pp_001', 'pp_002'],
  [CareSection.INFORMED_CONSENT]: ['ic_001', 'ic_002']
};

function buildSufficiencyReviewItemId(sectionId: CareSection, questionId: string) {
  const key = questionId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${sectionId}-custom-0-${key || 'item'}`;
}

function getSufficiencyReviewStatus(scaffoldState: ScaffoldState, sectionId: CareSection) {
  const requiredIds = REQUIRED_SUFFICIENCY_QUESTION_IDS[sectionId] || [];
  const completedIds = new Set(
    (scaffoldState.reviewItems || [])
      .filter(
        (item) =>
          item.sectionId === sectionId &&
          item.sourceType === 'custom' &&
          isValidInformationStatusJudgment(item.judgment) &&
          item.judgment !== 'pending'
      )
      .map((item) => item.id)
  );
  const missingItemIds = requiredIds
    .map((questionId) => buildSufficiencyReviewItemId(sectionId, questionId))
    .filter((itemId) => !completedIds.has(itemId));

  return {
    requiredCount: requiredIds.length,
    missingItemIds,
    allSaved: missingItemIds.length === 0
  };
}

function getEvidenceText(card: any) {
  return String(card?.normalizedText || card?.sourceText || card?.text || '').trim();
}

export function validateScaffoldSelectedEvidence(
  caseData: any,
  rawSelectedEvidence: unknown,
  rawSelectedEvidenceIds?: unknown
) {
  const requestedItems = Array.isArray(rawSelectedEvidence)
    ? rawSelectedEvidence
    : normalizeStringArray(rawSelectedEvidenceIds).map((id) => ({ id }));
  const evidenceById = new Map<string, any>(
    (caseData?.evidenceCards || [])
      .map((card: any) => [String(card?.id || '').trim(), card] as const)
      .filter(([id]: readonly [string, any]) => Boolean(id))
  );
  const visits = Array.isArray(caseData?.visits) ? caseData.visits : [];
  const selectedEvidence: ScaffoldSelectedEvidence[] = [];
  const invalidEvidenceIds: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of requestedItems) {
    const id = String(rawItem?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const card = evidenceById.get(id);
    if (card) {
      const text = getEvidenceText(card);
      const visitIndex = Number(card?.visitIndex);
      selectedEvidence.push({
        id,
        sourceType: 'evidence_card',
        label: [card?.visitDateTime, text].filter(Boolean).join(' · ').slice(0, 120) || id,
        visitIndex: Number.isFinite(visitIndex) ? visitIndex : undefined
      });
      continue;
    }

    const visitMatch = id.match(/^visit:(\d+)$/);
    const visitArrayIndex = visitMatch ? Number(visitMatch[1]) : -1;
    const visit = visitArrayIndex >= 0 ? visits[visitArrayIndex] : undefined;
    if (visit) {
      selectedEvidence.push({
        id,
        sourceType: 'visit_soap',
        label: `${String(visit?.type || '방문')} #${visitArrayIndex + 1}`,
        visitIndex: visitArrayIndex
      });
      continue;
    }

    invalidEvidenceIds.push(id);
  }

  return {
    selectedEvidence,
    selectedEvidenceIds: selectedEvidence.map((item) => item.id),
    invalidEvidenceIds,
    valid: invalidEvidenceIds.length === 0
  };
}

// Phase 1 Validation Functions (Type Definitions)
function isValidInformationStatusJudgment(value: unknown): value is InformationStatusJudgment {
  return VALID_INFORMATION_STATUS_JUDGMENTS.has(value as InformationStatusJudgment);
}

function isValidDraftJudgment(value: unknown): value is DraftJudgment {
  return VALID_DRAFT_JUDGMENTS.has(value as DraftJudgment);
}

/**
 * Determine appropriate judgment type for a source type
 * - Information status judgments: missing_info, recommended_question, depth_issue, unsupported_claim, custom (pre-reveal)
 * - Draft judgments: draft_sentence (post-reveal)
 */
function getExpectedJudgmentTypeForSourceType(sourceType: ScaffoldReviewSourceType): 'information_status' | 'draft' {
  return sourceType === 'draft_sentence' ? 'draft' : 'information_status';
}

function validateJudgmentForSourceType(
  sourceType: ScaffoldReviewSourceType,
  judgment: ScaffoldReviewJudgment
): { isValid: boolean; expectedType: string } {
  const expectedType = getExpectedJudgmentTypeForSourceType(sourceType);
  const isValid =
    expectedType === 'draft'
      ? isValidDraftJudgment(judgment)
      : isValidInformationStatusJudgment(judgment);
  return { isValid, expectedType };
}

const VALID_EVENT_TYPES = new Set<ScaffoldInteractionEventType>([
  'session_start',
  'session_completed',
  'case_created',
  'mode_selected',
  'section_opened',
  'section_purpose_viewed',
  'learner_reflection_started',
  'learner_reflection_saved',
  'record_review_started',
  'record_review_completed',
  'evidence_opened',
  'case_map_saved',
  'workflow_phase_changed',
  'claim_map_saved',
  'information_status_judgment_saved',
  'question_task_responded',
  'pre_reveal_snapshot_created',
  'ai_draft_revealed',
  'post_ai_review_started',
  'draft_judgment_saved',
  'post_ai_reflection_saved',
  'draft_review_completed',
  'section_completed',
  'final_summary_viewed',
  'export_requested'
]);

function emptyScaffoldState(): ScaffoldState {
  return {
    reviewItems: [],
    sectionProgress: [],
    instructorReviewItems: [],
    additionalConfirmationItems: [],
    sectionReflections: [],
    questionTaskResults: [],
    preRevealSnapshots: [],
    interactionEvents: []
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizePostAiReflection(value: any) {
  if (!value || typeof value !== 'object') return undefined;
  return {
    changedJudgment: String(value.changedJudgment || '').trim(),
    unresolvedQuestion: String(value.unresolvedQuestion || '').trim(),
    transferPlan: String(value.transferPlan || '').trim(),
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : ''
  };
}

function normalizeLimitedText(value: unknown, maxLength = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeV2Claim(value: any): ScaffoldV2Claim | null {
  if (!value || typeof value !== 'object') return null;

  const id = normalizeLimitedText(value.id, 120);
  const text = normalizeLimitedText(value.text, 4000);
  if (!id || !text) return null;

  const type = VALID_V2_CLAIM_TYPES.has(value.type)
    ? (value.type as ScaffoldV2ClaimType)
    : 'presentation';
  const confidence = VALID_V2_CLAIM_CONFIDENCE.has(value.confidence)
    ? (value.confidence as ScaffoldV2ClaimConfidence)
    : 'unresolved';

  return {
    id,
    type,
    text,
    rationale: normalizeLimitedText(value.rationale, 4000) || undefined,
    evidenceIds: normalizeStringArray(value.evidenceIds),
    targetSectionIds: normalizeStringArray(value.targetSectionIds).filter((sectionId) =>
      Object.values(CareSection).includes(sectionId as CareSection)
    ) as CareSection[],
    confidence,
    missingInformation: normalizeLimitedText(value.missingInformation, 4000) || undefined
  };
}

function normalizeV2EvidenceReflection(value: any): ScaffoldV2EvidenceReflection | null {
  if (!value || typeof value !== 'object') return null;

  const evidenceId = normalizeLimitedText(value.evidenceId, 120);
  const rationale = normalizeLimitedText(value.rationale, 2000);
  if (!evidenceId) return null;

  return {
    evidenceId,
    role: VALID_V2_EVIDENCE_ROLES.has(value.role)
      ? (value.role as ScaffoldV2EvidenceRole)
      : 'presentation',
    rationale
  };
}

function normalizeV2LearnerEvidence(value: any): ScaffoldV2LearnerEvidence | null {
  if (!value || typeof value !== 'object') return null;

  const id = normalizeLimitedText(value.id, 120);
  const sourceText = normalizeLimitedText(value.sourceText, 4000);
  const visitIndex = Number(value.visitIndex);
  if (!id || !sourceText || !Number.isInteger(visitIndex) || visitIndex < 1) return null;

  return {
    id,
    sourceText,
    visitIndex,
    visitDateTime: normalizeLimitedText(value.visitDateTime, 120) || undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

function normalizeV2CaseNote(value: any): ScaffoldV2CaseNote | null {
  if (!value || typeof value !== 'object') return null;

  const id = normalizeLimitedText(value.id, 120);
  const text = normalizeLimitedText(value.text, 4000);
  if (!id || !text) return null;

  return {
    id,
    type: VALID_V2_CASE_NOTE_TYPES.has(value.type)
      ? (value.type as ScaffoldV2CaseNoteType)
      : 'observation',
    text,
    sourceEvidenceIds: normalizeStringArray(value.sourceEvidenceIds).slice(0, 10),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
  };
}

export function normalizeV2CaseMap(value: any): ScaffoldV2CaseMap | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const now = new Date().toISOString();
  return {
    version: 'scaffold-v2',
    currentPhase: VALID_V2_PHASES.has(value.currentPhase)
      ? (value.currentPhase as ScaffoldV2Phase)
      : 'case_understanding',
    selectedEvidenceIds: normalizeStringArray(value.selectedEvidenceIds).slice(0, 5),
    evidenceReflections: Array.isArray(value.evidenceReflections)
      ? value.evidenceReflections
          .map((item: any) => normalizeV2EvidenceReflection(item))
          .filter(
            (item: ScaffoldV2EvidenceReflection | null): item is ScaffoldV2EvidenceReflection =>
              Boolean(item)
          )
          .slice(0, 30)
      : [],
    learnerAddedEvidence: Array.isArray(value.learnerAddedEvidence)
      ? value.learnerAddedEvidence
          .map((item: any) => normalizeV2LearnerEvidence(item))
          .filter(
            (item: ScaffoldV2LearnerEvidence | null): item is ScaffoldV2LearnerEvidence =>
              Boolean(item)
          )
          .slice(0, 20)
      : [],
    evidenceFeedbackRevealedAt:
      typeof value.evidenceFeedbackRevealedAt === 'string'
        ? value.evidenceFeedbackRevealedAt
        : undefined,
    caseNotes: Array.isArray(value.caseNotes)
      ? value.caseNotes
          .map((item: any) => normalizeV2CaseNote(item))
          .filter((item: ScaffoldV2CaseNote | null): item is ScaffoldV2CaseNote => Boolean(item))
          .slice(0, 30)
      : [],
    noteFeedbackRevealedAt:
      typeof value.noteFeedbackRevealedAt === 'string'
        ? value.noteFeedbackRevealedAt
        : undefined,
    problemRepresentation: normalizeLimitedText(value.problemRepresentation),
    reportabilityRationale: normalizeLimitedText(value.reportabilityRationale),
    teachingPoints: normalizeStringArray(value.teachingPoints).slice(0, 10),
    targetAudience: normalizeLimitedText(value.targetAudience, 500) || undefined,
    claims: Array.isArray(value.claims)
      ? value.claims
          .map((claim: any) => normalizeV2Claim(claim))
          .filter((claim: ScaffoldV2Claim | null): claim is ScaffoldV2Claim => Boolean(claim))
          .slice(0, 30)
      : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now
  };
}

function isPostAiReflectionComplete(value: any) {
  const reflection = normalizePostAiReflection(value);
  // Only the first item is required; the other two are optional notes.
  return Boolean(reflection?.changedJudgment);
}

function normalizeScaffoldState(raw: any): ScaffoldState {
  const base = raw || {};
  return {
    reviewItems: Array.isArray(base.reviewItems) ? base.reviewItems : [],
    sectionProgress: Array.isArray(base.sectionProgress) ? base.sectionProgress : [],
    instructorReviewItems: Array.isArray(base.instructorReviewItems) ? base.instructorReviewItems : [],
    additionalConfirmationItems: Array.isArray(base.additionalConfirmationItems)
      ? base.additionalConfirmationItems
      : [],
    sectionReflections: Array.isArray(base.sectionReflections)
      ? base.sectionReflections.map((item: any) => ({
          sectionId: item?.sectionId,
          selectedEvidenceIds: normalizeStringArray(item?.selectedEvidenceIds),
          selectedEvidence: Array.isArray(item?.selectedEvidence)
            ? item.selectedEvidence
                .map((selected: any) => ({
                  id: String(selected?.id || '').trim(),
                  sourceType:
                    selected?.sourceType === 'visit_soap' ? 'visit_soap' : 'evidence_card',
                  label: typeof selected?.label === 'string' ? selected.label : undefined,
                  visitIndex:
                    typeof selected?.visitIndex === 'number' ? selected.visitIndex : undefined
                }))
                .filter((selected: ScaffoldSelectedEvidence) => selected.id)
            : [],
          noRelevantEvidenceConfirmed: Boolean(item?.noRelevantEvidenceConfirmed),
          learnerKeyInformationItems: normalizeStringArray(
            item?.learnerKeyInformationItems ?? item?.learnerIdentifiedKeyInfo
          ),
          learnerIdentifiedKeyInfo: normalizeStringArray(item?.learnerIdentifiedKeyInfo),
          learnerNotes: typeof item?.learnerNotes === 'string' ? item.learnerNotes : undefined,
          learnerIdentifiedMissingItems: normalizeStringArray(item?.learnerIdentifiedMissingItems),
          additionalConfirmationItems: normalizeStringArray(item?.additionalConfirmationItems),
          teacherReviewItems: normalizeStringArray(item?.teacherReviewItems),
          postAiReflection: normalizePostAiReflection(item?.postAiReflection),
          draftRevealedAt: item?.draftRevealedAt,
          draftReviewStatus:
            item?.draftReviewStatus === 'reviewed' ? 'reviewed' : 'not_reviewed',
          firstOpenedAt: item?.firstOpenedAt,
          completedAt: item?.completedAt
        }))
      : [],
    questionTaskResults: Array.isArray(base.questionTaskResults) ? base.questionTaskResults : [],
    preRevealSnapshots: Array.isArray(base.preRevealSnapshots) ? base.preRevealSnapshots : [],
    caseMap: normalizeV2CaseMap(base.caseMap),
    interactionEvents: Array.isArray(base.interactionEvents) ? base.interactionEvents : [],
    sessionId: typeof base.sessionId === 'string' ? base.sessionId : undefined,
    participantCode: typeof base.participantCode === 'string' ? base.participantCode : undefined,
    startedAt: base.startedAt,
    completedAt: base.completedAt
  };
}

function normalizeResearchState(raw: any, studyMode = false): ResearchState {
  return {
    studyMode,
    participantCode: typeof raw?.participantCode === 'string' ? raw.participantCode : undefined,
    sessionId: typeof raw?.sessionId === 'string' ? raw.sessionId : undefined,
    startedAt: typeof raw?.startedAt === 'string' ? raw.startedAt : undefined,
    completedAt: typeof raw?.completedAt === 'string' ? raw.completedAt : undefined,
    interactionEvents: Array.isArray(raw?.interactionEvents) ? raw.interactionEvents : []
  };
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

function getRevealedDraftSectionIds(scaffoldState: ScaffoldState) {
  return new Set(
    (scaffoldState.sectionProgress || [])
      .filter((item) => item.draftRevealed)
      .map((item) => item.sectionId)
  );
}

function sanitizeDraftsForScaffold(caseData: any, scaffoldState: ScaffoldState) {
  const revealedSections = getRevealedDraftSectionIds(scaffoldState);
  const sectionDrafts = (caseData.sectionDrafts || []).filter((draft: any) =>
    revealedSections.has(draft.sectionId)
  );
  const draftsBySection = Object.fromEntries(
    Object.entries(caseData.draftsBySection || {}).filter(([sectionId]) => revealedSections.has(sectionId as CareSection))
  );

  return {
    sectionDrafts,
    draftsBySection,
    sectionsOverview: buildSectionsOverview(caseData.sectionStates || [], sectionDrafts)
  };
}

export function sanitizeSectionStatesForScaffold(caseData: any, scaffoldState: ScaffoldState) {
  const sectionStates = caseData.sectionStates || [];
  if (!caseData?.studyConfig?.studyMode) return sectionStates;

  const revealedSections = getRevealedDraftSectionIds(scaffoldState);
  return sectionStates.map((state: any) =>
    revealedSections.has(state.sectionId)
      ? state
      : {
          sectionId: state.sectionId,
          status: 'INCOMPLETE',
          rationaleText: '',
          missingInfoBullets: [],
          recommendedQuestions: []
        }
  );
}

function sanitizeEventMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const nextEntries = Object.entries(metadata as Record<string, unknown>)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => {
      if (typeof value === 'string') return [key, value.slice(0, 500)];
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [key, value];
      if (Array.isArray(value)) return [key, value.slice(0, 20)];
      if (typeof value === 'object') return [key, JSON.parse(JSON.stringify(value))];
      return [key, String(value)];
    });

  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined;
}

function appendResearchEvent(
  researchState: ResearchState,
  event: {
    eventId: string;
    eventType: ResearchEventType;
    caseId: string;
    mode: 'write' | 'scaffold';
    timestamp: string;
    sectionId?: CareSection;
    participantCode?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  if ((researchState.interactionEvents || []).some((item) => item.eventId === event.eventId)) {
    return researchState;
  }

  return {
    ...researchState,
    participantCode: event.participantCode || researchState.participantCode,
    sessionId: event.sessionId || researchState.sessionId,
    startedAt: event.eventType === 'session_start' ? researchState.startedAt || event.timestamp : researchState.startedAt,
    completedAt:
      event.eventType === 'session_completed' ? researchState.completedAt || event.timestamp : researchState.completedAt,
    interactionEvents: [...(researchState.interactionEvents || []), event].slice(-4000)
  };
}

function ensureScaffoldMode(caseData: any, res: Response) {
  const caseMode = caseData?.mode || 'write';
  if (caseMode !== 'scaffold') {
    res.status(409).json({
      error: 'This case is not a scaffold case.',
      caseId: caseData?.id,
      mode: caseMode
    });
    return false;
  }
  return true;
}

function parseScaffoldSectionId(value: unknown): CareSection | null {
  const normalized = String(value || '').trim();
  return Object.values(CareSection).includes(normalized as CareSection)
    ? (normalized as CareSection)
    : null;
}

function redirectEvidenceIds(ids: string[] = [], redirects: Record<string, string>): string[] {
  return Array.from(new Set(ids.map((id) => redirects[id] || id)));
}

function redirectScaffoldEvidenceIds(
  scaffoldState: ScaffoldState,
  redirects: Record<string, string>
): ScaffoldState {
  if (Object.keys(redirects).length === 0) return scaffoldState;

  const caseMap = scaffoldState.caseMap;
  const redirectedReflections = new Map<string, ScaffoldV2EvidenceReflection>();
  for (const reflection of caseMap?.evidenceReflections || []) {
    const evidenceId = redirects[reflection.evidenceId] || reflection.evidenceId;
    redirectedReflections.set(evidenceId, { ...reflection, evidenceId });
  }

  return {
    ...scaffoldState,
    reviewItems: (scaffoldState.reviewItems || []).map((item) => ({
      ...item,
      evidenceIds: redirectEvidenceIds(item.evidenceIds || [], redirects)
    })),
    preRevealSnapshots: (scaffoldState.preRevealSnapshots || []).map((item) => ({
      ...item,
      selectedEvidenceIds: redirectEvidenceIds(item.selectedEvidenceIds || [], redirects),
      selectedEvidence: (item.selectedEvidence || []).map((selected: any) => ({
        ...selected,
        id: redirects[selected.id] || selected.id
      }))
    })),
    caseMap: caseMap
      ? {
          ...caseMap,
          selectedEvidenceIds: redirectEvidenceIds(caseMap.selectedEvidenceIds, redirects),
          evidenceReflections: Array.from(redirectedReflections.values()),
          caseNotes: caseMap.caseNotes.map((note) => ({
            ...note,
            sourceEvidenceIds: redirectEvidenceIds(note.sourceEvidenceIds, redirects)
          })),
          claims: caseMap.claims.map((claim) => ({
            ...claim,
            evidenceIds: redirectEvidenceIds(claim.evidenceIds, redirects)
          }))
        }
      : undefined
  };
}

async function getValidatedScaffoldCase(caseId: string, res: Response) {
  const caseData = await caseModel.getCase(caseId);
  if (!caseData) {
    res.status(404).json({ error: 'Case not found' });
    return null;
  }

  if (!ensureScaffoldMode(caseData, res)) {
    return null;
  }

  return caseData;
}

function buildScaffoldResponse(caseData: any, scaffoldState: ScaffoldState) {
  const repairedEvidence = repairSplitClinicalEvidenceCards(
    caseData.evidenceCards || [],
    caseData.visits || []
  );
  const responseScaffoldState = redirectScaffoldEvidenceIds(
    scaffoldState,
    repairedEvidence.idRedirects
  );
  const responseCaseData = { ...caseData, evidenceCards: repairedEvidence.cards };
  const sanitizedDrafts = sanitizeDraftsForScaffold(responseCaseData, responseScaffoldState);
  const sanitizedSectionStates = sanitizeSectionStatesForScaffold(responseCaseData, responseScaffoldState);
  const studyMode = Boolean(caseData?.studyConfig?.studyMode);
  return {
    caseId: caseData.id,
    experiment_code: caseData.experiment_code,
    experimentCode: caseData.experiment_code,
    mode: caseData.mode || 'write',
    title: caseData.title || undefined,
    visits: caseData.visits || [],
    draftsBySection: sanitizedDrafts.draftsBySection,
    sectionStates: sanitizedSectionStates,
    sectionDrafts: sanitizedDrafts.sectionDrafts,
    sectionEvidenceMap: caseData.sectionEvidenceMap || {},
    evidenceCards: repairedEvidence.cards,
    sectionsOverview: buildSectionsOverview(sanitizedSectionStates, sanitizedDrafts.sectionDrafts),
    commonQuestionSets: studyMode ? [] : caseData.commonQuestionSets || [],
    commonMissingItems: studyMode ? [] : caseData.commonMissingItems || [],
    pendingTermConfirmations: caseData.pendingTermConfirmations || [],
    reviewRequired: caseData.reviewRequired || null,
    staleState: caseData.staleState || null,
    finalDraft: studyMode ? null : caseData.finalDraft || null,
    scaffoldState: responseScaffoldState,
    researchState: (caseData as any).researchState || null,
    studyConfig: (caseData as any).studyConfig || null
  };
}

async function persistScaffoldState(caseId: string, scaffoldState: ScaffoldState) {
  await caseModel.updateCase(caseId, {
    scaffoldState: scaffoldState as any
  } as any);
}

export async function generateStudyScaffoldDraftAfterSnapshot(
  caseData: any,
  sectionId: CareSection,
  dependencies?: {
    runInitialSectionDrafts?: typeof runInitialSectionDrafts;
    updateCase?: (caseId: string, updates: any) => Promise<void>;
  }
) {
  if (!caseData?.studyConfig?.studyMode || (caseData?.mode || 'write') !== 'scaffold') {
    throw new Error('Study scaffold draft generation requires a study scaffold case.');
  }

  const snapshotExists = (caseData?.scaffoldState?.preRevealSnapshots || []).some(
    (item: any) => item.sectionId === sectionId
  );
  if (!snapshotExists) {
    throw new Error('The learner pre-reveal snapshot must be saved before AI draft generation.');
  }

  const promptVersion = 'CHAIN3_STUDY_REVEAL:v1';
  const existingDraft = (caseData.sectionDrafts || []).find(
    (item: any) => item.sectionId === sectionId
  );
  if (existingDraft?.generationMetadata?.promptVersion === promptVersion) {
    return existingDraft;
  }

  const sectionState = (caseData.sectionStates || []).find(
    (item: any) => item.sectionId === sectionId
  ) || {
    sectionId,
    status: 'INCOMPLETE',
    rationaleText: ''
  };
  const allEvidence = caseData.evidenceCards || [];
  const sectionEvidence = allEvidence.filter((card: any) =>
    [...(card.tags || []), ...(card.sectionHints || [])].includes(sectionId)
  );
  const evidenceForGeneration = sectionEvidence.length > 0 ? sectionEvidence : allEvidence;
  const inputHash = hashJoinedParts([
    sectionId,
    sectionState.status || '',
    sectionState.rationaleText || '',
    ...evidenceForGeneration.map((card: any) =>
      [
        card.id || '',
        card.normalizedText || card.sourceText || '',
        JSON.stringify(card.tags || []),
        JSON.stringify(card.sectionHints || [])
      ].join('|')
    )
  ]);
  const promptHash = hashPromptParts([chain3SystemPrompt, promptVersion, inputHash]);
  const startedAt = new Date().toISOString();
  let tokenUsage: any = null;
  const runInitialSectionDraftsImpl =
    dependencies?.runInitialSectionDrafts || runInitialSectionDrafts;
  const updateCaseImpl =
    dependencies?.updateCase ||
    ((caseId: string, updates: any) => caseModel.updateCase(caseId, updates));
  const generatedDrafts = await runInitialSectionDraftsImpl(
    evidenceForGeneration,
    [sectionState],
    {
      onUsage: (usage) => {
        tokenUsage = usage;
      }
    }
  );
  const generatedDraft = generatedDrafts.find((item: any) => item.sectionId === sectionId) || {
    sectionId,
    evidenceCardIdsUsed: [],
    timelineEventIdsUsed: [],
    draftText: '',
    openIssues: [],
    evidenceLinks: [],
    unsupportedClaims: []
  };
  const draftWithMetadata = {
    ...generatedDraft,
    generationMetadata: buildGenerationMetadata({
      chainName: 'CHAIN3_STUDY_REVEAL',
      provider: 'openai',
      model: getModelForChain('chain3'),
      actualModelVersion: getModelForChain('chain3'),
      inputHash,
      promptHash,
      promptTemplateHash: hashPromptParts([chain3SystemPrompt, promptVersion]),
      promptVersion,
      temperature: 0,
      generatedAt: startedAt,
      cacheHit: false,
      generationStatus: 'success',
      tokenUsage
    })
  };
  const nextSectionDrafts = [
    ...(caseData.sectionDrafts || []).filter((item: any) => item.sectionId !== sectionId),
    draftWithMetadata
  ];
  const nextDraftsBySection = Object.fromEntries(
    nextSectionDrafts.map((item: any) => [item.sectionId, item.draftText || ''])
  );
  const chainKey = `CHAIN3_STUDY_REVEAL:${sectionId}`;
  const nextChainCache = {
    ...(caseData.chainCache || {}),
    [chainKey]: buildChainCacheEntry(inputHash, draftWithMetadata)
  };
  const nextPerformanceLogs = appendPerformanceLog(
    caseData.chainPerformanceLogs || [],
    buildPerformanceLog({
      chainName: chainKey,
      startedAt,
      inputHash,
      cacheHit: false,
      llmCallCount: 1,
      tokenUsage
    })
  );
  const completedSteps = Array.from(
    new Set([...(caseData.chainProgress?.completedSteps || []), chainKey])
  );

  await updateCaseImpl(caseData.id, {
    sectionDrafts: nextSectionDrafts,
    draftsBySection: nextDraftsBySection,
    chainCache: nextChainCache,
    chainPerformanceLogs: nextPerformanceLogs,
    chainProgress: buildChainProgress(undefined, completedSteps, ['CHAIN3_STUDY_REVEAL'])
  });

  return draftWithMetadata;
}

async function ensureStudyScaffoldDraftAfterSnapshot(caseId: string, sectionId: CareSection) {
  const jobKey = `${caseId}:${sectionId}`;
  const runningJob = runningStudyDraftJobs.get(jobKey);
  if (runningJob) return runningJob;

  const job = (async () => {
    const latestCase = await caseModel.getCase(caseId);
    if (!latestCase) throw new Error('Case not found after saving the learner snapshot.');
    return generateStudyScaffoldDraftAfterSnapshot(latestCase, sectionId);
  })().finally(() => {
    runningStudyDraftJobs.delete(jobKey);
  });
  runningStudyDraftJobs.set(jobKey, job);
  return job;
}

function deriveSummaryLists(reviewItems: ScaffoldReviewItem[]) {
  const additionalConfirmationItems = reviewItems
    .filter((item) => item.judgment === 'needs_additional_confirmation')
    .map((item) => item.id);

  const instructorReviewItems = reviewItems
    .filter((item) => item.judgment === 'needs_instructor_review')
    .map((item) => item.id);

  return {
    additionalConfirmationItems,
    instructorReviewItems
  };
}

function getSectionReflection(
  scaffoldState: ScaffoldState,
  sectionId: CareSection
): ScaffoldSectionReflection | undefined {
  return (scaffoldState.sectionReflections || []).find((item) => item.sectionId === sectionId);
}

function hasSectionEvent(
  scaffoldState: ScaffoldState,
  sectionId: CareSection,
  eventType: ScaffoldInteractionEventType
) {
  return (scaffoldState.interactionEvents || []).some(
    (item) => item.sectionId === sectionId && item.eventType === eventType
  );
}

function splitDraftSentencesForReview(text: string) {
  return String(text || '')
    .split(/\n+/)
    // Must match splitScaffoldDraftSentences in the frontend: the completion gate
    // compares these sentences with the ones the learner reviewed on screen.
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function isCompleteDraftSentenceReviewItem(item: ScaffoldReviewItem) {
  return Boolean(
    item.sourceType === 'draft_sentence' &&
      item.judgment &&
      item.judgment !== 'pending' &&
      (item.judgment === 'supported_by_record' ||
        String(item.note || '').trim() ||
        (item.evidenceIds || []).length > 0)
  );
}

function getRequiredQuestionTaskStatus(params: {
  caseData: any;
  scaffoldState: ScaffoldState;
  sectionId: CareSection;
}) {
  const sectionState = (params.caseData.sectionStates || []).find((item: any) => item.sectionId === params.sectionId);
  const sectionQuestions = (sectionState?.recommendedQuestions || []).map((item: any) => String(item || '').trim()).filter(Boolean);
  const commonQuestions = (params.caseData.commonQuestionSets || [])
    .filter((item: any) => (item.targetSectionIds || []).includes(params.sectionId))
    .map((item: any) => String(item.question || '').trim())
    .filter(Boolean);
  const allQuestions = Array.from(new Set([...sectionQuestions, ...commonQuestions]));

  // Phase 2: Get question task results by question text (status-based, not essay-based)
  const storedResults = (params.scaffoldState.questionTaskResults || []).filter((item) => item.question && allQuestions.includes(item.question));

  // Count questions that have a defined status
  const completedQuestions = new Set<string>();
  storedResults.forEach((item) => {
    if (item.status) {
      completedQuestions.add(item.question);
    }
  });

  return {
    requiredCount: allQuestions.length,
    completedCount: completedQuestions.size,
    allCompleted: allQuestions.every((question) => completedQuestions.has(question))
  };
}

function getSectionReviewCandidates(caseData: any, sectionId: CareSection) {
  const sectionState = (caseData.sectionStates || []).find((item: any) => item.sectionId === sectionId);
  const sectionDraft = (caseData.sectionDrafts || []).find((item: any) => item.sectionId === sectionId);
  const ids = new Set<string>();
  const items: Array<{ sourceType: ScaffoldReviewSourceType; sourceText: string }> = [];

  const add = (sourceType: ScaffoldReviewSourceType, sourceText: string) => {
    const text = String(sourceText || '').trim();
    if (!text) return;
    const key = `${sourceType}:${text}`;
    if (ids.has(key)) return;
    ids.add(key);
    items.push({ sourceType, sourceText: text });
  };

  (sectionState?.missingInfoBullets || []).forEach((text: string) => add('missing_info', text));
  (sectionDraft?.unsupportedClaims || []).forEach((item: any) => add('unsupported_claim', item?.sentence || ''));
  (caseData.sectionAdequacyReviews?.[sectionId]?.missingRequiredItems || []).forEach((text: string) => add('missing_info', text));
  (caseData.sectionAdequacyReviews?.[sectionId]?.depthIssues || []).forEach((text: string) => add('depth_issue', text));

  return items;
}

export function evaluateStudyRevealGate(caseData: any, scaffoldState: ScaffoldState, sectionId: CareSection) {
  const reflection = getSectionReflection(scaffoldState, sectionId);
  const reviewCandidates = getSectionReviewCandidates(caseData, sectionId);
  const sectionReviewItems = (scaffoldState.reviewItems || []).filter((item) => item.sectionId === sectionId);
  const requiredQuestionStatus = getRequiredQuestionTaskStatus({ caseData, scaffoldState, sectionId });
  const sufficiencyStatus = getSufficiencyReviewStatus(scaffoldState, sectionId);
  const purposeViewed = hasSectionEvent(scaffoldState, sectionId, 'section_purpose_viewed');
  const evidenceValidation = validateScaffoldSelectedEvidence(
    caseData,
    reflection?.selectedEvidence,
    reflection?.selectedEvidenceIds
  );
  const hasSelectedEvidence = evidenceValidation.selectedEvidenceIds.length > 0;
  const hasDirectEntry =
    (reflection?.learnerKeyInformationItems || reflection?.learnerIdentifiedKeyInfo || []).length > 0;
  const noRelevantEvidenceConfirmed = Boolean(reflection?.noRelevantEvidenceConfirmed);
  const preAiEvidencePath = hasSelectedEvidence
    ? 'selected_evidence'
    : hasDirectEntry
      ? 'direct_entry'
      : noRelevantEvidenceConfirmed
        ? 'no_relevant_evidence'
        : null;
  const validPreAiEvidencePath = Boolean(preAiEvidencePath && evidenceValidation.valid);
  const reflectionSaved = validPreAiEvidencePath;
  const sectionProgress = (scaffoldState.sectionProgress || []).find((item) => item.sectionId === sectionId);
  const recordReviewCompleted = Boolean(sectionProgress?.recordReviewCompleted);
  const sufficiencyReviewCompleted =
    sufficiencyStatus.requiredCount === 0 || Boolean(sectionProgress?.missingInfoReviewCompleted);
  const allRequiredReviewItemsClassified =
    reviewCandidates.length === 0 ||
    reviewCandidates.every((candidate) =>
      sectionReviewItems.some(
        (item) =>
          item.sourceType === candidate.sourceType &&
          item.sourceText === candidate.sourceText &&
          item.judgment !== 'pending'
      )
    );

  return {
    purposeViewed,
    reflectionSaved,
    preAiEvidencePath,
    validPreAiEvidencePath,
    invalidEvidenceIds: evidenceValidation.invalidEvidenceIds,
    recordReviewCompleted,
    sufficiencyReviewCompleted,
    allSufficiencyJudgmentsSaved: sufficiencyStatus.allSaved,
    missingSufficiencyItemIds: sufficiencyStatus.missingItemIds,
    allRequiredReviewItemsClassified,
    allRequiredQuestionTasksCompleted: requiredQuestionStatus.allCompleted,
    canReveal:
      purposeViewed &&
      reflectionSaved &&
      recordReviewCompleted &&
      sufficiencyReviewCompleted &&
      sufficiencyStatus.allSaved
  };
}

export function evaluateStudyCompletionGate(caseData: any, scaffoldState: ScaffoldState, sectionId: CareSection) {
  const revealGate = evaluateStudyRevealGate(caseData, scaffoldState, sectionId);
  const sectionProgress = (scaffoldState.sectionProgress || []).find((item) => item.sectionId === sectionId);
  const sectionDraft = (caseData.sectionDrafts || []).find((item: any) => item.sectionId === sectionId);
  const draftSentences = splitDraftSentencesForReview(sectionDraft?.draftText || '');
  const savedDraftSentenceKeys = new Set(
    (scaffoldState.reviewItems || [])
      .filter(
        (item) =>
          item.sectionId === sectionId &&
          item.sourceType === 'draft_sentence' &&
          isCompleteDraftSentenceReviewItem(item)
      )
      .map((item) => `${item.sourceType}:${item.sourceText}`)
  );
  const allDraftJudgmentsSaved =
    draftSentences.length === 0 ||
    draftSentences.every((sentence) => savedDraftSentenceKeys.has(`draft_sentence:${sentence}`));
  const sectionReflection = getSectionReflection(scaffoldState, sectionId);
  const postAiReflectionSaved =
    draftSentences.length === 0 || isPostAiReflectionComplete(sectionReflection?.postAiReflection);

  return {
    ...revealGate,
    draftRevealed: Boolean(sectionProgress?.draftRevealed),
    allDraftJudgmentsSaved,
    postAiReflectionSaved,
    canComplete:
      revealGate.canReveal &&
      Boolean(sectionProgress?.draftRevealed) &&
      allDraftJudgmentsSaved &&
      postAiReflectionSaved
  };
}

export function buildLearningFeedback(
  caseData: any,
  judgment: DraftJudgment,
  evidenceIds: string[],
  generatedAt: string
): ScaffoldLearningFeedback {
  const selectedEvidence = (caseData.evidenceCards || [])
    .filter((card: any) => evidenceIds.includes(String(card?.id || '')))
    .map((card: any) => ({
      id: String(card.id),
      text: String(card.normalizedText || card.sourceText || '').trim()
    }))
    .filter((item: { id: string; text: string }) => item.text);

  const feedbackByJudgment: Record<Exclude<DraftJudgment, 'pending'>, { summary: string; prompts: string[] }> = {
    supported_by_record: {
      summary:
        selectedEvidence.length > 0
          ? '선택한 원기록을 AI 문장과 직접 대조해 근거의 범위를 확인하세요.'
          : '판단 이유가 AI 문장의 모든 사실을 직접 뒷받침하는지 원기록에서 다시 확인하세요.',
      prompts: [
        '문장의 시점, 수치, 주체가 원기록과 모두 일치하나요?',
        '기록에 없는 인과관계나 확정적 해석이 덧붙지 않았나요?'
      ]
    },
    differs_from_record: {
      summary: '원기록과 다르다고 판단한 문장입니다. 어느 부분이 어떻게 다른지 원기록의 방문과 표현으로 짚어보세요.',
      prompts: [
        '다른 부분은 사실(수치, 시점, 주체)인가요, 해석(인과, 정도)인가요?',
        '원기록에 맞게 고친다면 문장을 어떻게 쓰겠습니까?'
      ]
    },
    needs_additional_confirmation: {
      summary: '기록만으로 확정하지 않은 판단입니다. 무엇을 확인해야 결론을 낼 수 있는지 구체화하세요.',
      prompts: [
        '추가로 필요한 검사, 문진 또는 기록은 무엇인가요?',
        '확인 전까지 문장을 어떤 수준의 표현으로 제한해야 하나요?'
      ]
    },
    needs_instructor_review: {
      summary: '임상적 해석이나 학술적 표현에서 교수자와 논의할 쟁점을 분명히 해보세요.',
      prompts: [
        '기록된 사실과 전문가 판단이 필요한 해석은 각각 무엇인가요?',
        '교수자에게 한 가지 질문만 한다면 무엇을 물어야 하나요?'
      ]
    },
    uncertain: {
      summary: '판단이 어려운 이유를 사실, 해석, 누락정보로 나누면 다음 검토 단계가 선명해집니다.',
      prompts: [
        '이 문장에서 원기록으로 확인되는 부분은 어디까지인가요?',
        '확인되지 않는 부분은 추가확인과 교수자 검토 중 어디에 더 가깝나요?'
      ]
    }
  };
  const feedback = feedbackByJudgment[judgment as Exclude<DraftJudgment, 'pending'>];

  return {
    source: 'grounded_review_coach_v1',
    summary: feedback.summary,
    prompts: feedback.prompts,
    selectedEvidence,
    generatedAt
  };
}

export function buildPreRevealSnapshot(
  scaffoldState: ScaffoldState,
  sectionId: CareSection,
  selectedEvidence?: ScaffoldSelectedEvidence[]
) {
  const reflection = getSectionReflection(scaffoldState, sectionId);
  const reviewItemJudgments = (scaffoldState.reviewItems || [])
    .filter((item) => item.sectionId === sectionId)
    .map((item) => ({
      itemId: item.id,
      learnerItemId: item.learnerItemId || item.id,
      reviewItemId: item.reviewItemId || item.id,
      sourceType: item.sourceType,
      judgment: item.judgment,
      evidenceIds: item.evidenceIds || [],
      sourceEvidenceIds: item.sourceEvidenceIds || item.evidenceIds || []
    }));
  const questionTaskResults = (scaffoldState.questionTaskResults || []).filter((item) => item.itemId.startsWith(`${sectionId}::`));
  const selectedEvidenceSource = Array.isArray(selectedEvidence)
    ? selectedEvidence
    : reflection?.selectedEvidence || [];
  const normalizedSelectedEvidence = Array.isArray(selectedEvidenceSource)
    ? selectedEvidenceSource
        .map((item) => ({
          id: String(item?.id || '').trim(),
          sourceType: item?.sourceType === 'visit_soap' ? 'visit_soap' as const : 'evidence_card' as const,
          label: typeof item?.label === 'string' ? item.label.trim() || undefined : undefined,
          visitIndex: typeof item?.visitIndex === 'number' ? item.visitIndex : undefined
        }))
        .filter((item) => item.id)
    : [];

  return {
    sectionId,
    createdAt: new Date().toISOString(),
    selectedEvidenceIds: normalizedSelectedEvidence.map((item) => item.id),
    selectedEvidence: normalizedSelectedEvidence,
    noRelevantEvidenceConfirmed: Boolean(reflection?.noRelevantEvidenceConfirmed),
    learnerKeyInformationItems: Array.from(
      new Set([
        ...((reflection?.learnerKeyInformationItems || []) as string[]),
        ...((reflection?.learnerIdentifiedKeyInfo || []) as string[])
      ].filter(Boolean))
    ),
    learnerIdentifiedMissingItems: reflection?.learnerIdentifiedMissingItems || [],
    additionalConfirmationItems: reflection?.additionalConfirmationItems || [],
    teacherReviewItems: reflection?.teacherReviewItems || [],
    learnerNotes: reflection?.learnerNotes,
    reviewItemJudgments,
    questionTaskResults
  };
}

function upsertProgress(
  progressItems: ScaffoldSectionProgress[],
  sectionId: CareSection,
  updates: Partial<ScaffoldSectionProgress>
) {
  const existingIndex = progressItems.findIndex((item) => item.sectionId === sectionId);
  const current =
    existingIndex >= 0
      ? progressItems[existingIndex]
      : {
          sectionId,
          recordReviewCompleted: false,
          missingInfoReviewCompleted: false,
          draftRevealed: false,
          draftReviewCompleted: false
        };

  // The route passes `undefined` for every flag absent from the request body.
  // Spreading those would clear flags already saved by an earlier step, so a
  // later `draftRevealed` write used to wipe `recordReviewCompleted`.
  const providedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  ) as Partial<ScaffoldSectionProgress>;

  const next: ScaffoldSectionProgress = {
    ...current,
    ...providedUpdates,
    sectionId
  };

  if (
    next.recordReviewCompleted &&
    next.missingInfoReviewCompleted &&
    next.draftRevealed &&
    next.draftReviewCompleted
  ) {
    next.completedAt = next.completedAt || new Date().toISOString();
  }

  if (existingIndex >= 0) {
    const clone = [...progressItems];
    clone[existingIndex] = next;
    return { nextProgressItems: clone, progress: next };
  }

  return { nextProgressItems: [...progressItems, next], progress: next };
}

function upsertReflection(
  reflectionItems: ScaffoldSectionReflection[],
  sectionId: CareSection,
  updates: Partial<ScaffoldSectionReflection>
) {
  const existingIndex = reflectionItems.findIndex((item) => item.sectionId === sectionId);
  const current =
    existingIndex >= 0
      ? reflectionItems[existingIndex]
      : {
          sectionId,
          draftReviewStatus: 'not_reviewed' as const
        };

  // Same reason as upsertProgress: never let an absent field clear a saved one
  // (e.g. logging an event must not erase draftRevealedAt or learnerNotes).
  const providedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  ) as Partial<ScaffoldSectionReflection>;

  const next: ScaffoldSectionReflection = {
    ...current,
    ...providedUpdates,
    learnerKeyInformationItems:
      providedUpdates.learnerKeyInformationItems !== undefined
        ? providedUpdates.learnerKeyInformationItems
        : current.learnerKeyInformationItems || current.learnerIdentifiedKeyInfo || [],
    sectionId
  };

  if (existingIndex >= 0) {
    const clone = [...reflectionItems];
    clone[existingIndex] = next;
    return { nextReflectionItems: clone, reflection: next };
  }

  return { nextReflectionItems: [...reflectionItems, next], reflection: next };
}

function appendInteractionEvent(
  scaffoldState: ScaffoldState,
  event: ScaffoldInteractionEvent
) {
  const nextEvent: ScaffoldInteractionEvent = {
    ...event,
    eventId: event.eventId || randomUUID(),
    sequenceIndex: (scaffoldState.interactionEvents || []).length + 1
  };
  if ((scaffoldState.interactionEvents || []).some((item) => item.eventId === nextEvent.eventId)) {
    return scaffoldState;
  }
  const nextEvents = [...(scaffoldState.interactionEvents || []), nextEvent].slice(-2000);
  let nextState: ScaffoldState = {
    ...scaffoldState,
    interactionEvents: nextEvents
  };

  if (event.sessionId || event.participantCode || event.eventType === 'session_start') {
    nextState = {
      ...nextState,
      sessionId: event.sessionId || nextState.sessionId,
      participantCode: event.participantCode || nextState.participantCode,
      startedAt: nextState.startedAt || event.timestamp
    };
  }

  if (event.sectionId) {
    const { nextReflectionItems, reflection } = upsertReflection(
      nextState.sectionReflections || [],
      event.sectionId,
      {}
    );
    nextState = {
      ...nextState,
      sectionReflections: nextReflectionItems
    };

    if (event.eventType === 'section_opened' && !reflection.firstOpenedAt) {
      const result = upsertReflection(nextReflectionItems, event.sectionId, {
        firstOpenedAt: event.timestamp
      });
      nextState = { ...nextState, sectionReflections: result.nextReflectionItems };
    }

    if (event.eventType === 'ai_draft_revealed') {
      const result = upsertReflection(nextState.sectionReflections, event.sectionId, {
        draftRevealedAt: reflection.draftRevealedAt || event.timestamp
      });
      nextState = { ...nextState, sectionReflections: result.nextReflectionItems };
    }

    if (event.eventType === 'draft_review_completed') {
      const result = upsertReflection(nextState.sectionReflections, event.sectionId, {
        draftReviewStatus: 'reviewed'
      });
      nextState = { ...nextState, sectionReflections: result.nextReflectionItems };
    }

    if (event.eventType === 'section_completed') {
      const result = upsertReflection(nextState.sectionReflections, event.sectionId, {
        completedAt: reflection.completedAt || event.timestamp
      });
      nextState = { ...nextState, sectionReflections: result.nextReflectionItems };
    }
  }

  if (event.eventType === 'session_completed') {
    nextState = {
      ...nextState,
      completedAt: nextState.completedAt || event.timestamp
    };
  }

  return nextState;
}

router.get('/:caseId/scaffold', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;
    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    res.json(buildScaffoldResponse(caseData, scaffoldState));
  } catch (error: any) {
    console.error('Error getting scaffold state:', error);
    res.status(500).json({ error: error.message || 'Failed to get scaffold state' });
  }
});

router.put('/:caseId/scaffold/session', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const nextScaffoldState: ScaffoldState = {
      ...scaffoldState,
      sessionId: typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() || scaffoldState.sessionId : scaffoldState.sessionId,
      participantCode:
        typeof req.body?.participantCode === 'string'
          ? req.body.participantCode.trim() || scaffoldState.participantCode
          : scaffoldState.participantCode,
      startedAt: scaffoldState.startedAt || new Date().toISOString()
    };

    await persistScaffoldState(caseData.id, nextScaffoldState);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState
    });
  } catch (error: any) {
    console.error('Error saving scaffold session:', error);
    res.status(500).json({ error: error.message || 'Failed to save scaffold session' });
  }
});

router.put('/:caseId/scaffold/case-map', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const current = scaffoldState.caseMap;
    const now = new Date().toISOString();
    let nextCaseMap = normalizeV2CaseMap({
      version: 'scaffold-v2',
      currentPhase:
        typeof req.body?.currentPhase === 'string'
          ? req.body.currentPhase
          : current?.currentPhase,
      selectedEvidenceIds: Array.isArray(req.body?.selectedEvidenceIds)
        ? req.body.selectedEvidenceIds
        : current?.selectedEvidenceIds,
      evidenceReflections: Array.isArray(req.body?.evidenceReflections)
        ? req.body.evidenceReflections
        : current?.evidenceReflections,
      learnerAddedEvidence: Array.isArray(req.body?.learnerAddedEvidence)
        ? req.body.learnerAddedEvidence
        : current?.learnerAddedEvidence,
      evidenceFeedbackRevealedAt:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'evidenceFeedbackRevealedAt')
          ? typeof req.body?.evidenceFeedbackRevealedAt === 'string'
            ? req.body.evidenceFeedbackRevealedAt
            : undefined
          : current?.evidenceFeedbackRevealedAt,
      caseNotes: Array.isArray(req.body?.caseNotes)
        ? req.body.caseNotes
        : current?.caseNotes,
      noteFeedbackRevealedAt:
        Object.prototype.hasOwnProperty.call(req.body || {}, 'noteFeedbackRevealedAt')
          ? typeof req.body?.noteFeedbackRevealedAt === 'string'
            ? req.body.noteFeedbackRevealedAt
            : undefined
          : current?.noteFeedbackRevealedAt,
      problemRepresentation:
        typeof req.body?.problemRepresentation === 'string'
          ? req.body.problemRepresentation
          : current?.problemRepresentation,
      reportabilityRationale:
        typeof req.body?.reportabilityRationale === 'string'
          ? req.body.reportabilityRationale
          : current?.reportabilityRationale,
      teachingPoints: Array.isArray(req.body?.teachingPoints)
        ? req.body.teachingPoints
        : current?.teachingPoints,
      targetAudience:
        typeof req.body?.targetAudience === 'string'
          ? req.body.targetAudience
          : current?.targetAudience,
      claims: Array.isArray(req.body?.claims) ? req.body.claims : current?.claims,
      createdAt: current?.createdAt || now,
      updatedAt: now
    });

    if (!nextCaseMap) {
      return res.status(400).json({ error: 'A valid Scaffold v2 case map is required.' });
    }

    const normalizedVisits = Array.isArray(caseData.visits) ? caseData.visits : [];
    const invalidLearnerEvidence = nextCaseMap.learnerAddedEvidence.find((item) => {
      const visit = normalizedVisits[item.visitIndex - 1];
      const source = String(visit?.soapText || '').replace(/\s+/g, ' ').trim();
      const excerpt = item.sourceText.replace(/\s+/g, ' ').trim();
      return !source || !excerpt || !source.includes(excerpt);
    });
    if (invalidLearnerEvidence) {
      return res.status(400).json({
        error: '학습자 추가 근거는 선택한 방문의 SOAP 원문과 일치해야 합니다.'
      });
    }

    nextCaseMap.learnerAddedEvidence = nextCaseMap.learnerAddedEvidence.map((item) => ({
      ...item,
      visitDateTime: String(normalizedVisits[item.visitIndex - 1]?.date || item.visitDateTime || '').trim() || undefined
    }));

    const repairedGeneratedEvidence = repairSplitClinicalEvidenceCards(
      (caseData.evidenceCards || []).filter(
        (card: any) => card?.evidenceType !== 'learner_added_scaffold'
      ),
      normalizedVisits
    );
    const generatedEvidenceCards = repairedGeneratedEvidence.cards;
    nextCaseMap =
      redirectScaffoldEvidenceIds(
        { ...scaffoldState, caseMap: nextCaseMap },
        repairedGeneratedEvidence.idRedirects
      ).caseMap || nextCaseMap;
    const knownEvidenceIds = new Set(
      [
        ...generatedEvidenceCards,
        ...nextCaseMap.learnerAddedEvidence
      ]
        .map((card: any) => String(card?.id || '').trim())
        .filter(Boolean)
    );
    nextCaseMap.selectedEvidenceIds = nextCaseMap.selectedEvidenceIds.filter((id) =>
      knownEvidenceIds.has(id)
    );
    nextCaseMap.claims = nextCaseMap.claims.map((claim) => ({
      ...claim,
      evidenceIds: claim.evidenceIds.filter((id) => knownEvidenceIds.has(id))
    }));
    nextCaseMap.evidenceReflections = nextCaseMap.evidenceReflections.filter(
      (item) => knownEvidenceIds.has(item.evidenceId) && nextCaseMap.selectedEvidenceIds.includes(item.evidenceId)
    );
    nextCaseMap.caseNotes = nextCaseMap.caseNotes.map((note) => ({
      ...note,
      sourceEvidenceIds: note.sourceEvidenceIds.filter((id) => knownEvidenceIds.has(id))
    }));

    const nextScaffoldState: ScaffoldState = {
      ...scaffoldState,
      caseMap: nextCaseMap
    };
    const learnerEvidenceCards = nextCaseMap.learnerAddedEvidence.map((item) => {
      const targetSectionIds = Array.from(
        new Set(
          nextCaseMap.claims
            .filter((claim) => claim.evidenceIds.includes(item.id))
            .flatMap((claim) => claim.targetSectionIds)
        )
      );
      return {
        id: item.id,
        visitIndex: item.visitIndex,
        visitDateTime: item.visitDateTime || '',
        sourceText: item.sourceText,
        normalizedText: item.sourceText,
        evidenceType: 'learner_added_scaffold',
        tags: targetSectionIds,
        sectionHints: targetSectionIds,
        confidence: 1
      };
    });
    await caseModel.updateCase(caseData.id, {
      scaffoldState: nextScaffoldState as any,
      evidenceCards: [...generatedEvidenceCards, ...learnerEvidenceCards]
    } as any);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState,
      caseMap: nextCaseMap
    });
  } catch (error: any) {
    console.error('Error saving Scaffold v2 case map:', error);
    res.status(500).json({ error: error.message || 'Failed to save Scaffold v2 case map' });
  }
});

router.put('/:caseId/scaffold/review-items/:itemId', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const sectionId = parseScaffoldSectionId(req.body?.sectionId);
    const sourceType = String(req.body?.sourceType || '').trim() as ScaffoldReviewSourceType;
    const sourceText = String(req.body?.sourceText || '').trim();
    const judgment = String(req.body?.judgment || '').trim() as ScaffoldReviewJudgment;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const evidenceIds: string[] = Array.isArray(req.body?.evidenceIds)
      ? req.body.evidenceIds.map((item: any) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!sectionId) {
      return res.status(400).json({ error: 'A valid sectionId is required.' });
    }

    if (!VALID_SOURCE_TYPES.has(sourceType)) {
      return res.status(400).json({ error: 'A valid sourceType is required.' });
    }

    if (!sourceText) {
      return res.status(400).json({ error: 'sourceText is required.' });
    }

    if (!VALID_JUDGMENTS.has(judgment)) {
      return res.status(400).json({ error: 'A valid judgment is required.' });
    }

    // Validate judgment type matches source type (Phase 1)
    const judgmentValidation = validateJudgmentForSourceType(sourceType, judgment);
    if (!judgmentValidation.isValid) {
      return res.status(400).json({
        error: `Invalid judgment type for source type. Expected ${judgmentValidation.expectedType} judgment.`
      });
    }

    if (sourceType === 'draft_sentence') {
      if (judgment === 'pending') {
        return res.status(400).json({ error: 'A draft sentence judgment must be selected.' });
      }

      if (evidenceIds.some((id) => id.startsWith('visit:'))) {
        return res.status(400).json({
          error: 'Draft sentence evidence must reference concrete SOAP evidence, not an entire visit.'
        });
      }

      const evidenceValidation = validateScaffoldSelectedEvidence(
        caseData,
        evidenceIds.map((id) => ({ id, sourceType: 'evidence_card' }))
      );
      if (!evidenceValidation.valid) {
        return res.status(400).json({
          error: 'Draft sentence evidence must belong to this case.',
          invalidEvidenceIds: evidenceValidation.invalidEvidenceIds
        });
      }

      if (judgment !== 'supported_by_record' && !note && evidenceIds.length === 0) {
        return res.status(400).json({
          error: 'A draft sentence review requires either a note or concrete SOAP evidence.'
        });
      }
    }

    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const itemId = String(req.params.itemId || '').trim() || randomUUID();
    const updatedAt = new Date().toISOString();
    const reviewItem: ScaffoldReviewItem = {
      id: itemId,
      sectionId,
      sourceType,
      sourceText,
      judgment,
      note: note || undefined,
      evidenceIds,
      learnerItemId:
        typeof req.body?.learnerItemId === 'string'
          ? req.body.learnerItemId.trim() || undefined
          : sourceType === 'draft_sentence'
            ? undefined
            : itemId,
      reviewItemId: typeof req.body?.reviewItemId === 'string' ? req.body.reviewItemId.trim() || undefined : itemId,
      aiSentenceId:
        typeof req.body?.aiSentenceId === 'string'
          ? req.body.aiSentenceId.trim() || undefined
          : sourceType === 'draft_sentence'
            ? itemId
            : undefined,
      sourceLearnerItemIds: Array.isArray(req.body?.sourceLearnerItemIds)
        ? req.body.sourceLearnerItemIds.map((item: any) => String(item || '').trim()).filter(Boolean)
        : undefined,
      sourceEvidenceIds: Array.isArray(req.body?.sourceEvidenceIds)
        ? req.body.sourceEvidenceIds.map((item: any) => String(item || '').trim()).filter(Boolean)
        : evidenceIds.length > 0
          ? evidenceIds
          : undefined,
      learningFeedback:
        sourceType === 'draft_sentence' && judgment !== 'pending'
          ? buildLearningFeedback(caseData, judgment as DraftJudgment, evidenceIds, updatedAt)
          : undefined,
      updatedAt
    };

    const existingIndex = scaffoldState.reviewItems.findIndex((item) => item.id === itemId);
    const reviewItems =
      existingIndex >= 0
        ? scaffoldState.reviewItems.map((item) => (item.id === itemId ? reviewItem : item))
        : [...scaffoldState.reviewItems, reviewItem];

    const summaryLists = deriveSummaryLists(reviewItems);

    // Phase 2: Map information status judgment to question task status (status-based, not essay-based)
    let nextQuestionTaskStatus: 'answered' | 'needs_additional_confirmation' | 'needs_instructor_review' | 'unavailable' = 'unavailable';
    if (isValidInformationStatusJudgment(judgment)) {
      const infoJudgment = judgment as InformationStatusJudgment;
      if (infoJudgment === 'available_in_record') {
        nextQuestionTaskStatus = 'answered';
      } else if (infoJudgment === 'needs_additional_confirmation') {
        nextQuestionTaskStatus = 'needs_additional_confirmation';
      } else if (infoJudgment === 'needs_instructor_review') {
        nextQuestionTaskStatus = 'needs_instructor_review';
      } else if (infoJudgment === 'unavailable') {
        nextQuestionTaskStatus = 'unavailable';
      } else if (infoJudgment === 'pending') {
        // pending is internal state, map to unavailable for question status
        nextQuestionTaskStatus = 'unavailable';
      }
    }

    // Only include question task result if it's a recommended question
    // answerText should only be included when status is 'answered'
    const nextQuestionTaskResults =
      sourceType === 'recommended_question'
        ? [
            ...(scaffoldState.questionTaskResults || []).filter((item) => item.itemId !== itemId),
            {
              itemId,
              question: sourceText,
              status: nextQuestionTaskStatus,
              answerText: nextQuestionTaskStatus === 'answered' ? reviewItem.note : undefined,
              updatedAt: reviewItem.updatedAt
            }
          ]
        : scaffoldState.questionTaskResults || [];
    const nextScaffoldState: ScaffoldState = {
      ...scaffoldState,
      reviewItems,
      questionTaskResults: nextQuestionTaskResults,
      ...summaryLists
    };

    await persistScaffoldState(caseData.id, nextScaffoldState);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState,
      reviewItem
    });
  } catch (error: any) {
    console.error('Error saving scaffold review item:', error);
    res.status(500).json({ error: error.message || 'Failed to save scaffold review item' });
  }
});

router.put('/:caseId/scaffold/sections/:sectionId/progress', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const sectionId = parseScaffoldSectionId(req.params.sectionId);
    if (!sectionId) {
      return res.status(400).json({ error: 'A valid sectionId is required.' });
    }

    let scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const studyMode = Boolean((caseData as any).studyConfig?.studyMode);
    const includesEvidencePayload =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedEvidence') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'selectedEvidenceIds');
    if (includesEvidencePayload) {
      const evidenceValidation = validateScaffoldSelectedEvidence(
        caseData,
        req.body?.selectedEvidence,
        req.body?.selectedEvidenceIds
      );
      if (!evidenceValidation.valid) {
        return res.status(400).json({
          error: 'Selected evidence must belong to this case.',
          invalidEvidenceIds: evidenceValidation.invalidEvidenceIds
        });
      }
    }

    if (studyMode && req.body?.recordReviewCompleted === true) {
      const gate = evaluateStudyRevealGate(caseData, scaffoldState, sectionId);
      if (!gate.validPreAiEvidencePath) {
        return res.status(409).json({
          error: 'Select case evidence, write key information, or confirm that no relevant evidence exists.',
          revealGate: gate
        });
      }
    }

    if (studyMode && req.body?.missingInfoReviewCompleted === true) {
      const gate = evaluateStudyRevealGate(caseData, scaffoldState, sectionId);
      if (!gate.allSufficiencyJudgmentsSaved) {
        return res.status(409).json({
          error: 'All required information sufficiency judgments must be saved.',
          revealGate: gate
        });
      }
    }

    if (req.body?.draftRevealed === true) {
      if (studyMode) {
        const gate = evaluateStudyRevealGate(caseData, scaffoldState, sectionId);
        if (!gate.canReveal) {
          return res.status(409).json({
            error: 'Study scaffold reveal requirements are not complete.',
            revealGate: gate
          });
        }
      }

      // The pre-reveal snapshot is saved for every scaffold case, not only study
      // mode, so the learner's own judgment is preserved before the AI draft is shown.
      const snapshotExists = (scaffoldState.preRevealSnapshots || []).some(
        (item) => item.sectionId === sectionId
      );
      if (!snapshotExists) {
        const reflection = getSectionReflection(scaffoldState, sectionId);
        const evidenceValidation = validateScaffoldSelectedEvidence(
          caseData,
          reflection?.selectedEvidence,
          reflection?.selectedEvidenceIds
        );
        const timestamp = new Date().toISOString();
        const stateWithSnapshot: ScaffoldState = {
          ...scaffoldState,
          preRevealSnapshots: [
            ...(scaffoldState.preRevealSnapshots || []),
            buildPreRevealSnapshot(scaffoldState, sectionId, evidenceValidation.selectedEvidence)
          ]
        };
        scaffoldState = appendInteractionEvent(stateWithSnapshot, {
          eventId: randomUUID(),
          eventType: 'pre_reveal_snapshot_created',
          timestamp,
          caseId: caseData.id,
          mode: 'scaffold',
          sectionId,
          sessionId: scaffoldState.sessionId,
          participantCode: scaffoldState.participantCode,
          metadata: {
            selectedEvidenceCount: evidenceValidation.selectedEvidence.length
          }
        });
        await persistScaffoldState(caseData.id, scaffoldState);
        (caseData as any).scaffoldState = scaffoldState;
      }

      if (studyMode) {
        await ensureStudyScaffoldDraftAfterSnapshot(caseData.id, sectionId);
      }
    }
    if (req.body?.draftReviewCompleted === true) {
      const gate = evaluateStudyCompletionGate(caseData, scaffoldState, sectionId);
      if (!gate.draftRevealed || !gate.allDraftJudgmentsSaved || !gate.postAiReflectionSaved) {
        return res.status(409).json({
          error: 'Scaffold draft review requirements are not complete.',
          completionGate: gate
        });
      }

      if (studyMode && !gate.canComplete) {
        return res.status(409).json({
          error: 'Study scaffold completion requirements are not complete.',
          completionGate: gate
        });
      }
    }

    const { nextProgressItems, progress } = upsertProgress(scaffoldState.sectionProgress, sectionId, {
      recordReviewCompleted:
        typeof req.body?.recordReviewCompleted === 'boolean'
          ? req.body.recordReviewCompleted
          : undefined,
      missingInfoReviewCompleted:
        typeof req.body?.missingInfoReviewCompleted === 'boolean'
          ? req.body.missingInfoReviewCompleted
          : undefined,
      draftRevealed:
        typeof req.body?.draftRevealed === 'boolean' ? req.body.draftRevealed : undefined,
      draftReviewCompleted:
        typeof req.body?.draftReviewCompleted === 'boolean'
          ? req.body.draftReviewCompleted
          : undefined
    });

    const allSections = (caseData.sectionStates || []).map((item: any) => item.sectionId);
    const completedSections = nextProgressItems.filter(
      (item) =>
        item.recordReviewCompleted &&
        item.missingInfoReviewCompleted &&
        item.draftRevealed &&
        item.draftReviewCompleted
    );

    const nextScaffoldState: ScaffoldState = {
      ...scaffoldState,
      sectionProgress: nextProgressItems,
      completedAt:
        allSections.length > 0 && completedSections.length >= allSections.length
          ? scaffoldState.completedAt || new Date().toISOString()
          : scaffoldState.completedAt
    };

    await persistScaffoldState(caseData.id, nextScaffoldState);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState,
      progress
    });
  } catch (error: any) {
    console.error('Error saving scaffold section progress:', error);
    res.status(500).json({ error: error.message || 'Failed to save scaffold section progress' });
  }
});

router.put('/:caseId/scaffold/sections/:sectionId/reflection', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const sectionId = parseScaffoldSectionId(req.params.sectionId);
    if (!sectionId) {
      return res.status(400).json({ error: 'A valid sectionId is required.' });
    }

    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const learnerKeyInformationItems = normalizeStringArray(
      req.body?.learnerKeyInformationItems ?? req.body?.learnerIdentifiedKeyInfo
    );
    const evidenceValidation = validateScaffoldSelectedEvidence(
      caseData,
      req.body?.selectedEvidence,
      req.body?.selectedEvidenceIds
    );
    if (!evidenceValidation.valid) {
      return res.status(400).json({
        error: 'Selected evidence must belong to this case.',
        invalidEvidenceIds: evidenceValidation.invalidEvidenceIds
      });
    }

    const noRelevantEvidenceConfirmed = req.body?.noRelevantEvidenceConfirmed === true;
    if (
      noRelevantEvidenceConfirmed &&
      (evidenceValidation.selectedEvidenceIds.length > 0 || learnerKeyInformationItems.length > 0)
    ) {
      return res.status(400).json({
        error: 'No-relevant-evidence cannot be combined with selected evidence or written key information.'
      });
    }

    const { nextReflectionItems, reflection } = upsertReflection(
      scaffoldState.sectionReflections || [],
      sectionId,
      {
        selectedEvidenceIds: evidenceValidation.selectedEvidenceIds,
        selectedEvidence: evidenceValidation.selectedEvidence,
        noRelevantEvidenceConfirmed,
        learnerKeyInformationItems,
        learnerIdentifiedKeyInfo: normalizeStringArray(req.body?.learnerIdentifiedKeyInfo),
        learnerNotes:
          typeof req.body?.learnerNotes === 'string' ? req.body.learnerNotes.trim() || undefined : undefined,
        learnerIdentifiedMissingItems: normalizeStringArray(req.body?.learnerIdentifiedMissingItems),
        additionalConfirmationItems: normalizeStringArray(req.body?.additionalConfirmationItems),
        teacherReviewItems: normalizeStringArray(req.body?.teacherReviewItems),
        postAiReflection:
          req.body?.postAiReflection && typeof req.body.postAiReflection === 'object'
            ? {
                changedJudgment: String(req.body.postAiReflection.changedJudgment || '').trim(),
                unresolvedQuestion: String(req.body.postAiReflection.unresolvedQuestion || '').trim(),
                transferPlan: String(req.body.postAiReflection.transferPlan || '').trim(),
                savedAt: new Date().toISOString()
              }
            : undefined,
        draftRevealedAt:
          typeof req.body?.draftRevealedAt === 'string' ? req.body.draftRevealedAt : undefined,
        draftReviewStatus:
          req.body?.draftReviewStatus === 'reviewed' ? 'reviewed' : req.body?.draftReviewStatus === 'not_reviewed' ? 'not_reviewed' : undefined,
        completedAt: typeof req.body?.completedAt === 'string' ? req.body.completedAt : undefined
      }
    );

    const nextScaffoldState: ScaffoldState = {
      ...scaffoldState,
      sectionReflections: nextReflectionItems
    };

    await persistScaffoldState(caseData.id, nextScaffoldState);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState,
      reflection
    });
  } catch (error: any) {
    console.error('Error saving scaffold reflection:', error);
    res.status(500).json({ error: error.message || 'Failed to save scaffold reflection' });
  }
});

router.post('/:caseId/scaffold/events', async (req: Request, res: Response) => {
  try {
    const caseData = await getValidatedScaffoldCase(req.params.caseId, res);
    if (!caseData) return;

    const eventType = String(req.body?.eventType || '').trim() as ScaffoldInteractionEventType;
    const sectionId = req.body?.sectionId ? parseScaffoldSectionId(req.body.sectionId) : null;

    if (!VALID_EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ error: 'A valid eventType is required.' });
    }

    if (req.body?.sectionId && !sectionId) {
      return res.status(400).json({ error: 'A valid sectionId is required when provided.' });
    }

    const scaffoldState = normalizeScaffoldState(caseData.scaffoldState || emptyScaffoldState());
    const event: ScaffoldInteractionEvent = {
      eventId:
        typeof req.body?.eventId === 'string' && req.body.eventId.trim()
          ? req.body.eventId.trim()
          : randomUUID(),
      eventType,
      timestamp: new Date().toISOString(),
      caseId: caseData.id,
      mode: 'scaffold',
      sectionId: sectionId || undefined,
      sessionId:
        typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() || scaffoldState.sessionId : scaffoldState.sessionId,
      participantCode:
        typeof req.body?.participantCode === 'string'
          ? req.body.participantCode.trim() || scaffoldState.participantCode
          : scaffoldState.participantCode,
      metadata: sanitizeEventMetadata(req.body?.metadata)
    };

    const nextScaffoldState = appendInteractionEvent(scaffoldState, event);
    const researchState = normalizeResearchState(
      (caseData as any).researchState,
      Boolean((caseData as any).studyConfig?.studyMode)
    );
    const nextResearchState = appendResearchEvent(researchState, {
      eventId: event.eventId || randomUUID(),
      eventType: eventType as ResearchEventType,
      caseId: caseData.id,
      mode: 'scaffold',
      timestamp: event.timestamp,
      sectionId: event.sectionId,
      participantCode: event.participantCode,
      sessionId: event.sessionId,
      metadata: event.metadata
    });
    await caseModel.updateCase(caseData.id, {
      scaffoldState: nextScaffoldState as any,
      researchState: nextResearchState as any
    } as any);

    res.json({
      success: true,
      scaffoldState: nextScaffoldState,
      event
    });
  } catch (error: any) {
    console.error('Error logging scaffold event:', error);
    res.status(500).json({ error: error.message || 'Failed to log scaffold event' });
  }
});

export default router;
