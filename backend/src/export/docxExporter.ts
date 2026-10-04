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

function buildScaffoldSummaryChildren(caseData: Case) {
  const scaffoldState: any = caseData.scaffoldState || {
    reviewItems: [],
    sectionProgress: [],
    instructorReviewItems: [],
    additionalConfirmationItems: []
  };
  const sectionStates: any[] = caseData.sectionStates || [];
  const sectionDrafts: any[] = caseData.sectionDrafts || [];
  const evidenceCards: any[] = caseData.evidenceCards || [];
  const progressBySection = new Map<string, any>(
    (scaffoldState.sectionProgress || []).map((item: any) => [item.sectionId, item])
  );
  const reflectionBySection = new Map<string, any>(
    (scaffoldState.sectionReflections || []).map((item: any) => [item.sectionId, item])
  );
  const reviewItems: any[] = scaffoldState.reviewItems || [];
  const additionalItems = reviewItems.filter((item) => item.judgment === 'needs_additional_confirmation');
  const instructorItems = reviewItems.filter((item) => item.judgment === 'needs_instructor_review');
  const unsupportedItems = reviewItems.filter(
    (item) => item.judgment === 'unsupported' || item.sourceType === 'unsupported_claim'
  );

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240, line: 360 },
      children: [makeTextRun('증례보고 작성 Scaffold 검토 결과', { bold: true, size: TITLE_FONT_SIZE })]
    }),
    makeBodyParagraph(
      '본 문서는 증례보고 작성 교육 및 교수자 피드백을 위한 검토 자료입니다. AI 생성 내용은 최종 원고가 아니며, 기록 근거와 전문가 검토가 필요합니다.'
    ),
    makeSectionHeading('케이스 기본 정보'),
    makeBodyParagraph(`제목: ${safeText(caseData.title || '제목 없음')}`),
    makeBodyParagraph(`방문 수: ${(caseData.visits || []).length}`),
    makeBodyParagraph(`분석된 CARE 섹션 수: ${sectionStates.length}`),
    makeBodyParagraph(
      `검토 완료 섹션 수: ${
        (scaffoldState.sectionProgress || []).filter(
          (item: any) =>
            item.recordReviewCompleted &&
            item.missingInfoReviewCompleted &&
            item.draftRevealed &&
            item.draftReviewCompleted
        ).length
      }`
    ),
    makeSectionHeading('CARE 섹션별 상태')
  ];

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: tableBorders(),
      rows: [
        new TableRow({
          children: [
            makeHeaderCell('CARE 섹션'),
            makeHeaderCell('기존 상태'),
            makeHeaderCell('기록 검토'),
            makeHeaderCell('누락 정보 검토'),
            makeHeaderCell('AI 초안 검토')
          ]
        }),
        ...sectionStates.map(
          (sectionState: any) =>
            new TableRow({
              children: [
                makeBodyCell(sectionLabel(sectionState.sectionId)),
                makeBodyCell(sectionState.status || '-'),
                makeBodyCell(progressBySection.get(sectionState.sectionId)?.recordReviewCompleted ? '완료' : '미완료'),
                makeBodyCell(progressBySection.get(sectionState.sectionId)?.missingInfoReviewCompleted ? '완료' : '미완료'),
                makeBodyCell(progressBySection.get(sectionState.sectionId)?.draftReviewCompleted ? '완료' : '미완료')
              ]
            })
        )
      ]
    })
  );

  children.push(makeSectionHeading('기록에서 확인된 핵심 정보'));
  for (const sectionState of sectionStates) {
    children.push(makeBodyParagraph(`${sectionLabel(sectionState.sectionId)}`));
    const evidence = evidenceCards.filter((card) => (card.tags || []).includes(sectionState.sectionId)).slice(0, 3);
    if (evidence.length === 0) {
      children.push(buildBulletParagraph('핵심 근거가 아직 정리되지 않았습니다.'));
      continue;
    }
    evidence.forEach((card) => {
      children.push(buildBulletParagraph(safeText(card.normalizedText || card.sourceText || '-')));
    });
  }

  children.push(makeSectionHeading('User reflections'));
  for (const sectionState of sectionStates) {
    const reflection = reflectionBySection.get(sectionState.sectionId) || {};
    children.push(makeBodyParagraph(sectionLabel(sectionState.sectionId)));

    const keyInfoItems = reflection.learnerIdentifiedKeyInfo || [];
    const missingItems = reflection.learnerIdentifiedMissingItems || [];

    if (keyInfoItems.length === 0 && missingItems.length === 0 && !reflection.learnerNotes) {
      children.push(buildBulletParagraph('No learner reflection recorded.'));
      continue;
    }

    if (keyInfoItems.length > 0) {
      children.push(buildBulletParagraph(`Key information: ${keyInfoItems.join('; ')}`));
    }
    if (missingItems.length > 0) {
      children.push(buildBulletParagraph(`Missing information: ${missingItems.join('; ')}`));
    }
    if (reflection.learnerNotes) {
      children.push(buildBulletParagraph(`Learner notes: ${safeText(reflection.learnerNotes)}`));
    }
  }

  children.push(makeSectionHeading('추가 확인 필요 항목'));
  if (additionalItems.length === 0) {
    children.push(makeBodyParagraph('표시된 추가 확인 필요 항목이 없습니다.'));
  } else {
    additionalItems.forEach((item) => {
      children.push(
        buildBulletParagraph(
          `[${sectionLabel(item.sectionId)}] ${safeText(item.sourceText)}${item.note ? ` - ${safeText(item.note)}` : ''}`
        )
      );
    });
  }

  children.push(makeSectionHeading('교수자 검토 필요 항목'));
  if (instructorItems.length === 0) {
    children.push(makeBodyParagraph('표시된 교수자 검토 필요 항목이 없습니다.'));
  } else {
    instructorItems.forEach((item) => {
      children.push(
        buildBulletParagraph(
          `[${sectionLabel(item.sectionId)}] ${safeText(item.sourceText)}${item.note ? ` - ${safeText(item.note)}` : ''}`
        )
      );
    });
  }

  children.push(makeSectionHeading('근거 부족 또는 불일치'));
  if (unsupportedItems.length === 0) {
    children.push(makeBodyParagraph('표시된 근거 부족 항목이 없습니다.'));
  } else {
    unsupportedItems.forEach((item) => {
      children.push(
        buildBulletParagraph(
          `[${sectionLabel(item.sectionId)}] ${safeText(item.sourceText)}${item.note ? ` - ${safeText(item.note)}` : ''}`
        )
      );
    });
  }

  children.push(makeSectionHeading('섹션별 AI 초안'));
  for (const draft of sectionDrafts) {
    children.push(makeBodyParagraph(sectionLabel(draft.sectionId)));
    children.push(...buildParagraphsFromText(draft.draftText || '초안이 없습니다.'));
  }

  children.push(makeSectionHeading('AI Review 의견'));
  sectionStates.forEach((sectionState: any) => {
    children.push(
      buildBulletParagraph(
        `[${sectionLabel(sectionState.sectionId)}] ${safeText(sectionState.rationaleText || '검토 의견이 아직 없습니다.')}`
      )
    );
  });

  children.push(makeSectionHeading('최종 검토 안내'));
  children.push(
    makeBodyParagraph(
      '이 결과는 교육용 검토 자료입니다. 추가 확인 필요 항목과 교수자 검토 필요 항목은 최종 사실처럼 단정하지 말고, 기록과 전문가 판단을 바탕으로 다시 확인해야 합니다.'
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
