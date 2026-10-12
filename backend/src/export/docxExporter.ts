import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import { renderClinicalAnonymizedText } from '../deid/publicationRenderer';
import { isStudyScaffoldV2Case } from '../config/researchMetadata';
import { DEFAULT_STUDY_CARE_ELEMENT_MAP, isFixedStudyCaseText } from '../study/cases/defaultStudyCase';
import { WRITE_ONLY_SECTION_IDS } from '../utils/scaffoldProgress';
import { Case, CareSection, SectionEvidenceLink, UnsupportedClaim } from '../types';
import { normalizeUnicodeText, normalizeUnicodeWhitespace } from '../utils/unicode';
import { ExportLayout, ExportMode, TimelineTableData, TraceabilityAppendixRow } from './types';

const DOCX_FONT = {
  ascii: 'Malgun Gothic',
  hAnsi: 'Malgun Gothic',
  eastAsia: 'Malgun Gothic',
  cs: 'Malgun Gothic'
} as const;

const EMPTY_SECTION_PLACEHOLDER = 'No content available yet.';
const BODY_FONT_SIZE = 22;
const SECTION_HEADING_SIZE = 24;
const TITLE_FONT_SIZE = 32;

const SECTION_LABELS: Record<string, string> = {
  TITLE: 'Title',
  KEYWORDS: 'Keywords',
  ABSTRACT: 'Abstract',
  INTRODUCTION: 'Introduction',
  PATIENT_INFORMATION: 'Patient Information',
  CLINICAL_FINDINGS: 'Clinical Findings',
  TIMELINE: 'Timeline',
  DIAGNOSTIC_ASSESSMENT: 'Diagnostic Assessment',
  THERAPEUTIC_INTERVENTIONS: 'Therapeutic Interventions',
  FOLLOW_UP_OUTCOMES: 'Follow-up and Outcomes',
  DISCUSSION_CONCLUSION: 'Discussion',
  PATIENT_PERSPECTIVE: 'Patient Perspective',
  INFORMED_CONSENT: 'Informed Consent'
};

const DOCUMENT_SECTION_ORDER = [
  'TITLE',
  'KEYWORDS',
  'ABSTRACT',
  'INTRODUCTION',
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT'
] as const;

/**
 * Every string that reaches the .docx passes through here, which makes this the
 * one place the publication renderer has to be applied. Internal privacy tokens
 * such as `[PATIENT_NAME_1]` are machinery for the AI pipeline and must never
 * appear in an exported manuscript.
 */
function makeTextRun(text: string, options: Record<string, unknown> = {}) {
  return new TextRun({
    text: normalizeUnicodeText(renderClinicalAnonymizedText(text)),
    font: DOCX_FONT,
    color: '000000',
    size: BODY_FONT_SIZE,
    ...options
  });
}

function sectionLabel(sectionId: string) {
  return SECTION_LABELS[sectionId] || sectionId;
}

function safeText(value: unknown) {
  return normalizeUnicodeWhitespace(value);
}

function makeBodyParagraph(text: string, options: Record<string, any> = {}) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 160, line: 320 },
    children: [makeTextRun(text)],
    ...options
  });
}

function makeSectionHeading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 260, after: 140 },
    children: [makeTextRun(text, { bold: true, size: SECTION_HEADING_SIZE, color: '000000' })]
  });
}

function buildParagraphsFromText(text: string) {
  const normalized = safeText(text);
  if (!normalized) {
    return [
      makeBodyParagraph(EMPTY_SECTION_PLACEHOLDER, {
        children: [makeTextRun(EMPTY_SECTION_PLACEHOLDER, { italics: true, color: '64748B' })]
      })
    ];
  }

  return normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => makeBodyParagraph(chunk));
}

function makeHeaderCell(text: string) {
  return new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 280 },
        children: [makeTextRun(text, { bold: true })]
      })
    ],
    shading: { fill: 'E8EEF9' }
  });
}

function makeBodyCell(text: string) {
  return new TableCell({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [makeTextRun(text || '-')],
        spacing: { after: 0, line: 280 }
      })
    ]
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' }
  };
}

function resolveSectionText(caseData: Case, mode: ExportMode, sectionId: string) {
  const finalSections = (caseData.finalDraft?.fullTextBySection || {}) as Record<string, string>;
  const draftMap = (caseData.draftsBySection || {}) as Record<string, string>;
  const sectionDrafts = caseData.sectionDrafts || [];
  const sectionDraft = sectionDrafts.find((draft) => draft.sectionId === sectionId)?.draftText || '';

  if (mode === 'current_section_drafts') {
    if (sectionId === 'TITLE') {
      return safeText(caseData.title || draftMap.TITLE || caseData.finalDraft?.titleSuggestions?.[0] || '');
    }
    if (sectionId === 'KEYWORDS') {
      return safeText(draftMap.KEYWORDS || '');
    }
    if (sectionId === 'ABSTRACT') {
      return safeText(draftMap.ABSTRACT || caseData.finalDraft?.abstractSuggestion || '');
    }
    return safeText(sectionDraft || draftMap[sectionId] || '');
  }

  if (sectionId === 'TITLE') {
    return safeText(caseData.title || finalSections.TITLE || caseData.finalDraft?.titleSuggestions?.[0] || '');
  }
  if (sectionId === 'KEYWORDS') {
    return safeText(draftMap.KEYWORDS || finalSections.KEYWORDS || '');
  }
  if (sectionId === 'ABSTRACT') {
    return safeText(finalSections.ABSTRACT || caseData.finalDraft?.abstractSuggestion || '');
  }

  return safeText(finalSections[sectionId] || sectionDraft || draftMap[sectionId] || '');
}

function hasMeaningfulNarrativeText(text: string) {
  const normalized = safeText(text);
  if (!normalized) return false;
  const stripped = normalized
    .replace(/가져온 타임라인 데이터/gi, '')
    .replace(/가져온 타임라인/gi, '')
    .replace(/Imported timeline table/gi, '')
    .replace(/Date\s*\|.*$/gim, '')
    .trim();
  return stripped.length > 0;
}

