import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Case, caseApi, CaseMode, StudyWriteImportedVisit, StudyWritePresetSummary, Visit } from '../services/api';
import RecordUploadPanel from '../components/studyWrite/RecordUploadPanel';
import { getReviewRequiredDescription, getReviewRequiredTitle } from '../utils/caseStatusUi';
import { getProcessStageMessage } from '../utils/uiLabels';
import {
  getOrCreateResearchSessionId,
  getStoredParticipantCode,
  getStudyBasePath,
  isResearchRoute,
  setResearchParticipantCode
} from '../utils/research';
import './CaseInputPage.css';

const INPUT_TAB = 'input';
const HISTORY_TAB = 'history';
const FILTER_ALL = 'all';
const FILTER_THIS_WEEK = 'this_week';
const FILTER_THIS_MONTH = 'this_month';
const FILTER_DRAFT = 'draft';
const FILTER_TABS = [FILTER_ALL, FILTER_THIS_WEEK, FILTER_THIS_MONTH, FILTER_DRAFT] as const;

type CaseInputPageProps = {
  mode?: CaseMode;
};

type FilterTab = (typeof FILTER_TABS)[number];

type PageCopy = {
  heading: string;
  badge: string;
  submitLabel: string;
  homeLabel: string;
  loadingMessage: string;
  titlePlaceholder: string;
  emptyHistoryMessage: string;
  introParagraphs: string[];
};

type PageHeaderProps = {
  isScaffold: boolean;
  pageCopy: PageCopy;
  homePath: string;
  onSelectMode: () => void;
  onGoHome: () => void;
  onOpenReview: () => void;
};

type VisitsEditorProps = {
  researchMode: boolean;
  draftTitle: string;
  participantCode: string;
  sessionId: string;
  visits: Visit[];
  visitRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  titlePlaceholder: string;
  onDraftTitleChange: (value: string) => void;
  onParticipantCodeChange: (value: string) => void;
  onOpenDrafts: () => void;
  onLoadStudyCase: () => void;
  onAddVisit: () => void;
  onUpdateVisit: (index: number, field: keyof Visit, value: string) => void;
  onRemoveVisit: (index: number) => void;
  /** 실험용 Write에서만 쓰는 기록 파일 올리기 패널 */
  uploadPanel?: React.ReactNode;
};

type ReviewRequiredPanelProps = {
  blockedCase: Case;
  onOpenCase: () => void;
};

type SaveDraftModalProps = {
  isSaving: boolean;
  draftTitle: string;
  onClose: () => void;
  onDraftTitleChange: (value: string) => void;
  onSave: () => void;
};

type LoadDraftModalProps = {
  isLoadingDrafts: boolean;
  draftCases: Case[];
  onClose: () => void;
  onSelectDraft: (caseItem: Case) => void;
  formatDate: (dateString: string) => string;
};

type InputTabContentProps = {
  researchMode: boolean;
  pageCopy: PageCopy;
  visits: Visit[];
  visitRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  draftTitle: string;
  participantCode: string;
  sessionId: string;
  error: string | null;
  blockedCase: Case | null;
  isSaving: boolean;
  isSubmitting: boolean;
  hasTextInput: boolean;
  showSaveDraftModal: boolean;
  showLoadDraftModal: boolean;
  draftCases: Case[];
  isLoadingDrafts: boolean;
  onDraftTitleChange: (value: string) => void;
  onParticipantCodeChange: (value: string) => void;
  onOpenDrafts: () => void;
  onLoadStudyCase: () => void;
  onAddVisit: () => void;
  onUpdateVisit: (index: number, field: keyof Visit, value: string) => void;
  onRemoveVisit: (index: number) => void;
  onOpenBlockedCase: () => void;
  onCloseSaveDraftModal: () => void;
  onSaveDraft: () => void;
  onCloseLoadDraftModal: () => void;
  onSelectDraft: (caseItem: Case) => void;
  onShowSaveDraftModal: () => void;
  onSubmit: () => void;
  onDelete: () => void;
  formatDate: (dateString: string) => string;
  uploadPanel?: React.ReactNode;
  duplicateCase?: { caseId: string; code: string; resumeStage: string | null; mode: string | null } | null;
  onResumeDuplicate?: () => void;
};

type HistoryTabContentProps = {
  isScaffold: boolean;
  filteredCases: Case[];
  selectedFilter: string;
  sortOrder: 'asc' | 'desc';
  isLoadingCases: boolean;
  onFilterChange: (filter: FilterTab) => void;
  onSortOrderChange: (order: 'asc' | 'desc') => void;
  onCaseClick: (caseItem: Case) => void;
  onDeleteCase: (caseId: string) => void;
  formatDate: (dateString: string) => string;
};

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

function getHomePath(mode: CaseMode, researchMode = false) {
  if (researchMode) return getStudyBasePath(mode);
  return mode === 'scaffold' ? '/scaffold' : '/write';
}

function getOverviewPath(mode: CaseMode, caseId: string, researchMode = false) {
  if (researchMode) return `${getStudyBasePath(mode)}/cases/${caseId}`;
  return mode === 'scaffold' ? `/scaffold/cases/${caseId}` : `/cases/${caseId}`;
}

