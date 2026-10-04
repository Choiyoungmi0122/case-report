type DraftMap = Record<string, string>;

type PreviewTerm = {
  normalizedTerm?: string;
  category?: string;
};

type PreviewEvidenceCard = {
  normalizedText?: string;
  sourceText?: string;
  evidenceType?: string;
  tags?: string[];
  terms?: PreviewTerm[];
};

const K = {
  caseReport: '\uC99D\uB840\uBCF4\uACE0',
  patient: '\uD658\uC790',
  patientTopic: '\uD658\uC790\uB294',
  recent: '\uCD5C\uADFC',
  family: '\uAC00\uC871',
  problem: '\uBB38\uC81C',
  becauseOf: '\uC778\uD55C',
  complaint: '\uD638\uC18C',
  little: '\uC57D\uAC04',
  있음: '\uC788\uC74C',
  없음: '\uC5C6\uC74C',
  afterTreatment: '\uCE58\uB8CC \uD6C4',
  chiefComplaint: '\uC8FC\uD638\uC18C',
  symptom: '\uC99D\uC0C1',
  suspected: '\uC758\uC2EC',
  diagnosis: '\uC9C4\uB2E8',
  assessment: '\uD3C9\uAC00',
  chestTight: '\uAC00\uC2B4 \uB2F5\uB2F5',
  chestTightRaw: '\uAC00\uC2B4\uB2F5\uB2F5',
  heatSensation: '\uC0C1\uC5F4\uAC10',
  acupuncture: '\uCE68 \uCE58\uB8CC',
  acupunctureRaw: '\uCE68\uCE58\uB8CC',
  counselingTherapy: '\uC0C1\uB2F4 \uCE58\uB8CC',
  counselingTherapyRaw: '\uC0C1\uB2F4\uCE58\uB8CC',
  breathing: '\uBCF5\uC2DD\uD638\uD761',
  sleepEducation: '\uC218\uBA74 \uC704\uC0DD \uAD50\uC721',
  titleFallback: '\uC8FC\uC694 \uC784\uC0C1 \uC99D\uC0C1\uACFC \uC911\uC7AC\uB97C \uC911\uC2EC\uC73C\uB85C \uD55C \uC99D\uB840\uBCF4\uACE0'
};

const STOPWORDS = new Set([
  K.patientTopic,
  K.patient,
  K.recent,
  K.family,
  '\uBB38\uC81C\uB85C',
  K.problem,
  K.becauseOf,
  K.complaint,
  '\uD638\uC18C\uD568',
  K.little,
  K.있음,
  K.없음,
  '\uCE58\uB8CC\uD6C4',
  K.afterTreatment,
  '\uC774\uD6C4',
  '\uD1B5\uD574',
  '\uB300\uD55C',
  '\uAD00\uB828',
  '\uC815\uB3C4',
  '\uC591\uD638',
  '\uBCF4\uD1B5',
  '\uC9C0\uC18D',
  '\uBCD1\uD589',
  '\uC720\uC9C0',
  '\uD655\uC778',
  '\uC2DC\uD589',
  '\uC8FC2\uD68C',
  '\uC8FC',
  '\uD68C',
  '\uC788\uB2E4',
  '\uC5C6\uB2E4',
  K.suspected,
  '\uD658\uC790\uC758'
]);

const KEYWORD_PRIORITY_LIMIT = 5;