function extractTimepoint(text: string) {
  const normalized = normalizeUnicodeText(text);
  const dateMatch = normalized.match(/(\d{4})[./\-\s년]+(\d{1,2})[./\-\s월]+(\d{1,2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const relativeMatch = normalized.match(/(초진|재진|입원\s*\d+\s*일차|\d+\s*(일|주|개월)\s*(후|째)|치료\s*\d+\s*회차|퇴원\s*후|추적\s*관찰)/i);
  return relativeMatch?.[0]?.replace(/\s+/g, ' ').trim() || '';
}

function pickByKeywords(text: string, keywords: RegExp) {
  const fragments = normalizeUnicodeText(text)
    .split(/[;,]/)
    .map((fragment) => fragment.trim())
    .filter(Boolean)
    .filter((fragment) => keywords.test(fragment));
  return fragments.join('; ');
}

export function buildTimelineTableRows(text: string): TimelineTableData | null {
  const source = safeText(text);
  if (!source) return null;

  const lines = source.includes('\n') ? source.split(/\n+/) : source.split(/(?<=[.!?])\s+/);
  const rows = lines
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean)
    .map((line) => [
      extractTimepoint(line) || '-',
      (
        pickByKeywords(line, /(증상|통증|불면|불안|상열감|가슴 답답함|수면 장애|피로|호전|악화|개선|감소|증가)/i) ||
        normalizeUnicodeText(line)
      ),
      pickByKeywords(line, /(검사|평가|MRI|CT|X-ray|PHQ|GAD|ISI|BDI|VAS|NRS|점수|결과)/i) || '-',
      pickByKeywords(line, /(치료|복용|투여|처방|침|뜸|부항|교육|상담|약침)/i) || '-',
      pickByKeywords(line, /(호전|개선|악화|유지|경과|반응|부작용|이상반응|추적|감소|증가|회복)/i) || '-'
    ])
    .filter((row) => row.some((value) => value && value !== '-'));

  return rows.length >= 2
    ? {
        headers: ['시점', '증상', '검사', '치료', '경과'],
        rows
      }
    : null;
}

export function buildTimelineTableRowsFromEvents(events: Case['timelineEvents'] | undefined): TimelineTableData | null {
  const source = (events || []).filter(Boolean);
  if (source.length === 0) return null;

  const dynamicHeaders =
    source.find((event) => Array.isArray(event?.columnOrder) && event.columnOrder.length > 0)?.columnOrder || [];

  if (dynamicHeaders.length > 0) {
    return {
      headers: dynamicHeaders,
      rows: source.map((event) =>
        dynamicHeaders.map((header) => safeText(event?.cells?.[header]) || '-')
      )
    };
  }

  return {
    headers: ['시점', '증상', '검사', '치료', '경과'],
    rows: source.map((event) => {
      const outcomeParts = [safeText(event?.diagnosis), safeText(event?.outcome), safeText(event?.note)].filter(Boolean);
      return [
        safeText(event?.date || event?.visitNo) || '-',
        safeText(event?.symptom) || '-',
        safeText(event?.test) || '-',
        safeText(event?.treatment) || '-',
        outcomeParts.join(' | ') || '-'
      ];
    })
  };
}

function buildTimelineTable(tableData: TimelineTableData | null) {
  if (!tableData || tableData.rows.length === 0) return null;

  const columnWidths = new Array(tableData.headers.length).fill(Math.floor(9000 / Math.max(1, tableData.headers.length)));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths,
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: tableData.headers.map((header) => makeHeaderCell(header))
      }),
      ...tableData.rows.map(
        (row) =>
          new TableRow({
            children: row.map((value) => makeBodyCell(value))
          })
      )
    ]
  });
}

function buildChecklistAppendix(caseData: Case) {
  const evaluation = caseData.finalDraft?.careChecklistEvaluation || {};

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [makeHeaderCell('CARE Section'), makeHeaderCell('Status'), makeHeaderCell('Rationale')]
      }),
      ...DOCUMENT_SECTION_ORDER.map((sectionId) => {
        const entry = evaluation[sectionId] || {};
        return new TableRow({
          children: [
            makeBodyCell(sectionLabel(sectionId)),
            makeBodyCell(entry.status || 'NOT_EVALUATED'),
            makeBodyCell(entry.rationale || EMPTY_SECTION_PLACEHOLDER)
          ]
        });
      })
    ]
  });
}

function collectNormalizedTerms(caseData: Case, evidenceIds: string[]) {
  const evidenceById = new Map((caseData.evidenceCards || []).map((card) => [card.id, card]));
  const terms = new Set<string>();

  for (const evidenceId of evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    for (const term of evidence?.terms || []) {
      const label = safeText(term.normalizedTerm || term.surface);
      if (label) terms.add(label);
    }
  }

  return Array.from(terms);
}

function buildTraceabilityRows(caseData: Case): TraceabilityAppendixRow[] {
  const sectionDraftTraceability = new Map((caseData.sectionDrafts || []).map((draft) => [draft.sectionId, draft]));
  const finalTraceability = caseData.finalDraft?.sectionTraceability || {};
  const rows: TraceabilityAppendixRow[] = [];

  for (const sectionId of DOCUMENT_SECTION_ORDER) {
    if (['TITLE', 'KEYWORDS', 'ABSTRACT', 'INTRODUCTION'].includes(sectionId)) continue;

    const source = finalTraceability[sectionId] || sectionDraftTraceability.get(sectionId as CareSection);
    const evidenceLinks = (source?.evidenceLinks || []) as SectionEvidenceLink[];
    const unsupportedClaims = (source?.unsupportedClaims || []) as UnsupportedClaim[];

    for (const link of evidenceLinks) {
      rows.push({
        sectionId,
        sentence: normalizeUnicodeText(link.sentence),
        evidenceIds: link.evidenceCardIds || [],
        normalizedTerms: collectNormalizedTerms(caseData, link.evidenceCardIds || [])
      });
    }

    for (const claim of unsupportedClaims) {
      rows.push({
        sectionId,
        sentence: `${normalizeUnicodeText(claim.sentence)} [Unsupported: ${normalizeUnicodeText(claim.reason)}]`,
        evidenceIds: [],
        normalizedTerms: []
      });
    }
  }

  return rows;
}

function buildTraceabilityAppendix(caseData: Case) {
  const rows = buildTraceabilityRows(caseData);
  if (rows.length === 0) {
    return [new Paragraph({ children: [makeTextRun(EMPTY_SECTION_PLACEHOLDER)] })];
  }

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders(),
      rows: [
        new TableRow({
          children: [
            makeHeaderCell('Section'),
            makeHeaderCell('Draft sentence'),
            makeHeaderCell('Linked evidence ids'),
            makeHeaderCell('Normalized terms')
          ]
        }),
        ...rows.map(
          (row) =>
            new TableRow({
              children: [
                makeBodyCell(sectionLabel(row.sectionId)),
                makeBodyCell(row.sentence),
                makeBodyCell(row.evidenceIds.join(', ') || '-'),
                makeBodyCell(row.normalizedTerms.join(', ') || '-')
              ]
            })
        )
      ]
    })
  ];
}

function buildFileName(caseData: Case, mode: ExportMode, layout: ExportLayout) {
  const title = safeText(caseData.title || caseData.finalDraft?.titleSuggestions?.[0] || 'case-report');
  const slug = normalizeUnicodeText(title)
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '_')
    .trim();
  return `${slug || 'case-report'}_${mode}_${layout}.docx`;
}

function buildBulletParagraph(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 120, line: 300 },
    children: [makeTextRun(text)]
  });
}

const SCAFFOLD_SECTION_LABELS_KO: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '경과 기록',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 관찰 및 결과',
  DISCUSSION_CONCLUSION: '고찰',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '환자 동의'
};

const SCAFFOLD_JUDGMENT_LABELS_KO: Record<string, string> = {
  supported_by_record: '기록 근거 충분',
  differs_from_record: '기록과 다름',
  want_to_add: '내 초안에 더하고 싶음',
  needs_additional_confirmation: '기록만으로 확인하기 어려움',
  needs_instructor_review: '교수님께 확인',
  uncertain: '판단 어려움',
  available_in_record: '기록에서 확인 가능',
  unavailable: '현재 기록으로 확인할 수 없음',
  pending: '판단 보류'
};

function scaffoldSectionLabelKo(sectionId: string) {
  return SCAFFOLD_SECTION_LABELS_KO[sectionId] || sectionLabel(sectionId);
}

function scaffoldJudgmentLabelKo(judgment: string) {
  return SCAFFOLD_JUDGMENT_LABELS_KO[judgment] || judgment || '-';
}

function makeSubHeading(text: string) {
  return new Paragraph({
    spacing: { before: 200, after: 100, line: 320 },
    children: [makeTextRun(text, { bold: true })]
  });
}

function makeCommentBox(label: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({ children: [makeHeaderCell(label)] }),
      new TableRow({ children: [makeBodyCell(' '), ] }),
      new TableRow({ children: [makeBodyCell(' '), ] })
    ]
  });
}

/**
 * Learner-facing record, organised per CARE section the learner actually worked
 * on: what they wrote before the AI draft, the AI sentences next to their own
 * judgment and reason, what changed, and what to ask the instructor. Sections
 * the learner never opened are left out so an instructor can read it top-down.
 */
