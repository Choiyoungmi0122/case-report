import { seedTermDb } from '../rag/termDb';

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set((items || []).map((item) => String(item || '').trim()).filter(Boolean)));
}

export const defaultPreserveTerms = uniqueStrings(
  seedTermDb.flatMap((entry) => [
    entry.standardTerm,
    ...entry.synonyms,
    ...entry.typoVariants,
    ...entry.aliases
  ])
);
