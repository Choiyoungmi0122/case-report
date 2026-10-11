import { CareSection } from '../../types';
import { DEFAULT_STUDY_CASE, type StudyMemoSuggestion } from './defaultStudyCase';

/**
 * Scaffold V2(v3.0)용 'AI 메모 추천'. 교수 평가와 학생 후속 실험은 치료 개입(CARE 9) 섹션만
 * 실습하므로, 추천도 9a/9b/9c에 대응하는 것만 둔다. V1 세트(DEFAULT_STUDY_MEMO_SUGGESTIONS)는
 * 학생 V1 기록의 id가 참조하므로 그대로 두고, 이 세트는 별도 id(ti-회차-번호)를 쓴다.
 *
 * 작성 기준은 V1과 같다(docs/memo_suggestions_basis.md §3). 다른 점:
 *  - 방문마다 3~4개(V1은 2개). 치료 개입 하나에 집중하므로 살펴볼 곳이 더 많다.
 *  - recordAnchor는 그 방문 원기록에 **그대로** 들어 있는 구절이어야 한다(테스트로 검사).
 *    화면에서 "원문에서 보기"로 이 구절을 강조해 보여 주기 때문이다.
 *  - 이상반응(10d) 자체를 가리키는 추천은 두지 않는다(기준 6). 치료 중단(9c)은 가리키되 이유는 쓰지 않는다.
 *
 * 2026-10-11 Claude 초안. 임상 전문가·연구자 검수 전이다. 문구를 고치면 docs/memo_suggestions_v2_basis.md도 고친다.
 */
export type StudyMemoSuggestionV2 = StudyMemoSuggestion & {
  /** 화면 배지용 CARE 세부 항목 라벨. */
  careItemLabel: string;
  /** 이 추천이 돕는 CARE 섹션. */
  targetSectionIds: CareSection[];
};

export const TI_CARE_ITEM_LABELS: Record<string, string> = {
  '9a': '치료의 종류',
  '9b': '시행 방법 (용량, 기간, 빈도)',
  '9c': '치료를 바꾼 내용과 이유'
};

function ti(
  id: string,
  visitIndex: number,
  type: StudyMemoSuggestion['type'],
  careItem: '9a' | '9b' | '9c',
  text: string,
  recordAnchor: string
): StudyMemoSuggestionV2 {
  return {
    id,
    visitIndex,
    type,
    text,
    careItem,
    careItemLabel: TI_CARE_ITEM_LABELS[careItem],
    recordAnchor,
    targetSectionIds: [CareSection.THERAPEUTIC_INTERVENTIONS]
  };
}