function buildScaffoldSummaryChildren(caseData: Case) {
  const scaffoldState: any = caseData.scaffoldState || {};
  const sectionStates: any[] = caseData.sectionStates || [];
  const sectionDrafts: any[] = caseData.sectionDrafts || [];
  const evidenceCards: any[] = caseData.evidenceCards || [];
  const reviewItems: any[] = scaffoldState.reviewItems || [];
  const snapshots: any[] = scaffoldState.preRevealSnapshots || [];
  const reflections: any[] = scaffoldState.sectionReflections || [];
  const progressItems: any[] = scaffoldState.sectionProgress || [];
  const caseNotes: any[] = scaffoldState.caseMap?.caseNotes || [];
  const evidenceTextById = new Map<string, string>(
    evidenceCards.map((card: any) => [String(card.id), safeText(card.sourceText || card.normalizedText || '')])
  );
  const reviewItemById = new Map<string, any>(reviewItems.map((item: any) => [item.id, item]));

  const orderedSectionIds: string[] = sectionStates.map((item: any) => item.sectionId);
  const workedSectionIds = orderedSectionIds.filter((sectionId) => {
    const progress = progressItems.find((item: any) => item.sectionId === sectionId);
    return (
      Boolean(progress?.recordReviewCompleted || progress?.draftRevealed) ||
      snapshots.some((item: any) => item.sectionId === sectionId) ||
      reviewItems.some((item: any) => item.sectionId === sectionId)
    );
  });
  const completedCount = progressItems.filter((item: any) => item.draftReviewCompleted).length;

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: 360 },
      children: [makeTextRun('증례보고 작성 학습 기록', { bold: true, size: TITLE_FONT_SIZE })]
    }),
    makeBodyParagraph(
      '학습자가 AI 초안을 보기 전에 정리한 내용, AI 초안에서 다시 봐야 한다고 표시한 문장과 그 이유, 초안에 빠졌다고 본 내용, AI를 본 뒤 달라진 점을 CARE 항목별로 모은 기록입니다. AI 초안은 최종 원고가 아닙니다.'
    ),
    makeBodyParagraph(`실험번호: ${safeText((caseData as any).experiment_code || '-')}`),
    makeBodyParagraph(`방문 기록: ${(caseData.visits || []).length}회`),
    makeBodyParagraph(`작업한 CARE 항목: ${workedSectionIds.length}개 (완료 ${completedCount}개)`)
  ];

  if (caseNotes.length > 0) {
    children.push(makeSectionHeading('기록을 읽으며 남긴 메모'));
    caseNotes.forEach((note: any) => {
      const label = note.type === 'question' ? '더 확인할 점' : note.type === 'literature' ? '문헌 확인 필요' : '눈에 띈 점';
      // Notes taken over from an AI memo suggestion are marked so they are not
      // read as the learner's own observation.
      const origin = String(note.id || '').startsWith('case-note-ai-') ? ' · AI 추천에서 가져옴' : '';
      children.push(buildBulletParagraph(`[${label}${origin}] ${safeText(note.text)}`));
    });
  }

  if (workedSectionIds.length === 0) {
    children.push(makeSectionHeading('CARE 항목별 기록'));
    children.push(makeBodyParagraph('아직 작업한 CARE 항목이 없습니다.'));
    return children;
  }

  const instructorQuestions: string[] = [];
  const confirmationItems: string[] = [];

  for (const sectionId of workedSectionIds) {
    const label = scaffoldSectionLabelKo(sectionId);
    const snapshot = snapshots.find((item: any) => item.sectionId === sectionId);
    const reflection = reflections.find((item: any) => item.sectionId === sectionId) || {};
    const progress = progressItems.find((item: any) => item.sectionId === sectionId) || {};
    const draft = sectionDrafts.find((item: any) => item.sectionId === sectionId);
    const preAi = snapshot || reflection;

    children.push(makeSectionHeading(label));

    // 1. Before the AI draft
    children.push(makeSubHeading('① AI 초안을 보기 전 내 정리'));
    const selectedEvidence: any[] = preAi.selectedEvidence || [];
    const keyItems: string[] = preAi.learnerKeyInformationItems || preAi.learnerIdentifiedKeyInfo || [];
    const missingItems: string[] = preAi.learnerIdentifiedMissingItems || [];
    const ownDraft = safeText(preAi.learnerNotes);
    if (ownDraft) {
      children.push(makeBodyParagraph('내가 쓴 초안'));
      children.push(...buildParagraphsFromText(ownDraft));
    }
    if (!ownDraft && selectedEvidence.length === 0 && keyItems.length === 0 && missingItems.length === 0) {
      children.push(
        makeBodyParagraph(
          preAi.noRelevantEvidenceConfirmed
            ? '기록에서 이 항목에 쓸 근거를 찾지 못했다고 표시했습니다.'
            : '기록된 정리 내용이 없습니다.'
        )
      );
    }
    if (selectedEvidence.length > 0) {
      children.push(makeBodyParagraph('기록에서 고른 근거'));
      selectedEvidence.forEach((item: any) => {
        children.push(buildBulletParagraph(safeText(item.label || evidenceTextById.get(String(item.id)) || item.id)));
      });
    }
    if (keyItems.length > 0) {
      children.push(makeBodyParagraph('이 항목에 쓸 내용'));
      keyItems.forEach((item) => children.push(buildBulletParagraph(safeText(item))));
    }
    if (missingItems.length > 0) {
      children.push(makeBodyParagraph('기록에 부족하다고 본 내용'));
      missingItems.forEach((item) => children.push(buildBulletParagraph(safeText(item))));
    }
    // 답한 순서가 아니라 질문 순서(ti-001, ti-002 …)로 쓴다. 번호가 없는 항목은 뒤에 둔다.
    const questionOrderKey = (id: unknown) => {
      const match = String(id || '').match(/([a-z]{2})-(\d{3})$/i);
      return match ? `${match[1].toLowerCase()}-${match[2]}` : '~';
    };
    const sufficiencyJudgments: any[] = (snapshot?.reviewItemJudgments || [])
      .filter((item: any) => item.sourceType !== 'draft_sentence')
      .sort((a: any, b: any) => questionOrderKey(a.itemId).localeCompare(questionOrderKey(b.itemId)));
    if (sufficiencyJudgments.length > 0) {
      children.push(makeBodyParagraph('정보가 충분한지에 대한 판단'));
      sufficiencyJudgments.forEach((item: any) => {
        const question = safeText(reviewItemById.get(item.itemId)?.sourceText || '');
        if (!question) return;
        children.push(buildBulletParagraph(`${question} → ${scaffoldJudgmentLabelKo(item.judgment)}`));
        if (item.judgment === 'needs_instructor_review') instructorQuestions.push(`[${label}] ${question}`);
        if (item.judgment === 'needs_additional_confirmation') confirmationItems.push(`[${label}] ${question}`);
      });
    }

    // 2. AI draft and the learner's review of each sentence
    children.push(makeSubHeading('② AI 초안과 비교'));
    if (!progress.draftRevealed) {
      children.push(makeBodyParagraph('아직 AI 초안을 확인하지 않았습니다.'));
    } else {
      // Only the sentences the learner flagged as needing another look.
      const sentenceItems = reviewItems.filter(
        (item: any) =>
          item.sectionId === sectionId &&
          item.sourceType === 'draft_sentence' &&
          item.judgment !== 'supported_by_record' &&
          item.judgment !== 'pending'
      );
      children.push(makeBodyParagraph('AI 초안'));
      children.push(...buildParagraphsFromText(safeText(draft?.draftText) || 'AI 초안이 없습니다.'));
      if (sentenceItems.length === 0) {
        children.push(makeBodyParagraph('다시 볼 문장으로 표시한 것이 없습니다.'));
      } else {
        children.push(makeBodyParagraph(`내가 표시한 문장 ${sentenceItems.length}개`));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders(),
            rows: [
              new TableRow({
                children: [makeHeaderCell('표시한 AI 문장'), makeHeaderCell('종류'), makeHeaderCell('이유와 연결한 기록')]
              }),
              ...sentenceItems.map((item: any) => {
                const linked = (item.evidenceIds || [])
                  .map((id: string) => evidenceTextById.get(String(id)))
                  .filter(Boolean)
                  .map((text: string) => `[기록] ${text}`);
                const reason = [safeText(item.note), ...linked].filter(Boolean).join('\n') || '-';
                if (item.judgment === 'needs_instructor_review') {
                  instructorQuestions.push(`[${label}] ${safeText(item.sourceText)}${item.note ? ` - ${safeText(item.note)}` : ''}`);
                }
                if (item.judgment === 'needs_additional_confirmation' || item.judgment === 'differs_from_record') {
                  confirmationItems.push(`[${label}] ${safeText(item.sourceText)}${item.note ? ` - ${safeText(item.note)}` : ''}`);
                }
                return new TableRow({
                  children: [
                    makeBodyCell(safeText(item.sourceText)),
                    makeBodyCell(scaffoldJudgmentLabelKo(item.judgment)),
                    makeBodyCell(reason)
                  ]
                });
              })
            ]
          })
        );
      }
    }

    // 3. What changed after seeing the AI draft
    // Scaffold V2(v3.0)는 회고 문항의 뜻이 다르다(docs/scaffold_v2_changelog.md D단계). 같은 필드라도 그 버전의 문항으로 적는다.
    const isV2 = isStudyScaffoldV2Case(caseData);
    const postAi = reflection.postAiReflection || {};
    if (progress.draftRevealed) {
      children.push(makeSubHeading(isV2 ? 'AI 초안에서 부족하거나 의심스러운 내용' : 'AI 초안에 빠졌다고 본 내용'));
      children.push(makeBodyParagraph(safeText(postAi.missingInDraft) || '적은 내용이 없습니다.'));
    }
    children.push(makeSubHeading(isV2 ? '③ 내 초안에서 빠졌거나 부족했던 내용' : '③ 내 초안과 AI 초안을 비교해 보니'));
    children.push(makeBodyParagraph(safeText(postAi.changedJudgment) || '기록된 내용이 없습니다.'));
    if (safeText(postAi.unresolvedQuestion)) {
      children.push(makeSubHeading(isV2 ? '④ 교수님이나 전문가에게 확인하고 싶은 것' : '④ 교수님께 확인하고 싶은 것'));
      children.push(makeBodyParagraph(safeText(postAi.unresolvedQuestion)));
      instructorQuestions.push(`[${label}] ${safeText(postAi.unresolvedQuestion)}`);
    }

    children.push(makeBodyParagraph(' '));
    children.push(makeCommentBox(`교수 코멘트 (${label})`));
  }

  children.push(makeSectionHeading('모아 보기: 교수님께 확인할 것'));
  if (instructorQuestions.length === 0) {
    children.push(makeBodyParagraph('표시한 항목이 없습니다.'));
  } else {
    instructorQuestions.forEach((item) => children.push(buildBulletParagraph(item)));
  }

  children.push(makeSectionHeading('모아 보기: 기록과 다르거나 추가 확인이 필요한 것'));
  if (confirmationItems.length === 0) {
    children.push(makeBodyParagraph('표시한 항목이 없습니다.'));
  } else {
    confirmationItems.forEach((item) => children.push(buildBulletParagraph(item)));
  }

  children.push(
    makeBodyParagraph(
      '이 기록은 교육용 자료입니다. AI 초안의 문장은 원기록과 전문가 판단으로 다시 확인한 뒤에 사용해야 합니다.'
    )
  );

  return children;
}

