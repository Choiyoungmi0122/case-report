export type ExportMode =
  | 'current_section_drafts'
  | 'final_manuscript'
  | 'final_manuscript_with_checklist'
  | 'final_manuscript_with_traceability'
  | 'scaffold_review';

export type ExportLayout = 'one_paragraph' | 'two_paragraph';

export interface TimelineTableData {
  headers: string[];
  rows: string[][];
}

export interface TraceabilityAppendixRow {
  sectionId: string;
  sentence: string;
  evidenceIds: string[];
  normalizedTerms: string[];
}

export interface ExportOptions {
  mode: ExportMode;
  layout?: ExportLayout;
}
