import { z } from 'zod';

export const PHITypeEnum = z.enum([
  'PATIENT_NAME',
  'DOCTOR_NAME',
  'HOSPITAL',
  'PHONE',
  'ADDRESS',
  'PATIENT_ID',
  'RESIDENT_ID',
  'DATE',
  'EMAIL',
  'OTHER'
]);

export const RiskLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const PHISpanSchema = z.object({
  type: PHITypeEnum,
  originalText: z.string(),
  replacement: z.string(),
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(0),
  confidence: z.number().min(0).max(1)
});

export const ReplacementMapSchema = z.object({
  type: PHITypeEnum,
  originalText: z.string(),
  replacement: z.string(),
  occurrences: z.number().int().min(1)
});

export const DeidentifiedEMRSchema = z.object({
  emrId: z.string(),
  originalTextStoredLocalOnly: z.boolean(),
  deidentifiedText: z.string(),
  phiSpans: z.array(PHISpanSchema),
  replacementMap: z.array(ReplacementMapSchema),
  riskLevel: RiskLevelEnum
});

export type PHIType = z.infer<typeof PHITypeEnum>;
export type RiskLevel = z.infer<typeof RiskLevelEnum>;
export type PHISpan = z.infer<typeof PHISpanSchema>;
export type ReplacementMap = z.infer<typeof ReplacementMapSchema>;
export type DeidentifiedEMR = z.infer<typeof DeidentifiedEMRSchema>;

export interface DeidReplacementContext {
  replacementByKey: Map<string, string>;
  occurrenceByKey: Map<string, number>;
  countByType: Map<PHIType, number>;
}

export interface LocalEntityProvider {
  detect(text: string, preserveTerms: string[]): Promise<PHISpan[]> | PHISpan[];
}

/** An identifier already confirmed elsewhere in the same case. */
export interface KnownIdentifier {
  type: PHIType;
  text: string;
}

export interface DeidOptions {
  emrId?: string;
  preserveTerms?: string[];
  entityProvider?: LocalEntityProvider;
  /** KEEP: 날짜를 가리지 않는다 (실험용 Write — 증례보고의 날짜는 임상 정보로 본다) */
  dateMode?: 'PLACEHOLDER' | 'RELATIVE_PLACEHOLDER' | 'KEEP';
  /**
   * Export rechecks skip the broad surname-shaped name rule because pipeline
   * output is already de-identified and ordinary words can match that rule.
   * anonymized_record: 참여자가 이미 이름을 지운 기록(실험용 Write). 표지가 분명한
   * 이름 규칙만 쓴다 (rules.ts PATIENT_NAME_REGEXES_ANONYMIZED_RECORD).
   */
  detectionProfile?: 'full' | 'research_export' | 'anonymized_record';
  sharedContext?: DeidReplacementContext;
  /**
   * Identifiers confirmed in OTHER visits of the same case. A follow-up note
   * usually mentions the patient without any contextual marker ("홍길동에게
   * 운동을 교육하였다"), which the per-visit rules cannot match on their own.
   */
  knownIdentifiers?: KnownIdentifier[];
}