/* ------------------------------------------------------------------------------------------------
 * Scaffold V2 학습 기록 Word (2026-10-12). 화면 frontend/src/components/scaffold/ScaffoldSummaryV2.tsx 와 같은 구조:
 *  한눈에 보기 → 주요 특징 → 1. 기록 읽기 → 2. AI 보기 전 판단 → 3. 내 초안과 AI 초안 → 4. 돌아보기 → 교수 코멘트 → 참고표
 * 저장된 값만 쓴다. 개수만 세고 점수를 매기지 않는다. V1 사례는 buildScaffoldSummaryChildren 을 그대로 쓴다.
 * ---------------------------------------------------------------------------------------------- */

const V2_NOTE_TYPE_LABELS: Record<string, string> = {
  observation: '눈에 띈 점',
  question: '더 확인할 점',
  literature: '문헌 확인 필요'
};
const V2_CARE_ITEM_LABELS: Record<string, string> = {
  '9a': '9a 치료 종류',
  '9b': '9b 용량·기간·빈도',
  '9c': '9c 치료 변경·이유'
};
const V2_SUFFICIENCY_LABELS: Record<string, string> = {
  available_in_record: '기록에서 확인 가능',
  needs_additional_confirmation: '추가 확인 필요',
  needs_instructor_review: '교수자에게 확인 필요',
  unavailable: '현재 기록으로 확인할 수 없음'
};
const V2_FLAG_ORDER = ['differs_from_record', 'needs_additional_confirmation', 'needs_instructor_review', 'want_to_add'];
const V2_SUFFICIENCY_ORDER = ['available_in_record', 'needs_additional_confirmation', 'needs_instructor_review', 'unavailable'];
const V2_FLAG_FILL: Record<string, string> = {
  differs_from_record: 'FECACA',
  needs_additional_confirmation: 'FDE68A',
  needs_instructor_review: 'E9D8FD',
  want_to_add: 'C6F6D5'
};

/** AI 비교 단계 없이 글만 쓰는 "추가 작성" 항목 (utils/scaffoldProgress.ts). */
const V2_WRITE_ONLY_SECTION_IDS = WRITE_ONLY_SECTION_IDS;

const v2NoteTypeLabel = (type: string) => V2_NOTE_TYPE_LABELS[type] || '눈에 띈 점';
const v2SufficiencyLabel = (judgment: string) => V2_SUFFICIENCY_LABELS[judgment] || scaffoldJudgmentLabelKo(judgment);
const v2IsAiNote = (note: any) => note?.origin === 'ai_suggestion' || String(note?.id || '').startsWith('case-note-ai-');

/** 작성 화면(frontend utils/scaffoldUi.ts splitScaffoldDraftSentences)과 같은 문장 나누기. 문장 번호를 맞추려고 쓴다. */
function v2SplitDraftSentences(text: string) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((item) => item.trim())
    .filter(Boolean);
}

const v2SentenceCount = (text: string) =>
  String(text || '')
    .split(/(?<=[.다])\s+/)
    .map((item) => item.trim())
    .filter(Boolean).length;

function v2QuestionOrderKey(id: unknown) {
  const match = String(id || '').match(/([a-z]{2})-(\d{3})$/i);
  return match ? `${match[1].toLowerCase()}-${match[2]}` : '~';
}

function v2Tally(keys: string[]) {
  const map = new Map<string, number>();
  keys.forEach((key) => map.set(key, (map.get(key) || 0) + 1));
  return map;
}

function v2CountParts(entries: Array<[string, number]>, render: (key: string) => string) {
  const parts = entries.filter(([, count]) => count > 0).map(([key, count]) => `${render(key)} ${count}`);
  return parts.length > 0 ? parts.join(' · ') : '없음';
}

/* 가독성(2026-10-12 연구자 의견 "가독성이 너무 안 좋다"): 왼쪽 정렬, 고정 열 너비, 셀 안쪽 여백, 진한 테두리,
 * 제목은 다음 내용과 같은 쪽에, 초안은 나란히가 아니라 전체 폭 상자로 차례로. */