export const DEFAULT_STUDY_MEMO_SUGGESTIONS_V2: StudyMemoSuggestionV2[] = [
  // 1회차 (3/11, 초진)
  ti('ti-1-1', 1, 'observation', '9a',
    '다른 병원에서 받고 있는 약물 치료가 적혀 있고, 이름이 확인된 약과 확인되지 않은 약이 섞여 있다.',
    '도네페질정 5mg qd (저녁 식후), 글리아티린 연질캡슐 400mg 1C tid'),
  ti('ti-1-2', 1, 'observation', '9b',
    '한약 처방에 용량, 하루 복용 횟수, 복용 기간이 어떻게 적혀 있는지 본다.',
    '황련해독탕 2주 (한신, 보험한약 가루약 5.61g/3포, 1일 3회 식후 30분 복용)'),
  ti('ti-1-3', 1, 'observation', '9a',
    '약 처방 외에 이날 시행한 비약물 치료(상담)가 처치 목록과 맨 아래 기록에 적혀 있다.',
    '지언고론요법: 2:10-20p 지지적 상담'),
  ti('ti-1-4', 1, 'question', '9a',
    '기존 정신과 약을 실제로 복용 중인지 기록만으로 알 수 있는지 살펴본다.',
    '다만 약 이름 모르고 잘 챙겨 먹는지도 불분명함.'),

  // 2회차 (3/13)
  ti('ti-2-1', 2, 'observation', '9a',
    '이날부터 침, 약침 등 새로운 치료가 시작되었다. 처치 목록과 처방란을 함께 본다.',
    '자하거 약침 2cc (대한약침학회 제조, 2cc 앰플)'),
  ti('ti-2-2', 2, 'observation', '9b',
    '침 치료의 혈위, 침 규격, 유침 시간이 어디에 적혀 있는지 본다.',
    '(0.20x30mm, 유침 20분)'),
  ti('ti-2-3', 2, 'observation', '9b',
    '약침은 부위별 용량까지 적혀 있다.',
    '풍지 양측 각 0.5cc, 풍부 0.5cc, 견정 양측 각 0.25cc'),
  ti('ti-2-4', 2, 'observation', '9b',
    '집에서 하도록 교육한 자가 치료가 있고 횟수와 시간이 적혀 있다.',
    '자율훈련법 (귀가 후 1일 2회, 회당 10분 시행하도록 교육)'),

  // 3회차 (3/18)
  ti('ti-3-1', 3, 'question', '9c',
    '약 복용 시간에 대한 안내가 이후 방문에서 어떻게 되었는지 살펴본다.',
    '도네페질 복용 시간 저녁 -> 아침으로 바꿔보라고 신경과에 문의해보시라 안내함.'),
  ti('ti-3-2', 3, 'observation', '9a',
    '상담(지언고론요법)에서 다룬 생활 지도 내용이 적혀 있다.',
    '유산소 운동 필요하다 설명 (남편에게도)'),
  ti('ti-3-3', 3, 'question', '9b',
    '이날 침·약침 처방이 지난 방문과 같은지, 달라진 것이 있는지 비교해 본다.',
    '자하거 약침 2cc: 풍지 양측 각 0.5cc, 풍부 0.5cc, 견정 양측 각 0.25cc'),

  // 4회차 (4/1)
  ti('ti-4-1', 4, 'observation', '9b',
    '첫 한약(3/11분) 복용이 끝난 시점이 적혀 있다.',
    '황련해독탕 3/11분 다 복용함.'),
  ti('ti-4-2', 4, 'observation', '9c',
    '지난번 안내한 약 복용 시간 변경이 실제로 이루어졌다는 기록이 있다.',
    '도네페질 복용 시간 아침으로 바꿨다고 함.'),
  ti('ti-4-3', 4, 'observation', '9a',
    '다른 과 진료와 약 복용을 다시 권유한 내용이 상담 기록에 있다.',
    '정신건강의학과 재진 및 약 복용 다시 권유'),

  // 5회차 (4/15)
  ti('ti-5-1', 5, 'observation', '9a',
    '한방 치료 외에 이 시기에 달라진 것이 있다(다른 병원 약).',
    '4/8 신규 정신과 재진(딸 동반). 약 처방받아 이번엔 먹고 있음.'),
  ti('ti-5-2', 5, 'observation', '9c',
    '시술 부위가 추가되었고 그 이유가 적혀 있다.',
    '안와부 다크서클 호소하여 약침 부위 추가'),
  ti('ti-5-3', 5, 'observation', '9b',
    '한약이 다시 처방되었다. 용량·기간이 처음 처방과 같은지 본다.',
    '황련해독탕 4/15 2주 (한신, 보험한약 가루약 5.61g/3포, 1일 3회 식후 30분 복용)'),
  ti('ti-5-4', 5, 'question', '9b',
    '약침 부위별 용량이 지난 방문과 달라졌는지 비교해 본다.',
    '풍지 양측 각 0.4cc, 풍부 0.4cc, 견정 양측 각 0.2cc, 안와부 양측 각 0.2cc'),

  // 6회차 (5/27)
  ti('ti-6-1', 6, 'observation', '9a',
    '복용 중인 다른 병원 약의 이름과 용량이 이날 기록에 적혀 있다.',
    '암로디핀 5mg qd (아침)'),
  ti('ti-6-2', 6, 'observation', '9b',
    '두 번째 한약 복용이 끝난 날짜가 적혀 있다.',
    '황련해독탕 4/15분 복용 후 4/29 종료.'),
  ti('ti-6-3', 6, 'observation', '9c',
    '이전까지 해 온 치료 중 이날 하지 않은 것이 있다.',
    '약침은 이번엔 안 함.'),
  ti('ti-6-4', 6, 'observation', '9c',
    '치료 간격이 어떻게 바뀌었는지 상담 기록 끝에 적혀 있다.',
    '내원 간격 연장. 4주 후 f/u, 이후 월 1회 유지하며 경과 관찰.')
];

/** 추천이 가리키는 구절이 해당 방문 원기록에 그대로 있는지 (테스트와 서버 기동 시 자가 점검에 쓴다). */
export function findMemoSuggestionAnchorErrors(
  suggestions: StudyMemoSuggestionV2[] = DEFAULT_STUDY_MEMO_SUGGESTIONS_V2
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of suggestions) {
    if (seen.has(item.id)) errors.push(`duplicate id: ${item.id}`);
    seen.add(item.id);
    const visit = DEFAULT_STUDY_CASE.visits.find((entry) => entry.index === item.visitIndex);
    if (!visit) {
      errors.push(`${item.id}: visit ${item.visitIndex} not found`);
      continue;
    }
    if (!visit.soapText.includes(item.recordAnchor)) {
      errors.push(`${item.id}: anchor not found verbatim in visit ${item.visitIndex}: "${item.recordAnchor}"`);
    }
  }
  return errors;
}
