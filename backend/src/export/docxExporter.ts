import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import { renderClinicalAnonymizedText } from '../deid/publicationRenderer';
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
  needs_additional_confirmation: '추가 확인 필요',
  needs_instructor_review: '교수 검토 필요',
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
      '학습자가 AI 초안을 보기 전에 정리한 내용, AI 초안의 각 문장에 대한 판단과 이유, AI를 본 뒤 달라진 점을 CARE 항목별로 모은 기록입니다. AI 초안은 최종 원고가 아닙니다.'
    ),
    makeBodyParagraph(`실험번호: ${safeText((caseData as any).experiment_code || '-')}`),
    makeBodyParagraph(`방문 기록: ${(caseData.visits || []).length}회`),
    makeBodyParagraph(`작업한 CARE 항목: ${workedSectionIds.length}개 (완료 ${completedCount}개)`)
  ];

  if (caseNotes.length > 0) {
    children.push(makeSectionHeading('기록을 읽으며 남긴 메모'));
    caseNotes.forEach((note: any) => {
      const label = note.type === 'question' ? '더 확인할 점' : '눈에 띈 점';
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
    if (selectedEvidence.length === 0 && keyItems.length === 0 && missingItems.length === 0) {
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
    const sufficiencyJudgments: any[] = (snapshot?.reviewItemJudgments || []).filter(
      (item: any) => item.sourceType !== 'draft_sentence'
    );
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
    children.push(makeSubHeading('② AI 초안과 내 검토'));
    if (!progress.draftRevealed) {
      children.push(makeBodyParagraph('아직 AI 초안을 확인하지 않았습니다.'));
    } else {
      const sentenceItems = reviewItems.filter(
        (item: any) => item.sectionId === sectionId && item.sourceType === 'draft_sentence'
      );
      if (sentenceItems.length === 0) {
        children.push(...buildParagraphsFromText(safeText(draft?.draftText) || 'AI 초안이 없습니다.'));
        children.push(makeBodyParagraph('문장별 검토 기록이 없습니다.'));
      } else {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders(),
            rows: [
              new TableRow({
                children: [makeHeaderCell('AI 초안 문장'), makeHeaderCell('내 판단'), makeHeaderCell('이유와 연결한 기록')]
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
    const postAi = reflection.postAiReflection || {};
    children.push(makeSubHeading('③ AI를 보고 달라진 점'));
    children.push(makeBodyParagraph(safeText(postAi.changedJudgment) || '기록된 내용이 없습니다.'));
    if (safeText(postAi.unresolvedQuestion)) {
      children.push(makeSubHeading('④ 교수님께 확인하고 싶은 것'));
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
          children: buildScaffoldSummaryChildren(caseData)
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
