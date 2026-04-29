export type SupportedCareSectionId =
  | 'TITLE'
  | 'ABSTRACT'
  | 'INTRODUCTION'
  | 'PATIENT_INFORMATION'
  | 'CLINICAL_FINDINGS'
  | 'TIMELINE'
  | 'DIAGNOSTIC_ASSESSMENT'
  | 'THERAPEUTIC_INTERVENTIONS'
  | 'FOLLOW_UP_OUTCOMES'
  | 'DISCUSSION_CONCLUSION'
  | 'PATIENT_PERSPECTIVE'
  | 'INFORMED_CONSENT';

export type CareSectionRubric = {
  sectionId: SupportedCareSectionId;
  title: string;
  requiredItems: string[];
  optionalItems: string[];
  editorialGoal: string;
};

export const careSectionRubricMap: Record<SupportedCareSectionId, CareSectionRubric> = {
  TITLE: {
    sectionId: 'TITLE',
    title: 'Title Section',
    requiredItems: [
      "제목에 'case report' 또는 'case study' 성격이 드러날 것",
      '사례의 주요 현상(증상, 진단, 검사, 개입 등)이 명확히 드러날 것'
    ],
    optionalItems: ['주요 결과, 부작용, 후속 결과, take-away 메시지를 반영할 수 있음'],
    editorialGoal: '증례의 핵심 현상을 간결하게 드러내는 제목을 만든다.'
  },
  ABSTRACT: {
    sectionId: 'ABSTRACT',
    title: 'Abstract Section',
    requiredItems: [
      '소개: 사례가 어떤 기여를 하는지 간단히 제시할 것',
      '사례 제시: 주요 증상, 임상 소견, 진단, 치료, 결과를 요약할 것',
      '결론: 주요 교훈 또는 시사점을 명시할 것'
    ],
    optionalItems: [
      '구조화된 초록 형식 사용',
      '비구조화 초록이라도 소개, 사례 제시, 결론 요소를 모두 포함',
      'CARE guideline 준수 언급'
    ],
    editorialGoal: '증례의 핵심 내용과 임상적 메시지를 짧고 분명하게 요약한다.'
  },
  INTRODUCTION: {
    sectionId: 'INTRODUCTION',
    title: 'Introduction Section',
    requiredItems: [
      '사례에 대한 배경과 중요성을 설명할 것',
      '관련 문헌이나 기존 지식과 연결해 왜 이 증례가 의미 있는지 보여줄 것'
    ],
    optionalItems: ['CARE guideline 준수 언급', '간단한 문헌 검토'],
    editorialGoal: '왜 이 증례를 보고하는지와 임상적 필요성을 짧고 분명하게 제시한다.'
  },
  PATIENT_INFORMATION: {
    sectionId: 'PATIENT_INFORMATION',
    title: 'Patient Information Section',
    requiredItems: [
      '인구학적 정보(나이, 성별, 직업 등)',
      '주요 증상 또는 주호소',
      '병력(의학적 병력, 가족력, 심리사회적 이력)'
    ],
    optionalItems: ['환경 노출, 보험 등 추가 개인 정보', '환자 직접 표현'],
    editorialGoal: '환자 배경과 주호소를 독자가 이해할 수 있을 정도로 제시한다.'
  },
  CLINICAL_FINDINGS: {
    sectionId: 'CLINICAL_FINDINGS',
    title: 'Clinical Findings Section',
    requiredItems: ['신체검진 및 관련 임상 소견을 구체적으로 기술할 것'],
    optionalItems: ['검사 방법', '영상 자료', '표/그림 등 시각 자료'],
    editorialGoal: '관찰된 임상 소견을 단순 나열이 아니라 임상 문단으로 정리한다.'
  },
  TIMELINE: {
    sectionId: 'TIMELINE',
    title: 'Timeline Section',
    requiredItems: ['주요 사건을 날짜와 시간 순서대로 나열할 것'],
    optionalItems: ['표, 도표, 그림 등 시각적 timeline 자료'],
    editorialGoal: '사건의 순서와 경과가 시간 흐름에 따라 분명히 보이게 한다.'
  },
  DIAGNOSTIC_ASSESSMENT: {
    sectionId: 'DIAGNOSTIC_ASSESSMENT',
    title: 'Diagnostic Assessment and Diagnosis Section',
    requiredItems: [
      '진단 방법(신체검사, 실험실, 영상, 설문 등)',
      '진단 추론: 감별 및 최종 진단 도출 과정'
    ],
    optionalItems: ['진단 도전 과제(재정, 언어, 문화 등)', '예후적 특성(병기, 예후 정보)'],
    editorialGoal: '왜 그 진단에 도달했는지와 평가 과정을 논리적으로 보여준다.'
  },
  THERAPEUTIC_INTERVENTIONS: {
    sectionId: 'THERAPEUTIC_INTERVENTIONS',
    title: 'Therapeutic Interventions Section',
    requiredItems: [
      '개입 유형(약물, 수술, 예방, 자가 관리 등)',
      '투여 및 시행 방법(용량, 경로, 기간 등 상세 내용)'
    ],
    optionalItems: ['개입 변경 사항과 변경 사유'],
    editorialGoal: '무엇을 어떻게 시행했는지 재현 가능할 정도로 제시한다.'
  },
  FOLLOW_UP_OUTCOMES: {
    sectionId: 'FOLLOW_UP_OUTCOMES',
    title: 'Follow-up and Outcomes Section',
    requiredItems: ['임상 및 환자 평가 결과', '부작용 및 예기치 않은 사건 명시'],
    optionalItems: ['중요한 추적 검사 결과', '치료 준수 및 내약성 평가 방법'],
    editorialGoal: '치료 후 변화와 추적 결과를 시간 흐름에 맞춰 보여준다.'
  },
  DISCUSSION_CONCLUSION: {
    sectionId: 'DISCUSSION_CONCLUSION',
    title: 'Discussion (including Conclusion) Section',
    requiredItems: ['결론 도출 근거: 인과관계 평가 및 논리 전개', '주요 take-away 메시지'],
    optionalItems: ['사례 관리의 강점과 한계', '관련 문헌 비교 및 언급'],
    editorialGoal: '증례 해석과 결론의 근거를 과장 없이 정리한다.'
  },
  PATIENT_PERSPECTIVE: {
    sectionId: 'PATIENT_PERSPECTIVE',
    title: 'Patient Perspective Section',
    requiredItems: ['해당 시 환자의 경험, 치료 전후 변화 및 소견'],
    optionalItems: ['환자 직접 인용', '상세 개인 서술'],
    editorialGoal: '환자 경험이 있을 때 그 목소리를 보수적으로 반영한다.'
  },
  INFORMED_CONSENT: {
    sectionId: 'INFORMED_CONSENT',
    title: 'Informed Consent Section',
    requiredItems: ['환자 또는 보호자로부터 서면 동의를 받았음을 명시할 것'],
    optionalItems: ['동의서 제출 여부, 추가 지침 정보'],
    editorialGoal: '동의 관련 사실을 확인된 범위 안에서 보수적으로 명시한다.'
  }
};

export const supportedCareSectionOrder: SupportedCareSectionId[] = [
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
];

export function buildCareRubricSummary(sectionIds?: string[]): string {
  const targetIds = sectionIds && sectionIds.length > 0 ? sectionIds : supportedCareSectionOrder;

  return targetIds
    .filter((sectionId): sectionId is SupportedCareSectionId => sectionId in careSectionRubricMap)
    .map((sectionId) => {
      const rubric = careSectionRubricMap[sectionId];
      const required = rubric.requiredItems.map((item) => `- ${item}`).join('\n');
      const optional = rubric.optionalItems.length > 0
        ? rubric.optionalItems.map((item) => `- ${item}`).join('\n')
        : '- (없음)';

      return [
        `[${rubric.sectionId}] ${rubric.title}`,
        `editorialGoal: ${rubric.editorialGoal}`,
        'requiredItems:',
        required,
        'optionalItems:',
        optional
      ].join('\n');
    })
    .join('\n\n---\n\n');
}
