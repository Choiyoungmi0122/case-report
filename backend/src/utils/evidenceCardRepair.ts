function normalizeWhitespace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function mergeTerms(left: any[] = [], right: any[] = []): any[] {
  const merged = new Map<string, any>();
  for (const term of [...left, ...right]) {
    const key = String(term?.termId || term?.normalizedTerm || term?.surface || '').trim();
    if (key && !merged.has(key)) merged.set(key, term);
  }
  return Array.from(merged.values());
}

function joinsSingleLetterClinicalAbbreviation(left: string, right: string): boolean {
  return /(?:^|[^A-Za-z])([A-Za-z])\.$/.test(left.trim()) && /^[a-z][A-Za-z-]*/.test(right.trim());
}

function resolveVisitText(visits: any[], visitIndex: number): string {
  const visit = visits.find(
    (item: any, index: number) => Number(item?.index ?? item?.visitIndex ?? index + 1) === visitIndex
  );
  return normalizeWhitespace(visit?.soapText ?? visit?.sanitizedText ?? visit?.text ?? '');
}

export interface EvidenceCardRepairResult {
  cards: any[];
  idRedirects: Record<string, string>;
}

/**
 * Repairs legacy cards split inside a clinical abbreviation such as
 * "H. pylori", "E. coli", or "S. aureus". A merge is allowed only when the
 * reconstructed text is present in the original visit.
 */
export function repairSplitClinicalEvidenceCards(
  evidenceCards: any[] = [],
  visits: any[] = []
): EvidenceCardRepairResult {
  const cards: any[] = [];
  const idRedirects: Record<string, string> = {};

  for (let index = 0; index < evidenceCards.length; index += 1) {
    const current = evidenceCards[index];
    const next = evidenceCards[index + 1];
    const currentText = String(current?.sourceText || current?.normalizedText || '').trim();
    const nextText = String(next?.sourceText || next?.normalizedText || '').trim();
    const visitIndex = Number(current?.visitIndex || 0);
    const sameVisit = visitIndex > 0 && visitIndex === Number(next?.visitIndex || 0);
    const mergedSourceText = `${currentText} ${nextText}`.trim();
    const visitText = sameVisit ? resolveVisitText(visits, visitIndex) : '';
    const groundedMerge =
      sameVisit &&
      joinsSingleLetterClinicalAbbreviation(currentText, nextText) &&
      Boolean(visitText) &&
      visitText.includes(normalizeWhitespace(mergedSourceText));

    if (!groundedMerge) {
      cards.push(current);
      continue;
    }

    const currentNormalized = String(current?.normalizedText || currentText).trim();
    const nextNormalized = String(next?.normalizedText || nextText).trim();
    cards.push({
      ...current,
      sourceText: mergedSourceText,
      normalizedText: `${currentNormalized} ${nextNormalized}`.trim(),
      evidenceType:
        current?.evidenceType && current.evidenceType !== 'other'
          ? current.evidenceType
          : next?.evidenceType || 'other',
      tags: uniqueStrings([...(current?.tags || []), ...(next?.tags || [])]),
      sectionHints: uniqueStrings([
        ...(current?.sectionHints || []),
        ...(next?.sectionHints || [])
      ]),
      terms: mergeTerms(current?.terms, next?.terms),
      sourceRef: {
        ...(current?.sourceRef || {}),
        charEnd: next?.sourceRef?.charEnd ?? current?.sourceRef?.charEnd,
        lineEnd: next?.sourceRef?.lineEnd ?? current?.sourceRef?.lineEnd
      },
      confidence: Math.min(
        Number.isFinite(Number(current?.confidence)) ? Number(current.confidence) : 1,
        Number.isFinite(Number(next?.confidence)) ? Number(next.confidence) : 1
      )
    });

    const currentId = String(current?.id || '').trim();
    const nextId = String(next?.id || '').trim();
    if (currentId && nextId) idRedirects[nextId] = currentId;
    index += 1;
  }

  return { cards, idRedirects };
}