function normalizeWhitespace(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripOuterPunctuation(text: string) {
  return normalizeWhitespace(text).replace(/^[^A-Za-z0-9\uAC00-\uD7A3(]+|[^A-Za-z0-9\uAC00-\uD7A3)]+$/g, '');
}

function normalizeKeywordCandidate(text: string) {
  let next = stripOuterPunctuation(text)
    .replace(/\b(?:r\/o|rule out|suspected|possible)\b/gi, '')
    .replace(/[,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  next = next
    .replace(new RegExp(K.chestTightRaw, 'g'), K.chestTight)
    .replace(new RegExp(K.acupunctureRaw, 'g'), K.acupuncture)
    .replace(new RegExp(K.counselingTherapyRaw, 'g'), K.counselingTherapy);

  if (!next || next.length < 2) return '';
  if (STOPWORDS.has(next)) return '';
  return next;
}

function dedupe(items: string[]) {
  return Array.from(new Set(items.map((item) => normalizeKeywordCandidate(item)).filter(Boolean)));
}

function collectTexts(cards: PreviewEvidenceCard[], predicate: (card: PreviewEvidenceCard) => boolean) {
  return cards
    .filter(predicate)
    .flatMap((card) => [card.normalizedText || '', card.sourceText || ''])
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function hasTag(card: PreviewEvidenceCard, tag: string) {
  return (card.tags || []).includes(tag);
}

function hasEvidenceType(card: PreviewEvidenceCard, value: string) {
  return String(card.evidenceType || '').toLowerCase() === value.toLowerCase();
}

function extractDiagnosisCandidates(text: string) {
  const source = normalizeWhitespace(text);
  const candidates: string[] = [];
  const chunks = source.split(/[\n,;]+/).map((item) => item.trim());

  for (const chunk of chunks) {
    if (chunk.includes('r/o')) {
      candidates.push(chunk.split('r/o')[0]?.trim() || '');
    }
    if (chunk.includes(K.suspected)) {
      candidates.push(chunk.split(K.suspected)[0]?.trim() || '');
    }
    if (chunk.startsWith(K.diagnosis) || chunk.startsWith(K.assessment)) {
      const parts = chunk.split(/[:>：]/);
      if (parts[1]) candidates.push(parts[1].trim());
    }
  }

  return dedupe(candidates);
}

function extractSymptomCandidates(text: string) {
  const source = normalizeWhitespace(text);
  const candidates: string[] = [];

  for (const marker of ['C/C', 'C/c', K.chiefComplaint]) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex >= 0) {
      const trailing = source.slice(markerIndex + marker.length).replace(/^[:>：\s]+/, '');
      const symptomText = trailing.split(/[.;\n]/)[0] || '';
      candidates.push(...symptomText.split(/[,/]| 및 | 와 | 과 /).map((item) => item.trim()));
      break;
    }
  }

  for (const match of source.matchAll(/[A-Za-z0-9\uAC00-\uD7A3()/-]{2,20}(?:\uD1B5|\uAC10|\uC5F4|\uB2F5\uB2F5|\uBD88\uC548|\uD749\uBBFC|\uB450\uADFC|\uC608\uBBFC|\uD53C\uB85C|\uBD88\uBA74|\uBD88\uD3B8)/g)) {
    candidates.push(match[0]);
  }

  return dedupe(candidates);
}

function extractInterventionCandidates(text: string) {
  const source = normalizeWhitespace(text);
  const candidates: string[] = [];

  if (/\bAT\b/i.test(source) || /\bPC6\b|\bLI4\b|\bLR3\b|\bST36\b/i.test(source)) {
    candidates.push(K.acupuncture);
  }

  for (const phrase of [K.acupuncture, K.counselingTherapy, K.breathing, K.sleepEducation]) {
    if (source.includes(phrase.replace(/\s+/g, '')) || source.includes(phrase)) {
      candidates.push(phrase);
    }
  }

  for (const match of source.matchAll(/([A-Za-z0-9\uAC00-\uD7A3()/-]{2,30}\s*(?:\uCE58\uB8CC|\uAD50\uC721|\uC9C0\uB3C4))/g)) {
    candidates.push(match[1]);
  }

  return dedupe(candidates);
}

function extractTestCandidates(text: string) {
  const source = normalizeWhitespace(text);
  const candidates: string[] = [];

  for (const match of source.matchAll(/\b[A-Z]{2,}(?:-\d+|\d+)\b/g)) {
    candidates.push(match[0]);
  }

  return dedupe(candidates);
}

function extractOutcomeCandidates(text: string) {
  const source = normalizeWhitespace(text);
  const candidates: string[] = [];

  for (const match of source.matchAll(/[A-Za-z0-9\uAC00-\uD7A3()/-]{2,20}(?:\uD638\uC804|\uAC1C\uC120|\uAC10\uC18C|\uC545\uD654|\uC644\uD654|\uC9C0\uC18D|\uD68C\uBCF5)/g)) {
    candidates.push(match[0]);
  }

  return dedupe(candidates);
}

function collectTermCandidates(cards: PreviewEvidenceCard[], categoryHint: string) {
  return dedupe(
    cards.flatMap((card) =>
      (card.terms || [])
        .filter((term) => String(term.category || '').toLowerCase().includes(categoryHint))
        .map((term) => term.normalizedTerm || '')
    )
  );
}

function buildKeywordBuckets(draftsBySection: DraftMap, evidenceCards: PreviewEvidenceCard[] = []) {
  const diagnosticDraft = draftsBySection.DIAGNOSTIC_ASSESSMENT || '';
  const clinicalDraft = draftsBySection.CLINICAL_FINDINGS || '';
  const patientDraft = draftsBySection.PATIENT_INFORMATION || '';
  const interventionDraft = draftsBySection.THERAPEUTIC_INTERVENTIONS || '';
  const followUpDraft = draftsBySection.FOLLOW_UP_OUTCOMES || '';

  const diagnosisCards = evidenceCards.filter(
    (card) => hasTag(card, 'DIAGNOSTIC_ASSESSMENT') || hasEvidenceType(card, 'diagnostic_assessment')
  );
  const symptomCards = evidenceCards.filter(
    (card) =>
      hasTag(card, 'CLINICAL_FINDINGS') ||
      hasTag(card, 'PATIENT_INFORMATION') ||
      hasEvidenceType(card, 'clinical_finding') ||
      hasEvidenceType(card, 'patient_information')
  );
  const interventionCards = evidenceCards.filter(
    (card) => hasTag(card, 'THERAPEUTIC_INTERVENTIONS') || hasEvidenceType(card, 'therapeutic_intervention')
  );
  const followUpCards = evidenceCards.filter(
    (card) => hasTag(card, 'FOLLOW_UP_OUTCOMES') || hasEvidenceType(card, 'follow_up_outcome')
  );

  return {
    diagnosis: dedupe([
      ...collectTermCandidates(diagnosisCards, 'diagn'),
      ...extractDiagnosisCandidates(diagnosticDraft),
      ...collectTexts(diagnosisCards, () => true).flatMap(extractDiagnosisCandidates)
    ]),
    symptoms: dedupe([
      ...collectTermCandidates(symptomCards, 'symptom'),
      ...extractSymptomCandidates(clinicalDraft),
      ...extractSymptomCandidates(patientDraft),
      ...collectTexts(symptomCards, () => true).flatMap(extractSymptomCandidates)
    ]),
    interventions: dedupe([
      ...collectTermCandidates(interventionCards, 'treat'),
      ...extractInterventionCandidates(interventionDraft),
      ...collectTexts(interventionCards, () => true).flatMap(extractInterventionCandidates)
    ]),
    tests: dedupe([
      ...extractTestCandidates(diagnosticDraft),
      ...collectTexts(diagnosisCards, () => true).flatMap(extractTestCandidates)
    ]),
    outcomes: dedupe([
      ...extractOutcomeCandidates(followUpDraft),
      ...collectTexts(followUpCards, () => true).flatMap(extractOutcomeCandidates)
    ])
  };
}

export function buildAcademicTitlePreview(
  draftsBySection: DraftMap,
  evidenceCards: PreviewEvidenceCard[] = []
) {
  const buckets = buildKeywordBuckets(draftsBySection, evidenceCards);
  const diagnosis = buckets.diagnosis[0] || '';
  const symptom = buckets.symptoms[0] || '';
  const intervention = buckets.interventions[0] || '';

  if (intervention && diagnosis) {
    return `${intervention}\uB97C \uD65C\uC6A9\uD55C ${diagnosis} ${K.patient}\uC758 ${K.caseReport}`;
  }

  if (symptom && diagnosis) {
    return `${symptom}\uC744 \uBCF4\uC778 ${diagnosis} ${K.patient}\uC758 ${K.caseReport}`;
  }

  if (diagnosis) {
    return `${diagnosis} ${K.patient}\uC758 ${K.caseReport}`;
  }

  if (symptom && intervention) {
    return `${symptom}\uC5D0 \uB300\uD55C ${intervention} ${K.caseReport}`;
  }

  if (symptom) {
    return `${symptom}\uC744 \uBCF4\uC778 ${K.caseReport}`;
  }

  if (intervention) {
    return `${intervention} \uC911\uC2EC ${K.caseReport}`;
  }

  return K.titleFallback;
}

export function buildAcademicKeywordPreview(
  draftsBySection: DraftMap,
  evidenceCards: PreviewEvidenceCard[] = []
) {
  const buckets = buildKeywordBuckets(draftsBySection, evidenceCards);
  const ordered = dedupe([
    ...buckets.diagnosis,
    ...buckets.symptoms,
    ...buckets.interventions,
    ...buckets.tests,
    ...buckets.outcomes,
    K.caseReport
  ]);

  const keywords = ordered.filter((item) => !STOPWORDS.has(item)).slice(0, KEYWORD_PRIORITY_LIMIT);

  if (!keywords.includes(K.caseReport)) {
    if (keywords.length < KEYWORD_PRIORITY_LIMIT) {
      keywords.push(K.caseReport);
    } else {
      keywords[KEYWORD_PRIORITY_LIMIT - 1] = K.caseReport;
    }
  }

  return dedupe(keywords).slice(0, KEYWORD_PRIORITY_LIMIT);
}
