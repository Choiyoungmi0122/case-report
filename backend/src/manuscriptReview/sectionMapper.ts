import { ImportedDocumentBlock } from './types';
import {
  ManuscriptReviewSectionId,
  ManuscriptSectionCandidate,
  MANUSCRIPT_REVIEW_SECTION_IDS
} from './types';

const SECTION_PATTERNS: Record<ManuscriptReviewSectionId, string[]> = {
  TITLE: ['title', '제목'],
  KEYWORDS: ['keywords', 'keyword', 'key words', '키워드', '주요어'],
  ABSTRACT: ['abstract', '초록', '요약'],
  INTRODUCTION: ['introduction', 'background', '서론', '배경'],
  PATIENT_INFORMATION: ['patient information', 'case presentation', 'case', '환자 정보', '증례'],
  CLINICAL_FINDINGS: ['clinical findings', 'clinical features', '임상 소견', '진찰 소견'],
  TIMELINE: ['timeline', '타임라인'],
  DIAGNOSTIC_ASSESSMENT: ['diagnostic assessment', 'diagnosis', 'assessment', '진단 평가', '진단'],
  THERAPEUTIC_INTERVENTIONS: ['therapeutic interventions', 'intervention', 'treatment', 'management', '치료', '중재'],
  FOLLOW_UP_OUTCOMES: ['follow-up', 'follow up', 'outcomes', 'outcome', 'results', '추적', '결과', '경과'],
  DISCUSSION_CONCLUSION: ['discussion', 'conclusion', '고찰', '논의', '토론', '결론'],
  PATIENT_PERSPECTIVE: ['patient perspective', '환자 관점'],
  INFORMED_CONSENT: ['informed consent', 'consent', '동의']
};

type RankedSection = {
  sectionId: ManuscriptReviewSectionId;
  confidence: number;
};

type HeadingGroup = {
  heading: ImportedDocumentBlock;
  content: ImportedDocumentBlock[];
};

function normalizeLookup(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .trim();
}

function rankSectionsByHeading(text: string): RankedSection[] {
  const normalized = normalizeLookup(text);
  if (!normalized) return [];

  return MANUSCRIPT_REVIEW_SECTION_IDS.map((sectionId) => {
    const patterns = SECTION_PATTERNS[sectionId];
    let confidence = 0;

    for (const pattern of patterns) {
      const normalizedPattern = normalizeLookup(pattern);
      if (!normalizedPattern) continue;
      if (normalized === normalizedPattern) {
        confidence = Math.max(confidence, 0.98);
      } else if (normalized.includes(normalizedPattern)) {
        confidence = Math.max(confidence, 0.9);
      } else if (normalizedPattern.includes(normalized)) {
        confidence = Math.max(confidence, 0.74);
      }
    }

    return {
      sectionId,
      confidence: Number(confidence.toFixed(3))
    };
  })
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);
}

function buildHeadingGroups(blocks: ImportedDocumentBlock[]): HeadingGroup[] {
  const groups: HeadingGroup[] = [];
  let current: HeadingGroup | null = null;

  for (const block of blocks) {
    if (block.blockType === 'heading') {
      if (current) groups.push(current);
      current = { heading: block, content: [] };
      continue;
    }

    if (current) {
      current.content.push(block);
    }
  }

  if (current) groups.push(current);
  return groups;
}

function createTitleCandidate(blocks: ImportedDocumentBlock[]): ManuscriptSectionCandidate | null {
  const first = blocks.find((block) => block.text.trim().length > 0);
  if (!first || first.text.length > 240) return null;

  return {
    candidateId: 'cand_title_1',
    blockIds: [first.blockId],
    headingText: first.blockType === 'heading' ? first.text : undefined,
    detectedText: first.text,
    matchedSection: 'TITLE',
    confidence: 0.99,
    matchBasis: 'fallback',
    needsUserConfirmation: false,
    candidateSections: ['TITLE'],
    status: 'CONFIRMED',
    confirmedSection: 'TITLE'
  };
}

export function mapBlocksToSectionCandidates(blocks: ImportedDocumentBlock[]): ManuscriptSectionCandidate[] {
  const candidates: ManuscriptSectionCandidate[] = [];
  const titleCandidate = createTitleCandidate(blocks);
  if (titleCandidate) {
    candidates.push(titleCandidate);
  }

  const groups = buildHeadingGroups(blocks);

  groups.forEach((group, index) => {
    const ranked = rankSectionsByHeading(group.heading.text);
    const top = ranked[0];
    const second = ranked[1];
    const detectedText = (group.content.length > 0 ? group.content : [group.heading])
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n\n');
    const candidateSections = ranked.slice(0, 3).map((item) => item.sectionId);
    const isAmbiguous =
      !top ||
      top.confidence < 0.78 ||
      (second && Math.abs(top.confidence - second.confidence) < 0.15);

    candidates.push({
      candidateId: `cand_${index + 1}`,
      blockIds: [group.heading.blockId, ...group.content.map((block) => block.blockId)],
      headingText: group.heading.text,
      detectedText,
      matchedSection: isAmbiguous ? top?.sectionId || null : top.sectionId,
      confidence: top?.confidence || 0,
      matchBasis: top ? 'heading' : 'keyword',
      needsUserConfirmation: Boolean(isAmbiguous),
      candidateSections,
      status: isAmbiguous ? 'PENDING' : 'CONFIRMED',
      confirmedSection: isAmbiguous ? undefined : top.sectionId
    });
  });

  return candidates;
}

export function buildSectionTextsBySection(
  candidates: ManuscriptSectionCandidate[]
): Partial<Record<ManuscriptReviewSectionId, string>> {
  const sectionTexts: Partial<Record<ManuscriptReviewSectionId, string[]>> = {};

  for (const candidate of candidates) {
    if (candidate.status !== 'CONFIRMED') continue;
    const sectionId = candidate.confirmedSection || candidate.matchedSection;
    if (!sectionId) continue;
    if (!sectionTexts[sectionId]) {
      sectionTexts[sectionId] = [];
    }
    sectionTexts[sectionId]!.push(candidate.detectedText.trim());
  }

  return Object.fromEntries(
    Object.entries(sectionTexts)
      .map(([sectionId, texts]) => [sectionId, texts.filter(Boolean).join('\n\n')])
      .filter(([, text]) => String(text || '').trim().length > 0)
  ) as Partial<Record<ManuscriptReviewSectionId, string>>;
}
