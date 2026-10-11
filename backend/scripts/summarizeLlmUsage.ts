/**
 * LLM 사용량·비용 집계 (읽기 전용). 사용: npm run usage:summary [-- --file <경로>] [--json]
 *
 * 입력: backend/data/llm_usage.jsonl (호출 1건 = 1줄). 파일은 읽기만 하고 바꾸지 않는다.
 *
 * 테스트 기록 제외 기준 (docs/prompt_sets_scaffold_write_v1.md §4):
 *  - chat: elapsedMs < 50. 실제 API 호출은 가장 빠른 것도 300ms 이상이고, 50~300ms 구간에는 기록이 없다.
 *  - embedding: 토큰 수(promptTokens·totalTokens)가 없는 기록. 실제 API 는 항상 usage 를 돌려준다.
 *    가짜 OpenAI 모듈을 쓰는 privacy 테스트가 남긴 것이다.
 *
 * 단가 (OpenAI 공개 단가, USD / 100만 토큰). docs/study_write_cost_timing_v1.md 와 같은 기준이다.
 * 기본 집계는 캐시 할인 미적용, 참고로 캐시 할인 적용 값도 낸다.
 */
import fs from 'fs';
import path from 'path';

const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-4.1': { input: 2.0, cachedInput: 0.5, output: 8.0 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 }
};
const KRW_PER_USD = 1400;

type Row = {
  ts: string;
  kind: 'chat' | 'embedding' | string;
  label?: string;
  model?: string;
  elapsedMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  inputs?: number;
};

type Totals = { calls: number; input: number; cached: number; output: number; usd: number; usdCached: number };

export function isTestRecord(row: Row): boolean {
  if (row.kind === 'chat') return typeof row.elapsedMs === 'number' && row.elapsedMs < 50;
  if (row.kind === 'embedding') return row.promptTokens == null && row.totalTokens == null;
  return false;
}

/** 라벨에서 체인 묶음 이름. "CHAIN3 draft [scaffold]" → CHAIN3, "SW-D THERAPEUTIC_INTERVENTIONS" → SW-D, "... (repair)" → "... 수정 호출" */
export function chainGroup(label = ''): string {
  const repair = /\(repair\)/.test(label);
  const head = label.replace(/\s*\[scaffold\]/, '').replace(/\s*\(repair\)/, '').trim().split(/\s+/)[0] || '(라벨 없음)';
  const name =
    head === 'SECTION' ? '적정성 검토' : head === 'TERMINOLOGY' ? '용어 판정기' : head === 'RAG' ? '임베딩' : head;
  return repair ? `${name} 수정 호출` : name;
}

/** 어느 모드의 호출인가. 2026-10-12 이전 CHAIN1~5·검토·판정기는 모드를 구분할 수 없다(라벨에 [scaffold] 표시가 없었다). */
export function modeGroup(label = ''): string {
  if (/\[scaffold\]/.test(label)) return 'Scaffold';
  if (/^SW-/.test(label)) return '실험용 Write (SW-*)';
  if (/^CHAIN[67]\b/.test(label)) return 'Write (CHAIN6·7)';
  return '공통 처리 (모드 구분 불가)';
}

function emptyTotals(): Totals {
  return { calls: 0, input: 0, cached: 0, output: 0, usd: 0, usdCached: 0 };
}

function cost(row: Row) {
  const price = PRICES[row.model || ''];
  const input = row.promptTokens ?? (row.kind === 'embedding' ? row.totalTokens ?? 0 : 0);
  const output = row.completionTokens ?? 0;
  const cached = Math.min(row.cachedTokens ?? 0, input);
  if (!price) return { input, output, cached, usd: 0, usdCached: 0, unknownModel: true };
  const usd = (input * price.input + output * price.output) / 1e6;
  const usdCached = ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6;
  return { input, output, cached, usd, usdCached, unknownModel: false };
}

function add(target: Totals, row: Row) {
  const c = cost(row);
  target.calls += 1;
  target.input += c.input;
  target.cached += c.cached;
  target.output += c.output;
  target.usd += c.usd;
  target.usdCached += c.usdCached;
}

/** KST 날짜 */
function kstDate(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export function summarize(rows: Row[]) {
  const kept = rows.filter((row) => !isTestRecord(row));
  const excluded = rows.filter(isTestRecord);
  const total = emptyTotals();
  const byModel = new Map<string, Totals>();
  const byChain = new Map<string, Totals>();
  const byMode = new Map<string, Totals>();
  const byDay = new Map<string, Totals>();
  const unknownModels = new Set<string>();
  const bump = (map: Map<string, Totals>, key: string, row: Row) => {
    if (!map.has(key)) map.set(key, emptyTotals());
    add(map.get(key)!, row);
  };
  for (const row of kept) {
    if (!PRICES[row.model || '']) unknownModels.add(row.model || '(없음)');
    add(total, row);
    bump(byModel, `${row.model || '(없음)'}`, row);
    bump(byChain, chainGroup(row.label), row);
    bump(byMode, row.kind === 'embedding' ? '공통 처리 (모드 구분 불가)' : modeGroup(row.label), row);
    bump(byDay, kstDate(row.ts), row);
  }
  const sorted = (map: Map<string, Totals>) => [...map.entries()].sort((a, b) => b[1].usd - a[1].usd);
  return {
    period: { firstTs: rows[0]?.ts, lastTs: rows[rows.length - 1]?.ts },
    rows: rows.length,
    excluded: {
      chat: excluded.filter((row) => row.kind === 'chat').length,
      embedding: excluded.filter((row) => row.kind === 'embedding').length
    },
    total,
    byModel: sorted(byModel),
    byChain: sorted(byChain),
    byMode: sorted(byMode),
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    unknownModels: [...unknownModels]
  };
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const usd = (n: number) => n.toFixed(n < 1 ? 3 : 2);
const krw = (n: number) => Math.round(n * KRW_PER_USD).toLocaleString('en-US');

function table(title: string, entries: Array<[string, Totals]>): string {
  const lines = [
    `### ${title}`,
    '',
    '| 구분 | 호출 | 입력 토큰 | 캐시 입력 | 출력 토큰 | USD | 원 | USD(캐시 할인) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for (const [key, t] of entries) {
    lines.push(`| ${key} | ${fmt(t.calls)} | ${fmt(t.input)} | ${fmt(t.cached)} | ${fmt(t.output)} | ${usd(t.usd)} | ${krw(t.usd)} | ${usd(t.usdCached)} |`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf('--file');
  const file = fileArg >= 0 ? args[fileArg + 1] : path.resolve(__dirname, '../data/llm_usage.jsonl');
  const rows: Row[] = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const s = summarize(rows);
  if (args.includes('--json')) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  const t = s.total;
  console.log(
    [
      `기간(UTC): ${s.period.firstTs} ~ ${s.period.lastTs}`,
      `전체 기록 ${fmt(s.rows)}건 중 테스트 기록 제외: 채팅 ${s.excluded.chat}건, 임베딩 ${s.excluded.embedding}건`,
      `합계: 호출 ${fmt(t.calls)}건, ${usd(t.usd)} USD (약 ${krw(t.usd)}원), 캐시 할인 적용 시 ${usd(t.usdCached)} USD`,
      s.unknownModels.length ? `단가 없는 모델(0원으로 셈): ${s.unknownModels.join(', ')}` : '',
      '',
      table('모델별', s.byModel),
      '',
      table('체인별', s.byChain),
      '',
      table('모드별', s.byMode),
      '',
      table('날짜별 (KST)', s.byDay)
    ]
      .filter((line) => line !== undefined)
      .join('\n')
  );
}

if (require.main === module) main();
