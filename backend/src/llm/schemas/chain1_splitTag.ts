import { z } from 'zod';
import { CareSectionCoerced, CareSectionHintList } from './common';
import { TermNormalizationResultSchema } from '../../rag/types';

const IgnoredChain1TermsSchema = z
  .unknown()
  .optional()
  .transform(() => [] as z.infer<typeof TermNormalizationResultSchema>[]);

export const EvidenceCardSchema = z.object({
  id: z.string().min(1),
  visitIndex: z.number().int().min(1),
  visitDateTime: z.string(),
  sourceText: z.string().default(''),
  normalizedText: z.string().default(''),
  evidenceType: z.string().default('other'),
  tags: z.array(CareSectionCoerced).default([]),
  // Advisory only: an unrecognised hint is dropped rather than failing the
  // whole extraction (which previously surfaced as a 500 on process).
  sectionHints: CareSectionHintList,
  // Chain1 occasionally returns plain strings here, but downstream logic
  // or partial objects here; downstream logic recomputes authoritative
  // term normalization from grounded source text, so we ignore model-provided
  // terms entirely and normalize them later.
  terms: IgnoredChain1TermsSchema,
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
