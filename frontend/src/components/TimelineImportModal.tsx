import { useEffect, useMemo, useState } from 'react';
import { caseApi, TimelineImportResponse } from '../services/api';
import './TimelineImportModal.css';

type Props = {
  caseId: string;
  isOpen: boolean;
  onClose: () => void;
  onImported: (result: TimelineImportResponse) => Promise<void> | void;
};

export default function TimelineImportModal({ caseId, isOpen, onClose, onImported }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<TimelineImportResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setImportResult(null);
      setIsSubmitting(false);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const previewHeaders = useMemo(() => {
    const rows = importResult?.previewRows || [];
    const keys = new Set<string>();
    for (const row of rows) {
      Object.keys(row.values || {}).forEach((key) => keys.add(key));
    }
    return Array.from(keys);
  }, [importResult?.previewRows]);

  if (!isOpen) return null;

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await caseApi.importTimelineExcel(caseId, selectedFile);
      setImportResult(result);
      await onImported(result);
    } catch (nextError: any) {
      setError(nextError?.message || '타임라인 Excel 파일을 불러오지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="timeline-import-modal-backdrop" onClick={onClose}>
      <div className="timeline-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="timeline-import-modal-header">
          <div>
            <h2>타임라인 Excel 가져오기</h2>
            <p>.xlsx 파일을 올리면 Timeline 섹션을 구조화된 표 형태로 보강합니다.</p>
          </div>
          <button type="button" className="timeline-import-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="timeline-import-modal-body">
          <div className="timeline-import-upload-box">
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="timeline-import-submit"
              onClick={handleUpload}
              disabled={!selectedFile || isSubmitting}
            >
              {isSubmitting ? '가져오는 중...' : '가져오기 실행'}
            </button>
          </div>

          {error ? <div className="timeline-import-error">{error}</div> : null}

          {importResult ? (
            <div className="timeline-import-result">
              <div className="timeline-import-summary">
                <span>불러온 행 {importResult.importedRows}개</span>
                <span>건너뛴 행 {importResult.skippedRows}개</span>
                <span>인식한 컬럼 {importResult.detectedColumns.length}개</span>
              </div>

              <div className="timeline-import-panel">
                <h3>컬럼 매핑</h3>
                <div className="timeline-import-chip-list">
                  {Object.entries(importResult.columnMapping || {}).map(([field, header]) => (
                    <span key={field} className="timeline-import-chip">
                      {field}: {header}
                    </span>
                  ))}
                </div>
              </div>

              <div className="timeline-import-panel">
                <h3>미리보기 행</h3>
                {importResult.previewRows.length === 0 ? (
                  <div className="timeline-import-empty">미리보기 가능한 행이 없습니다.</div>
                ) : (
                  <div className="timeline-import-table-wrap">
                    <table className="timeline-import-table">
                      <thead>
                        <tr>
                          <th>행</th>
                          {previewHeaders.map((header) => (
                            <th key={header}>{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.previewRows.map((row) => (
                          <tr key={row.originalRowIndex}>
                            <td>{row.originalRowIndex}</td>
                            {previewHeaders.map((header) => (
                              <td key={header}>{row.values?.[header] || '-'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="timeline-import-panel">
                <h3>확인 메모</h3>
                {importResult.warnings.length === 0 ? (
                  <div className="timeline-import-empty">문제 없이 가져왔습니다.</div>
                ) : (
                  <ul className="timeline-import-warning-list">
                    {importResult.warnings.map((warning, index) => (
                      <li key={`${warning.rowIndex}-${index}`}>
                        행 {warning.rowIndex}: {warning.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
