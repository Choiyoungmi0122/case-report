import { DEFAULT_STUDY_CASE, DEFAULT_STUDY_RECORD_POINTERS, type StudyRecordPointer } from './defaultStudyCase';

/**
 * Scaffold V2(v3.0) 치료 개입 Step 2 의 '기록에서 관련된 부분' (2026-10-12).
 * V2 는 ti_003 질문을 "치료를 바꾼 내용과 그 이유"(CARE 9c)로 좁혔다(frontend/src/utils/scaffoldV2Guide.ts
 * TI_SUFFICIENCY_QUESTIONS_V2). 그래서 내약성(4회차 속 불편감 없음)처럼 10c·10d 에 속하는 구절을 빼고,
 * 바꾼 내용과 그 이유가 적힌 구절로 바꾼다. 나머지 질문은 V1 과 같다. V1 화면은 DEFAULT_STUDY_RECORD_POINTERS 를 그대로 쓴다.
 * 모든 인용은 원기록에 그대로 있어야 한다(findRecordPointerQuoteErrors, tests/study/studyMode.test.ts).
 */
export const STUDY_RECORD_POINTER_OVERRIDES_V2: Record<string, StudyRecordPointer> = {
  ti_003: {
    quotes: [
      { visitIndex: 3, quote: '도네페질 복용 시간 저녁 -> 아침으로 바꿔보라고 신경과에 문의해보시라 안내함.' },
      { visitIndex: 5, quote: '안와부 다크서클 호소하여 약침 부위 추가' },
      { visitIndex: 6, quote: '약침은 이번엔 안 함. (안와부 멍 있었던 후라 환자가 원치 않음)' },
      { visitIndex: 6, quote: '다크서클 아직 있다고 하여 태양 추가.' },
      { visitIndex: 6, quote: '한약 처방 없음 (황련해독탕은 4/29 종료)' },
      { visitIndex: 6, quote: '신규 정신과 (4/8~): 쿠에티아핀 25mg qhs.' }
    ]
  }
};

export const DEFAULT_STUDY_RECORD_POINTERS_V2: Record<string, StudyRecordPointer> = {
  ...DEFAULT_STUDY_RECORD_POINTERS,
  ...STUDY_RECORD_POINTER_OVERRIDES_V2
};

/** 인용이 해당 회차 원기록에 그대로 있는지 확인한다. 빈 배열이면 모두 맞다. */
export function findRecordPointerQuoteErrors(
  pointers: Record<string, StudyRecordPointer> = DEFAULT_STUDY_RECORD_POINTERS_V2
): string[] {
  const errors: string[] = [];
  for (const [questionId, pointer] of Object.entries(pointers)) {
    for (const item of pointer.quotes) {
      const visit = DEFAULT_STUDY_CASE.visits.find((entry) => entry.index === item.visitIndex);
      if (!visit) errors.push(`${questionId}: visit ${item.visitIndex} not found`);
      else if (!visit.soapText.includes(item.quote)) {
        errors.push(`${questionId}: quote not found verbatim in visit ${item.visitIndex}: "${item.quote}"`);
      }
    }
  }
  return errors;
}
