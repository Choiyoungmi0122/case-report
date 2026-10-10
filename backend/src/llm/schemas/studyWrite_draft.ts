import { z } from 'zod';

export const StudyWriteDraftOutputSchema = z.object({
  draftText: z.string(),
  usedQuestionIds: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([])
});

export const StudyWriteReviseOutputSchema = z.object({
  draftText: z.string(),
  changeSummary: z.string(),
  outOfRecordClaims: z.array(z.string()).default([])
});

export const StudyWriteCareCheckOutputSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      status: z.enum(['present', 'in_record_not_in_draft', 'not_in_record', 'not_applicable']),
      hint: z.string().default('')
    })
  )
});

export type StudyWriteDraftOutput = z.infer<typeof StudyWriteDraftOutputSchema>;
export type StudyWriteReviseOutput = z.infer<typeof StudyWriteReviseOutputSchema>;
export type StudyWriteCareCheckOutput = z.infer<typeof StudyWriteCareCheckOutputSchema>;
