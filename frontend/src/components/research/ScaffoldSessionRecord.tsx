import type { CSSProperties } from 'react';
import {
  DRAFT_JUDGMENT_OPTIONS,
  INFORMATION_STATUS_JUDGMENT_OPTIONS,
  STUDY_SECTION_IDS,
  getSectionConfig
} from '../../utils/scaffoldUi';

/**
 * 연구자용 조회 화면에서 Scaffold 세션 한 건을 지금의 진행 순서대로 보여준다:
 * 소요 시간 → 1단계 메모 → 항목별(내 초안, 충분성 판단, AI 초안, 표시한 문장,
 * 비교 후 정리) → 행동 타임라인.
 */

type TimelineRow = {
  sequenceIndex?: number;
  elapsedSeconds: number | null;
  gapSeconds: number | null;
  eventType: string;
  kind: string | null;
  sectionId: string | null;
  metadata: Record<string, any> | null;
};

const LONG_GAP_SECONDS = 60;

const EVENT_LABELS: Record<string, string> = {
  session_start: '세션 시작',
  case_created: '사례 생성 (분석 시작)',
  mode_selected: '모드 선택',
  case_map_saved: '1단계 메모 저장',
  workflow_phase_changed: '단계 이동',
  section_opened: '항목 열기',
  section_purpose_viewed: 'CARE 기준 보기',
  learner_reflection_saved: '내 초안 저장',
  record_review_completed: '내 초안 쓰기 완료',
  information_status_judgment_saved: '충분성 질문 답',
  evidence_opened: '기록에서 관련된 부분 보기',
  pre_reveal_snapshot_created: 'AI 공개 전 내용 보존',
  ai_draft_revealed: 'AI 초안 공개',
  post_ai_review_started: '비교 시작',
  draft_judgment_saved: '문장 표시 저장',
  post_ai_reflection_saved: '비교 후 정리 저장',
  draft_review_completed: '비교 완료',
  section_completed: '항목 완료',
  final_summary_viewed: '내 학습 기록 보기',
  export_requested: 'Word 내보내기'
};

const UI_ACTION_LABELS: Record<string, string> = {
  intro_confirmed: '진행 방법 확인',
  intro_reopened: '진행 방법 다시 보기',
  visit_jump: '회차 바로가기',
  memo_suggestion_opened: 'AI 메모 추천 열기',
  memo_suggestion_added: 'AI 메모 추천 추가',
  field_edit: '입력 칸에 머묾',
  record_visit_toggled: '원기록 회차 펼침/접음',
  evidence_picker_opened: '근거 목록 열기',
  back_to_own_draft: '내 초안 다시 쓰기로 돌아감',
  sentence_flag_opened: 'AI 문장 누름',
  sentence_flag_kind_selected: '표시 종류 고름',
  sentence_flag_cancelled: '표시 해제',
  care_element_map_toggled: 'CARE 세부 항목 표 펼침/접음',
  pause: '멈춤 (입력 없음)'
};

const FIELD_LABELS: Record<string, string> = {
  own_draft: '내 초안',
  missing_in_draft: 'AI 초안에 빠진 내용',
  comparison_note: '비교해 보니'
};

const NOTE_TYPE_LABELS: Record<string, string> = {
  observation: '눈에 띈 점',
  question: '더 확인할 점'
};

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sectionName(sectionId?: string | null) {
  if (!sectionId) return '';
  return getSectionConfig(sectionId)?.displayName || sectionId;
}

