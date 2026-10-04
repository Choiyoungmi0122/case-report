import { randomUUID } from 'crypto';
import { callLLMWithSchema, LLMUsageMetrics } from './client';
import { Chain1OutputSchema, EvidenceCard } from './schemas/chain1_splitTag';
import { Chain2OutputSchema, SectionAssessment } from './schemas/chain2_assess';
import { Chain3OutputSchema, SectionDraft } from './schemas/chain3_draft';
import { Chain4MissingOutputSchema, CommonMissingItem, SectionMissing } from './schemas/chain4_missing';
import { Chain5QuestionOutputSchema, CommonQuestionSet, SectionQuestionSet } from './schemas/chain5_questions';
import { Chain6SectionUpdateOutputSchema, Chain6SectionUpdateOutput } from './schemas/chain6_update';
import { FinalDraftSchema, FinalDraft } from './schemas/chain5_final';
import { CareSection, CareSectionEnum } from './schemas/common';
import {
  SectionAdequacyReviewOutput,
  SectionAdequacyReviewOutputSchema
} from './schemas/section_adequacy_review';
import { buildCareRubricSummary, careSectionRubricMap, SupportedCareSectionId } from '../config/careSectionRubric';
import { chain1SystemPrompt, buildChain1UserPrompt } from './prompts/chain1_splitTag';
import { chain2SystemPrompt, buildChain2UserPrompt } from './prompts/chain2_assess';
import { chain3SystemPrompt, buildChain3UserPrompt } from './prompts/chain3_draft';
import { chain4MissingSystemPrompt, buildChain4MissingUserPrompt } from './prompts/chain4_missing';
import { chain5QuestionSystemPrompt, buildChain5QuestionUserPrompt } from './prompts/chain5_questions';
import { chain6UpdateSystemPrompt, buildChain6UpdateUserPrompt } from './prompts/chain6_update';
import { chain7SystemPrompt, buildChain7UserPrompt } from './prompts/chain7_final';
import {
  buildSectionAdequacyReviewUserPrompt,
  sectionAdequacyReviewSystemPrompt
} from './prompts/section_adequacy_review';
import {
  buildSectionHintsFromTerms,
  normalizeLookupKey,
  normalizeTextWithTerms
} from '../rag/termNormalizer';
import { TermNormalizationResult } from '../rag/types';
import { RetrievedTermResolver } from '../rag/resolver';
import {
  COMMON_QUESTION_FALLBACK_TEMPLATES,
  inferQuestionCategoryFromText,
  normalizeQuestionComparisonKey,
  normalizeQuestionText
} from '../questions/questionTemplates';
import { DeidentifiedEMR, deidentifyEMR } from '../deid';
import { deidentifyCaseEMRs } from '../deid';
import { isFixedStudyCaseText } from '../study/cases/defaultStudyCase';
import {
  DeidentifiedVisitRecord,
  PendingTermConfirmation,
  ReviewRequiredState
} from '../types';
import { repairSplitClinicalEvidenceCards } from '../utils/evidenceCardRepair';

const FAST_LLM_MODEL = process.env.FAST_LLM_MODEL || 'gpt-4.1-mini';
const QUALITY_LLM_MODEL = process.env.QUALITY_LLM_MODEL || 'gpt-4.1';

const CORE_AI_SECTIONS: CareSection[] = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VisitInput = {
  index: number;
  date: string;
  text: string;
};

type DeidentifiedVisitInput = {
  index: number;
  date: string;
  text: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
};

type PreprocessedChain1Input = {
  deidentifiedEMRs: DeidentifiedVisitRecord[];
  deidentifiedVisits: DeidentifiedVisitInput[];
  preparedVisits: PreparedVisit[];
  pendingTermConfirmations: PendingTermConfirmation[];
  reviewRequired: ReviewRequiredState | null;
};

type TermDecisionMap = Map<string, PendingTermConfirmation>;

type PreparedClause = {
  sourceText: string;
  normalizedText: string;
  terms: TermNormalizationResult[];
  sectionHints: CareSection[];
  start: number;
  end: number;
  score: number;
};

type PreparedVisit = {
  index: number;
  date: string;
  text: string;
  normalizedText: string;
  clauses: PreparedClause[];
};

type NormalizerSemanticMatcher = NonNullable<Parameters<typeof normalizeTextWithTerms>[1]>['semanticMatcher'];
type NormalizerLlmResolver = RetrievedTermResolver;

type ChainRuntimeMeta = {
  onUsage?: (usage: LLMUsageMetrics | null) => void;
};

export function getModelForChain(chainName: string): string {
  switch (chainName) {
    case 'chain1':
    case 'chain2':
    case 'chain4':
    case 'chain5':
      return process.env[`${chainName.toUpperCase()}_MODEL`] || FAST_LLM_MODEL;
    case 'chain3':
    case 'chain6':
    case 'chain7':
    case 'review':
      return process.env[`${chainName.toUpperCase()}_MODEL`] || QUALITY_LLM_MODEL;
    default:
      return process.env.LLM_MODEL || QUALITY_LLM_MODEL;
  }
}

function normalizeForGrounding(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

function uniqueSections(items: string[]): CareSection[] {
  const validSet = new Set(CareSectionEnum.options);
  return Array.from(
    new Set(
      (items || [])
        .map((item) => String(item || '').trim())
        .filter((item): item is CareSection => validSet.has(item as CareSection))
    )
  );
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.85;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

// Chain1's evidenceType is a per-card content judgement, so it is a steadier
// signal than the free-form tags array and guarantees a card reaches the
// section its own type names.
const EVIDENCE_TYPE_SECTION: Record<string, CareSection> = {
  patient_information: 'PATIENT_INFORMATION',
  clinical_finding: 'CLINICAL_FINDINGS',
  timeline: 'TIMELINE',
  diagnostic_assessment: 'DIAGNOSTIC_ASSESSMENT',
  therapeutic_intervention: 'THERAPEUTIC_INTERVENTIONS',
  treatment: 'THERAPEUTIC_INTERVENTIONS',
  follow_up_outcome: 'FOLLOW_UP_OUTCOMES',
  patient_perspective: 'PATIENT_PERSPECTIVE'
};

function inferEvidenceType(sectionHints: CareSection[]): string {
  if (sectionHints.includes('THERAPEUTIC_INTERVENTIONS')) return 'treatment';
  if (sectionHints.includes('FOLLOW_UP_OUTCOMES')) return 'follow_up_outcome';
  if (sectionHints.includes('DIAGNOSTIC_ASSESSMENT')) return 'diagnostic_assessment';
  if (sectionHints.includes('TIMELINE')) return 'timeline';
  if (sectionHints.includes('CLINICAL_FINDINGS')) return 'clinical_finding';
  if (sectionHints.includes('PATIENT_INFORMATION')) return 'patient_information';
  if (sectionHints.includes('PATIENT_PERSPECTIVE')) return 'patient_perspective';
  return 'other';
}

function isSingleLetterClinicalAbbreviation(text: string, periodIndex: number): boolean {
  const letter = text[periodIndex - 1] || '';
  const beforeLetter = text[periodIndex - 2] || '';
  const followingText = text.slice(periodIndex + 1);
  return (
    /[A-Za-z]/.test(letter) &&
    !/[A-Za-z]/.test(beforeLetter) &&
    /^\s*[a-z][A-Za-z-]*/.test(followingText)
  );
}

export function splitIntoClauses(text: string): Array<{ text: string; start: number; end: number }> {
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  let clauseStart = 0;

  const pushClause = (rawStart: number, rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd);
    const trimmed = raw.trim();
    if (!trimmed) return;
    const start = rawStart + raw.indexOf(trimmed);
    clauses.push({
      text: trimmed,
      start,
      end: start + trimmed.length
    });
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\n') {
      pushClause(clauseStart, index);
      clauseStart = index + 1;
      continue;
    }
    if (!'.!?'.includes(character)) continue;
    if (character === '.' && isSingleLetterClinicalAbbreviation(text, index)) continue;

    let end = index + 1;
    while (end < text.length && '.!?'.includes(text[end])) end += 1;
    pushClause(clauseStart, end);
    clauseStart = end;
    index = end - 1;
  }

  pushClause(clauseStart, text.length);

  if (clauses.length === 0 && text.trim()) {
    clauses.push({
      text: text.trim(),
      start: 0,
      end: text.trim().length
    });
  }

  return clauses;
}

