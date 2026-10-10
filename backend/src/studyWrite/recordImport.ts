import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { normalizeUnicodeText, normalizeUnicodeWhitespace } from '../utils/unicode';

/**
 * 실험용 Write의 기록 올리기.
 *
 * xlsx: 모든 시트의 머리글과 행을 문자열로 돌려준다. 어느 열이 날짜이고 어느 열이
 * 기록인지는 사용자가 화면에서 고르고(열 고르기), 방문 목록은 클라이언트가 만든다.
 * 그래서 파일을 한 번만 올리면 된다. 올린 파일은 저장하지 않는다.
 *
 * docx: 본문 텍스트를 뽑고 날짜가 적힌 줄을 기준으로 방문을 나눈다. 못 나누면 한
 * 덩어리로 돌려주고, 사용자가 입력 화면에서 직접 나눈다.
 */

export const MAX_SHEET_ROWS = 2000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface InspectedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  truncated: boolean;
  /** 머리글로 추정한 날짜 열 인덱스. 없으면 -1 */
  guessedDateColumn: number;
}

export interface ImportedVisit {
  /** 'YYYY-MM-DDTHH:mm'. 날짜를 못 찾으면 빈 문자열 */
  date: string;
  soapText: string;
}

export type InspectResult =
  | { kind: 'xlsx'; fileName: string; sheets: InspectedSheet[] }
  | { kind: 'docx'; fileName: string; text: string; visits: ImportedVisit[]; splitBy: 'full_date' | 'month_day' | 'none' };

const DATE_HEADER_ALIASES = ['date', 'datetime', 'visitdate', '날짜', '일자', '내원일', '진료일', '방문일', '시점', '일시'];

function normalizeHeader(value: string) {
  return normalizeUnicodeText(value).trim().toLowerCase().replace(/[\s_/()\-]/g, '');
}

function pad(value: number | string) {
  return String(value).padStart(2, '0');
}

/** 셀 값을 'YYYY-MM-DD' 또는 'YYYY-MM-DDTHH:mm' 문자열로 바꾼다. 날짜가 아니면 undefined */
export function formatDateValue(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
    const base = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return hasTime ? `${base}T${pad(value.getHours())}:${pad(value.getMinutes())}` : base;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const base = `${String(parsed.y).padStart(4, '0')}-${pad(parsed.m)}-${pad(parsed.d)}`;
      return parsed.H || parsed.M ? `${base}T${pad(parsed.H)}:${pad(parsed.M)}` : base;
    }
  }

  const raw = normalizeUnicodeText(value).trim();
  if (!raw) return undefined;

  const full = raw.match(/(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]?\s*(\d{1,2})\s*일?(?:\s*[T ]?\s*(\d{1,2}):(\d{2}))?/);
  if (full) {
    const [, year, month, day, hour, minute] = full;
    const base = `${year}-${pad(month)}-${pad(day)}`;
    return hour ? `${base}T${pad(hour)}:${minute}` : base;
  }
  return undefined;
}

/** 'YYYY-MM-DD'에 시각이 없으면 09:00을 붙인다. 입력 화면의 datetime-local 형식에 맞춘다. */
export function toVisitDateTime(value: string | undefined): string {
  if (!value) return '';
  return value.length === 10 ? `${value}T09:00` : value;
}

function cellToString(value: unknown): string {
  const asDate = formatDateValue(value);
  if (asDate && (value instanceof Date || typeof value === 'number')) return asDate;
  return normalizeUnicodeWhitespace(value);
}

export function inspectWorkbook(buffer: Buffer, fileName: string): InspectResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets: InspectedSheet[] = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
    if (matrix.length === 0) continue;

    const headers = (matrix[0] || []).map((header) => normalizeUnicodeWhitespace(header));
    const bodyRows = matrix
      .slice(1)
      .filter((row) => (row || []).some((cell) => normalizeUnicodeText(cell).trim() !== ''));
    const rows = bodyRows
      .slice(0, MAX_SHEET_ROWS)
      .map((row) => headers.map((_, index) => cellToString((row || [])[index])));

    const guessedDateColumn = headers.findIndex((header) => DATE_HEADER_ALIASES.includes(normalizeHeader(header)));

    sheets.push({
      name,
      headers,
      rows,
      rowCount: bodyRows.length,
      truncated: bodyRows.length > MAX_SHEET_ROWS,
      guessedDateColumn
    });
  }

  if (sheets.length === 0) {
    throw new Error('엑셀 파일에서 내용이 있는 시트를 찾지 못했습니다.');
  }
  return { kind: 'xlsx', fileName, sheets };
}

