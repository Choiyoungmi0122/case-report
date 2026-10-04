import type {
  DraftJudgment,
  InformationStatusJudgment,
  ScaffoldStateResponse
} from '../services/api';

export type SectionGroup = 'record_facts' | 'clinical_process' | 'additional_authoring';
export type ScaffoldType = 'record_selection' | 'clinical_process' | 'additional_authoring';

export interface SectionConfig {
  sectionId: string;
  displayName: string;
  group: SectionGroup;
  scaffoldType: ScaffoldType;
  displayOrder: number;
  description: string;
  requirements: string[];
}

export const SCAFFOLD_STEP_LABELS = [
  '1. 기록 확인',
  '2. CARE 구조 확인',
  '3. 부족 정보 검토',
  '4. AI 초안 검토',
  '5. 추가 확인 항목 정리'
] as const;

export const SCAFFOLD_STATUS_DESCRIPTION: Record<string, string> = {
  READY: '현재 기록으로 기본 초안 작성이 가능합니다.',
  INCOMPLETE: '일부 정보가 부족해 추가 확인이 필요합니다.',
  IMPOSSIBLE: '현재 기록만으로는 작성이 어렵습니다.'
};

export const SECTION_GROUP_DESCRIPTIONS: Record<SectionGroup, string> = {
  record_facts: '의무기록에서 직접 확인할 수 있는 기본 정보를 정리합니다.',
  clinical_process: '진단과 치료 판단 과정을 구조화합니다.',
  additional_authoring: '기록 외의 해석이나 종합 서술이 필요한 항목을 작성합니다.'
};

export const SCAFFOLD_SECTIONS: SectionConfig[] = [
  {
    sectionId: 'PATIENT_INFORMATION',
    displayName: '환자 정보',
    group: 'record_facts',
    scaffoldType: 'record_selection',
    displayOrder: 1,
    description: '환자의 기본 배경과 증례 이해에 필요한 핵심 정보를 정리합니다.',
    requirements: ['연령과 성별', '주요 병력', '직업 및 사회적 배경']
  },
  {
    sectionId: 'CLINICAL_FINDINGS',
    displayName: '임상 소견',
    group: 'record_facts',
    scaffoldType: 'record_selection',
    displayOrder: 2,
    description: '증상, 신체진찰, 검사 결과 등 핵심 임상 정보를 정리합니다.',
    requirements: ['주요 증상', '이학적 소견', '관찰 가능한 변화']
  },
  {
    sectionId: 'TIMELINE',
    displayName: '경과 기록',
    group: 'record_facts',
    scaffoldType: 'record_selection',
    displayOrder: 3,
    description: '증상, 평가, 치료, 경과를 시간 순서대로 정리합니다.',
    requirements: ['방문 시점', '주요 사건', '치료와 변화의 순서']
  },
  {
    sectionId: 'DIAGNOSTIC_ASSESSMENT',
    displayName: '진단 평가',
    group: 'clinical_process',
    scaffoldType: 'clinical_process',
    displayOrder: 4,
    description: '진단 판단의 근거와 감별 과정을 정리합니다.',
    requirements: ['진단 근거', '감별 진단', '검사 결과 해석']
  },
  {
    sectionId: 'THERAPEUTIC_INTERVENTIONS',
    displayName: '치료 개입',
    group: 'clinical_process',
    scaffoldType: 'clinical_process',
    displayOrder: 5,
    description: '치료 내용과 적용 방식을 명확히 정리합니다.',
    requirements: ['치료 종류', '기간과 빈도', '변경 사항']
  },
  {
    sectionId: 'FOLLOW_UP_OUTCOMES',
    displayName: '추적 관찰 및 결과',
    group: 'clinical_process',
    scaffoldType: 'clinical_process',
    displayOrder: 6,
    description: '치료 후 변화와 추적 관찰 결과를 정리합니다.',
    requirements: ['상태 변화', '추적 관찰', '부작용 또는 예후']
  },
  {
    sectionId: 'PATIENT_PERSPECTIVE',
    displayName: '환자 관점',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 7,
    description: '환자의 경험, 반응, 느낌을 반영해 작성합니다.',
    requirements: ['환자 진술', '불편감과 걱정', '치료에 대한 반응']
  },
  {
    sectionId: 'INFORMED_CONSENT',
    displayName: '환자 동의',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 8,
    description: '증례보고 작성과 출판에 대한 환자 동의 여부를 확인합니다.',
    requirements: ['명시적 동의 여부', '동의 확인 방식', '개인정보 보호']
  },
  {
    sectionId: 'DISCUSSION_CONCLUSION',
    displayName: '고찰',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 9,
    description: '증례의 의미와 학습 포인트를 종합적으로 정리합니다.',
    requirements: ['의미 해석', '유사 사례와 비교', '학습 포인트']
  },
  {
    sectionId: 'INTRODUCTION',
    displayName: '서론',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 10,
    description: '증례의 배경과 문제의식을 소개합니다.',
    requirements: ['질환 개요', '증례의 중요성', '선정 이유']
  },
  {
    sectionId: 'TITLE',
    displayName: '제목',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 11,
    description: '증례를 정확하고 간결하게 드러내는 제목을 작성합니다.',
    requirements: ['핵심 질환 또는 증상', '특징적 소견', '간결한 표현']
  },
  {
    sectionId: 'ABSTRACT',
    displayName: '초록',
    group: 'additional_authoring',
    scaffoldType: 'additional_authoring',
    displayOrder: 12,
    description: '증례의 핵심 내용을 짧게 요약합니다.',
    requirements: ['환자 정보 요약', '주요 임상 경과', '핵심 결론']
  }
];

