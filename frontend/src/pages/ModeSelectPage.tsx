import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

const cardStyle: CSSProperties = {
  border: '1px solid #e2e5ea',
  borderRadius: 8,
  padding: 24,
  background: '#ffffff',
  boxShadow: '0 1px 3px rgba(16, 24, 40, 0.08), 0 1px 2px rgba(16, 24, 40, 0.04)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16
};

const bulletStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  lineHeight: 1.7,
  color: '#4b5563',
  fontSize: 14
};

const tagStyle: CSSProperties = {
  display: 'inline-flex',
  padding: '3px 8px',
  borderRadius: 4,
  background: '#f8f9fa',
  border: '1px solid #d3d8df',
  color: '#4b5563',
  fontSize: 12,
  fontWeight: 600
};

const buttonStyleBase: CSSProperties = {
  marginTop: 'auto',
  border: 'none',
  borderRadius: 6,
  padding: '11px 16px',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer'
};

export default function ModeSelectPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: '40px 20px'
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, marginBottom: 8, color: '#1f2733' }}>증례보고 작성 도구</h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#4b5563', maxWidth: 760 }}>
            사용할 작업 방식을 선택해 주세요. Scaffold는 교육과 자기 점검 중심, Write는 AI 작성 지원 중심으로 진행됩니다.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20
          }}
        >
          <section style={cardStyle}>
            <div>
              <div style={tagStyle}>Scaffold</div>
              <h2 style={{ marginTop: 14, marginBottom: 8, fontSize: 18, color: '#1f2733' }}>Scaffold</h2>
              <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.7, fontSize: 14 }}>
                CARE 구조를 이해하고, 기록 근거와 부족 정보를 확인한 뒤 AI 초안을 단계적으로 검토하는 교육용 모드입니다.
              </p>
            </div>
            <ul style={bulletStyle}>
              <li>CARE 구조 이해</li>
              <li>부족 정보 확인</li>
              <li>기록 근거 검토</li>
              <li>전문가 검토 항목 정리</li>
            </ul>
            <button
              type="button"
              onClick={() => navigate('/scaffold')}
              style={{ ...buttonStyleBase, background: '#2f8055' }}
            >
              일반 Scaffold 시작
            </button>
            <button
              type="button"
              onClick={() => navigate('/study/scaffold')}
              style={{
                border: '1px solid #23663a',
                borderRadius: 6,
                padding: '10px 16px',
                background: '#ffffff',
                color: '#23663a',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              실험용 Scaffold 시작
            </button>
          </section>

          <section style={cardStyle}>
            <div>
              <div style={tagStyle}>Write</div>
              <h2 style={{ marginTop: 14, marginBottom: 8, fontSize: 18, color: '#1f2733' }}>Write</h2>
              <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.7, fontSize: 14 }}>
                EMR/SOAP 기록을 바탕으로 AI가 증례보고 초안과 최종 원고 작성을 지원하는 작성 모드입니다.
              </p>
            </div>
            <ul style={bulletStyle}>
              <li>섹션별 초안 생성</li>
              <li>부족 질문 반영</li>
              <li>최종 원고 생성</li>
              <li>Word export</li>
            </ul>
            <button
              type="button"
              onClick={() => navigate('/study/write')}
              style={{
                border: '1px solid #2f6ea5',
                borderRadius: 6,
                padding: '10px 16px',
                background: '#ffffff',
                color: '#2f6ea5',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              실험용 Write 시작
            </button>
            <button
              type="button"
              onClick={() => navigate('/write')}
              style={{ ...buttonStyleBase, background: '#2f6ea5' }}
            >
              Write 시작
            </button>
          </section>

          <section style={cardStyle}>
            <div>
              <div style={tagStyle}>Research</div>
              <h2 style={{ marginTop: 14, marginBottom: 8, fontSize: 18, color: '#1f2733' }}>실험번호 조회</h2>
              <p style={{ margin: 0, color: '#4b5563', lineHeight: 1.7, fontSize: 14 }}>
                연구자가 실험번호(EQ003, SQ005, SQ-005, TEST-01 등)를 입력해 저장된 실험 이력과 export payload를 조회합니다.
              </p>
            </div>
            <ul style={bulletStyle}>
              <li>실험번호로 케이스 조회</li>
              <li>Scaffold / Write 연구 이력 확인</li>
              <li>비식별 연구 export 다운로드</li>
              <li>기존 작성 흐름 변경 없음</li>
            </ul>
            <button
              type="button"
              onClick={() => navigate('/research/history')}
              style={{ ...buttonStyleBase, background: '#7a4e00' }}
            >
              실험번호 조회
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
