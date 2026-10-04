export type TimelineEventSource = 'excel_import';

export interface TimelineEvent {
  timelineEventId: string;
  columnOrder?: string[];
  cells?: Record<string, string>;
  date?: string;
  visitNo?: string;
  symptom?: string;
  test?: string;
  diagnosis?: string;
  treatment?: string;
  outcome?: string;
  note?: string;
  source: TimelineEventSource;
  importedAt: string;
  originalRowIndex: number;
}

export interface TimelineColumnMapping {
  date?: string;
  visitNo?: string;
  symptom?: string;
  test?: string;
  diagnosis?: string;
  treatment?: string;
  outcome?: string;
  note?: string;
}

export interface TimelineImportPreviewRow {
  originalRowIndex: number;
  values: Record<string, string>;
}

export interface TimelineImportWarning {
  rowIndex: number;
  reason: string;
}

export interface TimelineImportResult {
  importedRows: number;
  skippedRows: number;
  timelineEvents: TimelineEvent[];
  columnMapping: TimelineColumnMapping;
  detectedColumns: string[];
  previewRows: TimelineImportPreviewRow[];
  warnings: TimelineImportWarning[];
}