const V2_CONTENT_WIDTH = 9026; // A4 폭에서 좌우 여백 1인치를 뺀 값 (twip)
const V2_CELL_MARGINS = { top: 90, bottom: 90, left: 130, right: 130 };
const V2_TEXT = '1E293B';
const V2_MUTED = '475569';
const V2_HEAD = '1F3A5F';
const V2_CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 6, color: 'B8C4D2' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B8C4D2' },
  left: { style: BorderStyle.SINGLE, size: 6, color: 'B8C4D2' },
  right: { style: BorderStyle.SINGLE, size: 6, color: 'B8C4D2' }
};

function v2Borders(color = '94A3B8') {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color },
    bottom: { style: BorderStyle.SINGLE, size: 4, color },
    left: { style: BorderStyle.SINGLE, size: 4, color },
    right: { style: BorderStyle.SINGLE, size: 4, color },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }
  };
}

function v2Para(text: string, options: { bold?: boolean; color?: string; size?: number; after?: number; keepNext?: boolean } = {}) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    keepNext: options.keepNext,
    spacing: { after: options.after ?? 120, line: 288 },
    children: [makeTextRun(text, { color: options.color || V2_TEXT, bold: options.bold, size: options.size || 21 })]
  });
}

function v2Paragraphs(text: string, size = 21) {
  const chunks = safeText(text)
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  return chunks.length > 0 ? chunks.map((chunk) => v2Para(chunk, { size })) : [v2Para('-', { size })];
}

function v2Bullet(text: string, size = 21) {
  return new Paragraph({
    bullet: { level: 0 },
    alignment: AlignmentType.LEFT,
    spacing: { after: 80, line: 290 },
    children: [makeTextRun(text, { color: V2_TEXT, size })]
  });
}

function v2H1(text: string) {
  return new Paragraph({
    keepNext: true,
    alignment: AlignmentType.LEFT,
    spacing: { before: 420, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: V2_HEAD, space: 4 } },
    children: [makeTextRun(text, { bold: true, size: 28, color: V2_HEAD })]
  });
}

function v2H2(text: string) {
  return new Paragraph({
    keepNext: true,
    alignment: AlignmentType.LEFT,
    spacing: { before: 220, after: 80 },
    children: [makeTextRun(text, { bold: true, size: 23, color: '2B6CB0' })]
  });
}

function v2Widths(ratios: number[]) {
  const total = ratios.reduce((sum, value) => sum + value, 0);
  const widths = ratios.map((value) => Math.floor((value / total) * V2_CONTENT_WIDTH));
  widths[widths.length - 1] += V2_CONTENT_WIDTH - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function v2Cell(content: string[] | Paragraph[], width: number, options: { bold?: boolean; fill?: string; size?: number } = {}) {
  const paragraphs: Paragraph[] =
    content.length === 0
      ? [v2Para('-', { size: options.size || 20, after: 0 })]
      : typeof content[0] === 'string'
        ? (content as string[]).map(
            (line, index, all) =>
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: index === all.length - 1 ? 0 : 60, line: 264 },
                children: [makeTextRun(line || '-', { bold: options.bold, size: options.size || 20, color: V2_TEXT })]
              })
          )
        : (content as Paragraph[]);
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: V2_CELL_MARGINS,
    borders: V2_CELL_BORDERS,
    children: paragraphs,
    ...(options.fill ? { shading: { fill: options.fill } } : {})
  });
}

function v2HeaderCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: V2_CELL_MARGINS,
    borders: V2_CELL_BORDERS,
    shading: { fill: 'DCE6F2' },
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 0, line: 280 },
        children: [makeTextRun(text, { bold: true, size: 20, color: V2_HEAD })]
      })
    ]
  });
}

function v2Table(headers: string[], rows: string[][][], ratios: number[], options: { firstColumnFill?: string } = {}) {
  const widths = v2Widths(ratios);
  return new Table({
    width: { size: V2_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: v2Borders(),
    rows: [
      ...(headers.length > 0
        ? [new TableRow({ tableHeader: true, children: headers.map((header, index) => v2HeaderCell(header, widths[index])) })]
        : []),
      ...rows.map(
        (cells) =>
          new TableRow({
            children: cells.map((lines, index) =>
              v2Cell(lines, widths[index], index === 0 && options.firstColumnFill ? { fill: options.firstColumnFill, bold: true } : {})
            )
          })
      )
    ]
  });
}

/** 제목 띠와 본문으로 된 전체 폭 상자 (초안 등). */
function v2Box(title: string, body: Paragraph[], fill: string, borderColor: string) {
  return new Table({
    width: { size: V2_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [V2_CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
    borders: v2Borders(borderColor),
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            width: { size: V2_CONTENT_WIDTH, type: WidthType.DXA },
            margins: V2_CELL_MARGINS,
            shading: { fill: borderColor },
            children: [
              new Paragraph({
                spacing: { after: 0 },
                children: [makeTextRun(title, { bold: true, size: 21, color: 'FFFFFF' })]
              })
            ]
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: V2_CONTENT_WIDTH, type: WidthType.DXA },
            margins: { top: 140, bottom: 140, left: 180, right: 180 },
            shading: { fill },
            children: body
          })
        ]
      })
    ]
  });
}

function v2CommentBox(label: string) {
  return new Table({
    width: { size: V2_CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [V2_CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,
    borders: v2Borders(),
    rows: [
      new TableRow({ tableHeader: true, children: [v2HeaderCell(label, V2_CONTENT_WIDTH)] }),
      new TableRow({ height: { value: 2200, rule: HeightRule.ATLEAST }, children: [v2Cell([' '], V2_CONTENT_WIDTH)] })
    ]
  });
}

/** AI 초안 문단에서 학생이 표시한 문장을 색으로 칠하고 [번호 종류]를 붙인다. */
function v2HighlightedParagraphs(text: string, flagged: Array<{ sentence: string; kind: string; number: number }>) {
  const paragraphs = safeText(text)
    .split(/\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [v2Para('AI 초안이 없습니다.')];
  return paragraphs.map((paragraph) => {
    const runs: TextRun[] = [];
    let rest = paragraph;
    while (rest.length > 0) {
      let best: { index: number; item: (typeof flagged)[number] } | null = null;
      for (const item of flagged) {
        if (!item.sentence) continue;
        const index = rest.indexOf(item.sentence);
        if (index >= 0 && (!best || index < best.index)) best = { index, item };
      }
      if (!best) {
        runs.push(makeTextRun(rest, { size: 21, color: V2_TEXT }));
        break;
      }
      if (best.index > 0) {
        const before = rest.slice(0, best.index);
        runs.push(makeTextRun(before.trimEnd(), { size: 21, color: V2_TEXT }));
        // 강조 문장 앞의 띄어쓰기를 따로 넣는다(앞 조각 끝의 공백은 글자 정리에서 사라진다).
        if (/\s$/.test(before)) runs.push(new TextRun({ text: ' ', font: DOCX_FONT, size: 21 }));
      }
      runs.push(
        makeTextRun(best.item.sentence, {
          size: 21,
          color: V2_TEXT,
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: V2_FLAG_FILL[best.item.kind] || 'FDE68A' }
        })
      );
      runs.push(makeTextRun(` [${best.item.number} ${scaffoldJudgmentLabelKo(best.item.kind)}]`, { bold: true, size: 17, color: V2_MUTED }));
      rest = rest.slice(best.index + best.item.sentence.length);
    }
    return new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 120, line: 300 }, children: runs });
  });
}

