import { createHash, randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { normalizeUnicodeText, normalizeUnicodeWhitespace } from '../utils/unicode';
import {
  TimelineColumnMapping,
  TimelineEvent,
  TimelineImportPreviewRow,
  TimelineImportResult,
  TimelineImportWarning
} from './types';

const COLUMN_ALIASES: Record<keyof TimelineColumnMapping, string[]> = {
  date: ['date', 'datetime', 'day', '시점', '날짜', '일자', '내원일'],
  visitNo: ['visitno', 'visit_no', 'visit', 'visitnumber', '방문차수', '방문', '차수'],
  symptom: ['symptom', 'symptoms', 'chiefcomplaint', '주요증상', '증상', '증후'],
  test: ['test', 'tests', 'evaluation', 'assessment', '검사', '평가', '검사평가', '검사/평가'],
  diagnosis: ['diagnosis', 'diagnostic', 'impression', 'assessmentplan', '진단', '판단', '진단판단', '진단/판단'],
  treatment: ['treatment', 'intervention', 'therapy', 'plan', '치료', '중재', '처치'],
  outcome: ['outcome', 'progress', 'followup', 'result', '경과', '결과', '추적'],
  note: ['note', 'memo', 'remarks', 'remark', '비고', '메모', '참고']
};

function normalizeHeader(value: string) {
  return normalizeUnicodeText(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_/()\-]/g, '');
}

function isExcelDateCode(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 20000 && value < 80000;
}

