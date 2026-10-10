import fs from 'fs';
import path from 'path';

/**
 * 외부 AI 호출 1건마다 토큰 사용량을 한 줄(JSON)로 남긴다. 세션당 비용 산정용.
 * 파일: backend/data/llm_usage.jsonl (data/ 는 git 에 올라가지 않는다). 기록 실패는 호출을 막지 않는다.
 */
const LOG_PATH = path.resolve(__dirname, '../../data/llm_usage.jsonl');

export function appendUsageLog(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    /* 사용량 기록 실패는 무시한다 */
  }
}
