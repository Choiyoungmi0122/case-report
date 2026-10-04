import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ScaffoldActionButton from '../components/scaffold/ScaffoldActionButton';
import ScaffoldBulletList from '../components/scaffold/ScaffoldBulletList';
import ScaffoldEmptyState from '../components/scaffold/ScaffoldEmptyState';
import ScaffoldHero from '../components/scaffold/ScaffoldHero';
import ScaffoldPageFrame from '../components/scaffold/ScaffoldPageFrame';
import ScaffoldPanel from '../components/scaffold/ScaffoldPanel';
import ScaffoldStatGrid from '../components/scaffold/ScaffoldStatGrid';
import ScaffoldStatusTable from '../components/scaffold/ScaffoldStatusTable';
import { caseApi, ExportLayout, ScaffoldPreRevealSnapshot, ScaffoldStateResponse } from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import { getCompletedScaffoldSectionCount } from '../utils/scaffoldUi';

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function parseReflectionList(items?: string[]) {
  return uniqueStrings(items || []);
}

function renderList(items: string[], emptyText: string) {
  if (items.length === 0) {
    return <div style={{ marginTop: 8, color: '#4a5d73' }}>{emptyText}</div>;
  }

  return (
    <ul style={{ marginTop: 8, marginBottom: 0, color: '#4a5d73', lineHeight: 1.7, paddingLeft: 20 }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function ScaffoldSummaryPage({ studyMode = false }: { studyMode?: boolean }) {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ScaffoldStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const viewedRef = useRef(false);

  const logEvent = async (
    eventType: 'final_summary_viewed' | 'export_requested' | 'session_completed',
    metadata?: Record<string, unknown>
  ) => {
    if (!caseId) return;
    try {
      await caseApi.logScaffoldEvent(caseId, {
        eventType,
        sessionId: data?.scaffoldState.sessionId,
        participantCode: data?.scaffoldState.participantCode,
        metadata
      });
    } catch (nextError) {
      console.error('Failed to log scaffold summary event:', nextError);
    }
  };

  useEffect(() => {
    if (!caseId) return;

    let cancelled = false;

    const loadSummary = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextData = await caseApi.getScaffoldState(caseId);
        if (cancelled) return;

        if (nextData.mode !== 'scaffold') {
          navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}`, { replace: true });
          return;
        }

        setData(nextData);
      } catch (nextError: any) {
        if (cancelled) return;
        if (nextError?.response?.data?.mode === 'write') {
          navigate(`${studyMode ? '/study/write' : ''}/cases/${caseId}`, { replace: true });
          return;
        }
        setError(nextError.message || 'Scaffold 요약을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [caseId, navigate, studyMode]);

  useEffect(() => {
    if (!data || viewedRef.current) return;
    viewedRef.current = true;
    void logEvent('final_summary_viewed', {
      completedSectionCount: getCompletedScaffoldSectionCount(data),
      totalSectionCount: (data.sectionStates || []).length
    });
    if (
      data.scaffoldState.completedAt ||
      getCompletedScaffoldSectionCount(data) >= (data.sectionStates || []).length
    ) {
      void logEvent('session_completed', {
        completedSectionCount: getCompletedScaffoldSectionCount(data),
        totalSectionCount: (data.sectionStates || []).length
      });
    }
  }, [data]);

  const progressBySection = useMemo(() => {
    const map = new Map<string, any>();
    (data?.scaffoldState.sectionProgress || []).forEach((item) => map.set(item.sectionId, item));
    return map;
  }, [data]);

  const reflectionBySection = useMemo(() => {
    const map = new Map<string, any>();
    (data?.scaffoldState.sectionReflections || []).forEach((item) => map.set(item.sectionId, item));
    return map;
  }, [data]);

  const snapshotBySection = useMemo(() => {
    const map = new Map<string, ScaffoldPreRevealSnapshot>();
    (data?.scaffoldState.preRevealSnapshots || []).forEach((item) => {
      if (!map.has(item.sectionId)) {
        map.set(item.sectionId, item);
      }
    });
    return map;
  }, [data]);

  const additionalItems = useMemo(
    () => (data?.scaffoldState.reviewItems || []).filter((item) => item.judgment === 'needs_additional_confirmation'),
    [data]
  );

  const instructorItems = useMemo(
    () => (data?.scaffoldState.reviewItems || []).filter((item) => item.judgment === 'needs_instructor_review'),
    [data]
  );

  const unsupportedItems = useMemo(
    () =>
      (data?.scaffoldState.reviewItems || []).filter(
        (item) => item.judgment === 'unavailable' || item.sourceType === 'unsupported_claim'
      ),
    [data]
  );

  const unresolvedSections = useMemo(
    () =>
      (data?.sectionStates || []).filter((sectionState) => {
        const progress = progressBySection.get(sectionState.sectionId);
        return !(
          progress?.recordReviewCompleted &&
          progress?.missingInfoReviewCompleted &&
          progress?.draftRevealed &&
          progress?.draftReviewCompleted
        );
      }),
    [data, progressBySection]
  );

  const statusRows = useMemo(
    () =>
      (data?.sectionStates || []).map((sectionState) => {
        const progress = progressBySection.get(sectionState.sectionId);
        return {
          id: sectionState.sectionId,
          cells: [
            sectionState.sectionId,
            sectionState.status,
            progress?.recordReviewCompleted ? '완료' : '미완료',
            progress?.missingInfoReviewCompleted ? '완료' : '미완료',
            progress?.draftReviewCompleted ? '완료' : '미완료'
          ]
        };
      }),
    [data, progressBySection]
  );

  const additionalListItems = useMemo(
    () =>
      additionalItems.map((item) => ({
        id: item.id,
        text: `[${item.sectionId}] ${item.sourceText}${item.note ? ` - ${item.note}` : ''}`
      })),
    [additionalItems]
  );

  const instructorListItems = useMemo(
    () =>
      instructorItems.map((item) => ({
        id: item.id,
        text: `[${item.sectionId}] ${item.sourceText}${item.note ? ` - ${item.note}` : ''}`
      })),
    [instructorItems]
  );

  const unsupportedListItems = useMemo(
    () =>
      unsupportedItems.map((item) => ({
        id: item.id,
        text: `[${item.sectionId}] ${item.sourceText}${item.note ? ` - ${item.note}` : ''}`
      })),
    [unsupportedItems]
  );

  const handleExport = async () => {
    if (!caseId) return;
    setIsExporting(true);
    setError(null);

    try {
      await logEvent('export_requested', {
        exportMode: 'scaffold_review',
        exportLayout: 'one_paragraph',
        completedSectionCount: getCompletedScaffoldSectionCount(data),
        unresolvedSectionCount: unresolvedSections.length
      });
      const result = await caseApi.exportDocx(caseId, 'scaffold_review', 'one_paragraph' as ExportLayout);
      downloadBlob(result.blob, result.fileName);
    } catch (nextError: any) {
      setError(nextError.message || 'Scaffold Word export에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24 }}>Scaffold 요약을 불러오는 중입니다...</div>;
  }

  if (!data || error) {
    return <div style={{ padding: 24, color: '#b42318' }}>{error || 'Scaffold 요약을 찾을 수 없습니다.'}</div>;
  }

  return (
    <ScaffoldPageFrame>
      <ScaffoldHero
        title="Scaffold 최종 요약"
        description="학습자가 먼저 정리한 내용과 AI 초안 검토 결과를 연구 목적에 맞게 한 번에 확인할 수 있습니다."
        actions={
          <>
            {!studyMode ? (
              <ScaffoldActionButton onClick={() => navigate('/')}>모드 선택</ScaffoldActionButton>
            ) : null}
            <ScaffoldActionButton onClick={() => navigate(studyMode ? '/study/scaffold' : '/scaffold')}>
              {studyMode ? 'Study Scaffold 홈' : 'Scaffold 홈'}
            </ScaffoldActionButton>
            <ScaffoldActionButton
              onClick={() => navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}`)}
            >
              섹션 개요
            </ScaffoldActionButton>
            <ScaffoldActionButton variant="primary" onClick={() => void handleExport()} disabled={isExporting}>
              {isExporting ? '내보내는 중...' : 'Scaffold Word export'}
            </ScaffoldActionButton>
          </>
        }
      />

      <ScaffoldPanel compact title="케이스 요약">
        <ScaffoldStatGrid
          items={[
            { label: '실험번호', value: data.experiment_code || data.experimentCode || '-' },
            { label: '케이스 제목', value: data.title || '제목 없음' },
            { label: '방문 수', value: String(data.visits?.length ?? 0) },
            { label: '분석 섹션 수', value: String((data.sectionStates || []).length) },
            {
              label: '완료 섹션 수',
              value: String(getCompletedScaffoldSectionCount(data)),
              tone: 'success'
            }
          ]}
        />
      </ScaffoldPanel>

      <ScaffoldPanel compact title="CARE 섹션 진행 상태">
        {(statusRows || []).length === 0 ? (
          <ScaffoldEmptyState message="표시할 섹션 상태가 없습니다." />
        ) : (
          <ScaffoldStatusTable
            headers={['CARE 섹션', '현재 상태', '기록 검토', '부족 정보 검토', 'AI 초안 검토']}
            rows={statusRows}
          />
        )}
      </ScaffoldPanel>

      <ScaffoldPanel
        compact
        title="초기 판단 내용"
        description="가능하면 현재 값이 아니라 AI 공개 직전 snapshot을 우선 표시합니다."
      >
        {(data.sectionStates || []).length === 0 ? (
          <ScaffoldEmptyState message="정리된 초기 판단이 없습니다." />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {(data.sectionStates || []).map((sectionState) => {
              const reflection = reflectionBySection.get(sectionState.sectionId);
              const snapshot = snapshotBySection.get(sectionState.sectionId);

              return (
                <div
                  key={sectionState.sectionId}
                  style={{ border: '1px solid #d7e0e8', borderRadius: 8, padding: 16, background: '#fcfdff' }}
                >
                  <strong style={{ color: '#17324d' }}>{sectionState.sectionId}</strong>
                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    <div>
                      <strong>중요 정보</strong>
                      {renderList(
                        parseReflectionList(
                          snapshot?.learnerKeyInformationItems ||
                            reflection?.learnerKeyInformationItems ||
                            reflection?.learnerIdentifiedKeyInfo
                        ),
                        '기록된 내용이 없습니다.'
                      )}
                    </div>
                    <div>
                      <strong>부족 정보</strong>
                      {renderList(
                        parseReflectionList(
                          snapshot?.learnerIdentifiedMissingItems || reflection?.learnerIdentifiedMissingItems
                        ),
                        '기록된 내용이 없습니다.'
                      )}
                    </div>
                    <div>
                      <strong>추가 확인 필요</strong>
                      {renderList(
                        parseReflectionList(
                          snapshot?.additionalConfirmationItems || reflection?.additionalConfirmationItems
                        ),
                        '기록된 내용이 없습니다.'
                      )}
                    </div>
                    <div>
                      <strong>교수 검토 필요</strong>
                      {renderList(
                        parseReflectionList(snapshot?.teacherReviewItems || reflection?.teacherReviewItems),
                        '기록된 내용이 없습니다.'
                      )}
                    </div>
                    <div>
                      <strong>메모</strong>
                      <div style={{ marginTop: 8, color: '#4a5d73', lineHeight: 1.7 }}>
                        {snapshot?.learnerNotes || reflection?.learnerNotes || '메모가 없습니다.'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScaffoldPanel>

      <ScaffoldPanel compact title="AI 초안">
        {(data.sectionDrafts || []).length === 0 ? (
          <ScaffoldEmptyState message="생성된 섹션 초안이 없습니다." />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {(data.sectionDrafts || []).map((draft) => (
              <div
                key={draft.sectionId}
                style={{ border: '1px solid #d7e0e8', borderRadius: 8, padding: 16, background: '#fff' }}
              >
                <strong style={{ color: '#17324d' }}>{draft.sectionId}</strong>
                <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.8, color: '#4a5d73' }}>
                  {renderClinicalAnonymizedText(draft.draftText) || '초안 없음'}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScaffoldPanel>

      <ScaffoldPanel
        compact
        title="AI 검토 후 회고"
        description="AI 공개 전 판단과 비교해 달라진 점과 다음 작성에 적용할 내용을 보여줍니다."
      >
        {(data.sectionStates || []).some(
          (sectionState) => reflectionBySection.get(sectionState.sectionId)?.postAiReflection
        ) ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {(data.sectionStates || []).map((sectionState) => {
              const postAiReflection = reflectionBySection.get(sectionState.sectionId)?.postAiReflection;
              if (!postAiReflection) return null;

              return (
                <div
                  key={sectionState.sectionId}
                  style={{ borderLeft: '3px solid #2f855a', paddingLeft: 14 }}
                >
                  <strong style={{ color: '#17324d' }}>{sectionState.sectionId}</strong>
                  <div style={{ display: 'grid', gap: 10, marginTop: 10, color: '#4a5d73', lineHeight: 1.7 }}>
                    <div><strong>달라진 판단</strong><div>{postAiReflection.changedJudgment}</div></div>
                    <div><strong>남은 확인사항</strong><div>{postAiReflection.unresolvedQuestion}</div></div>
                    <div><strong>다음 적용점</strong><div>{postAiReflection.transferPlan}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ScaffoldEmptyState message="저장된 AI 검토 후 회고가 없습니다." />
        )}
      </ScaffoldPanel>

      <ScaffoldPanel compact title="추가 확인이 필요한 내용">
        <ScaffoldBulletList
          items={additionalListItems}
          emptyMessage="현재 추가 확인이 필요한 내용이 없습니다."
        />
      </ScaffoldPanel>

      <ScaffoldPanel compact title="교수 검토가 필요한 내용">
        <ScaffoldBulletList
          items={instructorListItems}
          emptyMessage="현재 교수 검토가 필요한 내용이 없습니다."
        />
      </ScaffoldPanel>

      <ScaffoldPanel compact title="근거가 부족한 내용">
        <ScaffoldBulletList
          items={unsupportedListItems}
          emptyMessage="현재 근거가 부족한 항목이 없습니다."
        />
      </ScaffoldPanel>

      <ScaffoldPanel compact title="미완료 섹션">
        {unresolvedSections.length === 0 ? (
          <ScaffoldEmptyState message="모든 섹션이 현재 기준으로 검토 완료 상태입니다." />
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {unresolvedSections.map((sectionState) => (
              <div
                key={sectionState.sectionId}
                style={{ border: '1px solid #d7e0e8', borderRadius: 8, padding: 16, background: '#fff' }}
              >
                <strong style={{ color: '#17324d' }}>{sectionState.sectionId}</strong>
                <div style={{ marginTop: 8, color: '#4a5d73', lineHeight: 1.7 }}>
                  {sectionState.rationaleText}
                </div>
                {renderList(sectionState.missingInfoBullets || [], '아직 정리되지 않은 부족 정보가 없습니다.')}
              </div>
            ))}
          </div>
        )}
      </ScaffoldPanel>
    </ScaffoldPageFrame>
  );
}