function formatDateCell(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (isExcelDateCode(value)) {
    const parsed = XLSX.SSF.parse_date_code(value as number);
    if (parsed) {
      const year = String(parsed.y).padStart(4, '0');
      const month = String(parsed.m).padStart(2, '0');
      const day = String(parsed.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  const raw = normalizeUnicodeText(value).trim();
  if (!raw) return undefined;

  const koreanMatch = raw.match(/(\d{4})\s*[년./-]?\s*(\d{1,2})\s*[월./-]?\s*(\d{1,2})/);
  if (koreanMatch) {
    const [, year, month, day] = koreanMatch;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return undefined;
}

function normalizeCell(value: unknown) {
  return normalizeUnicodeWhitespace(value).replace(/\s+/g, ' ').trim();
}

function buildColumnMapping(headers: string[]): TimelineColumnMapping {
  const normalizedHeaders = headers.map((header) => ({
    original: normalizeUnicodeText(header),
    normalized: normalizeHeader(header)
  }));

  const mapping: TimelineColumnMapping = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [keyof TimelineColumnMapping, string[]]
  >) {
    const match = normalizedHeaders.find((header) => aliases.includes(header.normalized));
    if (match) {
      mapping[field] = match.original;
    }
  }

  return mapping;
}

function buildRowSignature(event: Partial<TimelineEvent>) {
  return createHash('sha1')
    .update(
      JSON.stringify({
        columnOrder: event.columnOrder || [],
        cells: event.cells || {},
        date: event.date || '',
        visitNo: event.visitNo || '',
        symptom: event.symptom || '',
        test: event.test || '',
        diagnosis: event.diagnosis || '',
        treatment: event.treatment || '',
        outcome: event.outcome || '',
        note: event.note || ''
      })
    )
    .digest('hex');
}

function hasMeaningfulContent(row: Partial<TimelineEvent>) {
  return Boolean(
    Object.values(row.cells || {}).some(Boolean) ||
    row.date ||
      row.visitNo ||
      row.symptom ||
      row.test ||
      row.diagnosis ||
      row.treatment ||
      row.outcome ||
      row.note
  );
}

export function parseTimelineWorkbook(buffer: Buffer): TimelineImportResult {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('No worksheet was found in the uploaded file.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: true
  });
  const displayRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false
  });

  const headers =
    XLSX.utils.sheet_to_json<string[]>(worksheet, {
      header: 1,
      defval: '',
      raw: false
    })[0]?.map((header) => normalizeUnicodeText(header)) || [];

  const columnMapping = buildColumnMapping(headers.map((header) => String(header)));
  const warnings: TimelineImportWarning[] = [];
  const previewRows: TimelineImportPreviewRow[] = [];
  const timelineEvents: TimelineEvent[] = [];
  const seenSignatures = new Set<string>();
  let skippedRows = 0;

  rawRows.forEach((rawRow, index) => {
    const displayRow = displayRows[index] || {};
    const rowIndex = index + 2;
    const normalizedColumnOrder = headers.filter(Boolean).map((header) => normalizeUnicodeText(header));
    const previewValues = Object.fromEntries(
      Object.entries(displayRow || {}).map(([key, value]) => [normalizeUnicodeText(key), normalizeCell(value)])
    );
    if (Object.values(previewValues).some(Boolean) && previewRows.length < 5) {
      previewRows.push({
        originalRowIndex: rowIndex,
        values: previewValues
      });
    }

    const rawDate = columnMapping.date ? rawRow[columnMapping.date] : undefined;
    const displayDate = columnMapping.date ? displayRow[columnMapping.date] : undefined;
    const parsedDate = formatDateCell(rawDate);
    const normalizedCells = Object.fromEntries(
      normalizedColumnOrder.map((header) => [
        header,
        normalizeCell(
          (displayRow as Record<string, unknown>)[header] ??
            (rawRow as Record<string, unknown>)[header] ??
            ''
        )
      ])
    );
    const eventDraft: Partial<TimelineEvent> = {
      columnOrder: normalizedColumnOrder,
      cells: normalizedCells,
      date: parsedDate || formatDateCell(displayDate),
      visitNo: normalizeCell(columnMapping.visitNo ? displayRow[columnMapping.visitNo] ?? rawRow[columnMapping.visitNo] : ''),
      symptom: normalizeCell(columnMapping.symptom ? displayRow[columnMapping.symptom] ?? rawRow[columnMapping.symptom] : ''),
      test: normalizeCell(columnMapping.test ? displayRow[columnMapping.test] ?? rawRow[columnMapping.test] : ''),
      diagnosis: normalizeCell(
        columnMapping.diagnosis ? displayRow[columnMapping.diagnosis] ?? rawRow[columnMapping.diagnosis] : ''
      ),
      treatment: normalizeCell(
        columnMapping.treatment ? displayRow[columnMapping.treatment] ?? rawRow[columnMapping.treatment] : ''
      ),
      outcome: normalizeCell(columnMapping.outcome ? displayRow[columnMapping.outcome] ?? rawRow[columnMapping.outcome] : ''),
      note: normalizeCell(columnMapping.note ? displayRow[columnMapping.note] ?? rawRow[columnMapping.note] : '')
    };

    if (!parsedDate && normalizeCell(rawDate) && hasMeaningfulContent(eventDraft)) {
      eventDraft.note = [eventDraft.note, `Original date value: ${normalizeCell(rawDate)}`]
        .filter(Boolean)
        .join(' | ');
      warnings.push({
        rowIndex,
        reason: `Invalid date value "${normalizeCell(rawDate)}" was preserved as note.`
      });
    }

    if (!hasMeaningfulContent(eventDraft)) {
      skippedRows += 1;
      warnings.push({
        rowIndex,
        reason: 'Empty or malformed row was skipped.'
      });
      return;
    }

    const signature = buildRowSignature(eventDraft);
    if (seenSignatures.has(signature)) {
      skippedRows += 1;
      warnings.push({
        rowIndex,
        reason: 'Duplicated timeline row was skipped.'
      });
      return;
    }
    seenSignatures.add(signature);

    timelineEvents.push({
      timelineEventId: `timeline_${randomUUID()}`,
      columnOrder: eventDraft.columnOrder,
      cells: eventDraft.cells,
      date: eventDraft.date,
      visitNo: eventDraft.visitNo,
      symptom: eventDraft.symptom,
      test: eventDraft.test,
      diagnosis: eventDraft.diagnosis,
      treatment: eventDraft.treatment,
      outcome: eventDraft.outcome,
      note: eventDraft.note,
      source: 'excel_import',
      importedAt: new Date().toISOString(),
      originalRowIndex: rowIndex
    });
  });

  timelineEvents.sort((a, b) => {
    const left = a.date || `zz_${a.originalRowIndex}`;
    const right = b.date || `zz_${b.originalRowIndex}`;
    return left.localeCompare(right);
  });

  return {
    importedRows: timelineEvents.length,
    skippedRows,
    timelineEvents,
    columnMapping,
    detectedColumns: headers.filter(Boolean),
    previewRows,
    warnings
  };
}
