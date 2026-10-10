import axios from 'axios';

const apiBaseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL: apiBaseURL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Callers surface `error.message`, which axios sets to "Request failed with status code 500" and
// which hides the reason the API actually reported. Promote the server message onto it.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const serverMessage = (error?.response?.data as { error?: string } | undefined)?.error;
    if (serverMessage) {
      error.message = serverMessage;
    } else if (!error?.response) {
      error.message = '서버에 연결하지 못했습니다. 백엔드가 실행 중인지 확인해 주세요.';
    }
    return Promise.reject(error);
  }
);

export interface Visit {
  type: '초진' | '재진';
  date: string;
  soapText: string;
  structured?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  };
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
  | 'record_review_started';

export interface ResearchEvent {
  eventId: string;
  eventType: ResearchEventType;
  timestamp: string;
  caseId: string;
  mode: CaseMode;
  participantCode?: string;
  sessionId?: string;
  sectionId?: string;
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
  sectionId?: string;
  level: 'minor' | 'major';
  reason?: string;
  timestamp: string;
}

export interface TechnicalIssueEntry {
  sectionId?: string;
  type: 'ai_generation_failure' | 'network' | 'save_failure' | 'refresh' | 'session_recovery' | 'ui_error' | 'other';
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

export type ScaffoldReviewSourceType =
  | 'missing_info'
  | 'recommended_question'
  | 'depth_issue'
  | 'unsupported_claim'
  | 'draft_sentence'
  | 'custom';

export type InformationStatusJudgment =
  | 'available_in_record'
  | 'needs_additional_confirmation'
  | 'needs_instructor_review'
  | 'unavailable'
  | 'pending';

export type DraftJudgment =
  | 'pending'
  | 'supported_by_record'
  | 'differs_from_record'
  | 'want_to_add'
  | 'needs_additional_confirmation'
  | 'needs_instructor_review'
  | 'uncertain';

export type ScaffoldReviewJudgment = InformationStatusJudgment | DraftJudgment;

export interface ScaffoldLearningFeedback {
  source: 'grounded_review_coach_v1';
  summary: string;
  prompts: string[];
  selectedEvidence: Array<{
    id: string;
    text: string;
  }>;
  generatedAt: string;
}

export interface ScaffoldReviewItem {
  id: string;
  sectionId: string;
  sourceType: ScaffoldReviewSourceType;
  sourceText: string;
  judgment: ScaffoldReviewJudgment;
  note?: string;
  evidenceIds?: string[];
  learnerItemId?: string;
  reviewItemId?: string;
  aiSentenceId?: string;
  sourceLearnerItemIds?: string[];
  sourceEvidenceIds?: string[];
  learningFeedback?: ScaffoldLearningFeedback;
  updatedAt: string;
}

export interface ScaffoldSectionProgress {
  sectionId: string;
  recordReviewCompleted: boolean;
  missingInfoReviewCompleted: boolean;
  draftRevealed: boolean;
  draftReviewCompleted: boolean;
  completedAt?: string;
}

export type ScaffoldDraftReviewStatus = 'not_reviewed' | 'reviewed';

export interface ScaffoldPostAiReflection {
  changedJudgment: string;
  unresolvedQuestion: string;
  transferPlan: string;
  missingInDraft?: string;
  savedAt: string;
}

export interface ScaffoldSelectedEvidence {
  id: string;
  sourceType: 'visit_soap' | 'evidence_card';
  label?: string;
  visitIndex?: number;
}

export interface ScaffoldSectionReflection {
  sectionId: string;
  selectedEvidenceIds?: string[];
  selectedEvidence?: ScaffoldSelectedEvidence[];
  noRelevantEvidenceConfirmed?: boolean;
  learnerKeyInformationItems?: string[];
  learnerIdentifiedKeyInfo?: string[];
  learnerNotes?: string;
  learnerIdentifiedMissingItems?: string[];
  additionalConfirmationItems?: string[];
  teacherReviewItems?: string[];
  postAiReflection?: ScaffoldPostAiReflection;
  draftRevealedAt?: string;
  draftReviewStatus?: ScaffoldDraftReviewStatus;
  firstOpenedAt?: string;
  completedAt?: string;
}

export interface ScaffoldQuestionTaskResult {
  itemId: string;
  question: string;
  status:
    | 'answered'
    | 'needs_additional_confirmation'
    | 'needs_instructor_review'
    | 'not_applicable';
  answerText?: string;
  updatedAt: string;
}

export interface ScaffoldPreRevealSnapshot {
  sectionId: string;
  createdAt: string;
  selectedEvidenceIds?: string[];
  selectedEvidence?: ScaffoldSelectedEvidence[];
  noRelevantEvidenceConfirmed?: boolean;
  learnerKeyInformationItems: string[];
  learnerIdentifiedMissingItems: string[];
  additionalConfirmationItems: string[];
  teacherReviewItems: string[];
  learnerNotes?: string;
  reviewItemJudgments: Array<{
    itemId: string;
    sourceType: ScaffoldReviewSourceType;
    judgment: ScaffoldReviewJudgment;
  }>;
  questionTaskResults: ScaffoldQuestionTaskResult[];
}

export type ScaffoldV2Phase =
  | 'case_understanding'
  | 'core_message'
  | 'claim_evidence'
  | 'section_drafting'
  | 'final_review';

export type ScaffoldV2ClaimType =
  | 'presentation'
  | 'diagnosis'
  | 'intervention'
  | 'outcome'
  | 'novelty';

export type ScaffoldV2ClaimConfidence = 'high' | 'medium' | 'low' | 'unresolved';

export type ScaffoldV2EvidenceRole = ScaffoldV2ClaimType;

export interface ScaffoldV2EvidenceReflection {
  evidenceId: string;
  role: ScaffoldV2EvidenceRole;
  rationale: string;
}

export interface ScaffoldV2LearnerEvidence {
  id: string;
  sourceText: string;
  visitIndex: number;
  visitDateTime?: string;
  createdAt: string;
}

export type ScaffoldV2CaseNoteType = 'observation' | 'question';

export interface ScaffoldV2CaseNote {
  id: string;
  type: ScaffoldV2CaseNoteType;
  text: string;
  sourceEvidenceIds: string[];
  createdAt: string;
}

export interface ScaffoldV2Claim {
  id: string;
  type: ScaffoldV2ClaimType;
  text: string;
  rationale?: string;
  evidenceIds: string[];
  targetSectionIds: string[];
  confidence: ScaffoldV2ClaimConfidence;
  missingInformation?: string;
}

export interface ScaffoldV2CaseMap {
  version: 'scaffold-v2';
  currentPhase: ScaffoldV2Phase;
  selectedEvidenceIds: string[];
  evidenceReflections: ScaffoldV2EvidenceReflection[];
  learnerAddedEvidence: ScaffoldV2LearnerEvidence[];
  evidenceFeedbackRevealedAt?: string;
  caseNotes: ScaffoldV2CaseNote[];
  noteFeedbackRevealedAt?: string;
  problemRepresentation: string;
  reportabilityRationale: string;
  teachingPoints: string[];
  targetAudience?: string;
  claims: ScaffoldV2Claim[];
  createdAt: string;
  updatedAt: string;
}

export type ScaffoldInteractionEventType =
  | 'session_start'
  | 'section_opened'
  | 'section_purpose_viewed'
  | 'learner_reflection_started'
  // 백엔드 VALID_EVENT_TYPES와 이름을 맞춘다 (이전의 learner_note_saved는 400을 받는다)
  | 'learner_reflection_saved'
  | 'record_review_completed'
  | 'ai_draft_revealed'
  | 'case_created'
  | 'mode_selected'
  | 'record_review_started'
  | 'evidence_opened'
  | 'case_map_saved'
  | 'workflow_phase_changed'
  | 'claim_map_saved'
  | 'information_status_judgment_saved'
  | 'question_task_responded'
  | 'pre_reveal_snapshot_created'
  | 'draft_judgment_saved'
  | 'post_ai_reflection_saved'
  | 'post_ai_review_started'
  | 'draft_review_completed'
  | 'section_completed'
  | 'final_summary_viewed'
  | 'export_requested'
  | 'ui_action'
  | 'session_completed';

export interface ScaffoldInteractionEvent {
  eventId?: string;
  sequenceIndex?: number;
  eventType: ScaffoldInteractionEventType;
  timestamp: string;
  caseId: string;
  mode: 'scaffold';
  sectionId?: string;
  sessionId?: string;
  participantCode?: string;
  metadata?: Record<string, unknown>;
}

export interface ScaffoldState {
  reviewItems: ScaffoldReviewItem[];
  sectionProgress: ScaffoldSectionProgress[];
  instructorReviewItems: string[];
  additionalConfirmationItems: string[];
  sectionReflections: ScaffoldSectionReflection[];
  questionTaskResults?: ScaffoldQuestionTaskResult[];
  preRevealSnapshots?: ScaffoldPreRevealSnapshot[];
  caseMap?: ScaffoldV2CaseMap;
  interactionEvents: ScaffoldInteractionEvent[];
  sessionId?: string;
  participantCode?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface UpsertScaffoldReviewItemRequest {
  sectionId: string;
  sourceType: ScaffoldReviewSourceType;
  sourceText: string;
  judgment: ScaffoldReviewJudgment;
  note?: string;
  evidenceIds?: string[];
}

export interface UpdateScaffoldSectionProgressRequest {
  recordReviewCompleted?: boolean;
  missingInfoReviewCompleted?: boolean;
  draftRevealed?: boolean;
  draftReviewCompleted?: boolean;
  selectedEvidenceIds?: string[];
  selectedEvidence?: Array<{
    id: string;
    sourceType: string;
    label?: string;
    visitIndex?: number;
  }>;
}

export interface UpdateScaffoldSessionRequest {
  sessionId?: string;
  participantCode?: string;
  studyMetadata?: StudyMetadata;
}

export interface UpdateScaffoldCaseMapRequest {
  currentPhase?: ScaffoldV2Phase;
  selectedEvidenceIds?: string[];
  evidenceReflections?: ScaffoldV2EvidenceReflection[];
  learnerAddedEvidence?: ScaffoldV2LearnerEvidence[];
  evidenceFeedbackRevealedAt?: string | null;
  caseNotes?: ScaffoldV2CaseNote[];
  noteFeedbackRevealedAt?: string | null;
  problemRepresentation?: string;
  reportabilityRationale?: string;
  teachingPoints?: string[];
  targetAudience?: string;
  claims?: ScaffoldV2Claim[];
}

export interface UpdateScaffoldSectionReflectionRequest {
  selectedEvidenceIds?: string[];
  selectedEvidence?: ScaffoldSelectedEvidence[];
  noRelevantEvidenceConfirmed?: boolean;
  learnerKeyInformationItems?: string[];
  learnerIdentifiedKeyInfo?: string[];
  learnerNotes?: string;
  learnerIdentifiedMissingItems?: string[];
  additionalConfirmationItems?: string[];
  teacherReviewItems?: string[];
  postAiReflection?: Omit<ScaffoldPostAiReflection, 'savedAt'>;
  draftRevealedAt?: string;
  draftReviewStatus?: ScaffoldDraftReviewStatus;
  completedAt?: string;
}

export interface LogScaffoldEventRequest {
  eventId?: string;
  eventType: ScaffoldInteractionEventType;
  sectionId?: string;
  sessionId?: string;
  participantCode?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCaseRequest {
  visits: Visit[];
  title?: string;
  mode?: CaseMode;
  experimentCode?: string;
  metadata?: any;
  skipSanitize?: boolean;
}

export interface UpdateCaseRequest {
  visits: Visit[];
  title?: string;
  mode?: CaseMode;
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

export interface Case {
  /** Publication-safe copy of `title`; the raw title is kept in `title`. */
  displayTitle?: string;
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
  chainProgress?: ChainProgressState | null;
  chainPerformanceLogs?: ChainPerformanceLog[];
  finalComposeStatus?: FinalComposeStatus;
  sectionEvidenceMap?: Record<string, string[]>;
  sectionStatusMap?: Record<string, SectionStatusInfo>;
  sectionStates?: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  commonQuestionSets?: CommonQuestionItem[];
  commonMissingItems?: string[];
  sectionDrafts?: Array<{
    sectionId: string;
    evidenceCardIdsUsed: string[];
    timelineEventIdsUsed?: string[];
    draftText: string;
    openIssues: string[];
    evidenceLinks?: SectionEvidenceLink[];
    unsupportedClaims?: UnsupportedClaim[];
  }>;
  draftsBySection?: Record<string, string>;
  scaffoldState?: ScaffoldState | null;
  researchState?: ResearchState | null;
  studyConfig?: StudyConfig | null;
  sectionsOverview?: SectionOverview[];
  evidenceCards?: Array<{
    id?: string;
    sourceText?: string;
    normalizedText?: string;
    evidenceType?: string;
    visitIndex?: number;
    visitDateTime?: string;
    tags?: string[];
    sectionHints?: string[];
    terms?: Array<{
      normalizedTerm?: string;
      category?: string;
    }>;
  }>;
  finalDraft?: FinalDraft | null;
}

export interface PHISpan {
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
}

export interface ReplacementMapItem {
  type: PHISpan['type'];
  originalText: string;
  replacement: string;
  occurrences: number;
}

export interface DeidentifiedVisitRecord {
  visitIndex: number;
  visitDate: string;
  emrId: string;
  deidentifiedText: string;
  phiSpans: PHISpan[];
  replacementMap: ReplacementMapItem[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface PendingTermCandidate {
  termId: string;
  standardTerm: string;
  confidence: number;
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
  candidates: PendingTermCandidate[];
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
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

export interface SectionEvidenceLink {
  sentence: string;
  evidenceCardIds: string[];
}

export interface UnsupportedClaim {
  sentence: string;
  reason: string;
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

export interface TimelineImportPreviewRow {
  originalRowIndex: number;
  values: Record<string, string>;
}

export interface TimelineImportResponse {
  importedRows: number;
  skippedRows: number;
  timelineEvents: TimelineEvent[];
  columnMapping: Record<string, string>;
  detectedColumns: string[];
  previewRows: TimelineImportPreviewRow[];
  warnings: Array<{
    rowIndex: number;
    reason: string;
  }>;
  draftsBySection?: Record<string, string>;
  sectionStates?: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  commonQuestionSets?: CommonQuestionItem[];
  commonMissingItems?: string[];
  sectionsOverview?: SectionOverview[];
  staleState?: StaleState | null;
  finalComposeStatus?: FinalComposeStatus;
  finalDraft?: FinalDraft | null;
}

export interface StudyWriteInspectedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  truncated: boolean;
  guessedDateColumn: number;
}

export interface StudyWriteImportedVisit {
  date: string;
  soapText: string;
}

export type StudyWriteInspectResult =
  | { kind: 'xlsx'; fileName: string; sheets: StudyWriteInspectedSheet[] }
  | {
      kind: 'docx' | 'pdf';
      fileName: string;
      text: string;
      visits: StudyWriteImportedVisit[];
      splitBy: 'full_date' | 'month_day' | 'none';
      warnings?: string[];
    };

export type StudyWriteAnswerStatus = 'pending' | 'answered' | 'skipped';

export interface StudyWriteQuestion {
  id: string;
  roundNo: number;
  order: number;
  text: string;
  source: 'fixed' | 'generated';
  targetSectionIds: string[];
  careItem?: string;
  priority: 'required' | 'optional' | 'case';
  status: StudyWriteAnswerStatus;
  answer: string;
  askedAt: string;
  answeredAt?: string;
  editHistory: Array<{ previousAnswer: string; previousStatus: StudyWriteAnswerStatus; editedAt: string }>;
}

export interface StudyWriteRound {
  roundNo: number;
  kind: 'case' | 'gap';
  questions: StudyWriteQuestion[];
  startedAt: string;
  completedAt?: string;
}

export interface StudyWriteInputSource {
  source: 'manual' | 'xlsx' | 'docx' | 'pdf';
  fileName?: string;
  visitCount: number;
}

export interface StudyWriteState {
  version: 'study-write-v1';
  inputSource?: StudyWriteInputSource | null;
  questionBudget: { maxRounds: number; perRound: number; maxTotal: number };
  rounds: StudyWriteRound[];
  interviewStartedAt?: string;
  interviewCompletedAt?: string;
  processingRequestedAt?: string;
  answersLockedAt?: string;
  submittedAt?: string;
  updatedAt: string;
}

export type StudyWriteCareItemStatus = 'present' | 'in_record_not_in_draft' | 'not_in_record' | 'not_applicable';

export interface StudyWriteCareCheck {
  checkedAt: string;
  promptVersion: string;
  items: Array<{ code: string; label: string; required: boolean; status: StudyWriteCareItemStatus; hint: string }>;
}

export interface StudyWriteDraftVersion {
  version: number;
  text: string;
  source: 'answers' | 'answers_edited' | 'revise' | 'manual';
  at: string;
  instruction?: string;
  changeSummary?: string;
  outOfRecordClaims?: string[];
  notes?: string[];
}

export interface StudyWriteChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  resultVersion?: number;
}

export interface StudyWriteAttachment {
  id: string;
  caseId: string;
  sectionId: string;
  kind: 'image' | 'table';
  fileName: string;
  mimeType: string;
  caption: string;
  size: number;
  tableRows?: string[][] | null;
  createdAt: string;
}

export interface StudyWriteSection {
  sectionId: string;
  name: string;
  draftText: string;
  version: number;
  history: StudyWriteDraftVersion[];
  chat: StudyWriteChatEntry[];
  careCheck: StudyWriteCareCheck | null;
  attachmentIds: string[];
  attachments: StudyWriteAttachment[];
  lastGeneratedAt?: string;
}

export interface StudyWriteDraftsResponse {
  caseId: string;
  experimentCode: string | null;
  generation: {
    status: 'idle' | 'running' | 'done' | 'failed';
    startedAt?: string;
    finishedAt?: string;
    targetSectionIds: string[];
    doneSectionIds: string[];
    failedSectionIds: string[];
    lastError?: string;
  };
  interview: StudyWriteState;
  answersLockedAt: string | null;
  submittedAt: string | null;
  sections: StudyWriteSection[];
}

export interface StudyWriteInterviewResponse {
  caseId: string;
  experimentCode: string | null;
  analysis: {
    ready: boolean;
    currentStep: string | null;
    completedSteps: string[];
    blocked: boolean;
    processingRequestedAt: string | null;
  };
  pendingTermCount: number;
  nextRound: { ok: boolean; reason?: string };
  interview: StudyWriteState;
}

export interface ScaffoldMemoSuggestion {
  id: string;
  visitIndex: number;
  type: ScaffoldV2CaseNoteType;
  text: string;
}

export interface ScaffoldRecordPointer {
  quotes: Array<{ visitIndex: number; quote: string }>;
  note?: string;
}

export interface ScaffoldCareElement {
  code: string;
  label: string;
  required: boolean;
  inRecord: string[];
  notInRecord: string[];
}

export interface ScaffoldStateResponse {
  careElementMap?: Record<string, ScaffoldCareElement[]>;
  memoSuggestions?: ScaffoldMemoSuggestion[];
  recordPointers?: Record<string, ScaffoldRecordPointer>;
  caseId: string;
  experiment_code?: string;
  experimentCode?: string;
  mode: CaseMode;
  title?: string;
  visits?: Visit[];
  sectionStates?: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  draftsBySection?: Record<string, string>;
  sectionDrafts?: Case['sectionDrafts'];
  sectionEvidenceMap?: Record<string, string[]>;
  evidenceCards?: Case['evidenceCards'];
  sectionsOverview?: SectionOverview[];
  commonMissingItems?: string[];
  commonQuestionSets?: CommonQuestionItem[];
  scaffoldState: ScaffoldState;
  researchState?: ResearchState | null;
  studyConfig?: StudyConfig | null;
  pendingTermConfirmations?: PendingTermConfirmation[];
  reviewRequired?: ReviewRequiredState | null;
  staleState?: StaleState | null;
  finalDraft?: FinalDraft | null;
}

export interface SectionStatusInfo {
  status: string;
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
}

export interface SectionOverview {
  section: string;
  status: string;
  rationaleText: string;
  draftSnippet: string;
}

export interface CommonQuestionItem {
  question: string;
  category?: string;
}

export interface SectionDetail {
  section: string;
  status: string;
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
  draftsBySection?: Record<string, string>;
  sectionMissingInfo?: string[];
  commonMissingInfo?: string[];
  sectionQuestions?: string[];
  commonQuestions?: CommonQuestionItem[];
  commonQnaHistory?: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  currentDraft: string;
  timelineEvents?: TimelineEvent[];
  evidence?: string[];
  evidenceCards?: Array<{
    id?: string;
    sourceText?: string;
    normalizedText?: string;
    evidenceType?: string;
    visitIndex?: number;
    visitDateTime?: string;
    tags?: string[];
  }>;
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  adequacyReview?: {
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
    unsupportedClaims?: UnsupportedClaim[];
  };
  caseSummary?: Case;
  canUndo?: boolean;
  uiHints?: SectionUiHints;
}

export interface SectionUiHints {
  stage: 'empty' | 'draft_created' | 'questions_available' | 'refined_no_questions';
  subtitle: string;
  emptyMessage: string;
  hideStartButton: boolean;
}

export interface FinalDraft {
  fullTextBySection: Record<string, string>;
  titleSuggestions: string[];
  keywordSuggestions?: string[];
  abstractSuggestion: string;
  sectionTraceability?: Record<
    string,
    {
      evidenceLinks?: SectionEvidenceLink[];
      unsupportedClaims?: UnsupportedClaim[];
    }
  >;
  careChecklistEvaluation: Record<
    string,
    {
      status: 'FULFILLED' | 'INSUFFICIENT' | 'MISSING';
      rationale: string;
    }
  >;
}

export interface FinalComposeStatus {
  status: 'IDLE' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export type ExportMode =
  | 'current_section_drafts'
  | 'final_manuscript'
  | 'final_manuscript_with_checklist'
  | 'final_manuscript_with_traceability'
  | 'scaffold_review';

export type ExportLayout = 'one_paragraph' | 'two_paragraph';

export interface ExportDocxResponse {
  blob: Blob;
  fileName: string;
}

function parseDownloadFileName(disposition: string, fallback: string): string {
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  return fallback;
}

export interface CommonQuestionResponse {
  questions: CommonQuestionItem[];
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  missingInfo: string[];
}

export interface StartStudySessionRequest {
  mode: CaseMode;
  participantCode: string;
  experimentCode?: string;
  studyCaseId?: string;
  studyMetadata?: StudyMetadata;
}

export interface StartStudySessionResponse {
  caseId: string;
  experiment_code?: string;
  experimentCode?: string;
  sessionId: string;
  mode: CaseMode;
  existing: boolean;
  processed: boolean;
}

export interface ResearchHistoryResponse {
  experimentCode: string;
  caseId: string;
  case: Partial<Case> & { id: string; createdAt: string };
  researchExport: any;
}

export interface LogResearchEventRequest {
  eventId?: string;
  eventType: ResearchEventType;
  sectionId?: string;
  sessionId?: string;
  participantCode?: string;
  metadata?: Record<string, unknown>;
}

export interface CommonAnswerSubmitResponse {
  updatedDraftsBySection: Record<string, string>;
  qnaHistory: CommonQuestionResponse['qnaHistory'];
  commonQuestions: CommonQuestionItem[];
  commonMissingInfo: string[];
  sectionStates: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  canUndo: boolean;
  staleState?: StaleState | null;
}

export interface PendingTermsResponse {
  items: PendingTermConfirmation[];
  pendingCount: number;
}

export interface PendingTermMutationResponse {
  success: boolean;
  pendingId: string;
  status: 'CONFIRMED' | 'REJECTED';
  confirmedTerm?: string;
  customReplacement?: string | null;
  blocked: boolean;
  chainProgress?: ChainProgressState | null;
  httpStatus?: 200 | 202;
  processingStarted?: boolean;
  reviewRequired?: ReviewRequiredState | null;
  pendingTermConfirmations: PendingTermConfirmation[];
  staleState?: StaleState | null;
  finalComposeStatus?: FinalComposeStatus;
  finalDraft?: FinalDraft | null;
  draftsBySection?: Record<string, string>;
  sectionsOverview?: SectionOverview[];
  sectionStates?: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  commonQuestionSets?: CommonQuestionItem[];
  commonMissingItems?: string[];
}

export type ImportedManuscriptSourceType = 'draft_reference' | 'imported_manuscript';
export type ManuscriptBlockType = 'heading' | 'paragraph' | 'table' | 'other';
export type ManuscriptReviewSectionId =
  | 'TITLE'
  | 'KEYWORDS'
  | 'ABSTRACT'
  | 'INTRODUCTION'
  | 'PATIENT_INFORMATION'
  | 'CLINICAL_FINDINGS'
  | 'TIMELINE'
  | 'DIAGNOSTIC_ASSESSMENT'
  | 'THERAPEUTIC_INTERVENTIONS'
  | 'FOLLOW_UP_OUTCOMES'
  | 'DISCUSSION_CONCLUSION'
  | 'PATIENT_PERSPECTIVE'
  | 'INFORMED_CONSENT';

export interface ImportedDocumentBlock {
  blockId: string;
  blockType: ManuscriptBlockType;
  text: string;
  headingLevel?: number;
  order: number;
}

export interface ManuscriptSectionCandidate {
  candidateId: string;
  blockIds: string[];
  headingText?: string;
  detectedText: string;
  matchedSection: ManuscriptReviewSectionId | null;
  confidence: number;
  matchBasis: 'heading' | 'keyword' | 'semantic' | 'manual' | 'fallback';
  needsUserConfirmation: boolean;
  candidateSections: ManuscriptReviewSectionId[];
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  confirmedSection?: ManuscriptReviewSectionId;
  rejectedReason?: string;
}

export interface ManuscriptSectionAssessment {
  sectionId: ManuscriptReviewSectionId;
  status: 'IMPOSSIBLE' | 'INCOMPLETE' | 'READY';
  rationaleText: string;
}

export interface ManuscriptSectionReviewResult {
  sectionId: ManuscriptReviewSectionId;
  detectedText: string;
  matchedSection: ManuscriptReviewSectionId | null;
  confidence: number;
  assessmentStatus: 'IMPOSSIBLE' | 'INCOMPLETE' | 'READY';
  adequacy: 'INSUFFICIENT' | 'BORDERLINE' | 'ADEQUATE';
  summary: string;
  missingItems: string[];
  depthIssues: string[];
  suggestedQuestions: string[];
}

export interface ManuscriptReviewRunResult {
  sectionAssessments: ManuscriptSectionAssessment[];
  sectionResults: ManuscriptSectionReviewResult[];
  commonMissingItems: Array<{
    item: string;
    relatedSectionIds: string[];
  }>;
  commonQuestionSets: Array<{
    question: string;
    targetSectionIds: string[];
  }>;
  sectionTextsBySection: Partial<Record<ManuscriptReviewSectionId, string>>;
}

export interface ManuscriptReviewDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceType: ImportedManuscriptSourceType;
  fileName: string;
  parseStatus:
    | 'PARSED'
    | 'NEEDS_SECTION_CONFIRMATION'
    | 'REVIEW_READY'
    | 'REVIEWED'
    | 'FAILED';
  rawText: string;
  rawHtml?: string;
  blocks: ImportedDocumentBlock[];
  sectionCandidates: ManuscriptSectionCandidate[];
  sectionTextsBySection: Partial<Record<ManuscriptReviewSectionId, string>>;
  reviewResults?: ManuscriptReviewRunResult | null;
  manualConfirmationRequired: boolean;
  errorMessage?: string | null;
}

export const caseApi = {
  getStudyCaseTemplate: async () => {
    const response = await api.get<{
      studyCaseId: string;
      version: string;
      title: string;
      visits: Visit[];
    }>('/cases/study/template');
    return response.data;
  },

  startStudySession: async (data: StartStudySessionRequest) => {
    const response = await api.post<StartStudySessionResponse>('/cases/study/start', data);
    return response.data;
  },

  getResearchHistoryByExperimentCode: async (experimentCode: string) => {
    const response = await api.get<ResearchHistoryResponse>(
      `/research/cases/by-experiment-code/${encodeURIComponent(experimentCode)}`
    );
    return response.data;
  },

  getAllCases: async (mode?: CaseMode) => {
    const response = await api.get<{ cases: Case[] }>('/cases', {
      params: mode ? { mode } : undefined
    });
    return response.data;
  },

  createCase: async (data: CreateCaseRequest) => {
    const response = await api.post<{ caseId: string; experiment_code?: string; experimentCode?: string }>('/cases', data);
    return response.data;
  },

  updateCase: async (caseId: string, data: UpdateCaseRequest) => {
    const response = await api.patch<{ success: boolean; caseId: string }>(`/cases/${caseId}`, data);
    return response.data;
  },

  processCase: async (caseId: string) => {
    const response = await api.post<{
      caseId: string;
      sectionsOverview?: SectionOverview[];
      cached?: boolean;
      blocked?: boolean;
      stage?: string;
      riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      reviewRequired?: ReviewRequiredState | null;
      pendingTermConfirmations?: PendingTermConfirmation[];
    }>(
      `/cases/${caseId}/process`
    );
    return response.data;
  },

  getCase: async (caseId: string) => {
    const response = await api.get<Case>(`/cases/${caseId}`);
    return response.data;
  },

  getCaseSummary: async (
    caseId: string,
    options?: {
      includeDeidentifiedEMRs?: boolean;
      includePerformanceLogs?: boolean;
      includePendingTerms?: boolean;
    }
  ) => {
    const response = await api.get<Case>(`/cases/${caseId}/summary`, {
      params: options
    });
    return response.data;
  },

  getSections: async (caseId: string) => {
    const response = await api.get<{ sections: SectionOverview[] }>(
      `/cases/${caseId}/sections`
    );
    return response.data;
  },

  getSectionDetail: async (caseId: string, sectionId: string) => {
    const response = await api.get<SectionDetail>(
      `/cases/${caseId}/sections/${sectionId}`
    );
    return response.data;
  },

  reviewSection: async (caseId: string, sectionId: string) => {
    const response = await api.post<SectionDetail>(
      `/cases/${caseId}/sections/${sectionId}/review`
    );
    return response.data;
  },

  getNextQuestion: async (caseId: string, sectionId: string, _userAnswers?: any[]) => {
    const response = await api.post<{
      nextQuestion: string | null;
      whyThisQuestion: string;
      updatedDraftText: string;
      needMore: boolean;
      remainingItems: string[];
      updatedDraftsBySection?: Record<string, string>;
      sectionQuestions?: string[];
      commonQuestions?: CommonQuestionItem[];
      sectionMissingInfo?: string[];
      commonMissingInfo?: string[];
      commonQnaHistory?: CommonQuestionResponse['qnaHistory'];
      insufficiencyReason: string | null;
      qnaHistory: any[];
      uiHints?: SectionUiHints;
    }>(`/cases/${caseId}/sections/${sectionId}/next`, {});

    const data = response.data;

    return {
      question: data.nextQuestion || '',
      sectionQuestions: data.sectionQuestions || [],
      commonQuestions: data.commonQuestions || [],
      sectionMissingInfo: data.sectionMissingInfo || [],
      commonMissingInfo: data.commonMissingInfo || [],
      updatedDraftsBySection: data.updatedDraftsBySection || {},
      commonQnaHistory: data.commonQnaHistory || [],
      context: data.whyThisQuestion,
      isComplete: !data.needMore,
      uiHints: data.uiHints
    };
  },

  submitAnswer: async (
    caseId: string,
    sectionId: string,
    answerText: string,
    question?: string
  ) => {
    const response = await api.post<{
      nextQuestion: string | null;
      whyThisQuestion: string;
      updatedDraftText: string;
      updatedDraftsBySection?: Record<string, string>;
      needMore: boolean;
      remainingItems: string[];
      sectionQuestions?: string[];
      commonQuestions?: CommonQuestionItem[];
      sectionMissingInfo?: string[];
      commonMissingInfo?: string[];
      commonQnaHistory?: CommonQuestionResponse['qnaHistory'];
      insufficiencyReason: string | null;
      qnaHistory: any[];
      lightweight?: boolean;
      uiHints?: SectionUiHints;
    }>(`/cases/${caseId}/sections/${sectionId}/next`, {
      userAnswer: answerText,
      question
    });

    const data = response.data;

    return {
      updatedDraft: data.updatedDraftText,
      updatedDraftsBySection: data.updatedDraftsBySection || {},
      isComplete: !data.needMore,
      nextQuestion: data.nextQuestion || undefined,
      sectionQuestions: data.sectionQuestions || [],
      commonQuestions: data.commonQuestions || [],
      sectionMissingInfo: data.sectionMissingInfo || [],
      commonMissingInfo: data.commonMissingInfo || [],
      commonQnaHistory: data.commonQnaHistory || [],
      qnaHistory: data.qnaHistory,
      lightweight: Boolean(data.lightweight),
      uiHints: data.uiHints
    };
  },

  updateCaseTitle: async (caseId: string, title: string) => {
    const response = await api.patch<{ success: boolean }>(
      `/cases/${caseId}/title`,
      { title }
    );
    return response.data;
  },

  updateFrontMatter: async (
    caseId: string,
    payload: { title: string; keywords: string[]; discussion?: string }
  ) => {
    const response = await api.patch<{
      success: boolean;
      title: string;
      keywords: string[];
      draftsBySection: Record<string, string>;
      sectionStates?: Array<{
        sectionId: string;
        status: string;
        rationaleText: string;
        missingInfoBullets: string[];
        recommendedQuestions: string[];
      }>;
      commonQuestionSets?: CommonQuestionItem[];
      commonMissingItems?: string[];
      sectionsOverview?: SectionOverview[];
      staleState?: StaleState | null;
      finalComposeStatus?: FinalComposeStatus;
      finalDraft?: FinalDraft | null;
    }>(`/cases/${caseId}/front-matter`, payload);
    return response.data;
  },

  deleteCase: async (caseId: string) => {
    const response = await api.delete<{ success: boolean }>(`/cases/${caseId}`);
    return response.data;
  },

  composeFinalDraft: async (
    caseId: string,
    payload?: {
      contributionAnswers?: Array<{ question: string; answer: string }>;
    }
  ) => {
    const response = await api.post<{
      caseId: string;
      started: boolean;
      finalComposeStatus: FinalComposeStatus;
      staleState?: StaleState | null;
      warning?: string | null;
    }>(
      `/cases/${caseId}/final-compose`,
      payload || {}
    );
    return response.data;
  },

  exportDocx: async (
    caseId: string,
    mode: ExportMode,
    layout: ExportLayout = 'one_paragraph'
  ): Promise<ExportDocxResponse> => {
    const response = await api.post(`/cases/${caseId}/export-docx`, { mode, layout }, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] || '');
    return {
      blob: response.data,
      fileName: parseDownloadFileName(disposition, `case_${caseId}_${mode}_${layout}.docx`)
    };
  },

  getStudyWriteInterview: async (caseId: string) => {
    const response = await api.get<StudyWriteInterviewResponse>(`/study-write/cases/${caseId}/interview`);
    return response.data;
  },

  startStudyWriteInterview: async (
    caseId: string,
    body: { processingRequested?: boolean; inputSource?: StudyWriteInputSource | null } = {}
  ) => {
    const response = await api.post<StudyWriteInterviewResponse>(`/study-write/cases/${caseId}/interview/start`, body);
    return response.data;
  },

  answerStudyWriteQuestion: async (caseId: string, body: { questionId: string; answer?: string; skipped?: boolean }) => {
    const response = await api.post<StudyWriteInterviewResponse>(`/study-write/cases/${caseId}/interview/answer`, body);
    return response.data;
  },

  nextStudyWriteRound: async (caseId: string) => {
    const response = await api.post<StudyWriteInterviewResponse & { stopReason?: string | null }>(
      `/study-write/cases/${caseId}/interview/next-round`
    );
    return response.data;
  },

  finishStudyWriteInterview: async (caseId: string) => {
    const response = await api.post<StudyWriteInterviewResponse>(`/study-write/cases/${caseId}/interview/finish`);
    return response.data;
  },

  getStudyWriteDrafts: async (caseId: string) => {
    const response = await api.get<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/drafts`);
    return response.data;
  },

  generateStudyWriteDrafts: async (caseId: string, sectionIds?: string[]) => {
    const response = await api.post<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/drafts/generate`, { sectionIds });
    return response.data;
  },

