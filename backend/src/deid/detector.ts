import {
  ADDRESS_REGEXES,
  DATE_REGEXES,
  DEFAULT_HOSPITAL_DICTIONARY,
  DOCTOR_NAME_REGEXES,
  EMAIL_REGEX,
  HIGH_RISK_RESIDUAL_REGEXES,
  HOSPITAL_REGEXES,
  PATIENT_ID_REGEXES,
  PATIENT_NAME_REGEXES,
  PHONE_REGEX,
  RESIDENT_ID_REGEX
} from './rules';
import { isKnownClinicalTerm, isNonNameContextWord } from './clinicalVocabulary';
import { DeidOptions, KnownIdentifier, PHISpan, PHIType, RiskLevel } from './types';

type ProtectedRange = {
  start: number;
  end: number;
};

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

function collectProtectedRanges(text: string, preserveTerms: string[]): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const sortedTerms = [...uniqueStrings(preserveTerms)].sort((a, b) => b.length - a.length);

  for (const term of sortedTerms) {
    if (!term) continue;
    const regex = new RegExp(escapeRegex(term), 'gi');
    for (const match of text.matchAll(regex)) {
      const start = match.index || 0;
      ranges.push({ start, end: start + match[0].length });
    }
  }

  return ranges;
}

function isProtected(range: { start: number; end: number }, protectedRanges: ProtectedRange[]) {
  return protectedRanges.some((item) => overlaps(range, item));
}

function pushSpan(
  spans: PHISpan[],
  next: Omit<PHISpan, 'replacement'>,
  protectedRanges: ProtectedRange[]
) {
  const range = { start: next.startIndex, end: next.endIndex };
  if (isProtected(range, protectedRanges)) return;
  if (spans.some((existing) => overlaps(range, { start: existing.startIndex, end: existing.endIndex }))) return;

  spans.push({
    ...next,
    replacement: ''
  });
}

/**
 * The rule regexes are module-level `/g` literals shared by every request. `matchAll` seeds its
 * internal clone from the source regex's `lastIndex`, so a stale `lastIndex` (left behind by a
 * `.test()` elsewhere) would silently skip the beginning of the text. Always scan with a fresh copy.
 */
function withFreshLastIndex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
}

function detectByRegex(
  text: string,
  regex: RegExp,
  type: PHIType,
  confidence: number,
  protectedRanges: ProtectedRange[],
  captureGroup = 0
): PHISpan[] {
  const matches: PHISpan[] = [];

  for (const match of text.matchAll(withFreshLastIndex(regex))) {
    const matchedText = match[captureGroup] || match[0];
    if (!matchedText) continue;

    const fullStart = match.index || 0;
    const relativeOffset = captureGroup > 0 ? match[0].indexOf(matchedText) : 0;
    const startIndex = fullStart + Math.max(0, relativeOffset);
    const endIndex = startIndex + matchedText.length;

    pushSpan(
      matches,
      {
        type,
        originalText: matchedText,
        startIndex,
        endIndex,
        confidence
      },
      protectedRanges
    );
  }

  return matches;
}

function detectHospitals(text: string, protectedRanges: ProtectedRange[]): PHISpan[] {
  const spans: PHISpan[] = [];

  for (const hospital of DEFAULT_HOSPITAL_DICTIONARY) {
    const regex = new RegExp(escapeRegex(hospital), 'gi');
    for (const match of text.matchAll(regex)) {
      const startIndex = match.index || 0;
      const endIndex = startIndex + match[0].length;
      pushSpan(
        spans,
        {
          type: 'HOSPITAL',
          originalText: match[0],
          startIndex,
          endIndex,
          confidence: 0.96
        },
        protectedRanges
      );
    }
  }

  for (const regex of HOSPITAL_REGEXES) {
    for (const span of detectByRegex(text, regex, 'HOSPITAL', 0.88, protectedRanges)) {
      pushSpan(spans, span, protectedRanges);
    }
  }

  return spans;
}

function isLikelyPatientNameFalsePositive(text: string): boolean {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  if (/^(?:\uB0A8\uC131|\uC5EC\uC131|\uB0A8\uC790|\uC5EC\uC790)$/.test(normalized)) return true;

  // A clinical term followed by 환자 ("견비통 환자") satisfies exactly the same
  // 2-4 Hangul shape as a real name ("홍길동 환자"). Reject the candidate only on
  // positive evidence that it is trusted clinical vocabulary - anything unknown
  // stays redacted, which is the privacy-safe direction.
  if (isKnownClinicalTerm(normalized)) {
    return true;
  }

  // "환자는 45세 남성" - the role word itself, with or without a particle, in
  // the slot where the age/sex rule expects a name.
  if (/^환자[가-힣]?$/.test(normalized)) {
    return true;
  }

  // The bare-환자 prefix rule also matches the ordinary word that happens to
  // follow 환자 ("환자 이후 경과를 관찰하였다"). Those are grammatical words, never
  // names, so rejecting them costs no name recall.
  if (isNonNameContextWord(normalized)) {
    return true;
  }

  // Context words like "방문에서 환자" are not person names even though they can satisfy the
  // loose 2-4 Hangul pattern right before "환자". Use escaped suffixes here so the guard stays
  // reliable even if a Windows shell renders Hangul source as mojibake.
  if (
    normalized.endsWith('\uC5D0\uC11C') || // 에서
    normalized.endsWith('\uC73C\uB85C') || // 으로
    normalized.endsWith('\uBD80\uD130') || // 부터
    normalized.endsWith('\uAE4C\uC9C0') // 까지
  ) {
    return true;
  }

  return false;
}

