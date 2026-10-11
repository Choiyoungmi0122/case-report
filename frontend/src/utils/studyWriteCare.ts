import type { StudyWriteCareItemStatus, StudyWriteSection } from '../services/api';

/**
 * 섹션의 CARE 세부 항목 준수율. "있음"과 "해당 없음"을 충족으로 본다.
 * 판정 없음(unchecked)은 충족도 누락도 아니므로 분모에서 빼고 따로 센다.
 * 점검 결과가 없으면 null.
 */
export type CareCompliance = {
  /** 판정을 받은 항목 수 (준수율의 분모) */
  total: number;
  ok: number;
  pct: number;
  requiredTotal: number;
  requiredOk: number;
  requiredPct: number | null;
  /** 판정 없음 */
  unchecked: number;
};

/** 2026-10-11 판에서 판정을 못 받은 항목에 붙였던 hint 의 앞부분 (backend/src/studyWrite/careStatus.ts 와 같다) */
const LEGACY_UNCHECKED_HINT_PREFIX = '점검 결과를 받지 못한 항목';

/** 화면에 보일 상태. 2026-10-11 판의 "없음 + 판정 못 받음" 항목을 판정 없음으로 본다. */
export function effectiveCareStatus(item: { status: StudyWriteCareItemStatus; hint?: string }): StudyWriteCareItemStatus {
  if (item.status === 'not_in_record' && String(item.hint || '').startsWith(LEGACY_UNCHECKED_HINT_PREFIX)) return 'unchecked';
  return item.status;
}

export const isCareSatisfied = (status: string) => status === 'present' || status === 'not_applicable';

export function careCompliance(section: Pick<StudyWriteSection, 'careCheck'> | null | undefined): CareCompliance | null {
  const items = section?.careCheck?.items;
  if (!items || items.length === 0) return null;
  const judged = items.filter((item) => effectiveCareStatus(item) !== 'unchecked');
  const required = judged.filter((item) => item.required);
  const ok = judged.filter((item) => isCareSatisfied(effectiveCareStatus(item))).length;
  const requiredOk = required.filter((item) => isCareSatisfied(effectiveCareStatus(item))).length;
  return {
    total: judged.length,
    ok,
    pct: judged.length ? Math.round((ok / judged.length) * 100) : 0,
    requiredTotal: required.length,
    requiredOk,
    requiredPct: required.length ? Math.round((requiredOk / required.length) * 100) : null,
    unchecked: items.length - judged.length
  };
}

/** 여러 섹션을 합친 준수율 (항목 수 기준) */
export function overallCareCompliance(sections: Array<Pick<StudyWriteSection, 'careCheck'>>): CareCompliance | null {
  const parts = sections.map(careCompliance).filter((item): item is CareCompliance => item !== null);
  if (parts.length === 0) return null;
  const total = parts.reduce((sum, item) => sum + item.total, 0);
  const ok = parts.reduce((sum, item) => sum + item.ok, 0);
  const requiredTotal = parts.reduce((sum, item) => sum + item.requiredTotal, 0);
  const requiredOk = parts.reduce((sum, item) => sum + item.requiredOk, 0);
  const unchecked = parts.reduce((sum, item) => sum + item.unchecked, 0);
  return {
    total,
    ok,
    pct: total ? Math.round((ok / total) * 100) : 0,
    requiredTotal,
    requiredOk,
    requiredPct: requiredTotal ? Math.round((requiredOk / requiredTotal) * 100) : null,
    unchecked
  };
}

/** 색 단계: 필수 빠짐 → bad, 모두 충족이고 판정 없음도 없음 → good, 그 밖 → mid */
export function complianceLevel(value: CareCompliance | null): 'good' | 'mid' | 'bad' | 'none' {
  if (!value) return 'none';
  if (value.requiredPct !== null && value.requiredPct < 100) return 'bad';
  if (value.pct === 100 && value.unchecked === 0) return 'good';
  return 'mid';
}

/** 툴팁 등에 붙이는 "· 판정 없음 n" */
export function uncheckedSuffix(value: CareCompliance | null): string {
  return value && value.unchecked > 0 ? ` · 판정 없음 ${value.unchecked}` : '';
}

/**
 * 하위 요소(체크리스트 v2) 준수율. 항목 단위와 달리 "해당 없음"은 분모에서 뺀다(조건이 맞지 않거나 쓰지 않은 개입).
 * 판정 없음도 분모에서 뺀다. 하위 요소가 없으면 null.
 */
export type CareSubCompliance = {
  /** 해당되는(판정 받고 해당 없음이 아닌) 하위 요소 수 */
  applicable: number;
  present: number;
  pct: number;
  requiredApplicable: number;
  requiredPresent: number;
  notApplicable: number;
  unchecked: number;
};

type SubItemLike = { status: StudyWriteCareItemStatus; required: boolean };

export function subCompliance(subItems: SubItemLike[] | undefined): CareSubCompliance | null {
  if (!subItems || subItems.length === 0) return null;
  const judged = subItems.filter((sub) => sub.status !== 'unchecked');
  const applicable = judged.filter((sub) => sub.status !== 'not_applicable');
  const required = applicable.filter((sub) => sub.required);
  const present = applicable.filter((sub) => sub.status === 'present').length;
  return {
    applicable: applicable.length,
    present,
    pct: applicable.length ? Math.round((present / applicable.length) * 100) : 100,
    requiredApplicable: required.length,
    requiredPresent: required.filter((sub) => sub.status === 'present').length,
    notApplicable: judged.length - applicable.length,
    unchecked: subItems.length - judged.length
  };
}

/** 섹션 전체의 하위 요소 준수율 */
export function sectionSubCompliance(section: Pick<StudyWriteSection, 'careCheck'> | null | undefined): CareSubCompliance | null {
  const subs = (section?.careCheck?.items || []).flatMap((item) => item.subItems || []);
  return subCompliance(subs);
}

/** 항목은 "있음"인데 해당되는 필수 하위 요소가 빠졌으면 "일부"로 보여 준다 (저장된 판정은 그대로) */
export function isPartialItem(item: { status: StudyWriteCareItemStatus; subItems?: SubItemLike[] }): boolean {
  if (item.status !== 'present') return false;
  const c = subCompliance(item.subItems);
  return Boolean(c && c.requiredPresent < c.requiredApplicable);
}
