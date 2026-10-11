import OpenAI from 'openai';
import { z, ZodError } from 'zod';
import { assertOutboundTextIsSafe } from '../deid/outbound';
import { shouldRetryLLMError, summarizeError } from '../utils/errorSummary';
import { appendUsageLog, setUsageLogDisabledForTests } from './usageLog';

/**
 * LLM 호출의 단일 진입점.
 *
 * 재시도 정책 (docs/prompt_chain_review_v1.md §5-1 6·8번):
 *  - 전송 오류(429, 5xx, 시간 초과, 연결 끊김)만 같은 요청을 다시 보낸다. 최대 MAX_TRANSPORT_RETRIES 회, 지수 백오프.
 *    SDK 자체 재시도는 끈다(maxRetries: 0). 이전에는 SDK 2회 × 앱 3회로 최대 9회·10분을 기다렸다.
 *  - 형식 오류(JSON 구문 오류, 스키마 검증 실패)는 같은 프롬프트를 다시 보내지 않는다(temperature 0 이라 같은 답이 돌아온다).
 *    대신 모델의 응답과 검증 오류를 덧붙인 **수정 호출 1회**를 보낸다. 그것도 실패하면 오류로 끝낸다.
 *  - 400/401/403/404, 할당량 초과, 키 없음은 즉시 실패.
 *  - 출력이 토큰 상한에 잘린 경우(finish_reason=length)는 재시도하지 않고 즉시 실패한다(같은 요청은 같은 자리에서 잘린다).
 *
 * 체인별 상한: 라벨 접두어("CHAIN3 draft" → CHAIN3, "SW-D THERAPEUTIC_INTERVENTIONS" → SW-D)로 시간 초과와 출력 토큰 상한을 고른다.
 */

const MAX_TRANSPORT_RETRIES = 2;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4.1';
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) > 0 ? Number(process.env.LLM_TIMEOUT_MS) : 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
let openaiClient: OpenAI | null = null;

export interface LLMUsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChainLimits {
  /** 요청 1건의 시간 초과(ms). SDK request option 으로 전달. */
  timeoutMs: number;
  /** 출력 토큰 상한. 한국어 본문은 글자당 약 1토큰이므로 섹션 수·길이에 맞춰 넉넉히 둔다. 잘리면 JSON 이 깨져 실패한다. */
  maxOutputTokens: number;
}

/**
 * 라벨 접두어별 상한. 없는 접두어는 기본값.
 * 2026-10-12 실제 호출 기록(llm_usage.jsonl) 기준 최대 출력: CHAIN1 2,629 · CHAIN2 169 · CHAIN3 18,281 · CHAIN4 503 · CHAIN5 602 ·
 * 검토 443 · SW-C 258 · SW-D 1,989 · SW-Q2 368 · SW-R 708 · 판정기 135. 상한은 이보다 넉넉해야 한다(잘리면 실패).
 */
export const CHAIN_LIMITS: Record<string, ChainLimits> = {
  CHAIN1: { timeoutMs: 180_000, maxOutputTokens: 8_000 },
  CHAIN2: { timeoutMs: 90_000, maxOutputTokens: 3_000 },
  // CHAIN3 는 7개 섹션을 한 번에 쓴다. 실제 출력 최대 18,281토큰(2026-10-11 기록). gpt-4.1 출력 상한 32,768.
  CHAIN3: { timeoutMs: 240_000, maxOutputTokens: 32_000 },
  CHAIN4: { timeoutMs: 120_000, maxOutputTokens: 4_000 },
  CHAIN5: { timeoutMs: 120_000, maxOutputTokens: 4_000 },
  CHAIN6: { timeoutMs: 120_000, maxOutputTokens: 6_000 },
  // CHAIN7 은 원고 전체를 쓴다. CHAIN3 보다 짧지 않을 수 있어 같은 수준으로 둔다.
  CHAIN7: { timeoutMs: 300_000, maxOutputTokens: 32_000 },
  SECTION: { timeoutMs: 90_000, maxOutputTokens: 3_000 },
  'SW-Q2': { timeoutMs: 90_000, maxOutputTokens: 3_000 },
  'SW-D': { timeoutMs: 180_000, maxOutputTokens: 6_000 },
  'SW-R': { timeoutMs: 180_000, maxOutputTokens: 6_000 },
  'SW-C': { timeoutMs: 90_000, maxOutputTokens: 4_000 },
  TERMINOLOGY: { timeoutMs: 30_000, maxOutputTokens: 1_000 }
};