// 줄 맨 앞의 날짜. "2026-03-11", "2026.3.11", "2026년 3월 11일", "[2026-03-11]", "초진 2026-03-11" 도 잡는다.
const FULL_DATE_LINE = /^\s*[\[(#*\-•·]*\s*(?:초진|재진|방문|visit|내원)?\s*#?\d*\s*[:.)\]]?\s*(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]?\s*(\d{1,2})\s*일?/i;
const MONTH_DAY_LINE = /^\s*[\[(#*\-•·]*\s*(?:초진|재진|방문|visit|내원)?\s*#?\d*\s*[:.)\]]?\s*(\d{1,2})\s*[./]\s*(\d{1,2})(?!\d)\s*[)\]:]?\s/i;

/**
 * 날짜가 적힌 줄을 경계로 글을 방문 단위로 나눈다. 연도가 있는 날짜 줄이 있으면 그것을,
 * 없으면 월/일 줄을 쓴다. 둘 다 없으면 한 덩어리로 돌려준다.
 */
export function splitTextIntoVisits(text: string): { visits: ImportedVisit[]; splitBy: 'full_date' | 'month_day' | 'none' } {
  const lines = normalizeUnicodeWhitespace(text).split('\n');
  const fullMatches = lines.filter((line) => FULL_DATE_LINE.test(line)).length;

  if (fullMatches >= 1) {
    const visits: ImportedVisit[] = [];
    let current: ImportedVisit | null = null;
    for (const line of lines) {
      const match = line.match(FULL_DATE_LINE);
      if (match) {
        if (current && current.soapText.trim()) visits.push(current);
        const [, year, month, day] = match;
        current = { date: toVisitDateTime(`${year}-${pad(month)}-${pad(day)}`), soapText: line.trim() + '\n' };
        continue;
      }
      if (!current) current = { date: '', soapText: '' };
      current.soapText += line + '\n';
    }
    if (current && current.soapText.trim()) visits.push(current);
    return { visits: visits.map(trimVisit), splitBy: 'full_date' };
  }

  const monthDayMatches = lines.filter((line) => MONTH_DAY_LINE.test(line)).length;
  if (monthDayMatches >= 2) {
    const year = new Date().getFullYear();
    const visits: ImportedVisit[] = [];
    let current: ImportedVisit | null = null;
    for (const line of lines) {
      const match = line.match(MONTH_DAY_LINE);
      if (match) {
        if (current && current.soapText.trim()) visits.push(current);
        const [, month, day] = match;
        current = { date: toVisitDateTime(`${year}-${pad(month)}-${pad(day)}`), soapText: line.trim() + '\n' };
        continue;
      }
      if (!current) current = { date: '', soapText: '' };
      current.soapText += line + '\n';
    }
    if (current && current.soapText.trim()) visits.push(current);
    return { visits: visits.map(trimVisit), splitBy: 'month_day' };
  }

  return { visits: [{ date: '', soapText: lines.join('\n').trim() }], splitBy: 'none' };
}

function trimVisit(visit: ImportedVisit): ImportedVisit {
  return { date: visit.date, soapText: visit.soapText.trim() };
}

export async function inspectDocx(buffer: Buffer, fileName: string): Promise<InspectResult> {
  const result = await mammoth.extractRawText({ buffer });
  const text = normalizeUnicodeWhitespace(result.value);
  if (!text) {
    throw new Error('문서에서 글자를 찾지 못했습니다.');
  }
  const { visits, splitBy } = splitTextIntoVisits(text);
  return { kind: 'docx', fileName, text, visits, splitBy };
}

export async function inspectRecordFile(buffer: Buffer, fileName: string): Promise<InspectResult> {
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error('파일이 10MB를 넘습니다.');
  }
  if (/\.xlsx$/i.test(fileName)) return inspectWorkbook(buffer, fileName);
  if (/\.docx$/i.test(fileName)) return inspectDocx(buffer, fileName);
  throw new Error('xlsx 또는 docx 파일만 올릴 수 있습니다.');
}

/**
 * 열 고르기 결과로 방문 목록을 만든다. 서버와 클라이언트가 같은 규칙을 쓰도록 여기에
 * 두고, 클라이언트는 이 함수와 같은 동작을 하는 코드를 갖는다 (frontend/src/utils/studyWriteImport.ts).
 */
export function buildVisitsFromRows(params: {
  headers: string[];
  rows: string[][];
  dateColumn: number;
  textColumns: number[];
  mergeSameDate: boolean;
}): ImportedVisit[] {
  const { headers, rows, dateColumn, textColumns, mergeSameDate } = params;
  const visits: ImportedVisit[] = [];

  for (const row of rows) {
    const date = dateColumn >= 0 ? toVisitDateTime(formatDateValue(row[dateColumn])) : '';
    const parts = textColumns
      .map((column) => {
        const value = (row[column] || '').trim();
        if (!value) return '';
        return textColumns.length > 1 ? `${headers[column] || `열 ${column + 1}`}: ${value}` : value;
      })
      .filter(Boolean);
    if (parts.length === 0) continue;
    const text = parts.join('\n');

    const last = visits[visits.length - 1];
    if (mergeSameDate && last && date && last.date === date) {
      last.soapText += `\n${text}`;
      continue;
    }
    visits.push({ date, soapText: text });
  }

  return visits;
}
