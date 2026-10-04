import { DeidReplacementContext, ReplacementMap, PHISpan, PHIType } from './types';

function typePrefix(type: PHIType): string {
  return type;
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

export function applyPlaceholderReplacement(
  text: string,
  phiSpans: PHISpan[],
  sharedContext?: DeidReplacementContext
): {
  deidentifiedText: string;
  phiSpans: PHISpan[];
  replacementMap: ReplacementMap[];
} {
  // Detection resolves overlaps, but stay defensive here: a span starting before the cursor would
  // rewind it and re-emit already-consumed source text (i.e. leak the PHI it was meant to remove).
  const sorted = [...phiSpans]
    .sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)
    .filter((span, index, array) => index === 0 || span.startIndex >= array[index - 1].endIndex);

  const entryByKey = new Map<string, { type: PHIType; originalText: string; replacement: string; occurrences: number }>();
  const countByType = sharedContext?.countByType || new Map<PHIType, number>();
  const replacementByKey = sharedContext?.replacementByKey || new Map<string, string>();
  const occurrenceByKey = sharedContext?.occurrenceByKey || new Map<string, number>();

  const hydratedSpans = sorted.map((span) => {
    const key = `${span.type}:${span.originalText}`;
    const existingReplacement = replacementByKey.get(key);
    const replacement =
      existingReplacement ||
      (() => {
        const nextIndex = (countByType.get(span.type) || 0) + 1;
        countByType.set(span.type, nextIndex);
        const nextReplacement = `[${typePrefix(span.type)}_${nextIndex}]`;
        replacementByKey.set(key, nextReplacement);
        return nextReplacement;
      })();

    let entry = entryByKey.get(key);
    if (!entry) {
      entry = {
        type: span.type,
        originalText: span.originalText,
        replacement,
        occurrences: 0
      };
      entryByKey.set(key, entry);
    }

    entry.occurrences += 1;
    occurrenceByKey.set(key, (occurrenceByKey.get(key) || 0) + 1);

    return {
      ...span,
      replacement,
      confidence: clampConfidence(span.confidence)
    };
  });

  let result = '';
  let cursor = 0;

  for (const span of hydratedSpans) {
    result += text.slice(cursor, span.startIndex);
    result += span.replacement;
    cursor = span.endIndex;
  }
  result += text.slice(cursor);

  const replacementMap: ReplacementMap[] = Array.from(entryByKey.values()).map((entry) => ({
    type: entry.type,
    originalText: entry.originalText,
    replacement: entry.replacement,
    occurrences: occurrenceByKey.get(`${entry.type}:${entry.originalText}`) || entry.occurrences || 1
  }));

  return {
    deidentifiedText: result,
    phiSpans: hydratedSpans,
    replacementMap
  };
}