// Trailing particles the surname rule's greedy match can swallow ("김민수는").
const NAME_TRAILING_PARTICLES = new Set(['은', '는', '이', '가', '을', '를', '의']);
// Syllables that end ordinary words ("하였다", "주소로", "오르는") but practically
// never end a Korean given name.
const NON_NAME_FINAL_SYLLABLES = new Set([
  '다', '로', '는', '를', '을', '에', '의', '께', '며', '게', '적', '과', '와', '히', '가', '도', '만', '서',
  '막', '움', '됨'
]);
// Derivational endings that turn a clinical/common stem into an ordinary word
// ("설진상", "안정된"). Only consulted when the stem itself is known vocabulary.
const STEM_SUFFIX_SYLLABLES = new Set(['상', '된', '되', '한', '할', '함', '시', '중', '후', '전']);

/**
 * The surname rule has no contextual marker (환자 / 씨 / 성명 ...), so on its own
 * it matches any word that merely starts with a surname syllable - "하였다",
 * "주소로", "최근", "진찰". Accept a candidate only when it has the dominant
 * surname + two-syllable given name shape; 2- and 4-syllable names still need
 * one of the contextual rules, after which propagation covers bare mentions.
 */
function refineSurnameRuleSpan(span: PHISpan): PHISpan | null {
  let value = span.originalText;
  let endIndex = span.endIndex;

  if (value.length === 4 && NAME_TRAILING_PARTICLES.has(value[3])) {
    value = value.slice(0, 3);
    endIndex -= 1;
  }

  if (value.length !== 3) return null;
  if (NON_NAME_FINAL_SYLLABLES.has(value[2])) return null;
  // "설질은", "안색이": a clinical/common stem plus a particle, not a name.
  if (NAME_TRAILING_PARTICLES.has(value[2]) || STEM_SUFFIX_SYLLABLES.has(value[2])) {
    const stem = value.slice(0, 2);
    if (isKnownClinicalTerm(stem) || isNonNameContextWord(stem)) return null;
  }

  return { ...span, originalText: value, endIndex };
}

/**
 * Each rule group builds its spans in isolation, so overlaps are only suppressed within a group.
 * Resolve them globally here: keep the widest (then highest-confidence) span and drop anything that
 * intersects it, so the replacement pass sees a strictly increasing, non-overlapping span list.
 */
function sortAndDeduplicate(spans: PHISpan[]): PHISpan[] {
  const deduplicated = [...spans].filter(
    (span, index, array) =>
      array.findIndex(
        (candidate) =>
          candidate.type === span.type &&
          candidate.startIndex === span.startIndex &&
          candidate.endIndex === span.endIndex &&
          candidate.originalText === span.originalText
      ) === index
  );

  const byPriority = [...deduplicated].sort((a, b) => {
    const spanLength = b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
    if (spanLength !== 0) return spanLength;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.startIndex - b.startIndex;
  });

  const kept: PHISpan[] = [];
  for (const span of byPriority) {
    const range = { start: span.startIndex, end: span.endIndex };
    if (kept.some((existing) => overlaps(range, { start: existing.startIndex, end: existing.endIndex }))) {
      continue;
    }
    kept.push(span);
  }

  return kept.sort((a, b) => a.startIndex - b.startIndex);
}

/**
 * Document-level consistency pass.
 *
 * The name rules need a contextual marker ("홍길동 환자", "성명: 홍길동"), so a
 * later bare mention of the same person ("홍길동에게 침치료를 시행하였다") is not
 * matched on its own. Once a name or hospital has been CONFIRMED somewhere in
 * the record, every other occurrence of that exact string is redacted too.
 *
 * This only propagates strings that already passed detection and the
 * false-positive filter, so it raises recall without widening what counts as an
 * identifier in the first place.
 */
const PROPAGATED_TYPES: PHIType[] = ['PATIENT_NAME', 'DOCTOR_NAME', 'HOSPITAL'];

