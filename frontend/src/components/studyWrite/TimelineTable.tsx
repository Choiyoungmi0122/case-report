import { renderClinicalAnonymizedText } from '../../utils/publicationRenderer';
import './TimelineTable.css';

/**
 * 타임라인 초안("날짜 | 경과 요약 | 진단 검사 | 치료 개입" 행)을 CARE 타임라인 표로 보여 준다.
 * 옛 형식("날짜 | 사건")도 받는다. 행이 두 개 미만이면 null 을 돌려 주어 호출부가 본문으로 보여 준다.
 */
export function parseTimelineRows(text: string): { headers: string[]; rows: string[][] } | null {
  const rows = renderClinicalAnonymizedText(text || '')
    .split('\n')
    .map((line) => line.replace(/^[-*•\s]+/, '').trim())
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2 && cells.some(Boolean));
  if (rows.length < 2) return null;
  const columnCount = Math.max(...rows.map((cells) => cells.length));
  const headers =
    columnCount >= 4
      ? ['날짜', '경과 요약', '진단 검사', '치료 개입']
      : columnCount === 3
        ? ['날짜', '경과 요약', '치료 개입']
        : ['날짜', '사건'];
  return {
    headers,
    rows: rows.map((cells) =>
      headers.map((_, index) => (index < headers.length - 1 ? cells[index] || '' : cells.slice(index).join(' | ')))
    )
  };
}

export default function TimelineTable({ text }: { text: string }) {
  const parsed = parseTimelineRows(text);
  if (!parsed) return null;
  return (
    <table className="sw-timeline-table">
      <thead>
        <tr>
          {parsed.headers.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {parsed.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell || '-'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
