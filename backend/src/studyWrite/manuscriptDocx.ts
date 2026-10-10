import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import { renderClinicalAnonymizedText } from '../deid/publicationRenderer';
import { StudyWriteState } from '../types/studyWrite';
import { AttachmentSummary, getAttachmentFile } from './attachments';
import { CARE_SECTION_NAMES, CARE_SECTION_ORDER } from './careItems';

/**
 * 실험용 Write ⑧ Word 내보내기. 섹션 순서대로 본문을 쓰고, 섹션 본문 아래에 그 섹션의
 * 표·그림을 "표 n. 제목" / "그림 n. 제목"으로 넣는다. 번호는 글 전체 순서다.
 */

const FONT = '맑은 고딕';

function run(text: string, options: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}) {
  return new TextRun({ text, font: FONT, size: options.size ?? 22, bold: options.bold, italics: options.italics, color: options.color });
}

function bodyParagraphs(text: string): Paragraph[] {
  const rendered = renderClinicalAnonymizedText(text).trim();
  if (!rendered) {
    return [new Paragraph({ spacing: { after: 120 }, children: [run('(내용 없음)', { italics: true, color: '888888' })] })];
  }
  return rendered
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map((block) => new Paragraph({ spacing: { after: 160, line: 340 }, children: [run(block)] }));
}

/** "날짜 | 사건" 줄로 쓴 타임라인을 표 행으로. 그런 줄이 2개 미만이면 null (문단으로 둔다). */
export function timelineRows(text: string): string[][] | null {
  const rows = renderClinicalAnonymizedText(text)
    .split('\n')
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells.some(Boolean));
  if (rows.length < 2) return null;
  return [['날짜', '사건'], ...rows.map((cells) => [cells[0], cells.slice(1).join(' | ')])];
}

function tableBlock(rows: string[][]): Table {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: columnCount }, (_, index) =>
            new TableCell({
              margins: { top: 50, bottom: 50, left: 90, right: 90 },
              children: [new Paragraph({ children: [run(row[index] || '', { size: 18, bold: rowIndex === 0 })] })]
            })
          )
        })
    )
  });
}

function imageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } {
  // PNG: IHDR 폭·높이. JPEG: SOF 마커. 못 읽으면 4:3 으로 둔다.
  try {
    if (mimeType === 'image/png' && buffer.length > 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    /* fall through */
  }
  return { width: 4, height: 3 };
}

export async function buildStudyWriteManuscriptDocx(params: {
  caseId: string;
  experimentCode?: string | null;
  state: StudyWriteState;
  attachments: AttachmentSummary[];
}): Promise<Buffer> {
  const { caseId, state, attachments } = params;
  const children: Array<Paragraph | Table> = [];
  let tableNo = 0;
  let figureNo = 0;

  const titleSection = state.sections?.TITLE?.draftText || '';
  const titleLine = renderClinicalAnonymizedText(titleSection).split('\n').map((line) => line.trim()).find(Boolean) || '증례보고 초안';
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [run(titleLine, { bold: true, size: 32 })]
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [run('실험용 Write 로 작성한 초안 — 제출 전 저자 검토가 필요합니다', { size: 18, color: '777777' })]
    })
  );

  for (const sectionId of CARE_SECTION_ORDER) {
    const section = state.sections?.[sectionId];
    if (!section) continue;
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 120 },
        children: [run(CARE_SECTION_NAMES[sectionId] || sectionId, { bold: true, size: 26 })]
      })
    );
    // 제목 섹션은 위에 썼으므로 남은 줄(핵심 단어 등)만
    const text = sectionId === 'TITLE' ? titleSection.split('\n').slice(1).join('\n') : section.draftText;
    const timeline = sectionId === 'TIMELINE' ? timelineRows(text) : null;
    if (timeline) {
      children.push(tableBlock(timeline));
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    } else {
      children.push(...bodyParagraphs(text));
    }

    for (const attachmentId of section.attachmentIds) {
      const attachment = attachments.find((item) => item.id === attachmentId);
      if (!attachment) continue;
      if (attachment.kind === 'table' && attachment.tableRows && attachment.tableRows.length > 0) {
        tableNo += 1;
        children.push(
          new Paragraph({ spacing: { before: 160, after: 80 }, children: [run(`표 ${tableNo}. ${attachment.caption || attachment.fileName}`, { bold: true, size: 20 })] })
        );
        children.push(tableBlock(attachment.tableRows));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
      } else if (attachment.kind === 'image') {
        const file = await getAttachmentFile(caseId, attachment.id);
        if (!file) continue;
        figureNo += 1;
        const dims = imageDimensions(file.data, file.mimeType);
        const maxWidth = 520;
        const scale = Math.min(1, maxWidth / Math.max(dims.width, 1));
        const width = Math.round(dims.width * scale) || maxWidth;
        const height = Math.round(dims.height * scale) || Math.round(maxWidth * 0.75);
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 60 },
            children: [
              new ImageRun({
                type: file.mimeType === 'image/png' ? 'png' : 'jpg',
                data: file.data,
                transformation: { width, height }
              })
            ]
          })
        );
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [run(`그림 ${figureNo}. ${attachment.caption || attachment.fileName}`, { bold: true, size: 20 })]
          })
        );
      }
    }
  }

  const doc = new Document({
    creator: 'CARE study write',
    sections: [{ properties: { page: { margin: { top: 1300, bottom: 1300, left: 1400, right: 1400 } } }, children }]
  });
  return Packer.toBuffer(doc);
}
