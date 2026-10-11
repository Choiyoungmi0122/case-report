/**
 * 근거 카드가 어느 CARE 섹션에 속하는지 보는 기준을 한 곳에 둔다.
 *
 * 기준: `tags ∪ sectionHints`. 2026-10-11까지는 CHAIN3·공개 단계가 tags∪sectionHints 를, CHAIN4/5 범위·CHAIN6·검토가
 * tags 만 썼다(docs/prompt_chain_review_v1.md §2-1). 그래서 초안을 쓸 때 쓰인 카드를 검토·갱신 단계가 보지 못해
 * 초안 문장이 "근거 없음"으로 판정되는 일이 있었다. 이제 모든 단계가 이 함수를 쓴다.
 */
import { CareSection, coerceCareSection } from './schemas/common';

export type EvidenceCardLike = {
  tags?: unknown[] | null;
  sectionHints?: unknown[] | null;
};

/** 카드가 속한 섹션(중복·알아볼 수 없는 값 제거). */
export function cardSections(card: EvidenceCardLike | null | undefined): CareSection[] {
  const out: CareSection[] = [];
  for (const raw of [...(card?.tags || []), ...(card?.sectionHints || [])]) {
    const section = coerceCareSection(raw);
    if (section && !out.includes(section)) out.push(section);
  }
  return out;
}

export function cardMatchesSection(card: EvidenceCardLike | null | undefined, sectionId: string): boolean {
  const target = coerceCareSection(sectionId);
  if (!target) return false;
  return cardSections(card).includes(target);
}

/** 한 섹션과 관련된 카드. */
export function getRelevantEvidence<T extends EvidenceCardLike>(
  evidenceCards: T[] | null | undefined,
  sectionId: string
): T[] {
  return (evidenceCards || []).filter((card) => cardMatchesSection(card, sectionId));
}

/** 여러 섹션 중 하나라도 관련된 카드(순서 유지). */
export function getEvidenceForSections<T extends EvidenceCardLike>(
  evidenceCards: T[] | null | undefined,
  sectionIds: Iterable<string>
): T[] {
  const targets = new Set<CareSection>();
  for (const id of sectionIds) {
    const section = coerceCareSection(id);
    if (section) targets.add(section);
  }
  if (targets.size === 0) return [];
  return (evidenceCards || []).filter((card) => cardSections(card).some((section) => targets.has(section)));
}
