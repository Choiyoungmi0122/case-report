import { z } from 'zod';
import { CareSection, CareSectionEnum, coerceCareSection } from './common';
import { SectionEvidenceLinkSchema, UnsupportedClaimSchema } from './chain3_draft';

// 파일명은 역사적 이유로 chain5_final 이지만 CHAIN7(최종 원고 구성)의 스키마다.

export const FinalDraftSectionEnum = z.enum([...CareSectionEnum.options, 'KEYWORDS']);
export type FinalDraftSection = z.infer<typeof FinalDraftSectionEnum>;

function coerceFinalDraftSection(raw: string): FinalDraftSection | undefined {
  if (raw.trim().toUpperCase() === 'KEYWORDS') return 'KEYWORDS';
  return coerceCareSection(raw);
}

function trimmedList(max: number) {
  return z
    .array(z.unknown())
    .default([])
    .transform((items) =>
      Array.from(new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))).slice(0, max)
    );
}

const ChecklistEntrySchema = z.object({
  status: z.enum(['FULFILLED', 'INSUFFICIENT', 'MISSING']),
  rationale: z.string().default('')
});

/**
 * 모델이 실제로 내는 필드 (chain7_final.ts 프롬프트의 출력 형식과 같다).
 *  - 섹션 키는 변형을 허용하고 알아볼 수 없는 키는 버린다.
 *  - 제목 후보는 최대 3개, 핵심어는 최대 7개로 잘라낸다(이전에는 min(1)+default([]) 이 모순이었고 초과분이 검증 실패였다).
 *  - sectionTraceability 는 모델이 내지 않는다. `chains.ts` 가 섹션 초안의 휴리스틱 근거 연결을 모아 덧붙인다.
 */
export const FinalDraftModelOutputSchema = z.object({
  fullTextBySection: z
    .record(z.string(), z.string().nullable())
    .default({})
    .transform((obj) => {
      const out: Partial<Record<FinalDraftSection, string>> = {};
      for (const [key, value] of Object.entries(obj)) {
        const section = coerceFinalDraftSection(key);
        if (section) out[section] = String(value ?? '');
      }
      return out;
    }),
  titleSuggestions: trimmedList(3),
  keywordSuggestions: trimmedList(7),
  abstractSuggestion: z.string().default(''),
  careChecklistEvaluation: z
    .record(z.string(), ChecklistEntrySchema)
    .default({})
    .transform((obj) => {
      const out: Partial<Record<CareSection, z.infer<typeof ChecklistEntrySchema>>> = {};
      for (const [key, value] of Object.entries(obj)) {
        const section = coerceCareSection(key);
        if (section) out[section] = value;
      }
      return out;
    })
});

export type FinalDraftModelOutput = z.infer<typeof FinalDraftModelOutputSchema>;

/** 저장되는 최종 원고. */
export const FinalDraftSchema = z.object({
  fullTextBySection: z.record(FinalDraftSectionEnum, z.string()),
  titleSuggestions: z.array(z.string()).default([]),
  keywordSuggestions: z.array(z.string()).default([]),
  abstractSuggestion: z.string(),
  /** 섹션 초안의 휴리스틱 근거 연결(문자 2-gram 일치)을 모은 것. 모델이 명시한 인용이 아니다. */
  sectionTraceability: z
    .record(
      CareSectionEnum,
      z.object({
        evidenceLinks: z.array(SectionEvidenceLinkSchema).default([]),
        unsupportedClaims: z.array(UnsupportedClaimSchema).default([])
      })
    )
    .default({} as Record<string, { evidenceLinks: Array<{ sentence: string; evidenceCardIds: string[] }>; unsupportedClaims: Array<{ sentence: string; reason: string }> }>),
  careChecklistEvaluation: z.record(CareSectionEnum, ChecklistEntrySchema)
});

export type FinalDraft = z.infer<typeof FinalDraftSchema>;
