import assert from 'node:assert/strict';
import { CareSection } from '../../src/types';
import { buildSectionDraftTraceability } from '../../src/llm/chains';
import { normalizeSurfaceTerm, normalizeTextWithTerms } from '../../src/rag/termNormalizer';

const GUIBI_TANG = '\uADC0\uBE44\uD0D5';
const GUIBI_TANG_WITH_SPACE = '\uADC0\uBE44 \uD0D5';
const GUIBO_TANG = '\uADC0\uBCF4\uD0D5';
const UNKNOWN_TERM = '\uC54C \uC218 \uC5C6\uB294 \uC6A9\uC5B4';
const GUIBI = '\uADC0\uBE44';
const GENERIC_TREATMENT = '\uCE58\uB8CC';
const CHEST_TIGHTNESS = '\uAC00\uC2B4\uB2F5\uB2F5';
const SLEEP_INTERRUPT = '\uC790\uB2E4\uAE78';
const FREQ_DECREASED = 'freq \uAC10\uC18C';
const SEVERE_SENTENCE = '\uAC00\uC2B4\uB2F5\uB2F5\uACFC \uC790\uB2E4\uAE78\uC774 \uC2EC\uD574\uC84C\uB2E4';
const SEVERE_NORMALIZED = '\uD749\uBBFC\uACFC \uC911\uB3C4\uAC01\uC131\uC774 \uC2EC\uD574\uC84C\uB2E4';
const ACUPUNCTURE_SENTENCE = 'AT PC6 LI4 LR3 \uC2DC\uD589';
const ACUPUNCTURE_NORMALIZED =
  'AT \uB0B4\uAD00(PC6) \uD569\uACE1(LI4) \uD0DC\uCDA9(LR3) \uC2DC\uD589';