export function resolveChainLimits(label: string | undefined): ChainLimits {
  const head = String(label || '')
    .trim()
    .split(/[\s:]/)[0]
    .toUpperCase();
  if (head && CHAIN_LIMITS[head]) return CHAIN_LIMITS[head];
  // "CHAIN3_STUDY_REVEAL" 처럼 접두어 뒤에 꼬리가 붙은 라벨
  const byPrefix = Object.keys(CHAIN_LIMITS).find((key) => head.startsWith(key));
  if (byPrefix) return CHAIN_LIMITS[byPrefix];
  return { timeoutMs: DEFAULT_TIMEOUT_MS, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS };
}

/** 모델 응답이 형식을 지키지 못했거나 잘렸을 때. 전송 재시도 대상이 아니다. */
export class LLMOutputError extends Error {
  code: 'llm_output_invalid' | 'llm_output_truncated';
  details: string;
  constructor(code: LLMOutputError['code'], message: string, details = '') {
    super(message);
    this.name = 'LLMOutputError';
    this.code = code;
    this.details = details;
  }
}

export function getDefaultLLMModel(): string {
  return LLM_MODEL;
}

export function hasOpenAIApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const error: any = new Error(
        'OPENAI_API_KEY is not set. Add it to backend/.env before running any chain.'
      );
      error.code = 'missing_api_key';
      throw error;
    }

    // 재시도는 이 파일의 정책으로만 한다(SDK 재시도와 겹치지 않게).
    openaiClient = new OpenAI({ apiKey, maxRetries: 0, timeout: DEFAULT_TIMEOUT_MS });
  }

  return openaiClient;
}

/** 테스트에서 가짜 클라이언트를 끼운다. null 이면 실제 클라이언트로 되돌린다. */
export function __setOpenAIClientForTests(client: unknown): void {
  openaiClient = (client as OpenAI) || null;
  // 가짜 클라이언트가 끼워진 동안은 비용 기록 파일에 쓰지 않는다
  setUsageLogDisabledForTests(Boolean(client));
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function isFormatError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  if (error instanceof SyntaxError) return true;
  const value = error as { name?: string; code?: string } | null;
  return value?.name === 'ZodError' || value?.name === 'SyntaxError' || value?.code === 'llm_output_invalid';
}

/** 수정 호출에 넣을 검증 오류 설명. 경로와 메시지만 담고 기록 내용은 넣지 않는다. */
export function describeFormatError(error: unknown): string {
  if (error instanceof ZodError || (error as { name?: string })?.name === 'ZodError') {
    const all = (error as ZodError).issues || [];
    const issues = all.slice(0, 8);
    const lines = issues.map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    const more = all.length - issues.length;
    return [`스키마 검증 실패 ${all.length}건:`, ...lines, more > 0 ? `- (외 ${more}건)` : '']
      .filter(Boolean)
      .join('\n');
  }
  if (error instanceof SyntaxError || (error as { name?: string })?.name === 'SyntaxError') {
    return `JSON 구문 오류: ${(error as Error).message}`;
  }
  return summarizeError(error);
}