function scoreClause(clauseText: string, terms: TermNormalizationResult[]): number {
  const normalized = normalizeForGrounding(clauseText);
  let score = Math.min(6, normalized.length / 24);
  if (/\d/.test(clauseText)) score += 0.7;
  if (/[A-Za-z]{2,}/.test(clauseText)) score += 0.2;
  if (terms.length > 0) score += 1.2 + terms.length * 0.4;
  if (clauseText.includes('진단') || clauseText.includes('평가')) score += 0.5;
  if (clauseText.includes('치료') || clauseText.includes('처방') || clauseText.includes('복용')) score += 0.5;
  if (clauseText.includes('호전') || clauseText.includes('악화') || clauseText.includes('추적')) score += 0.4;
  return Number(score.toFixed(3));
}

function splitDraftSentences(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function characterBigrams(text: string): Set<string> {
  const normalized = normalizeForGrounding(text);
  const bigrams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }
  return bigrams;
}

// A draft sentence usually merges several evidence cards, so support is judged
// against the pooled evidence (how much of the sentence is covered at all),
// while links go to the individual cards that overlap it most.
const UNSUPPORTED_COVERAGE_THRESHOLD = 0.4;
const EVIDENCE_LINK_THRESHOLD = 0.4;

function buildDraftTraceability(params: {
  draftText: string;
  evidenceCards: EvidenceCard[];
  preferredEvidenceIds?: string[];
  supplementalTexts?: string[];
}) {
  const sentences = splitDraftSentences(params.draftText);
  const preferredIds = new Set(params.preferredEvidenceIds || []);
  const cardBigrams = params.evidenceCards.map((card) => ({
    id: card.id,
    bigrams: new Set([...characterBigrams(card.sourceText || ''), ...characterBigrams(card.normalizedText || '')])
  }));
  const pooledBigrams = new Set<string>();
  for (const card of cardBigrams) card.bigrams.forEach((bigram) => pooledBigrams.add(bigram));
  for (const text of params.supplementalTexts || []) {
    characterBigrams(text).forEach((bigram) => pooledBigrams.add(bigram));
  }

  const analysed = sentences.map((sentence) => {
    const sentenceBigrams = characterBigrams(sentence);
    const covered = Array.from(sentenceBigrams).filter((bigram) => pooledBigrams.has(bigram)).length;
    const coverage = covered / Math.max(sentenceBigrams.size, 1);
    const ranked = cardBigrams
      .map((card) => {
        const overlap = Array.from(card.bigrams).filter((bigram) => sentenceBigrams.has(bigram)).length;
        return {
          id: card.id,
          score: overlap / Math.max(Math.min(card.bigrams.size, sentenceBigrams.size), 1)
        };
      })
      .filter((item) => item.score >= EVIDENCE_LINK_THRESHOLD)
      .sort(
        (a, b) =>
          Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id)) || b.score - a.score
      )
      .slice(0, 3)
      .map((item) => item.id);

    return { sentence, coverage, evidenceCardIds: uniqueStrings(ranked) };
  });

  const evidenceLinks = analysed.map(({ sentence, evidenceCardIds }) => ({ sentence, evidenceCardIds }));

  const unsupportedClaims = analysed
    .filter((item) => item.sentence.length >= 12 && item.coverage < UNSUPPORTED_COVERAGE_THRESHOLD)
    .map((item) => ({
      sentence: item.sentence,
      reason: '이 문장을 뒷받침할 만큼 유사한 기록 근거를 찾지 못했습니다.'
    }));

  return { evidenceLinks, unsupportedClaims };
}

export function buildSectionDraftTraceability(params: {
  draftText: string;
  evidenceCards: EvidenceCard[];
  preferredEvidenceIds?: string[];
  supplementalTexts?: string[];
}) {
  return buildDraftTraceability(params);
}

function toStoredDeidentifiedVisitRecord(
  deidentifiedEMR: DeidentifiedEMR,
  visit: VisitInput
): DeidentifiedVisitRecord {
  return {
    visitIndex: visit.index,
    visitDate: visit.date || '',
    emrId: deidentifiedEMR.emrId,
    deidentifiedText: deidentifiedEMR.deidentifiedText,
    phiSpans: deidentifiedEMR.phiSpans,
    replacementMap: deidentifiedEMR.replacementMap,
    riskLevel: deidentifiedEMR.riskLevel
  };
}

function buildReviewRequiredState(visits: DeidentifiedVisitRecord[]): ReviewRequiredState | null {
  const highestRisk = visits.some((visit) => visit.riskLevel === 'HIGH')
    ? 'HIGH'
    : visits.some((visit) => visit.riskLevel === 'MEDIUM')
      ? 'MEDIUM'
      : null;

  if (!highestRisk) return null;

  return {
    riskLevel: highestRisk,
    reasons: visits
      .filter((visit) => visit.riskLevel === highestRisk)
      .map((visit) => `Visit ${visit.visitIndex} de-identification risk is ${visit.riskLevel}.`),
    createdAt: new Date().toISOString()
  };
}

