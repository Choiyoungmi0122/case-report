import { randomUUID } from 'crypto';
import { detectPHI, evaluateDeidentificationRisk } from './detector';
import { defaultPreserveTerms } from './preserveTerms';
import { applyPlaceholderReplacement } from './replacer';
import { DeidentifiedEMR, DeidOptions, DeidReplacementContext, KnownIdentifier, PHIType } from './types';

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

export async function deidentifyEMR(text: string, options: DeidOptions = {}): Promise<DeidentifiedEMR> {
  const preserveTerms = uniqueStrings([...(options.preserveTerms || []), ...defaultPreserveTerms]);
  const phiSpans = await detectPHI(text, {
    ...options,
    preserveTerms
  });

  const replaced = applyPlaceholderReplacement(text, phiSpans, options.sharedContext);
  const riskLevel = evaluateDeidentificationRisk(replaced.deidentifiedText, replaced.phiSpans);

  return {
    emrId: options.emrId || `emr_${randomUUID()}`,
    originalTextStoredLocalOnly: true,
    deidentifiedText: replaced.deidentifiedText,
    phiSpans: replaced.phiSpans,
    replacementMap: replaced.replacementMap,
    riskLevel
  };
}

export function createDeidReplacementContext(): DeidReplacementContext {
  return {
    replacementByKey: new Map(),
    occurrenceByKey: new Map(),
    countByType: new Map()
  };
}

/** Identifier classes that stay the same person across every visit of a case. */
const CASE_LEVEL_TYPES: PHIType[] = ['PATIENT_NAME', 'DOCTOR_NAME', 'HOSPITAL'];

/**
 * De-identifies every visit of one case.
 *
 * Two passes, because a real record names the patient in the first note and then
 * refers to them bare in the follow-ups ("홍길동에게 운동을 교육하였다"). The
 * per-visit rules need a contextual marker, so a single pass leaves those later
 * mentions in place. The first pass collects every identifier confirmed anywhere
 * in the case; the second re-runs each visit with that set, so a name confirmed
 * in ANY visit is redacted in ALL of them.
 */
export async function deidentifyCaseEMRs(
  visits: Array<{ text: string; emrId?: string }>,
  options: Omit<DeidOptions, 'emrId' | 'sharedContext'> = {}
): Promise<DeidentifiedEMR[]> {
  const emrIds = visits.map((visit) => visit.emrId || `emr_${randomUUID()}`);

  // Pass 1 - detect per visit and gather what was confirmed across the case.
  const firstPassContext = createDeidReplacementContext();
  const confirmed = new Map<string, KnownIdentifier>();

  for (let index = 0; index < visits.length; index += 1) {
    const first = await deidentifyEMR(visits[index].text || '', {
      ...options,
      emrId: emrIds[index],
      sharedContext: firstPassContext
    });

    for (const span of first.phiSpans) {
      if (!CASE_LEVEL_TYPES.includes(span.type)) continue;
      const text = String(span.originalText || '').trim();
      if (text.length < 2) continue;
      if (!confirmed.has(text)) confirmed.set(text, { type: span.type, text });
    }
  }

  const knownIdentifiers = [...(options.knownIdentifiers || []), ...confirmed.values()];

  // Pass 2 - redact with the case-wide identifier set, on a fresh replacement
  // context so placeholder numbering stays consistent across the whole case.
  const sharedContext = createDeidReplacementContext();
  const results: DeidentifiedEMR[] = [];

  for (let index = 0; index < visits.length; index += 1) {
    results.push(
      await deidentifyEMR(visits[index].text || '', {
        ...options,
        emrId: emrIds[index],
        sharedContext,
        knownIdentifiers
      })
    );
  }

  return results;
}

export * from './types';
export * from './preserveTerms';