function buildScaffoldSummaryChildrenV2(caseData: Case) {
  const scaffoldState: any = caseData.scaffoldState || {};
  const sectionStates: any[] = caseData.sectionStates || [];
  const sectionDrafts: any[] = caseData.sectionDrafts || [];
  const evidenceCards: any[] = caseData.evidenceCards || [];
  const reviewItems: any[] = scaffoldState.reviewItems || [];
  const snapshots: any[] = scaffoldState.preRevealSnapshots || [];
  const reflections: any[] = scaffoldState.sectionReflections || [];
  const progressItems: any[] = scaffoldState.sectionProgress || [];
  const notes: any[] = scaffoldState.caseMap?.caseNotes || [];
  const evidenceTextById = new Map<string, string>(
    evidenceCards.map((card: any) => [String(card.id), safeText(card.sourceText || card.normalizedText || '')])
  );
  const fixedCase = isFixedStudyCaseText((caseData.visits || []).map((visit: any) => visit?.soapText || ''));

  const workedSectionIds = sectionStates
    .map((item: any) => item.sectionId)
    .filter((sectionId: string) => {
      const progress = progressItems.find((item: any) => item.sectionId === sectionId);
      return (
        Boolean(progress?.recordReviewCompleted || progress?.draftRevealed) ||
        snapshots.some((item: any) => item.sectionId === sectionId) ||
        reviewItems.some((item: any) => item.sectionId === sectionId) ||
        // AI 비교 단계가 없는 "추가 작성" 항목도 학생이 쓴 글이 있으면 넣는다
        (V2_WRITE_ONLY_SECTION_IDS.has(sectionId) &&
          Boolean(safeText(reflections.find((item: any) => item.sectionId === sectionId)?.learnerNotes)))
      );
    });
  const multiSection = workedSectionIds.length > 1;
  const tag = (sectionId: string) => (multiSection ? `[${scaffoldSectionLabelKo(sectionId)}] ` : '');

  const sections = workedSectionIds.map((sectionId: string) => {
    const snapshot = snapshots.find((item: any) => item.sectionId === sectionId);
    const reflection = reflections.find((item: any) => item.sectionId === sectionId) || {};
    const progress = progressItems.find((item: any) => item.sectionId === sectionId) || {};
    const preAi = snapshot || reflection;
    const ownDraft = safeText(preAi.learnerNotes);
    const missingItems: string[] = Array.from(
      new Set(((preAi.learnerIdentifiedMissingItems || []) as string[]).map((item) => safeText(item)).filter(Boolean))
    );
    const keyItems: string[] = Array.from(
      new Set(
        ((preAi.learnerKeyInformationItems || preAi.learnerIdentifiedKeyInfo || []) as string[])
          .map((item) => safeText(item))
          .filter(Boolean)
      )
    );
    const selectedEvidence: any[] = preAi.selectedEvidence || [];
    const sufficiency = reviewItems
      .filter((item: any) => item.sectionId === sectionId && item.sourceType !== 'draft_sentence')
      .sort((a: any, b: any) => v2QuestionOrderKey(a.id).localeCompare(v2QuestionOrderKey(b.id)));
    const aiDraft = safeText(sectionDrafts.find((item: any) => item.sectionId === sectionId)?.draftText);
    const aiSentenceList = v2SplitDraftSentences(aiDraft);
    const flagged = reviewItems
      .filter(
        (item: any) =>
          item.sectionId === sectionId &&
          item.sourceType === 'draft_sentence' &&
          item.judgment !== 'supported_by_record' &&
          item.judgment !== 'pending'
      )
      .map((item: any, index: number) => {
        const position = aiSentenceList.findIndex((sentence) => sentence === safeText(item.sourceText));
        return { item, number: position >= 0 ? position + 1 : aiSentenceList.length + index + 1 };
      })
      .sort((a: any, b: any) => a.number - b.number);
    const post = reflection.postAiReflection || {};
    const writeOnly =
      V2_WRITE_ONLY_SECTION_IDS.has(sectionId) &&
      !progress.recordReviewCompleted &&
      !progress.draftRevealed &&
      sufficiency.length === 0 &&
      flagged.length === 0;
    return { sectionId, progress, ownDraft, missingItems, keyItems, selectedEvidence, sufficiency, aiDraft, aiSentenceList, flagged, post, writeOnly };
  });

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: 360 },
      children: [makeTextRun('증례보고 작성 학습 기록', { bold: true, size: TITLE_FONT_SIZE })]
    }),
    v2Para(
      `실험번호 ${safeText((caseData as any).experiment_code || '-')} · 방문 기록 ${(caseData.visits || []).length}회 · 실습 항목 ${
        workedSectionIds.map(scaffoldSectionLabelKo).join(', ') || '-'
      }`,
      { color: V2_MUTED, after: 80 }
    ),
    v2Para(
      '기록을 어떻게 읽었는지(메모), AI를 보기 전에 무엇을 판단하고 썼는지(내 초안), AI 초안과 견주어 무엇을 알아차렸는지(표시한 문장, 돌아보기)를 차례로 모았습니다. "주요 특징"에 핵심을 먼저 모아 두었습니다. AI 초안은 최종 원고가 아닙니다.',
      { color: V2_MUTED }
    )
  ];

  // ------------------------------------------------------------------ 한눈에 보기
  const noteTypeCounts = v2Tally(notes.map((note: any) => note.type || 'observation'));
  const aiNoteCount = notes.filter(v2IsAiNote).length;
  const careCounts = v2Tally(notes.flatMap((note: any) => (note.careItems && note.careItems.length > 0 ? note.careItems : ['none'])));
  const visitCounts = v2Tally(notes.map((note: any) => (note.visitIndex ? String(note.visitIndex) : 'none')));
  const visitKeys = Array.from(visitCounts.keys()).sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b)));
  const allSufficiency = sections.flatMap((section) => section.sufficiency);
  const sufficiencyCounts = v2Tally(allSufficiency.map((item: any) => item.judgment));
  const allFlagged = sections.flatMap((section) => section.flagged.map(({ item }: any) => item));
  const flagCounts = v2Tally(allFlagged.map((item: any) => item.judgment));
  const draftChars = sections.reduce((sum, section) => sum + section.ownDraft.length, 0);
  const draftSentenceCount = sections.reduce((sum, section) => sum + v2SentenceCount(section.ownDraft), 0);
  const aiSentenceCount = sections.reduce((sum, section) => sum + section.aiSentenceList.length, 0);

  children.push(v2H1('한눈에 보기'));
  children.push(v2Para('개수와 분포만 셉니다. 맞고 틀림은 아래 기록을 보고 판단합니다.', { color: V2_MUTED, keepNext: true }));
  children.push(
    v2Table(
      [],
      [
        [
          ['기록 읽기 메모'],
          [
            `${notes.length}개 (${v2CountParts(
              ['observation', 'question', 'literature'].map((type) => [type, noteTypeCounts.get(type) || 0] as [string, number]),
              v2NoteTypeLabel
            )})${aiNoteCount > 0 ? `, 그중 AI 추천에서 가져옴 ${aiNoteCount}` : ''}`
          ]
        ],
        [
          ['메모가 다룬 세부 항목'],
          [
            `${v2CountParts(['9a', '9b', '9c'].map((code) => [code, careCounts.get(code) || 0] as [string, number]), (code) => code)}${
              (careCounts.get('none') || 0) > 0 ? ` (항목을 붙이지 않은 메모 ${careCounts.get('none')})` : ''
            }`
          ]
        ],
        [
          ['메모를 남긴 회차'],
          [v2CountParts(visitKeys.map((key) => [key, visitCounts.get(key) || 0] as [string, number]), (key) => (key === 'none' ? '미지정' : `${key}회차`))]
        ],
        [['내 초안'], [draftChars > 0 ? `${draftChars}자 · ${draftSentenceCount}문장` : '쓰지 않음']],
        [
          ['AI 보기 전 정보 충분성 판단'],
          [
            `${allSufficiency.length}개 질문 (${v2CountParts(
              V2_SUFFICIENCY_ORDER.map((key) => [key, sufficiencyCounts.get(key) || 0] as [string, number]),
              v2SufficiencyLabel
            )})`
          ]
        ],
        [
          ['AI 초안에서 표시한 문장'],
          [
            `${allFlagged.length}개${aiSentenceCount > 0 ? ` / 전체 ${aiSentenceCount}문장` : ''} (${v2CountParts(
              V2_FLAG_ORDER.map((key) => [key, flagCounts.get(key) || 0] as [string, number]),
              scaffoldJudgmentLabelKo
            )})`
          ]
        ]
      ],
      [34, 66],
      { firstColumnFill: 'F1F5F9' }
    )
  );

  // ------------------------------------------------------------------ 주요 특징
  const selfGaps = sections
    .filter((section) => safeText(section.post.changedJudgment))
    .map((section) => `${tag(section.sectionId)}${safeText(section.post.changedJudgment)}`);
  const aiPoints = [
    ...sections
      .filter((section) => safeText(section.post.missingInDraft))
      .map((section) => `${tag(section.sectionId)}${safeText(section.post.missingInDraft)}`),
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }: any) => item.judgment === 'differs_from_record')
        .map(({ item, number }: any) => `${tag(section.sectionId)}AI 문장 ${number} (기록과 다름): ${safeText(item.note || item.sourceText)}`)
    )
  ];
  const curious = [
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }: any) => item.judgment === 'needs_instructor_review')
        .map(({ item, number }: any) => `${tag(section.sectionId)}AI 문장 ${number}: ${safeText(item.note || item.sourceText)}`)
    ),
    ...sections.flatMap((section) =>
      section.sufficiency
        .filter((item: any) => item.judgment === 'needs_instructor_review')
        .map((item: any) => `${tag(section.sectionId)}${safeText(item.sourceText)}${item.note ? ` — ${safeText(item.note)}` : ''}`)
    ),
    ...sections
      .filter((section) => safeText(section.post.unresolvedQuestion))
      .map((section) => `${tag(section.sectionId)}${safeText(section.post.unresolvedQuestion)}`)
  ];
  const toCheck = [
    ...sections.flatMap((section) => section.missingItems.map((item) => `${tag(section.sectionId)}부족하다고 본 정보: ${item}`)),
    ...sections.flatMap((section) =>
      section.sufficiency
        .filter((item: any) => item.judgment === 'needs_additional_confirmation' || item.judgment === 'unavailable')
        .map(
          (item: any) =>
            `${tag(section.sectionId)}${safeText(item.sourceText)} → ${v2SufficiencyLabel(item.judgment)}${
              item.note ? ` — ${safeText(item.note)}` : ''
            }`
        )
    ),
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }: any) => item.judgment === 'needs_additional_confirmation')
        .map(
          ({ item, number }: any) =>
            `${tag(section.sectionId)}AI 문장 ${number} (기록만으로 확인하기 어려움): ${safeText(item.note || item.sourceText)}`
        )
    ),
    ...notes
      .filter((note: any) => note.type === 'question' || note.type === 'literature')
      .map((note: any) => `${v2NoteTypeLabel(note.type)} 메모${note.visitIndex ? ` (${note.visitIndex}회차)` : ''}: ${safeText(note.text)}`)
  ];
  // 네 갈래를 왼쪽 이름 칸과 오른쪽 내용 칸으로 된 표로 둔다. 내용이 여럿이면 줄마다 "•"를 붙인다.
  const groupLines = (items: string[]) =>
    items.length === 0 ? ['적은 내용이 없습니다.'] : items.length === 1 ? items : items.map((item) => `• ${item}`);
  children.push(v2H1('주요 특징'));
  children.push(
    v2Table(
      [],
      [
        [['스스로 돌아본 내 초안'], groupLines(selfGaps)],
        [['AI 초안에서 짚은 점'], groupLines(aiPoints)],
        [['궁금한 점'], groupLines(curious)],
        [['더 확인하려는 정보'], groupLines(toCheck)]
      ],
      [28, 72],
      { firstColumnFill: 'FFF7E6' }
    )
  );

  // ------------------------------------------------------------------ 1. 기록 읽기
  const sortedNotes = [...notes].sort(
    (a: any, b: any) => (a.visitIndex ?? 99) - (b.visitIndex ?? 99) || String(a.createdAt).localeCompare(String(b.createdAt))
  );
  children.push(v2H1(`1. 기록 읽기: 남긴 메모 ${notes.length}개`));
  if (sortedNotes.length === 0) {
    children.push(v2Para('메모가 없습니다.'));
  } else {
    children.push(
      v2Table(
        ['회차', '종류', '세부 항목', '메모'],
        sortedNotes.map((note: any) => [
          [note.visitIndex ? `${note.visitIndex}회차` : '미지정'],
          [v2NoteTypeLabel(note.type)],
          [((note.careItems || []) as string[]).map((code) => V2_CARE_ITEM_LABELS[code] || code).join(', ') || '-'],
          [`${safeText(note.text)}${v2IsAiNote(note) ? ' (AI 추천에서 가져옴)' : ''}`]
        ]),
        [10, 14, 23, 53]
      )
    );
  }

  if (sections.length === 0) {
    children.push(v2H1('CARE 항목별 기록'));
    children.push(v2Para('아직 작업한 CARE 항목이 없습니다.'));
    return children;
  }

  const writeOnlySections = sections.filter((section) => section.writeOnly);
  if (writeOnlySections.length > 0) {
    children.push(v2H1('추가 작성한 항목'));
    children.push(v2Para('AI 초안과 비교하는 단계 없이 학생이 직접 쓴 항목입니다.', { color: V2_MUTED, keepNext: true }));
    children.push(
      v2Table(
        [],
        writeOnlySections.map((section) => [
          [scaffoldSectionLabelKo(section.sectionId), `${section.ownDraft.length}자`],
          section.ownDraft ? section.ownDraft.split(/\n+/).filter(Boolean) : ['쓰지 않았습니다.']
        ]),
        [24, 76],
        { firstColumnFill: 'F1F5F9' }
      )
    );
  }

  for (const section of sections.filter((item) => !item.writeOnly)) {
    const label = scaffoldSectionLabelKo(section.sectionId);
    if (multiSection) children.push(v2H1(label));

    // 2. AI 보기 전 판단
    children.push(v2H1(`2. AI 초안을 보기 전 판단${multiSection ? ` (${label})` : ''}`));
    if (section.sufficiency.length === 0) {
      children.push(v2Para('판단한 질문이 없습니다.'));
    } else {
      children.push(
        v2Table(
          ['질문', '학생의 판단', '이유'],
          section.sufficiency.map((item: any) => [[safeText(item.sourceText)], [v2SufficiencyLabel(item.judgment)], [safeText(item.note) || '-']]),
          [36, 20, 44]
        )
      );
    }
    if (section.missingItems.length > 0) {
      children.push(v2H2('초안을 쓰며 부족하다고 본 정보'));
      section.missingItems.forEach((item) => children.push(v2Bullet(item)));
    }
    if (section.selectedEvidence.length > 0 || section.keyItems.length > 0) {
      children.push(v2H2('기록에서 고른 근거와 핵심 정보'));
      section.selectedEvidence.forEach((item: any) =>
        children.push(v2Bullet(safeText(item.label || evidenceTextById.get(String(item.id)) || item.id)))
      );
      section.keyItems.forEach((item) => children.push(v2Bullet(item)));
    }

    // 3. 내 초안과 AI 초안: 나란히 두면 좁아서 읽기 어렵다. 전체 폭 상자 둘을 차례로 둔다.
    children.push(v2H1('3. 내 초안과 AI 초안'));
    const flaggedForHighlight = section.flagged.map(({ item, number }: any) => ({
      sentence: safeText(item.sourceText),
      kind: item.judgment,
      number
    }));
    children.push(
      v2Box(
        `학생이 쓴 초안 (AI 보기 전) · ${section.ownDraft.length}자`,
        section.ownDraft ? v2Paragraphs(section.ownDraft) : [v2Para('쓰지 않았습니다.')],
        'F3FAF5',
        '2F855A'
      )
    );
    children.push(v2Para(' ', { after: 60 }));
    children.push(
      v2Box(
        `AI 초안${section.flagged.length > 0 ? ` · 학생이 표시한 문장 ${section.flagged.length}개는 색과 [번호 종류]로 표시` : ''}`,
        section.progress.draftRevealed
          ? v2HighlightedParagraphs(section.aiDraft, flaggedForHighlight)
          : [v2Para('아직 AI 초안을 열지 않았습니다.')],
        'F5F8FF',
        '3B6FD4'
      )
    );
    children.push(
      v2Para('색: 기록과 다름(빨강) · 기록만으로 확인하기 어려움(노랑) · 교수님께 확인(보라) · 내 초안에 더하고 싶음(초록)', {
        color: V2_MUTED,
        size: 18
      })
    );
    if (section.flagged.length > 0) {
      children.push(v2H2(`표시한 AI 문장 ${section.flagged.length}개`));
      children.push(
        v2Table(
          ['#', '표시한 AI 문장', '종류', '이유와 연결한 기록'],
          section.flagged.map(({ item, number }: any) => {
            const linked = (item.evidenceIds || [])
              .map((id: string) => evidenceTextById.get(String(id)))
              .filter(Boolean)
              .map((text: string) => `[기록] ${text}`);
            return [[String(number)], [safeText(item.sourceText)], [scaffoldJudgmentLabelKo(item.judgment)], [safeText(item.note), ...linked].filter(Boolean)];
          }),
          [6, 40, 17, 37]
        )
      );
    } else if (section.progress.draftRevealed) {
      children.push(v2Para('다시 볼 문장으로 표시한 것이 없습니다.'));
    }

    // 4. 돌아보기
    children.push(v2H1('4. 돌아보기 (AI 초안을 읽은 뒤)'));
    children.push(
      v2Table(
        [],
        [
          [['내 초안에서 빠졌거나 부족했던 내용'], [safeText(section.post.changedJudgment) || '적은 내용이 없습니다.']],
          [['AI 초안에서 부족하거나 의심스러운 내용'], [safeText(section.post.missingInDraft) || '적은 내용이 없습니다.']],
          [['교수님이나 전문가에게 묻고 싶은 것'], [safeText(section.post.unresolvedQuestion) || '적은 내용이 없습니다.']]
        ],
        [31, 69],
        { firstColumnFill: 'F1F5F9' }
      )
    );

    children.push(v2H1(`교수 코멘트 (${label})`));
    children.push(v2CommentBox('학생에게 돌려줄 의견'));

    // 참고: 연구자가 정리한 이 사례 기록의 CARE 세부 항목표 (고정 실험 사례일 때만)
    const careMap = fixedCase ? DEFAULT_STUDY_CARE_ELEMENT_MAP[section.sectionId] || [] : [];
    if (careMap.length > 0) {
      children.push(v2H1('참고: 이 사례 기록에 있는 정보 (연구자 정리)'));
      children.push(v2Para('학생 초안과 견주어 볼 때 참고하는 표입니다.', { color: V2_MUTED, keepNext: true }));
      children.push(
        v2Table(
          ['CARE 세부 항목', '기록에 있는 정보', '기록에서 찾기 어려운 정보'],
          careMap.map((element) => [
            [`${element.code} ${element.label}`, element.required ? '필수' : '선택'],
            element.inRecord.map((line) => `• ${line}`),
            element.notInRecord.map((line) => `• ${line}`)
          ]),
          [20, 46, 34]
        )
      );
    }
  }

  children.push(v2Para(' '));
  children.push(
    v2Para('이 기록은 교육용 자료입니다. AI 초안의 문장은 원기록과 전문가 판단으로 다시 확인한 뒤에 사용해야 합니다.', {
      color: V2_MUTED,
      size: 18
    })
  );
  return children;
}

