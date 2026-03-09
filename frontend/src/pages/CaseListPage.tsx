import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { caseApi, Case } from '../services/api';
import './CaseListPage.css';

function CaseListPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCases();
  }, []);

  const loadCases = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await caseApi.getAllCases();
      setCases(data.cases);
    } catch (err: any) {
      setError(err.message || '케이스를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleCaseClick = (caseId: string) => {
    navigate(`/cases/${caseId}`);
  };

  if (loading) {
    return (
      <div className="case-list-page">
        <div className="container">
          <div className="loading">로딩 중...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="case-list-page">
      <div className="container">
        <div className="header">
          <h1>저장된 케이스</h1>
          <button onClick={() => navigate('/')} className="btn-back">
            ← 첫 페이지로
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {cases.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>저장된 케이스가 없습니다.</p>
            <button onClick={() => navigate('/input')} className="btn-primary">
              새 EMR 입력하기
            </button>
          </div>
        ) : (
          <div className="cases-list">
            {cases.map((case_) => (
              <div
                key={case_.id}
                className="case-card"
                onClick={() => handleCaseClick(case_.id)}
              >
                <div className="case-header">
                  <h3>{case_.title || '제목 없음'}</h3>
                  <span className="case-date">{formatDate(case_.createdAt)}</span>
                </div>
                <div className="case-info">
                  <span className="info-item">
                    방문 횟수: {case_.visits.length}회
                  </span>
                  {case_.sectionStatusMap && (
                    <span className="info-item">
                      섹션 수: {Object.keys(case_.sectionStatusMap).length}개
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CaseListPage;
