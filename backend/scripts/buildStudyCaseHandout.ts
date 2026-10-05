/**
 * 참가자에게 인쇄해 나눠 줄 가상환자 진료기록(DOCX)을 만든다.
 * 본문은 docs/study_case_emr_68F_v1/*.txt 를 그대로 옮긴다. 시스템의
 * "실험 사례 불러오기"와 같은 내용이어야 하므로 여기서 문장을 고치지 않는다.
 *
 * 실행: npx tsx scripts/buildStudyCaseHandout.ts
 */
import fs from 'fs';
import path from 'path';
import {
  AlignmentType,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';

const FONT = '맑은 고딕';
const SOURCE_DIR = path.resolve(__dirname, '../../docs/study_case_emr_68F_v1');
const OUTPUT = path.resolve(__dirname, '../../docs/가상환자_진료기록_참가자용_v1.docx');

const VISITS = [
  { file: '1차_2026-03-11.txt', label: '1회차', kind: '초진', date: '2026년 3월 11일' },
  { file: '2차_2026-03-13.txt', label: '2회차', kind: '재진', date: '2026년 3월 13일' },
  { file: '3차_2026-03-18.txt', label: '3회차', kind: '재진', date: '2026년 3월 18일' },
  { file: '4차_2026-04-01.txt', label: '4회차', kind: '재진', date: '2026년 4월 1일' },
  { file: '5차_2026-04-15.txt', label: '5회차', kind: '재진', date: '2026년 4월 15일' },
  { file: '6차_2026-05-27.txt', label: '6회차', kind: '재진', date: '2026년 5월 27일' }
];

// 기록 안의 소제목. 본문과 구분되도록 굵게 한다.
const SUBHEADINGS = new Set(['진단명', '주소증', '발병 및 경과', '과거력 및 기타', '경과', '처치 및 시술', '처방']);

function run(text: string, options: { bold?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({ text, font: FONT, size: options.size ?? 21, bold: options.bold, color: options.color });
}

function cell(text: string, bold = false) {
  return new TableCell({
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({ children: [run(text, { bold })] })]
  });
}

function visitParagraphs(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return new Paragraph({ spacing: { after: 0 }, children: [run('', { size: 12 })] });
      if (SUBHEADINGS.has(trimmed)) {
        return new Paragraph({ spacing: { before: 140, after: 60 }, children: [run(trimmed, { bold: true, size: 22 })] });
      }
      const isListItem = /^(•|\d+\.)\s/.test(trimmed);
      return new Paragraph({
        spacing: { after: 50, line: 320 },
        indent: isListItem ? { left: 280, hanging: 280 } : undefined,
        children: [run(trimmed)]
      });
    });
}

async function main() {
  const children: Array<Paragraph | Table> = [
    new Paragraph({ spacing: { after: 120 }, children: [run('가상환자 진료기록', { bold: true, size: 36 })] }),
    new Paragraph({
      spacing: { after: 60 },
      children: [run('한방신경정신과 외래 · 68세 여자 · 6회 방문 (2026년 3월 11일 ~ 5월 27일)', { size: 22 })]
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        run('이 기록은 연구를 위해 만든 가상환자의 진료기록이며, 실제 환자의 정보가 아닙니다.', {
          size: 20,
          color: '555555'
        })
      ]
    }),
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [cell('방문', true), cell('구분', true), cell('날짜', true)] }),
        ...VISITS.map((visit) => new TableRow({ children: [cell(visit.label), cell(visit.kind), cell(visit.date)] }))
      ]
    }),
    new Paragraph({ spacing: { before: 240, after: 0 }, children: [run('실험번호: ________________', { size: 22 })] })
  ];

  VISITS.forEach((visit) => {
    const text = fs.readFileSync(path.join(SOURCE_DIR, visit.file), 'utf8');
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        spacing: { after: 160 },
        border: { bottom: { style: 'single', size: 8, color: '333333', space: 4 } },
        children: [run(`${visit.label} · ${visit.kind} · ${visit.date}`, { bold: true, size: 28 })]
      }),
      ...visitParagraphs(text)
    );
  });

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1100, bottom: 1100, left: 1200, right: 1200 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  run('가상환자 진료기록 · ', { size: 16, color: '777777' }),
                  new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '777777' })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  });

  fs.writeFileSync(OUTPUT, await Packer.toBuffer(doc));
  console.log(`saved ${OUTPUT}`);
}

void main();
