import CaseInputPage from './CaseInputPage';
import { useNavigate } from 'react-router-dom';

export default function ScaffoldEntryPage() {
  const navigate = useNavigate();

  return (
    <>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          justifyContent: 'center',
          padding: '10px 16px',
          background: '#eef8f1',
          borderBottom: '1px solid #cfe6d6'
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 1120,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            color: '#17324d',
            fontSize: 14
          }}
        >
          <span>실험 참가자는 실험번호 입력 화면에서 시작해 주세요.</span>
          <button
            type="button"
            onClick={() => navigate('/study/scaffold')}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '8px 12px',
              background: '#23663a',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            실험용 Scaffold 시작
          </button>
        </div>
      </div>
      <CaseInputPage mode="scaffold" />
    </>
  );
}
