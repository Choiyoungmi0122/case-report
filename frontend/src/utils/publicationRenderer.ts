/**
 * Human-facing publication rendering.
 *
 * The system keeps ONE canonical representation - the de-identified text with
 * `[PATIENT_NAME_1]`-style placeholders - and that representation is what every
 * external AI call, RAG lookup, evidence link and research export uses. Those
 * tokens are internal machinery, not publication style, so they must never
 * appear on screen or in the exported manuscript.
 *
 * This module converts canonical text into the phrasing Korean medicine case
 * reports actually use, at display time only:
 *
 *   canonical : [PATIENT_NAME_1] 환자는 [HOSPITAL_1]에서 치료를 받았다.
 *   display   : 환자는 타 의료기관에서 치료를 받았다.
 *
 * Rules, deliberately:
 *  - The patient's name is removed entirely rather than partially masked. The
 *    system knows the real name, so re-emitting a surname (김○○) would leak
 *    information the full removal does not.
 *  - No original identifier is ever restored: this module never reads
 *    `phiSpans.originalText`, `replacementMap.originalText` or the raw record.
 *  - Everything is deterministic string work. No LLM call is involved.
 */

export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z_]*_\d+\]/g;

const PATIENT_LABEL = '환자';
const HOSPITAL_LABEL = '타 의료기관';
const DOCTOR_LABEL = '의료진';
const DATE_LABEL = '(일자 비식별)';

/** Placeholder classes that carry no clinical value in a CARE case report. */
const DROP_SENTENCE_TYPES = ['PHONE', 'PATIENT_ID', 'RESIDENT_ID', 'EMAIL', 'ADDRESS'];

/**
 * Korean particles agree with the final consonant of the preceding word. After
 * substitution the preceding word changes ("홍길동" -> "환자"), so the particle
 * has to be re-selected or the sentence reads wrong.
 */
