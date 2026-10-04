export enum CareSection {
  TITLE = 'TITLE',
  ABSTRACT = 'ABSTRACT',
  INTRODUCTION = 'INTRODUCTION',
  PATIENT_INFORMATION = 'PATIENT_INFORMATION',
  CLINICAL_FINDINGS = 'CLINICAL_FINDINGS',
  TIMELINE = 'TIMELINE',
  DIAGNOSTIC_ASSESSMENT = 'DIAGNOSTIC_ASSESSMENT',
  THERAPEUTIC_INTERVENTIONS = 'THERAPEUTIC_INTERVENTIONS',
  FOLLOW_UP_OUTCOMES = 'FOLLOW_UP_OUTCOMES',
  DISCUSSION_CONCLUSION = 'DISCUSSION_CONCLUSION',
  PATIENT_PERSPECTIVE = 'PATIENT_PERSPECTIVE',
  INFORMED_CONSENT = 'INFORMED_CONSENT'
}

export type CaseMode = 'write' | 'scaffold';

export type ResearchEventType =
  | 'session_start'
  | 'case_created'
  | 'mode_assigned'
  | 'case_processed'
  | 'section_opened'
  | 'evidence_opened'
  | 'question_viewed'
  | 'question_answered'
  | 'review_ai_requested'
  | 'review_ai_result_viewed'
  | 'section_completed'
  | 'final_output_viewed'
  | 'export_requested'
  | 'session_completed'
  | 'section_purpose_viewed'
  | 'learner_reflection_saved'
  | 'record_review_completed'
  | 'missing_item_viewed'
  | 'missing_item_classified'
  | 'question_task_completed'
  | 'additional_confirmation_marked'
  | 'teacher_review_marked'
  | 'pre_reveal_snapshot_created'
  | 'ai_draft_revealed'
  | 'post_ai_review_started'
  | 'draft_judgment_saved'
  | 'draft_review_completed'
  | 'case_map_saved'
  | 'workflow_phase_changed'
  | 'claim_map_saved'
  | 'record_review_started';

export interface ResearchEvent {
  eventId: string;
  eventType: ResearchEventType;
  timestamp: string;
  caseId: string;
  mode: CaseMode;
  participantCode?: string;
  sessionId?: string;
  sectionId?: CareSection;
  metadata?: Record<string, unknown>;
}

export interface ResearchState {
  studyMode: boolean;
  participantCode?: string;
  sessionId?: string;
  startedAt?: string;
  completedAt?: string;
  interactionEvents: ResearchEvent[];
}

export interface StudyMetadata {
  studyGroup?: 'expert' | 'novice';
  phase?: 'pilot' | 'main' | 'followup';
  sessionNo?: number;
  participationMode?: 'online' | 'offline';
}

export interface VersionMetadata {
  appVersion?: string;
  scaffoldVersion?: string;
  caseVersion?: string;
  sectionConfigVersion?: string;
}

export interface ResearcherAssistanceEntry {
  sectionId?: CareSection | string;
  level: 'minor' | 'major';
  reason?: string;
  timestamp: string;
}

export interface TechnicalIssueEntry {
  sectionId?: CareSection | string;
  type:
    | 'ai_generation_failure'
    | 'network'
    | 'save_failure'
    | 'refresh'
    | 'session_recovery'
    | 'ui_error'
    | 'other';
  description?: string;
  occurredAt: string;
  resolved?: boolean;
}

export interface CaseInputValidation {
  canonicalCaseId: string;
  canonicalCaseVersion: string;
  validated: boolean;
  validatedAt?: string;
  mismatchCount?: number;
  note?: string;
}

export interface SessionOutcome {
  status: 'in_progress' | 'completed' | 'aborted';
  stopReason?: string;
}

export interface StudyConfig {
  studyMode: boolean;
  studyCaseId?: string;
  participantCode?: string;
  condition?: CaseMode;
  lockedMode?: boolean;
  fixedCase?: boolean;
}

export enum VisitType {
  INITIAL = '초진',
  FOLLOW_UP = '재진'
}

export enum SectionStatus {
  IMPOSSIBLE = 'IMPOSSIBLE',
  INCOMPLETE = 'INCOMPLETE',
  READY = 'READY'
}

export interface Visit {
  index: number;
  type: VisitType;
  date: string;
  soapText: string;
  structured?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  };
}

