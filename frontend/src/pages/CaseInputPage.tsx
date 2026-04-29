import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { caseApi, Visit, Case } from '../services/api';
import './CaseInputPage.css';

const INPUT_TAB = 'EMR 입력';
const HISTORY_TAB = '히스토리';
const FILTER_ALL = '전체';
const FILTER_THIS_WEEK = '이번 주';
const FILTER_THIS_MONTH = '이번 달';
const FILTER_DRAFT = '임시 저장';
const FILTER_TABS = [FILTER_ALL, FILTER_THIS_WEEK, FILTER_THIS_MONTH, FILTER_DRAFT];

function isProcessedCase(caseData: Case): boolean {
  return Boolean(caseData.sectionStates?.length || caseData.sectionDrafts?.length || caseData.finalDraft);
}

function createEmptyVisit(type: '초진' | '재진' = '초진'): Visit {
  return {
    type,
    date: new Date().toISOString().slice(0, 16),
    soapText: ''
  };
}

function CaseInputPage() {
  const navigate = useNavigate();

  const [visits, setVisits] = useState<Visit[]>([createEmptyVisit()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<string>(INPUT_TAB);
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>(FILTER_ALL);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showLoadDraftModal, setShowLoadDraftModal] = useState(false);
  const [draftCases, setDraftCases] = useState<Case[]>([]);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [currentDraftCaseId, setCurrentDraftCaseId] = useState<string | null>(null);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const visitRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevVisitsLength = useRef(visits.length);

  const normalizeVisits = (items: Visit[]) =>
    items.map((visit) => ({
      ...visit,
      soapText: visit.soapText.replace(/\\n/g, '\n')
    }));

  const resetInputForm = () => {
    setVisits([createEmptyVisit()]);
    setDraftTitle('');
    setCurrentDraftCaseId(null);
  };

  const validateVisits = (items: Visit[]) => {
    const hasEmptyText = items.some((visit) => !visit.soapText.trim());
    if (hasEmptyText) {
      throw new Error('모든 방문의 SOAP 기록을 입력해 주세요. 각 방문마다 최소 1글자 이상 필요합니다.');
    }
  };

  const addVisit = () => {
    setVisits((current) => [...current, createEmptyVisit('재진')]);
  };

  useEffect(() => {
    if (visits.length > prevVisitsLength.current) {
      const newIndex = visits.length - 1;
      setTimeout(() => {
        visitRefs.current[newIndex]?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }, 100);
    }
    prevVisitsLength.current = visits.length;
  }, [visits.length]);

  const removeVisit = (index: number) => {
    if (visits.length <= 1 || index === 0) return;

    const updated = visits.filter((_, i) => i !== index);
    const normalized = updated.map((visit, i) => ({
      ...visit,
      type: (i === 0 ? '초진' : '재진') as '초진' | '재진'
    }));
    setVisits(normalized);
  };

  const updateVisit = (index: number, field: keyof Visit, value: string) => {
    if (field === 'type') return;

    setVisits((current) => {
      const next = [...current];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const loadCases = async () => {
    try {
      setIsLoadingCases(true);
      const data = await caseApi.getAllCases();
      setCases(data.cases);
    } catch (err: any) {
      console.error('Failed to load cases:', err);
    } finally {
      setIsLoadingCases(false);
    }
  };

  const loadDraftCases = async () => {
    try {
      setIsLoadingDrafts(true);
      const data = await caseApi.getAllCases();
      setDraftCases(data.cases.filter((caseItem) => !isProcessedCase(caseItem)));
    } catch (err: any) {
      console.error('Failed to load draft cases:', err);
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  const handleLoadDraftClick = () => {
    setShowLoadDraftModal(true);
    void loadDraftCases();
  };

  const handleLoadDraft = (caseItem: Case) => {
    const loadedVisits: Visit[] = caseItem.visits.map((visit, index) => ({
      type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
      date: visit.date,
      soapText: visit.soapText || ''
    }));

    setVisits(loadedVisits.length > 0 ? loadedVisits : [createEmptyVisit()]);
    setDraftTitle(caseItem.title || '');
    setCurrentDraftCaseId(caseItem.id);
    setMainTab(INPUT_TAB);
    setShowLoadDraftModal(false);
    window.alert('임시 저장된 케이스를 불러왔습니다.');
  };

  const handleMainTabChange = (tab: string) => {
    setMainTab(tab);
    if (tab === HISTORY_TAB) {
      setSelectedFilter(FILTER_ALL);
      void loadCases();
    }
  };

  const handleCaseClick = (caseItem: Case) => {
    if (!isProcessedCase(caseItem)) {
      const loadedVisits: Visit[] = caseItem.visits.map((visit, index) => ({
        type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
        date: visit.date,
        soapText: visit.soapText || ''
      }));

      setMainTab(INPUT_TAB);
      setVisits(loadedVisits.length > 0 ? loadedVisits : [createEmptyVisit()]);
      setDraftTitle(caseItem.title || '');
      setCurrentDraftCaseId(caseItem.id);
      return;
    }

    navigate(`/cases/${caseItem.id}`);
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

  const getFilteredAndSortedCases = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const filtered = cases.filter((caseItem) => {
      const caseDate = new Date(caseItem.createdAt);
      const isDraft = !isProcessedCase(caseItem);

      switch (selectedFilter) {
        case FILTER_THIS_WEEK:
          return caseDate >= weekAgo && !isDraft;
        case FILTER_THIS_MONTH:
          return caseDate >= monthAgo && !isDraft;
        case FILTER_DRAFT:
          return isDraft;
        case FILTER_ALL:
        default:
          return true;
      }
    });

    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
  };

  const filteredCases = getFilteredAndSortedCases();

  const handleSaveDraftClick = () => {
    setShowSaveDraftModal(true);
  };

  const handleSaveDraft = async () => {
    setError(null);
    setIsSaving(true);

    try {
      validateVisits(visits);
      const normalizedVisits = normalizeVisits(visits);

      const { caseId } = await caseApi.createCase({
        visits: normalizedVisits,
        title: draftTitle.trim() || undefined,
        skipSanitize: true
      });

      setCurrentDraftCaseId(caseId);
      resetInputForm();
      setShowSaveDraftModal(false);
      window.alert('임시 저장되었습니다.');
    } catch (err: any) {
      setError(err.message || '임시 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasTextInput = () => visits.some((visit) => visit.soapText.trim().length > 0) || draftTitle.trim().length > 0;

  const deleteCaseById = async (caseId: string) => {
    try {
      await caseApi.deleteCase(caseId);

      if (mainTab === HISTORY_TAB) {
        await loadCases();
      }

      if (caseId === currentDraftCaseId) {
        resetInputForm();
      }

      window.alert('삭제했습니다.');
    } catch (err: any) {
      setError(err.message || '삭제 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteClick = (caseId?: string) => {
    if (caseId) {
      const shouldDelete = window.confirm('정말 이 케이스를 삭제하시겠습니까?');
      if (shouldDelete) {
        void deleteCaseById(caseId);
      }
      return;
    }

    if (currentDraftCaseId) {
      const shouldDelete = window.confirm('정말 이 임시 저장 케이스를 삭제하시겠습니까?');
      if (shouldDelete) {
        void deleteCaseById(currentDraftCaseId);
      }
      return;
    }

    if (hasTextInput()) {
      const shouldReset = window.confirm('입력한 내용을 모두 삭제하시겠습니까?');
      if (shouldReset) {
        resetInputForm();
      }
      return;
    }

    window.alert('삭제할 내용이 없습니다.');
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    setIsAiRunning(true);

    try {
      validateVisits(visits);
      const normalizedVisits = normalizeVisits(visits);
      const { caseId } = await caseApi.createCase({ visits: normalizedVisits });
      await caseApi.processCase(caseId);
      navigate(`/cases/${caseId}`);
    } catch (err: any) {
      setError(err.message || '처리 중 오류가 발생했습니다.');
    } finally {
      setIsAiRunning(false);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="case-input-page">
      {isSubmitting && (
        <div className="global-loading-overlay">
          <div className="global-loading-content">
            <div className="spinner" />
            <div className="global-loading-text">
              증례를 분석하고 CARE 섹션 초안을 생성하는 중입니다...
            </div>
          </div>
        </div>
      )}

      <div className="container">
        <div className="header">
          <h1>EMR 기반 증례보고 작성 지원 도구</h1>
        </div>

        <div className="main-tab-menu">
          <button
            className={`main-tab-item ${mainTab === INPUT_TAB ? 'active' : ''}`}
            onClick={() => handleMainTabChange(INPUT_TAB)}
          >
            EMR 입력
          </button>
          <button
            className={`main-tab-item ${mainTab === HISTORY_TAB ? 'active' : ''}`}
            onClick={() => handleMainTabChange(HISTORY_TAB)}
          >
            히스토리
          </button>
        </div>

        {mainTab === INPUT_TAB ? (
          <>
            <div className="visits-section">
              <div className="visits-header">
                <h2>방문 기록</h2>
                <div className="visits-header-buttons">
                  <button onClick={handleLoadDraftClick} className="btn-load-draft">
                    임시 저장 불러오기
                  </button>
                  <button onClick={addVisit} className="btn-add-visit">
                    + 방문 추가
                  </button>
                </div>
              </div>

              {visits.map((visit, index) => (
                <div
                  key={index}
                  className="visit-card"
                  ref={(el) => {
                    visitRefs.current[index] = el;
                  }}
                >
                  <div className="visit-header">
                    <div className="field-group">
                      <label>방문 {index + 1}</label>
                    </div>
                    <div className="field-group">
                      <label>방문 유형</label>
                      <select
                        value={index === 0 ? '초진' : '재진'}
                        disabled
                        className="disabled-select"
                      >
                        <option value="초진">초진</option>
                        <option value="재진">재진</option>
                      </select>
                    </div>
                    <div className="field-group">
                      <label>방문 일시</label>
                      <input
                        type="datetime-local"
                        value={visit.date}
                        onChange={(e) => updateVisit(index, 'date', e.target.value)}
                        min={index > 0 ? visits[index - 1].date : undefined}
                      />
                    </div>
                    {visits.length > 1 && index !== 0 && (
                      <button onClick={() => removeVisit(index)} className="btn-remove">
                        삭제
                      </button>
                    )}
                  </div>

                  <div className="field-group">
                    <label>SOAP 기록</label>
                    <textarea
                      value={visit.soapText}
                      onChange={(e) => updateVisit(index, 'soapText', e.target.value)}
                      placeholder="주관적 증상(Subjective), 객관적 소견(Objective), 평가(Assessment), 계획(Plan) 형식으로 입력해 주세요."
                      rows={8}
                    />
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="error-message">{error}</div>}

            {showSaveDraftModal && (
              <>
                <div className="modal-overlay" onClick={() => setShowSaveDraftModal(false)} />
                <div className="modal">
                  <div className="modal-header">
                    <h3>임시 저장</h3>
                    <button className="modal-close" onClick={() => setShowSaveDraftModal(false)}>
                      닫기
                    </button>
                  </div>
                  <div className="modal-content">
                    <div className="field-group">
                      <label>제목</label>
                      <input
                        type="text"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder="임시 저장할 케이스 제목을 입력하세요"
                        className="draft-title-input"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isSaving) {
                            void handleSaveDraft();
                          }
                        }}
                      />
                    </div>
                    <div className="modal-actions">
                      <button
                        onClick={() => setShowSaveDraftModal(false)}
                        className="btn-cancel"
                        disabled={isSaving}
                      >
                        취소
                      </button>
                      <button onClick={() => void handleSaveDraft()} disabled={isSaving} className="btn-confirm">
                        {isSaving ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {showLoadDraftModal && (
              <>
                <div className="modal-overlay" onClick={() => setShowLoadDraftModal(false)} />
                <div className="modal">
                  <div className="modal-header">
                    <h3>임시 저장 불러오기</h3>
                    <button className="modal-close" onClick={() => setShowLoadDraftModal(false)}>
                      닫기
                    </button>
                  </div>
                  <div className="modal-content">
                    {isLoadingDrafts ? (
                      <div className="loading">로딩 중...</div>
                    ) : draftCases.length === 0 ? (
                      <div className="empty-state">
                        <p>임시 저장된 케이스가 없습니다.</p>
                      </div>
                    ) : (
                      <div className="draft-cases-list">
                        {draftCases.map((caseItem) => (
                          <div
                            key={caseItem.id}
                            className="draft-case-item"
                            onClick={() => handleLoadDraft(caseItem)}
                          >
                            <div className="draft-case-title">{caseItem.title || '제목 없음'}</div>
                            <div className="draft-case-date">{formatDate(caseItem.createdAt)}</div>
                            <div className="draft-case-info">방문 {caseItem.visits.length}건</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="actions">
              <button
                onClick={handleSaveDraftClick}
                disabled={isSaving || isSubmitting || isAiRunning}
                className="btn-save-draft"
              >
                임시 저장
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={isSubmitting || isSaving || isAiRunning}
                className="btn-submit"
              >
                {isSubmitting ? '처리 시작 중...' : '제출 및 처리'}
              </button>
              <button
                onClick={() => handleDeleteClick()}
                disabled={!hasTextInput() || isSaving || isSubmitting || isAiRunning}
                className="btn-delete-action"
              >
                삭제
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="filter-sort-container">
              <div className="history-toolbar-left">
                <div className="filter-tab-menu">
                {FILTER_TABS.map((filter) => (
                  <button
                    key={filter}
                    className={`filter-tab-item ${selectedFilter === filter ? 'active' : ''}`}
                    onClick={() => setSelectedFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
                </div>
                <div className="history-count">총 {filteredCases.length}건</div>
              </div>

              <div className="sort-options">
                <span className="sort-label">정렬:</span>
                <button
                  className={`sort-button ${sortOrder === 'desc' ? 'active' : ''}`}
                  onClick={() => setSortOrder('desc')}
                >
                  최신순
                </button>
                <button
                  className={`sort-button ${sortOrder === 'asc' ? 'active' : ''}`}
                  onClick={() => setSortOrder('asc')}
                >
                  오래된순
                </button>
              </div>
            </div>

            <div className="history-content">
              {isLoadingCases ? (
                <div className="loading">로딩 중...</div>
              ) : (() => {
                  if (filteredCases.length === 0) {
                    return (
                      <div className="empty-state">
                        <p>
                          {selectedFilter === FILTER_DRAFT
                            ? '임시 저장된 케이스가 없습니다.'
                            : selectedFilter === FILTER_ALL
                              ? '저장된 케이스가 없습니다.'
                              : `${selectedFilter}에 해당하는 케이스가 없습니다.`}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="cases-list">
                      {filteredCases.map((caseItem, index) => (
                        <div
                          key={caseItem.id}
                          className="case-item"
                          onClick={() => handleCaseClick(caseItem)}
                        >
                          <div className="case-item-left">
                            <div className="case-item-title">
                              <span className="case-item-index">{index + 1}.</span>{' '}
                              {caseItem.title || '제목 없음'}
                            </div>
                            <div className="case-item-meta">
                              <span className="case-item-date">{formatDate(caseItem.createdAt)}</span>
                              <span className="case-item-info">방문 {caseItem.visits.length}건</span>
                              <span className="case-item-info">
                                {isProcessedCase(caseItem) ? '처리 완료' : '임시 저장'}
                              </span>
                            </div>
                          </div>
                          <button
                            className="case-item-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteClick(caseItem.id);
                            }}
                            title="삭제"
                          >
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default CaseInputPage;