function hasFinalConsonant(word: string): boolean {
  const lastChar = word.trim().slice(-1);
  if (!lastChar) return false;
  const code = lastChar.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

const PARTICLE_PAIRS: Array<{ withFinal: string; withoutFinal: string }> = [
  { withFinal: '은', withoutFinal: '는' },
  { withFinal: '이', withoutFinal: '가' },
  { withFinal: '을', withoutFinal: '를' },
  { withFinal: '과', withoutFinal: '와' },
  { withFinal: '으로', withoutFinal: '로' }
];

/** All particle spellings that may directly follow a replaced placeholder. */
const PARTICLE_ALTERNATIVES = [
  '으로',
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '과',
  '와',
  '로',
  '의',
  '에게',
  '에서',
  '에',
  '도',
  '만',
  '까지',
  '부터'
];

function agreeParticle(replacement: string, particle: string): string {
  const final = hasFinalConsonant(replacement);
  for (const pair of PARTICLE_PAIRS) {
    if (particle === pair.withFinal || particle === pair.withoutFinal) {
      return final ? pair.withFinal : pair.withoutFinal;
    }
  }
  return particle;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PARTICLE_GROUP = `(?:${PARTICLE_ALTERNATIVES.map(escapeRegex).join('|')})`;

/**
 * Collapses a label repeated back to back. Two placeholders that both render to
 * the same label - typically a real name plus a detector false positive in
 * "환자 홍길동은" - would otherwise read as "환자 환자".
 */
function collapseRepeatedLabel(text: string, label: string): string {
  const escaped = escapeRegex(label);
  return text.replace(new RegExp(escaped + '(?:\\s+' + escaped + ')+', 'g'), label);
}

/**
 * Replaces one placeholder class with a label, keeping the sentence grammatical.
 * Handles the "[PATIENT_NAME_1] 환자는" case first so the output does not become
 * "환자 환자는".
 */
function replacePlaceholderClass(text: string, type: string, label: string): string {
  const token = `\\[${type}_\\d+\\]`;
  let output = text;

  // 1. Placeholder immediately followed by the same label already written out.
  //    "[PATIENT_NAME_1] 환자는" -> "환자는"
  output = output.replace(
    new RegExp(`${token}\\s*${escapeRegex(label)}`, 'g'),
    label
  );

  // 2. Placeholder followed by a particle -> label + agreeing particle.
  //    "[PATIENT_NAME_1]은" -> "환자는"   "[HOSPITAL_1]에서" -> "타 의료기관에서"
  output = output.replace(
    new RegExp(`${token}(${PARTICLE_GROUP})`, 'g'),
    (_match, particle: string) => `${label}${agreeParticle(label, particle)}`
  );

  // 3. Bare placeholder.
  output = output.replace(new RegExp(token, 'g'), label);

  return output;
}

/**
 * Splits into sentences while keeping the delimiter, so a sentence can be
 * dropped without damaging the ones around it.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?。]|다\.)\s+/);
}

/**
 * Removes whole sentences whose only purpose was to carry an identifier that a
 * case report does not need (phone number, chart number, address, e-mail).
 * Falls back to replacing the token when the line is not sentence-shaped, so a
 * heading or a table cell is never silently deleted.
 */
const DROP_TOKEN_SOURCE = `\\[(?:${DROP_SENTENCE_TYPES.join('|')})_\\d+\\]`;

function tidyPunctuation(text: string): string {
  return text
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/^[,\s]+/, '')
    .trim();
}

/**
 * Removes identifiers a CARE case report does not need, working from the
 * smallest unit outwards so the sentence is never left half-written:
 *
 *   1. a parenthetical that exists only to carry identifiers
 *      "환자(등록번호 [PATIENT_ID_1], 연락처 [PHONE_1])는" -> "환자는"
 *   2. a comma-delimited clause carrying the identifier
 *   3. only if the whole sentence is about the identifier, the sentence itself
 */
function dropIdentifierOnlySentences(text: string): string {
  const dropToken = new RegExp(DROP_TOKEN_SOURCE);
  const dropTokenGlobal = new RegExp(DROP_TOKEN_SOURCE, 'g');
  // A parenthetical whose contents include an identifier token and nothing that
  // looks like clinical narrative.
  const identifierParenthetical = new RegExp(`\\s*\\([^()]*${DROP_TOKEN_SOURCE}[^()]*\\)`, 'g');

  return text
    .split('\n')
    .map((line) => {
      if (!dropToken.test(line)) return line;

      // 1. parentheticals
      let working = line.replace(identifierParenthetical, '');
      if (!dropToken.test(working)) return tidyPunctuation(working);

      // 2. comma-delimited clauses, sentence by sentence
      const sentences = splitSentences(working).map((sentence) => {
        if (!dropToken.test(sentence)) return sentence;
        const clauses = sentence.split(',');
        if (clauses.length > 1) {
          const kept = clauses.filter((clause) => !dropToken.test(clause));
          if (kept.length > 0) return tidyPunctuation(kept.join(','));
        }
        return sentence;
      });

      working = sentences.join(' ');
      if (!dropToken.test(working)) return tidyPunctuation(working);

      // 3. drop whole sentences, but never blank the line out completely
      const remaining = splitSentences(working).filter((sentence) => !dropToken.test(sentence));
      if (remaining.length > 0) return tidyPunctuation(remaining.join(' '));

      // Structured single-value line ("등록번호: [PATIENT_ID_1]"): strip the token
      // rather than deleting the label.
      return tidyPunctuation(working.replace(dropTokenGlobal, ''));
    })
    .filter((line, index, array) => !(line === '' && array[index - 1] === ''))
    .join('\n');
}

export type PublicationRenderOptions = {
  /**
   * Optional demographic phrase for the first patient mention, e.g. "45세 남성".
   * Only used when the caller actually has structured age/sex; nothing is
   * inferred from the record.
   */
  patientDescriptor?: string;
};

/**
 * Converts canonical de-identified text into publication-ready text.
 * Safe to call on text that contains no placeholders.
 */
export function renderClinicalAnonymizedText(
  text: string | null | undefined,
  options: PublicationRenderOptions = {}
): string {
  const source = String(text ?? '');
  if (!source) return '';

  let output = dropIdentifierOnlySentences(source);

  const descriptor = String(options.patientDescriptor || '').trim();
  if (descriptor) {
    // Expand only the FIRST patient mention, so the report reads
    // "45세 남성 환자는 ..." once and plain "환자는 ..." thereafter.
    const firstMention = new RegExp(`\\[PATIENT_NAME_\\d+\\](\\s*${PATIENT_LABEL})?`);
    output = output.replace(firstMention, `${descriptor} ${PATIENT_LABEL}`);
  }

  output = replacePlaceholderClass(output, 'PATIENT_NAME', PATIENT_LABEL);
  output = replacePlaceholderClass(output, 'DOCTOR_NAME', DOCTOR_LABEL);
  output = replacePlaceholderClass(output, 'HOSPITAL', HOSPITAL_LABEL);
  output = replacePlaceholderClass(output, 'DATE', DATE_LABEL);

  // Safety net: two placeholders that both render to 환자 (a real name plus a
  // detector false positive) would otherwise read as "환자 환자".
  output = collapseRepeatedLabel(output, PATIENT_LABEL);
  output = collapseRepeatedLabel(output, HOSPITAL_LABEL);

  // Any placeholder class not handled above (defensive: a future PHI type must
  // not surface as a raw token in a manuscript).
  output = output.replace(PLACEHOLDER_PATTERN, '');

  return output.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/** Applies the renderer to every string value of a record. */
export function renderClinicalAnonymizedMap(
  values: Record<string, string> | null | undefined,
  options: PublicationRenderOptions = {}
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(values || {})) {
    output[key] = renderClinicalAnonymizedText(value, options);
  }
  return output;
}

/**
 * Verification helper for tests and export checks: returns the placeholder
 * tokens still present in a rendered string. Should always be empty.
 */
export function findRemainingPlaceholders(text: string): string[] {
  return Array.from(new Set(String(text || '').match(PLACEHOLDER_PATTERN) || []));
}