  reviseStudyWriteSection: async (caseId: string, sectionId: string, instruction: string) => {
    const response = await api.post<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/sections/${sectionId}/revise`, {
      instruction
    });
    return response.data;
  },

  saveStudyWriteSectionDraft: async (caseId: string, sectionId: string, draftText: string) => {
    const response = await api.put<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/sections/${sectionId}/draft`, { draftText });
    return response.data;
  },

  uploadStudyWriteAttachment: async (caseId: string, sectionId: string, file: File, caption: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('caption', caption);
    const response = await api.post<StudyWriteAttachment>(`/study-write/cases/${caseId}/sections/${sectionId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
  },

  updateStudyWriteAttachmentCaption: async (caseId: string, attachmentId: string, caption: string) => {
    const response = await api.put<StudyWriteAttachment>(`/study-write/cases/${caseId}/attachments/${attachmentId}`, { caption });
    return response.data;
  },

  deleteStudyWriteAttachment: async (caseId: string, attachmentId: string) => {
    const response = await api.delete<{ success: boolean }>(`/study-write/cases/${caseId}/attachments/${attachmentId}`);
    return response.data;
  },

  lockStudyWriteAnswers: async (caseId: string) => {
    const response = await api.post<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/lock-answers`);
    return response.data;
  },

  submitStudyWrite: async (caseId: string) => {
    const response = await api.post<StudyWriteDraftsResponse>(`/study-write/cases/${caseId}/submit`);
    return response.data;
  },

