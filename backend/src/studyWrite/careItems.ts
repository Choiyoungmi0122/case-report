/**
 * CARE 체크리스트(2013) 13개 항목과 세부 항목. 문장은 CARE 설명서(Riley et al., J Clin
 * Epidemiol 2017;89:218-235)의 체크리스트와 각 항목 설명을 따른다.
 *
 * 필수·선택 구분은 CARE 자체에는 없다(모든 항목이 체크리스트 항목이다). `required` 는
 * 연구실의 CARE 필수·선택 구분표를 옮긴 것이며, 질문 우선순위와 화면 표시에만 쓴다.
 *
 * 질문 생성(SW-Q2), 초안 작성(SW-D), 빠진 요소 점검(SW-C)이 모두 이 표를 쓴다.
 */

export interface CareItemDef {
  code: string;
  label: string;
  /** 연구실 구분표 기준 필수 여부 (CARE 자체 구분 아님) */
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
    { code: '1', label: '제목에 "증례보고"(case report)라는 말과 가장 중요한 현상(증상, 진단, 검사, 개입)을 담는다. 간결하게', required: true },
    { code: '2', label: '핵심 단어 2~5개. 그중 하나는 "증례보고"(case report)', required: true }
  ],
  ABSTRACT: [
    { code: '3a', label: '소개: 이 증례가 무엇을 더하는가(새로운 점, 보고 이유)', required: true },
    { code: '3b', label: '사례 제시: 주요 증상, 주요 임상 소견, 주요 진단과 개입, 주요 결과', required: true },
    { code: '3c', label: '결론: 이 증례의 핵심 교훈(take-away) 한두 문장', required: true }
  ],
  INTRODUCTION: [
    { code: '4', label: '사례의 배경을 짧게 요약하고 보고 이유를 밝힌다. 끝에 1~3문장으로 이 사례의 질문·공백·중요성·핵심 메시지를 요약한다', required: true },
    { code: '4b', label: '관련 의학 문헌 인용 (상세 문헌 고찰은 고찰로)', required: false }
  ],
  PATIENT_INFORMATION: [
    { code: '5a', label: '인구학적 정보: 나이, 성별, 인종·민족, 직업 (익명성 유지)', required: true },
    { code: '5b', label: '주요 증상(주소): 가능하면 환자의 말로. 기간, 빈도, 강도, 부위, 악화·완화 요인', required: true },
    { code: '5c', label: '병력: 의학적·가족력·심리사회적 이력, 생활 습관, 유전 정보, 동반 질환과 그 시작 시기, 과거 개입과 그 결과, 알레르기, 복용 약물', required: true }
  ],
  CLINICAL_FINDINGS: [
    { code: '6', label: '진료 시작 시점의 신체 진찰 소견과 주요 임상 소견 (한의학적 진찰 포함). 경과 중의 소견은 추적 관찰로', required: true }
  ],
  TIMELINE: [
    { code: '7', label: '주요 사건을 날짜·시각과 함께 시간 순으로 표 또는 그림으로. 병력, 주소, 진단 평가, 치료 개입, 다른 의료진의 치료, 추적, 결과', required: true }
  ],
  DIAGNOSTIC_ASSESSMENT: [
    { code: '8a', label: '진단 방법: 진찰, 검사, 영상, 설문·척도. 시행 날짜와 결과, 필요하면 참고 범위', required: true },
    { code: '8c', label: '진단 추론: 고려한 다른 진단과 최종 진단에 이른 과정', required: true },
    { code: '8b', label: '진단의 어려움 (비용, 언어·문화, 평가를 끝내지 못한 장애)', required: false },
    { code: '8d', label: '예후 특성 (병기 등, 해당 시)', required: false }
  ],
  THERAPEUTIC_INTERVENTIONS: [
    { code: '9a', label: '개입의 종류: 약물, 수술, 예방, 자가 관리 등. 한약·침·약침·상담·생활 지도. 다른 의료진에게 받은 치료도', required: true },
    { code: '9b', label: '시행 방법: 다른 사람이 따라 할 수 있을 만큼. 약물은 성분명·용량·용법·기간, 한약은 처방 구성(약재와 양, 학명)·제조사·복용법, 침은 혈위·침 규격·유침 시간·자극 방법, 생활 지도는 빈도·강도·시기·종류', required: true },
    { code: '9c', label: '개입의 변경과 그 이유', required: false }
  ],
  FOLLOW_UP_OUTCOMES: [
    { code: '10a', label: '임상의가 평가한 결과(검사, 진찰, 영상)와 환자가 평가한 결과를 경과에 따라', required: true },
    { code: '10d', label: '이상반응과 예상치 못한 사건. 있었는지 없었는지(또는 기록이 없는지)를 반드시 밝힌다', required: true },
    { code: '10b', label: '중요한 추적 검사 결과 (양성·음성 모두)', required: false },
    { code: '10c', label: '순응도·내약성과 그것을 어떻게 확인했는지 (일지, 전화, 진술 등)', required: false }
  ],
  DISCUSSION_CONCLUSION: [
    { code: '11c', label: '결론의 근거: 인과 평가와 논리 전개. 우연의 가능성을 배제할 수 없음을 언급', required: true },
    { code: '11d', label: '핵심 메시지(take-away). 결론은 짧게', required: true },
    { code: '11a', label: '이 사례 관리의 강점과 한계. 단일 사례의 결과를 일반화할 수 없음을 명시', required: false },
    { code: '11b', label: '관련 의학 문헌(임상시험, 증례보고)과의 비교', required: false }
  ],
  PATIENT_PERSPECTIVE: [
    { code: '12', label: '가능하면 환자(또는 보호자)의 말로 치료 경험, 치료를 찾은 이유, 변화, 삶의 질에 대한 관점', required: false }
  ],
  INFORMED_CONSENT: [
    { code: '13', label: '환자(또는 보호자)의 서면 동의 여부. 받지 못했다면 모든 시도를 했음을 밝힌다', required: true }
  ]
};

