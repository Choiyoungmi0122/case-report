import { StudyMemoSuggestion } from './defaultStudyCase';

/**
 * 시연용 가상환자 사례 (45세 남자, 요통, 3회 방문). 실험번호 DEMO-01로 등록해 도구
 * 사용법을 보여줄 때 쓴다. 본문은 docs/demo_case_emr_lbp_v1.md와 같아야 한다.
 */
export const DEMO_CASE_VISIT_TEXTS: string[] = [
  "45세 남자\n\n진단명\n• 요통\n• 요추의 염좌 및 긴장\n\n주소증\n1. 허리 통증 (우측 우세)\n2. 아침에 허리가 뻣뻣함\n\n발병 및 경과\n• 5일 전 이삿짐을 옮긴 뒤 허리 통증 시작.\n• 앉았다 일어날 때와 허리를 숙일 때 심해진다고 함.\n• 다리 저림이나 힘 빠짐은 없다고 함.\n• 사무직. 하루 8시간 이상 앉아서 근무.\n\n과거력 및 기타\n• 2년 전 비슷한 요통으로 물리치료 받은 적 있음.\n• 고혈압으로 암로디핀 5mg qd 복용 중.\n• 진통제는 복용하지 않았다고 함.\n\n검사 및 평가\n• NRS 7\n• ODI 38%\n• 하지직거상검사 양측 음성\n• 요추 굴곡 시 통증으로 제한, L4-5 우측 기립근 압통\n• 변증: 기체혈어\n\n처치 및 시술\n• 경혈침술 (신수, 대장수, 위중, 곤륜 / 0.25x40mm, 유침 15분)\n• 부항 (요부, 건식, 5분)\n• 경피적외선조사요법\n\n처방\n• 작약감초탕 (보험한약, 가루약) 1일 3회 식후, 7일분\n\n교육\n• 오래 앉아 있지 말고 1시간마다 일어나 걷도록 안내.",
  "진단명\n• 요통\n• 요추의 염좌 및 긴장\n\n경과\n• 통증이 조금 줄었다고 함. 아침 뻣뻣함은 그대로.\n• 허리 숙이기는 여전히 불편하다고 함.\n• 한약 복용 후 속 불편감은 없었다고 함.\n• 침 맞은 날 저녁에 허리가 뻐근했으나 다음 날 괜찮아졌다고 함.\n\n검사 및 평가\n• NRS 5\n• L4-5 우측 기립근 압통 지속\n\n처치 및 시술\n• 경혈침술 (신수, 대장수, 위중, 곤륜 / 유침 15분)\n• 전침 (신수-대장수, 2Hz, 15분)\n• 부항 (요부, 건식, 5분)\n\n처방\n• 작약감초탕 계속 복용",
  "진단명\n• 요통\n• 요추의 염좌 및 긴장\n\n경과\n• 통증이 많이 줄었고 아침 뻣뻣함도 10분 정도면 풀린다고 함.\n• 허리 숙여 양말 신는 것이 가능해졌다고 함.\n• \"일할 때는 거의 신경 쓰이지 않는다\"고 함.\n• 장시간 운전 후에는 아직 뻐근하다고 함.\n\n검사 및 평가\n• NRS 2\n• ODI 14%\n• 요추 굴곡 시 통증 경미, 압통 감소\n\n처치 및 시술\n• 경혈침술 (신수, 대장수, 위중 / 유침 15분)\n• 경피적외선조사요법\n\n처방\n• 작약감초탕 복용 종료 (총 7일분 복용)\n\n계획\n• 증상 안정되어 치료 종료. 재발 시 내원하도록 안내.\n• 허리 신전 운동 1일 2회 교육."
];

export function isDemoCaseText(visitTexts: string[]): boolean {
  const normalize = (text: string) => String(text || '').replace(/\r\n/g, '\n').trim();
  return (
    visitTexts.length === DEMO_CASE_VISIT_TEXTS.length &&
    visitTexts.every((text, index) => normalize(text) === DEMO_CASE_VISIT_TEXTS[index])
  );
}

/**
 * 시연 사례의 방문별 'AI 메모 추천'. 실험 사례의 추천과 같은 기준으로 썼다:
 * CARE 세부 항목 하나에 대응, 그 방문의 원기록 구절을 가리킴, 살펴볼 곳만 알려주고
 * 값이나 판단은 적지 않음, 방문마다 2개, 이상반응(10d)은 추천하지 않음.
 */
export const DEMO_CASE_MEMO_SUGGESTIONS: StudyMemoSuggestion[] = [
  {
    id: 'demo-v1-1', visitIndex: 1, type: 'question',
    text: '통증과 기능을 어떤 도구로 평가했는지, 어떤 검사를 했는지 살펴본다.',
    careItem: '8a 진단 방법',
    recordAnchor: 'NRS 7 / ODI 38% / 하지직거상검사 양측 음성'
  },
  {
    id: 'demo-v1-2', visitIndex: 1, type: 'observation',
    text: '이전에 비슷한 증상으로 받은 치료와 지금 복용 중인 약이 적혀 있다.',
    careItem: '5c 과거력과 과거 중재',
    recordAnchor: '2년 전 비슷한 요통으로 물리치료 받은 적 있음 / 암로디핀 5mg qd 복용 중'
  },
  {
    id: 'demo-v2-1', visitIndex: 2, type: 'observation',
    text: '이날 치료 방법에 새로 더해진 것이 있다.',
    careItem: '9c 중재의 변경과 이유',
    recordAnchor: '전침 (신수-대장수, 2Hz, 15분)'
  },
  {
    id: 'demo-v2-2', visitIndex: 2, type: 'question',
    text: '처방한 한약을 어떻게 복용하고 있는지 기록에서 확인해 본다.',
    careItem: '10c 중재 순응과 내약성',
    recordAnchor: '한약 복용 후 속 불편감은 없었다고 함 / 작약감초탕 계속 복용'
  },
  {
    id: 'demo-v3-1', visitIndex: 3, type: 'observation',
    text: '평가 도구의 점수와 환자가 직접 한 말이 함께 적혀 있다.',
    careItem: '10a 임상의와 환자가 평가한 결과',
    recordAnchor: 'NRS 2 / ODI 14% / "일할 때는 거의 신경 쓰이지 않는다"고 함'
  },
  {
    id: 'demo-v3-2', visitIndex: 3, type: 'question',
    text: '이전 방문과 비교해 달라지거나 끝난 치료가 무엇인지, 그 이유가 적혀 있는지 살펴본다.',
    careItem: '9c 중재의 변경과 이유',
    recordAnchor: '경혈침술 (신수, 대장수, 위중 / 유침 15분) / 작약감초탕 복용 종료 / 증상 안정되어 치료 종료'
  }
];
