import fs from 'fs';
import path from 'path';

/**
 * 외부 AI 호출 1건마다 토큰 사용량을 한 줄(JSON)로 남긴다. 세션당 비용 산정용.
 * 파일: backend/data/llm_usage.jsonl (data/ 는 git 에 올라가지 않는다). 기록 실패는 호출을 막지 않는다.
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

export function appendUsageLog(entry: Record<string, unknown>): void {
  if (disabledForTests || process.env.LLM_USAGE_LOG_DISABLED === '1') return;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    /* 사용량 기록 실패는 무시한다 */
  }
}
