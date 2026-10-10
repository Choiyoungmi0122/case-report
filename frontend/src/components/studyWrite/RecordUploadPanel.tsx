import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { caseApi, StudyWriteImportedVisit, StudyWriteInspectResult } from '../../services/api';
import { buildVisitsFromSheet } from '../../utils/studyWriteImport';
import './RecordUploadPanel.css';

type RecordUploadPanelProps = {
  /** 만들어진 방문 목록을 입력 칸에 넣는다. */
  onApplyVisits: (visits: StudyWriteImportedVisit[], source: 'xlsx' | 'docx' | 'pdf', fileName: string) => void;
};

/**
 * 실험용 Write의 기록 올리기. xlsx는 시트와 열을 고르고, docx는 날짜 줄로 나눈 결과를
 * 확인한 뒤 "방문 기록으로 넣기"를 누른다. 넣은 뒤에는 기존 입력 칸에서 고칠 수 있다.
 */
export default function RecordUploadPanel({ onApplyVisits }: RecordUploadPanelProps) {
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudyWriteInspectResult | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [dateColumn, setDateColumn] = useState(-1);
  const [textColumns, setTextColumns] = useState<number[]>([]);
  const [mergeSameDate, setMergeSameDate] = useState(true);

  const sheet = result?.kind === 'xlsx' ? result.sheets[sheetIndex] : null;

  const previewVisits = useMemo<StudyWriteImportedVisit[]>(() => {
    if (!result) return [];
    if (result.kind === 'docx' || result.kind === 'pdf') return result.visits;
    if (!sheet || textColumns.length === 0) return [];
    return buildVisitsFromSheet({ sheet, dateColumn, textColumns, mergeSameDate });
  }, [result, sheet, dateColumn, textColumns, mergeSameDate]);

  const resetForSheet = (next: StudyWriteInspectResult, index: number) => {
    if (next.kind !== 'xlsx') return;
    const target = next.sheets[index];
    setSheetIndex(index);
    setDateColumn(target.guessedDateColumn);
    setTextColumns(target.headers.map((_, column) => column).filter((column) => column !== target.guessedDateColumn));
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setInspecting(true);
    try {
      const next = await caseApi.inspectStudyWriteFile(file);
      setResult(next);
      if (next.kind === 'xlsx') resetForSheet(next, 0);
    } catch (nextError: any) {
      setResult(null);
      setError(nextError?.response?.data?.error || nextError?.message || '파일을 읽지 못했습니다.');
    } finally {
      setInspecting(false);
    }
  };

  const toggleTextColumn = (column: number) => {
    setTextColumns((prev) => (prev.includes(column) ? prev.filter((item) => item !== column) : [...prev, column].sort((a, b) => a - b)));
  };

  const missingDates = previewVisits.filter((visit) => !visit.date).length;

  return (
    <section className="record-upload" aria-labelledby="record-upload-title">
      <div className="record-upload__head">
        <div>
          <h3 id="record-upload-title">기록 파일 올리기</h3>
          <p>
            엑셀(xlsx), 워드(docx), 글자가 있는 PDF 파일을 올리면 방문별 기록으로 나눠 아래 입력 칸에 넣습니다. 스캔한 이미지
            PDF는 읽지 못합니다. 올린 파일은 저장하지 않고, 분석 전에 환자 식별 정보는 가려집니다.
          </p>
        </div>
        <label className="record-upload__file">
          <input type="file" accept=".xlsx,.docx,.pdf" onChange={handleFile} disabled={inspecting} />
          {inspecting ? '읽는 중…' : '파일 선택'}
        </label>
      </div>

      {error ? <div className="record-upload__error">{error}</div> : null}

      {result?.kind === 'xlsx' && sheet ? (
        <div className="record-upload__mapping">
          <div className="record-upload__row">
            <label>
              <span>시트</span>
              <select value={sheetIndex} onChange={(event) => resetForSheet(result, Number(event.target.value))}>
                {result.sheets.map((item, index) => (
                  <option key={item.name} value={index}>
                    {item.name} ({item.rowCount}행)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>날짜 열</span>
              <select value={dateColumn} onChange={(event) => setDateColumn(Number(event.target.value))}>
                <option value={-1}>없음 (날짜는 직접 입력)</option>
                {sheet.headers.map((header, column) => (
                  <option key={column} value={column}>
                    {header || `열 ${column + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="record-upload__check">
              <input type="checkbox" checked={mergeSameDate} onChange={(event) => setMergeSameDate(event.target.checked)} />
              <span>같은 날짜의 행은 한 방문으로 합치기</span>
            </label>
          </div>

          <div className="record-upload__columns">
            <span>기록으로 넣을 열 (여러 개 가능, 열 이름이 앞에 붙습니다)</span>
            <div>
              {sheet.headers.map((header, column) => (
                <label key={column} className={column === dateColumn ? 'is-date' : ''}>
                  <input
                    type="checkbox"
                    checked={textColumns.includes(column)}
                    disabled={column === dateColumn}
                    onChange={() => toggleTextColumn(column)}
                  />
                  <span>{header || `열 ${column + 1}`}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="record-upload__sample">
            <table>
              <thead>
                <tr>
                  {sheet.headers.map((header, column) => (
                    <th key={column} className={column === dateColumn ? 'is-date' : textColumns.includes(column) ? 'is-text' : ''}>
                      {header || `열 ${column + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 3).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {sheet.headers.map((_, column) => (
                      <td key={column}>{(row[column] || '').slice(0, 60)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.truncated ? <p>행이 많아 앞 2000행만 읽었습니다.</p> : null}
          </div>
        </div>
      ) : null}

      {result?.kind === 'docx' || result?.kind === 'pdf' ? (
        <div className="record-upload__mapping">
          {result.warnings?.map((warning) => (
            <p key={warning} className="record-upload__warning">
              {warning}
            </p>
          ))}
          <p>
            {result.splitBy === 'none'
              ? '날짜가 적힌 줄을 찾지 못해 한 방문으로 넣습니다. 넣은 뒤 "방문 추가"로 나눌 수 있습니다.'
              : result.splitBy === 'month_day'
                ? `월/일만 적힌 줄을 기준으로 ${result.visits.length}개 방문으로 나눴습니다. 연도는 올해로 넣었으니 확인해 주세요.`
                : `날짜 줄을 기준으로 ${result.visits.length}개 방문으로 나눴습니다.`}
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="record-upload__preview">
          <div className="record-upload__preview-head">
            <strong>방문 {previewVisits.length}개</strong>
            {missingDates > 0 ? <span>날짜를 못 읽은 방문 {missingDates}개 (넣은 뒤 직접 입력)</span> : null}
            <button
              type="button"
              className="record-upload__apply"
              disabled={previewVisits.length === 0}
              onClick={() => onApplyVisits(previewVisits, result.kind, result.fileName)}
            >
              방문 기록으로 넣기
            </button>
          </div>
          {result.kind === 'pdf' ? (
            <details className="record-upload__rawtext">
              <summary>PDF에서 읽은 글 전체 보기 (깨진 글자가 없는지 확인)</summary>
              <pre>{result.text.slice(0, 6000)}{result.text.length > 6000 ? ' …' : ''}</pre>
            </details>
          ) : null}
          {previewVisits.slice(0, 2).map((visit, index) => (
            <div key={index} className="record-upload__visit">
              <span>{visit.date ? visit.date.replace('T', ' ') : '날짜 없음'}</span>
              <pre>{visit.soapText.slice(0, 400)}{visit.soapText.length > 400 ? ' …' : ''}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
