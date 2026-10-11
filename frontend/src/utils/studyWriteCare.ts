import type { StudyWriteSection } from '../services/api';

/**
 * 섹션의 CARE 세부 항목 준수율. "있음"과 "해당 없음"을 충족으로 본다.
 * 점검 결과가 없으면 null.
 */
export type CareCompliance = {
  total: number;
  ok: number;
  pct: number;
  requiredTotal: number;
  requiredOk: number;
  requiredPct: number | null;
};

const satisfied = (status: string) => status === 'present' || status === 'not_applicable';

export function careCompliance(section: Pick<StudyWriteSection, 'careCheck'> | null | undefined): CareCompliance | null {
  const items = section?.careCheck?.items;
  if (!items || items.length === 0) return null;
  const required = items.filter((item) => item.required);
  const ok = items.filter((item) => satisfied(item.status)).length;
  const requiredOk = required.filter((item) => satisfied(item.status)).length;
  return {
    total: items.length,
    ok,
    pct: Math.round((ok / items.length) * 100),
    requiredTotal: required.length,
    requiredOk,
    requiredPct: required.length ? Math.round((requiredOk / required.length) * 100) : null
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
  return {
    total,
    ok,
    pct: total ? Math.round((ok / total) * 100) : 0,
    requiredTotal,
    requiredOk,
    requiredPct: requiredTotal ? Math.round((requiredOk / requiredTotal) * 100) : null
  };
}

/** 색 단계: 모두 충족 → good, 필수 빠짐 → bad, 그 밖 → mid */
export function complianceLevel(value: CareCompliance | null): 'good' | 'mid' | 'bad' | 'none' {
  if (!value) return 'none';
  if (value.requiredPct !== null && value.requiredPct < 100) return 'bad';
  if (value.pct === 100) return 'good';
  return 'mid';
}