function getFilterLabel(filter: FilterTab) {
  switch (filter) {
    case FILTER_THIS_WEEK:
      return '이번 주';
    case FILTER_THIS_MONTH:
      return '이번 달';
    case FILTER_DRAFT:
      return '임시 저장';
    case FILTER_ALL:
    default:
      return '전체';
  }
}

function getPageCopy(mode: CaseMode): PageCopy {
  if (mode === 'scaffold') {
    return {
      heading: 'CARE 구조 기반 Scaffold 학습 도구',
      badge: 'Scaffold 모드',
      submitLabel: 'CARE 구조 분석 시작',
      homeLabel: 'Scaffold 홈',
      loadingMessage: '기록을 분석하고 CARE 구조와 누락 정보를 준비하는 중입니다...',
      titlePlaceholder: 'Scaffold 검토용 증례 제목',
      emptyHistoryMessage: '저장된 Scaffold 케이스가 없습니다.',
      introParagraphs: [
        'Scaffold 모드에서는 AI가 원고를 바로 완성하기 전에, CARE 구조에 따라 기록을 확인하고 부족한 정보와 추가 검토가 필요한 항목을 단계적으로 점검합니다.',
        'AI가 제시하는 내용은 최종 판단이 아니며, 기록 근거와 교수자 또는 전문가의 검토가 필요할 수 있습니다.'
      ]
    };
  }

  return {
    heading: 'EMR 기반 증례보고 작성 지원 도구',
    badge: 'Write 모드',
    submitLabel: '증례보고 작성 시작',
    homeLabel: 'Write 홈',
    loadingMessage: '증례를 분석하고 CARE 섹션 초안과 질문을 생성하는 중입니다...',
    titlePlaceholder: '증례보고 제목',
    emptyHistoryMessage: '저장된 Write 케이스가 없습니다.',
    introParagraphs: []
  };
}