function formatClock(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '-';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}초`;
  return `${Math.floor(total / 60)}분 ${total % 60}초`;
}

// 화면에서 문장 표시 종류로 보여 주는 이름과 맞춘다.
const FLAG_LABELS: Record<string, string> = {
  want_to_add: '내 초안에 더하고 싶음',
  differs_from_record: '기록과 다름',
  needs_additional_confirmation: '기록만으로 확인하기 어려움',
  needs_instructor_review: '교수님께 확인'
};

function judgmentLabel(value: string, isDraftSentence = false) {
  if (isDraftSentence && FLAG_LABELS[value]) return FLAG_LABELS[value];
  if (value === 'want_to_add') return FLAG_LABELS.want_to_add;
  return (
    DRAFT_JUDGMENT_OPTIONS.find((option) => option.value === value)?.label ||
    INFORMATION_STATUS_JUDGMENT_OPTIONS.find((option) => option.value === value)?.label ||
    value
  );
}

function eventLabel(row: TimelineRow) {
  if (row.eventType === 'ui_action') return UI_ACTION_LABELS[row.kind || ''] || row.kind || '화면 행동';
  return EVENT_LABELS[row.eventType] || row.eventType;
}

function eventDetail(row: TimelineRow) {
  const meta = row.metadata || {};
  const parts: string[] = [];
  if (meta.field) parts.push(FIELD_LABELS[meta.field] || meta.field);
  if (meta.durationSeconds !== undefined) parts.push(formatDuration(meta.durationSeconds));
  if (meta.length !== undefined) parts.push(`${meta.length}자`);
  if (meta.visit !== undefined) parts.push(`${meta.visit}회차`);
  if (meta.sentenceIndex !== undefined) parts.push(`${meta.sentenceIndex}번째 문장`);
  if (meta.judgment) parts.push(judgmentLabel(meta.judgment, row.kind === 'sentence_flag_kind_selected'));
  if (meta.questionId) parts.push(`질문 ${meta.questionId}`);
  if (meta.step && row.kind === 'pause') parts.push(`단계 ${meta.step}${meta.draftRevealed ? ' (AI 공개 후)' : ''}`);
  return parts.join(' · ');
}

function firstElapsed(rows: TimelineRow[], predicate: (row: TimelineRow) => boolean) {
  const row = rows.find(predicate);
  return row?.elapsedSeconds ?? null;
}

function lastElapsed(rows: TimelineRow[], predicate: (row: TimelineRow) => boolean) {
  const matched = rows.filter(predicate);
  return matched.length ? matched[matched.length - 1].elapsedSeconds : null;
}

function diff(end: number | null, start: number | null) {
  if (end === null || start === null) return null;
  return end - start;
}

function downloadCsv(rows: TimelineRow[], fileName: string) {
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['순서', '경과(초)', '직전 간격(초)', '행동', '항목', '세부', 'eventType', 'kind'].map(escape).join(','),
    ...rows.map((row, index) =>
      [
        index + 1,
        row.elapsedSeconds ?? '',
        row.gapSeconds ?? '',
        eventLabel(row),
        sectionName(row.sectionId),
        eventDetail(row),
        row.eventType,
        row.kind || ''
      ]
        .map(escape)
        .join(',')
    )
  ];
  // 엑셀이 한글을 바로 읽도록 BOM을 붙인다.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function ScaffoldSessionRecord({ exportData, experimentCode }: { exportData: any; experimentCode: string }) {
  const scaffoldData = exportData?.scaffoldData || {};
  const timeline = asArray<TimelineRow>(scaffoldData.eventTimeline);
  const reflections = asArray<any>(scaffoldData.sectionReflections);
  const progressList = asArray<any>(scaffoldData.sectionProgress);
  const reviewItems = asArray<any>(scaffoldData.reviewItems);
  const drafts = asArray<any>(exportData?.sectionDrafts);
  const caseNotes = asArray<any>(scaffoldData.caseMap?.caseNotes);

  // 실습한 항목만, 실험 순서(치료 개입 → 추적 관찰 및 결과)를 앞에 두고 보여준다.
  const workedIds = Array.from(
    new Set([...reflections.map((item) => item.sectionId), ...progressList.map((item) => item.sectionId)])
  ).sort((a, b) => {
    const rank = (id: string) => (STUDY_SECTION_IDS.includes(id) ? STUDY_SECTION_IDS.indexOf(id) : 99);
    return rank(a) - rank(b);
  });

  const totalSeconds = timeline.length ? timeline[timeline.length - 1].elapsedSeconds : null;
  const firstSectionOpened = firstElapsed(timeline, (row) => row.eventType === 'section_opened');
  const introConfirmed = firstElapsed(timeline, (row) => row.kind === 'intro_confirmed');
  const pauses = timeline.filter((row) => row.kind === 'pause');

  const sectionTimes = workedIds.map((sectionId) => {
    const rows = timeline.filter((row) => row.sectionId === sectionId);
    const opened = firstElapsed(rows, (row) => row.eventType === 'section_opened');
    const revealed = firstElapsed(rows, (row) => row.eventType === 'ai_draft_revealed');
    const completed = lastElapsed(rows, (row) => row.eventType === 'section_completed');
    const sectionPauses = rows.filter((row) => row.kind === 'pause');
    return {
      sectionId,
      beforeAi: diff(revealed, opened),
      afterAi: diff(completed, revealed),
      total: diff(completed, opened),
      pauseCount: sectionPauses.length,
      pauseSeconds: sectionPauses.reduce((sum, row) => sum + Number(row.metadata?.durationSeconds || 0), 0)
    };
  });

  return (
    <div style={styles.wrap}>
      <section style={styles.card}>
        <h3 style={styles.title}>소요 시간</h3>
        <p style={styles.hint}>
          시작은 "CARE 구조 분석 시작"을 누른 시각이다. 멈춤은 키보드, 클릭, 스크롤이 20초 넘게 없던 구간이며 항목 작성 화면에서만 잡힌다.
        </p>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>구간</th>
              <th style={styles.th}>걸린 시간</th>
              <th style={styles.th}>멈춤</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}>전체 (시작 → 마지막 행동)</td>
              <td style={styles.td}>{formatDuration(totalSeconds)}</td>
              <td style={styles.td}>
                {pauses.length}회 ·{' '}
                {formatDuration(pauses.reduce((sum, row) => sum + Number(row.metadata?.durationSeconds || 0), 0))}
              </td>
            </tr>
            <tr>
              <td style={styles.td}>진행 방법 화면 (시작 → 확인)</td>
              <td style={styles.td}>{formatDuration(introConfirmed)}</td>
              <td style={styles.td}>-</td>
            </tr>
            <tr>
              <td style={styles.td}>1단계 기록 읽기와 메모 (→ 첫 항목 열기)</td>
              <td style={styles.td}>{formatDuration(diff(firstSectionOpened, introConfirmed ?? 0))}</td>
              <td style={styles.td}>-</td>
            </tr>
            {sectionTimes.map((item) => (
              <tr key={item.sectionId}>
                <td style={styles.td}>
                  <strong>{sectionName(item.sectionId)}</strong>
                  <br />
                  <span style={styles.sub}>
                    AI 보기 전 {formatDuration(item.beforeAi)} · AI 초안 비교 {formatDuration(item.afterAi)}
                  </span>
                </td>
                <td style={styles.td}>{formatDuration(item.total)}</td>
                <td style={styles.td}>
                  {item.pauseCount}회 · {formatDuration(item.pauseSeconds)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={styles.card}>
        <h3 style={styles.title}>1단계 메모 ({caseNotes.length}개)</h3>
        {caseNotes.length ? (
          <ul style={styles.list}>
            {caseNotes.map((note) => (
              <li key={note.id}>
                <span style={styles.tag}>{NOTE_TYPE_LABELS[note.type] || note.type}</span>
                {String(note.id || '').startsWith('case-note-ai-') ? <span style={styles.tagAi}>AI 추천에서 추가</span> : null}
                {note.text}
              </li>
            ))}
          </ul>
        ) : (
          <p style={styles.empty}>남긴 메모가 없다.</p>
        )}
      </section>

      {workedIds.map((sectionId) => {
        const reflection = reflections.find((item) => item.sectionId === sectionId);
        const progress = progressList.find((item) => item.sectionId === sectionId);
        const draft = drafts.find((item) => item.sectionId === sectionId);
        const items = reviewItems.filter((item) => item.sectionId === sectionId);
        const sufficiency = items.filter((item) => item.sourceType !== 'draft_sentence');
        const flagged = items.filter((item) => item.sourceType === 'draft_sentence' && item.judgment !== 'pending');
        const post = reflection?.postAiReflection || {};

        return (
          <section key={sectionId} style={styles.card}>
            <div style={styles.headerRow}>
              <h3 style={styles.title}>{sectionName(sectionId)}</h3>
              <span style={styles.badge}>
                {progress?.completedAt ? '완료' : progress?.draftRevealed ? 'AI 초안 비교 중' : '내 초안 단계'}
              </span>
            </div>

            <h4 style={styles.h4}>① 내가 쓴 초안 (AI 초안을 보기 전)</h4>
            <p style={styles.own}>{reflection?.learnerNotes || '적지 않음'}</p>

            <h4 style={styles.h4}>② 정보가 충분한지 판단</h4>
            {sufficiency.length ? (
              <ul style={styles.list}>
                {sufficiency.map((item) => (
                  <li key={item.id}>
                    {item.sourceText} → <strong>{judgmentLabel(item.judgment)}</strong>
                    {item.note ? <span style={styles.sub}> ({item.note})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={styles.empty}>답한 질문이 없다.</p>
            )}

            <h4 style={styles.h4}>③ AI 초안과 비교</h4>
            {progress?.draftRevealed ? (
              <>
                <details>
                  <summary style={styles.summary}>AI 초안 보기 (모든 참여자에게 같은 초안)</summary>
                  <p style={styles.ai}>{draft?.draftText || '-'}</p>
                </details>
                <p style={styles.label}>표시한 문장 ({flagged.length}개)</p>
                {flagged.length ? (
                  <ul style={styles.list}>
                    {flagged.map((item) => (
                      <li key={item.id}>
                        <span style={styles.tag}>{judgmentLabel(item.judgment, true)}</span>
                        {item.sourceText}
                        {item.note ? <div style={styles.sub}>이유: {item.note}</div> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={styles.empty}>표시한 문장이 없다.</p>
                )}
                <p style={styles.label}>AI 초안에 빠졌다고 본 내용</p>
                <p style={styles.own}>{post.missingInDraft || '적지 않음'}</p>
                <p style={styles.label}>내 초안과 AI 초안을 비교해 보니</p>
                <p style={styles.own}>{post.changedJudgment || '적지 않음'}</p>
                {post.unresolvedQuestion ? (
                  <>
                    <p style={styles.label}>교수님께 확인하고 싶은 것</p>
                    <p style={styles.own}>{post.unresolvedQuestion}</p>
                  </>
                ) : null}
              </>
            ) : (
              <p style={styles.empty}>AI 초안을 아직 보지 않았다.</p>
            )}
          </section>
        );
      })}

      <section style={styles.card}>
        <div style={styles.headerRow}>
          <h3 style={styles.title}>행동 타임라인 ({timeline.length}건)</h3>
          <button
            type="button"
            style={styles.button}
            disabled={!timeline.length}
            onClick={() => downloadCsv(timeline, `${experimentCode}_timeline.csv`)}
          >
            CSV 내려받기
          </button>
        </div>
        <p style={styles.hint}>
          경과는 시작 후 흐른 시간, 간격은 직전 행동과의 차이다. 노란 줄은 간격이 {LONG_GAP_SECONDS}초 이상이거나 멈춤으로 기록된 곳이다.
        </p>
        <div style={styles.scroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>경과</th>
                <th style={styles.th}>간격</th>
                <th style={styles.th}>행동</th>
                <th style={styles.th}>항목</th>
                <th style={styles.th}>세부</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((row, index) => {
                const highlight = row.kind === 'pause' || (row.gapSeconds ?? 0) >= LONG_GAP_SECONDS;
                return (
                  <tr key={`${row.sequenceIndex ?? index}-${index}`} style={highlight ? styles.rowHighlight : undefined}>
                    <td style={styles.tdMono}>{formatClock(row.elapsedSeconds)}</td>
                    <td style={styles.tdMono}>{row.gapSeconds === null ? '-' : `${Math.round(row.gapSeconds)}초`}</td>
                    <td style={styles.td}>{eventLabel(row)}</td>
                    <td style={styles.td}>{sectionName(row.sectionId)}</td>
                    <td style={styles.td}>{eventDetail(row)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 16 },
  card: { background: '#fff', border: '1px solid #d9e0e8', borderRadius: 10, padding: 18 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { margin: '0 0 8px 0', fontSize: 18, color: '#17324d' },
  h4: { margin: '16px 0 6px 0', fontSize: 15, color: '#17324d' },
  hint: { margin: '0 0 10px 0', fontSize: 13, color: '#5a6c81' },
  label: { margin: '12px 0 4px 0', fontSize: 13, fontWeight: 700, color: '#42566b' },
  sub: { fontSize: 13, color: '#5a6c81' },
  empty: { margin: '4px 0', fontSize: 14, color: '#8492a3' },
  own: {
    margin: 0,
    padding: '10px 12px',
    background: '#eef7ee',
    border: '1px solid #cfe5cf',
    borderRadius: 8,
    fontSize: 15,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap'
  },
  ai: {
    margin: '8px 0 0 0',
    padding: '10px 12px',
    background: '#eef4fb',
    border: '1px solid #cfdcee',
    borderRadius: 8,
    fontSize: 15,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap'
  },
  summary: { cursor: 'pointer', fontSize: 14, color: '#2f5d8a' },
  list: { margin: '4px 0', paddingLeft: 20, fontSize: 15, lineHeight: 1.7 },
  tag: {
    display: 'inline-block',
    marginRight: 6,
    padding: '1px 8px',
    borderRadius: 999,
    background: '#eef2f6',
    fontSize: 12,
    fontWeight: 700,
    color: '#42566b'
  },
  tagAi: {
    display: 'inline-block',
    marginRight: 6,
    padding: '1px 8px',
    borderRadius: 999,
    background: '#eef4fb',
    fontSize: 12,
    fontWeight: 700,
    color: '#2f5d8a'
  },
  badge: { padding: '3px 10px', borderRadius: 999, background: '#eef2f6', fontSize: 13, fontWeight: 700, color: '#42566b' },
  button: {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid #b8c4d2',
    background: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  scroll: { maxHeight: 520, overflow: 'auto', border: '1px solid #e3e8ee', borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    position: 'sticky',
    top: 0,
    textAlign: 'left',
    padding: '8px 10px',
    background: '#eef2f6',
    borderBottom: '1px solid #d9e0e8',
    fontSize: 13
  },
  td: { padding: '7px 10px', borderBottom: '1px solid #eef1f4', verticalAlign: 'top' },
  tdMono: {
    padding: '7px 10px',
    borderBottom: '1px solid #eef1f4',
    verticalAlign: 'top',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap'
  },
  rowHighlight: { background: '#fff8dc' }
};
