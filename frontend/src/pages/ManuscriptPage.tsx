import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { caseApi, Case, FinalDraft } from '../services/api';
import './ManuscriptPage.css';

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
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

const SECTION_ORDER = [
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

type ManuscriptSection = {
  id: string;
  label: string;
  text: string;
  status?: 'FULFILLED' | 'INSUFFICIENT' | 'MISSING';
  rationale?: string;
};

function ManuscriptPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState<Case | null>(null);
  const [finalDraft, setFinalDraft] = useState<FinalDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadManuscript = async (showRefreshState = false) => {
    if (!caseId) return;

    if (showRefreshState) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const caseResult = await caseApi.getCase(caseId);
      setCaseData(caseResult);
      if (caseResult.finalDraft && !showRefreshState) {
        setFinalDraft(caseResult.finalDraft);
        return;
      }

      const composeResult = await caseApi.composeFinalDraft(caseId);
      setFinalDraft(composeResult.finalDraft);
    } catch (err: any) {
      setError(err.message || '최종 원고를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadManuscript();
  }, [caseId]);

  const titleText = useMemo(() => {
    if (!finalDraft) return caseData?.title || '';
    return (
      finalDraft.fullTextBySection?.TITLE?.trim() ||
      caseData?.title?.trim() ||
      finalDraft.titleSuggestions?.[0] ||
      '증례보고 초안'
    );
  }, [caseData?.title, finalDraft]);

  const abstractText = useMemo(() => {
    if (!finalDraft) return '';
    return (
      finalDraft.fullTextBySection?.ABSTRACT?.trim() ||
      finalDraft.abstractSuggestion?.trim() ||
      ''
    );
  }, [finalDraft]);

  const manuscriptSections = useMemo<ManuscriptSection[]>(() => {
    if (!finalDraft) return [];

    return SECTION_ORDER.map((sectionId) => ({
      id: sectionId,
      label: SECTION_NAMES[sectionId] || sectionId,
      text: finalDraft.fullTextBySection?.[sectionId]?.trim() || '',
      status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
      rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale
    })).filter((section) => section.text);
  }, [finalDraft]);

  const insufficientSections = useMemo(() => {
    if (!finalDraft) return [];

    return SECTION_ORDER.map((sectionId) => ({
      id: sectionId,
      label: SECTION_NAMES[sectionId] || sectionId,
      status: finalDraft.careChecklistEvaluation?.[sectionId]?.status,
      rationale: finalDraft.careChecklistEvaluation?.[sectionId]?.rationale
    })).filter((section) => section.status && section.status !== 'FULFILLED');
  }, [finalDraft]);

  if (loading) {
    return (
      <div className="manuscript-page">
        <div className="manuscript-container">최종 원고를 생성하는 중...</div>
      </div>
    );
  }

  if (error || !finalDraft) {
    return (
      <div className="manuscript-page">
        <div className="manuscript-container">
          <div className="manuscript-error">{error || '최종 원고를 생성하지 못했습니다.'}</div>
          <div className="manuscript-error-actions">
            <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back-overview">
              섹션 개요로 돌아가기
            </button>
            <button onClick={() => loadManuscript(true)} className="btn-refresh-manuscript">
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="manuscript-page">
      <div className="manuscript-container">
        <div className="manuscript-toolbar">
          <div className="manuscript-toolbar-left">
            <button onClick={() => navigate(`/cases/${caseId}`)} className="btn-back-overview">
              ← 섹션 개요
            </button>
            <button
              onClick={() => loadManuscript(true)}
              className="btn-refresh-manuscript"
              disabled={isRefreshing}
            >
              {isRefreshing ? '원고 갱신 중...' : '최신 초안으로 다시 생성'}
            </button>
          </div>
          <div className="manuscript-toolbar-right">
            <span className="manuscript-status">현재까지 저장된 섹션 초안 기준</span>
          </div>
        </div>

        <div className="manuscript-layout">
          <aside className="manuscript-sidebar">
            <div className="manuscript-sidebar-card">
              <h3>문서 목차</h3>
              <nav className="manuscript-toc">
                {abstractText && (
                  <a href="#section-ABSTRACT" className="manuscript-toc-link">
                    초록
                  </a>
                )}
                {manuscriptSections.map((section) => (
                  <a
                    key={section.id}
                    href={`#section-${section.id}`}
                    className="manuscript-toc-link"
                  >
                    {section.label}
                  </a>
                ))}
              </nav>
            </div>

            {insufficientSections.length > 0 && (
              <div className="manuscript-sidebar-card">
                <h3>보완이 필요한 섹션</h3>
                <ul className="manuscript-warning-list">
                  {insufficientSections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        className="manuscript-inline-link"
                        onClick={() => navigate(`/cases/${caseId}/sections/${section.id}`)}
                      >
                        {section.label} 수정하기
                      </button>
                      {section.rationale && (
                        <p className="manuscript-warning-rationale">{section.rationale}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          <div className="manuscript-paper">
            <header className="manuscript-header">
              <p className="manuscript-kicker">전체 초안 검토</p>
              <h1>{titleText}</h1>
              {caseData?.title && caseData.title !== titleText && (
                <p className="manuscript-subtitle">케이스 제목: {caseData.title}</p>
              )}
            </header>

            <div className="manuscript-generation-note">
              제목, 초록, 서론, 토론 및 동의 문구는 현재까지 정리된 핵심 임상 섹션 초안을 바탕으로 생성됩니다.
              본문 섹션을 더 보완한 뒤 이 화면에서 다시 생성하면 전체 원고도 함께 갱신됩니다.
            </div>

            {abstractText && (
              <section id="section-ABSTRACT" className="manuscript-section manuscript-section-abstract">
                <div className="manuscript-section-heading">
                  <h2>초록</h2>
                </div>
                <div className="manuscript-body-text">{abstractText}</div>
              </section>
            )}

            {manuscriptSections.map((section) => (
              <section id={`section-${section.id}`} key={section.id} className="manuscript-section">
                <div className="manuscript-section-heading">
                  <div className="manuscript-section-heading-text">
                    <h2>{section.label}</h2>
                    {section.status && section.status !== 'FULFILLED' && (
                      <span className="manuscript-section-note">추가 보완 가능</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-edit-section"
                    onClick={() => navigate(`/cases/${caseId}/sections/${section.id}`)}
                  >
                    이 섹션 수정하기
                  </button>
                </div>
                <div className="manuscript-body-text">{section.text}</div>
              </section>
            ))}

            {finalDraft.titleSuggestions?.length > 0 && (
              <section className="manuscript-support-panel">
                <h3>제목 후보</h3>
                <ul>
                  {finalDraft.titleSuggestions.map((title, idx) => (
                    <li key={idx}>{title}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ManuscriptPage;
