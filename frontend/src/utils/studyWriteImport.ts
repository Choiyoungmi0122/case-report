import type { StudyWriteInspectedSheet, StudyWriteImportedVisit } from '../services/api';

/**
 * 열 고르기 결과로 방문 목록을 만든다. 서버의 backend/src/studyWrite/recordImport.ts
 * buildVisitsFromRows 와 같은 규칙이다. 파일을 다시 올리지 않으려고 클라이언트에서 만든다.
 */

function pad(value: number | string) {
  return String(value).padStart(2, '0');
}

export function formatDateValue(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const full = value.match(/(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]?\s*(\d{1,2})\s*일?(?:\s*[T ]?\s*(\d{1,2}):(\d{2}))?/);
  if (!full) return undefined;
  const [, year, month, day, hour, minute] = full;
  const base = `${year}-${pad(month)}-${pad(day)}`;
  return hour ? `${base}T${pad(hour)}:${minute}` : base;
}

export function toVisitDateTime(value: string | undefined): string {
  if (!value) return '';
  return value.length === 10 ? `${value}T09:00` : value;
}

export function buildVisitsFromSheet(params: {
  sheet: StudyWriteInspectedSheet;
  dateColumn: number;
  textColumns: number[];
  mergeSameDate: boolean;
}): StudyWriteImportedVisit[] {
  const { sheet, dateColumn, textColumns, mergeSameDate } = params;
  const visits: StudyWriteImportedVisit[] = [];

  for (const row of sheet.rows) {
    const date = dateColumn >= 0 ? toVisitDateTime(formatDateValue(row[dateColumn] || '')) : '';
    const parts = textColumns
      .map((column) => {
        const value = (row[column] || '').trim();
        if (!value) return '';
        return textColumns.length > 1 ? `${sheet.headers[column] || `열 ${column + 1}`}: ${value}` : value;
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
