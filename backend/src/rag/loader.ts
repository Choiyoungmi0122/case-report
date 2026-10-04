import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { normalizeUnicodeText } from '../utils/unicode';
import { NormalizationPolicy, TermDbEntry, TermDbEntrySchema } from './types';

const TerminologyFileSchema = z.array(TermDbEntrySchema);
const SUPPORTED_POLICIES = new Set<NormalizationPolicy>([
  'AUTO_NORMALIZE',
  'REQUIRE_CONFIRMATION',
  'PRESERVE_ORIGINAL'
]);

export type TerminologyValidationIssue = {
  severity: 'error' | 'warning';
  code:
    | 'DUPLICATE_TERM_ID'
    | 'EMPTY_STANDARD_TERM'
    | 'MALFORMED_ENTRY'
    | 'UNSUPPORTED_NORMALIZATION_POLICY'
    | 'DUPLICATED_VARIANT'
    | 'ALIAS_COLLISION'
    | 'NORMALIZED_ALIAS_COLLISION';
  message: string;
  termId?: string;
  variant?: string;
  collidesWith?: string;
};

export type LoadedTerminology = {
  entries: TermDbEntry[];
  rawText: string;
  dataHash: string;
  filePath: string;
  validation: {
    issues: TerminologyValidationIssue[];
    hasErrors: boolean;
  };
};

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '')).filter(Boolean)));
}

function normalizeLookupValue(text: string): string {
  return normalizeUnicodeText(text)
    .toLowerCase()
    .replace(/[\s\-_/\\.,:;'"!?()[\]{}]/g, '');
}

function buildVariantEntries(entry: TermDbEntry): Array<{ variant: string; kind: string }> {
  return [
    { variant: entry.standardTerm, kind: 'standardTerm' },
    ...entry.synonyms.map((variant) => ({ variant, kind: 'synonym' })),
    ...entry.typoVariants.map((variant) => ({ variant, kind: 'typoVariant' })),
    ...entry.aliases.map((variant) => ({ variant, kind: 'alias' }))
  ];
}

export function getTerminologyJsonPath(): string {
  return path.resolve(__dirname, '../../data/terminology/terminology.json');
}

export function validateTerminologyEntries(entries: TermDbEntry[]): TerminologyValidationIssue[] {
  const issues: TerminologyValidationIssue[] = [];
  const seenTermIds = new Set<string>();
  const variantOwners = new Map<string, { termId: string; kind: string }>();
  const normalizedVariantOwners = new Map<string, { termId: string; kind: string }>();

  for (const entry of entries) {
    if (seenTermIds.has(entry.termId)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_TERM_ID',
        termId: entry.termId,
        message: `Duplicate termId detected: ${entry.termId}`
      });
    }
    seenTermIds.add(entry.termId);

    if (!String(entry.standardTerm || '').trim()) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_STANDARD_TERM',
        termId: entry.termId,
        message: `Entry ${entry.termId} has an empty standardTerm.`
      });
    }

    if (!SUPPORTED_POLICIES.has(entry.normalizationPolicy)) {
      issues.push({
        severity: 'error',
        code: 'UNSUPPORTED_NORMALIZATION_POLICY',
        termId: entry.termId,
        message: `Entry ${entry.termId} uses unsupported normalizationPolicy: ${entry.normalizationPolicy}`
      });
    }

    const seenVariants = new Map<string, string>();
    for (const variantEntry of buildVariantEntries(entry)) {
      const trimmed = String(variantEntry.variant || '').trim();
      if (!trimmed) continue;
      const normalized = normalizeLookupValue(trimmed);
      const duplicateKind = seenVariants.get(normalized);
      if (duplicateKind) {
        issues.push({
          severity: 'warning',
          code: 'DUPLICATED_VARIANT',
          termId: entry.termId,
          variant: trimmed,
          message: `Entry ${entry.termId} contains a duplicated variant (${duplicateKind} vs ${variantEntry.kind}): ${trimmed}`
        });
      } else {
        seenVariants.set(normalized, variantEntry.kind);
      }
    }

    for (const variantEntry of buildVariantEntries(entry)) {
      const variant = String(variantEntry.variant || '').trim();
      if (!variant) continue;

      const exactCollision = variantOwners.get(variant);
      if (
        exactCollision &&
        exactCollision.termId !== entry.termId &&
        (variantEntry.kind === 'alias' || exactCollision.kind === 'alias')
      ) {
        issues.push({
          severity: 'warning',
          code: 'ALIAS_COLLISION',
          termId: entry.termId,
          collidesWith: exactCollision.termId,
          variant,
          message: `Alias collision detected for "${variant}" between ${exactCollision.termId} (${exactCollision.kind}) and ${entry.termId} (alias)`
        });
      }

      const normalized = normalizeLookupValue(variant);
      const normalizedCollision = normalizedVariantOwners.get(normalized);
      if (
        normalizedCollision &&
        normalizedCollision.termId !== entry.termId &&
        (variantEntry.kind === 'alias' || normalizedCollision.kind === 'alias')
      ) {
        issues.push({
          severity: 'warning',
          code: 'NORMALIZED_ALIAS_COLLISION',
          termId: entry.termId,
          collidesWith: normalizedCollision.termId,
          variant,
          message: `Normalized alias collision detected for "${variant}" between ${normalizedCollision.termId} (${normalizedCollision.kind}) and ${entry.termId} (alias)`
        });
      }

      if (!variantOwners.has(variant)) {
        variantOwners.set(variant, { termId: entry.termId, kind: variantEntry.kind });
      }
      if (!normalizedVariantOwners.has(normalized)) {
        normalizedVariantOwners.set(normalized, { termId: entry.termId, kind: variantEntry.kind });
      }
    }
  }

  return issues;
}

export function loadTerminologyEntries(filePath = getTerminologyJsonPath()): LoadedTerminology {
  const rawText = fs.readFileSync(filePath, 'utf8');
  const dataHash = crypto.createHash('sha256').update(rawText).digest('hex');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return {
      entries: [],
      rawText,
      dataHash,
      filePath,
      validation: {
        issues: [
          {
            severity: 'error',
            code: 'MALFORMED_ENTRY',
            message: `Failed to parse terminology JSON: ${(error as Error).message}`
          }
        ],
        hasErrors: true
      }
    };
  }

  const schemaResult = TerminologyFileSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      entries: [],
      rawText,
      dataHash,
      filePath,
      validation: {
        issues: schemaResult.error.issues.map((issue) => ({
          severity: 'error',
          code: 'MALFORMED_ENTRY',
          message: `${issue.path.join('.') || 'entry'}: ${issue.message}`
        })),
        hasErrors: true
      }
    };
  }

  const entries = schemaResult.data;
  const issues = validateTerminologyEntries(entries);
  return {
    entries,
    rawText,
    dataHash,
    filePath,
    validation: {
      issues,
      hasErrors: issues.some((issue) => issue.severity === 'error')
    }
  };
}

const loaded = loadTerminologyEntries();

export const loadedTerminology = loaded;
export const terminologyEntries = loaded.entries;
export const terminologyDataHash = loaded.dataHash;
export const terminologyValidationIssues = loaded.validation.issues;