export const SCAFFOLD_SECTION_PURPOSES: Record<
  string,
  { purpose: string; requirements: string[] }
> = Object.fromEntries(
  SCAFFOLD_SECTIONS.map((section) => [
    section.sectionId,
    {
      purpose: section.description,
      requirements: section.requirements
    }
  ])
);

export const INFORMATION_STATUS_JUDGMENT_OPTIONS: Array<{
  value: InformationStatusJudgment;
  label: string;
}> = [
  { value: 'available_in_record', label: '기록에서 확인 가능' },
  { value: 'needs_additional_confirmation', label: '추가 확인 필요' },
  { value: 'needs_instructor_review', label: '교수 검토 필요' },
  { value: 'unavailable', label: '현재 기록만으로 확인 불가' },
  { value: 'pending', label: '판단 보류' }
];

export const DRAFT_JUDGMENT_OPTIONS: Array<{
  value: DraftJudgment;
  label: string;
}> = [
  { value: 'pending', label: '판단 선택' },
  { value: 'supported_by_record', label: '기록 근거 충분' },
  { value: 'needs_additional_confirmation', label: '추가 확인 필요' },
  { value: 'needs_instructor_review', label: '교수 검토 필요' },
  { value: 'uncertain', label: '판단 어려움' }
];

export const SCAFFOLD_JUDGMENT_OPTIONS = INFORMATION_STATUS_JUDGMENT_OPTIONS;

export function countScaffoldEvidence(response: ScaffoldStateResponse, sectionId: string) {
  const sectionEvidence = response.sectionEvidenceMap?.[sectionId];
  if (sectionEvidence?.length) return sectionEvidence.length;
  return (response.evidenceCards || []).filter((card) => (card.tags || []).includes(sectionId)).length;
}

export function sanitizeScaffoldKey(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function buildScaffoldItemId(
  sectionId: string,
  sourceType: string,
  sourceText: string,
  index: number
) {
  return `${sectionId}-${sourceType}-${index}-${sanitizeScaffoldKey(sourceText) || 'item'}`;
}

export function splitScaffoldDraftSentences(text: string) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getCompletedScaffoldSectionCount(data: ScaffoldStateResponse | null) {
  return (data?.scaffoldState.sectionProgress || []).filter(
    (item) =>
      item.recordReviewCompleted &&
      item.missingInfoReviewCompleted &&
      item.draftRevealed &&
      item.draftReviewCompleted
  ).length;
}

export function getScaffoldCurrentStepIndex(data: ScaffoldStateResponse | null) {
  if (!data) return 0;
  const progressItems = data.scaffoldState.sectionProgress || [];
  if (progressItems.some((item) => item.draftReviewCompleted)) return 4;
  if (progressItems.some((item) => item.draftRevealed)) return 3;
  if (progressItems.some((item) => item.missingInfoReviewCompleted)) return 2;
  if (progressItems.some((item) => item.recordReviewCompleted)) return 1;
  return 0;
}

export function getSectionConfig(sectionId: string): SectionConfig | undefined {
  return SCAFFOLD_SECTIONS.find((section) => section.sectionId === sectionId);
}

export function getSectionsByGroup(group: SectionGroup): SectionConfig[] {
  return SCAFFOLD_SECTIONS.filter((section) => section.group === group).sort(
    (a, b) => a.displayOrder - b.displayOrder
  );
}

export function getAllSectionsByGroup(): Record<SectionGroup, SectionConfig[]> {
  return {
    record_facts: getSectionsByGroup('record_facts'),
    clinical_process: getSectionsByGroup('clinical_process'),
    additional_authoring: getSectionsByGroup('additional_authoring')
  };
}

export function sectionIdToUppercaseKey(sectionId: string): string {
  return sectionId
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('_');
}
