import { terminologyEntries, terminologyValidationIssues } from './loader';
import { TermDbEntry } from './types';

export const seedTermDb: TermDbEntry[] = terminologyEntries;
export const termDbValidationIssues = terminologyValidationIssues;
