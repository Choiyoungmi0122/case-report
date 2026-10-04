import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ScaffoldActionButton from '../components/scaffold/ScaffoldActionButton';
import ScaffoldBulletList from '../components/scaffold/ScaffoldBulletList';
import ScaffoldHero from '../components/scaffold/ScaffoldHero';
import ScaffoldPageFrame from '../components/scaffold/ScaffoldPageFrame';
import ScaffoldPanel from '../components/scaffold/ScaffoldPanel';
import ScaffoldStatGrid from '../components/scaffold/ScaffoldStatGrid';
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

const SECTION_LABELS: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '경과 기록',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 관찰 및 결과',
  DISCUSSION_CONCLUSION: '고찰',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '환자 동의'
};

const JUDGMENT_LABELS: Record<string, string> = {
  supported_by_record: '기록 근거 충분',
  differs_from_record: '기록과 다름',
  needs_additional_confirmation: '기록만으로 확인하기 어려움',
  needs_instructor_review: '교수님께 확인',
  uncertain: '판단 어려움',
  available_in_record: '기록에서 확인 가능',
  unavailable: '현재 기록으로 확인할 수 없음',
  pending: '판단 보류'
};

function sectionName(sectionId: string) {
  return SECTION_LABELS[sectionId] || sectionId;
}

function judgmentName(judgment: string) {
  return JUDGMENT_LABELS[judgment] || judgment || '-';
}

