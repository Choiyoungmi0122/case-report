import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { caseApi, aiPipelineApi, Visit, Case } from '../services/api';
import './CaseInputPage.css';

function CaseInputPage() {
  const navigate = useNavigate();

  const [visits, setVisits] = useState<Visit[]>([
    {
      type: '초진',
      date: new Date().toISOString().slice(0, 16),
      soapText: ''
    }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<string>('새 EMR 입력');
  const [cases, setCases] = useState<Case[]>([]);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<string>('이번 주');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showLoadDraftModal, setShowLoadDraftModal] = useState(false);
  const [draftCases, setDraftCases] = useState<Case[]>([]);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [showSaveDraftModal, setShowSaveDraftModal] = useState(false);
  const [draftTitle, setDraftTitle] = useState<string>('');
  const [currentDraftCaseId, setCurrentDraftCaseId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTargetCaseId, setDeleteTargetCaseId] = useState<string | null>(null);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const visitRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevVisitsLength = useRef(visits.length);

  const buildPipelineInputText = (items: Visit[]) => {
    return items
      .map((visit, index) => {
        return [
          `방문 ${index + 1}`,
          `유형: ${visit.type}`,
          `일시: ${visit.date}`,
          'SOAP:',
          visit.soapText
        ].join('\n');
      })
      .join('\n\n---\n\n');
  };

  const normalizeVisits = (items: Visit[]) => {
    return items.map(v => ({
      ...v,
      soapText: v.soapText.replace(/\\n/g, '\n')
    }));
  };

  const validateVisits = (items: Visit[]) => {
    const hasEmptyText = items.some(v => !v.soapText.trim());
    if (hasEmptyText) {
      throw new Error('모든 방문의 SOAP 기록을 입력해주세요. (최소 1글자 이상)');
    }
  };

  const addVisit = () => {
    setVisits([
      ...visits,
      {
        type: '재진',
        date: new Date().toISOString().slice(0, 16),
        soapText: ''
      }
    ]);
  };

  // 방문이 추가되면 새로 추가된 방문으로 스크롤
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
    if (visits.length > 1 && index !== 0) {
      // 방문 1은 삭제 불가
      const updated = visits.filter((_, i) => i !== index);
      // 삭제 후 각 방문의 type을 올바르게 재설정
      const fixedVisits = updated.map((visit, i) => ({
        ...visit,
        type: (i === 0 ? '초진' : '재진') as '초진' | '재진'
      }));
      setVisits(fixedVisits);
    }
  };

  const updateVisit = (index: number, field: keyof Visit, value: any) => {
    // 방문 유형은 고정이므로 변경 불가
    if (field === 'type') {
      return;
    }
    const updated = [...visits];
    updated[index] = { ...updated[index], [field]: value };
    setVisits(updated);
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
      // 임시 저장된 케이스만 필터링 (sectionStatusMap이 없거나 비어있음)
      const drafts = data.cases.filter(
        (case_) =>
          (!case_.sectionStatusMap || Object.keys(case_.sectionStatusMap).length === 0) &&
          !case_.aiPipeline?.chain7
      );
      setDraftCases(drafts);
    } catch (err: any) {
      console.error('Failed to load draft cases:', err);
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  const handleLoadDraftClick = () => {
    setShowLoadDraftModal(true);
    loadDraftCases();
  };

  const handleLoadDraft = (case_: Case) => {
    // 케이스의 visits를 현재 상태에 로드
    // visits의 type을 VisitType enum에서 string으로 변환 필요
    const loadedVisits: Visit[] = case_.visits.map((visit) => ({
      type: visit.type as '초진' | '재진',
      date: visit.date,
      soapText: visit.soapText || ''
    }));
    setVisits(loadedVisits);
    setShowLoadDraftModal(false);
    alert('임시 저장된 케이스를 불러왔습니다.');
  };

  const handleMainTabChange = (tab: string) => {
    setMainTab(tab);
    if (tab === '히스토리') {
      setSelectedFilter('이번 주'); // 히스토리 탭으로 전환 시 "이번 주" 필터로 설정
      loadCases();
    }
  };

  const handleCaseClick = (case_: Case) => {
    // 임시 저장된 케이스인지 확인
    const isDraft =
      (!case_.sectionStatusMap || Object.keys(case_.sectionStatusMap).length === 0) &&
      !case_.aiPipeline?.chain7;
    
    if (isDraft) {
      // 임시 저장된 케이스면 "새 EMR 입력" 탭으로 전환하고 방문 정보 로드
      setMainTab('새 EMR 입력');
      const loadedVisits: Visit[] = case_.visits.map((visit) => ({
        type: visit.type as '초진' | '재진',
        date: visit.date,
        soapText: visit.soapText || ''
      }));
      setVisits(loadedVisits);
      // 제목도 로드 (있는 경우)
      if (case_.title) {
        setDraftTitle(case_.title);
      }
      // 현재 로드된 임시 저장 케이스 ID 저장
      setCurrentDraftCaseId(case_.id);
    } else {
      // 처리된 케이스면 상세 페이지로 이동
      navigate(`/cases/${case_.id}`);
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

  const getFilteredAndSortedCases = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    // 필터링
    const filtered = cases.filter((case_) => {
      const caseDate = new Date(case_.createdAt);
      const isDraft =
        (!case_.sectionStatusMap || Object.keys(case_.sectionStatusMap).length === 0) &&
        !case_.aiPipeline?.chain7;
      
      switch (selectedFilter) {
        case '이번 주':
          // 이번 주 + 임시 저장 제외 (처리된 케이스만)
          return caseDate >= weekAgo && !isDraft;
        case '이번 달':
          // 이번 달 + 임시 저장 제외 (처리된 케이스만)
          return caseDate >= monthAgo && !isDraft;
        case '임시 저장':
          return isDraft;
        case '전체':
        default:
          return true;
      }
    });

    // 정렬
    const sorted = [...filtered].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      
      if (sortOrder === 'asc') {
        return dateA - dateB;
      } else {
        return dateB - dateA;
      }
    });

    return sorted;
  };

  const filterTabs = ['이번 주', '이번 달', '임시 저장',  '전체' ]; 


  const handleSaveDraftClick = () => {
    setShowSaveDraftModal(true);
    setDraftTitle('');
  };

  const handleSaveDraft = async () => {
    setError(null);
    setIsSaving(true);

    try {
      // Validate - 최소 1글자 이상 입력 필요
      const hasEmptyText = visits.some(v => !v.soapText.trim());
      if (hasEmptyText) {
        throw new Error('모든 방문의 SOAP 기록을 입력해주세요. (최소 1글자 이상)');
      }

      // '\n' 같은 이스케이프 문자열을 실제 줄바꿈으로 변환
      const normalizedVisits: Visit[] = visits.map(v => ({
        ...v,
        soapText: v.soapText.replace(/\\n/g, '\n')
      }));

      // Create case (임시 저장 - 처리하지 않음, 원본 텍스트 저장)
      const { caseId } = await caseApi.createCase({ 
        visits: normalizedVisits,
        title: draftTitle.trim() || undefined,
        skipSanitize: true // 임시 저장은 원본 텍스트 저장
      });

      // 현재 로드된 임시 저장 케이스 ID 업데이트
      setCurrentDraftCaseId(caseId);

      // 입력 폼 초기화
      setVisits([{
        type: '초진',
        date: new Date().toISOString().slice(0, 16),
        soapText: ''
      }]);
      setDraftTitle('');

      // 성공 메시지 및 모달 닫기
      alert('임시 저장되었습니다.');
      setShowSaveDraftModal(false);
    } catch (err: any) {
      setError(err.message || '임시 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const hasTextInput = () => {
    return visits.some(v => v.soapText.trim().length > 0) || draftTitle.trim().length > 0;
  };

  const handleDeleteClick = (caseId?: string) => {
    if (caseId) {
      // 히스토리에서 특정 케이스 삭제
      setDeleteTargetCaseId(caseId);
      setShowDeleteConfirm(true);
      return;
    }

    // 새 EMR 입력 탭에서의 삭제
    if (currentDraftCaseId) {
      // 임시 저장된 케이스가 있으면 삭제 확인 모달 표시
      setDeleteTargetCaseId(currentDraftCaseId);
      setShowDeleteConfirm(true);
    } else if (hasTextInput()) {
      // 입력 내용만 있으면 바로 초기화
      if (window.confirm('입력한 내용을 모두 삭제하시겠습니까?')) {
        setVisits([{
          type: '초진',
          date: new Date().toISOString().slice(0, 16),
          soapText: ''
        }]);
        setDraftTitle('');
        setCurrentDraftCaseId(null);
      }
    } else {
      alert('삭제할 내용이 없습니다.');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetCaseId) return;

    try {
      await caseApi.deleteCase(deleteTargetCaseId);

      // 히스토리 탭에서 삭제한 경우 리스트 새로고침
      if (mainTab === '히스토리') {
        await loadCases();
      }

      // 현재 로드된 임시 저장 케이스를 삭제한 경우 입력 폼 초기화
      if (deleteTargetCaseId === currentDraftCaseId) {
        setVisits([{
          type: '초진',
          date: new Date().toISOString().slice(0, 16),
          soapText: ''
        }]);
        setDraftTitle('');
        setCurrentDraftCaseId(null);
      }
      
      setDeleteTargetCaseId(null);
      setShowDeleteConfirm(false);
      
      alert('삭제되었습니다.');
    } catch (err: any) {
      setError(err.message || '삭제 중 오류가 발생했습니다.');
      setDeleteTargetCaseId(null);
      setShowDeleteConfirm(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    setIsAiRunning(true);

    try {
      validateVisits(visits);
      const normalizedVisits = normalizeVisits(visits);
      const inputText = buildPipelineInputText(normalizedVisits);

      // 1) 케이스 저장
      const { caseId } = await caseApi.createCase({ visits: normalizedVisits });

      // 2) Chain1~5 실행 (초기 제출 단계에서는 질문 UI를 띄우지 않음)
      const startResult = await aiPipelineApi.start(inputText);

      // 3) 초기 초안/누락정보 저장 (chain7은 섹션 상세 질문 이후 스냅샷용으로 저장)
      await caseApi.saveAiPipelineResult(caseId, {
        chain1: startResult.chain1,
        chain2: startResult.chain2,
        chain3: startResult.chain3,
        chain4: startResult.chain4,
        chain5: startResult.chain5,
        chain7: null,
        qnaHistory: []
      });

      // 4) 바로 섹션 Overview 페이지로 이동
      navigate(`/cases/${caseId}`);
    } catch (err: any) {
      setError(err.message || '오류가 발생했습니다.');
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

        {/* 메인 탭 메뉴 */}
        <div className="main-tab-menu">
          <button
            className={`main-tab-item ${mainTab === '새 EMR 입력' ? 'active' : ''}`}
            onClick={() => handleMainTabChange('새 EMR 입력')}
          >
            새 EMR 입력
          </button>
          <button
            className={`main-tab-item ${mainTab === '히스토리' ? 'active' : ''}`}
            onClick={() => handleMainTabChange('히스토리')}
          >
            히스토리
          </button>
        </div>

        {mainTab === '새 EMR 입력' ? (
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
              ref={(el) => (visitRefs.current[index] = el)}
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
                  <button
                    onClick={() => removeVisit(index)}
                    className="btn-remove"
                  >
                    삭제
                  </button>
                )}
              </div>

              <div className="field-group">
                <label>SOAP 기록</label>
                <textarea
                  value={visit.soapText}
                  onChange={(e) => updateVisit(index, 'soapText', e.target.value)}
                  placeholder="주관적 증상(Subjective), 객관적 소견(Objective), 평가(Assessment), 계획(Plan) 등을 입력하세요."
                  rows={8}
                />
              </div>
            </div>
          ))}
        </div>

            {error && <div className="error-message">{error}</div>}

            {/* 임시 저장 제목 입력 모달 */}
            {showSaveDraftModal && (
              <>
                <div className="modal-overlay" onClick={() => setShowSaveDraftModal(false)}></div>
                <div className="modal">
                  <div className="modal-header">
                    <h3>임시 저장</h3>
                    <button className="modal-close" onClick={() => setShowSaveDraftModal(false)}>
                      ✕
                    </button>
                  </div>
                  <div className="modal-content">
                    <div className="field-group">
                      <label>제목</label>
                      <input
                        type="text"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        placeholder="임시 저장할 케이스의 제목을 입력하세요"
                        className="draft-title-input"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isSaving) {
                            handleSaveDraft();
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
                      <button
                        onClick={handleSaveDraft}
                        disabled={isSaving}
                        className="btn-confirm"
                      >
                        {isSaving ? '저장 중...' : '저장'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* 임시 저장 불러오기 모달 */}
            {showLoadDraftModal && (
              <>
                <div className="modal-overlay" onClick={() => setShowLoadDraftModal(false)}></div>
                <div className="modal">
                  <div className="modal-header">
                    <h3>임시 저장 불러오기</h3>
                    <button className="modal-close" onClick={() => setShowLoadDraftModal(false)}>
                      ✕
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
                        {draftCases.map((case_) => (
                          <div
                            key={case_.id}
                            className="draft-case-item"
                            onClick={() => handleLoadDraft(case_)}
                          >
                            <div className="draft-case-title">
                              {case_.title || '제목 없음'}
                            </div>
                            <div className="draft-case-date">
                              {formatDate(case_.createdAt)}
                            </div>
                            <div className="draft-case-info">
                              방문 {case_.visits.length}회
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 삭제 확인 모달 */}
            {showDeleteConfirm && (
              <>
                <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}></div>
                <div className="modal">
                  <div className="modal-header">
                    <h3>삭제 확인</h3>
                    <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>
                      ✕
                    </button>
                  </div>
                  <div className="modal-content">
                    <p>정말 삭제하시겠습니까?</p>
                    <p className="delete-warning">이 작업은 되돌릴 수 없습니다.</p>
                    <div className="modal-actions">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="btn-cancel"
                      >
                        취소
                      </button>
                      <button
                        onClick={handleDeleteConfirm}
                        className="btn-delete"
                      >
                        삭제
                      </button>
                    </div>
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
                onClick={handleSubmit}
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
            {/* 필터 탭 메뉴 및 정렬 옵션 */}
            <div className="filter-sort-container">
              <div className="filter-tab-menu">
                {filterTabs.map((filter) => (
                  <button
                    key={filter}
                    className={`filter-tab-item ${selectedFilter === filter ? 'active' : ''}`}
                    onClick={() => setSelectedFilter(filter)}
                  >
                    {filter}
                  </button>
                ))}
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
                const filteredCases = getFilteredAndSortedCases();
                return filteredCases.length === 0 ? (
                  <div className="empty-state">
                    <p>
                      {selectedFilter === '전체' 
                        ? '저장된 케이스가 없습니다.' 
                        : selectedFilter === '임시 저장'
                        ? '임시 저장된 케이스가 없습니다.'
                        : `${selectedFilter}에 생성된 케이스가 없습니다.`}
                    </p>
                  </div>
                ) : (
                  <div className="cases-list">
                    {filteredCases.map((case_) => (
                      <div
                        key={case_.id}
                        className="case-item"
                        onClick={() => handleCaseClick(case_)}
                      >
                        <div className="case-item-left">
                          <div className="case-item-title">
                            {case_.title || '제목 없음'}
                          </div>
                          <div className="case-item-meta">
                            <span className="case-item-date">
                              {formatDate(case_.createdAt)}
                            </span>
                            <span className="case-item-info">
                              방문 {case_.visits.length}회
                            </span>
                          </div>
                        </div>
                        <button
                          className="case-item-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(case_.id);
                          }}
                          title="삭제"
                        >
                          🗑
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
