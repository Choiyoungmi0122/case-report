import { normalizeUnicodeText } from '../utils/unicode';
import {
  RetrievedTermCandidate,
  SemanticMatchProvider,
  TermDbEntry,
  TermMatchType
} from './types';

export const MIN_FUZZY_CONFIDENCE = 0.74;
export const AMBIGUOUS_DELTA = 0.08;

type IndexedVariant = {
  term: TermDbEntry;
  variant: string;
  normalizedVariant: string;
  kind: 'standard' | 'synonym' | 'typo' | 'alias';
};

export interface TermRetrieverOptions {
  entries: TermDbEntry[];
  semanticMatcher?: SemanticMatchProvider;
  maxCandidates?: number;
}

function clampScore(score: number): number {
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export function normalizeLookupKey(text: string): string {
  return normalizeUnicodeText(text)
    .toLowerCase()
    .replace(/[\s\-_/\\.,:;'"!?()[\]{}]/g, '');
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

function buildVariantIndex(entries: TermDbEntry[]): IndexedVariant[] {
  return entries.flatMap((term) => {
    const variants: Array<{ variant: string; kind: IndexedVariant['kind'] }> = [
      { variant: term.standardTerm, kind: 'standard' },
      ...term.synonyms.map((variant) => ({ variant, kind: 'synonym' as const })),
      ...term.typoVariants.map((variant) => ({ variant, kind: 'typo' as const })),
      ...term.aliases.map((variant) => ({ variant, kind: 'alias' as const }))
    ];

    return variants
      .map((item) => ({
        term,
        variant: normalizeUnicodeText(item.variant),
        normalizedVariant: normalizeLookupKey(item.variant),
        kind: item.kind
      }))
      .filter((item) => item.normalizedVariant.length > 0);
  });
}

function toCandidate(
  original: string,
  matchType: TermMatchType,
  score: number,
  indexedVariant: IndexedVariant
): RetrievedTermCandidate {
  return {
    termId: indexedVariant.term.termId,
    original,
    standardTerm: indexedVariant.term.standardTerm,
    score: clampScore(score),
    matchType,
    variant: indexedVariant.variant,
    variantType: indexedVariant.kind,
    term: indexedVariant.term
  };
}

function dedupeCandidates(candidates: RetrievedTermCandidate[], maxCandidates: number): RetrievedTermCandidate[] {
  const byTermId = new Map<string, RetrievedTermCandidate>();
  const priority: Record<TermMatchType, number> = {
    exact: 0,
    synonym: 1,
    typo: 2,
    alias: 3,
    fuzzy: 4,
    partial: 5,
    semantic: 6
  };

  for (const candidate of candidates) {
    const existing = byTermId.get(candidate.termId);
    if (!existing) {
      byTermId.set(candidate.termId, candidate);
      continue;
    }

    if (priority[candidate.matchType] < priority[existing.matchType] || candidate.score > existing.score) {
      byTermId.set(candidate.termId, candidate);
    }
  }

  return Array.from(byTermId.values())
    .sort((a, b) => {
      if (priority[a.matchType] !== priority[b.matchType]) {
        return priority[a.matchType] - priority[b.matchType];
      }
      return b.score - a.score;
    })
    .slice(0, maxCandidates);
}

export async function retrieveTermCandidates(
  surface: string,
  options: TermRetrieverOptions
): Promise<RetrievedTermCandidate[]> {
  const entries = options.entries || [];
  const normalizedSurface = normalizeUnicodeText(surface);
  const normalizedKey = normalizeLookupKey(normalizedSurface);
  if (!normalizedKey) return [];

  const maxCandidates = Math.max(1, options.maxCandidates || 3);
  const variants = buildVariantIndex(entries);
  const candidates: RetrievedTermCandidate[] = [];

  for (const variant of variants) {
    if (variant.kind === 'standard' && variant.variant.toLowerCase().trim() === normalizedSurface.toLowerCase().trim()) {
      candidates.push(toCandidate(normalizedSurface, 'exact', 1, variant));
      continue;
    }
    if (variant.kind === 'synonym' && variant.normalizedVariant === normalizedKey) {
      candidates.push(toCandidate(normalizedSurface, 'synonym', 0.97, variant));
      continue;
    }
    if (variant.kind === 'typo' && variant.normalizedVariant === normalizedKey) {
      candidates.push(toCandidate(normalizedSurface, 'typo', 0.93, variant));
      continue;
    }
    if (variant.kind === 'alias' && variant.normalizedVariant === normalizedKey) {
      candidates.push(toCandidate(normalizedSurface, 'alias', 0.9, variant));
    }
  }

  if (candidates.length > 0) {
    return dedupeCandidates(candidates, maxCandidates);
  }

  const fuzzyMatches = variants
    .map((variant) => ({
      variant,
      score: similarity(normalizedKey, variant.normalizedVariant)
    }))
    .filter((item) => item.score >= MIN_FUZZY_CONFIDENCE)
    .sort((a, b) => b.score - a.score)
    .map((item) => toCandidate(normalizedSurface, 'fuzzy', item.score, item.variant));

  if (fuzzyMatches.length > 0) {
    return dedupeCandidates(fuzzyMatches, maxCandidates);
  }

  const partialMatches =
    normalizedKey.length < 2
      ? []
      : variants
          .filter((variant) => {
            const keyLen = variant.normalizedVariant.length;
            const ratio = Math.min(normalizedKey.length, keyLen) / Math.max(normalizedKey.length, keyLen);
            if (ratio < 0.4) return false;
            return (
              variant.normalizedVariant.includes(normalizedKey) ||
              normalizedKey.includes(variant.normalizedVariant)
            );
          })
          .map((variant) =>
            toCandidate(
              normalizedSurface,
              'partial',
              Math.min(normalizedKey.length, variant.normalizedVariant.length) /
                Math.max(normalizedKey.length, variant.normalizedVariant.length),
              variant
            )
          );

  if (partialMatches.length > 1) {
    return dedupeCandidates(partialMatches, maxCandidates);
  }

  if (options.semanticMatcher) {
    try {
      const semanticMatches = await Promise.resolve(options.semanticMatcher.search(normalizedSurface, entries));
      const semanticCandidates = ((semanticMatches || [])
        .map((item) => {
          const term = entries.find((entry) => entry.termId === item.termId);
          if (!term) return null;
          return {
            termId: term.termId,
            original: normalizedSurface,
            standardTerm: term.standardTerm,
            score: clampScore(item.confidence),
            matchType: 'semantic' as const,
            variant: item.standardTerm || term.standardTerm,
            variantType: 'semantic' as const,
            term
          };
        })
        .filter(Boolean)) as RetrievedTermCandidate[];

      if (semanticCandidates.length > 0) {
        return dedupeCandidates(semanticCandidates, maxCandidates);
      }
    } catch (error) {
      console.warn('[RAG] Semantic matcher failed, falling back to lexical/fuzzy retrieval:', error);
    }
  }

  return [];
}