function buildPendingTermConfirmations(preparedVisits: PreparedVisit[]): PendingTermConfirmation[] {
  const seen = new Set<string>();
  const pending: PendingTermConfirmation[] = [];

  for (const visit of preparedVisits) {
    for (const clause of visit.clauses) {
      for (const term of clause.terms) {
        if (!term.needsUserConfirmation) continue;
        const key = `${visit.index}:${clause.sourceText}:${term.surface}:${term.termId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        pending.push({
          pendingId: randomUUID(),
          visitIndex: visit.index,
          visitDate: visit.date || '',
          sourceText: clause.sourceText,
          normalizedText: clause.normalizedText,
          surface: term.surface,
          normalizedTerm: term.normalizedTerm || '',
          termId: term.termId,
          category: term.category,
          matchType: term.matchType,
          confidence: term.confidence,
          needsUserConfirmation: true,
          candidates: term.candidates || [],
          status: 'PENDING',
          decisionReuseKey: buildTermDecisionReuseKey(term.surface, term.candidates || [], term.category),
          reuseEligible: isReuseEligible(term)
        });
      }
    }
  }

  return pending;
}

function buildPendingOccurrenceKey(params: {
  visitIndex: number;
  sourceText: string;
  surface: string;
  termId: string;
}) {
  return `${params.visitIndex}:${params.sourceText}:${params.surface}:${params.termId}`;
}

function buildTermDecisionReuseKey(
  surface: string,
  candidates: Array<{ termId: string }>,
  category: string
): string {
  const normalizedSurface = normalizeLookupKey(surface);
  const candidateKey = (candidates || [])
    .map((item) => item.termId)
    .filter(Boolean)
    .sort()
    .join('|');
  return `${category}:${normalizedSurface}:${candidateKey}`;
}

function isReuseEligible(term: Pick<
  TermNormalizationResult,
  'category' | 'preserveSurfaceForm' | 'semanticTags' | 'normalizationPolicy' | 'candidates'
>): boolean {
  if (term.preserveSurfaceForm) return false;
  if (term.normalizationPolicy === 'PRESERVE_ORIGINAL') return false;
  if (!term.candidates || term.candidates.length === 0) return false;
  if (['diagnosis', 'timeline_marker', 'other'].includes(term.category)) return false;

  const normalizedTags = new Set((term.semanticTags || []).map((item) => normalizeLookupKey(item)));
  if (normalizedTags.has('diagnosticuncertainty') || normalizedTags.has('timelinemarker')) {
    return false;
  }

  return true;
}

function buildTermDecisionMap(pendingTermConfirmations: PendingTermConfirmation[]): TermDecisionMap {
  const decisionMap = new Map<string, PendingTermConfirmation>();

  for (const item of pendingTermConfirmations || []) {
    if (item.status !== 'CONFIRMED' && item.status !== 'REJECTED') continue;

    decisionMap.set(
      buildPendingOccurrenceKey({
        visitIndex: item.visitIndex,
        sourceText: item.sourceText,
        surface: item.surface,
        termId: item.termId
      }),
      item
    );

    if (item.reuseEligible && item.decisionReuseKey) {
      decisionMap.set(`reuse:${item.decisionReuseKey}`, item);
    }
  }

  return decisionMap;
}

function applyTermDecisionToText(
  text: string,
  terms: TermNormalizationResult[],
  decisions: TermDecisionMap,
  params: {
    visitIndex: number;
    sourceText: string;
  }
): string {
  let nextText = text;
  for (const term of terms) {
    const decision =
      decisions.get(
        buildPendingOccurrenceKey({
          visitIndex: params.visitIndex,
          sourceText: params.sourceText,
          surface: term.surface,
          termId: term.termId
        })
      ) ||
      decisions.get(
        `reuse:${buildTermDecisionReuseKey(term.surface, term.candidates || [], term.category)}`
      );
    if (!decision) continue;
    const replacement =
      decision.status === 'CONFIRMED'
        ? decision.confirmedTerm || term.normalizedTerm
        : decision.customReplacement || '';
    if (!replacement) continue;
    nextText = nextText.split(term.surface).join(replacement);
  }
  return nextText;
}

function applyTermConfirmationDecisions(
  preparedVisits: PreparedVisit[],
  storedConfirmations: PendingTermConfirmation[] = []
): PreparedVisit[] {
  const decisions = buildTermDecisionMap(storedConfirmations);
  if (decisions.size === 0) return preparedVisits;

  return preparedVisits.map((visit) => {
    const nextClauses = visit.clauses.map((clause) => {
      const nextTerms = clause.terms.map((term) => {
        const decision =
          decisions.get(
            buildPendingOccurrenceKey({
              visitIndex: visit.index,
              sourceText: clause.sourceText,
              surface: term.surface,
              termId: term.termId
            })
          ) ||
          decisions.get(
            `reuse:${buildTermDecisionReuseKey(term.surface, term.candidates || [], term.category)}`
          );
        if (!decision) return term;

        if (decision.status === 'CONFIRMED') {
          return {
            ...term,
            normalizedTerm: decision.confirmedTerm || term.normalizedTerm,
            needsUserConfirmation: false
          };
        }

        if (decision.customReplacement) {
          return {
            ...term,
            normalizedTerm: decision.customReplacement,
            needsUserConfirmation: false
          };
        }

        return {
          ...term,
          normalizedTerm: '',
          needsUserConfirmation: false
        };
      });

      const normalizedText = applyTermDecisionToText(
        clause.normalizedText || clause.sourceText,
        nextTerms,
        decisions,
        {
          visitIndex: visit.index,
          sourceText: clause.sourceText
        }
      );

      return {
        ...clause,
        terms: nextTerms,
        normalizedText,
        sectionHints: uniqueSections([
          ...clause.sectionHints,
          ...buildSectionHintsFromTerms(nextTerms.filter((term) => !term.needsUserConfirmation))
        ])
      };
    });

    return {
      ...visit,
      clauses: nextClauses,
      normalizedText: nextClauses.map((clause) => clause.normalizedText).join(' ')
    };
  });
}

function mergePendingTermConfirmations(
  existing: PendingTermConfirmation[],
  nextPending: PendingTermConfirmation[]
): PendingTermConfirmation[] {
  const pendingByKey = new Map(
    (nextPending || []).map((item) => [
      buildPendingOccurrenceKey({
        visitIndex: item.visitIndex,
        sourceText: item.sourceText,
        surface: item.surface,
        termId: item.termId
      }),
      item
    ] as const)
  );
  const resolved = (existing || []).filter((item) => item.status !== 'PENDING');

  return [
    ...resolved,
    ...Array.from(pendingByKey.values()).map((item) => {
      const existingMatch = (existing || []).find(
        (candidate) =>
          buildPendingOccurrenceKey({
            visitIndex: candidate.visitIndex,
            sourceText: candidate.sourceText,
            surface: candidate.surface,
            termId: candidate.termId
          }) ===
          buildPendingOccurrenceKey({
            visitIndex: item.visitIndex,
            sourceText: item.sourceText,
            surface: item.surface,
            termId: item.termId
          })
      );

      if (!existingMatch || existingMatch.status === 'PENDING') {
        return {
          ...item,
          pendingId: existingMatch?.pendingId || item.pendingId
        };
      }

      return {
        ...existingMatch,
        pendingId: existingMatch.pendingId || item.pendingId
      };
    })
  ];
}

export async function preprocessVisitsForChain1(
  visits: VisitInput[],
  options: {
    storedConfirmations?: PendingTermConfirmation[];
    semanticMatcher?: NormalizerSemanticMatcher;
    llmResolver?: NormalizerLlmResolver;
  } = {}
): Promise<PreprocessedChain1Input> {
  // The fixed virtual-patient study case has no real identifiers; running the
  // detector on it only produces false positives that corrupt the evidence text.
  const deidentifiedOnly: DeidentifiedEMR[] = isFixedStudyCaseText(visits.map((visit) => visit.text || ''))
    ? visits.map((visit) => ({
        emrId: `visit_${visit.index}`,
        originalTextStoredLocalOnly: true,
        deidentifiedText: visit.text || '',
        phiSpans: [],
        replacementMap: [],
        riskLevel: 'LOW'
      }))
    : await deidentifyCaseEMRs(
        visits.map((visit) => ({
          text: visit.text || '',
          emrId: `visit_${visit.index}`
        }))
      );
  const deidentifiedResults = visits.map((visit, index) => ({
    visit,
    deidentifiedEMR: deidentifiedOnly[index]
  }));

  const deidentifiedEMRs = deidentifiedResults.map(({ visit, deidentifiedEMR }) =>
    toStoredDeidentifiedVisitRecord(deidentifiedEMR, visit)
  );

  const deidentifiedVisits: DeidentifiedVisitInput[] = deidentifiedResults.map(({ visit, deidentifiedEMR }) => ({
    index: visit.index,
    date: visit.date,
    text: deidentifiedEMR.deidentifiedText,
    riskLevel: deidentifiedEMR.riskLevel
  }));

  const reviewRequired = buildReviewRequiredState(deidentifiedEMRs);

  // Privacy gate ahead of every external call. `prepareVisitsForChain1` reaches
  // the OpenAI embedding and terminology-resolver APIs, so the HIGH-risk
  // decision has to be made BEFORE it runs - otherwise a case the system itself
  // flagged as still carrying identifiers would already have been sent out.
  // Returning early keeps the outbound call count at zero; the caller detects
  // `reviewRequired.riskLevel === 'HIGH'` and blocks the rest of the pipeline.
  if (reviewRequired?.riskLevel === 'HIGH') {
    return {
      deidentifiedEMRs,
      deidentifiedVisits,
      preparedVisits: [],
      pendingTermConfirmations: options.storedConfirmations || [],
      reviewRequired
    };
  }

  const preparedVisits = applyTermConfirmationDecisions(
    await prepareVisitsForChain1(deidentifiedVisits, options),
    options.storedConfirmations || []
  );
  const pendingTermConfirmations = mergePendingTermConfirmations(
    options.storedConfirmations || [],
    buildPendingTermConfirmations(preparedVisits)
  );

  return {
    deidentifiedEMRs,
    deidentifiedVisits,
    preparedVisits,
    pendingTermConfirmations,
    reviewRequired
  };
}

async function prepareVisitsForChain1(
  visits: DeidentifiedVisitInput[],
  options: {
    semanticMatcher?: NormalizerSemanticMatcher;
    llmResolver?: NormalizerLlmResolver;
  } = {}
): Promise<PreparedVisit[]> {
  return Promise.all(
    visits.map(async (visit) => {
      const rawClauses = splitIntoClauses(visit.text || '');
      const clauses: PreparedClause[] = [];

      for (const clause of rawClauses) {
        const normalized = await normalizeTextWithTerms(clause.text, {
          semanticMatcher: options.semanticMatcher,
          llmResolver: options.llmResolver
        });
        clauses.push({
          sourceText: clause.text,
          normalizedText: normalized.normalizedText || clause.text,
          terms: normalized.terms,
          sectionHints: normalized.sectionHints,
          start: clause.start,
          end: clause.end,
          score: scoreClause(clause.text, normalized.terms)
        });
      }

      const normalizedText = clauses.map((clause) => clause.normalizedText).join(' ');

      return {
        index: visit.index,
        date: visit.date,
        text: visit.text || '',
        normalizedText,
        clauses
      };
    })
  );
}

function selectPromptClauses(clauses: PreparedClause[], maxClauses = 40): PreparedClause[] {
  if (clauses.length <= maxClauses) return clauses;

  const selected = new Map<number, PreparedClause>();
  const sortedByScore = [...clauses].sort((a, b) => b.score - a.score);

  if (clauses[0]) selected.set(clauses[0].start, clauses[0]);
  if (clauses[clauses.length - 1]) selected.set(clauses[clauses.length - 1].start, clauses[clauses.length - 1]);

  for (const clause of sortedByScore) {
    if (selected.size >= maxClauses) break;
    selected.set(clause.start, clause);
  }

  return Array.from(selected.values()).sort((a, b) => a.start - b.start);
}

function buildNarrativeVisitPromptText(preparedVisits: PreparedVisit[]): string {
  return preparedVisits
    .map((visit) => {
      const selectedClauses = selectPromptClauses(visit.clauses);
      const clauseText = selectedClauses
        .map((clause, index) => {
          const termText =
            clause.terms.length > 0
              ? clause.terms
                  .map((term) =>
                    `${term.surface}=>${term.normalizedTerm || '(confirmation needed)'}:${term.matchType}:${term.confidence}`
                  )
                  .join(', ')
              : '-';
          const hintText = clause.sectionHints.length > 0 ? clause.sectionHints.join(', ') : '-';
          return [
            `- Clause ${index + 1}`,
            `  source: ${clause.sourceText}`,
            `  normalized: ${clause.normalizedText}`,
            `  sectionHints: ${hintText}`,
            `  terms: ${termText}`
          ].join('\n');
        })
        .join('\n');

      return [`[Visit ${visit.index}] date=${visit.date || '(unknown)'}`, clauseText].join('\n');
    })
    .join('\n\n');
}

function textSimilarity(a: string, b: string): number {
  const normalizedA = normalizeLookupKey(a);
  const normalizedB = normalizeLookupKey(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    return Math.min(normalizedA.length, normalizedB.length) / Math.max(normalizedA.length, normalizedB.length);
  }

  const aTokens = normalizedA.match(/.{1,2}/g) || [];
  const bTokens = normalizedB.match(/.{1,2}/g) || [];
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const overlap = Array.from(aSet).filter((token) => bSet.has(token)).length;
  return overlap / Math.max(aSet.size, bSet.size, 1);
}

function findBestClauseMatch(cardText: string, visit: PreparedVisit | undefined): PreparedClause | null {
  if (!visit || !cardText.trim()) return null;

  let bestClause: PreparedClause | null = null;
  let bestScore = 0;

  for (const clause of visit.clauses) {
    const score = Math.max(
      textSimilarity(cardText, clause.sourceText),
      textSimilarity(cardText, clause.normalizedText)
    );
    if (score > bestScore) {
      bestScore = score;
      bestClause = clause;
    }
  }

  return bestScore >= 0.35 ? bestClause : null;
}

function buildTaggedEvidenceSummary(evidenceCards: EvidenceCard[]): string {
  return CORE_AI_SECTIONS.map((sectionId) => {
    const relevant = evidenceCards.filter((card) => {
      const hints = uniqueSections([...(card.tags || []), ...(card.sectionHints || [])]);
      return hints.includes(sectionId);
    });

    const items =
      relevant.length > 0
        ? relevant
            .map(
              (card) =>
                `- (${card.id}) [visit ${card.visitIndex}] ${
                  card.normalizedText || card.sourceText || ''
                }`
            )
            .join('\n')
        : '- (none)';

    return `[${sectionId}]\n${items}`;
  }).join('\n\n');
}

function buildSectionAssessmentSummary(
  evidenceCards: EvidenceCard[],
  targetSectionIds: CareSection[] = CORE_AI_SECTIONS
): string {
  return targetSectionIds.map((sectionId) => {
    const relevant = evidenceCards.filter((card) => {
      const hints = uniqueSections([...(card.tags || []), ...(card.sectionHints || [])]);
      return hints.includes(sectionId);
    });
    const items =
      relevant.length > 0
        ? relevant
            .map((card) => `- [visit ${card.visitIndex}] ${card.normalizedText || card.sourceText || ''}`)
            .join('\n')
        : '- (none)';
    return `[${sectionId}] evidenceCount=${relevant.length}\n${items}`;
  }).join('\n\n');
}

function getEvidenceForSection(evidenceCards: EvidenceCard[], sectionId: CareSection): EvidenceCard[] {
  return evidenceCards.filter((card) => {
    const hints = uniqueSections([...(card.tags || []), ...(card.sectionHints || [])]);
    return hints.includes(sectionId);
  });
}

function hasMeaningfulText(cards: EvidenceCard[], minLength = 12): boolean {
  return cards.some((card) => String(card.normalizedText || card.sourceText || '').trim().length >= minLength);
}

function buildHeuristicAssessment(sectionId: CareSection, evidenceCards: EvidenceCard[]): SectionAssessment {
  const relevant = getEvidenceForSection(evidenceCards, sectionId);
  const count = relevant.length;

  if (sectionId === 'TITLE' || sectionId === 'ABSTRACT' || sectionId === 'INTRODUCTION' || sectionId === 'INFORMED_CONSENT') {
    return {
      sectionId,
      status: 'IMPOSSIBLE',
      rationaleText: '이 섹션은 EMR 근거만으로는 작성하기 어렵고 저자가 제공하는 맥락이 필요합니다.'
    };
  }

  if (sectionId === 'DISCUSSION_CONCLUSION') {
    return {
      sectionId,
      status: count > 0 ? 'INCOMPLETE' : 'IMPOSSIBLE',
      rationaleText:
        count > 0
          ? '증례 관련 근거는 일부 있으나 해석과 고찰에는 저자의 추가 입력이 필요합니다.'
          : '현재 EMR만으로는 고찰에 사용할 근거가 확인되지 않았습니다.'
    };
  }

  if (sectionId === 'PATIENT_PERSPECTIVE') {
    return {
      sectionId,
      status: hasMeaningfulText(relevant, 8) ? 'INCOMPLETE' : 'IMPOSSIBLE',
      rationaleText:
        hasMeaningfulText(relevant, 8)
          ? '환자가 표현한 내용이 일부 있으나 환자 관점을 충분히 기술하려면 직접적인 표현이나 맥락이 더 필요합니다.'
          : '현재 EMR에는 환자가 직접 표현한 관점이 명확히 기록되어 있지 않습니다.'
    };
  }

  if (sectionId === 'TIMELINE') {
    return {
      sectionId,
      status: count >= 2 ? 'READY' : count === 1 ? 'INCOMPLETE' : 'IMPOSSIBLE',
      rationaleText:
        count >= 2
          ? '시점이 드러나는 근거가 여러 개 있어 타임라인 초안을 구성할 수 있습니다.'
          : count === 1
            ? '시점 관련 근거가 일부 있으나 경과 전체를 구성하기에는 부족합니다.'
            : '타임라인 초안에 사용할 시점 근거를 찾지 못했습니다.'
    };
  }

  if (sectionId === 'THERAPEUTIC_INTERVENTIONS' || sectionId === 'FOLLOW_UP_OUTCOMES') {
    return {
      sectionId,
      status: count >= 2 ? 'READY' : count === 1 ? 'INCOMPLETE' : 'IMPOSSIBLE',
      rationaleText:
        count >= 2
          ? '치료 또는 경과 근거가 충분하여 EMR만으로 초안을 작성할 수 있습니다.'
          : count === 1
            ? '관련 근거가 일부 있으나 치료 또는 결과에 대한 세부 내용이 제한적입니다.'
            : '이 섹션에 사용할 치료 또는 경과 근거가 확인되지 않았습니다.'
    };
  }

  return {
    sectionId,
    status: count >= 1 ? 'READY' : 'IMPOSSIBLE',
    rationaleText:
      count >= 1
        ? '이 섹션의 초안을 작성할 수 있는 근거가 있습니다.'
        : '이 섹션의 초안을 작성할 근거가 아직 충분하지 않습니다.'
  };
}

function shouldRefineAssessmentWithLLM(
  sectionId: CareSection,
  heuristic: SectionAssessment,
  evidenceCards: EvidenceCard[]
): boolean {
  const relevant = getEvidenceForSection(evidenceCards, sectionId);
  const count = relevant.length;

  if (count === 0) {
    return false;
  }

  if (sectionId === 'PATIENT_PERSPECTIVE' || sectionId === 'DISCUSSION_CONCLUSION') {
    return true;
  }

  return heuristic.status === 'INCOMPLETE';
}

function buildDraftSummary(sectionDrafts: Array<{ sectionId: string; draftText?: string }>): string {
  return sectionDrafts
    .map((draft) => `[${draft.sectionId}]\n${draft.draftText || '(empty)'}`)
    .join('\n\n');
}

function buildSectionMissingSummary(sectionMissing: SectionMissing[]): string {
  return sectionMissing
    .map((item) => `[${item.sectionId}]\n${item.missingItems.length ? item.missingItems.map((v) => `- ${v}`).join('\n') : '- (none)'}`)
    .join('\n\n');
}

function buildCommonMissingSummary(commonMissing: CommonMissingItem[]): string {
  if (!commonMissing.length) return '(none)';
  return commonMissing
    .map(
      (item) =>
        `- ${item.item} (relatedSectionIds: ${(item.relatedSectionIds || []).join(', ') || 'none'}${
          item.category ? `, category: ${item.category}` : ''
        })`
    )
    .join('\n');
}

export function normalizeOverlapKey(text: string): string {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'`~!@#$%^&*+=\\|/_\-\s]/g, '');
}

function tokenizeOverlapText(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[?.,:;()[\]{}"'`~!@#$%^&*+=\\|/_\-]/g, ' ')
    .replace(/가족/g, ' family ')
    .replace(/갈등/g, ' conflict ')
    .replace(/스트레스/g, ' stress ')
    .replace(/증상/g, ' symptom ')
    .replace(/변화/g, ' change ')
    .replace(/관련성|연결되었는지|연결/g, ' relation ')
    .replace(/요인/g, ' factor ')
    .replace(/설명해|알려줘|알려주세요|주세요|구체적으로|있다면|어떻게/g, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .filter((item) => !['the', 'and', 'factor'].includes(item));
}

function questionSemanticSimilarity(a: string, b: string): number {
  const normalizedA = normalizeQuestionComparisonKey(a) || normalizeOverlapKey(a);
  const normalizedB = normalizeQuestionComparisonKey(b) || normalizeOverlapKey(b);
  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;

  const tokensA = new Set(tokenizeOverlapText(a));
  const tokensB = new Set(tokenizeOverlapText(b));
  const overlap = Array.from(tokensA).filter((token) => tokensB.has(token)).length;
  const jaccard = overlap / Math.max(tokensA.size + tokensB.size - overlap, 1);
  const coverage = overlap / Math.max(Math.min(tokensA.size, tokensB.size), 1);
  const charScore = textSimilarity(a, b);
  return Math.max(jaccard, coverage, charScore);
}

function preferQuestionText(current: string, candidate: string): string {
  const currentNormalized = normalizeQuestionText(current);
  const candidateNormalized = normalizeQuestionText(candidate);
  if (!currentNormalized) return candidateNormalized;
  if (!candidateNormalized) return currentNormalized;
  const currentHasKorean = /[가-힣]/.test(currentNormalized);
  const candidateHasKorean = /[가-힣]/.test(candidateNormalized);
  if (!currentHasKorean && candidateHasKorean) return candidateNormalized;
  if (currentHasKorean && !candidateHasKorean) return currentNormalized;
  return candidateNormalized.length < currentNormalized.length ? candidateNormalized : currentNormalized;
}

export function sanitizeGeneratedQuestionSets(result: {
  commonQuestions: CommonQuestionSet[];
  sectionQuestions: SectionQuestionSet[];
}): { commonQuestions: CommonQuestionSet[]; sectionQuestions: SectionQuestionSet[] } {
  const commonQuestions: CommonQuestionSet[] = [];
  for (const item of result.commonQuestions || []) {
    const normalizedQuestion = normalizeQuestionText(item.question, item.category);
    if (!normalizedQuestion) continue;
    commonQuestions.push({
      ...item,
      question: normalizedQuestion,
      category: item.category || inferQuestionCategoryFromText(normalizedQuestion)
    });
  }

  return {
    commonQuestions,
    sectionQuestions: (result.sectionQuestions || []).map((entry) => ({
      ...entry,
      questions: uniqueStrings(
        (entry.questions || [])
          .map((question) =>
            normalizeQuestionText(question, inferQuestionCategoryFromText(question))
          )
          .filter(Boolean)
      )
    }))
  };
}

function hasExplicitPsychosocialSignal(text: string): boolean {
  const normalized = normalizeOverlapKey(text);
  return [
    '가족',
    '가정',
    '스트레스',
    '직장',
    '갈등',
    '생활사건',
    '심리사회',
    '대인관계'
  ].some((keyword) => normalized.includes(normalizeOverlapKey(keyword)));
}

function inferCommonMissingCategory(item: {
  item: string;
  relatedSectionIds: string[];
  category?: CommonMissingItem['category'];
}): NonNullable<CommonMissingItem['category']> {
  if (item.category) return item.category;

  const sections = new Set(item.relatedSectionIds || []);
  const normalized = normalizeOverlapKey(item.item);

  if (
    sections.has('TIMELINE') &&
    sections.has('FOLLOW_UP_OUTCOMES')
  ) {
    return normalized.includes(normalizeOverlapKey('추적')) ||
      normalized.includes(normalizeOverlapKey('재방문'))
      ? 'follow_up_outcome'
      : 'symptom_course';
  }

  if (sections.has('THERAPEUTIC_INTERVENTIONS') && sections.has('FOLLOW_UP_OUTCOMES')) {
    return 'treatment_response';
  }

  if (sections.has('PATIENT_PERSPECTIVE') && sections.has('DISCUSSION_CONCLUSION')) {
    return 'patient_perspective';
  }

  if (sections.has('DIAGNOSTIC_ASSESSMENT') && sections.has('DISCUSSION_CONCLUSION')) {
    return 'diagnostic_reasoning';
  }

  if (sections.has('PATIENT_INFORMATION') && sections.has('DISCUSSION_CONCLUSION')) {
    return hasExplicitPsychosocialSignal(item.item) ? 'psychosocial_context' : 'functional_impact';
  }

  if (normalized.includes(normalizeOverlapKey('수면')) || normalized.includes(normalizeOverlapKey('식사')) || normalized.includes(normalizeOverlapKey('일상'))) {
    return 'functional_impact';
  }
  if (normalized.includes(normalizeOverlapKey('호전')) || normalized.includes(normalizeOverlapKey('잔여')) || normalized.includes(normalizeOverlapKey('치료 후'))) {
    return 'treatment_response';
  }
  if (normalized.includes(normalizeOverlapKey('추적')) || normalized.includes(normalizeOverlapKey('재방문'))) {
    return 'follow_up_outcome';
  }
  if (normalized.includes(normalizeOverlapKey('진단')) || normalized.includes(normalizeOverlapKey('감별')) || normalized.includes(normalizeOverlapKey('배제'))) {
    return 'diagnostic_reasoning';
  }
  if (normalized.includes(normalizeOverlapKey('환자')) || normalized.includes(normalizeOverlapKey('소감')) || normalized.includes(normalizeOverlapKey('느낀'))) {
    return 'patient_perspective';
  }
  if (normalized.includes(normalizeOverlapKey('부작용')) || normalized.includes(normalizeOverlapKey('이상반응'))) {
    return 'adverse_event';
  }
  if (normalized.includes(normalizeOverlapKey('동의'))) {
    return 'consent';
  }

  return 'symptom_course';
}

function isEligibleCommonMissing(item: CommonMissingItem): boolean {
  const sections = uniqueSections(item.relatedSectionIds || []);
  if (sections.length < 2) return false;

  const category = inferCommonMissingCategory(item);
  if (category === 'psychosocial_context') {
    const relevantSections = sections.filter((sectionId) =>
      ['PATIENT_INFORMATION', 'DIAGNOSTIC_ASSESSMENT', 'DISCUSSION_CONCLUSION', 'PATIENT_PERSPECTIVE'].includes(sectionId)
    );
    return relevantSections.length >= 2 && hasExplicitPsychosocialSignal(item.item);
  }

  if (category === 'adverse_event' || category === 'consent') {
    return false;
  }

  return true;
}

export function mergeCommonMissingWithOverlaps(result: {
  sectionMissing: SectionMissing[];
  commonMissing: CommonMissingItem[];
}): { sectionMissing: SectionMissing[]; commonMissing: CommonMissingItem[] } {
  const existingCommon = new Map<string, CommonMissingItem>();

  for (const item of result.commonMissing || []) {
    const key = normalizeOverlapKey(item.item);
    if (!key) continue;
    const existing = existingCommon.get(key);
    if (existing) {
      existing.relatedSectionIds = uniqueSections([...(existing.relatedSectionIds || []), ...(item.relatedSectionIds || [])]);
      existing.category = existing.category || item.category || inferCommonMissingCategory(item);
    } else {
      existingCommon.set(key, {
        item: item.item,
        relatedSectionIds: uniqueSections(item.relatedSectionIds || []),
        category: item.category || inferCommonMissingCategory(item)
      });
    }
  }

  const overlapMap = new Map<string, { item: string; relatedSectionIds: string[] }>();
  for (const section of result.sectionMissing || []) {
    for (const missingItem of section.missingItems || []) {
      const key = normalizeOverlapKey(missingItem);
      if (!key) continue;
      const entry = overlapMap.get(key);
      if (entry) {
        entry.relatedSectionIds = uniqueSections([...entry.relatedSectionIds, section.sectionId]);
      } else {
        overlapMap.set(key, {
          item: missingItem,
          relatedSectionIds: [section.sectionId]
        });
      }
    }
  }

  for (const [key, entry] of overlapMap.entries()) {
    if ((entry.relatedSectionIds || []).length < 2) continue;
    const existing = existingCommon.get(key);
    if (existing) {
      existing.relatedSectionIds = uniqueSections([...(existing.relatedSectionIds || []), ...(entry.relatedSectionIds || [])]);
    } else {
      existingCommon.set(key, {
        item: entry.item,
        relatedSectionIds: uniqueSections(entry.relatedSectionIds || []),
        category: inferCommonMissingCategory(entry)
      });
    }
  }

  const promotedKeys = new Set(
    Array.from(existingCommon.entries())
      .filter(([, item]) => isEligibleCommonMissing(item))
      .map(([key]) => key)
  );

  const sectionMissing = (result.sectionMissing || []).map((section) => ({
    ...section,
    missingItems: uniqueStrings((section.missingItems || []).filter((item) => !promotedKeys.has(normalizeOverlapKey(item))))
  }));

  return {
    sectionMissing,
    commonMissing: Array.from(existingCommon.values()).filter((item) => isEligibleCommonMissing(item))
  };
}

export function mergeCommonQuestionsWithOverlaps(result: {
  commonQuestions: CommonQuestionSet[];
  sectionQuestions: SectionQuestionSet[];
}): { commonQuestions: CommonQuestionSet[]; sectionQuestions: SectionQuestionSet[] } {
  const commonByKey = new Map<string, CommonQuestionSet>();

  function findParaphraseKey(question: string): string | null {
    const normalized = normalizeQuestionComparisonKey(question) || normalizeOverlapKey(question);
    if (!normalized) return null;

    for (const existingKey of commonByKey.keys()) {
      const existingQuestion = commonByKey.get(existingKey)?.question || '';
      if (questionSemanticSimilarity(question, existingQuestion) >= 0.72) {
        return existingKey;
      }
    }

    return normalized;
  }

  for (const item of result.commonQuestions || []) {
    const normalizedQuestion = normalizeQuestionText(item.question, item.category);
    const key = findParaphraseKey(normalizedQuestion);
    if (!key) continue;
    const existing = commonByKey.get(key);
    if (existing) {
      existing.targetSectionIds = uniqueSections([...(existing.targetSectionIds || []), ...(item.targetSectionIds || [])]);
      existing.category = existing.category || item.category;
      existing.question = preferQuestionText(existing.question, normalizedQuestion);
    } else {
      commonByKey.set(key, {
        question: normalizedQuestion,
        targetSectionIds: uniqueSections(item.targetSectionIds || []),
        category: item.category || inferQuestionCategoryFromText(normalizedQuestion)
      });
    }
  }

  const overlapByKey = new Map<string, { question: string; targetSectionIds: string[] }>();
  for (const section of result.sectionQuestions || []) {
    for (const question of section.questions || []) {
      const normalizedQuestion = normalizeQuestionText(question, inferQuestionCategoryFromText(question));
      const key = normalizeQuestionComparisonKey(normalizedQuestion) || normalizeOverlapKey(normalizedQuestion);
      if (!key) continue;
      const entry = overlapByKey.get(key);
      if (entry) {
        entry.targetSectionIds = uniqueSections([...entry.targetSectionIds, section.sectionId]);
      } else {
        overlapByKey.set(key, {
          question: normalizedQuestion,
          targetSectionIds: [section.sectionId]
        });
      }
    }
  }

  for (const [key, entry] of overlapByKey.entries()) {
    if ((entry.targetSectionIds || []).length < 2) continue;
    const existing = commonByKey.get(key);
    if (existing) {
      existing.targetSectionIds = uniqueSections([...(existing.targetSectionIds || []), ...(entry.targetSectionIds || [])]);
    } else {
      commonByKey.set(key, {
        question: entry.question,
        targetSectionIds: uniqueSections(entry.targetSectionIds || [])
      });
    }
  }

  const promotedKeys = new Set(
    Array.from(commonByKey.entries())
      .filter(([, item]) => (item.targetSectionIds || []).length >= 2)
      .map(([key]) => key)
  );

  const sectionQuestions = (result.sectionQuestions || []).map((section) => ({
    ...section,
    questions: uniqueStrings(
      (section.questions || [])
        .map((item) => normalizeQuestionText(item, inferQuestionCategoryFromText(item)))
        .filter((item) => item && !promotedKeys.has(normalizeQuestionComparisonKey(item)))
    )
  }));

  return {
    commonQuestions: Array.from(commonByKey.values())
      .filter((item) => (item.targetSectionIds || []).length >= 2)
      .slice(0, 3),
    sectionQuestions
  };
}

export function synthesizeCommonQuestionsFromMissing(commonMissing: CommonMissingItem[]): CommonQuestionSet[] {
  return (commonMissing || [])
    .filter((item) => isEligibleCommonMissing(item))
    .map((item) => {
      const category = inferCommonMissingCategory(item);
      return {
        question:
          COMMON_QUESTION_FALLBACK_TEMPLATES[category] ||
          '관련 변화와 배경을 구체적으로 설명해 주세요.',
        targetSectionIds: uniqueSections(item.relatedSectionIds || []),
        category
      };
    })
    .slice(0, 3);
}

function buildCompactRubricSummary(sectionIds: string[]): string {
  return buildCareRubricSummary(sectionIds);
}

function buildRubricSummaryForDrafts(sectionDrafts: Array<{ sectionId: string }>): string {
  const ids = sectionDrafts
    .map((draft) => draft.sectionId)
    .filter((sectionId): sectionId is SupportedCareSectionId => sectionId in careSectionRubricMap);
  return buildCareRubricSummary(ids);
}

function buildQnaSummary(qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>>): string {
  const sections = Object.entries(qnaHistoryBySection || {});
  if (sections.length === 0) return '(none)';

  return sections
    .map(([sectionId, history]) => {
      const items =
        history.length > 0
          ? history.map((item) => `- Q: ${item.question}\n  A: ${item.answer}`).join('\n')
          : '- (none)';
      return `[${sectionId}]\n${items}`;
    })
    .join('\n\n');
}

function normalizeSectionDrafts(
  sectionDrafts: Array<{
    sectionId: SectionDraft['sectionId'];
    evidenceCardIdsUsed: string[];
    timelineEventIdsUsed?: string[];
    draftText: string;
    openIssues: string[];
    evidenceLinks?: Array<{ sentence: string; evidenceCardIds: string[] }>;
    unsupportedClaims?: Array<{ sentence: string; reason: string }>;
  }>,
  evidenceCards: EvidenceCard[]
): SectionDraft[] {
  const validIds = new Set(evidenceCards.map((card) => card.id));
  return sectionDrafts.map((draft) => ({
    ...draft,
    evidenceCardIdsUsed: uniqueStrings((draft.evidenceCardIdsUsed || []).filter((id) => validIds.has(id))),
    timelineEventIdsUsed: draft.timelineEventIdsUsed || [],
    ...buildDraftTraceability({
      draftText: draft.draftText || '',
      evidenceCards,
      preferredEvidenceIds: uniqueStrings((draft.evidenceCardIdsUsed || []).filter((id) => validIds.has(id)))
    })
  }));
}

function isGroundedInVisitText(snippet: string, visitText: string): boolean {
  const normalizedSnippet = normalizeForGrounding(snippet);
  const normalizedVisit = normalizeForGrounding(visitText);
  if (!normalizedSnippet || !normalizedVisit) return false;
  if (normalizedVisit.includes(normalizedSnippet)) return true;
  return textSimilarity(snippet, visitText) >= 0.45;
}

export async function runEvidenceSplit(
  preparedVisits: PreparedVisit[],
  runtimeMeta?: ChainRuntimeMeta
): Promise<EvidenceCard[]> {
  const deidentifiedVisits: DeidentifiedVisitInput[] = preparedVisits.map((visit) => ({
    index: visit.index,
    date: visit.date,
    text: visit.text,
    riskLevel: 'LOW'
  }));
  const structuredVisitsText = buildNarrativeVisitPromptText(preparedVisits);

  const result = await callLLMWithSchema(
    Chain1OutputSchema,
    chain1SystemPrompt,
    buildChain1UserPrompt(structuredVisitsText),
    {
      model: getModelForChain('chain1'),
      label: 'CHAIN1 extraction',
      onUsage: runtimeMeta?.onUsage
    }
  );

  const normalizedCards: EvidenceCard[] = [];

  for (const card of result.evidenceCards || []) {
    const visitIndex = card.visitIndex || 1;
    const visit = preparedVisits.find((item) => item.index === visitIndex);
    const baseText = (card.sourceText || card.normalizedText || '').trim();
    const matchedClause = findBestClauseMatch(baseText, visit);
    const sourceText = matchedClause?.sourceText || card.sourceText || card.normalizedText || '';
    const localNormalization = await normalizeTextWithTerms(sourceText);
    const terms = localNormalization.terms.length > 0 ? localNormalization.terms : matchedClause?.terms || [];
    const typeSection = EVIDENCE_TYPE_SECTION[String(card.evidenceType || '').toLowerCase()];
    const modelTags = uniqueSections([...(typeSection ? [typeSection] : []), ...(card.tags || [])]);
    const sectionHints = uniqueSections([
      ...modelTags,
      ...(card.sectionHints || []),
      ...(matchedClause?.sectionHints || []),
      ...buildSectionHintsFromTerms(terms)
    ]);
    const normalizedText =
      localNormalization.normalizedText && localNormalization.normalizedText !== sourceText
        ? localNormalization.normalizedText
        : matchedClause?.normalizedText || card.normalizedText || sourceText;

    const groundedVisit = deidentifiedVisits.find((item) => item.index === visitIndex);
    if (!groundedVisit || !sourceText.trim() || !isGroundedInVisitText(sourceText, groundedVisit.text || '')) {
      continue;
    }

    normalizedCards.push({
      id: UUID_PATTERN.test(card.id || '') ? card.id : randomUUID(),
      visitIndex,
      visitDateTime: card.visitDateTime || groundedVisit.date || '',
      sourceText,
      normalizedText,
      evidenceType: card.evidenceType && card.evidenceType !== 'other'
        ? card.evidenceType
        : inferEvidenceType(sectionHints),
      tags: modelTags.length > 0 ? modelTags : sectionHints,
      sectionHints,
      terms,
      sourceRef: card.sourceRef,
      confidence: clampConfidence(card.confidence)
    });
  }

  return repairSplitClinicalEvidenceCards(normalizedCards, preparedVisits).cards as EvidenceCard[];
}

export async function runSectionAssessment(
  evidenceCards: EvidenceCard[],
  runtimeMeta?: ChainRuntimeMeta
): Promise<SectionAssessment[]> {
  const heuristicAssessments = (CareSectionEnum.options as CareSection[]).map((sectionId) =>
    buildHeuristicAssessment(sectionId, evidenceCards)
  );

  const llmTargetSectionIds = heuristicAssessments
    .filter((item) => shouldRefineAssessmentWithLLM(item.sectionId, item, evidenceCards))
    .map((item) => item.sectionId);

  if (llmTargetSectionIds.length === 0) {
    runtimeMeta?.onUsage?.(null);
    return heuristicAssessments;
  }

  const result = await callLLMWithSchema(
    Chain2OutputSchema,
    chain2SystemPrompt,
    buildChain2UserPrompt({
      evidenceSummary: buildSectionAssessmentSummary(evidenceCards, llmTargetSectionIds),
      targetSectionIds: llmTargetSectionIds
    }),
    {
      model: getModelForChain('chain2'),
      label: 'CHAIN2 assessment',
      onUsage: runtimeMeta?.onUsage
    }
  );

  const llmBySection = new Map((result.sectionAssessments || []).map((item) => [item.sectionId, item]));

  return heuristicAssessments.map((item) => llmBySection.get(item.sectionId) || item);
}

export async function runInitialSectionDrafts(
  evidenceCards: EvidenceCard[],
  sectionAssessments: SectionAssessment[],
  runtimeMeta?: ChainRuntimeMeta
): Promise<SectionDraft[]> {
  const statusSummary = (sectionAssessments || [])
    .map((item) => `[${item.sectionId}] status=${item.status}\nrationale=${item.rationaleText}`)
    .join('\n\n');

  const result = await callLLMWithSchema(
    Chain3OutputSchema,
    chain3SystemPrompt,
    buildChain3UserPrompt(
      buildTaggedEvidenceSummary(evidenceCards),
      statusSummary,
      buildCompactRubricSummary(CORE_AI_SECTIONS)
    ),
    {
      model: getModelForChain('chain3'),
      label: 'CHAIN3 draft',
      onUsage: runtimeMeta?.onUsage
    }
  );

  return normalizeSectionDrafts(result.sectionDrafts || [], evidenceCards);
}

export async function runSectionMissingDetection(params: {
  sectionDrafts: SectionDraft[];
  evidenceCards: EvidenceCard[];
  caseTitle?: string;
},
runtimeMeta?: ChainRuntimeMeta): Promise<{ sectionMissing: SectionMissing[]; commonMissing: CommonMissingItem[] }> {
  const result = await callLLMWithSchema(
    Chain4MissingOutputSchema,
    chain4MissingSystemPrompt,
    buildChain4MissingUserPrompt({
      caseTitle: params.caseTitle,
      draftSummary: buildDraftSummary(params.sectionDrafts),
      evidenceSummary: buildTaggedEvidenceSummary(params.evidenceCards),
      rubricSummary: buildRubricSummaryForDrafts(params.sectionDrafts)
    }),
    {
      model: getModelForChain('chain4'),
      label: 'CHAIN4 missing',
      onUsage: runtimeMeta?.onUsage
    }
  );

  return mergeCommonMissingWithOverlaps({
    sectionMissing: result.sectionMissing || [],
    commonMissing: result.commonMissing || []
  });
}

export async function runQuestionGeneration(params: {
  sectionDrafts: SectionDraft[];
  sectionMissing: SectionMissing[];
  commonMissing: CommonMissingItem[];
  caseTitle?: string;
},
runtimeMeta?: ChainRuntimeMeta): Promise<{ commonQuestions: CommonQuestionSet[]; sectionQuestions: SectionQuestionSet[] }> {
  const result = await callLLMWithSchema(
    Chain5QuestionOutputSchema,
    chain5QuestionSystemPrompt,
    buildChain5QuestionUserPrompt({
      caseTitle: params.caseTitle,
      draftSummary: buildDraftSummary(params.sectionDrafts),
      sectionMissingSummary: buildSectionMissingSummary(params.sectionMissing),
      commonMissingSummary: buildCommonMissingSummary(params.commonMissing),
      rubricSummary: buildRubricSummaryForDrafts(params.sectionDrafts)
    }),
    {
      model: getModelForChain('chain5'),
      label: 'CHAIN5 questions',
      onUsage: runtimeMeta?.onUsage
    }
  );

  const sanitized = sanitizeGeneratedQuestionSets({
    commonQuestions: result.commonQuestions || [],
    sectionQuestions: result.sectionQuestions || []
  });
  const merged = mergeCommonQuestionsWithOverlaps({
    commonQuestions: sanitized.commonQuestions,
    sectionQuestions: sanitized.sectionQuestions
  });
  // The template fallback only fills categories the model left uncovered;
  // otherwise it re-asks the same thing in different words.
  const coveredCategories = new Set(merged.commonQuestions.map((item) => item.category).filter(Boolean));
  const fallbackCommonQuestions = synthesizeCommonQuestionsFromMissing(params.commonMissing).filter(
    (item) => !coveredCategories.has(item.category)
  );
  const finalCommonQuestions = mergeCommonQuestionsWithOverlaps({
    commonQuestions: [...merged.commonQuestions, ...fallbackCommonQuestions],
    sectionQuestions: merged.sectionQuestions
  });

  return finalCommonQuestions;
}

export async function runSectionDraftUpdate(params: {
  sectionId: string;
  currentDraft: string;
  evidenceCards: EvidenceCard[];
  qnaHistory: Array<{ question: string; answer: string }>;
  pendingItems: string[];
  question: string;
  answer: string;
},
runtimeMeta?: ChainRuntimeMeta): Promise<Chain6SectionUpdateOutput> {
  const evidenceText =
    params.evidenceCards.length > 0
      ? params.evidenceCards
          .map((card) => `- ${card.normalizedText || card.sourceText || ''}`)
          .join('\n')
      : '(none)';

  const qnaHistoryText =
    params.qnaHistory.length > 0
      ? params.qnaHistory.map((item) => `- Q: ${item.question}\n  A: ${item.answer}`).join('\n')
      : '(none)';

  const result = await callLLMWithSchema(
    Chain6SectionUpdateOutputSchema,
    chain6UpdateSystemPrompt,
    buildChain6UpdateUserPrompt({
      sectionId: params.sectionId,
      currentDraft: params.currentDraft,
      evidenceText,
      qnaHistoryText,
      pendingItems: params.pendingItems,
      question: params.question,
      answer: params.answer
    }),
    {
      model: getModelForChain('chain6'),
      label: 'CHAIN6 update',
      onUsage: runtimeMeta?.onUsage
    }
  );

  const traceability = buildDraftTraceability({
    draftText: result.updatedDraftText || params.currentDraft || '',
    evidenceCards: params.evidenceCards,
    // User answers are legitimate support for an updated draft.
    supplementalTexts: [params.answer, ...params.qnaHistory.map((item) => item.answer)]
  });

  return {
    ...result,
    evidenceLinks: traceability.evidenceLinks,
    unsupportedClaims: traceability.unsupportedClaims
  };
}

export async function runSectionAdequacyReview(params: {
  sectionId: string;
  currentDraft: string;
  evidenceCards: EvidenceCard[];
  qnaHistory: Array<{ question: string; answer: string }>;
},
runtimeMeta?: ChainRuntimeMeta): Promise<SectionAdequacyReviewOutput> {
  const evidenceSummary =
    params.evidenceCards.length > 0
      ? params.evidenceCards
          .map((card) => `- ${card.normalizedText || card.sourceText || ''}`)
          .join('\n')
      : '(none)';
  const qnaSummary =
    params.qnaHistory.length > 0
      ? params.qnaHistory.map((item) => `- Q: ${item.question}\n  A: ${item.answer}`).join('\n')
      : '(none)';

  return callLLMWithSchema<SectionAdequacyReviewOutput>(
    SectionAdequacyReviewOutputSchema as any,
    sectionAdequacyReviewSystemPrompt,
    buildSectionAdequacyReviewUserPrompt({
      sectionId: params.sectionId,
      currentDraft: params.currentDraft,
      evidenceSummary,
      qnaSummary,
      rubricSummary: buildCareRubricSummary([params.sectionId])
    }),
    {
      model: getModelForChain('review'),
      label: 'SECTION review',
      onUsage: runtimeMeta?.onUsage
    }
  );
}

export async function runFinalManuscriptCompose(params: {
  sectionDrafts: SectionDraft[];
  evidenceCards: EvidenceCard[];
  qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>>;
  contributionAnswers?: Array<{ question: string; answer: string }>;
},
runtimeMeta?: ChainRuntimeMeta): Promise<FinalDraft> {
  const contributionAnswersText =
    params.contributionAnswers && params.contributionAnswers.length > 0
      ? params.contributionAnswers.map((item) => `- ${item.question}: ${item.answer}`).join('\n')
      : '(none)';

  const result = await callLLMWithSchema(
    FinalDraftSchema,
    chain7SystemPrompt,
    buildChain7UserPrompt({
      sectionDraftSummary: buildDraftSummary(params.sectionDrafts),
      evidenceSummary: buildTaggedEvidenceSummary(params.evidenceCards),
      qnaSummary: buildQnaSummary(params.qnaHistoryBySection),
      contributionAnswersText,
      rubricSummary: buildCareRubricSummary()
    }),
    {
      model: getModelForChain('chain7'),
      label: 'CHAIN7 final',
      onUsage: runtimeMeta?.onUsage
    }
  );

  const sectionTraceability = params.sectionDrafts.reduce<Record<string, { evidenceLinks: any[]; unsupportedClaims: any[] }>>(
    (acc, draft) => {
      acc[draft.sectionId] = {
        evidenceLinks: draft.evidenceLinks || [],
        unsupportedClaims: draft.unsupportedClaims || []
      };
      return acc;
    },
    {}
  );

  const keywordSuggestions = uniqueStrings(
    (result.keywordSuggestions || []).map((item) => String(item || '').trim())
  );
  const normalizedKeywordLine =
    String(result.fullTextBySection.KEYWORDS || '').trim() ||
    keywordSuggestions.join(', ');

  // The model sometimes skips sections it left empty; an empty section is
  // MISSING by definition, so that much can be filled in without guessing.
  const careChecklistEvaluation = { ...result.careChecklistEvaluation };
  for (const sectionId of CareSectionEnum.options as CareSection[]) {
    if (careChecklistEvaluation[sectionId]) continue;
    if (String(result.fullTextBySection[sectionId] || '').trim()) continue;
    careChecklistEvaluation[sectionId] = {
      status: 'MISSING',
      rationale: '해당 섹션 본문이 작성되지 않았습니다.'
    };
  }

  return {
    ...result,
    careChecklistEvaluation,
    fullTextBySection: {
      ...result.fullTextBySection,
      KEYWORDS: normalizedKeywordLine
    },
    keywordSuggestions:
      keywordSuggestions.length > 0
        ? keywordSuggestions
        : uniqueStrings(normalizedKeywordLine.split(',').map((item) => item.trim())),
    sectionTraceability
  };
}

export const runChain1_splitEvidence = runEvidenceSplit;
export const runChain2_assess = runSectionAssessment;
export const runChain3_initialDrafts = runInitialSectionDrafts;
export const runChain4_detectMissing = runSectionMissingDetection;
export const runChain5_generateQuestions = runQuestionGeneration;
export const runChain6_updateDraft = runSectionDraftUpdate;
export const runChain7_finalCompose = runFinalManuscriptCompose;
export const runLegacySectionDraftUpdate = runSectionDraftUpdate;
export const runFastSectionDraftUpdate = runSectionDraftUpdate;
export const runFinalDraftCompose = runFinalManuscriptCompose;
export const runChain5_finalCompose = runFinalManuscriptCompose;
