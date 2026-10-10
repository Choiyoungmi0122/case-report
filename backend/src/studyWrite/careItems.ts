/**
 * CARE 세부 항목과 필수·선택 구분. 연구실의 CARE 필수·선택 구분표를 따른다.
 * 질문 생성(SW-Q2), 초안 작성(SW-D), 빠진 요소 점검(SW-C)이 같은 표를 쓴다.
 */

export interface CareItemDef {
  code: string;
  label: string;
  required: boolean;
}

export const CARE_SECTION_ORDER = [
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
] as const;

export const CARE_SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 관찰 및 결과',
  DISCUSSION_CONCLUSION: '고찰',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '동의'
};

export const CARE_ITEMS_BY_SECTION: Record<string, CareItemDef[]> = {
  TITLE: [
    { code: '1', label: '"증례보고"임을 밝히고 주요 현상(진단, 개입, 결과)을 담은 제목', required: true },
    { code: '2', label: '핵심 단어 2~5개', required: true }
  ],
  ABSTRACT: [
    { code: '3a', label: '소개: 이 증례의 새로운 점이나 보고 이유', required: true },
    { code: '3b', label: '사례 제시: 주요 증상, 임상 소견, 진단, 치료, 결과', required: true },
    { code: '3c', label: '결론: 핵심 교훈', required: true }
  ],
  INTRODUCTION: [
    { code: '4', label: '배경과 이 증례를 보고하는 이유(기여)', required: true },
    { code: '4b', label: '관련 문헌 언급', required: false }
  ],
  PATIENT_INFORMATION: [
    { code: '5a', label: '인구학적 정보(나이, 성별, 직업 등)', required: true },
    { code: '5b', label: '주요 증상', required: true },
    { code: '5c', label: '병력: 의학적·가족력·심리사회적 이력, 복용 약물', required: true },
    { code: '5d', label: '관련 과거 개입과 결과', required: false }
  ],
  CLINICAL_FINDINGS: [
    { code: '6', label: '신체 진찰과 주요 임상 소견(한의학적 진찰 포함)', required: true },
    { code: '6b', label: '검사 방법, 영상, 척도 점수 등 보조 자료', required: false }
  ],
  TIMELINE: [
    { code: '7', label: '주요 사건을 날짜와 함께 시간 순서로', required: true }
  ],
  DIAGNOSTIC_ASSESSMENT: [
    { code: '8a', label: '진단 방법(진찰, 검사, 영상, 설문·척도)', required: true },
    { code: '8c', label: '진단 추론: 감별과 최종 진단에 이른 과정', required: true },
    { code: '8b', label: '진단의 어려움(비용, 언어, 문화 등)', required: false },
    { code: '8d', label: '예후 특성(병기, 예후 정보)', required: false }
  ],
  THERAPEUTIC_INTERVENTIONS: [
    { code: '9a', label: '개입의 종류(약물, 한약, 침, 상담, 자가 관리 등)', required: true },
    { code: '9b', label: '시행 방법: 용량, 경로, 기간, 빈도', required: true },
    { code: '9c', label: '개입의 변경과 그 이유', required: false }
  ],
  FOLLOW_UP_OUTCOMES: [
    { code: '10a', label: '임상의와 환자가 평가한 결과', required: true },
    { code: '10d', label: '이상반응과 예상치 못한 사건', required: true },
    { code: '10b', label: '중요한 추적 검사 결과', required: false },
    { code: '10c', label: '순응도·내약성과 그 확인 방법', required: false }
  ],
  DISCUSSION_CONCLUSION: [
    { code: '11c', label: '결론의 근거: 인과 평가와 논리 전개', required: true },
    { code: '11d', label: '핵심 메시지(take-away)', required: true },
    { code: '11a', label: '사례 관리의 강점과 한계', required: false },
    { code: '11b', label: '관련 문헌과의 비교', required: false }
  ],
  PATIENT_PERSPECTIVE: [
    { code: '12', label: '환자의 경험과 치료 전후 변화에 대한 환자의 말 (해당 시)', required: false }
  ],
  INFORMED_CONSENT: [
    { code: '13', label: '환자(또는 보호자)의 서면 동의 여부', required: true }
  ]
};

export function careItemsText(sectionId: string): string {
  const items = CARE_ITEMS_BY_SECTION[sectionId] || [];
  return items.map((item) => `- ${item.code} (${item.required ? '필수' : '선택'}): ${item.label}`).join('\n');
}
