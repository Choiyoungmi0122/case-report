/**
 * 전문가 EMR(docx)을 실험용 Write 의 "실험 사례 불러오기" 프리셋(JSON)으로 바꾼다.
 *
 * 입력 형식: 방문마다 "익명 진료기록 | 첫 기록일" 또는 "익명 진료기록 | 16일 후" 줄로 시작하는
 * 문서. 날짜가 없고 첫 기록일 기준 상대 일수만 있으므로 relativeDates: true 로 저장한다.
 *
 * 실행: npx tsx scripts/buildStudyWritePreset.ts <docx 경로> <id> "<표시 이름>" "<전문 분야>"
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

function parseOffset(label: string): number | null {
  const text = label.replace(/\s+/g, '');
  if (/^첫기록일/.test(text)) return 0;
  const match = text.match(/^(\d+)일후$/);
  return match ? Number(match[1]) : null;
}

async function main() {
  const [input, id, label, specialty] = process.argv.slice(2);
  if (!input || !id || !label) {
    console.error('usage: tsx scripts/buildStudyWritePreset.ts <docx> <id> "<label>" "<specialty>"');
    process.exit(1);
  }
  const buffer = fs.readFileSync(path.resolve(input));
  const raw = normalizeUnicodeWhitespace((await mammoth.extractRawText({ buffer })).value);
  const lines = raw.split('\n');

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

void main();
