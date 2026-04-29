import { callLLMWithSchema } from './client';
import { randomUUID } from 'crypto';
import { buildCareRubricSummary, careSectionRubricMap, SupportedCareSectionId } from '../config/careSectionRubric';
import { Chain1OutputSchema, EvidenceCard } from './schemas/chain1_splitTag';
import { Chain2OutputSchema, SectionAssessment } from './schemas/chain2_assess';
import { Chain3OutputSchema, SectionDraft } from './schemas/chain3_draft';
import { Chain4MissingOutputSchema, SectionMissing, CommonMissingItem } from './schemas/chain4_missing';
import { Chain5QuestionOutputSchema, SectionQuestionSet, CommonQuestionSet } from './schemas/chain5_questions';
import { Chain6SectionUpdateOutputSchema, Chain6SectionUpdateOutput } from './schemas/chain6_update';
import { FinalDraftSchema, FinalDraft } from './schemas/chain5_final';
import {
  SectionAdequacyReviewOutputSchema,
  SectionAdequacyReviewOutput
} from './schemas/section_adequacy_review';
import { chain1SystemPrompt, buildChain1UserPrompt } from './prompts/chain1_splitTag';
import { chain2SystemPrompt, buildChain2UserPrompt } from './prompts/chain2_assess';
import { chain3SystemPrompt, buildChain3UserPrompt } from './prompts/chain3_draft';
import { chain4MissingSystemPrompt, buildChain4MissingUserPrompt } from './prompts/chain4_missing';
import { chain5QuestionSystemPrompt, buildChain5QuestionUserPrompt } from './prompts/chain5_questions';
import { chain6UpdateSystemPrompt, buildChain6UpdateUserPrompt } from './prompts/chain6_update';
import { chain7SystemPrompt, buildChain7UserPrompt } from './prompts/chain7_final';
import {
  sectionAdequacyReviewSystemPrompt,
  buildSectionAdequacyReviewUserPrompt
} from './prompts/section_adequacy_review';

const CORE_AI_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
] as const;

const FAST_LLM_MODEL = process.env.FAST_LLM_MODEL || 'gpt-4.1-mini';
const QUALITY_LLM_MODEL = process.env.QUALITY_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4.1';

