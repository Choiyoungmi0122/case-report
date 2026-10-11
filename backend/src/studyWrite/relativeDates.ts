/**
 * "첫 기록일 +N일" 같은 상대 날짜를 실제 날짜로 바꾼다 (모델 호출 없음, 코드 계산).
 *
 * 날짜를 지운 기록(예: 임교수님 기록)은 초안도 "첫 기록일 +18일"로 나온다. 사용자가 첫 기록일을
 * 한 번 넣으면 화면과 Word 에서 모든 섹션의 상대 날짜를 실제 날짜로 보여 준다. 저장된 초안은
 * 바꾸지 않으므로 첫 기록일을 바꾸거나 지우면 바로 원래대로 돌아간다 (사용자 결정 2026-10-12).
 *
 * 바꾸는 표기 (분명히 첫 기록일 기준인 것만):
 *   첫 기록일 +18일 · 첫 기록일 +18일~+29일 · 첫 기록일 +99~102일 · 첫 기록일 이후 16일째
 *   +32일 · +24~+29일 · +18일~+29일 (더하기 기호가 붙은 일수)
 *   첫 기록일 (단독)
 * 바꾸지 않는 표기: "96~98일 후", "16일째" 처럼 기준이 문장마다 다를 수 있는 것, "+10일분"·"+3일간"
 *
 * frontend/src/utils/relativeDates.ts 와 같은 코드다. 한쪽을 고치면 다른 쪽도 고친다.
 */

export type DateAnchorFormat = 'iso' | 'ko';

export interface DateAnchor {
  /** 첫 기록일 (YYYY-MM-DD) */
  date: string;
  format: DateAnchorFormat;
  setAt?: string;
}

export interface DateConversion {
  text: string;
  /** 바꾼 자리: 원문 [rawStart, rawEnd) → 결과 [outStart, outEnd) */
  segments: Array<{ rawStart: number; rawEnd: number; outStart: number; outEnd: number }>;
}

const MAX_OFFSET = 3650;

export function parseAnchorDate(date: string | null | undefined): number | null {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const check = new Date(ms);
  if (check.getUTCFullYear() !== Number(match[1]) || check.getUTCMonth() !== Number(match[2]) - 1 || check.getUTCDate() !== Number(match[3])) {
    return null;
  }
  return ms;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayMs(anchorMs: number, offset: number): number {
  return anchorMs + offset * 86400000;
}

function formatDay(ms: number, format: DateAnchorFormat): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return format === 'ko' ? `${y}년 ${m}월 ${day}일` : `${y}-${pad(m)}-${pad(day)}`;
}

function formatRange(fromMs: number, toMs: number, format: DateAnchorFormat): string {
  if (format === 'ko') {
    const a = new Date(fromMs);
    const b = new Date(toMs);
    if (a.getUTCFullYear() === b.getUTCFullYear()) {
      return `${formatDay(fromMs, 'ko')}~${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`;
    }
  }
  return `${formatDay(fromMs, format)}~${formatDay(toMs, format)}`;
}

type Rule = { re: RegExp; kind: 'range' | 'single' | 'anchor' };

const SEP = '[~∼〜～–]';
const RULES: Rule[] = [
  // 첫 기록일 +18일~+29일 / 첫 기록일 +99~102일
  { re: new RegExp(`첫\\s*기록일\\s*\\+\\s*(\\d{1,4})\\s*일?\\s*${SEP}\\s*\\+?\\s*(\\d{1,4})\\s*일(?![분간])`, 'g'), kind: 'range' },
  // 첫 기록일 +18일
  { re: /첫\s*기록일\s*\+\s*(\d{1,4})\s*일(?![분간])/g, kind: 'single' },
  // 첫 기록일 이후 16일째 / 첫 기록일부터 16일 후
  { re: /첫\s*기록일\s*(?:이후|부터|로부터|에서)?\s*(\d{1,4})\s*일\s*(?:째|후|뒤)/g, kind: 'single' },
  // +24~+29일 / +18일~+29일 / +99~102일
  { re: new RegExp(`(?<![\\dA-Za-z])\\+\\s*(\\d{1,4})\\s*일?\\s*${SEP}\\s*\\+?\\s*(\\d{1,4})\\s*일(?![분간])`, 'g'), kind: 'range' },
  // +32일
  { re: /(?<![\dA-Za-z])\+\s*(\d{1,4})\s*일(?![분간])/g, kind: 'single' },
  // 첫 기록일 (단독)
  { re: /첫\s*기록일/g, kind: 'anchor' }
];

export function convertRelativeDates(text: string, anchor: DateAnchor | null | undefined): DateConversion {
  const source = String(text || '');
  const anchorMs = parseAnchorDate(anchor?.date);
  if (!anchor || anchorMs === null || !source) return { text: source, segments: [] };
  const format: DateAnchorFormat = anchor.format === 'ko' ? 'ko' : 'iso';

  const found: Array<{ start: number; end: number; replacement: string }> = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(source))) {
      let replacement: string | null = null;
      if (rule.kind === 'anchor') {
        replacement = formatDay(anchorMs, format);
      } else if (rule.kind === 'single') {
        const n = Number(match[1]);
        if (n <= MAX_OFFSET) replacement = formatDay(dayMs(anchorMs, n), format);
      } else {
        const a = Number(match[1]);
        const b = Number(match[2]);
        if (a <= MAX_OFFSET && b <= MAX_OFFSET && b >= a) replacement = formatRange(dayMs(anchorMs, a), dayMs(anchorMs, b), format);
      }
      if (replacement !== null) found.push({ start: match.index, end: match.index + match[0].length, replacement });
    }
  }
  // 앞에서부터, 같은 자리면 긴 것 우선. 겹치는 것은 버린다
  found.sort((x, y) => x.start - y.start || y.end - x.end);
  const chosen: typeof found = [];
  let cursor = 0;
  for (const item of found) {
    if (item.start < cursor) continue;
    chosen.push(item);
    cursor = item.end;
  }

  let out = '';
  let last = 0;
  const segments: DateConversion['segments'] = [];
  for (const item of chosen) {
    out += source.slice(last, item.start);
    const outStart = out.length;
    out += item.replacement;
    segments.push({ rawStart: item.start, rawEnd: item.end, outStart, outEnd: out.length });
    last = item.end;
  }
  out += source.slice(last);
  return { text: out, segments };
}

/** 바꾼 글의 위치를 원문 위치로. 바꾼 자리 안이면 그 자리의 처음(start) / 끝(end)으로 붙인다 */
export function toRawOffset(conversion: DateConversion, outOffset: number, edge: 'start' | 'end'): number {
  let delta = 0;
  for (const seg of conversion.segments) {
    if (outOffset < seg.outStart) break;
    if (outOffset < seg.outEnd || (edge === 'end' && outOffset === seg.outEnd)) {
      return edge === 'start' ? seg.rawStart : seg.rawEnd;
    }
    delta = seg.rawEnd - seg.outEnd;
  }
  return outOffset + delta;
}

export function hasRelativeDates(text: string): boolean {
  return /첫\s*기록일|(?<![\dA-Za-z])\+\s*\d{1,4}\s*일/.test(String(text || ''));
}
