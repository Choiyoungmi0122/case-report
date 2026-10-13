/**
 * 전문가 EMR(docx)을 실험용 Write 의 "실험 사례 불러오기" 프리셋(JSON)으로 바꾼다.
 *
 * 입력 형식: 방문마다 "익명 진료기록 | 첫 기록일" 또는 "익명 진료기록 | 16일 후" 줄로 시작하는
 * 문서. 날짜가 없고 첫 기록일 기준 상대 일수만 있으므로 relativeDates: true 로 저장한다.
 *
 * 다른 형식(2026-10-13): 방문마다 "[1차] 7/2 (초진)"처럼 "[N차] 월/일" 줄로 시작하는 문서(교수 가상환자 EMR).
 * 연도가 없으므로 --year 로 준다. 실제 날짜로 저장한다(relativeDates: false). 첫 머리글 앞의 줄(제목, 나이·성별)은
 * 1차 방문 앞에 그대로 붙인다.
 *
 * 실행: npx tsx scripts/buildStudyWritePreset.ts <docx 경로> <id> "<표시 이름>" "<전문 분야>" [--year 2026]
 * 예:   npx tsx scripts/buildStudyWritePreset.ts "C:\\...\\anonymized_records.docx" lim-internal "한방내과 - 임교수님" "한방내과"
 *
 * 결과: backend/data/study-write-presets/<id>.json (git 에 올리지 않는다. docs/study_write_presets_README.md 참고)
 */
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { normalizeUnicodeWhitespace } from '../src/utils/unicode';

// 머리글 앞에 붙은 'ㄴ' 같은 흔적은 NFKC 정규화 뒤 자모(U+1100~)로 바뀌므로 그 범위도 허용한다.
const HEADER = /^\s*[ᄀ-ᇿ㄰-㆏\-•·\s]*익명\s*진료기록\s*\|\s*(.+?)\s*$/;

// "[1차] 7/2 (초진)" 형식
const ABS_HEADER = /^\s*\[(\d+)\s*차\]\s*(\d{1,2})\s*\/\s*(\d{1,2})\b.*$/;

function parseOffset(label: string): number | null {
  const text = label.replace(/\s+/g, '');
  if (/^첫기록일/.test(text)) return 0;
  const match = text.match(/^(\d+)일후$/);
  return match ? Number(match[1]) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const yearIndex = args.indexOf('--year');
  const year = yearIndex >= 0 ? Number(args.splice(yearIndex, 2)[1]) : NaN;
  const [input, id, label, specialty] = args;
  if (!input || !id || !label) {
    console.error('usage: tsx scripts/buildStudyWritePreset.ts <docx> <id> "<label>" "<specialty>"');
    process.exit(1);
  }
  const buffer = fs.readFileSync(path.resolve(input));
  const raw = normalizeUnicodeWhitespace((await mammoth.extractRawText({ buffer })).value);
  const lines = raw.split('\n');

  if (lines.some((line) => ABS_HEADER.test(line))) {
    if (!Number.isInteger(year)) {
      console.error('"[N차] 월/일" 형식은 연도가 없습니다. --year 2026 처럼 연도를 주세요.');
      process.exit(1);
    }
    saveAbsolute(lines, { input, id, label, specialty, year });
    return;
  }

  const visits: Array<{ dayOffset: number; label: string; lines: string[] }> = [];
  let current: { dayOffset: number; label: string; lines: string[] } | null = null;
  const warnings: string[] = [];

  for (const line of lines) {
    const match = line.match(HEADER);
    if (match) {
      const offset = parseOffset(match[1]);
      if (offset === null) {
        warnings.push(`날짜 표기를 읽지 못한 머리글: "${line.trim()}"`);
      }
      current = { dayOffset: offset ?? (visits[visits.length - 1]?.dayOffset ?? 0), label: match[1].trim(), lines: [] };
      visits.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  const cleaned = visits.map((visit) => {
    const text = visit.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { dayOffset: visit.dayOffset, label: visit.label, text };
  });

  // 같은 일수가 둘이면 알린다. 내용이 비어 있는 방문도 알린다.
  const seen = new Map<number, number>();
  cleaned.forEach((visit, index) => {
    if (seen.has(visit.dayOffset)) warnings.push(`같은 일수(${visit.dayOffset})가 방문 ${seen.get(visit.dayOffset)! + 1}과 ${index + 1}에 있음`);
    seen.set(visit.dayOffset, index);
    if (visit.text.replace(/\[[^\]]*\]|내원일.*|\s/g, '').length < 10) warnings.push(`방문 ${index + 1}(${visit.label})은 진료 내용이 거의 없음`);
  });

  const preset = {
    id,
    label,
    specialty: specialty || '',
    relativeDates: true,
    /** 상대 일수를 입력 칸의 날짜로 바꿀 때 쓰는 기준일. 실제 날짜가 아니다. */
    anchorDate: '2025-01-01',
    sourceFile: path.basename(input),
    builtAt: new Date().toISOString(),
    visits: cleaned
  };

  const outDir = path.resolve(__dirname, '../data/study-write-presets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(preset, null, 2), 'utf8');
  console.log(`saved ${outPath}: ${cleaned.length} visits, day 0 ~ ${Math.max(...cleaned.map((v) => v.dayOffset))}`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
}

/** "[N차] 월/일" 형식: 실제 날짜로 저장한다. */
function saveAbsolute(
  lines: string[],
  params: { input: string; id: string; label: string; specialty?: string; year: number }
) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const preamble: string[] = [];
  const visits: Array<{ no: number; date: string; header: string; lines: string[] }> = [];
  for (const line of lines) {
    const match = line.match(ABS_HEADER);
    if (match) {
      const date = `${params.year}-${pad(Number(match[2]))}-${pad(Number(match[3]))}T09:00`;
      visits.push({ no: Number(match[1]), date, header: line.trim(), lines: [] });
      continue;
    }
    if (visits.length === 0) preamble.push(line);
    else visits[visits.length - 1].lines.push(line);
  }
  const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim();
  const head = tidy(preamble.join('\n'));
  const cleaned = visits.map((visit, index) => ({
    date: visit.date,
    label: visit.header,
    text: tidy(`${index === 0 && head ? `${head}\n\n` : ''}${visit.lines.join('\n')}`)
  }));

  const warnings: string[] = [];
  visits.forEach((visit, index) => {
    if (visit.no !== index + 1) warnings.push(`방문 순번이 어긋남: ${visit.header}`);
    if (index > 0 && visit.date <= visits[index - 1].date) warnings.push(`날짜가 앞 방문보다 늦지 않음: ${visit.header}`);
  });

  const preset = {
    id: params.id,
    label: params.label,
    specialty: params.specialty || '',
    relativeDates: false,
    /** 원문에 연도가 없어 --year 로 넣은 연도 */
    assumedYear: params.year,
    sourceFile: path.basename(params.input),
    builtAt: new Date().toISOString(),
    visits: cleaned
  };
  const outDir = path.resolve(__dirname, '../data/study-write-presets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${params.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(preset, null, 2), 'utf8');
  console.log(`saved ${outPath}: ${cleaned.length} visits, ${cleaned[0]?.date} ~ ${cleaned[cleaned.length - 1]?.date}`);
  for (const warning of warnings) console.log(`warning: ${warning}`);
}

void main();
