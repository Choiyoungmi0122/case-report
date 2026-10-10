import { deidentifyEMR, createDeidReplacementContext } from './index';
import { HIGH_RISK_RESIDUAL_REGEXES } from './rules';
import { DeidReplacementContext, PHIType, RiskLevel } from './types';

/**
 * Privacy boundary for every external AI call.
 *
 * The rule this module enforces: any clinical text that leaves the backend for
 * an external provider - chat completion OR embedding - must already be
 * de-identified. It reuses the existing `deidentifyEMR` pipeline; no new
 * de-identification algorithm is introduced here.
 *
 * Two layers:
 *  1. `deidentifyOutboundText` is applied at the SOURCE of every input that the
 *     SOAP pipeline never covered (user answers, titles, front matter,
 *     contribution answers, imported timeline cells, imported manuscript text).
 *  2. `assertOutboundTextIsSafe` is a last-resort guard called immediately
 *     before the outbound request. It blocks the call when a high-risk
 *     identifier is still present, so a chain added later that forgets step 1
 *     fails loudly instead of leaking.
 */

/** Placeholders already produced by a previous pass, e.g. `[PATIENT_NAME_1]`. */
const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z_]*_\d+\]/g;

export type OutboundDeidResult = {
  text: string;
  riskLevel: RiskLevel;
  phiCount: number;
  phiTypes: PHIType[];
};

/**
 * De-identification must be safe to run twice. Text that already contains
 * `[PATIENT_NAME_1]` may reach this helper again (a stored answer re-sent to a
 * later chain), and re-processing must not re-tag the placeholder as new PHI,
 * corrupt the sentence, or renumber the placeholder. Existing placeholders are
 * therefore handed to the detector as preserve terms, which makes it skip those
 * ranges entirely.
 */
function collectExistingPlaceholders(text: string): string[] {
  return Array.from(new Set(String(text || '').match(PLACEHOLDER_PATTERN) || []));
}

export function createOutboundDeidContext(): DeidReplacementContext {
  return createDeidReplacementContext();
}

export async function deidentifyOutboundText(
  text: string,
  options: {
    sharedContext?: DeidReplacementContext;
    preserveTerms?: string[];
    dateMode?: 'PLACEHOLDER' | 'RELATIVE_PLACEHOLDER' | 'KEEP';
    detectionProfile?: 'full' | 'research_export' | 'anonymized_record';
  } = {}
): Promise<OutboundDeidResult> {
  const source = String(text ?? '');
  if (!source.trim()) {
    return { text: source, riskLevel: 'LOW', phiCount: 0, phiTypes: [] };
  }

  const result = await deidentifyEMR(source, {
    sharedContext: options.sharedContext,
    dateMode: options.dateMode,
    detectionProfile: options.detectionProfile,
    preserveTerms: [...(options.preserveTerms || []), ...collectExistingPlaceholders(source)]
  });

  return {
    text: result.deidentifiedText,
    riskLevel: result.riskLevel,
    phiCount: result.phiSpans.length,
    phiTypes: Array.from(new Set(result.phiSpans.map((span) => span.type)))
  };
}

/**
 * De-identifies several strings under one replacement context, so the same
 * person or hospital receives the same placeholder across all of them.
 */
export async function deidentifyOutboundTexts(
  texts: string[],
  options: { sharedContext?: DeidReplacementContext; preserveTerms?: string[] } = {}
): Promise<OutboundDeidResult[]> {
  const sharedContext = options.sharedContext || createOutboundDeidContext();
  const results: OutboundDeidResult[] = [];

  for (const text of texts) {
    results.push(
      await deidentifyOutboundText(text, { sharedContext, preserveTerms: options.preserveTerms })
    );
  }

  return results;
}

/**
 * Convenience wrapper for the common "de-identify one field, keep the raw value
 * in the database" pattern. Returns only the text.
 */
export async function deidentifyOutboundField(
  text: string | undefined | null,
  sharedContext?: DeidReplacementContext
): Promise<string> {
  const result = await deidentifyOutboundText(String(text ?? ''), { sharedContext });
  return result.text;
}

export async function deidentifyQnaForOutbound(
  qnaHistory: Array<{ question: string; answer: string; timestamp?: string }>,
  sharedContext?: DeidReplacementContext
): Promise<Array<{ question: string; answer: string; timestamp?: string }>> {
  const context = sharedContext || createOutboundDeidContext();
  const result: Array<{ question: string; answer: string; timestamp?: string }> = [];

  for (const item of qnaHistory || []) {
    result.push({
      ...item,
      question: await deidentifyOutboundField(item?.question, context),
      answer: await deidentifyOutboundField(item?.answer, context)
    });
  }

  return result;
}

