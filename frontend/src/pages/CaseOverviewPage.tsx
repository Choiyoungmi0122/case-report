import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseApi, SectionOverview, Case } from '../services/api';
import './CaseOverviewPage.css';

const STATUS_LABELS: Record<string, string> = {
  IMPOSSIBLE: '불가',
  PARTIAL_IMPOSSIBLE: '부분 불가',
  PARTIAL_POSSIBLE: '부분 가능',
  POSSIBLE: '가능',
  FULLY_POSSIBLE: '완전 가능'
};

const STATUS_COLORS: Record<string, string> = {
  IMPOSSIBLE: '#dc3545',
  PARTIAL_IMPOSSIBLE: '#fd7e14',
  PARTIAL_POSSIBLE: '#ffc107',
  POSSIBLE: '#17a2b8',
  FULLY_POSSIBLE: '#28a745'
};

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '요약',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 결과',
  DISCUSSION_CONCLUSION: '토론 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '동의'
};

const CARE_SECTION_ORDER = [
  'TITLE',
  'ABSTRACT',
  'INTRODUCTION',
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'DISCUSSION_CONCLUSION',
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT'
];

const AI_GUIDELINE_NAMES: Record<string, string> = {
  patient_information: '환자 정보',
  clinical_findings: '임상 소견',
  timeline: '타임라인',
  diagnostic_assessment: '진단 평가',
  therapeutic_intervention: '치료 중재',
  follow_up_outcomes: '추적 관찰 결과',
  patient_perspective: '환자 관점'
};

function CaseOverviewPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [sections, setSections] = useState<SectionOverview[]>([]);
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  useEffect(() => {
    if (!caseId) return;

    const loadData = async () => {
      try {
        const [sectionsData, caseDataResult] = await Promise.all([
          caseApi.getSections(caseId),
          caseApi.getCase(caseId)
        ]);
        setSections(sectionsData.sections);
        setCaseData(caseDataResult);
        setTitleValue(caseDataResult.title || 'CARE 섹션 목록');
      } catch (err: any) {
        setError(err.message || '데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [caseId]);

  const handleSaveTitle = async () => {
    if (!caseId) return;
    
    setIsSavingTitle(true);
    try {
      await caseApi.updateCaseTitle(caseId, titleValue);
      if (caseData) {
        setCaseData({ ...caseData, title: titleValue });
      }
      setIsEditingTitle(false);
    } catch (err: any) {
      setError(err.message || '제목 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleCancelEdit = () => {
    setTitleValue(caseData?.title || 'CARE 섹션 목록');
    setIsEditingTitle(false);
  };

  const aiFinalSections = caseData?.aiPipeline?.chain7?.final_sections || {};
  const aiSectionEntries = Object.entries(aiFinalSections).filter(
    ([, value]) => typeof value === 'string' && value.trim().length > 0
  );

  const aiToCareSection: Record<string, string> = {
    patient_information: 'PATIENT_INFORMATION',
    clinical_findings: 'CLINICAL_FINDINGS',
    timeline: 'TIMELINE',
    diagnostic_assessment: 'DIAGNOSTIC_ASSESSMENT',
    therapeutic_intervention: 'THERAPEUTIC_INTERVENTIONS',
    follow_up_outcomes: 'FOLLOW_UP_OUTCOMES',
    patient_perspective: 'PATIENT_PERSPECTIVE'
  };

  const fallbackSections: SectionOverview[] = CARE_SECTION_ORDER.map((sectionId) => {
    const aiKey = Object.keys(aiToCareSection).find((k) => aiToCareSection[k] === sectionId);
    const text = aiKey ? (aiFinalSections as any)[aiKey] || '' : '';
    return {
      section: sectionId,
      status: text ? 'FULLY_POSSIBLE' : 'IMPOSSIBLE',
      rationaleText: text ? 'AI 파이프라인 결과로 작성됨.' : '입력 데이터가 부족하여 비어 있음.',
      draftSnippet: typeof text === 'string' ? text.slice(0, 200) : ''
    };
  });

  const displaySections = sections.length > 0 ? sections : fallbackSections;

  if (loading) {
    return (
      <div className="case-overview-page">
        <div className="container">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="case-overview-page">
        <div className="container">
          <div className="error-message">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="case-overview-page">
      <div className="container">
        <div className="header">
          <div className="header-top">
            <div className="header-top-actions">
              <button onClick={() => navigate('/')} className="btn-home">
                ← 첫 페이지로
              </button>
              <button
                onClick={() => navigate(`/cases/${caseId}/manuscript`)}
                className="btn-manuscript"
              >
                최종 원고 보기
              </button>
            </div>
          </div>
          <div className="header-title-section">
            {isEditingTitle ? (
              <div className="title-edit-box">
                <input
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  className="title-input"
                  placeholder="케이스 제목을 입력하세요"
                  autoFocus
                />
                <div className="title-edit-actions">
                  <button
                    onClick={handleSaveTitle}
                    disabled={isSavingTitle || !titleValue.trim()}
                    className="btn-save-title"
                  >
                    {isSavingTitle ? '저장 중...' : '저장'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSavingTitle}
                    className="btn-cancel-title"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div className="title-display-box">
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className="btn-edit-title"
                  title="제목 편집"
                >
                  ✏️
                </button>
                <h1>{caseData?.title || 'CARE 섹션 목록'}</h1>
              </div>
            )}
            <p className="case-id">Case ID: {caseId}</p>
          </div>
        </div>

        {aiSectionEntries.length > 0 && (
          <div className="ai-sections-fallback">
            <h3>AI 생성 섹션 미리보기</h3>
            <div className="ai-sections-grid">
              {aiSectionEntries.map(([key, value]) => (
                <div key={key} className="ai-section-card">
                  <h4>{AI_GUIDELINE_NAMES[key] || SECTION_NAMES[key] || key}</h4>
                  <p>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="sections-grid">
          {displaySections.map((section) => (
            <div
              key={section.section}
              className="section-card"
              onClick={() => navigate(`/cases/${caseId}/sections/${section.section}`)}
            >
              <div className="section-header">
                <h3>{SECTION_NAMES[section.section] || section.section}</h3>
                <span
                  className="status-badge"
                  style={{ backgroundColor: STATUS_COLORS[section.status] }}
                >
                  {STATUS_LABELS[section.status]}
                </span>
              </div>

              <div className="section-rationale">
                <strong>판정 근거:</strong>
                <p>{section.rationaleText}</p>
              </div>

              {section.draftSnippet && (
                <div className="section-draft-preview">
                  <strong>초안 미리보기:</strong>
                  <p>{section.draftSnippet}...</p>
                </div>
              )}

              <div className="section-footer">
                <span className="click-hint">클릭하여 상세 보기 →</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CaseOverviewPage;
