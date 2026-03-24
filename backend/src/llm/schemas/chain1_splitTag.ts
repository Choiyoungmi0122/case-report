import { z } from 'zod';
import { CareSectionEnum } from './common';

export const EvidenceCardSchema = z.object({
  id: z.string().uuid(),
  visitIndex: z.number().int().min(1),
  visitDateTime: z.string(),
  normalizedText: z.string(),
  tags: z.array(CareSectionEnum),
  sourceRef: z
    .object({
      charStart: z.number().int().optional(),
      charEnd: z.number().int().optional(),
      lineStart: z.number().int().optional(),
      lineEnd: z.number().int().optional()
    })
    .optional(),
  confidence: z.number().min(0).max(1)
});

export const Chain1OutputSchema = z.object({
  // LLM이 evidenceCards 키를 누락하는 경우가 있어서, 기본값을 빈 배열로 둔다.
  evidenceCards: z.array(EvidenceCardSchema).default([])
});

export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;

