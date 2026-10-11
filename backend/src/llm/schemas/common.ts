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
  follow_up_outcome: 'FOLLOW_UP_OUTCOMES',
  patient_info: 'PATIENT_INFORMATION',
  diagnostic: 'DIAGNOSTIC_ASSESSMENT',
  diagnosis: 'DIAGNOSTIC_ASSESSMENT',
  treatment: 'THERAPEUTIC_INTERVENTIONS',
  follow_up: 'FOLLOW_UP_OUTCOMES',
  followup: 'FOLLOW_UP_OUTCOMES',
  discussion: 'DISCUSSION_CONCLUSION',
  conclusion: 'DISCUSSION_CONCLUSION',
  consent: 'INFORMED_CONSENT'
};

export function coerceCareSection(raw: unknown): CareSection | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const direct = CareSectionEnum.safeParse(s);
  if (direct.success) return direct.data;
  // "Therapeutic Interventions", "follow-up_outcomes" → FOLLOW_UP_OUTCOMES
  const normalized = s.replace(/[\s\-]+/g, '_').replace(/_+/g, '_').toLowerCase();
  const alias = CARE_SECTION_ALIASES[normalized];
  if (alias) return alias;
  const upper = CareSectionEnum.safeParse(normalized.toUpperCase());
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

/**
 * 모델이 낸 섹션 id 목록(relatedSectionIds, targetSectionIds). 변형은 정규화하고 알아볼 수 없는 값은 버린다.
 * 목록 하나의 오타로 응답 전체가 실패하지 않게 한다.
 */
export const CareSectionListCoerced = z
  .array(z.unknown())
  .default([])
  .transform((items) => {
    const out: CareSection[] = [];
    for (const item of items) {
      const section = coerceCareSection(item);
      if (section && !out.includes(section)) out.push(section);
    }
    return out;
  });