function getModelForChain(
  chainKey:
    | 'CHAIN1'
    | 'CHAIN2'
    | 'CHAIN3'
    | 'CHAIN4'
    | 'CHAIN5'
    | 'CHAIN6'
    | 'CHAIN7'
): string {
  const explicitOverride = process.env[`${chainKey}_MODEL`];
  if (explicitOverride) {
    return explicitOverride;
  }

  switch (chainKey) {
    case 'CHAIN1':
    case 'CHAIN2':
    case 'CHAIN4':
    case 'CHAIN5':
      return FAST_LLM_MODEL;
    case 'CHAIN3':
    case 'CHAIN6':
    case 'CHAIN7':
    default:
      return QUALITY_LLM_MODEL;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SectionState = {
  sectionId: SectionAssessment['sectionId'];
  status: SectionAssessment['status'];
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
};

function buildTaggedEvidenceSummary(evidenceCards: EvidenceCard[]): string {
  return Object.entries(
    evidenceCards.reduce<Record<string, string[]>>((acc, card) => {
      card.tags.forEach((tag) => {
        acc[tag] = acc[tag] || [];
        acc[tag].push(`[#${card.id}] ${card.normalizedText}`);
      });
      return acc;
    }, {})
  )
    .map(([section, texts]) => `[${section}]\n${texts.join('\n')}`)
    .join('\n\n---\n\n');
}

function buildDraftSummary(sectionDrafts: SectionDraft[]): string {
  return sectionDrafts
    .map((draft) => `[${draft.sectionId}]\n${draft.draftText || '(empty)'}`)
    .join('\n\n---\n\n');
}

function buildSectionMissingSummary(sectionMissing: SectionMissing[]): string {
  return sectionMissing
    .map((entry) => `[${entry.sectionId}]\n${entry.missingItems.map((item) => `- ${item}`).join('\n') || '- (none)'}`)
    .join('\n\n---\n\n');
}

function buildCommonMissingSummary(commonMissing: CommonMissingItem[]): string {
  return commonMissing
    .map(
      (entry) =>
        `[${entry.relatedSectionIds.join(', ')}]\n- ${entry.item}`
    )
    .join('\n\n---\n\n');
}

function buildSectionAssessmentSummary(evidenceCards: EvidenceCard[]): string {
  const grouped = evidenceCards.reduce<Record<string, string[]>>((acc, card) => {
    card.tags.forEach((tag) => {
      acc[tag] = acc[tag] || [];
      acc[tag].push(`[#${card.id}] ${card.normalizedText}`);
    });
    return acc;
  }, {});

  return CORE_AI_SECTIONS.map((sectionId) => {
    const texts = grouped[sectionId] || [];
    return `[${sectionId}]\ncount=${texts.length}\n${texts.join('\n') || '(no evidence)'}`;
  }).join('\n\n---\n\n');
}

function buildRubricSummaryForDrafts(sectionDrafts: SectionDraft[]): string {
  return buildCareRubricSummary(sectionDrafts.map((draft) => draft.sectionId));
}

function buildCompactRubricSummary(sectionIds: string[]): string {
  const uniqueSectionIds = Array.from(new Set(sectionIds)).filter(
    (sectionId): sectionId is SupportedCareSectionId => sectionId in careSectionRubricMap
  );

  return uniqueSectionIds
    .map((sectionId) => {
      const rubric = careSectionRubricMap[sectionId];
      return `[${sectionId}] required: ${rubric.requiredItems.join(' / ')}`;
    })
    .join('\n');
}

function extractSoapBlocks(text: string): Record<'S' | 'O' | 'A' | 'P', string> {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: Record<'S' | 'O' | 'A' | 'P', string[]> = { S: [], O: [], A: [], P: [] };
  let current: 'S' | 'O' | 'A' | 'P' | null = null;

  const markerPattern = /^\s*([SOAP])\s*[:：]\s*(.*)$/i;

  for (const line of lines) {
    const match = line.match(markerPattern);
    if (match) {
      current = match[1].toUpperCase() as 'S' | 'O' | 'A' | 'P';
      if (match[2]?.trim()) {
        blocks[current].push(match[2].trim());
      }
      continue;
    }

    if (current) {
      blocks[current].push(line.trim());
    }
  }

  return {
    S: blocks.S.join(' ').trim(),
    O: blocks.O.join(' ').trim(),
    A: blocks.A.join(' ').trim(),
    P: blocks.P.join(' ').trim()
  };
}

function splitIntoClauses(text: string): string[] {
  return String(text || '')
    .split(/(?<=[.!?])\s+|(?<=다\.)\s+|[;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function buildStructuredVisitsText(visits: Array<{ index: number; date: string; text: string }>): string {
  return visits
    .map((visit) => {
      const soap = extractSoapBlocks(visit.text);
      const hasSoapMarkers = Boolean(soap.S || soap.O || soap.A || soap.P);
      const clauses = [
        ...splitIntoClauses(soap.S).map((item) => `[S] ${item}`),
        ...splitIntoClauses(soap.O).map((item) => `[O] ${item}`),
        ...splitIntoClauses(soap.A).map((item) => `[A] ${item}`),
        ...splitIntoClauses(soap.P).map((item) => `[P] ${item}`)
      ];

      if (!hasSoapMarkers) {
        return [
          `Visit ${visit.index}`,
          `DateTime: ${visit.date || '(unknown)'}`,
          '[Source Text]',
          visit.text
        ].join('\n');
      }

      return [
        `Visit ${visit.index}`,
        `DateTime: ${visit.date || '(unknown)'}`,
        '[Structured SOAP]',
        soap.S ? `S: ${soap.S}` : '',
        soap.O ? `O: ${soap.O}` : '',
        soap.A ? `A: ${soap.A}` : '',
        soap.P ? `P: ${soap.P}` : '',
        clauses.length ? '[Atomic hints]' : '',
        clauses.length ? clauses.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : ''
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}

function truncateClause(text: string, maxLength = 140): string {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function scoreNarrativeClause(clause: string): number {
  const text = String(clause || '').toLowerCase();
  let score = 0;

  if (/\d/.test(text)) score += 1;
  if (/(환자|주소|호소|증상|통증|답답|상열|불면|식욕|불안|스트레스)/.test(text)) score += 3;
  if (/(진찰|검사|혈압|맥박|설진|맥진|영상|혈액|소견)/.test(text)) score += 3;
  if (/(평가|고려|진단|변증|감별|가능성)/.test(text)) score += 3;
  if (/(치료|처방|침치료|한약|혈위|교육|복용|시행|유지)/.test(text)) score += 3;
  if (/(호전|감소|증가|악화|개선|추적|재내원|이상반응|부작용|순응도)/.test(text)) score += 3;
  if (/(개월|주|일|후|최근|초기|마지막)/.test(text)) score += 2;

  return score;
}

function buildNarrativeVisitPromptText(visits: Array<{ index: number; date: string; text: string }>): string {
  return visits
    .map((visit) => {
      const clauses = splitIntoClauses(visit.text)
        .map((clause, index) => ({
          index,
          text: clause,
          normalized: normalizeForGrounding(clause),
          score: scoreNarrativeClause(clause)
        }))
        .filter((item) => item.normalized.length >= 4);

      const uniqueClauses = clauses.filter(
        (item, index, array) => array.findIndex((candidate) => candidate.normalized === item.normalized) === index
      );

      const topScoredClauses = uniqueClauses
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, 14);

      const leadingClauses = uniqueClauses.slice(0, 4);
      const trailingClauses = uniqueClauses.slice(Math.max(uniqueClauses.length - 3, 0));

      const selectedClauses = Array.from(
        new Map(
          [...leadingClauses, ...topScoredClauses, ...trailingClauses]
            .sort((a, b) => a.index - b.index)
            .map((item) => [item.normalized, truncateClause(item.text)])
        ).values()
      ).slice(0, 18);

      const fallback =
        selectedClauses.length > 0
          ? selectedClauses
          : [truncateClause(String(visit.text || '').replace(/\s+/g, ' ').trim(), 300)].filter(Boolean);

      return [
        `Visit ${visit.index}`,
        `DateTime: ${visit.date || '(unknown)'}`,
        '[Narrative Visit Summary]',
        fallback.map((item, idx) => `${idx + 1}. ${item}`).join('\n')
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}

function normalizeForGrounding(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\.,:;'"!?()[\]{}\-_/\\]/g, '');
}

function isGroundedInVisitText(snippet: string, visitText: string): boolean {
  const normalizedSnippet = normalizeForGrounding(snippet);
  const normalizedVisitText = normalizeForGrounding(visitText);

  if (!normalizedSnippet || normalizedSnippet.length < 4) {
    return false;
  }

  return normalizedVisitText.includes(normalizedSnippet);
}

function normalizeEvidenceCards(
  evidenceCards: EvidenceCard[],
  visits: Array<{ index: number; date: string; text: string }>
): EvidenceCard[] {
  const seenIds = new Set<string>();

  return (evidenceCards || []).map((card, index) => {
    let normalizedId = UUID_PATTERN.test(String(card.id || '')) ? String(card.id) : randomUUID();
    while (seenIds.has(normalizedId)) {
      normalizedId = randomUUID();
    }
    seenIds.add(normalizedId);

    return {
      ...card,
      id: normalizedId,
      visitIndex: Number.isInteger(card.visitIndex) && card.visitIndex > 0 ? card.visitIndex : index + 1,
      confidence:
        typeof card.confidence === 'number'
          ? Math.max(0, Math.min(1, card.confidence))
          : 0.8
    };
  }).filter((card) => {
    const visit = visits.find((item) => item.index === card.visitIndex) || visits[0];
    return visit ? isGroundedInVisitText(card.normalizedText, visit.text) : false;
  });
}

function normalizeSectionDrafts(sectionDrafts: SectionDraft[], evidenceCards: EvidenceCard[]): SectionDraft[] {
  const validEvidenceIds = new Set(evidenceCards.map((card) => card.id));

  return (sectionDrafts || []).map((draft) => {
    const normalizedEvidenceIds = Array.from(
      new Set((draft.evidenceCardIdsUsed || []).filter((id) => validEvidenceIds.has(id)))
    );

    return {
      ...draft,
      evidenceCardIdsUsed: normalizedEvidenceIds,
      openIssues: draft.openIssues || []
    };
  });
}

export async function runEvidenceSplit(visits: Array<{ index: number; date: string; text: string }>): Promise<EvidenceCard[]> {
  const visitsText = buildNarrativeVisitPromptText(visits);

  const output = await callLLMWithSchema(
    Chain1OutputSchema,
    chain1SystemPrompt,
    buildChain1UserPrompt(visitsText),
    { model: getModelForChain('CHAIN1'), label: 'CHAIN1 extraction' }
  );

  return normalizeEvidenceCards(output.evidenceCards ?? [], visits);
}

export async function runSectionAssessment(evidenceCards: EvidenceCard[]): Promise<SectionState[]> {
  const output = await callLLMWithSchema(
    Chain2OutputSchema,
    chain2SystemPrompt,
    buildChain2UserPrompt(buildSectionAssessmentSummary(evidenceCards)),
    { model: getModelForChain('CHAIN2'), label: 'CHAIN2 assessment' }
  );

  return (output.sectionAssessments ?? []).map((assessment: SectionAssessment) => ({
    sectionId: assessment.sectionId,
    status: assessment.status,
    rationaleText: assessment.rationaleText,
    missingInfoBullets: [],
    recommendedQuestions: []
  }));
}

export async function runInitialSectionDrafts(
  evidenceCards: EvidenceCard[],
  sectionStates: SectionState[]
): Promise<SectionDraft[]> {
  const statusSummary = sectionStates
    .map((state) => `${state.sectionId}: ${state.status}`)
    .join('\n');
  const compactRubricSummary = buildCompactRubricSummary(sectionStates.map((state) => state.sectionId));

  const output = await callLLMWithSchema(
    Chain3OutputSchema,
    chain3SystemPrompt,
    buildChain3UserPrompt(
      buildTaggedEvidenceSummary(evidenceCards),
      statusSummary,
      compactRubricSummary
    ),
    { model: getModelForChain('CHAIN3'), label: 'CHAIN3 draft' }
  );

  return normalizeSectionDrafts(output.sectionDrafts ?? [], evidenceCards);
}

export async function runSectionMissingDetection(params: {
  sectionDrafts: SectionDraft[];
  evidenceCards: EvidenceCard[];
  caseTitle?: string;
}): Promise<{ sectionMissing: SectionMissing[]; commonMissing: CommonMissingItem[] }> {
  const output = await callLLMWithSchema(
    Chain4MissingOutputSchema,
    chain4MissingSystemPrompt,
    buildChain4MissingUserPrompt({
      caseTitle: params.caseTitle,
      draftSummary: buildDraftSummary(params.sectionDrafts),
      evidenceSummary: buildTaggedEvidenceSummary(params.evidenceCards),
      rubricSummary: buildRubricSummaryForDrafts(params.sectionDrafts)
    }),
    { model: getModelForChain('CHAIN4'), label: 'CHAIN4 missing' }
  );

  return {
    sectionMissing: output.sectionMissing ?? [],
    commonMissing: output.commonMissing ?? []
  };
}

export async function runQuestionGeneration(params: {
  sectionDrafts: SectionDraft[];
  sectionMissing: SectionMissing[];
  commonMissing: CommonMissingItem[];
  caseTitle?: string;
}): Promise<{ commonQuestions: CommonQuestionSet[]; sectionQuestions: SectionQuestionSet[] }> {
  const output = await callLLMWithSchema(
    Chain5QuestionOutputSchema,
    chain5QuestionSystemPrompt,
    buildChain5QuestionUserPrompt({
      caseTitle: params.caseTitle,
      draftSummary: buildDraftSummary(params.sectionDrafts),
      sectionMissingSummary: buildSectionMissingSummary(params.sectionMissing),
      commonMissingSummary: buildCommonMissingSummary(params.commonMissing),
      rubricSummary: buildRubricSummaryForDrafts(params.sectionDrafts)
    }),
    { model: getModelForChain('CHAIN5'), label: 'CHAIN5 questions' }
  );

  return {
    commonQuestions: output.commonQuestions ?? [],
    sectionQuestions: output.sectionQuestions ?? []
  };
}

export async function runSectionDraftUpdate(params: {
  sectionId: string;
  currentDraft: string;
  evidenceCards: EvidenceCard[];
  qnaHistory: Array<{ question: string; answer: string; timestamp: string }>;
  pendingItems: string[];
  question: string;
  answer: string;
}): Promise<Chain6SectionUpdateOutput> {
  const evidenceText = params.evidenceCards.map((card) => `[#${card.id}] ${card.normalizedText}`).join('\n');
  const qnaHistoryText = params.qnaHistory
    .map((qna, idx) => `Q${idx + 1}: ${qna.question}\nA${idx + 1}: ${qna.answer}`)
    .join('\n\n');

  return callLLMWithSchema(
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
    { model: getModelForChain('CHAIN6'), label: `CHAIN6 update ${params.sectionId}` }
  );
}

export async function runSectionAdequacyReview(params: {
  sectionId: string;
  currentDraft: string;
  evidenceCards: EvidenceCard[];
  qnaHistory: Array<{ question: string; answer: string; timestamp?: string }>;
}): Promise<SectionAdequacyReviewOutput> {
  const evidenceSummary = params.evidenceCards.map((card) => `[#${card.id}] ${card.normalizedText}`).join('\n');
  const qnaSummary = params.qnaHistory
    .map((item, index) => `Q${index + 1}: ${item.question}\nA${index + 1}: ${item.answer}`)
    .join('\n\n');

  return callLLMWithSchema(
    SectionAdequacyReviewOutputSchema,
    sectionAdequacyReviewSystemPrompt,
    buildSectionAdequacyReviewUserPrompt({
      sectionId: params.sectionId,
      currentDraft: params.currentDraft,
      evidenceSummary,
      qnaSummary,
      rubricSummary: buildCareRubricSummary([params.sectionId])
    }),
    { model: getModelForChain('CHAIN4'), label: `ADEQUACY ${params.sectionId}` }
  );
}

export async function runFinalManuscriptCompose(params: {
  sectionDrafts: SectionDraft[];
  evidenceCards: EvidenceCard[];
  qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>>;
  contributionAnswers?: Array<{ question: string; answer: string }>;
}): Promise<FinalDraft> {
  const qnaSummary = Object.entries(params.qnaHistoryBySection)
    .map(([section, list]) => {
      const text = list
        .map((qna, idx) => `Q${idx + 1}: ${qna.question}\nA${idx + 1}: ${qna.answer}`)
        .join('\n');
      return `[${section}]\n${text}`;
    })
    .join('\n\n---\n\n');

  const contributionAnswersText = params.contributionAnswers
    ?.map((qa, idx) => `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${qa.answer}`)
    .join('\n') || '';

  return callLLMWithSchema(
    FinalDraftSchema,
    chain7SystemPrompt,
    buildChain7UserPrompt({
      sectionDraftSummary: buildDraftSummary(params.sectionDrafts),
      evidenceSummary: buildTaggedEvidenceSummary(params.evidenceCards),
      qnaSummary,
      contributionAnswersText,
      rubricSummary: buildRubricSummaryForDrafts(params.sectionDrafts)
    }),
    { model: getModelForChain('CHAIN7'), label: 'CHAIN7 final compose' }
  );
}

export const runChain1_splitEvidence = runEvidenceSplit;
export const runChain2_assess = runSectionAssessment;
export const runChain3_initialDrafts = runInitialSectionDrafts;
export const runChain4_detectMissing = runSectionMissingDetection;
export const runChain5_generateQuestions = runQuestionGeneration;
export const runChain6_updateDraft = runSectionDraftUpdate;
export const runChain7_finalCompose = runFinalManuscriptCompose;

// Legacy aliases retained while routes are being simplified.
export const runLegacySectionDraftUpdate = runSectionDraftUpdate;
export const runFastSectionDraftUpdate = runSectionDraftUpdate;
export const runFinalDraftCompose = runFinalManuscriptCompose;
export const runChain5_finalCompose = runFinalManuscriptCompose;