async function run() {
  const exact = await normalizeSurfaceTerm(GUIBI_TANG);
  assert.ok(exact);
  assert.equal(exact?.normalizedTerm, GUIBI_TANG);
  assert.equal(exact?.matchType, 'exact');
  assert.equal(exact?.needsUserConfirmation, false);
  assert.equal(exact?.normalizationPolicy, 'REQUIRE_CONFIRMATION');

  const synonym = await normalizeSurfaceTerm(GUIBI_TANG_WITH_SPACE);
  assert.ok(synonym);
  assert.equal(synonym?.normalizedTerm, GUIBI_TANG);
  assert.equal(synonym?.matchType, 'synonym');
  assert.equal(synonym?.needsUserConfirmation, false);

  const typo = await normalizeSurfaceTerm(GUIBO_TANG);
  assert.ok(typo);
  assert.equal(typo?.termId, 'term_001');
  assert.ok(['typo', 'semantic'].includes(typo?.matchType || ''));
  assert.equal(typo?.needsUserConfirmation, true);
  assert.ok((typo?.candidates || []).length >= 1);

  const romanized = await normalizeSurfaceTerm('Guibi-tang');
  assert.ok(romanized);
  assert.equal(romanized?.needsUserConfirmation, false);
  assert.equal(romanized?.normalizationPolicy, 'REQUIRE_CONFIRMATION');

  const noMatch = await normalizeSurfaceTerm(UNKNOWN_TERM);
  assert.equal(noMatch, null);

  const ambiguous = await normalizeSurfaceTerm(GUIBI);
  assert.ok(ambiguous);
  assert.equal(ambiguous?.needsUserConfirmation, true);
  assert.ok((ambiguous?.candidates || []).length >= 2);

  const genericTreatment = await normalizeSurfaceTerm(GENERIC_TREATMENT);
  assert.equal(genericTreatment, null);

  const phqAuto = await normalizeSurfaceTerm('PHQ9');
  assert.ok(phqAuto);
  assert.equal(phqAuto?.normalizedTerm, 'PHQ-9');
  assert.equal(phqAuto?.needsUserConfirmation, false);
  assert.equal(phqAuto?.normalizationPolicy, 'AUTO_NORMALIZE');
  assert.ok(phqAuto?.semanticTags.includes('depression-scale'));

  const pc6 = await normalizeSurfaceTerm('PC6');
  assert.ok(pc6);
  assert.equal(pc6?.normalizedTerm, '\uB0B4\uAD00(PC6)');
  assert.equal(pc6?.category, 'acupuncture_point');
  assert.ok(pc6?.semanticTags.includes('acupuncture-point'));

  const chest = await normalizeSurfaceTerm(CHEST_TIGHTNESS);
  assert.ok(chest);
  assert.equal(chest?.normalizedTerm, '\uD749\uBBFC');
  assert.equal(chest?.needsUserConfirmation, false);

  const wake = await normalizeSurfaceTerm(SLEEP_INTERRUPT);
  assert.ok(wake);
  assert.equal(wake?.normalizedTerm, '\uC911\uB3C4\uAC01\uC131');
  assert.equal(wake?.category, 'sleep_pattern');

  const slImp = await normalizeSurfaceTerm('sl imp');
  assert.ok(slImp);
  assert.equal(slImp?.normalizedTerm, 'sleep latency improved');
  assert.equal(slImp?.normalizationPolicy, 'PRESERVE_ORIGINAL');
  assert.equal(slImp?.preserveSurfaceForm, true);
  assert.ok(slImp?.semanticTags.includes('improvement'));

  const restricted = await normalizeSurfaceTerm('r/o');
  assert.ok(restricted);
  assert.equal(restricted?.evidenceUsage, 'WARNING');
  assert.equal(restricted?.preserveSurfaceForm, true);

  const preserveSentence = await normalizeTextWithTerms(`sl imp, ${FREQ_DECREASED}`);
  assert.equal(preserveSentence.normalizedText, `sl imp, ${FREQ_DECREASED}`);
  assert.equal(preserveSentence.terms.length, 2);
  assert.ok(preserveSentence.sectionHints.includes(CareSection.FOLLOW_UP_OUTCOMES));
  assert.ok(preserveSentence.sectionHints.includes(CareSection.TIMELINE));

  const symptomSentence = await normalizeTextWithTerms(SEVERE_SENTENCE);
  assert.equal(symptomSentence.normalizedText, SEVERE_NORMALIZED);
  assert.ok(symptomSentence.sectionHints.includes(CareSection.CLINICAL_FINDINGS));

  const acupunctureSentence = await normalizeTextWithTerms(ACUPUNCTURE_SENTENCE);
  assert.equal(acupunctureSentence.normalizedText, ACUPUNCTURE_NORMALIZED);
  assert.ok(acupunctureSentence.sectionHints.includes(CareSection.THERAPEUTIC_INTERVENTIONS));

  const phqUnicode = await normalizeSurfaceTerm('PHQ\u20119');
  assert.ok(phqUnicode);
  assert.equal(phqUnicode?.normalizedTerm, 'PHQ-9');

  const gadUnicode = await normalizeSurfaceTerm('GAD\uFF0D7');
  assert.ok(gadUnicode);
  assert.equal(gadUnicode?.normalizedTerm, 'GAD-7');

  const traceability = buildSectionDraftTraceability({
    draftText: 'PHQ-9 score improved after treatment. An unrelated unsupported statement remains.',
    evidenceCards: [
      {
        id: 'evidence_1',
        visitIndex: 1,
        visitDateTime: '2024-03-02',
        sourceText: 'PHQ-9 score improved after treatment',
        normalizedText: 'PHQ-9 score improved after treatment',
        evidenceType: 'questionnaire',
        tags: [],
        sectionHints: [],
        terms: [],
        confidence: 0.95
      }
    ]
  });
  assert.ok(traceability.evidenceLinks[0]?.evidenceCardIds.includes('evidence_1'));
  assert.equal(traceability.unsupportedClaims.length, 1);

  console.log('termNormalizer tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
