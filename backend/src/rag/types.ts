import { z } from 'zod';
import { CareSectionCoerced, CareSectionEnum } from '../llm/schemas/common';

export const TermCategoryEnum = z.enum([
  'herbal_prescription',
  'acupuncture_point',
  'treatment',
  'symptom',
  'diagnosis',
  'questionnaire',
  'imaging',
  'lab',
  'psychosocial',
  'adverse_event',
  'sleep_pattern',
  'timeline_marker',
  'medication',
  'other'
]);

export const UsagePolicyEnum = z.enum(['NORMALIZATION_ONLY', 'DRAFT_ALLOWED']);
export const NormalizationPolicyEnum = z.enum([
  'AUTO_NORMALIZE',
  'REQUIRE_CONFIRMATION',
  'PRESERVE_ORIGINAL'
]);
export const EvidenceUsageEnum = z.enum(['ALLOWED', 'WARNING', 'RESTRICTED']);
export const TermRiskLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const TermDbEntrySchema = z.object({
  termId: z.string().min(1),
  standardTerm: z.string().min(1),
  category: TermCategoryEnum,
  synonyms: z.array(z.string()).default([]),
  typoVariants: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
  semanticTags: z.array(z.string()).default([]),
  relatedTerms: z.array(z.string()).default([]),
  sectionHints: z.array(CareSectionCoerced).default([]),
  confidenceThreshold: z.number().min(0).max(1).default(0.85),
  usagePolicy: UsagePolicyEnum.default('DRAFT_ALLOWED'),
  normalizationPolicy: NormalizationPolicyEnum.default('AUTO_NORMALIZE'),
  evidenceUsage: EvidenceUsageEnum.default('ALLOWED'),
  riskLevel: TermRiskLevelEnum.default('LOW'),
  expectedPatterns: z.array(z.string()).default([]),
  exampleContexts: z.array(z.string()).default([]),
  preserveSurfaceForm: z.boolean().default(false),
  reviewerNote: z.string().default(''),
  source: z.string().nullable().optional(),
  version: z.string().nullable().optional()
});

export const TermNormalizationCandidateSchema = z.object({
  termId: z.string().min(1),
  standardTerm: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export const TermNormalizationResultSchema = z.object({
  surface: z.string(),
  normalizedTerm: z.string(),
  termId: z.string(),
  category: TermCategoryEnum,
  matchType: z.enum(['exact', 'synonym', 'typo', 'alias', 'fuzzy', 'partial', 'semantic']),
  confidence: z.number().min(0).max(1),
  needsUserConfirmation: z.boolean(),
  semanticTags: z.array(z.string()).default([]),
  relatedTerms: z.array(z.string()).default([]),
  normalizationPolicy: NormalizationPolicyEnum.default('AUTO_NORMALIZE'),
  evidenceUsage: EvidenceUsageEnum.default('ALLOWED'),
  riskLevel: TermRiskLevelEnum.default('LOW'),
  preserveSurfaceForm: z.boolean().default(false),
  usagePolicy: UsagePolicyEnum.default('DRAFT_ALLOWED'),
  reviewerNote: z.string().default(''),
  candidates: z.array(TermNormalizationCandidateSchema).optional()
});

export type TermCategory = z.infer<typeof TermCategoryEnum>;
export type UsagePolicy = z.infer<typeof UsagePolicyEnum>;
export type NormalizationPolicy = z.infer<typeof NormalizationPolicyEnum>;
export type EvidenceUsage = z.infer<typeof EvidenceUsageEnum>;
export type TermRiskLevel = z.infer<typeof TermRiskLevelEnum>;
export type TermDbEntry = z.infer<typeof TermDbEntrySchema>;
export type TermNormalizationCandidate = z.infer<typeof TermNormalizationCandidateSchema>;
export type TermNormalizationResult = z.infer<typeof TermNormalizationResultSchema>;

export type MatchVariantType = 'standard' | 'synonym' | 'typo' | 'alias';
export type TermMatchType = 'exact' | 'synonym' | 'typo' | 'alias' | 'fuzzy' | 'partial' | 'semantic';

export interface SemanticMatchCandidate {
  termId: string;
  standardTerm: string;
  confidence: number;
}

export interface SemanticMatchProvider {
  search(
    surface: string,
    entries: TermDbEntry[]
  ): Promise<SemanticMatchCandidate[]> | SemanticMatchCandidate[];
}

export interface RetrievedTermCandidate {
  termId: string;
  original: string;
  standardTerm: string;
  score: number;
  matchType: TermMatchType;
  variant: string;
  variantType?: MatchVariantType | 'semantic';
  term: TermDbEntry;
}

export interface TerminologyResolverDecision {
  decision: 'USE_CANDIDATE' | 'ASK_USER' | 'KEEP_ORIGINAL';
  selectedTermId?: string;
  confidence: number;
  reason: string;
}

export interface NormalizeTextResult {
  normalizedText: string;
  terms: TermNormalizationResult[];
  sectionHints: Array<z.infer<typeof CareSectionEnum>>;
}
