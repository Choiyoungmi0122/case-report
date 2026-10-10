import { z } from 'zod';
import { callLLMWithSchema } from '../llm/client';
import { RetrievedTermResolver } from './resolver';

const DEFAULT_RESOLVER_MODEL =
  process.env.TERMINOLOGY_RESOLVER_MODEL ||
  process.env.REVIEW_MODEL ||
  process.env.LLM_MODEL ||
  'gpt-4.1';

const ResolverDecisionSchema = z.object({
  decision: z.enum(['USE_CANDIDATE', 'ASK_USER', 'KEEP_ORIGINAL']),
  selectedTermId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string()
});

const resolverSystemPrompt = [
  'You are a constrained medical terminology resolver for Korean medicine clinical records.',
  'You receive only a de-identified expression and a retrieved candidate list.',
  'Never invent a new term or select a termId outside the provided candidates.',
  'The job is ONLY to recognise misspellings, abbreviations and aliases of a candidate term, i.e. the expression is the same term written differently (letters differ slightly, or a known short form).',
  'Return USE_CANDIDATE only when the expression is clearly such a variant of exactly one candidate.',
  'Return ASK_USER only when the expression is clearly a variant of a candidate but more than one candidate fits equally.',
  'Return KEEP_ORIGINAL in every other case. In particular keep: ordinary Korean words and phrases; plain anatomical or everyday words (심장, 가슴, 머리, 잠); herb or formula names inside a prescription list; expressions carrying particles or verb endings (가슴이, 심장의, 편하고); expressions whose meaning is merely related to a candidate (가슴이 → 심계 is NOT a variant). Do not ask the user about ordinary words.'
].join(' ');

function buildResolverUserPrompt(input: {
  original: string;
  candidates: Array<{
    termId: string;
    standardTerm: string;
    category: string;
    matchType: string;
    score: number;
  }>;
}) {
  const candidateSummary = input.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. termId=${candidate.termId}; standardTerm=${candidate.standardTerm}; category=${candidate.category}; matchType=${candidate.matchType}; score=${candidate.score}`
    )
    .join('\n');

  return [
    'Original de-identified expression:',
    input.original,
    '',
    'Retrieved candidates:',
    candidateSummary,
    '',
    'Return JSON with decision, optional selectedTermId, confidence, and reason.'
  ].join('\n');
}

export class OpenAITerminologyResolver implements RetrievedTermResolver {
  readonly model: string;

  constructor(model = DEFAULT_RESOLVER_MODEL) {
    this.model = model;
  }

  async resolve(input: {
    original: string;
    candidates: Array<{
      termId: string;
      standardTerm: string;
      score: number;
      matchType: string;
      term: {
        category: string;
      };
    }>;
  }) {
    return callLLMWithSchema(
      ResolverDecisionSchema,
      resolverSystemPrompt,
      buildResolverUserPrompt({
        original: input.original,
        candidates: input.candidates.map((candidate) => ({
          termId: candidate.termId,
          standardTerm: candidate.standardTerm,
          category: candidate.term.category,
          matchType: candidate.matchType,
          score: candidate.score
        }))
      }),
      {
        model: this.model,
        label: 'TERMINOLOGY resolver'
      }
    );
  }
}

export function getDefaultTerminologyResolverModel(): string {
  return DEFAULT_RESOLVER_MODEL;
}
