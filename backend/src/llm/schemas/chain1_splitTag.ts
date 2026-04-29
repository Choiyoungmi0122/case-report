import { z } from 'zod';
import { CareSectionEnum } from './common';

export const EvidenceCardSchema = z.object({
  id: z.string().min(1),
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
  // Keep a stable default in case the model omits the array.
  evidenceCards: z.array(EvidenceCardSchema).default([])
});

export type EvidenceCard = z.infer<typeof EvidenceCardSchema>;
