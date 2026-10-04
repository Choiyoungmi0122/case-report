import { z } from 'zod';
import { CareSectionEnum } from './common';

// A section the record cannot support at all (e.g. PATIENT_PERSPECTIVE with no
// patient statement recorded) makes the model answer NOT_APPLICABLE / N/A.
// Treat that as INSUFFICIENT rather than failing validation - an unparsable
// review used to bubble up as a 500 and made the section unreachable.
const adequacyStatusAliases = {
  INADEQUATE: 'INSUFFICIENT',
  NOT_APPLICABLE: 'INSUFFICIENT',
  'N/A': 'INSUFFICIENT',
  NONE: 'INSUFFICIENT'
} as const;

const reviewScoreAliases = {
  NONE: 'LOW',
  NOT_APPLICABLE: 'LOW',
  'N/A': 'LOW'
} as const;

const CanonicalSectionAdequacyStatusEnum = z.enum(['INSUFFICIENT', 'BORDERLINE', 'ADEQUATE']);
const CanonicalReviewScoreEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);
type SectionAdequacyStatus = z.infer<typeof CanonicalSectionAdequacyStatusEnum>;
type ReviewScore = z.infer<typeof CanonicalReviewScoreEnum>;

export const SectionAdequacyStatusEnum = z
  .union([
    CanonicalSectionAdequacyStatusEnum,
    z.literal('INADEQUATE'),
    z.literal('NOT_APPLICABLE'),
    z.literal('N/A'),
    z.literal('NONE')
  ])
  .transform(
    (value): SectionAdequacyStatus => adequacyStatusAliases[value as keyof typeof adequacyStatusAliases] || value
  );

export const ReviewScoreEnum = z
  .union([CanonicalReviewScoreEnum, z.literal('NONE'), z.literal('NOT_APPLICABLE'), z.literal('N/A')])
  .transform((value): ReviewScore => reviewScoreAliases[value as keyof typeof reviewScoreAliases] || value);
export const EvidenceGroundingEnum = z.enum([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED_OR_UNVERIFIABLE'
]);

export type SectionAdequacyReviewOutput = {
  sectionId: z.infer<typeof CareSectionEnum>;
  adequacyStatus: SectionAdequacyStatus;
  sectionCompleteness: ReviewScore;
  contentCompleteness: ReviewScore;
  naturalness: ReviewScore;
  evidenceGrounding: z.infer<typeof EvidenceGroundingEnum>;
  summary: string;
  missingRequiredItems: string[];
  depthIssues: string[];
  shouldAskMore: boolean;
  questionFocus: string;
};

export const SectionAdequacyReviewOutputSchema: z.ZodType<SectionAdequacyReviewOutput, z.ZodTypeDef, unknown> =
  z.object({
    sectionId: CareSectionEnum,
    adequacyStatus: SectionAdequacyStatusEnum,
    sectionCompleteness: ReviewScoreEnum,
    contentCompleteness: ReviewScoreEnum,
    naturalness: ReviewScoreEnum,
    evidenceGrounding: EvidenceGroundingEnum,
    summary: z.string(),
    missingRequiredItems: z.array(z.string()),
    depthIssues: z.array(z.string()),
    shouldAskMore: z.boolean(),
    questionFocus: z.string()
  });
