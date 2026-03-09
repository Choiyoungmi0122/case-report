import { callLLMWithSchema } from './client';
import { Chain1OutputSchema, EvidenceCard } from './schemas/chain1_splitTag';
import { Chain2OutputSchema, SectionState } from './schemas/chain2_assess';
import { Chain3OutputSchema, SectionDraft } from './schemas/chain3_draft';
import { Chain4OutputSchema, Chain4Output } from './schemas/chain4_qa_update';
import { FinalDraftSchema, FinalDraft } from './schemas/chain5_final';
import { chain1SystemPrompt, buildChain1UserPrompt } from './prompts/chain1_splitTag';
import { chain2SystemPrompt, buildChain2UserPrompt } from './prompts/chain2_assess';
import { chain3SystemPrompt, buildChain3UserPrompt } from './prompts/chain3_draft';
import { chain4SystemPrompt, buildChain4UserPrompt } from './prompts/chain4_qa_update';
import { chain5SystemPrompt, buildChain5UserPrompt } from './prompts/chain5_final';

// Chain 1: visits -> EvidenceCards
export async function runChain1_splitEvidence(visits: Array<{ index: number; date: string; text: string }>): Promise<EvidenceCard[]> {
  const visitsText = visits
    .map(v => `방문 ${v.index} (${v.date}):\n${v.text}`)
    .join('\n\n---\n\n');

  const output = await callLLMWithSchema(
    Chain1OutputSchema,
    chain1SystemPrompt,
    buildChain1UserPrompt(visitsText)
  );

  return output.evidenceCards;
}

// Chain 2: EvidenceCards -> SectionStates
export async function runChain2_assess(evidenceCards: EvidenceCard[]): Promise<SectionState[]> {
  const summary = evidenceCards
    .flatMap(card => card.tags.map(tag => ({ tag, id: card.id })))
    .reduce<Record<string, number>>((acc, cur) => {
      acc[cur.tag] = (acc[cur.tag] || 0) + 1;
      return acc;
    }, {});

  const evidenceSummary = Object.entries(summary)
    .map(([section, count]) => `${section}: ${count}개 evidence`)
    .join('\n');

  const output = await callLLMWithSchema(
    Chain2OutputSchema,
    chain2SystemPrompt,
    buildChain2UserPrompt(evidenceSummary)
  );

  return output.sectionStates;
}

// Chain 3: EvidenceCards + SectionStates -> SectionDrafts v0
export async function runChain3_initialDrafts(
  evidenceCards: EvidenceCard[],
  sectionStates: SectionState[]
): Promise<SectionDraft[]> {
  const evidenceText = Object.entries(
    evidenceCards.reduce<Record<string, string[]>>((acc, card) => {
      card.tags.forEach(tag => {
        acc[tag] = acc[tag] || [];
        acc[tag].push(`[#${card.id}] ${card.normalizedText}`);
      });
      return acc;
    }, {})
  )
    .map(([section, texts]) => `[${section}]\n${texts.join('\n')}`)
    .join('\n\n---\n\n');

  const statusSummary = sectionStates
    .map(s => `${s.sectionId}: ${s.status}`)
    .join('\n');

  const output = await callLLMWithSchema(
    Chain3OutputSchema,
    chain3SystemPrompt,
    buildChain3UserPrompt(evidenceText, statusSummary)
  );

  return output.sectionDrafts;
}

// Chain 4: Q&A 1 step
export async function runChain4_updateDraft(params: {
  sectionId: string;
  currentDraft: string;
  evidenceCards: EvidenceCard[];
  qnaHistory: Array<{ question: string; answer: string; timestamp: string }>;
  pendingItems: string[];
  latestAnswer?: string;
}): Promise<Chain4Output> {
  const evidenceText = params.evidenceCards.map(c => c.normalizedText).join('\n');
  const qnaHistoryText = params.qnaHistory
    .map((qna, idx) => `Q${idx + 1}: ${qna.question}\nA${idx + 1}: ${qna.answer}`)
    .join('\n\n');

  return callLLMWithSchema(
    Chain4OutputSchema,
    chain4SystemPrompt,
    buildChain4UserPrompt({
      sectionId: params.sectionId,
      currentDraft: params.currentDraft,
      evidenceText,
      qnaHistoryText,
      pendingItems: params.pendingItems,
      latestAnswer: params.latestAnswer
    })
  );
}

// Chain 5: Final compose
export async function runChain5_finalCompose(params: {
  sectionDrafts: SectionDraft[];
  evidenceCards: EvidenceCard[];
  qnaHistoryBySection: Record<string, Array<{ question: string; answer: string }>>;
  contributionAnswers?: Array<{ question: string; answer: string }>;
}): Promise<FinalDraft> {
  const sectionDraftSummary = params.sectionDrafts
    .map(d => `[${d.sectionId}]\n${d.draftText}`)
    .join('\n\n---\n\n');

  const evidenceSummary = params.evidenceCards
    .map(c => `[${c.tags.join(',')}] ${c.normalizedText}`)
    .join('\n');

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
    chain5SystemPrompt,
    buildChain5UserPrompt({
      sectionDraftSummary,
      evidenceSummary,
      qnaSummary,
      contributionAnswersText
    })
  );
}