function PageHeader({
  isScaffold,
  pageCopy,
  onSelectMode,
  onGoHome,
  onOpenReview
}: PageHeaderProps) {
  return (
    <div className="header">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 12px',
            borderRadius: 999,
            background: isScaffold ? '#e8f4ea' : '#e9f2ff',
            color: isScaffold ? '#23663a' : '#1d4f91',
            fontWeight: 700,
            fontSize: 14
          }}
        >
          {pageCopy.badge}
        </span>
        <button type="button" className="btn-load-draft" onClick={onSelectMode}>
          모드 선택
        </button>
        <button type="button" className="btn-load-draft" onClick={onGoHome}>
          {pageCopy.homeLabel}
        </button>
        <button type="button" className="btn-load-draft" onClick={onOpenReview}>
          기존 Word 원고 검토
        </button>
      </div>
      <h1>{pageCopy.heading}</h1>
      {isScaffold ? (
        <div style={{ marginTop: 12, color: '#43536b', lineHeight: 1.7 }}>
          {pageCopy.introParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VisitsEditor({
  researchMode,
  draftTitle,
  participantCode,
  sessionId,
  visits,
  visitRefs,
  titlePlaceholder,
  onDraftTitleChange,
  onParticipantCodeChange,
  onOpenDrafts,
  onLoadStudyCase,
  onAddVisit,
  onUpdateVisit,
  onRemoveVisit,
  uploadPanel
}: VisitsEditorProps) {
  return (
    <div className="visits-section">
      <div className="visits-header">
        <h2>방문 기록</h2>
        <div className="visits-header-buttons">
          {/* Scaffold 실험은 저장해 둔 분석 결과·AI 초안까지 쓴다. Write 실험은 위 패널의 사례 목록에서 방문 기록만 가져온다. */}
          {researchMode && !uploadPanel ? (
            <button onClick={onLoadStudyCase} className="btn-load-draft">
              실험 사례 불러오기
            </button>
          ) : null}
          <button
            onClick={onOpenDrafts}
            className="btn-load-draft"
          >
            임시 저장 불러오기
          </button>
          <button onClick={onAddVisit} className="btn-add-visit">
            + 방문 추가
          </button>
        </div>
      </div>
      {uploadPanel}

      <div className="field-group" style={{ marginBottom: 16 }}>
        <label>증례 제목</label>
        <input
          type="text"
          value={draftTitle}
          onChange={(event) => onDraftTitleChange(event.target.value)}
          placeholder={titlePlaceholder}
        />
      </div>

      {researchMode ? (
        <div className="case-input-meta-grid" style={{ marginBottom: 16 }}>
          <div className="field-group">
            <label>참가자 코드</label>
            <input
              type="text"
              value={participantCode}
              onChange={(event) => onParticipantCodeChange(event.target.value)}
              placeholder="예: E01"
            />
          </div>
          <div className="field-group">
            <label>세션 ID</label>
            <input type="text" value={sessionId} readOnly />
          </div>
        </div>
      ) : null}

      {visits.map((visit, index) => (
        <div
          key={`${visit.date}-${index}`}
          className="visit-card"
          ref={(element) => {
            visitRefs.current[index] = element;
          }}
        >
          <div className="visit-header">
            <div className="field-group">
              <label>방문 {index + 1}</label>
            </div>
            <div className="field-group">
              <label>방문 유형</label>
              <select value={index === 0 ? '초진' : '재진'} disabled className="disabled-select">
                <option value="초진">초진</option>
                <option value="재진">재진</option>
              </select>
            </div>
            <div className="field-group">
              <label>방문 일시</label>
              <input
                type="datetime-local"
                value={visit.date}
                onChange={(event) => onUpdateVisit(index, 'date', event.target.value)}
                min={index > 0 ? visits[index - 1].date : undefined}
              />
            </div>
            {visits.length > 1 && index !== 0 ? (
              <button onClick={() => onRemoveVisit(index)} className="btn-remove">
                삭제
              </button>
            ) : null}
          </div>

          <div className="field-group">
            <label>SOAP 기록</label>
            <textarea
              value={visit.soapText}
              onChange={(event) => onUpdateVisit(index, 'soapText', event.target.value)}
              placeholder="Subjective / Objective / Assessment / Plan 형식으로 입력해 주세요."
              rows={8}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewRequiredPanel({ blockedCase, onOpenCase }: ReviewRequiredPanelProps) {
  if (!blockedCase.reviewRequired) return null;

  return (
    <div className="review-required-panel">
      <div className="review-required-header">
        <div>
          <h3>{getReviewRequiredTitle(blockedCase.reviewRequired)}</h3>
          <p>{getReviewRequiredDescription(blockedCase.reviewRequired)}</p>
        </div>
        <span
          className={`review-risk-pill ${
            blockedCase.reviewRequired.riskLevel === 'HIGH'
              ? 'review-risk-pill-high'
              : 'review-risk-pill-medium'
          }`}
        >
          {blockedCase.reviewRequired.riskLevel}
        </span>
      </div>

      {(blockedCase.reviewRequired.reasons || []).length ? (
        <ul className="review-required-list">
          {(blockedCase.reviewRequired.reasons || []).map((reason, index) => (
            <li key={`${reason}-${index}`}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {(blockedCase.deidentifiedEMRs || []).length > 0 ? (
        <div className="review-required-spans">
          {(blockedCase.deidentifiedEMRs || []).slice(0, 3).map((record) => (
            <div key={record.emrId} className="review-required-visit">
              <strong>방문 {record.visitIndex + 1}</strong>
              {(record.phiSpans || []).slice(0, 6).map((span, index) => (
                <div key={`${span.originalText}-${index}`} className="review-required-span">
                  {span.type}: {span.originalText}
                  {' -> '}
                  {span.replacement}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className="review-required-actions">
        <button type="button" className="btn-load-draft" onClick={onOpenCase}>
          케이스 검토 화면 열기
        </button>
      </div>
    </div>
  );
}

function SaveDraftModal({
  isSaving,
  draftTitle,
  onClose,
  onDraftTitleChange,
  onSave
}: SaveDraftModalProps) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <h3>임시 저장</h3>
          <button className="modal-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-content">
          <div className="field-group">
            <label>제목</label>
            <input
              type="text"
              value={draftTitle}
              onChange={(event) => onDraftTitleChange(event.target.value)}
              placeholder="임시 저장할 케이스 제목을 입력해 주세요."
              className="draft-title-input"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isSaving) {
                  onSave();
                }
              }}
            />
          </div>
          <div className="modal-actions">
            <button onClick={onClose} className="btn-cancel" disabled={isSaving}>
              취소
            </button>
            <button onClick={onSave} disabled={isSaving} className="btn-confirm">
              {isSaving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LoadDraftModal({
  isLoadingDrafts,
  draftCases,
  onClose,
  onSelectDraft,
  formatDate
}: LoadDraftModalProps) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <h3>임시 저장 불러오기</h3>
          <button className="modal-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-content">
          {isLoadingDrafts ? (
            <div className="loading">불러오는 중...</div>
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
                  onClick={() => onSelectDraft(caseItem)}
                >
                  <div className="draft-case-title">{caseItem.title || '제목 없음'}</div>
                  <div className="draft-case-date">{formatDate(caseItem.createdAt)}</div>
                  {(caseItem.experiment_code || caseItem.experimentCode) ? (
                    <div className="draft-case-info">실험번호: {caseItem.experiment_code || caseItem.experimentCode}</div>
                  ) : null}
                  <div className="draft-case-info">방문 {caseItem.visits.length}건</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function InputTabContent({
  researchMode,
  pageCopy,
  visits,
  visitRefs,
  draftTitle,
  participantCode,
  sessionId,
  error,
  blockedCase,
  isSaving,
  isSubmitting,
  hasTextInput,
  showSaveDraftModal,
  showLoadDraftModal,
  draftCases,
  isLoadingDrafts,
  onDraftTitleChange,
  onParticipantCodeChange,
  onOpenDrafts,
  onLoadStudyCase,
  onAddVisit,
  onUpdateVisit,
  onRemoveVisit,
  onOpenBlockedCase,
  onCloseSaveDraftModal,
  onSaveDraft,
  onCloseLoadDraftModal,
  onSelectDraft,
  onShowSaveDraftModal,
  onSubmit,
  uploadPanel,
  duplicateCase,
  onResumeDuplicate,
  onDelete,
  formatDate
}: InputTabContentProps) {
  return (
    <>
      <VisitsEditor
        researchMode={researchMode}
        draftTitle={draftTitle}
        participantCode={participantCode}
        sessionId={sessionId}
        visits={visits}
        visitRefs={visitRefs}
        titlePlaceholder={pageCopy.titlePlaceholder}
        onDraftTitleChange={onDraftTitleChange}
        onParticipantCodeChange={onParticipantCodeChange}
        onOpenDrafts={onOpenDrafts}
        onLoadStudyCase={onLoadStudyCase}
        onAddVisit={onAddVisit}
        onUpdateVisit={onUpdateVisit}
        onRemoveVisit={onRemoveVisit}
        uploadPanel={uploadPanel}
      />

      {error ? (
        <div className="error-message">
          {error}
          {duplicateCase ? (
            <button type="button" className="btn-load-draft" style={{ marginLeft: 12 }} onClick={onResumeDuplicate}>
              "{duplicateCase.code}" 이어서 하기
            </button>
          ) : null}
        </div>
      ) : null}

      {blockedCase ? (
        <ReviewRequiredPanel blockedCase={blockedCase} onOpenCase={onOpenBlockedCase} />
      ) : null}

      {showSaveDraftModal ? (
        <SaveDraftModal
          isSaving={isSaving}
          draftTitle={draftTitle}
          onClose={onCloseSaveDraftModal}
          onDraftTitleChange={onDraftTitleChange}
          onSave={onSaveDraft}
        />
      ) : null}

      {showLoadDraftModal ? (
        <LoadDraftModal
          isLoadingDrafts={isLoadingDrafts}
          draftCases={draftCases}
          onClose={onCloseLoadDraftModal}
          onSelectDraft={onSelectDraft}
          formatDate={formatDate}
        />
      ) : null}

      <div className="actions">
        <button
          onClick={onShowSaveDraftModal}
          disabled={isSaving || isSubmitting}
          className="btn-save-draft"
        >
          임시 저장
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmitting || isSaving}
          className="btn-submit"
        >
          {isSubmitting ? '처리 시작 중...' : pageCopy.submitLabel}
        </button>
        <button
          onClick={onDelete}
          disabled={!hasTextInput || isSaving || isSubmitting}
          className="btn-delete-action"
        >
          삭제
        </button>
      </div>
    </>
  );
}

function HistoryTabContent({
  isScaffold,
  filteredCases,
  selectedFilter,
  sortOrder,
  isLoadingCases,
  onFilterChange,
  onSortOrderChange,
  onCaseClick,
  onDeleteCase,
  formatDate
}: HistoryTabContentProps) {
  return (
    <>
      <div className="filter-sort-container">
        <div className="history-toolbar-left">
          <div className="filter-tab-menu">
            {FILTER_TABS.map((filter) => (
              <button
                key={filter}
                className={`filter-tab-item ${selectedFilter === filter ? 'active' : ''}`}
                onClick={() => onFilterChange(filter)}
              >
                {getFilterLabel(filter)}
              </button>
            ))}
          </div>
          <div className="history-count">총 {filteredCases.length}건</div>
        </div>

        <div className="sort-options">
          <span className="sort-label">정렬:</span>
          <button
            className={`sort-button ${sortOrder === 'desc' ? 'active' : ''}`}
            onClick={() => onSortOrderChange('desc')}
          >
            최신순
          </button>
          <button
            className={`sort-button ${sortOrder === 'asc' ? 'active' : ''}`}
            onClick={() => onSortOrderChange('asc')}
          >
            오래된순
          </button>
        </div>
      </div>

      {isLoadingCases ? (
        <div className="loading">케이스를 불러오는 중입니다...</div>
      ) : filteredCases.length === 0 ? (
        <div className="empty-state">
          <p>{isScaffold ? '저장된 Scaffold 케이스가 없습니다.' : '저장된 Write 케이스가 없습니다.'}</p>
        </div>
      ) : (
        <div className="history-list">
          {filteredCases.map((caseItem) => {
            const processed = isProcessedCase(caseItem);
            return (
              <div key={caseItem.id} className="history-item">
                <button type="button" className="history-item-main" onClick={() => onCaseClick(caseItem)}>
                  <div className="history-item-title-row">
                    <strong>{caseItem.title || '제목 없음'}</strong>
                    <span
                      style={{
                        display: 'inline-flex',
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: caseItem.mode === 'scaffold' ? '#e8f4ea' : '#e9f2ff',
                        color: caseItem.mode === 'scaffold' ? '#23663a' : '#1d4f91',
                        fontSize: 12,
                        fontWeight: 700
                      }}
                    >
                      {caseItem.mode === 'scaffold' ? 'Scaffold' : 'Write'}
                    </span>
                  </div>
                  <div className="history-item-meta">
                    {(caseItem.experiment_code || caseItem.experimentCode) ? (
                      <span>실험번호: {caseItem.experiment_code || caseItem.experimentCode}</span>
                    ) : null}
                    <span>{formatDate(caseItem.createdAt)}</span>
                    <span>방문 {caseItem.visits.length}건</span>
                    <span>{processed ? '분석 완료' : '임시 저장'}</span>
                  </div>
                </button>
                <button
                  type="button"
                  className="btn-delete-action"
                  onClick={() => onDeleteCase(caseItem.id)}
                >
                  삭제
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function CaseInputPage({ mode = 'write' }: CaseInputPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isScaffold = mode === 'scaffold';
  const visitRefs = useRef<(HTMLDivElement | null)[]>([]);
  const previousVisitsLength = useRef(1);
  const pageCopy = useMemo(() => getPageCopy(mode), [mode]);

  const [visits, setVisits] = useState<Visit[]>([createEmptyVisit()]);
  // 어떤 파일에서 기록을 가져왔는지. 사례를 만들 때 연구용 기록으로 같이 보낸다.
  const [uploadedRecordSource, setUploadedRecordSource] = useState<{
    source: 'xlsx' | 'docx' | 'pdf' | 'preset';
    fileName: string;
    visitCount: number;
    relativeDates?: boolean;
    presetId?: string;
  } | null>(null);
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
  const [draftTitle, setDraftTitle] = useState('');
  // 연구 세션(/study/*)에서만 참가자 코드/세션 ID를 사용한다. 일반 사용자는 입력하지 않는다.
  const researchMode = isResearchRoute(location.pathname);
  const routeStudyMetadata = (location.state as any)?.studyMetadata;
  // 같은 코드로 만든 사례가 이미 있을 때 이어서 갈 곳
  const [duplicateCase, setDuplicateCase] = useState<{
    caseId: string;
    code: string;
    resumeStage: string | null;
    mode: string | null;
  } | null>(null);
  const resumeDuplicate = () => {
    if (!duplicateCase) return;
    const { caseId, resumeStage, mode: existingMode } = duplicateCase;
    if (existingMode === 'scaffold') {
      navigate(`/study/scaffold/cases/${caseId}`);
      return;
    }
    const path =
      resumeStage === 'final'
        ? `/study/write/cases/${caseId}/final`
        : resumeStage === 'draft'
          ? `/study/write/cases/${caseId}/draft`
          : resumeStage === 'interview'
            ? `/study/write/cases/${caseId}/interview`
            : `/study/write/cases/${caseId}`;
    navigate(path);
  };

  // 실험 사례 목록 (Write 실험). 가상환자 + 전문가 기록 프리셋
  const [presets, setPresets] = useState<StudyWritePresetSummary[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  useEffect(() => {
    if (!(mode === 'write' && researchMode)) return;
    caseApi
      .getStudyWritePresets()
      .then((items) => {
        setPresets(items);
        if (items[0]) setSelectedPresetId((prev) => prev || items[0].id);
      })
      .catch(() => undefined);
  }, [mode, researchMode]);
  const [participantCode, setParticipantCode] = useState(() => {
    // StudyEntryPage에서 전달된 값이 있으면 사용하고, 없으면 저장된 값을 복구한다.
    return (location.state as any)?.participantCode || getStoredParticipantCode(mode) || '';
  });
  // 새로고침이나 섹션 이동으로 sessionId가 바뀌지 않도록 localStorage에 고정한다.
  const [researchSessionId] = useState(() => getOrCreateResearchSessionId(mode));
  const [currentDraftCaseId, setCurrentDraftCaseId] = useState<string | null>(null);
  // Live backend stage shown while a case is being processed. Processing takes
  // around two minutes, so a single static spinner would look like a freeze.
  const [processStage, setProcessStage] = useState<string | null>(null);
  const [blockedCase, setBlockedCase] = useState<Case | null>(null);

  const normalizeVisits = (items: Visit[]): Visit[] =>
    items.map((visit, index) => ({
      ...visit,
      type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
      soapText: visit.soapText.replace(/\\n/g, '\n')
    }));

  const resetInputForm = () => {
    setVisits([createEmptyVisit()]);
    setDraftTitle('');
    setCurrentDraftCaseId(null);
    if (!researchMode) {
      setParticipantCode('');
    }
  };

  /**
   * 연구 세션에서 생성/수정되는 케이스에 붙는 메타데이터.
   * participantCode는 가명(E01 등)이며 실명/이메일은 사용하지 않는다.
   */
  const buildResearchMetadata = () =>
    researchMode
      ? {
          sessionId: researchSessionId,
          participantCode: participantCode.trim() || undefined,
          experimentCode: participantCode.trim() || undefined,
          studyMetadata: routeStudyMetadata,
          sessionOutcome: { status: 'in_progress' }
        }
      : undefined;

  // 실험용 경로에서는 참가자 코드가 곧 실험번호다 (Scaffold, Write 모두). 조회 화면에서
  // 같은 번호로 찾을 수 있어야 한다.
  const getResearchExperimentCode = () => (researchMode ? participantCode.trim() || undefined : undefined);

  /** 이미 존재하는 케이스(임시 저장 등)에 연구 세션을 연결한다. */
  const attachResearchSession = async (caseId: string) => {
    if (!researchMode) return;
    try {
      await caseApi.updateResearchSession(caseId, {
        sessionId: researchSessionId,
        participantCode: participantCode.trim() || undefined,
        studyMetadata: routeStudyMetadata
      });
    } catch (nextError) {
      // 연구 메타데이터 연결 실패가 작성 자체를 막아서는 안 된다.
      console.error('Failed to attach research session:', nextError);
    }
  };

  const validateVisits = (items: Visit[]) => {
    const hasEmptyText = items.some((visit) => !visit.soapText.trim());
    if (hasEmptyText) {
      throw new Error('모든 방문 기록에 SOAP 텍스트를 입력해 주세요.');
    }
  };

  const loadCases = async () => {
    try {
      setIsLoadingCases(true);
      const data = await caseApi.getAllCases(mode);
      setCases(data.cases);
    } catch (nextError: any) {
      console.error('Failed to load cases:', nextError);
    } finally {
      setIsLoadingCases(false);
    }
  };

  const loadDraftCases = async () => {
    try {
      setIsLoadingDrafts(true);
      const data = await caseApi.getAllCases(mode);
      setDraftCases(data.cases.filter((caseItem) => !isProcessedCase(caseItem)));
    } catch (nextError: any) {
      console.error('Failed to load draft cases:', nextError);
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  useEffect(() => {
    if (visits.length > previousVisitsLength.current) {
      const nextIndex = visits.length - 1;
      window.setTimeout(() => {
        visitRefs.current[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
    previousVisitsLength.current = visits.length;
  }, [visits.length]);

  const addVisit = () => {
    setVisits((current) => [...current, createEmptyVisit('재진')]);
  };

  const removeVisit = (index: number) => {
    if (index === 0 || visits.length <= 1) return;
    setVisits((current) =>
      current.filter((_, currentIndex) => currentIndex !== index).map((visit, currentIndex) => ({
        ...visit,
        type: currentIndex === 0 ? '초진' : '재진'
      }))
    );
  };

  const updateVisit = (index: number, field: keyof Visit, value: string) => {
    if (field === 'type') return;
    setVisits((current) =>
      current.map((visit, currentIndex) =>
        currentIndex === index ? { ...visit, [field]: value } : visit
      )
    );
  };

  const handleLoadDraft = (caseItem: Case) => {
    const loadedVisits = (caseItem.visits || []).map((visit, index) => ({
      type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
      date: visit.date,
      soapText: visit.soapText || ''
    }));

    setVisits(loadedVisits.length > 0 ? loadedVisits : [createEmptyVisit()]);
    setDraftTitle(caseItem.title || '');
    setCurrentDraftCaseId(caseItem.id);
    setMainTab(INPUT_TAB);
    setShowLoadDraftModal(false);
    window.alert('임시 저장한 케이스를 불러왔습니다.');
  };

  /** 실험용 고정 사례의 방문 기록(날짜 포함)을 입력 칸에 채운다. */
  const handleLoadStudyCase = async () => {
    if (hasTextInput && !window.confirm('현재 입력 내용을 지우고 실험 사례를 불러올까요?')) {
      return;
    }

    setError(null);
    try {
      const template = await caseApi.getStudyCaseTemplate();
      setVisits(
        template.visits.map((visit, index) => ({
          type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
          date: visit.date,
          soapText: visit.soapText || ''
        }))
      );
      setCurrentDraftCaseId(null);
    } catch (nextError: any) {
      setError(nextError.message || '실험 사례를 불러오지 못했습니다.');
    }
  };

  /** 올린 파일에서 만든 방문 목록을 입력 칸에 넣는다. 넣은 뒤에는 입력 칸에서 고칠 수 있다. */
  const handleApplyUploadedVisits = (
    imported: StudyWriteImportedVisit[],
    source: 'xlsx' | 'docx' | 'pdf',
    fileName: string
  ) => {
    if (hasTextInput && !window.confirm('현재 입력 내용을 지우고 올린 파일의 기록으로 바꿀까요?')) {
      return;
    }
    setError(null);
    setVisits(
      imported.map((visit, index) => ({
        type: (index === 0 ? '초진' : '재진') as '초진' | '재진',
        date: visit.date || new Date().toISOString().slice(0, 16),
        soapText: visit.soapText
      }))
    );
    setCurrentDraftCaseId(null);
    setUploadedRecordSource({ source, fileName, visitCount: imported.length });
  };

  /** Write 실험: 고른 사례의 방문 기록만 입력 칸에 넣는다. 분석은 새로 한다. */
  const handleLoadPreset = async () => {
    const preset = presets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    if (hasTextInput && !window.confirm(`현재 입력 내용을 지우고 "${preset.label}"의 방문 기록으로 바꿀까요?`)) {
      return;
    }
    setError(null);
    try {
      const full = await caseApi.getStudyWritePreset(preset.id);
      setVisits(
        full.visits.map((visit) => ({
          type: visit.type,
          date: visit.date,
          soapText: visit.soapText
        }))
      );
      setCurrentDraftCaseId(null);
      setUploadedRecordSource({
        source: 'preset',
        fileName: full.label,
        visitCount: full.visits.length,
        relativeDates: full.relativeDates,
        presetId: full.id
      });
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '사례를 불러오지 못했습니다.');
    }
  };

  const handleCaseClick = (caseItem: Case) => {
    if (!isProcessedCase(caseItem)) {
      handleLoadDraft(caseItem);
      return;
    }

    navigate(getOverviewPath(mode, caseItem.id));
  };

  const handleMainTabChange = (tab: string) => {
    setMainTab(tab);
    if (tab === HISTORY_TAB) {
      setSelectedFilter(FILTER_ALL);
      void loadCases();
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

  const filteredCases = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const filtered = cases.filter((caseItem) => {
      const caseDate = new Date(caseItem.createdAt);
      const draft = !isProcessedCase(caseItem);

      switch (selectedFilter) {
        case FILTER_THIS_WEEK:
          return caseDate >= weekAgo && !draft;
        case FILTER_THIS_MONTH:
          return caseDate >= monthAgo && !draft;
        case FILTER_DRAFT:
          return draft;
        case FILTER_ALL:
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }, [cases, selectedFilter, sortOrder]);

  const hasTextInput = useMemo(
    () => visits.some((visit) => visit.soapText.trim().length > 0) || draftTitle.trim().length > 0,
    [draftTitle, visits]
  );

  const saveDraft = async () => {
    setError(null);
    setBlockedCase(null);
    setDuplicateCase(null);
    setIsSaving(true);

    try {
      validateVisits(visits);
      const normalizedVisits = normalizeVisits(visits);
      const payload = {
        visits: normalizedVisits,
        title: draftTitle.trim() || undefined,
        mode
      };

      if (currentDraftCaseId) {
        await caseApi.updateCase(currentDraftCaseId, payload);
        await attachResearchSession(currentDraftCaseId);
        if (mode === 'scaffold') {
          await caseApi.updateScaffoldSession(currentDraftCaseId, {
            sessionId: researchSessionId,
            participantCode: participantCode.trim() || undefined
          });
        }
      } else {
        const { caseId } = await caseApi.createCase({
          ...payload,
          experimentCode: getResearchExperimentCode(),
          metadata: buildResearchMetadata(),
          skipSanitize: true
        });
        setCurrentDraftCaseId(caseId);
      }

      setShowSaveDraftModal(false);
      window.alert('임시 저장되었습니다.');
    } catch (nextError: any) {
      setError(nextError.message || '임시 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

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
    } catch (nextError: any) {
      setError(nextError.message || '삭제 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteClick = (caseId?: string) => {
    if (caseId) {
      if (window.confirm('이 케이스를 삭제하시겠습니까?')) {
        void deleteCaseById(caseId);
      }
      return;
    }

    if (currentDraftCaseId) {
      if (window.confirm('현재 임시 저장 케이스를 삭제하시겠습니까?')) {
        void deleteCaseById(currentDraftCaseId);
      }
      return;
    }

    if (hasTextInput) {
      if (window.confirm('현재 입력 내용을 모두 지우시겠습니까?')) {
        resetInputForm();
      }
      return;
    }

    window.alert('삭제할 내용이 없습니다.');
  };

  const submitForProcessing = async () => {
    setError(null);
    setBlockedCase(null);
    setDuplicateCase(null);
    setIsSubmitting(true);

    try {
      validateVisits(visits);
      const normalizedVisits = normalizeVisits(visits);
      let caseId = currentDraftCaseId;

      if (caseId) {
        await caseApi.updateCase(caseId, {
          visits: normalizedVisits,
          title: draftTitle.trim() || undefined,
          mode
        });
        await attachResearchSession(caseId);
        if (mode === 'scaffold') {
          await caseApi.updateScaffoldSession(caseId, {
            sessionId: researchSessionId,
            participantCode: participantCode.trim() || undefined
          });
        }
      } else {
        const created = await caseApi.createCase({
          visits: normalizedVisits,
          title: draftTitle.trim() || undefined,
          mode,
          experimentCode: getResearchExperimentCode(),
          metadata: buildResearchMetadata()
        });
        caseId = created.caseId;
      }

      if (!caseId) {
        throw new Error('케이스를 생성하지 못했습니다.');
      }

      if (researchMode) {
        setResearchParticipantCode(mode, participantCode);
      }

      // 실험용 Write: 분석은 뒤에서 돌리고, 바로 질의응답 화면으로 간다. 1회차 질문은
      // 분석이 필요 없어서 기다리지 않아도 된다. 분석 요청은 질의응답 화면이 보낸다.
      if (mode === 'write' && researchMode) {
        await caseApi.startStudyWriteInterview(caseId, {
          inputSource: uploadedRecordSource
            ? {
                source: uploadedRecordSource.source,
                fileName: uploadedRecordSource.fileName,
                visitCount: uploadedRecordSource.visitCount,
                relativeDates: uploadedRecordSource.relativeDates,
                presetId: uploadedRecordSource.presetId
              }
            : { source: 'manual', visitCount: normalizedVisits.length }
        });
        navigate(`/study/write/cases/${caseId}/interview`);
        return;
      }

      // Processing runs for roughly two minutes. Poll the stage the backend is
      // actually on so the overlay reports real progress instead of sitting on
      // one message; the poll is best-effort and never blocks the request.
      setProcessStage(getProcessStageMessage(null, pageCopy.loadingMessage));
      const stageTimer = window.setInterval(async () => {
        try {
          const snapshot = await caseApi.getCaseSummary(caseId as string, {
            includeDeidentifiedEMRs: false,
            includePerformanceLogs: false,
            includePendingTerms: false
          });
          setProcessStage(
            getProcessStageMessage(snapshot.chainProgress?.currentStep, pageCopy.loadingMessage)
          );
        } catch {
          /* a failed poll must not disturb the processing request */
        }
      }, 2500);

      try {
        await caseApi.processCase(caseId);
      } finally {
        window.clearInterval(stageTimer);
        setProcessStage(null);
      }

      navigate(getOverviewPath(mode, caseId, researchMode));
    } catch (nextError: any) {
      const blockedCaseId = nextError?.response?.data?.caseId;
      const duplicate = nextError?.response?.data?.existingCaseId ? nextError.response.data : null;

      if (duplicate && nextError?.response?.status === 409) {
        setDuplicateCase({
          caseId: duplicate.existingCaseId,
          code: duplicate.duplicateExperimentCode,
          resumeStage: duplicate.resumeStage,
          mode: duplicate.existingMode
        });
        setError(duplicate.error || '이미 쓴 코드입니다.');
      } else if (blockedCaseId && nextError?.response?.status === 409) {
        try {
          const caseResult = await caseApi.getCase(blockedCaseId);
          setBlockedCase(caseResult);
          setError('개인정보 검토가 필요하여 AI 처리가 차단되었습니다.');
        } catch {
          setError(nextError.message || '개인정보 검토가 필요하여 AI 처리가 차단되었습니다.');
        }
      } else {
        setError(nextError.message || '처리 중 오류가 발생했습니다.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="case-input-page">
      {isSubmitting ? (
        <div className="global-loading-overlay">
          <div className="global-loading-content">
            <div className="spinner" />
            <div className="global-loading-text">
              {processStage || pageCopy.loadingMessage}
            </div>
            <div className="global-loading-subtext">
              분석에는 보통 1~2분이 걸립니다. 창을 닫지 말고 기다려 주세요.
            </div>
          </div>
        </div>
      ) : null}

      <div className="container">
        <PageHeader
          isScaffold={isScaffold}
          pageCopy={pageCopy}
          homePath={getHomePath(mode, researchMode)}
          onSelectMode={() => navigate('/')}
          onGoHome={() => navigate(getHomePath(mode, researchMode))}
          onOpenReview={() => navigate('/manuscript-review')}
        />

        <div className="main-tab-menu">
          <button
            className={`main-tab-item ${mainTab === INPUT_TAB ? 'active' : ''}`}
            onClick={() => handleMainTabChange(INPUT_TAB)}
          >
            입력
          </button>
          <button
            className={`main-tab-item ${mainTab === HISTORY_TAB ? 'active' : ''}`}
            onClick={() => handleMainTabChange(HISTORY_TAB)}
          >
            히스토리
          </button>
        </div>

        {mainTab === INPUT_TAB ? (
          <InputTabContent
            researchMode={researchMode}
            pageCopy={pageCopy}
            visits={visits}
            visitRefs={visitRefs}
            draftTitle={draftTitle}
            participantCode={participantCode}
            sessionId={researchSessionId}
            error={error}
            blockedCase={blockedCase}
            isSaving={isSaving}
            isSubmitting={isSubmitting}
            hasTextInput={hasTextInput}
            showSaveDraftModal={showSaveDraftModal}
            showLoadDraftModal={showLoadDraftModal}
            draftCases={draftCases}
            isLoadingDrafts={isLoadingDrafts}
            onDraftTitleChange={setDraftTitle}
            onParticipantCodeChange={setParticipantCode}
            onOpenDrafts={() => {
              setShowLoadDraftModal(true);
              void loadDraftCases();
            }}
            onLoadStudyCase={() => void handleLoadStudyCase()}
            duplicateCase={duplicateCase}
            onResumeDuplicate={resumeDuplicate}
            uploadPanel={
              mode === 'write' && researchMode ? (
                <>
                  {presets.length > 0 ? (
                    <div className="record-upload__presets">
                      <span>실험 사례 불러오기 (방문 기록만, 분석은 새로 함)</span>
                      <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value)}>
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label} · 방문 {preset.visitCount}회{preset.relativeDates ? ' · 상대 날짜' : ''}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => void handleLoadPreset()}>
                        불러오기
                      </button>
                    </div>
                  ) : null}
                  <RecordUploadPanel onApplyVisits={handleApplyUploadedVisits} />
                  {uploadedRecordSource ? (
                    <p className="record-upload__applied">
                      "{uploadedRecordSource.fileName}"에서 방문 {uploadedRecordSource.visitCount}개를 가져왔습니다. 아래에서 날짜와
                      내용을 확인하고 고칠 수 있습니다.
                      {uploadedRecordSource.relativeDates
                        ? ' 이 기록은 날짜 대신 "첫 기록일 기준 N일 후"만 있어, 아래 날짜 칸은 2025-01-01을 기준일로 둔 임의 날짜입니다. 초안에는 "첫 기록일 +N일"로 들어갑니다.'
                        : ''}
                    </p>
                  ) : null}
                </>
              ) : undefined
            }
            onAddVisit={addVisit}
            onUpdateVisit={updateVisit}
            onRemoveVisit={removeVisit}
            onOpenBlockedCase={() => {
              if (blockedCase?.id) {
                navigate(getOverviewPath(mode, blockedCase.id, researchMode));
              }
            }}
            onCloseSaveDraftModal={() => setShowSaveDraftModal(false)}
            onSaveDraft={() => void saveDraft()}
            onCloseLoadDraftModal={() => setShowLoadDraftModal(false)}
            onSelectDraft={handleLoadDraft}
            onShowSaveDraftModal={() => setShowSaveDraftModal(true)}
            onSubmit={() => void submitForProcessing()}
            onDelete={() => handleDeleteClick()}
            formatDate={formatDate}
          />
        ) : (
          <HistoryTabContent
            isScaffold={isScaffold}
            filteredCases={filteredCases}
            selectedFilter={selectedFilter}
            sortOrder={sortOrder}
            isLoadingCases={isLoadingCases}
            onFilterChange={setSelectedFilter}
            onSortOrderChange={setSortOrder}
            onCaseClick={handleCaseClick}
            onDeleteCase={(caseId) => handleDeleteClick(caseId)}
            formatDate={formatDate}
          />
        )}
      </div>
    </div>
  );
}
