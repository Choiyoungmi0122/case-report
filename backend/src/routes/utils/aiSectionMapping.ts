import { CareSection } from '../../types';

type JsonObj = Record<string, any>;

export type AiDraft = {
  patient_information: JsonObj;
  clinical_findings: JsonObj;
  timeline: JsonObj[];
  diagnostic_assessment: JsonObj;
  therapeutic_intervention: JsonObj;
  follow_up_outcomes: JsonObj;
  patient_perspective: any;
};

export const CARE_TO_AI_FIELD: Partial<Record<CareSection, keyof AiDraft>> = {
  [CareSection.PATIENT_INFORMATION]: 'patient_information',
  [CareSection.CLINICAL_FINDINGS]: 'clinical_findings',
  [CareSection.TIMELINE]: 'timeline',
  [CareSection.DIAGNOSTIC_ASSESSMENT]: 'diagnostic_assessment',
  [CareSection.THERAPEUTIC_INTERVENTIONS]: 'therapeutic_intervention',
  [CareSection.FOLLOW_UP_OUTCOMES]: 'follow_up_outcomes',
  [CareSection.PATIENT_PERSPECTIVE]: 'patient_perspective'
};

const SECTION_KEYWORDS: Record<CareSection, string[]> = {
  [CareSection.TITLE]: ['title', '제목'],
  [CareSection.ABSTRACT]: ['abstract', '요약'],
  [CareSection.INTRODUCTION]: ['introduction', '서론'],
  [CareSection.PATIENT_INFORMATION]: ['patient information', 'patient_information', '환자 정보', '인구학적'],
  [CareSection.CLINICAL_FINDINGS]: ['clinical findings', 'clinical_findings', '임상 소견', '진찰', '설진', '맥진'],
  [CareSection.TIMELINE]: ['timeline', '타임라인', '경과', '방문'],
  [CareSection.DIAGNOSTIC_ASSESSMENT]: ['diagnostic assessment', 'diagnostic_assessment', '진단 평가', '진단'],
  [CareSection.THERAPEUTIC_INTERVENTIONS]: ['therapeutic intervention', 'therapeutic_intervention', '치료 중재', '치료'],
  [CareSection.FOLLOW_UP_OUTCOMES]: ['follow up', 'follow_up_outcomes', '추적', '경과'],
  [CareSection.DISCUSSION_CONCLUSION]: ['discussion', 'conclusion', '토론', '결론'],
  [CareSection.PATIENT_PERSPECTIVE]: ['patient perspective', 'patient_perspective', '환자 관점'],
  [CareSection.INFORMED_CONSENT]: ['informed consent', 'informed_consent', '동의']
};

const SECTION_CONTENT_KEYWORDS: Record<CareSection, string[]> = {
  [CareSection.TITLE]: ['제목', 'title'],
  [CareSection.ABSTRACT]: ['요약', 'abstract'],
  [CareSection.INTRODUCTION]: ['서론', 'introduction', '배경', 'background'],
  [CareSection.PATIENT_INFORMATION]: [
    '직업', 'occupation', '가족력', 'family history', 'family_history', '과거력', 'medical history',
    '약물력', 'medication history', 'present illness', '현병력', '나이', '연령', '성별', '주호소',
    'chief complaint', '사회력', 'psychosocial', '스트레스 요인'
  ],
  [CareSection.CLINICAL_FINDINGS]: [
    '임상 소견', 'clinical findings', '증상', 'symptom', '수면', 'sleep', '정서', 'emotion', '불안',
    '우울', '억울', '진찰', '검진', '신체 소견', '설진', '맥진', 'tongue', 'pulse', 'findings'
  ],
  [CareSection.TIMELINE]: [
    '타임라인', 'timeline', '경과', '방문', 'visit', '시점', '언제', 'onset', '발병', '날짜', 'date'
  ],
  [CareSection.DIAGNOSTIC_ASSESSMENT]: [
    '진단', 'diagnostic', 'assessment', '감별', 'differential', '평가', '검사', '진단 기준',
    '진단 방법', '진단 근거'
  ],
  [CareSection.THERAPEUTIC_INTERVENTIONS]: [
    '치료', 'treatment', 'intervention', '중재', 'acupuncture', '침치료', '약물', '처치', '혈위',
    'frequency', '빈도', 'duration', '기간', '순응도', 'adherence'
  ],
  [CareSection.FOLLOW_UP_OUTCOMES]: [
    '추적', 'follow-up', 'follow up', 'outcome', '결과', '반응', '호전', '악화', 'adverse', '이상반응',
    '부작용', '추적 기간', 'treatment response'
  ],
  [CareSection.DISCUSSION_CONCLUSION]: ['토론', 'discussion', 'conclusion', '시사점', '의의'],
  [CareSection.PATIENT_PERSPECTIVE]: [
    '환자 관점', 'patient perspective', 'reported experience', 'reported_experiences', '체감', '느낌',
    'felt', 'perceived', '만족도', '주관적 경험'
  ],
  [CareSection.INFORMED_CONSENT]: ['동의', 'consent', 'informed consent']
};