/**
 * Section drafts can carry manually edited front matter (title, keywords,
 * discussion) that never passed through the SOAP pipeline, so their text is
 * de-identified before being summarised into a prompt. Only `draftText` is
 * rewritten; ids, evidence links and traceability stay untouched.
 */
export async function deidentifyDraftsForOutbound<T extends { draftText?: string }>(
  drafts: T[],
  sharedContext?: DeidReplacementContext
): Promise<T[]> {
  const context = sharedContext || createOutboundDeidContext();
  const result: T[] = [];

  for (const draft of drafts || []) {
    result.push({
      ...draft,
      draftText: await deidentifyOutboundField(draft?.draftText, context)
    });
  }

  return result;
}

export async function deidentifyQnaMapForOutbound(
  qnaBySection: Record<string, Array<{ question: string; answer: string }>>,
  sharedContext?: DeidReplacementContext
): Promise<Record<string, Array<{ question: string; answer: string }>>> {
  const context = sharedContext || createOutboundDeidContext();
  const output: Record<string, Array<{ question: string; answer: string }>> = {};

  for (const [sectionId, history] of Object.entries(qnaBySection || {})) {
    output[sectionId] = (await deidentifyQnaForOutbound(history || [], context)) as Array<{
      question: string;
      answer: string;
    }>;
  }

  return output;
}

/**
 * Imported timeline rows come straight from spreadsheet cells and never touch
 * the SOAP pipeline, yet they become evidence cards and draft text that reach
 * the model. Every free-text cell is de-identified; ids, ordering and row
 * indexes are structural and stay as they are.
 *
 * `date` is left alone on purpose: the SOAP pipeline already forwards structured
 * visit dates to the model, and placeholdering them here would break the
 * chronology the TIMELINE section is built from. Dates remain a documented
 * quasi-identifier for IRB review rather than something this fix changes.
 */
const TIMELINE_TEXT_FIELDS = [
  'visitNo',
  'symptom',
  'test',
  'diagnosis',
  'treatment',
  'outcome',
  'note'
] as const;

/**
 * A spreadsheet cell carries no sentence context, so a bare value like a name in
 * a 환자명 column matches none of the narrative rules. The context that makes it
 * recognisable is the column header, which is part of the imported data. The
 * cell is therefore detected as `"<header>: <value>"` - the exact shape the
 * existing patient-name / patient-id rules already handle - and the header
 * prefix is removed again afterwards. No detection rule is added or changed.
 */
async function deidentifyCellWithHeaderContext(
  header: string,
  value: string,
  context: DeidReplacementContext
): Promise<string> {
  const label = String(header || '').trim();
  if (!label) return deidentifyOutboundField(value, context);

  const prefix = `${label}: `;
  const combined = await deidentifyOutboundField(`${prefix}${value}`, context);
  return combined.startsWith(prefix) ? combined.slice(prefix.length) : combined;
}

