import { CareSection, SectionStatus } from '../types';

export type ImportedManuscriptSourceType = 'draft_reference' | 'imported_manuscript';
export type ManuscriptBlockType = 'heading' | 'paragraph' | 'table' | 'other';
export type ManuscriptReviewSectionId = `${CareSection}` | 'KEYWORDS';
export type ManuscriptReviewStatus =
  | 'PARSED'
  | 'NEEDS_SECTION_CONFIRMATION'
  | 'REVIEW_READY'
  | 'REVIEWED'
  | 'FAILED';
export type ManuscriptSectionCandidateStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type ManuscriptMatchBasis = 'heading' | 'keyword' | 'semantic' | 'manual' | 'fallback';

export const MANUSCRIPT_REVIEW_SECTION_IDS: ManuscriptReviewSectionId[] = [
  'TITLE',
  'KEYWORDS',
  'ABSTRACT',
  'INTRODUCTION',
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT'
];

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
  matchBasis: ManuscriptMatchBasis;
  needsUserConfirmation: boolean;
  candidateSections: ManuscriptReviewSectionId[];
  status: ManuscriptSectionCandidateStatus;
  confirmedSection?: ManuscriptReviewSectionId;
  rejectedReason?: string;
}

export interface ManuscriptSectionAssessment {
  sectionId: ManuscriptReviewSectionId;
  status: SectionStatus;
  rationaleText: string;
}

export interface ManuscriptSectionReviewResult {
  sectionId: ManuscriptReviewSectionId;
  detectedText: string;
  matchedSection: ManuscriptReviewSectionId | null;
  confidence: number;
  assessmentStatus: SectionStatus;
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
  commonQuestionSets: Array<{
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
  sectionTextsBySection: Partial<Record<ManuscriptReviewSectionId, string>>;
}

export interface ManuscriptReviewDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceType: ImportedManuscriptSourceType;
  fileName: string;
  parseStatus: ManuscriptReviewStatus;
  rawText: string;
  rawHtml?: string;
  blocks: ImportedDocumentBlock[];
  sectionCandidates: ManuscriptSectionCandidate[];
  sectionTextsBySection: Partial<Record<ManuscriptReviewSectionId, string>>;
  reviewResults?: ManuscriptReviewRunResult | null;
  manualConfirmationRequired: boolean;
  errorMessage?: string | null;
}
