import { z } from 'zod';

/** SW-V1: 섹션 하나를 기록·답과 대조 */
export const StudyWriteVerifySectionOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        type: z.enum(['contradicted', 'misread', 'unsupported', 'wrong_speaker', 'wrong_timing']),
        excerpt: z.string(),
        evidence: z.string().optional().default(''),
        explanation: z.string().optional().default(''),
        suggestion: z.string().optional().default('')
      })
    )
    .default([])
});

/** SW-V2: 섹션 사이 불일치 */
export const StudyWriteVerifyCrossOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        sectionA: z.string(),
        excerptA: z.string(),
        sectionB: z.string(),
        excerptB: z.string(),
        explanation: z.string().optional().default(''),
        suggestion: z.string().optional().default('')
      })
    )
    .default([])
});

/** SW-V3: "근거 없음" 지적의 근거 다시 찾기 */
export const StudyWriteVerifyEvidenceOutputSchema = z.object({
  found: z.boolean(),
  quote: z.string().optional().default(''),
  where: z.string().optional().default(''),
  missing: z.string().optional().default('')
});

export type StudyWriteVerifySectionOutput = z.infer<typeof StudyWriteVerifySectionOutputSchema>;
export type StudyWriteVerifyCrossOutput = z.infer<typeof StudyWriteVerifyCrossOutputSchema>;
