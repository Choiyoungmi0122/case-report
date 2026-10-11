import fs from 'fs';
import path from 'path';
import { getUsageContext } from './usageContext';

/**
 * 외부 AI 호출 1건마다 토큰 사용량을 한 줄(JSON)로 남긴다. 세션당 비용 산정용.
 * 파일: backend/data/llm_usage.jsonl (data/ 는 git 에 올라가지 않는다). 기록 실패는 호출을 막지 않는다.
 * 2026-10-12부터 요청 문맥의 caseId(또는 manuscriptReviewId)를 함께 남긴다(llm/usageContext.ts). 그 전 기록에는 없다.
 */
const LOG_PATH = path.resolve(__dirname, '../../data/llm_usage.jsonl');

/**
 * 테스트(가짜 클라이언트)는 기록하지 않는다. 2026-10-12 이전에는 테스트 호출이 이 파일에 섞였다
 * (소요 시간 50ms 미만, 토큰 1~15개짜리 기록).
 */
let disabledForTests = false;
export function setUsageLogDisabledForTests(disabled: boolean): void {
  disabledForTests = disabled;
}

/** 기록 한 줄. 요청 문맥의 사례 id 를 붙인다. */
export function buildUsageLogEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const context = getUsageContext();
  return {
    ts: new Date().toISOString(),
    ...(context?.caseId ? { caseId: context.caseId } : {}),
    ...(context?.manuscriptReviewId ? { manuscriptReviewId: context.manuscriptReviewId } : {}),
    ...entry
  };
}

export function appendUsageLog(entry: Record<string, unknown>): void {
  if (disabledForTests || process.env.LLM_USAGE_LOG_DISABLED === '1') return;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(buildUsageLogEntry(entry))}\n`, 'utf8');
  } catch {
    /* 사용량 기록 실패는 무시한다 */
  }
}