export type ItemScope = 'section' | 'cross-section' | 'global';
export type ScopedItem = {
  text: string;
  primary_section: CareSection | null;
  related_sections: CareSection[];
  scope: ItemScope;
};

function normalizeText(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildAiDraftFromSectionDrafts(sectionDrafts: any[]): AiDraft {
  const draftMap = new Map<string, string>();
  for (const item of sectionDrafts || []) {
    if (item && typeof item.sectionId === 'string') {
      draftMap.set(item.sectionId, typeof item.draftText === 'string' ? item.draftText : '');
    }
  }

  const timelineText = draftMap.get(CareSection.TIMELINE) || '';

  return {
    patient_information: { text: draftMap.get(CareSection.PATIENT_INFORMATION) || '' },
    clinical_findings: { text: draftMap.get(CareSection.CLINICAL_FINDINGS) || '' },
    timeline: timelineText ? [{ text: timelineText }] : [],
    diagnostic_assessment: { text: draftMap.get(CareSection.DIAGNOSTIC_ASSESSMENT) || '' },
    therapeutic_intervention: { text: draftMap.get(CareSection.THERAPEUTIC_INTERVENTIONS) || '' },
    follow_up_outcomes: { text: draftMap.get(CareSection.FOLLOW_UP_OUTCOMES) || '' },
    patient_perspective: draftMap.get(CareSection.PATIENT_PERSPECTIVE) || ''
  };
}

export function extractSectionDraftTextFromAiDraft(aiDraft: AiDraft | any, sectionId: CareSection): string {
  const mappedField = CARE_TO_AI_FIELD[sectionId];
  if (!mappedField) return '';

  const value = aiDraft?.[mappedField];
  if (mappedField === 'timeline') {
    if (!Array.isArray(value)) return '';
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.text === 'string') return item.text;
        return normalizeText(item);
      })
      .filter(Boolean)
      .join('\n');
  }

  if (mappedField === 'patient_perspective') {
    return normalizeText(value);
  }

  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text;
  }
  return normalizeText(value);
}

function pickBySection(items: string[], sectionId: CareSection): string[] {
  if (!items?.length) return [];
  const keywords = [...SECTION_KEYWORDS[sectionId], ...SECTION_CONTENT_KEYWORDS[sectionId]].map((k) =>
    k.toLowerCase()
  );

  const matched = items.filter((item) => {
    const lower = item.toLowerCase();
    return keywords.some((k) => lower.includes(k));
  });

  return matched;
}

function detectRelatedSections(item: string): CareSection[] {
  const lower = String(item || '').toLowerCase();
  return (Object.entries(SECTION_KEYWORDS) as Array<[CareSection, string[]]>)
    .filter(([section, keywords]) =>
      [...keywords, ...SECTION_CONTENT_KEYWORDS[section]].some((k) => lower.includes(k.toLowerCase()))
    )
    .map(([section]) => section);
}

export function scopeItems(items: string[], currentSection: CareSection): ScopedItem[] {
  return (items || []).map((text) => {
    const related = detectRelatedSections(text);
    const includesCurrent = related.includes(currentSection);
    const primary =
      includesCurrent ? currentSection : related.length > 0 ? related[0] : null;

    let scope: ItemScope = 'global';
    if (related.length === 1 && related[0] === currentSection) {
      scope = 'section';
    } else if (related.length > 0) {
      scope = 'cross-section';
    }

    return {
      text,
      primary_section: primary,
      related_sections: related.filter((s) => s !== primary),
      scope
    };
  });
}

export function splitSectionAndCommonItems(items: string[], currentSection: CareSection): {
  sectionItems: string[];
  commonItems: string[];
  scoped: ScopedItem[];
} {
  const scoped = scopeItems(items || [], currentSection);
  const sectionItems = scoped
    .filter((item) => item.scope === 'section' && item.primary_section === currentSection)
    .map((item) => item.text);
  const commonItems = scoped
    .filter((item) => !(item.scope === 'section' && item.primary_section === currentSection))
    .map((item) => item.text);
  return { sectionItems, commonItems, scoped };
}

export function filterMissingForSection(missingItems: string[], sectionId: CareSection): string[] {
  return pickBySection(missingItems || [], sectionId);
}

export function filterQuestionsForSection(questions: string[], sectionId: CareSection): string[] {
  return pickBySection(questions || [], sectionId);
}

export function buildQuestionFromMissing(missingItem: string): string {
  return `다음 항목을 보완할 수 있는 정보를 알려주세요: ${missingItem}`;
}
