import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, Case, SectionOverview } from '../services/api';
import './CaseOverviewPage.css';

const QUESTION_STAGE_SECTIONS = [
  'PATIENT_INFORMATION',
  'CLINICAL_FINDINGS',
  'TIMELINE',
  'DIAGNOSTIC_ASSESSMENT',
  'THERAPEUTIC_INTERVENTIONS',
  'FOLLOW_UP_OUTCOMES',
  'PATIENT_PERSPECTIVE'
] as const;

const FINAL_STAGE_SECTIONS = [
  'TITLE',
  'KEYWORDS',
  'ABSTRACT',
  'INTRODUCTION',
  'DISCUSSION_CONCLUSION',
  'INFORMED_CONSENT'
] as const;

const STATUS_LABELS: Record<string, string> = {
  IMPOSSIBLE: '불가',
  INCOMPLETE: '보완 필요',
  READY: '초안 가능',
  PARTIAL_IMPOSSIBLE: '보완 필요',
  PARTIAL_POSSIBLE: '보완 필요',
  POSSIBLE: '보완 필요',
  FULLY_POSSIBLE: '초안 가능',
  AUTO: '자동 생성'
};

const STATUS_COLORS: Record<string, string> = {
  IMPOSSIBLE: '#dc3545',
  INCOMPLETE: '#f0ad4e',
  READY: '#28a745',
  PARTIAL_IMPOSSIBLE: '#f0ad4e',
  PARTIAL_POSSIBLE: '#f0ad4e',
  POSSIBLE: '#f0ad4e',
  FULLY_POSSIBLE: '#28a745',
  AUTO: '#6c757d'
};

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  KEYWORDS: '키워드',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 결과',
  DISCUSSION_CONCLUSION: '고찰 및 결론',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '사전 동의'
};

function hasCanonicalSectionOutputs(caseData: Case | null): boolean {
  if (!caseData) return false;
  return Boolean(caseData.sectionStates?.length || caseData.sectionDrafts?.length || caseData.finalDraft);
}

export default function CaseOverviewPage() {
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

    void loadData();
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

  const displaySections = sections.length > 0 ? sections : [];
  const questionStageSections = displaySections.filter((section) =>
    QUESTION_STAGE_SECTIONS.includes(section.section as (typeof QUESTION_STAGE_SECTIONS)[number])
  );
  const finalStageSections = FINAL_STAGE_SECTIONS.map((sectionId) => {
    const existing = displaySections.find((section) => section.section === sectionId);
    return {
      section: sectionId,
      status: existing?.status || 'AUTO',
      rationaleText:
        existing?.rationaleText ||
        '이 섹션은 본문 보완이 충분히 끝난 뒤 최종 원고 생성 단계에서 자동으로 작성됩니다.',
      draftSnippet: existing?.draftSnippet || ''
    };
  });

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
                홈으로
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
                  title="제목 수정"
                >
                  수정
                </button>
                <h1>{caseData?.title || 'CARE 섹션 목록'}</h1>
              </div>
            )}
            <p className="case-id">Case ID: {caseId}</p>
          </div>
        </div>

        {questionStageSections.length === 0 ? (
          <div className="empty-sections-state">
            {hasCanonicalSectionOutputs(caseData)
              ? '현재 표시할 질문 단계 섹션이 없습니다.'
              : '아직 섹션 초안이 생성되지 않았습니다. 초기 처리를 다시 확인해 주세요.'}
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>질문 및 보완 섹션</h2>
              <p style={{ margin: 0, color: '#6c757d' }}>
                본문 초안을 보완하는 질문은 아래 섹션에서만 진행됩니다.
              </p>
            </div>

            <div className="sections-grid">
              {questionStageSections.map((section) => (
                <div
                  key={section.section}
                  className="section-card"
                  onClick={() => navigate(`/cases/${caseId}/sections/${section.section}`)}
                >
                  <div className="section-header">
                    <h3>{SECTION_NAMES[section.section] || section.section}</h3>
                    <span
                      className="status-badge"
                      style={{ backgroundColor: STATUS_COLORS[section.status] || '#6c757d' }}
                    >
                      {STATUS_LABELS[section.status] || section.status}
                    </span>
                  </div>

                  <div className="section-rationale">
                    <strong>판정 근거:</strong>
                    <p>{section.rationaleText}</p>
                  </div>

                  {section.draftSnippet ? (
                    <div className="section-draft-preview">
                      <strong>초안 미리보기:</strong>
                      <p>{section.draftSnippet}...</p>
                    </div>
                  ) : null}

                  <div className="section-footer">
                    <span className="click-hint">클릭하여 상세 보기</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '32px' }}>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px' }}>최종 자동 생성 섹션</h2>
              <p style={{ margin: '0 0 16px', color: '#6c757d' }}>
                제목, 키워드, 초록, 서론, 토론, 동의 문구는 본문 보완 후 최종 원고 단계에서 자동 생성됩니다.
              </p>

              <div className="sections-grid">
                {finalStageSections.map((section) => (
                  <div
                    key={section.section}
                    className="section-card"
                    style={{ cursor: 'default', opacity: 0.92 }}
                  >
                    <div className="section-header">
                      <h3>{SECTION_NAMES[section.section] || section.section}</h3>
                      <span
                        className="status-badge"
                        style={{ backgroundColor: STATUS_COLORS[section.status] || '#6c757d' }}
                      >
                        {STATUS_LABELS[section.status] || section.status}
                      </span>
                    </div>

                    <div className="section-rationale">
                      <strong>생성 방식:</strong>
                      <p>{section.rationaleText}</p>
                    </div>

                    {section.draftSnippet ? (
                      <div className="section-draft-preview">
                        <strong>생성 결과 미리보기:</strong>
                        <p>{section.draftSnippet}...</p>
                      </div>
                    ) : null}

                    <div className="section-footer">
                      <span className="click-hint">최종 원고 화면에서 확인</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
