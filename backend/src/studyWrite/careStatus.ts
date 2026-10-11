import { StudyWriteCareItemStatus } from '../types/studyWrite';

/** 2026-10-11 판에서 판정을 못 받은 항목에 붙였던 hint 의 앞부분 */
export const LEGACY_UNCHECKED_HINT_PREFIX = '점검 결과를 받지 못한 항목';

/**
 * 화면·연구 요약에서 쓰는 상태. 2026-10-11 판의 "not_in_record + 판정 못 받음 hint"를 'unchecked' 로 본다.
 * 저장된 값은 바꾸지 않는다.
 */
export function effectiveCareStatus(item: { status: string; hint?: string }): StudyWriteCareItemStatus {
  if (item.status === 'not_in_record' && String(item.hint || '').startsWith(LEGACY_UNCHECKED_HINT_PREFIX)) return 'unchecked';
  return item.status as StudyWriteCareItemStatus;
}

/** 충족: 있음 또는 해당 없음 */
export function isCareSatisfied(status: string): boolean {
  return status === 'present' || status === 'not_applicable';
}

/** 판정을 받은 항목(준수율의 분모) */
export function isCareJudged(status: string): boolean {
  return status !== 'unchecked';
}
