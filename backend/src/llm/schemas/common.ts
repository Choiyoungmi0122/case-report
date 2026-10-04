import { z } from 'zod';

export const CareSectionEnum = z.enum([
  'TITLE',
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
]);

export type CareSection = z.infer<typeof CareSectionEnum>;

/** Maps snake_case / singular labels (often mixed up with evidenceType) to CARE section ids. */
const CARE_SECTION_ALIASES: Record<string, CareSection> = {
  clinical_finding: 'CLINICAL_FINDINGS',
  therapeutic_intervention: 'THERAPEUTIC_INTERVENTIONS',
  follow_up_outcome: 'FOLLOW_UP_OUTCOMES'
};

export function coerceCareSection(raw: unknown): CareSection | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const direct = CareSectionEnum.safeParse(s);
  if (direct.success) return direct.data;
  const alias = CARE_SECTION_ALIASES[s.toLowerCase()];
  if (alias) return alias;
  const upper = CareSectionEnum.safeParse(s.toUpperCase());
  if (upper.success) return upper.data;
  return undefined;
}

/** Accepts canonical CARE ids plus snake_case / common LLM variants; use for model-parsed fields. */
export const CareSectionCoerced = z.union([
  CareSectionEnum,
  z
    .string()
    .transform((s) => coerceCareSection(s) ?? s)
    .pipe(CareSectionEnum)
]);

/**
 * Tolerant list for advisory CARE-section fields such as `sectionHints`.
 *
 * A hint the model invents outside the enum used to fail validation and, after
 * the retries, surface as a 500 that left the whole case unprocessable. Hints
 * are advisory and `uniqueSections()` already discards anything that is not a
 * real CARE section, so the schema only has to stop rejecting the response.
 * Authoritative fields keep using the strict `CareSectionCoerced`.
 */
export const CareSectionHintList = z.array(z.string()).default([]);

