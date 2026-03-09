import { useNavigate } from 'react-router-dom';
import './HomePage.css';

function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="home-page">
      <div className="container">
        <h1>EMR 기반 증례보고 작성 지원 도구</h1>

        <div className="options-grid">
          <div className="option-card" onClick={() => navigate('/input')}>
            <div className="option-icon">📝</div>
            <h2>새 EMR 입력</h2>
            <p>새로운 EMR 정보를 입력하여 증례보고서를 작성합니다.</p>
          </div>

          <div className="option-card" onClick={() => navigate('/cases')}>
            <div className="option-icon">📋</div>
            <h2>저장된 케이스</h2>
            <p>이전에 저장한 케이스를 확인하고 계속 작성합니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
