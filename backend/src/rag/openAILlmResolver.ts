import { z } from 'zod';
import { callLLMWithSchema } from '../llm/client';
import { RetrievedTermResolver } from './resolver';
import { TerminologyResolverDecision } from './types';

// 오타·약어 인지는 빠른 모델로 충분하다. 호출이 많아(기록당 수십 회) 비용·시간을 줄인다 (사용자 결정 2026-10-11).
const DEFAULT_RESOLVER_MODEL =
  process.env.TERMINOLOGY_RESOLVER_MODEL ||
  process.env.FAST_LLM_MODEL ||
  'gpt-4.1-mini';

/**
 * 버전 이력
 *  - TERM:v1 ~2026-10-11: 영어 프롬프트.
 *  - TERM:v2 2026-10-12: 같은 규칙을 한국어로 옮김(다른 체인과 같은 언어·구조). 판단 기준은 바꾸지 않았다.
 */
export const TERMINOLOGY_RESOLVER_PROMPT_VERSION = 'TERM:v2';

const ResolverDecisionSchema = z.object({
  decision: z.enum(['USE_CANDIDATE', 'ASK_USER', 'KEEP_ORIGINAL']),
  selectedTermId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string().default('')
});

export const resolverSystemPrompt = `
역할:
당신은 한의 임상 기록의 용어 판정기입니다. 비식별 처리된 표현 하나와 사전에서 검색된 후보 목록만 받습니다.

규칙:
1. 새 용어를 만들지 않고, 후보 목록에 없는 termId를 고르지 않습니다.
2. 할 일은 하나뿐입니다: 표현이 어느 후보 용어의 오타·약어·별칭인지, 곧 같은 용어를 글자만 조금 다르게 썼거나 알려진 줄임말로 쓴 것인지 알아봅니다.
3. USE_CANDIDATE: 표현이 정확히 한 후보의 그런 변형임이 분명할 때만 고릅니다.
4. ASK_USER: 표현이 후보의 변형임은 분명하지만 두 개 이상의 후보가 똑같이 맞을 때만 고릅니다.
5. KEEP_ORIGINAL: 그 밖의 모든 경우입니다. 특히 다음은 그대로 둡니다.
   - 일상 한국어 낱말과 구
   - 해부 부위나 일상 낱말(심장, 가슴, 머리, 잠)
   - 처방 목록 안의 약재·처방 이름
   - 조사나 어미가 붙은 표현(가슴이, 심장의, 편하고)
   - 뜻만 관련된 표현(가슴이 → 심계는 변형이 아닙니다)
   일상 낱말을 사용자에게 묻지 않습니다.

출력 형식:
{
  "decision": "<USE_CANDIDATE | ASK_USER | KEEP_ORIGINAL>",
  "selectedTermId": "<USE_CANDIDATE일 때 고른 후보의 termId>",
  "confidence": <0~1 사이 숫자>,
  "reason": "<판단 이유 한 문장>"
}
`;

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

  return ['입력 1. 비식별 처리된 표현:', input.original, '', '입력 2. 검색된 후보:', candidateSummary].join('\n');
}

/** 같은 표현·후보 조합은 한 프로세스 안에서 한 번만 묻는다. */
const MEMO_LIMIT = 5_000;
/** 이 시간 안에 이만큼 실패하면 잠시 판정기를 끈다(장애 때 호출과 대기를 쌓지 않는다). */
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 120_000;

type ResolveInput = Parameters<RetrievedTermResolver['resolve']>[0];

export class OpenAITerminologyResolver implements RetrievedTermResolver {
  readonly model: string;
  private readonly memo = new Map<string, Promise<TerminologyResolverDecision>>();
  private failureTimes: number[] = [];
  private disabledUntil = 0;
  private readonly call: (input: ResolveInput) => Promise<TerminologyResolverDecision>;

  private readonly systemPrompt: string;
  private readonly label: string;

  /**
   * options.systemPrompt: 프롬프트 세트별 판정기 프롬프트. Scaffold 는 `prompts/scaffold/terminology_resolver.ts` 를 쓴다
   * (rag/runtime.ts). 없으면 이 파일의 Write 프롬프트.
   */
  constructor(
    model = DEFAULT_RESOLVER_MODEL,
    call?: (input: ResolveInput) => Promise<TerminologyResolverDecision>,
    options: { systemPrompt?: string; label?: string } = {}
  ) {
    this.model = model;
    this.call = call || ((input) => this.callModel(input));
    this.systemPrompt = options.systemPrompt || resolverSystemPrompt;
    this.label = options.label || 'TERMINOLOGY resolver';
  }

  private memoKey(input: ResolveInput): string {
    const ids = input.candidates.map((candidate) => candidate.termId).sort();
    return `${String(input.original || '').trim()}|${ids.join(',')}`;
  }

  private recordFailure(now: number) {
    this.failureTimes = [...this.failureTimes.filter((time) => now - time < FAILURE_WINDOW_MS), now];
    if (this.failureTimes.length >= FAILURE_THRESHOLD) {
      this.disabledUntil = now + COOLDOWN_MS;
      this.failureTimes = [];
      console.warn(`[RAG] terminology resolver failed ${FAILURE_THRESHOLD} times; disabled for ${COOLDOWN_MS / 1000}s`);
    }
  }

  async resolve(input: ResolveInput): Promise<TerminologyResolverDecision> {
    const key = this.memoKey(input);
    const cached = this.memo.get(key);
    if (cached) return cached;

    const now = Date.now();
    if (now < this.disabledUntil) {
      // resolver.ts 가 KEEP_ORIGINAL 로 처리한다.
      throw new Error('terminology resolver is temporarily disabled after repeated failures');
    }

    const pending = this.call(input).then(
      (decision) => {
        this.failureTimes = [];
        return decision;
      },
      (error) => {
        this.memo.delete(key);
        this.recordFailure(Date.now());
        throw error;
      }
    );
    this.memo.set(key, pending);
    if (this.memo.size > MEMO_LIMIT) {
      const oldest = this.memo.keys().next().value;
      if (oldest !== undefined) this.memo.delete(oldest);
    }
    return pending;
  }

  private callModel(input: ResolveInput): Promise<TerminologyResolverDecision> {
    return callLLMWithSchema(
      ResolverDecisionSchema,
      this.systemPrompt,
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
        label: this.label
      }
    );
  }
}

export function getDefaultTerminologyResolverModel(): string {
  return DEFAULT_RESOLVER_MODEL;
}
