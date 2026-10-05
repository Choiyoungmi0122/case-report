import { CareSection } from './index';

export type ScaffoldReviewSourceType =
  | 'missing_info'
  | 'recommended_question'
  | 'depth_issue'
  | 'unsupported_claim'
  | 'draft_sentence'
  | 'custom';

// 사용자가 기록/누락정보를 판단할 때 사용
export type InformationStatusJudgment =
  | 'available_in_record'           // 기록에서 확인 가능
  | 'needs_additional_confirmation' // 추가 확인 필요
  | 'needs_instructor_review'       // 교수자/전문가 검토 필요
  | 'unavailable'                   // 현재 자료로 확인 불가
  | 'pending';                       // 판단 보류 (임시)

// AI 초안을 검토할 때 사용
export type DraftJudgment =
  | 'pending'
  | 'supported_by_record'           // 기록 근거 충분
  | 'differs_from_record'           // 기록과 다름
  | 'want_to_add'                   // 내 초안에 더하고 싶음
  | 'needs_additional_confirmation' // 추가 확인 필요
  | 'needs_instructor_review'       // 교수자/전문가 검토 필요
  | 'uncertain';                     // 판단하기 어려움

// 통합 타입 (backward compatibility)
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
  sectionId: CareSection;
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
  sectionId: CareSection;
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
  /** AI 초안에 빠졌다고 학습자가 적은 내용. */
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
  sectionId: CareSection;
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
    | 'answered'                       // 기록을 근거로 답변 가능
    | 'needs_additional_confirmation'  // 추가 확인 필요
    | 'needs_instructor_review'        // 교수자/전문가 검토 필요
    | 'unavailable';                   // 현재 정보로 확인 불가
  answerText?: string;  // status='answered'일 때만 채움
  updatedAt: string;
}

export interface ScaffoldPreRevealSnapshot {
  sectionId: CareSection;
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
  targetSectionIds: CareSection[];
  confidence: ScaffoldV2ClaimConfidence;
  missingInformation?: string;
}

/**
 * A case-level learner model shared by every CARE section.
 * Sections consume this map later; they do not own or duplicate its evidence.
 */
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
  // Session level
  | 'session_start'
  | 'session_completed'
  // Case level
  | 'case_created'
  | 'mode_selected'
  // Section level - 단계별
  | 'section_opened'
  | 'section_purpose_viewed'
  | 'learner_reflection_started'
  | 'learner_reflection_saved'
  | 'record_review_started'
  | 'record_review_completed'
  | 'evidence_opened'
  | 'case_map_saved'
  | 'workflow_phase_changed'
  | 'claim_map_saved'
  | 'information_status_judgment_saved'
  | 'question_task_responded'
  | 'pre_reveal_snapshot_created'
  | 'ai_draft_revealed'
  | 'post_ai_review_started'
  | 'draft_judgment_saved'
  | 'post_ai_reflection_saved'
  | 'draft_review_completed'
  | 'section_completed'
  // Summary
  | 'final_summary_viewed'
  | 'export_requested';

export interface ScaffoldInteractionEvent {
  eventId?: string;
  sequenceIndex?: number;
  eventType: ScaffoldInteractionEventType;
  timestamp: string;
  caseId: string;
  mode: 'scaffold';
  sectionId?: CareSection;
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