  studyWriteManuscriptUrl: (caseId: string) => `/api/study-write/cases/${caseId}/manuscript.docx`,

  studyWriteAttachmentFileUrl: (caseId: string, attachmentId: string) =>
    `/api/study-write/cases/${caseId}/attachments/${attachmentId}/file`,

  /** 실험용 Write: 올린 xlsx/docx 의 내용을 읽어 온다. 파일은 서버에 남지 않는다. */
  inspectStudyWriteFile: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<StudyWriteInspectResult>('/study-write/inspect', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  },

  importTimelineExcel: async (caseId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<TimelineImportResponse>(`/cases/${caseId}/timeline-import`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response.data;
  },

  getFinalComposeStatus: async (caseId: string) => {
    const response = await api.get<{
      caseId: string;
      title?: string;
      finalDraft: FinalDraft | null;
      staleState?: StaleState | null;
      finalComposeStatus: FinalComposeStatus;
    }>(`/cases/${caseId}/final-compose-status`);
    return response.data;
  },

  getPendingTerms: async (caseId: string) => {
    const response = await api.get<PendingTermsResponse>(`/cases/${caseId}/pending-terms`);
    return response.data;
  },

  confirmPendingTerm: async (caseId: string, pendingId: string, confirmedTerm?: string) => {
    const response = await api.post<PendingTermMutationResponse>(
      `/cases/${caseId}/pending-terms/${pendingId}/confirm`,
      confirmedTerm ? { confirmedTerm } : {}
    );
    return response.data;
  },

  rejectPendingTerm: async (caseId: string, pendingId: string, customReplacement?: string) => {
    const response = await api.post<PendingTermMutationResponse>(
      `/cases/${caseId}/pending-terms/${pendingId}/reject`,
      customReplacement ? { customReplacement } : {}
    );
    return response.data;
  },

  getCommonQuestions: async (caseId: string) => {
    const response = await api.get<CommonQuestionResponse>(`/cases/${caseId}/common-questions`);
    return response.data;
  },

  submitCommonAnswer: async (caseId: string, question: string, answer: string) => {
    const response = await api.post<CommonAnswerSubmitResponse>(`/cases/${caseId}/common-questions/answer`, {
      question,
      answer
    });
    return response.data;
  },

  undoLastAnswer: async (caseId: string) => {
    const response = await api.post<{
      success: boolean;
      undone?: {
        kind: 'COMMON' | 'SECTION';
        question: string;
        sectionId?: string;
      };
      remainingUndoCount: number;
      restoredInteractions?: Array<{
        sectionId: string;
        qnaHistory: Array<{
          question: string;
          answer: string;
          timestamp?: string;
        }>;
      }>;
      draftsBySection?: Record<string, string>;
      sectionStates?: Array<{
        sectionId: string;
        status: string;
        rationaleText: string;
        missingInfoBullets: string[];
        recommendedQuestions: string[];
      }>;
      commonQuestionSets?: CommonQuestionItem[];
      commonMissingItems?: string[];
      sectionsOverview?: SectionOverview[];
      staleState?: StaleState | null;
      finalComposeStatus?: FinalComposeStatus;
      finalDraft?: FinalDraft | null;
    }>(`/cases/${caseId}/undo-last-answer`);
    return response.data;
  },

  getScaffoldState: async (caseId: string) => {
    const response = await api.get<ScaffoldStateResponse>(`/cases/${caseId}/scaffold`);
    return response.data;
  },

  updateScaffoldCaseMap: async (caseId: string, data: UpdateScaffoldCaseMapRequest) => {
    const response = await api.put<{
      success: boolean;
      scaffoldState: ScaffoldState;
      caseMap: ScaffoldV2CaseMap;
    }>(`/cases/${caseId}/scaffold/case-map`, data);
    return response.data;
  },

  deleteScaffoldReviewItem: async (caseId: string, itemId: string) => {
    const response = await api.delete<{ success: boolean; scaffoldState: ScaffoldState }>(
      `/cases/${caseId}/scaffold/review-items/${encodeURIComponent(itemId)}`
    );
    return response.data;
  },

  upsertScaffoldReviewItem: async (
    caseId: string,
    itemId: string,
    data: UpsertScaffoldReviewItemRequest
  ) => {
    const response = await api.put<{
      success: boolean;
      scaffoldState: ScaffoldState;
      reviewItem: ScaffoldReviewItem;
    }>(`/cases/${caseId}/scaffold/review-items/${itemId}`, data);
    return response.data;
  },

  updateScaffoldSectionProgress: async (
    caseId: string,
    sectionId: string,
    data: UpdateScaffoldSectionProgressRequest
  ) => {
    const response = await api.put<{
      success: boolean;
      scaffoldState: ScaffoldState;
      progress: ScaffoldSectionProgress;
    }>(`/cases/${caseId}/scaffold/sections/${sectionId}/progress`, data);
    return response.data;
  },

  updateScaffoldSession: async (caseId: string, data: UpdateScaffoldSessionRequest) => {
    const response = await api.put<{
      success: boolean;
      scaffoldState: ScaffoldState;
    }>(`/cases/${caseId}/scaffold/session`, data);
    return response.data;
  },

  updateScaffoldSectionReflection: async (
    caseId: string,
    sectionId: string,
    data: UpdateScaffoldSectionReflectionRequest
  ) => {
    const response = await api.put<{
      success: boolean;
      scaffoldState: ScaffoldState;
      reflection: ScaffoldSectionReflection;
    }>(`/cases/${caseId}/scaffold/sections/${sectionId}/reflection`, data);
    return response.data;
  },

  logScaffoldEvent: async (caseId: string, data: LogScaffoldEventRequest) => {
    const response = await api.post<{
      success: boolean;
      scaffoldState: ScaffoldState;
      event: ScaffoldInteractionEvent;
    }>(`/cases/${caseId}/scaffold/events`, data);
    return response.data;
  },

  updateResearchSession: async (
    caseId: string,
    data: { sessionId: string; participantCode?: string; studyMetadata?: StudyMetadata }
  ) => {
    const response = await api.put<{
      success: boolean;
      researchState: ResearchState;
    }>(`/cases/${caseId}/research/session`, data);
    return response.data;
  },

  updateResearchMetadata: async (
    caseId: string,
    data: {
      studyMetadata?: StudyMetadata | null;
      caseInputValidation?: Partial<CaseInputValidation> | null;
      sessionOutcome?: SessionOutcome | null;
      appendResearcherAssistance?: Partial<ResearcherAssistanceEntry>;
      appendTechnicalIssue?: Partial<TechnicalIssueEntry>;
    }
  ) => {
    const response = await api.put<{
      success: boolean;
      studyMetadata?: StudyMetadata | null;
      caseInputValidation?: CaseInputValidation | null;
      sessionOutcome?: SessionOutcome | null;
      researcherAssistance?: ResearcherAssistanceEntry[];
      technicalIssues?: TechnicalIssueEntry[];
    }>(`/cases/${caseId}/research/metadata`, data);
    return response.data;
  },

  logResearchEvent: async (caseId: string, data: LogResearchEventRequest) => {
    const response = await api.post<{
      success: boolean;
      researchState: ResearchState;
    }>(`/cases/${caseId}/research/events`, data);
    return response.data;
  },

  exportResearchData: async (caseId: string, format: 'json' | 'csv' = 'json') => {
    if (format === 'csv') {
      const response = await api.get(`/cases/${caseId}/research/export`, {
        params: { format: 'csv' },
        responseType: 'blob'
      });
      const disposition = String(response.headers['content-disposition'] || '');
      return {
        blob: response.data as Blob,
        fileName: parseDownloadFileName(disposition, `case_${caseId}_research.csv`)
      };
    }

    const response = await api.get(`/cases/${caseId}/research/export`, {
      params: { format: 'json' }
    });
    return response.data;
  }
};

export const manuscriptReviewApi = {
  importDocx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post<{
      reviewId: string;
      review: ManuscriptReviewDocument;
    }>('/manuscript-review/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });

    return response.data;
  },

  getReview: async (reviewId: string) => {
    const response = await api.get<ManuscriptReviewDocument>(`/manuscript-review/${reviewId}`);
    return response.data;
  },

  runReview: async (reviewId: string) => {
    const response = await api.post<{
      reviewId: string;
      review: ManuscriptReviewDocument;
    }>(`/manuscript-review/${reviewId}/run-review`);
    return response.data;
  },

  confirmSectionCandidate: async (
    reviewId: string,
    candidateId: string,
    sectionId: ManuscriptReviewSectionId
  ) => {
    const response = await api.post<{
      reviewId: string;
      review: ManuscriptReviewDocument;
    }>(`/manuscript-review/${reviewId}/sections/${candidateId}/confirm`, {
      sectionId
    });
    return response.data;
  },

  rejectSectionCandidate: async (reviewId: string, candidateId: string) => {
    const response = await api.post<{
      reviewId: string;
      review: ManuscriptReviewDocument;
    }>(`/manuscript-review/${reviewId}/sections/${candidateId}/reject`);
    return response.data;
  }
};
