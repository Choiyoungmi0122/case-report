import { useNavigate } from 'react-router-dom';
import type { ScaffoldStateResponse } from '../../services/api';
import { getReadOnlyViewCaseId } from '../../utils/readOnlyView';
import { getSectionConfig, getSectionsByGroup } from '../../utils/scaffoldUi';
import { getStudySectionIds, isScaffoldV2Data } from '../../utils/scaffoldVersion';

export type ReadOnlyStage = 'pre' | 'post';

export interface ReadOnlyStop {
  key: string;
  label: string;
  path: string;
}

/**
 * 다시 보기 모드 전용 이동 띠.
 *
 * 참가자 화면의 단계 이동은 저장을 거쳐야 넘어가는데, 다시 보기에서는 저장이 막혀
 * 있다. 그래서 저장된 기록을 'AI 초안 공개 전 화면'과 '공개 후 화면'으로 나누어, 항목
 * 순서대로 이전/다음만 눌러 훑어볼 수 있게 한다.
 */
export default function ReadOnlyStageNavigator({
  stops,
  currentKey,
  onGo
}: {
  stops: ReadOnlyStop[];
  currentKey: string;
  onGo: (path: string) => void;
}) {
  const index = stops.findIndex((stop) => stop.key === currentKey);
  const previous = index > 0 ? stops[index - 1] : null;
  const next = index >= 0 && index < stops.length - 1 ? stops[index + 1] : null;

  const buttonStyle = (enabled: boolean) => ({
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #1f2733',
    background: enabled ? '#1f2733' : '#e6e9ee',
    color: enabled ? '#fff' : '#8a94a3',
    fontSize: 14,
    fontWeight: 700,
    cursor: enabled ? 'pointer' : 'default'
  });

  return (
    <nav
      aria-label="다시 보기 이동"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        margin: '10px 0 14px 0',
        padding: '10px 12px',
        border: '1px solid #c9d2de',
        borderRadius: 10,
        background: '#f4f6f9'
      }}
    >
      <button
        type="button"
        disabled={!previous}
        style={buttonStyle(Boolean(previous))}
        onClick={() => previous && onGo(previous.path)}
      >
        ← 이전
      </button>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
        {stops.map((stop, stopIndex) => {
          const isCurrent = stop.key === currentKey;
          return (
            <button
              key={stop.key}
              type="button"
              aria-current={isCurrent ? 'step' : undefined}
              onClick={() => onGo(stop.path)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: isCurrent ? '2px solid #1f2733' : '1px solid #c9d2de',
                background: isCurrent ? '#fff' : 'transparent',
                color: '#1f2733',
                fontSize: 13,
                fontWeight: isCurrent ? 700 : 500,
                cursor: 'pointer'
              }}
            >
              {stopIndex + 1}. {stop.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!next}
        style={buttonStyle(Boolean(next))}
        onClick={() => next && onGo(next.path)}
      >
        다음 →
      </button>
    </nav>
  );
}

/** 기록 읽기 → 개요 → 항목별(공개 전, 공개 후) → 학습 기록 순서의 이동 목록. */
export function buildReadOnlyStops(params: {
  caseId: string;
  sectionIds: string[];
  revealedSectionIds: string[];
  sectionLabel: (sectionId: string) => string;
  /** 실험 모드가 아닌 사례(전체 섹션)는 일반 경로로 연다 */
  basePath?: string;
  /** AI 비교 단계가 없는 "추가 작성" 섹션. 화면 하나만 둔다 */
  writeOnlySectionIds?: string[];
}): ReadOnlyStop[] {
  const base = `${params.basePath || '/study/scaffold'}/cases/${params.caseId}`;
  const stops: ReadOnlyStop[] = [
    { key: 'read', label: '기록 읽기 · 메모', path: `${base}?phase=read` },
    { key: 'overview', label: 'CARE 항목 개요', path: `${base}?phase=write` }
  ];

  for (const sectionId of params.sectionIds) {
    const label = params.sectionLabel(sectionId);
    if (params.writeOnlySectionIds?.includes(sectionId)) {
      stops.push({ key: `${sectionId}:pre`, label: `${label} · 추가 작성`, path: `${base}/sections/${sectionId}?stage=pre` });
      continue;
    }
    stops.push({
      key: `${sectionId}:pre`,
      label: `${label} · AI 초안 보기 전`,
      path: `${base}/sections/${sectionId}?stage=pre`
    });
    if (params.revealedSectionIds.includes(sectionId)) {
      stops.push({
        key: `${sectionId}:post`,
        label: `${label} · AI 초안과 비교`,
        path: `${base}/sections/${sectionId}?stage=post`
      });
    }
  }

  stops.push({ key: 'summary', label: '학습 기록', path: `${base}/summary` });
  return stops;
}

/**
 * 화면에 한 줄로 끼워 넣는 형태. 다시 보기 모드가 아니면 아무것도 그리지 않는다.
 */
export function ReadOnlyNavigatorBar({
  caseId,
  data,
  currentKey
}: {
  caseId?: string;
  data: ScaffoldStateResponse | null;
  currentKey: string;
}) {
  const navigate = useNavigate();
  if (!caseId || !data || getReadOnlyViewCaseId() !== caseId) return null;

  const available = (data.sectionStates || []).map((item) => item.sectionId as string);
  // 실험 모드가 아닌 V2 사례(전체 섹션 시험·시연)는 모든 섹션을 훑어볼 수 있게 한다 (2026-10-12).
  // 학생 V1 기록은 studyConfig 가 비어 있어도 예전처럼 실험 경로·실험 섹션으로 연다.
  const fullSectionV2 = isScaffoldV2Data(data) && !data.studyConfig?.studyMode;
  const studyMode = !fullSectionV2;
  const studied = studyMode ? getStudySectionIds(data).filter((id) => available.includes(id)) : [];
  const sectionIds = studied.length > 0 ? studied : available;
  const writeOnlySectionIds = getSectionsByGroup('additional_authoring').map((section) => section.sectionId as string);
  const revealedSectionIds = (data.scaffoldState?.sectionProgress || [])
    .filter((item) => item.draftRevealed)
    .map((item) => item.sectionId as string);

  return (
    <ReadOnlyStageNavigator
      stops={buildReadOnlyStops({
        caseId,
        sectionIds,
        revealedSectionIds,
        sectionLabel: (sectionId) => getSectionConfig(sectionId)?.displayName || sectionId,
        basePath: studyMode ? '/study/scaffold' : '/scaffold',
        writeOnlySectionIds
      })}
      currentKey={currentKey}
      onGo={(path) => navigate(path)}
    />
  );
}

/** 주소의 `?stage=`로 정해지는, 항목 화면의 다시 보기 단계. */
export function getReadOnlyStage(): ReadOnlyStage {
  return new URLSearchParams(window.location.search).get('stage') === 'post' ? 'post' : 'pre';
}

/** 주소의 `?phase=`로 정해지는, 개요 화면의 다시 보기 단계. */
export function getReadOnlyOverviewPhase(): 'read' | 'write' {
  return new URLSearchParams(window.location.search).get('phase') === 'read' ? 'read' : 'write';
}