function propagateConfirmedIdentifiers(
  text: string,
  confirmedSpans: PHISpan[],
  protectedRanges: ProtectedRange[],
  knownIdentifiers: KnownIdentifier[] = []
): PHISpan[] {
  const propagated: PHISpan[] = [];

  const confirmedByText = new Map<string, PHIType>();
  for (const span of confirmedSpans) {
    if (!PROPAGATED_TYPES.includes(span.type)) continue;
    const value = String(span.originalText || '').trim();
    // Single characters are far too generic to propagate safely.
    if (value.length < 2) continue;
    if (!confirmedByText.has(value)) confirmedByText.set(value, span.type);
  }

  // Identifiers confirmed in another visit of the same case count as confirmed
  // here too - a name written once in the initial note is still that patient's
  // name in every follow-up note.
  for (const known of knownIdentifiers) {
    if (!PROPAGATED_TYPES.includes(known.type)) continue;
    const value = String(known.text || '').trim();
    if (value.length < 2) continue;
    if (!confirmedByText.has(value)) confirmedByText.set(value, known.type);
  }

  for (const [value, type] of confirmedByText) {
    const regex = new RegExp(escapeRegex(value), 'g');
    for (const match of text.matchAll(regex)) {
      const startIndex = match.index || 0;
      const endIndex = startIndex + value.length;

      // Skip the occurrences that were already detected directly.
      const alreadyCovered = confirmedSpans.some(
        (span) => span.startIndex < endIndex && startIndex < span.endIndex
      );
      if (alreadyCovered) continue;

      pushSpan(
        propagated,
        {
          type,
          originalText: value,
          startIndex,
          endIndex,
          // Slightly below the direct detection confidence: the value is
          // confirmed, this particular occurrence is inferred from it.
          confidence: 0.88
        },
        protectedRanges
      );
    }
  }

  return propagated;
}

export async function detectPHI(text: string, options: DeidOptions = {}): Promise<PHISpan[]> {
  const preserveTerms = options.preserveTerms || [];
  const protectedRanges = collectProtectedRanges(text, preserveTerms);
  const spans: PHISpan[] = [];

  spans.push(...detectByRegex(text, PHONE_REGEX, 'PHONE', 0.99, protectedRanges));
  spans.push(...detectByRegex(text, RESIDENT_ID_REGEX, 'RESIDENT_ID', 0.995, protectedRanges));
  spans.push(...detectByRegex(text, EMAIL_REGEX, 'EMAIL', 0.99, protectedRanges));

  for (const regex of DATE_REGEXES) {
    spans.push(...detectByRegex(text, regex, 'DATE', 0.95, protectedRanges));
  }

  for (const regex of PATIENT_ID_REGEXES) {
    spans.push(...detectByRegex(text, regex, 'PATIENT_ID', 0.93, protectedRanges, 1));
  }

  const patientNameRegexes =
    options.detectionProfile === 'research_export'
      ? PATIENT_NAME_REGEXES.slice(1)
      : PATIENT_NAME_REGEXES;

  for (const regex of patientNameRegexes) {
    const candidates = detectByRegex(text, regex, 'PATIENT_NAME', 0.9, protectedRanges, 1);
    const refined =
      regex === PATIENT_NAME_REGEXES[0]
        ? candidates
            .map((span) => refineSurnameRuleSpan(span))
            .filter((span): span is PHISpan => span !== null)
        : candidates;
    spans.push(...refined.filter((span) => !isLikelyPatientNameFalsePositive(span.originalText)));
  }

  for (const regex of DOCTOR_NAME_REGEXES) {
    spans.push(...detectByRegex(text, regex, 'DOCTOR_NAME', 0.9, protectedRanges, 1));
  }

  for (const regex of ADDRESS_REGEXES) {
    spans.push(...detectByRegex(text, regex, 'ADDRESS', 0.88, protectedRanges));
  }

  spans.push(...detectHospitals(text, protectedRanges));

  if (options.entityProvider) {
    const entitySpans = await Promise.resolve(options.entityProvider.detect(text, preserveTerms));
    for (const span of entitySpans || []) {
      pushSpan(
        spans,
        {
          type: span.type,
          originalText: span.originalText,
          startIndex: span.startIndex,
          endIndex: span.endIndex,
          confidence: span.confidence
        },
        protectedRanges
      );
    }
  }

  spans.push(
    ...propagateConfirmedIdentifiers(text, spans, protectedRanges, options.knownIdentifiers || [])
  );

  return sortAndDeduplicate(spans);
}

export function evaluateDeidentificationRisk(deidentifiedText: string, phiSpans: PHISpan[]): RiskLevel {
  // Test with copies: `.test()` on a shared /g regex leaves a non-zero lastIndex behind, which would
  // make the next detection pass start mid-text and miss PHI.
  if (HIGH_RISK_RESIDUAL_REGEXES.some((regex) => withFreshLastIndex(regex).test(deidentifiedText))) {
    return 'HIGH';
  }

  if (phiSpans.some((span) => span.confidence < 0.85 || span.type === 'OTHER')) {
    return 'MEDIUM';
  }

  return 'LOW';
}
