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
  createdAt: string;
  title?: string;
  visits: Visit[];
  processingCache?: {
    inputHash: string;
    processedAt: string;
  };
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
  }>;
  commonQuestionSets?: Array<{
    question: string;
    targetSectionIds: CareSection[];
  }>;
  answerUndoStack?: AnswerUndoEntry[];
  sectionDrafts?: Array<{
    sectionId: CareSection;
    evidenceCardIdsUsed: string[];
    draftText: string;
    openIssues: string[];
  }>;
  sectionAdequacyReviews?: Partial<Record<CareSection, SectionAdequacyReviewSnapshot>>;
  finalDraft?: any;
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
  summary: string;
  missingRequiredItems: string[];
  depthIssues: string[];
  shouldAskMore: boolean;
  questionFocus: string;
  reviewedAt: string;
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