const recordHeadingStyle = { display: 'block', color: '#17324d', fontSize: 17 } as const;
const recordLabelStyle = { color: '#32647f', fontSize: 14, fontWeight: 700 } as const;
const recordThStyle = {
  textAlign: 'left',
  padding: '10px 12px',
  border: '1px solid #d7e0e8',
  background: '#f3f6fa',
  color: '#17324d'
} as const;
const recordTdStyle = {
  padding: '10px 12px',
  border: '1px solid #d7e0e8',
  verticalAlign: 'top',
  lineHeight: 1.65
} as const;

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

  const reviewItems = useMemo(() => data?.scaffoldState.reviewItems || [], [data]);

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

  // 실제로 작업한 CARE 항목만 보여준다. 열어보지 않은 항목까지 나열하면
  // 학습자와 교수자가 읽어야 할 내용이 빈 칸에 묻힌다.
  const workedSections = useMemo(
    () =>
      (data?.sectionStates || []).filter((sectionState) => {
        const progress = progressBySection.get(sectionState.sectionId);
        return (
          Boolean(progress?.recordReviewCompleted || progress?.draftRevealed) ||
          snapshotBySection.has(sectionState.sectionId) ||
          reviewItems.some((item) => item.sectionId === sectionState.sectionId)
        );
      }),
    [data, progressBySection, snapshotBySection, reviewItems]
  );

  const instructorListItems = useMemo(() => {
    const fromJudgments = reviewItems
      .filter((item) => item.judgment === 'needs_instructor_review')
      .map((item) => ({
        id: item.id,
        text: `[${sectionName(item.sectionId)}] ${item.sourceText}${item.note ? ` - ${item.note}` : ''}`
      }));
    const fromReflections = (data?.scaffoldState.sectionReflections || [])
      .filter((item) => item.postAiReflection?.unresolvedQuestion)
      .map((item) => ({
        id: `reflection-${item.sectionId}`,
        text: `[${sectionName(item.sectionId)}] ${item.postAiReflection?.unresolvedQuestion}`
      }));
    return [...fromJudgments, ...fromReflections];
  }, [data, reviewItems]);

  const confirmationListItems = useMemo(
    () =>
      reviewItems
        .filter(
          (item) => item.judgment === 'needs_additional_confirmation' || item.judgment === 'differs_from_record'
        )
        .map((item) => ({
          id: item.id,
          text: `[${sectionName(item.sectionId)}] ${item.sourceText}${item.note ? ` - ${item.note}` : ''}`
        })),
    [reviewItems]
  );

  const caseNotes = data?.scaffoldState.caseMap?.caseNotes || [];

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
      setError(nextError.message || 'Word 내보내기에 실패했습니다.');
    } finally {
      setIsExporting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24 }}>학습 기록을 불러오는 중입니다...</div>;
  }

  if (!data || error) {
    return <div style={{ padding: 24, color: '#b42318' }}>{error || '학습 기록을 찾을 수 없습니다.'}</div>;
  }

  const evidenceTextById = new Map<string, string>(
    (data.evidenceCards || []).map((card: any) => [String(card.id), String(card.sourceText || card.normalizedText || '')])
  );

  return (
    <ScaffoldPageFrame>
      <ScaffoldHero
        title="내 학습 기록"
        description="AI 초안을 보기 전 내 정리, AI 초안에서 표시한 문장과 이유, 초안에 빠졌다고 본 내용, AI를 보고 달라진 점을 CARE 항목별로 모았습니다."
        actions={
          <>
            {!studyMode ? (
              <ScaffoldActionButton onClick={() => navigate('/')}>모드 선택</ScaffoldActionButton>
            ) : null}
            <ScaffoldActionButton
              onClick={() => navigate(`${studyMode ? '/study/scaffold' : '/scaffold'}/cases/${caseId}`)}
            >
              CARE 항목으로 돌아가기
            </ScaffoldActionButton>
            <ScaffoldActionButton variant="primary" onClick={() => void handleExport()} disabled={isExporting}>
              {isExporting ? '내보내는 중...' : 'Word로 내보내기'}
            </ScaffoldActionButton>
          </>
        }
      />

      <ScaffoldPanel compact title="요약">
        <ScaffoldStatGrid
          items={[
            { label: '실험번호', value: data.experiment_code || data.experimentCode || '-' },
            { label: '방문 기록', value: `${data.visits?.length ?? 0}회` },
            { label: '작업한 CARE 항목', value: `${workedSections.length}개` },
            {
              label: '완료한 항목',
              value: `${getCompletedScaffoldSectionCount(data)}개`,
              tone: 'success'
            }
          ]}
        />
      </ScaffoldPanel>

      {caseNotes.length > 0 ? (
        <ScaffoldPanel compact title="기록을 읽으며 남긴 메모">
          <ScaffoldBulletList
            items={caseNotes.map((note) => ({
              id: note.id,
              text: `[${note.type === 'question' ? '더 확인할 점' : '눈에 띈 점'}${
                note.id.startsWith('case-note-ai-') ? ' · AI 추천에서 가져옴' : ''
              }] ${note.text}`
            }))}
            emptyMessage="메모가 없습니다."
          />
        </ScaffoldPanel>
      ) : null}

      {workedSections.length === 0 ? (
        <ScaffoldPanel compact title="CARE 항목별 기록">
          <div style={{ color: '#4a5d73', fontSize: 16, lineHeight: 1.7 }}>
            아직 작업한 CARE 항목이 없습니다. CARE 항목을 하나 골라 시작해 보세요.
          </div>
        </ScaffoldPanel>
      ) : (
        workedSections.map((sectionState) => {
          const sectionId = sectionState.sectionId;
          const snapshot = snapshotBySection.get(sectionId);
          const reflection = reflectionBySection.get(sectionId);
          const progress = progressBySection.get(sectionId);
          const preAi: any = snapshot || reflection || {};
          const selectedEvidence: any[] = preAi.selectedEvidence || [];
          const keyItems = parseReflectionList(preAi.learnerKeyInformationItems || preAi.learnerIdentifiedKeyInfo);
          const missingItems = parseReflectionList(preAi.learnerIdentifiedMissingItems);
          const sufficiencyItems = reviewItems.filter(
            (item) => item.sectionId === sectionId && item.sourceType !== 'draft_sentence'
          );
          // 학습자가 다시 볼 문장으로 표시한 것만 보여준다.
          const sentenceItems = reviewItems.filter(
            (item) =>
              item.sectionId === sectionId &&
              item.sourceType === 'draft_sentence' &&
              item.judgment !== 'supported_by_record' &&
              item.judgment !== 'pending'
          );
          const draftText =
            (data.sectionDrafts || []).find((draft) => draft.sectionId === sectionId)?.draftText || '';
          const postAi = reflection?.postAiReflection;

          return (
            <ScaffoldPanel key={sectionId} compact title={sectionName(sectionId)}>
              <div style={{ display: 'grid', gap: 22, fontSize: 16, lineHeight: 1.75, color: '#243b53' }}>
                <div>
                  <strong style={recordHeadingStyle}>① AI 초안을 보기 전 내 정리</strong>
                  {selectedEvidence.length === 0 && keyItems.length === 0 && missingItems.length === 0 ? (
                    <div style={{ marginTop: 8, color: '#4a5d73' }}>기록된 정리 내용이 없습니다.</div>
                  ) : null}
                  {selectedEvidence.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <span style={recordLabelStyle}>기록에서 고른 근거</span>
                      {renderList(
                        selectedEvidence.map((item) =>
                          renderClinicalAnonymizedText(item.label || evidenceTextById.get(String(item.id)) || item.id)
                        ),
                        ''
                      )}
                    </div>
                  ) : null}
                  {keyItems.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <span style={recordLabelStyle}>이 항목에 쓸 내용</span>
                      {renderList(keyItems, '')}
                    </div>
                  ) : null}
                  {missingItems.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <span style={recordLabelStyle}>기록에 부족하다고 본 내용</span>
                      {renderList(missingItems, '')}
                    </div>
                  ) : null}
                  {sufficiencyItems.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <span style={recordLabelStyle}>정보가 충분한지에 대한 판단</span>
                      {renderList(
                        sufficiencyItems.map((item) => `${item.sourceText} → ${judgmentName(item.judgment)}`),
                        ''
                      )}
                    </div>
                  ) : null}
                </div>

                <div>
                  <strong style={recordHeadingStyle}>② AI 초안과 내 검토</strong>
                  {!progress?.draftRevealed ? (
                    <div style={{ marginTop: 8, color: '#4a5d73' }}>아직 AI 초안을 확인하지 않았습니다.</div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <span style={recordLabelStyle}>AI 초안</span>
                      <div
                        style={{
                          marginTop: 6,
                          padding: '12px 14px',
                          borderLeft: '4px solid #3b6fd4',
                          background: '#eef4ff',
                          borderRadius: 6,
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {renderClinicalAnonymizedText(draftText) || 'AI 초안이 없습니다.'}
                      </div>
                    </div>
                  )}
                  {!progress?.draftRevealed ? null : sentenceItems.length === 0 ? (
                    <div style={{ marginTop: 12, color: '#4a5d73' }}>다시 볼 문장으로 표시한 것이 없습니다.</div>
                  ) : (
                    <div style={{ overflowX: 'auto', marginTop: 12 }}>
                      <span style={recordLabelStyle}>내가 표시한 문장 {sentenceItems.length}개</span>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, marginTop: 6 }}>
                        <thead>
                          <tr>
                            <th style={recordThStyle}>표시한 AI 문장</th>
                            <th style={{ ...recordThStyle, width: 150 }}>종류</th>
                            <th style={{ ...recordThStyle, width: '38%' }}>이유와 연결한 기록</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sentenceItems.map((item) => (
                            <tr key={item.id}>
                              <td style={recordTdStyle}>{renderClinicalAnonymizedText(item.sourceText)}</td>
                              <td style={{ ...recordTdStyle, fontWeight: 700 }}>{judgmentName(item.judgment)}</td>
                              <td style={recordTdStyle}>
                                {item.note ? <div>{item.note}</div> : null}
                                {(item.evidenceIds || []).map((id) =>
                                  evidenceTextById.get(String(id)) ? (
                                    <div key={id} style={{ color: '#52606d', marginTop: 4 }}>
                                      [기록] {renderClinicalAnonymizedText(evidenceTextById.get(String(id)))}
                                    </div>
                                  ) : null
                                )}
                                {!item.note && (item.evidenceIds || []).length === 0 ? '-' : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {progress?.draftRevealed ? (
                  <div>
                    <strong style={recordHeadingStyle}>AI 초안에 빠졌다고 본 내용</strong>
                    <div style={{ marginTop: 8 }}>{postAi?.missingInDraft || '적은 내용이 없습니다.'}</div>
                  </div>
                ) : null}

                <div>
                  <strong style={recordHeadingStyle}>③ AI를 보고 달라진 점</strong>
                  <div style={{ marginTop: 8 }}>{postAi?.changedJudgment || '기록된 내용이 없습니다.'}</div>
                </div>

                {postAi?.unresolvedQuestion ? (
                  <div>
                    <strong style={recordHeadingStyle}>④ 교수님께 확인하고 싶은 것</strong>
                    <div style={{ marginTop: 8 }}>{postAi.unresolvedQuestion}</div>
                  </div>
                ) : null}
              </div>
            </ScaffoldPanel>
          );
        })
      )}

      <ScaffoldPanel compact title="모아 보기: 교수님께 확인할 것">
        <ScaffoldBulletList items={instructorListItems} emptyMessage="표시한 항목이 없습니다." />
      </ScaffoldPanel>

      <ScaffoldPanel compact title="모아 보기: 기록과 다르거나 추가 확인이 필요한 것">
        <ScaffoldBulletList items={confirmationListItems} emptyMessage="표시한 항목이 없습니다." />
      </ScaffoldPanel>
    </ScaffoldPageFrame>
  );
}