export async function deidentifyTimelineEventsForOutbound<T extends Record<string, any>>(
  events: T[],
  sharedContext?: DeidReplacementContext
): Promise<T[]> {
  const context = sharedContext || createOutboundDeidContext();
  const result: T[] = [];

  for (const event of events || []) {
    const next: Record<string, any> = { ...event };

    if (next.cells && typeof next.cells === 'object') {
      const cells: Record<string, string> = {};
      for (const [key, value] of Object.entries(next.cells as Record<string, unknown>)) {
        cells[key] =
          typeof value === 'string'
            ? await deidentifyCellWithHeaderContext(key, value, context)
            : String(value ?? '');
      }
      next.cells = cells;
    }

    // Mapped columns run after `cells` so that an identifier already seen there
    // reuses the same placeholder number.
    for (const field of TIMELINE_TEXT_FIELDS) {
      if (typeof next[field] === 'string' && next[field]) {
        next[field] = await deidentifyOutboundField(next[field], context);
      }
    }

    result.push(next as T);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Last-resort outbound guard                                                  */
/* -------------------------------------------------------------------------- */

export type HighRiskIdentifierFinding = {
  type: string;
  rule: string;
  matchPreview: string;
  contextPreview: string;
  startIndex: number;
  endIndex: number;
};

export class OutboundPrivacyError extends Error {
  readonly code = 'outbound_privacy_block';
  readonly detectedTypes: string[];
  readonly findings: HighRiskIdentifierFinding[];
  readonly label: string;

  constructor(label: string, findings: HighRiskIdentifierFinding[]) {
    const detectedTypes = Array.from(new Set(findings.map((item) => item.type)));
    const findingSummary = findings
      .slice(0, 5)
      .map((item) => `${item.type}/${item.rule}@${item.startIndex}: ${item.matchPreview}`)
      .join('; ');
    super(
      `Outbound AI call "${label}" was blocked: the payload still contains high-risk identifiers ` +
        `(${detectedTypes.join(', ')}). Findings: ${findingSummary}. ` +
        'De-identify the input before sending it to an external provider.'
    );
    this.name = 'OutboundPrivacyError';
    this.label = label;
    this.detectedTypes = detectedTypes;
    this.findings = findings;
  }
}

const HIGH_RISK_LABELS: Array<{ label: string; rule: string; regex: RegExp }> = [
  { label: 'PHONE', rule: 'PHONE_REGEX', regex: HIGH_RISK_RESIDUAL_REGEXES[0] },
  { label: 'RESIDENT_ID', rule: 'RESIDENT_ID_REGEX', regex: HIGH_RISK_RESIDUAL_REGEXES[1] },
  { label: 'EMAIL', rule: 'EMAIL_REGEX', regex: HIGH_RISK_RESIDUAL_REGEXES[2] }
];

function makeGlobalRegex(regex: RegExp) {
  return new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
}

function maskIdentifierPreview(value: string) {
  const source = String(value || '');
  if (source.includes('@')) {
    return source.replace(/[A-Z0-9._%+-]/gi, (char, index) =>
      index === 0 || index === source.length - 1 ? char : '*'
    );
  }

  let digitIndex = 0;
  const digitCount = (source.match(/\d/g) || []).length;
  return source.replace(/\d/g, (digit) => {
    digitIndex += 1;
    return digitIndex <= 2 || digitIndex > digitCount - 2 ? digit : '*';
  });
}

function maskContextPreview(value: string) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, maskIdentifierPreview)
    .replace(/\d/g, '*');
}

function buildContextPreview(source: string, startIndex: number, endIndex: number) {
  const prefix = maskContextPreview(source.slice(Math.max(0, startIndex - 24), startIndex));
  const match = maskIdentifierPreview(source.slice(startIndex, endIndex));
  const suffix = maskContextPreview(source.slice(endIndex, Math.min(source.length, endIndex + 24)));
  return `${prefix}${match}${suffix}`;
}

/**
 * Detects the identifier classes the de-identification pipeline itself treats as
 * HIGH residual risk. Only the identifier TYPE is ever returned - never the
 * matched value - so nothing sensitive reaches a log or an error message.
 *
 * Deliberately narrow: this guard runs on fully assembled prompts that mix
 * AI-written prose with clinical vocabulary, where the broader name/hospital
 * heuristics would fire on ordinary phrases like "한의원에 내원". Those classes
 * are handled at the source instead.
 */
export function findHighRiskIdentifierTypes(text: string): string[] {
  return Array.from(new Set(findHighRiskIdentifierFindings(text).map((item) => item.type)));
}

export function findHighRiskIdentifierFindings(text: string): HighRiskIdentifierFinding[] {
  const source = String(text ?? '');
  if (!source) return [];

  return HIGH_RISK_LABELS.flatMap(({ label, rule, regex }) =>
    Array.from(source.matchAll(makeGlobalRegex(regex))).map((match) => {
      const matchText = match[0] || '';
      const startIndex = match.index ?? 0;
      const endIndex = startIndex + matchText.length;
      return {
        type: label,
        rule,
        matchPreview: maskIdentifierPreview(matchText),
        contextPreview: buildContextPreview(source, startIndex, endIndex),
        startIndex,
        endIndex
      };
    })
  );
}

/**
 * Blocks the outbound call when a high-risk identifier survived every earlier
 * step. Throwing here means the request is never issued, which is what the
 * HIGH-risk policy requires: outbound call count stays at zero.
 */
export function assertOutboundTextIsSafe(text: string, label: string): void {
  const findings = findHighRiskIdentifierFindings(text);
  if (findings.length > 0) {
    throw new OutboundPrivacyError(label, findings);
  }
}

export function assertOutboundTextsAreSafe(texts: string[], label: string): void {
  for (const text of texts) {
    assertOutboundTextIsSafe(text, label);
  }
}
