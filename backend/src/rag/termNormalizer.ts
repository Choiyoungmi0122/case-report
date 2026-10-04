import { CareSection } from '../types';
import { normalizeUnicodeText } from '../utils/unicode';
import { seedTermDb } from './termDb';
import { resolveRetrievedTerminology, RetrievedTermResolver } from './resolver';
import { retrieveTermCandidates } from './retriever';
import {
  MatchVariantType,
  NormalizeTextResult,
  SemanticMatchCandidate,
  SemanticMatchProvider,
  TermDbEntry,
  TermNormalizationCandidate,
  TermNormalizationResult
} from './types';

type IndexedVariant = {
  term: TermDbEntry;
  variant: string;
  variantType: MatchVariantType;
  normalizedKey: string;
  /** Precompiled once so the hot path never recompiles it per call. */
  regex: RegExp;
  /** variant.toLowerCase().trim(), precomputed for the 'standard' exact lookup. */
  canonical: string;
};

type DetectedMatch = {
  start: number;
  end: number;
  surface: string;
  result: TermNormalizationResult;
  term: TermDbEntry;
  sectionHints: CareSection[];
};

export interface TermNormalizerOptions {
  semanticMatcher?: SemanticMatchProvider;
  llmResolver?: RetrievedTermResolver;
}

const MIN_FUZZY_CONFIDENCE = 0.74;
const AMBIGUOUS_DELTA = 0.08;
const TOKEN_REGEX = /[A-Za-z]+(?:-[A-Za-z0-9]+)*|[\p{Script=Hangul}A-Za-z0-9]+/gu;
const GENERIC_STANDALONE_SURFACES = new Set(['\uCE58\uB8CC']);
const DEIDENTIFIED_PLACEHOLDER_REGEX = /\[[A-Z]+(?:_[A-Z0-9]+)*\]/g;

const indexedVariants = buildVariantIndex(seedTermDb);
// Direct-match variants sorted longest-first, precompiled once (matchAll clones the regex, so
// reusing a shared /g instance across calls is safe).
const directMatchVariants = [...indexedVariants].sort((a, b) => b.variant.length - a.variant.length);
// O(1) surface lookups: 'standard' by canonical form, everything else by normalized key.
const standardVariantIndex = buildStandardVariantIndex(indexedVariants);
const variantIndexByType = buildVariantIndexByType(indexedVariants);

function buildVariantIndex(entries: TermDbEntry[]): IndexedVariant[] {
  return entries.flatMap((term) => {
    const variants: ReadonlyArray<readonly [string, MatchVariantType]> = [
      [term.standardTerm, 'standard'],
      ...term.synonyms.map((item) => [item, 'synonym'] as const),
      ...term.typoVariants.map((item) => [item, 'typo'] as const),
      ...term.aliases.map((item) => [item, 'alias'] as const)
    ];

    return variants
      .map(([variant, variantType]) => {
        const normalized = normalizeUnicodeText(variant);
        return {
          term,
          variant: normalized,
          variantType,
          normalizedKey: normalizeLookupKey(variant),
          regex: new RegExp(escapeRegex(normalized), 'giu'),
          canonical: normalized.toLowerCase().trim()
        };
      })
      .filter((item) => item.normalizedKey.length > 0);
  });
}

function buildStandardVariantIndex(variants: IndexedVariant[]): Map<string, IndexedVariant[]> {
  const index = new Map<string, IndexedVariant[]>();
  for (const variant of variants) {
    if (variant.variantType !== 'standard') continue;
    const bucket = index.get(variant.canonical);
    if (bucket) bucket.push(variant);
    else index.set(variant.canonical, [variant]);
  }
  return index;
}

