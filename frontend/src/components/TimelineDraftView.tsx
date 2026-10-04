import { TimelineEvent } from '../services/api';
import { formatSectionDraftForDisplay } from '../utils/sectionDraftFormatter';
import { DEFAULT_TIMELINE_COLUMNS } from '../utils/uiLabels';
import './TimelineDraftView.css';

function renderTimelineCell(value?: string | number | null) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function getTimelineColumns(events: TimelineEvent[]) {
  const explicit = events.find(
    (event) => Array.isArray(event.columnOrder) && event.columnOrder.length > 0
  )?.columnOrder;
  if (explicit && explicit.length > 0) return explicit;
  return DEFAULT_TIMELINE_COLUMNS;
}

function getTimelineCellValue(event: TimelineEvent, header: string) {
  if (event.cells && header in event.cells) {
    return renderTimelineCell(event.cells[header]);
  }

  switch (header) {
    case '시점':
      return renderTimelineCell(event.date);
    case '방문차수':
      return renderTimelineCell(event.visitNo);
    case '주요 증상':
      return renderTimelineCell(event.symptom);
    case '검사/평가':
      return renderTimelineCell(event.test);
    case '진단/판단':
      return renderTimelineCell(event.diagnosis);
    case '치료':
      return renderTimelineCell(event.treatment);
    case '경과':
      return renderTimelineCell(event.outcome);
    case '비고':
      return renderTimelineCell(event.note);
    default:
      return '-';
  }
}

function isImportedTimelineDivider(line: string) {
  const value = line.trim();
  return (
    value === '가져온 타임라인' ||
    value === '가져온 타임라인 데이터' ||
    value === 'Imported structured timeline narrative' ||
    value === 'Imported timeline table'
  );
}

function splitTimelineDraft(rawText: string) {
  const normalizedRaw = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = normalizedRaw.split('\n');
  const importedLabelIndex = lines.findIndex((line) => isImportedTimelineDivider(line));

  if (importedLabelIndex < 0) {
    return {
      narrativeText: formatSectionDraftForDisplay('TIMELINE', rawText),
      importedText: ''
    };
  }

  const narrativeText = formatSectionDraftForDisplay(
    'TIMELINE',
    lines.slice(0, importedLabelIndex).join('\n').trim()
  );
  const importedText = lines.slice(importedLabelIndex + 1).join('\n').trim();

  return {
    narrativeText,
    importedText
  };
}

export default function TimelineDraftView({
  rawText,
  events,
  showImportedTable = true,
  importedTitle = '가져온 타임라인 데이터'
}: {
  rawText: string;
  events: TimelineEvent[];
  showImportedTable?: boolean;
  importedTitle?: string;
}) {
  const { narrativeText, importedText } = splitTimelineDraft(rawText);
  const timelineColumns = getTimelineColumns(events || []);

  return (
    <div className="timeline-draft-view">
      {narrativeText ? <div className="timeline-draft-narrative">{narrativeText}</div> : null}

      {showImportedTable && events.length > 0 ? (
        <div className="timeline-draft-table-block">
          <div className="timeline-draft-table-title">{importedTitle}</div>
          <div className="timeline-draft-table-wrap">
            <table className="timeline-draft-table">
              <thead>
                <tr>
                  {timelineColumns.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.timelineEventId}>
                    {timelineColumns.map((header) => (
                      <td key={`${event.timelineEventId}-${header}`}>
                        {getTimelineCellValue(event, header)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {showImportedTable && events.length === 0 && importedText ? (
        <div className="timeline-draft-imported-fallback">
          <div className="timeline-draft-table-title">{importedTitle}</div>
          <div className="timeline-draft-narrative">{importedText}</div>
        </div>
      ) : null}
    </div>
  );
}
