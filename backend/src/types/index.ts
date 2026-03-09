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
  PARTIAL_IMPOSSIBLE = 'PARTIAL_IMPOSSIBLE',
  PARTIAL_POSSIBLE = 'PARTIAL_POSSIBLE',
  POSSIBLE = 'POSSIBLE',
  FULLY_POSSIBLE = 'FULLY_POSSIBLE'
}

export interface Visit {
  index: number;
  type: VisitType;
  date: string; // ISO date string
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
  sectionEvidenceMap?: Record<CareSection, string[]>;
  sectionStatusMap?: Record<CareSection, SectionStatusInfo>;
  draftsBySection?: Record<CareSection, string>;
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
