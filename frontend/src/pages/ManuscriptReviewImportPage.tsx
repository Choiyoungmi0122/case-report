import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { manuscriptReviewApi } from '../services/api';
import './ManuscriptReviewImportPage.css';

export default function ManuscriptReviewImportPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!file) {
      setError('.docx 파일을 선택해 주세요.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const result = await manuscriptReviewApi.importDocx(file);
      navigate(`/manuscript-review/${result.reviewId}`);
    } catch (nextError: any) {
      setError(nextError?.message || 'Word 원고를 불러오지 못했습니다.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="manuscript-review-import-page">
      <div className="manuscript-review-import-container">
        <div className="manuscript-review-import-header">
          <button type="button" className="manuscript-review-link" onClick={() => navigate('/')}>
            EMR 모드로 돌아가기
          </button>
          <h1>Word 원고 CARE 검토 모드</h1>
          <p>
            기존에 작성한 .docx 증례보고 원고를 업로드하면, 문서 구조를 CARE 섹션 기준으로 나눈 뒤
            guideline completeness를 검토합니다.
          </p>
        </div>

        <div className="manuscript-review-import-card">
          <h2>.docx 업로드</h2>
          <p>이 모드는 EMR evidence 생성이 아니라, 기존 원고의 CARE completeness review 전용입니다.</p>

          <label className="manuscript-review-file-picker">
            <span>{file ? file.name : '.docx 파일 선택'}</span>
            <input
              type="file"
              accept=".docx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>

          {error ? <div className="manuscript-review-error">{error}</div> : null}

          <div className="manuscript-review-import-actions">
            <button
              type="button"
              className="manuscript-review-primary"
              onClick={() => void handleSubmit()}
              disabled={isUploading}
            >
              {isUploading ? '업로드 중...' : '업로드 후 검토 시작'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