export async function exportCaseToDocx(caseData: Case, mode: ExportMode, layout: ExportLayout = 'one_paragraph') {
  if (mode === 'scaffold_review') {
    const document = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: DOCX_FONT
            },
            paragraph: {
              spacing: {
                after: 160,
                line: 320
              }
            }
          }
        }
      },
      sections: [
        {
          properties: {
            column: {
              count: 1,
              space: 708
            }
          },
          // V2 는 화면(내 학습 기록)과 같은 구조로 쓴다. V1 은 기존 구조 그대로.
          children: isStudyScaffoldV2Case(caseData) ? buildScaffoldSummaryChildrenV2(caseData) : buildScaffoldSummaryChildren(caseData)
        }
      ]
    });

    const buffer = await Packer.toBuffer(document);
    return {
      fileName: buildFileName(caseData, mode, layout),
      buffer
    };
  }

  const titleChildren: Array<Paragraph | Table> = [];
  const bodyChildren: Array<Paragraph | Table> = [];
  const titleText = resolveSectionText(caseData, mode, 'TITLE') || safeText(caseData.title || 'Case report');
  titleChildren.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: 'center',
      spacing: { after: 260, line: 360 },
      children: [makeTextRun(titleText, { bold: true, size: TITLE_FONT_SIZE })]
    })
  );

  for (const sectionId of DOCUMENT_SECTION_ORDER) {
    if (sectionId === 'TITLE') continue;

    const text = resolveSectionText(caseData, mode, sectionId);
    bodyChildren.push(makeSectionHeading(sectionLabel(sectionId)));

    if (sectionId === 'TIMELINE') {
      const timelineRows =
        buildTimelineTableRowsFromEvents(caseData.timelineEvents) || buildTimelineTableRows(text);
      const table = buildTimelineTable(timelineRows);
      if (!hasMeaningfulNarrativeText(text) && table) {
        bodyChildren.push(table);
        continue;
      }
    }

    bodyChildren.push(...buildParagraphsFromText(text));
  }

  if (mode === 'final_manuscript_with_checklist') {
    bodyChildren.push(
      makeSectionHeading('CARE Checklist')
    );
    bodyChildren.push(buildChecklistAppendix(caseData));
  }

  if (mode === 'final_manuscript_with_traceability') {
    bodyChildren.push(
      makeSectionHeading('Evidence Traceability')
    );
    // 근거 연결의 성격을 밝힌다: 모델·저자가 지정한 인용이 아니라 문자 일치로 자동 추정한 것.
    bodyChildren.push(
      new Paragraph({
        children: [
          makeTextRun(
            '아래 문장별 근거 연결은 초안 문장과 근거 카드 본문의 문자 일치(2-gram)로 자동 추정한 것이며, 모델이나 저자가 지정한 인용이 아닙니다. 실제 근거 여부는 기록을 확인해 판단하십시오.'
          )
        ]
      })
    );
    bodyChildren.push(...buildTraceabilityAppendix(caseData));
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: DOCX_FONT
          },
          paragraph: {
            spacing: {
              after: 160,
              line: 320
            }
          }
        }
      }
    },
    sections: [
      {
        properties: {
          column: {
            count: 1,
            space: 708
          }
        },
        children: titleChildren
      },
      {
        properties: {
          type: SectionType.CONTINUOUS,
          column: {
            count: layout === 'two_paragraph' ? 2 : 1,
            space: 708
          }
        },
        children: bodyChildren
      }
    ]
  });

  const buffer = await Packer.toBuffer(document);
  return {
    fileName: buildFileName(caseData, mode, layout),
    buffer
  };
}