function buildVariantIndexByType(
  variants: IndexedVariant[]
): Map<MatchVariantType, Map<string, IndexedVariant[]>> {
  const index = new Map<MatchVariantType, Map<string, IndexedVariant[]>>();
  for (const variant of variants) {
    let byKey = index.get(variant.variantType);
    if (!byKey) {
      byKey = new Map<string, IndexedVariant[]>();
      index.set(variant.variantType, byKey);
    }
    const bucket = byKey.get(variant.normalizedKey);
    if (bucket) bucket.push(variant);
    else byKey.set(variant.normalizedKey, [variant]);
  }
  return index;
}

export function normalizeLookupKey(text: string): string {
  return normalizeUnicodeText(text)
    .toLowerCase()
    .replace(/[\s\-_/\\.,:;'"!?()[\]{}]/g, '');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
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

function uniqueByTermId(
  items: Array<{ term: TermDbEntry; confidence: number }>
): Array<{ term: TermDbEntry; confidence: number }> {
  const byTerm = new Map<string, { term: TermDbEntry; confidence: number }>();

  for (const item of items) {
    const existing = byTerm.get(item.term.termId);
    if (!existing || item.confidence > existing.confidence) {
      byTerm.set(item.term.termId, item);
    }
  }

  return Array.from(byTerm.values()).sort((a, b) => b.confidence - a.confidence);
}

function buildCandidates(
  matches: Array<{ term: TermDbEntry; confidence: number }>
): TermNormalizationCandidate[] {
  return uniqueByTermId(matches)
    .slice(0, 3)
    .map((item) => ({
      termId: item.term.termId,
      standardTerm: item.term.standardTerm,
      confidence: clampConfidence(item.confidence)
    }));
}

function buildResolvedResult(params: {
  surface: string;
  term: TermDbEntry;
  matchType: TermNormalizationResult['matchType'];
  confidence: number;
  candidates?: TermNormalizationCandidate[];
  needsUserConfirmation?: boolean;
}): TermNormalizationResult {
  const { surface, term, matchType, confidence, candidates } = params;
  const policyNeedsConfirmation =
    term.normalizationPolicy === 'REQUIRE_CONFIRMATION' &&
    !['exact', 'synonym'].includes(matchType);
  const needsUserConfirmation = Boolean(params.needsUserConfirmation || policyNeedsConfirmation);
  const shouldPreserveOriginal =
    term.normalizationPolicy === 'PRESERVE_ORIGINAL' || term.preserveSurfaceForm === true;
  const normalizedTerm = shouldPreserveOriginal
    ? term.standardTerm
    : needsUserConfirmation
      ? ''
      : term.standardTerm;
  const resolvedCandidates =
    needsUserConfirmation && (!candidates || candidates.length === 0)
      ? [
          {
            termId: term.termId,
            standardTerm: term.standardTerm,
            confidence: clampConfidence(confidence)
          }
        ]
      : candidates;

  return {
    surface,
    normalizedTerm,
    termId: term.termId,
    category: term.category,
    matchType,
    confidence: clampConfidence(confidence),
    needsUserConfirmation,
    semanticTags: term.semanticTags || [],
    relatedTerms: term.relatedTerms || [],
    normalizationPolicy: term.normalizationPolicy,
    evidenceUsage: term.evidenceUsage,
    riskLevel: term.riskLevel,
    preserveSurfaceForm: term.preserveSurfaceForm,
    usagePolicy: term.usagePolicy,
    reviewerNote: term.reviewerNote || '',
    ...(resolvedCandidates && resolvedCandidates.length > 0 ? { candidates: resolvedCandidates } : {})
  };
}

function getSemanticSectionHints(term: TermDbEntry): CareSection[] {
  const hints = new Set<CareSection>(term.sectionHints as CareSection[]);

  switch (term.category) {
    case 'acupuncture_point':
      hints.add(CareSection.THERAPEUTIC_INTERVENTIONS);
      break;
    case 'questionnaire':
      hints.add(CareSection.DIAGNOSTIC_ASSESSMENT);
      hints.add(CareSection.FOLLOW_UP_OUTCOMES);
      break;
    case 'symptom':
      hints.add(CareSection.CLINICAL_FINDINGS);
      break;
    case 'psychosocial':
      hints.add(CareSection.PATIENT_INFORMATION);
      hints.add(CareSection.DISCUSSION_CONCLUSION);
      break;
    case 'sleep_pattern':
      hints.add(CareSection.CLINICAL_FINDINGS);
      hints.add(CareSection.FOLLOW_UP_OUTCOMES);
      break;
    case 'timeline_marker':
      hints.add(CareSection.TIMELINE);
      break;
    case 'adverse_event':
      hints.add(CareSection.FOLLOW_UP_OUTCOMES);
      break;
    case 'lab':
    case 'imaging':
      hints.add(CareSection.DIAGNOSTIC_ASSESSMENT);
      break;
    default:
      break;
  }

  const tags = new Set((term.semanticTags || []).map((item) => normalizeLookupKey(item)));
  if (tags.has('treatmentmethod') || tags.has('acupuncturepoint')) {
    hints.add(CareSection.THERAPEUTIC_INTERVENTIONS);
  }
  if (tags.has('depressionscale') || tags.has('anxietyscale') || tags.has('sleepscale') || tags.has('numericscore')) {
    hints.add(CareSection.DIAGNOSTIC_ASSESSMENT);
    hints.add(CareSection.FOLLOW_UP_OUTCOMES);
  }
  if (tags.has('symptom') || tags.has('sleepsymptom') || tags.has('sleeppattern')) {
    hints.add(CareSection.CLINICAL_FINDINGS);
  }
  if (tags.has('psychosocialfactor')) {
    hints.add(CareSection.PATIENT_INFORMATION);
    hints.add(CareSection.DISCUSSION_CONCLUSION);
  }
  if (tags.has('followup') || tags.has('followupmeasure') || tags.has('timelinemarker')) {
    hints.add(CareSection.FOLLOW_UP_OUTCOMES);
    hints.add(CareSection.TIMELINE);
  }
  if (tags.has('adverseevent')) {
    hints.add(CareSection.FOLLOW_UP_OUTCOMES);
  }

  return Array.from(hints);
}

function lookupByVariantType(surface: string, variantType: MatchVariantType) {
  const baseConfidence =
    variantType === 'standard' ? 1 : variantType === 'synonym' ? 0.97 : variantType === 'typo' ? 0.93 : 0.9;

  const matches =
    variantType === 'standard'
      ? standardVariantIndex.get(normalizeUnicodeText(surface).toLowerCase().trim())
      : variantIndexByType.get(variantType)?.get(normalizeLookupKey(surface));

  return (matches || []).map((variant) => ({
    term: variant.term,
    confidence: baseConfidence
  }));
}

async function resolveSurface(
  surface: string,
  options: TermNormalizerOptions = {}
): Promise<TermNormalizationResult | null> {
  const normalizedSurfaceInput = normalizeUnicodeText(surface);
  const retrieved = await retrieveTermCandidates(normalizedSurfaceInput, {
    entries: seedTermDb,
    semanticMatcher: options.semanticMatcher,
    maxCandidates: 3
  });

  if (retrieved.length === 0) return null;

  if (
    shouldSkipGenericPartialMatch(
      normalizedSurfaceInput,
      retrieved.map((item) => ({ term: item.term, confidence: item.score }))
    )
  ) {
    return null;
  }

  const resolution = await resolveRetrievedTerminology({
    original: normalizedSurfaceInput,
    candidates: retrieved,
    llmResolver: options.llmResolver
  });

  if (resolution.decision === 'KEEP_ORIGINAL') {
    return null;
  }

  const selected =
    retrieved.find((item) => item.termId === resolution.selectedTermId) ||
    retrieved[0];

  return buildResolvedResult({
    surface: normalizedSurfaceInput,
    term: selected.term,
    matchType: selected.matchType,
    confidence: selected.score,
    candidates:
      retrieved.length > 1 || resolution.decision === 'ASK_USER'
        ? retrieved.map((item) => ({
            termId: item.termId,
            standardTerm: item.standardTerm,
            confidence: clampConfidence(item.score)
          }))
        : undefined,
    needsUserConfirmation: resolution.decision === 'ASK_USER'
  });
}

function detectTokenCandidates(text: string): Array<{ surface: string; start: number; end: number }> {
  const placeholderRanges = Array.from(text.matchAll(DEIDENTIFIED_PLACEHOLDER_REGEX)).map((match) => ({
    start: match.index || 0,
    end: (match.index || 0) + match[0].length
  }));
  const tokens = Array.from(text.matchAll(TOKEN_REGEX))
    .map((match) => ({
      surface: match[0],
      start: match.index || 0,
      end: (match.index || 0) + match[0].length
    }))
    .filter((token) => !placeholderRanges.some((range) => rangesOverlap(range, token)));

  const candidates = new Map<string, { surface: string; start: number; end: number }>();

  for (let i = 0; i < tokens.length; i += 1) {
    for (let size = 1; size <= 3 && i + size <= tokens.length; size += 1) {
      const slice = tokens.slice(i, i + size);
      const joined = slice.map((item) => item.surface).join(' ');
      const lookupKey = normalizeLookupKey(joined);
      if (!lookupKey || /^\d+$/.test(lookupKey) || lookupKey.length < 2) {
        continue;
      }
      const key = `${slice[0].start}:${slice[slice.length - 1].end}:${joined}`;
      candidates.set(key, {
        surface: joined,
        start: slice[0].start,
        end: slice[slice.length - 1].end
      });
    }
  }

  return Array.from(candidates.values());
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

function shouldSkipGenericPartialMatch(
  surface: string,
  matches: Array<{ term: TermDbEntry; confidence: number }>
): boolean {
  const normalizedSurface = normalizeLookupKey(surface);
  if (!GENERIC_STANDALONE_SURFACES.has(normalizedSurface)) {
    return false;
  }

  return matches.length > 1 && matches.every((item) => item.term.category === 'treatment');
}

function applyReplacements(text: string, matches: DetectedMatch[]): string {
  let normalizedText = text;
  const replacements = matches
    .filter((match) => {
      if (match.result.needsUserConfirmation) return false;
      if (match.result.normalizationPolicy === 'PRESERVE_ORIGINAL') return false;
      if (match.result.preserveSurfaceForm) return false;
      if (match.term.usagePolicy !== 'DRAFT_ALLOWED') return false;
      return Boolean(match.result.normalizedTerm);
    })
    .sort((a, b) => b.start - a.start);

  for (const match of replacements) {
    if (!match.result.normalizedTerm) continue;
    normalizedText =
      normalizedText.slice(0, match.start) +
      match.result.normalizedTerm +
      normalizedText.slice(match.end);
  }

  return normalizedText;
}

export async function normalizeTextWithTerms(
  text: string,
  options: TermNormalizerOptions = {}
): Promise<NormalizeTextResult> {
  const normalizedInputText = normalizeUnicodeText(text);
  const directMatches: DetectedMatch[] = [];

  for (const variant of directMatchVariants) {
    if (!variant.variant) continue;
    for (const match of normalizedInputText.matchAll(variant.regex)) {
      const surface = match[0];
      const start = match.index || 0;
      const end = start + surface.length;

      if (directMatches.some((existing) => rangesOverlap(existing, { start, end }))) {
        continue;
      }

      const resolved = await resolveSurface(surface, options);
      if (!resolved) continue;

      directMatches.push({
        start,
        end,
        surface,
        result: resolved,
        term: variant.term,
        sectionHints: getSemanticSectionHints(variant.term)
      });
    }
  }

  const fuzzyMatches: DetectedMatch[] = [];
  for (const candidate of detectTokenCandidates(normalizedInputText)) {
    if (directMatches.some((existing) => rangesOverlap(existing, candidate))) {
      continue;
    }

    const resolved = await resolveSurface(candidate.surface, options);
    if (!resolved) continue;

    const normalizedLength = normalizeLookupKey(candidate.surface).length;
    if (['exact', 'synonym', 'typo', 'alias'].includes(resolved.matchType) && normalizedLength < 2) {
      continue;
    }

    const term = seedTermDb.find((entry) => entry.termId === resolved.termId);
    if (!term) continue;

    if (
      directMatches.some(
        (existing) =>
          existing.result.termId === resolved.termId &&
          normalizeLookupKey(existing.surface) === normalizeLookupKey(candidate.surface)
      )
    ) {
      continue;
    }

    fuzzyMatches.push({
      start: candidate.start,
      end: candidate.end,
      surface: candidate.surface,
      result: resolved,
      term,
      sectionHints: getSemanticSectionHints(term)
    });
  }

  const allMatches = [...directMatches, ...fuzzyMatches]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter(
      (match, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.start === match.start &&
            candidate.end === match.end &&
            candidate.result.termId === match.result.termId
        ) === index
    );

  const normalizedText = applyReplacements(normalizedInputText, allMatches);
  const sectionHints = Array.from(new Set(allMatches.flatMap((match) => match.sectionHints))) as CareSection[];

  return {
    normalizedText,
    terms: allMatches.map((match) => match.result),
    sectionHints
  };
}

export async function normalizeSurfaceTerm(
  surface: string,
  options: TermNormalizerOptions = {}
): Promise<TermNormalizationResult | null> {
  return resolveSurface(surface, options);
}

export function getSeedTermDb(): TermDbEntry[] {
  return seedTermDb;
}

export function buildSectionHintsFromTerms(terms: TermNormalizationResult[]): CareSection[] {
  const sectionHints = new Set<CareSection>();
  for (const term of terms) {
    const entry = seedTermDb.find((item) => item.termId === term.termId);
    for (const sectionHint of getSemanticSectionHints(entry || {
      termId: term.termId,
      standardTerm: term.normalizedTerm || term.surface,
      category: term.category,
      synonyms: [],
      typoVariants: [],
      aliases: [],
      semanticTags: term.semanticTags || [],
      relatedTerms: term.relatedTerms || [],
      sectionHints: [],
      confidenceThreshold: 0.85,
      usagePolicy: term.usagePolicy || 'DRAFT_ALLOWED',
      normalizationPolicy: term.normalizationPolicy || 'AUTO_NORMALIZE',
      evidenceUsage: term.evidenceUsage || 'ALLOWED',
      riskLevel: term.riskLevel || 'LOW',
      expectedPatterns: [],
      exampleContexts: [],
      preserveSurfaceForm: term.preserveSurfaceForm || false,
      reviewerNote: term.reviewerNote || ''
    })) {
      sectionHints.add(sectionHint as CareSection);
    }
  }

  return Array.from(sectionHints);
}

export function canApplyNormalizedTerm(result: TermNormalizationResult): boolean {
  const entry = seedTermDb.find((item) => item.termId === result.termId);
  if (!entry) return false;
  if (result.needsUserConfirmation) return false;
  if (entry.usagePolicy !== 'DRAFT_ALLOWED') return false;
  if (result.normalizationPolicy === 'PRESERVE_ORIGINAL') return false;
  if (result.preserveSurfaceForm) return false;
  return Boolean(result.normalizedTerm);
}

export function semanticExtensionPoint(): {
  description: string;
  expectedReturnShape: SemanticMatchCandidate;
} {
  return {
    description:
      'Provide a SemanticMatchProvider.search(surface, entries) implementation to add embedding-based candidate search without changing Chain1 orchestration.',
    expectedReturnShape: {
      termId: 'term_xxx',
      standardTerm: '표준 용어',
      confidence: 0.81
    }
  };
}