export interface Case {
  id: string;
  experiment_code?: string;
  experimentCode?: string;
  createdAt: string;
  mode?: CaseMode;
  title?: string;
  studyMetadata?: StudyMetadata | null;
  versionMetadata?: VersionMetadata | null;
  caseInputValidation?: CaseInputValidation | null;
  sessionOutcome?: SessionOutcome | null;
  researcherAssistance?: ResearcherAssistanceEntry[];
  technicalIssues?: TechnicalIssueEntry[];
  visits: Visit[];
  timelineEvents?: TimelineEvent[];
  deidentifiedEMRs?: DeidentifiedVisitRecord[];
  pendingTermConfirmations?: PendingTermConfirmation[];
  reviewRequired?: ReviewRequiredState | null;
  staleState?: StaleState | null;
  processingCache?: {
    inputHash: string;
    processedAt: string;
  };
  chainCache?: Record<string, ChainCacheEntry>;
  chainProgress?: ChainProgressState | null;
  chainPerformanceLogs?: ChainPerformanceLog[];
  exportLogs?: ExportLogEntry[];
  finalComposeStatus?: {
    status: 'IDLE' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    requestedAt?: string;
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;
  };
  sectionEvidenceMap?: Record<CareSection, string[]>;
  sectionStatusMap?: Record<CareSection, SectionStatusInfo>;
  draftsBySection?: Record<CareSection, string>;
  evidenceCards?: Array<{
    id: string;
    visitIndex: number;
    visitDateTime: string;
    sourceText: string;
    normalizedText?: string;
    evidenceType?: string;
    tags: CareSection[];
    sectionHints?: CareSection[];
    terms?: Array<{
      surface: string;
      normalizedTerm: string;
      termId: string;
      category: string;
      matchType: 'exact' | 'synonym' | 'typo' | 'alias' | 'fuzzy' | 'semantic';
      confidence: number;
      needsUserConfirmation: boolean;
      semanticTags?: string[];
      relatedTerms?: string[];
      normalizationPolicy?: 'AUTO_NORMALIZE' | 'REQUIRE_CONFIRMATION' | 'PRESERVE_ORIGINAL';
      evidenceUsage?: 'ALLOWED' | 'WARNING' | 'RESTRICTED';
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      preserveSurfaceForm?: boolean;
      usagePolicy?: 'NORMALIZATION_ONLY' | 'DRAFT_ALLOWED';
      reviewerNote?: string;
      candidates?: Array<{
        termId: string;
        standardTerm: string;
        confidence: number;
      }>;
    }>;
    sourceRef?: {
      charStart?: number;
      charEnd?: number;
      lineStart?: number;
      lineEnd?: number;
    };
    confidence: number;
  }>;
  sectionStates?: Array<{
    sectionId: CareSection;
    status: SectionStatus | string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  commonMissingItems?: Array<{
    item: string;
    relatedSectionIds: CareSection[];
    category?:
      | 'psychosocial_context'
      | 'symptom_course'
      | 'functional_impact'
      | 'treatment_response'
      | 'patient_perspective'
      | 'diagnostic_reasoning'
      | 'follow_up_outcome'
      | 'adverse_event'
      | 'consent'
      | 'timeline_clarification';
  }>;
  commonQuestionSets?: Array<{
    question: string;
    targetSectionIds: CareSection[];
    category?:
      | 'psychosocial_context'
      | 'symptom_course'
      | 'functional_impact'
      | 'treatment_response'
      | 'patient_perspective'
      | 'diagnostic_reasoning'
      | 'follow_up_outcome'
      | 'adverse_event'
      | 'consent'
      | 'timeline_clarification';
  }>;
  answerUndoStack?: AnswerUndoEntry[];
  sectionDrafts?: Array<{
    sectionId: CareSection;
    evidenceCardIdsUsed: string[];
    timelineEventIdsUsed?: string[];
    draftText: string;
    openIssues: string[];
    evidenceLinks: SectionEvidenceLink[];
    unsupportedClaims: UnsupportedClaim[];
  }>;
  sectionAdequacyReviews?: Partial<Record<CareSection, SectionAdequacyReviewSnapshot>>;
  scaffoldState?: import('./scaffold').ScaffoldState | null;
  researchState?: ResearchState | null;
  studyConfig?: StudyConfig | null;
  finalDraft?: any;
}

export interface ExportLogEntry {
  exportId: string;
  requestedAt: string;
  mode:
    | 'current_section_drafts'
    | 'final_manuscript'
    | 'final_manuscript_with_checklist'
    | 'final_manuscript_with_traceability'
    | 'scaffold_review';
  layout: 'one_paragraph' | 'two_paragraph';
  succeeded: boolean;
  fileName?: string;
  errorMessage?: string;
}

export interface SectionStatusInfo {
  status: SectionStatus;
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
}

export interface SectionInteraction {
  sectionId: CareSection;
  qnaHistory: QnAPair[];
}

export interface QnAPair {
  question: string;
  answer: string;
  timestamp: string;
}

export interface SectionAdequacyReviewSnapshot {
  sectionId: CareSection;
  adequacyStatus: 'INSUFFICIENT' | 'BORDERLINE' | 'ADEQUATE';
  sectionCompleteness: 'LOW' | 'MEDIUM' | 'HIGH';
  contentCompleteness: 'LOW' | 'MEDIUM' | 'HIGH';
  naturalness: 'LOW' | 'MEDIUM' | 'HIGH';
  evidenceGrounding: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED_OR_UNVERIFIABLE';
  summary: string;
  missingRequiredItems: string[];
  depthIssues: string[];
  shouldAskMore: boolean;
  questionFocus: string;
  reviewedAt: string;
  reviewInputHash?: string;
}

export interface DeidentifiedVisitRecord {
  visitIndex: number;
  visitDate: string;
  emrId: string;
  deidentifiedText: string;
  phiSpans: Array<{
    type:
      | 'PATIENT_NAME'
      | 'DOCTOR_NAME'
      | 'HOSPITAL'
      | 'PHONE'
      | 'ADDRESS'
      | 'PATIENT_ID'
      | 'RESIDENT_ID'
      | 'DATE'
      | 'EMAIL'
      | 'OTHER';
    originalText: string;
    replacement: string;
    startIndex: number;
    endIndex: number;
    confidence: number;
  }>;
  replacementMap: Array<{
    type:
      | 'PATIENT_NAME'
      | 'DOCTOR_NAME'
      | 'HOSPITAL'
      | 'PHONE'
      | 'ADDRESS'
      | 'PATIENT_ID'
      | 'RESIDENT_ID'
      | 'DATE'
      | 'EMAIL'
      | 'OTHER';
    originalText: string;
    replacement: string;
    occurrences: number;
  }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface PendingTermConfirmation {
  pendingId: string;
  visitIndex: number;
  visitDate: string;
  sourceText: string;
  normalizedText: string;
  surface: string;
  normalizedTerm: string;
  termId: string;
  category: string;
  matchType: 'exact' | 'synonym' | 'typo' | 'alias' | 'fuzzy' | 'partial' | 'semantic';
  confidence: number;
  needsUserConfirmation: boolean;
  candidates: Array<{
    termId: string;
    standardTerm: string;
    confidence: number;
  }>;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  decisionReuseKey?: string;
  reuseEligible?: boolean;
  confirmedTerm?: string;
  customReplacement?: string;
  resolvedAt?: string;
}

export interface ReviewRequiredState {
  riskLevel: 'MEDIUM' | 'HIGH';
  reasons: string[];
  createdAt: string;
}

export interface StaleState {
  isStale: boolean;
  staleReason:
    | 'ANSWER_UPDATED'
    | 'TERM_CONFIRMATION_UPDATED'
    | 'DEIDENTIFICATION_UPDATED'
    | 'EVIDENCE_REGENERATED';
  staleAt: string;
}

export interface ChainCacheEntry {
  inputHash: string;
  outputHash?: string;
  updatedAt: string;
}

export interface ChainProgressState {
  currentStep?: string;
  completedSteps: string[];
  estimatedRemainingSteps: string[];
  updatedAt: string;
}

export interface ChainPerformanceLog {
  chainName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  inputHash: string;
  cacheHit: boolean;
  llmCallCount: number;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null;
  error?: string;
}

export interface SectionEvidenceLink {
  sentence: string;
  evidenceCardIds: string[];
}

export interface UnsupportedClaim {
  sentence: string;
  reason: string;
}

export interface AnswerUndoEntry {
  timestamp: string;
  kind: 'COMMON' | 'SECTION';
  question: string;
  sectionId?: CareSection | '__COMMON__';
  before: {
    draftsBySection?: Record<string, string>;
    sectionDrafts: Array<any>;
    sectionStates: Array<any>;
    commonMissingItems: Array<any>;
    commonQuestionSets: Array<any>;
    sectionAdequacyReviews?: Record<string, any>;
    interactions: Array<{
      sectionId: string;
      qnaHistory: QnAPair[];
    }>;
  };
}

export interface TimelineEvent {
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
  source: 'excel_import';
  importedAt: string;
  originalRowIndex: number;
}
