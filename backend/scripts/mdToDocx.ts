/**
 * docs 폴더의 마크다운 문서를 인쇄용 DOCX로 바꾼다. 제목, 목록, 체크 목록,
 * 표, 인용문, 굵은 글씨, `코드` 표기만 다룬다.
 *
 * 실행: npx tsx scripts/mdToDocx.ts <입력.md> <출력.docx>
 */
import fs from 'fs';
import path from 'path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';

const FONT = '맑은 고딕';
const BODY_SIZE = 21;

function inlineRuns(text: string, base: { size?: number; bold?: boolean; italics?: boolean; color?: string } = {}) {
  // **굵게** 와 `코드` 만 나눈다.
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return new TextRun({ text: part.slice(2, -2), font: FONT, size: base.size ?? BODY_SIZE, bold: true, color: base.color });
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return new TextRun({ text: part.slice(1, -1), font: 'Consolas', size: (base.size ?? BODY_SIZE) - 1, color: '333333' });
      }
      return new TextRun({
        text: part,
        font: FONT,
        size: base.size ?? BODY_SIZE,
        bold: base.bold,
        italics: base.italics,
        color: base.color
      });
    });
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function buildTable(lines: string[]) {
  const rows = lines.filter((line) => !/^\s*\|?\s*:?-{2,}/.test(line)).map(splitRow);
  const columnCount = Math.max(...rows.map((row) => row.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: rowIndex === 0,
          children: Array.from({ length: columnCount }, (_, index) => {
            const text = row[index] ?? '';
            return new TableCell({
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'EEF2F6', color: 'auto' } : undefined,
              children: [new Paragraph({ children: inlineRuns(text, { size: 19, bold: rowIndex === 0 }) })]
            });
          })
        })
    )
  });
}

function convert(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Array<Paragraph | Table> = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('|')) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(buildTable(tableLines));
      blocks.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const size = [34, 28, 24, 22][level - 1];
      blocks.push(
        new Paragraph({
          keepNext: true,
          spacing: { before: level === 1 ? 0 : 280, after: 120 },
          border:
            level === 2 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 3 } } : undefined,
          children: inlineRuns(heading[2], { size, bold: true })
        })
      );
      index += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const text = trimmed.replace(/^>\s?/, '');
      if (text) {
        blocks.push(
          new Paragraph({
            spacing: { after: 80, line: 320 },
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: '7A9CC6', space: 8 } },
            children: inlineRuns(text, { color: '1F3A5F' })
          })
        );
      }
      index += 1;
      continue;
    }

    const indentLevel = Math.floor((line.length - line.trimStart().length) / 2);
    const checkbox = /^- \[( |x)\]\s+(.*)$/.exec(trimmed);
    const bullet = /^- (.*)$/.exec(trimmed);
    const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (checkbox || bullet || numbered) {
      const marker = checkbox ? '☐ ' : numbered ? `${numbered[1]}. ` : '• ';
      const text = checkbox ? checkbox[2] : numbered ? numbered[2] : bullet![1];
      const left = 360 + indentLevel * 360;
      blocks.push(
        new Paragraph({
          spacing: { after: 60, line: 310 },
          indent: { left, hanging: 300 },
          children: [new TextRun({ text: marker, font: FONT, size: BODY_SIZE }), ...inlineRuns(text)]
        })
      );
      index += 1;
      continue;
    }

    blocks.push(new Paragraph({ spacing: { after: 100, line: 320 }, children: inlineRuns(trimmed) }));
    index += 1;
  }

  return blocks;
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: tsx scripts/mdToDocx.ts <input.md> <output.docx>');
    process.exit(1);
  }

  const markdown = fs.readFileSync(path.resolve(input), 'utf8');
  const title = /^#\s+(.*)$/m.exec(markdown)?.[1] ?? '';
  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${title} · `, font: FONT, size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '777777' })
                ]
              })
            ]
          })
        },
        children: convert(markdown)
      }
    ]
  });

  fs.writeFileSync(path.resolve(output), await Packer.toBuffer(doc));
  console.log(`saved ${path.resolve(output)}`);
}

void main();