export function buildRepairInstruction(error: unknown): string {
  return [
    '앞의 응답이 요구한 JSON 형식을 지키지 못했습니다.',
    describeFormatError(error),
    '내용은 그대로 두고 위 오류만 고쳐 전체 JSON을 다시 출력하세요. 요구한 키 이름과 허용 값만 쓰고, JSON 외의 설명은 쓰지 않습니다.'
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callLLMWithSchema<T>(
  // 출력 타입으로만 T 를 추론한다. transform 이 있는 스키마(입력≠출력)도 그대로 받는다.
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  systemPrompt: string,
  userPrompt: string,
  options?: {
    /** 전송 오류 재시도 횟수 (형식 오류에는 적용되지 않는다). */
    retries?: number;
    model?: string;
    label?: string;
    timeoutMs?: number;
    maxOutputTokens?: number;
    onUsage?: (usage: LLMUsageMetrics | null) => void;
  }
): Promise<T> {
  const retries = options?.retries ?? MAX_TRANSPORT_RETRIES;
  const model = options?.model || LLM_MODEL;
  const label = options?.label || 'LLM';
  const limits = resolveChainLimits(label);
  const timeoutMs = options?.timeoutMs ?? limits.timeoutMs;
  const maxOutputTokens = options?.maxOutputTokens ?? limits.maxOutputTokens;

  // Privacy boundary. Runs before the first attempt so a blocked payload costs
  // zero outbound requests. Throwing here is intentional: a chain that forgets
  // to de-identify its input must fail rather than send the identifier.
  assertOutboundTextIsSafe(userPrompt, label);

  const baseMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
  const usageTotal: Required<LLMUsageMetrics> = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let sawUsage = false;

  /** 한 요청을 전송 오류에 대해서만 재시도하며 보낸다. 응답 본문(JSON 문자열)을 돌려준다. */
  async function request(messages: ChatMessage[], phase: 'attempt' | 'repair'): Promise<string> {
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
      const attemptStartedAt = Date.now();
      try {
        console.log(
          `[${label}] ${phase} ${i + 1}/${retries + 1} started with model=${model} timeout=${timeoutMs}ms max_tokens=${maxOutputTokens}`
        );
        const response = await getOpenAIClient().chat.completions.create(
          {
            model,
            messages,
            response_format: { type: 'json_object' },
            temperature: 0,
            max_completion_tokens: maxOutputTokens
          },
          { timeout: timeoutMs }
        );
        const elapsedMs = Date.now() - attemptStartedAt;
        const choice = response.choices[0];
        const usage = response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens
            }
          : null;
        if (usage) {
          sawUsage = true;
          usageTotal.promptTokens += usage.promptTokens || 0;
          usageTotal.completionTokens += usage.completionTokens || 0;
          usageTotal.totalTokens += usage.totalTokens || 0;
        }
        appendUsageLog({
          kind: 'chat',
          label: phase === 'repair' ? `${label} (repair)` : label,
          model,
          elapsedMs,
          ...(usage || {}),
          cachedTokens: (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0
        });
        console.log(
          `[${label}] ${phase} ${i + 1} responded in ${elapsedMs}ms` +
            (usage ? ` (tokens in=${usage.promptTokens} out=${usage.completionTokens})` : '')
        );
        if (choice?.finish_reason === 'length') {
          throw new LLMOutputError(
            'llm_output_truncated',
            `[${label}] output was cut at max_tokens=${maxOutputTokens}; raise the limit for this chain`
          );
        }
        const content = choice?.message?.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }
        return content;
      } catch (error) {
        lastError = error;
        const elapsedMs = Date.now() - attemptStartedAt;
        console.error(
          `[${label}] ${phase} ${i + 1}/${retries + 1} failed after ${elapsedMs}ms - ${summarizeError(error)}`
        );
        if (i === retries || !shouldRetryLLMError(error)) break;
        await sleep(Math.min(500 * 2 ** i, 4_000));
      }
    }
    throw lastError;
  }

  function parse(content: string): T {
    return schema.parse(JSON.parse(content));
  }

  function finish(value: T): T {
    options?.onUsage?.(sawUsage ? usageTotal : null);
    return value;
  }

  const firstContent = await request(baseMessages, 'attempt');
  let firstError: unknown;
  try {
    return finish(parse(firstContent));
  } catch (error) {
    if (!isFormatError(error)) throw error;
    firstError = error;
    console.error(`[${label}] response failed validation, sending one repair call - ${summarizeError(error)}`);
  }

  const repairMessages: ChatMessage[] = [
    ...baseMessages,
    { role: 'assistant', content: firstContent },
    { role: 'user', content: buildRepairInstruction(firstError) }
  ];
  const repairedContent = await request(repairMessages, 'repair');
  try {
    return finish(parse(repairedContent));
  } catch (error) {
    if (!isFormatError(error)) throw error;
    options?.onUsage?.(sawUsage ? usageTotal : null);
    throw new LLMOutputError(
      'llm_output_invalid',
      `[${label}] response still invalid after repair call - ${summarizeError(error)}`,
      describeFormatError(error)
    );
  }
}