export function careItemsText(sectionId: string): string {
  const items = CARE_ITEMS_BY_SECTION[sectionId] || [];
  return items.map((item) => `- ${item.code} (${item.required ? '필수' : '선택'}): ${item.label}`).join('\n');
}

/** 질문 생성 프롬프트용 전체 체크리스트. 섹션 id 를 같이 적는다. */
export function careChecklistText(): string {
  const lines = CARE_SECTION_ORDER.map((sectionId) => {
    const items = CARE_ITEMS_BY_SECTION[sectionId] || [];
    const body = items.map((item) => `${item.code}${item.required ? '(필수)' : '(선택)'} ${item.label}`).join(' / ');
    return `- ${CARE_SECTION_NAMES[sectionId]} (${sectionId}): ${body}`;
  });
  return [
    'CARE 세부 항목. 괄호 안이 targetSectionIds 에 쓰는 섹션 id 입니다. 필수·선택은 연구실 구분이며 CARE 자체 구분이 아닙니다:',
    ...lines,
    '',
    'targetSectionIds 에는 위 괄호 안의 섹션 id(영문 대문자)만 넣습니다. 번호를 넣지 않습니다.'
  ].join('\n');
}

/**
 * 섹션별로 CARE 설명서가 요구하는 쓰기 규칙. SW-D(초안)와 SW-R(고쳐 쓰기)에 들어간다.
 */
