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
  /** "추가 작성" 섹션(AI 비교 단계 없음)에 글을 저장해 끝낸 경우 (2026-10-12, utils/scaffoldProgress.ts) */
  authoringCompleted?: boolean;
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
    /** 판단 이유(선택 입력). Scaffold V2부터 기록된다. */
    note?: string;
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

/**
 * 메모 분류. 'literature'(문헌 확인 필요)는 2026-10-12 V2 에 추가했다. 선행연구·다른 증례보고를 찾아봐야 할 것으로,
 * 나중에 서론·고찰에 쓴다. V1 메모에는 없다.
 */
export type ScaffoldV2CaseNoteType = 'observation' | 'question' | 'literature';

export type ScaffoldV2CaseNoteOrigin = 'own' | 'ai_suggestion';

export interface ScaffoldV2CaseNote {
  id: string;
  type: ScaffoldV2CaseNoteType;
  text: string;
  sourceEvidenceIds: string[];
  createdAt: string;
  /**
   * Scaffold V2(v3.0)에서 추가된 필드. V1 기록에는 없으며, 없는 값은 유추해 채우지 않는다.
   * visitIndex는 1부터 시작하는 방문 회차. 출처가 불확실하면 비워 둔다.
   */
  visitIndex?: number;
  /** CARE 세부 항목 코드(9a, 9b, 9c …) 또는 치료 유형 분류 라벨. */
  careItems?: string[];
  /** 직접 쓴 메모인지 AI 추천에서 채택한 메모인지. V1 기록은 id 접두어로만 구분된다. */
  origin?: ScaffoldV2CaseNoteOrigin;
  /** origin이 ai_suggestion일 때 추천 id. */
  suggestionId?: string;
  updatedAt?: string;
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
  | 'export_requested'
  // 화면에서의 세부 행동(멈춤, 문장 표시, 초안 편집 등). 종류는 metadata.kind에 둔다.
  | 'ui_action';

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