export const CARE_SECTION_WRITING_RULES: Record<string, string> = {
  TITLE: '첫 줄에 제목 한 줄. 제목에는 "증례보고"를 넣고 가장 중요한 현상(진단·개입·결과)을 담는다. 둘째 줄에 "핵심 단어: …" 로 2~5개를 쓰고 그중 하나는 "증례보고"로 한다.',
  ABSTRACT:
    '소개(이 증례가 더하는 것)·사례 제시(주요 증상, 임상 소견, 진단과 개입, 결과)·결론(핵심 교훈 한두 문장)의 세 문단. 전체 100~250단어 수준으로 간결하게. 단일 메시지를 강조한다.',
  INTRODUCTION:
    '사례의 배경을 한두 문장으로 요약하고 보고 이유(답변의 기여·초점)를 밝힌다. 문헌이 들어갈 자리는 "[문헌 보완 필요]"로 남긴다. 끝에 1~3문장으로 이 사례의 질문 또는 지식 공백, 중요성, 핵심 메시지를 요약한다. 마지막에 "이 증례보고는 CARE 지침에 따라 작성되었다."를 넣는다.',
  PATIENT_INFORMATION:
    '나이·성별·직업 등 인구학적 정보, 주소(가능하면 환자의 말, 기간·빈도·강도·악화·완화 요인), 병력(의학적·가족력·심리사회적, 생활 습관, 동반 질환과 시작 시기, 과거 개입과 결과, 알레르기, 복용 약물). 이름·주소·주민번호 같은 식별 정보는 쓰지 않는다.',
  CLINICAL_FINDINGS:
    '진료 시작 시점(초진)의 진찰 소견과 주요 임상 소견만 쓴다. 한의학적 진찰(맥, 설, 복진 등)을 포함한다. 경과 중 달라진 소견은 여기 쓰지 않고 추적 관찰 및 결과에 쓴다.',
  TIMELINE:
    '본문 문단이 아니라 표의 행으로 쓴다. 한 줄에 사건 하나, 형식은 "날짜 | 사건" (예: "2026-03-11 | 초진. 불면, 화병 호소. 황련해독탕 2주 처방"). 날짜 순서대로. 날짜와 연도는 기록의 [방문 n …] 머리글에 적힌 방문 날짜에서 가져오고, 기록에 없는 연도를 추정해 쓰지 않는다("작년", "3년 전"은 그대로 둔다). 병력·주소·진단 평가·치료 개입·다른 의료진의 치료·추적·결과를 모두 담는다. 날짜를 모르면 "시기 미상 | …"으로 쓴다.',
  DIAGNOSTIC_ASSESSMENT:
    '진단 방법(진찰, 검사, 영상, 척도)과 시행 날짜·결과를 쓰고 필요하면 참고 범위를 적는다. 고려한 다른 진단과 최종 진단에 이른 추론을 쓴다. 진단의 어려움과 예후 특성은 기록·답변에 있을 때만 쓴다. 추적 검사는 추적 관찰 및 결과에 쓴다.',
  THERAPEUTIC_INTERVENTIONS:
    '다른 사람이 따라 할 수 있을 만큼 쓴다. 약물은 성분명·용량·용법·기간, 한약은 처방명과 구성(약재와 양, 기록에 있으면 학명)·제조사·복용법, 침은 혈위·침 규격·유침 시간·자극 방법, 약침은 약제·부위·용량, 생활 지도는 빈도·강도·시기·종류. 왜 그 개입을 했는지 짧게 적고(자세한 근거는 고찰로), 개입의 변경과 이유, 다른 의료진에게 받은 치료도 쓴다.',
  FOLLOW_UP_OUTCOMES:
    '임상의가 평가한 결과(척도, 진찰, 검사)와 환자가 평가한 결과를 경과에 따라 쓴다. 추적 검사 결과는 양성·음성 모두 쓴다. 순응도·내약성은 어떻게 확인했는지(진술, 잔량, 일지)와 함께 쓴다. 이상반응은 반드시 한 문장으로 밝힌다: 있었으면 무엇이 언제 얼마나, 기록에 "없음"이 명시돼 있으면 "기록상 이상반응은 없었다", 언급 자체가 없으면 "기록에 이상반응 관련 언급이 없다 [확인 필요: 이상반응 유무]"로 쓴다. 다른 의료진의 치료와 그 영향도 쓴다.',
  DISCUSSION_CONCLUSION:
    '이 사례의 핵심을 짧게 정리하고 무엇을 배웠는지 쓴다. 결론의 근거(시간 관계 등 인과 평가)를 쓰되 치료 효과를 단정하지 않고, 우연의 가능성을 배제할 수 없음과 단일 사례를 일반화할 수 없음을 한계로 명시한다. 문헌 비교와 기전 설명이 들어갈 자리는 "[문헌 보완 필요]"로 남긴다. 마지막에 핵심 메시지(답변의 take-away)를 한두 문장으로 쓴다.',
  PATIENT_PERSPECTIVE:
    '기록이나 답변에 환자(또는 보호자)의 말이 있을 때만, 그 말을 인용하거나 간접 인용으로 쓴다. 없으면 "환자의 관점은 기록되지 않았다 [확인 필요: 환자의 말]" 한 문장만 쓴다.',
  INFORMED_CONSENT:
    '답변대로만 쓴다. 받았으면 누구에게 언제 서면 동의를 받았는지, 받지 않았으면 받을 계획 또는 받을 수 없는 사정과 시도한 내용을 쓴다.'
};

export function careWritingRule(sectionId: string): string {
  return CARE_SECTION_WRITING_RULES[sectionId] || '';
}
