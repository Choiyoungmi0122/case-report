import type { CSSProperties } from 'react';
import { renderClinicalAnonymizedText } from '../../utils/publicationRenderer';

/**
 * 연구자용 조회 화면에서 실험용 Write 세션 한 건을 보여준다:
 * 소요 시간 → 질의응답(질문·답·수정) → 섹션별 수정·첨부·CARE → 제출.
 * 자료는 연구용 내보내기의 studyWriteData (summary + state).
 */

const SECTION_NAMES: Record<string, string> = {
  TITLE: '제목',
  ABSTRACT: '초록',
  INTRODUCTION: '서론',
  PATIENT_INFORMATION: '환자 정보',
  CLINICAL_FINDINGS: '임상 소견',
  TIMELINE: '타임라인',
  DIAGNOSTIC_ASSESSMENT: '진단 평가',
  THERAPEUTIC_INTERVENTIONS: '치료 개입',
  FOLLOW_UP_OUTCOMES: '추적 관찰 및 결과',
  DISCUSSION_CONCLUSION: '고찰',
  PATIENT_PERSPECTIVE: '환자 관점',
  INFORMED_CONSENT: '동의'
};

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '-';
  const total = Math.max(0, Math.round(seconds));
  return total < 60 ? `${total}초` : `${Math.floor(total / 60)}분 ${total % 60}초`;
}

export default function StudyWriteSessionRecord({ data }: { data: any }) {
  const summary = data?.summary;
  const state = data?.state;
  if (!summary || !state) return null;
  const questions: any[] = (state.rounds || []).flatMap((round: any) => round.questions || []);
  const sections: any[] = summary.sections || [];

  return (
    <div style={styles.wrap}>
      <section style={styles.card}>
        <h3 style={styles.title}>소요 시간</h3>
        <table style={styles.table}>
          <tbody>
            <tr>
              <td style={styles.td}>질의응답</td>
              <td style={styles.td}>{formatDuration(summary.timing.interviewSeconds)}</td>
            </tr>
            <tr>
              <td style={styles.td}>초안 생성(자동)</td>
              <td style={styles.td}>{formatDuration(summary.timing.draftGenerationSeconds)}</td>
            </tr>
            <tr>
              <td style={styles.td}>섹션 수정 (초안 완성 → 최종 수정 진입)</td>
              <td style={styles.td}>{formatDuration(summary.timing.editingSeconds)}</td>
            </tr>
            <tr>
              <td style={styles.td}>최종 수정 (→ 제출)</td>
              <td style={styles.td}>{formatDuration(summary.timing.finalEditSeconds)}</td>
            </tr>
            <tr>
              <td style={styles.td}>
                <strong>전체 (사례 생성 → 제출)</strong>
              </td>
              <td style={styles.td}>
                <strong>{formatDuration(summary.timing.totalSeconds)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
        <p style={styles.sub}>
          입력: {summary.inputSource?.source || '-'}
          {summary.inputSource?.fileName ? ` (${summary.inputSource.fileName})` : ''} · 방문 {summary.inputSource?.visitCount ?? '-'}개 ·{' '}
          {summary.timing.submittedAt ? '제출됨' : '미제출'}
        </p>
      </section>

      <section style={styles.card}>
        <h3 style={styles.title}>
          질의응답 — {summary.interview.rounds}회차, 질문 {summary.interview.questionsAsked}개 (답 {summary.interview.answered}, 건너뜀{' '}
          {summary.interview.skipped}, 답 수정 {summary.interview.answerEdits}회)
        </h3>
        <ol style={styles.list}>
          {questions.map((question) => (
            <li key={question.id}>
              <span style={styles.tag}>
                {question.roundNo}회차 · {question.careItem || '-'} · {question.priority === 'case' ? '사례 전체' : question.priority === 'required' ? '필수' : '선택'}
              </span>
              <div>{question.text}</div>
              <div style={styles.answer}>
                {question.status === 'skipped' ? <em>모름 / 기록에 없음</em> : question.answer || <em>답하지 않음</em>}
                {question.editHistory?.length ? <span style={styles.sub}> (수정 {question.editHistory.length}회)</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section style={styles.card}>
        <h3 style={styles.title}>
          섹션별 수정 — 채팅 수정 {summary.totals.reviseCount}회, 직접 편집 {summary.totals.manualEditCount}회, 첨부{' '}
          {summary.totals.attachmentCount}개, 기록 외 내용 표시 {summary.totals.outOfRecordClaimCount}건
        </h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>섹션</th>
              <th style={styles.th}>채팅 수정</th>
              <th style={styles.th}>직접 편집</th>
              <th style={styles.th}>재작성</th>
              <th style={styles.th}>첨부</th>
              <th style={styles.th}>글자 수 (처음→최종)</th>
              <th style={styles.th}>CARE 필수 빠짐</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.sectionId}>
                <td style={styles.td}>{SECTION_NAMES[section.sectionId] || section.sectionId}</td>
                <td style={styles.td}>{section.reviseCount ?? '-'}</td>
                <td style={styles.td}>{section.manualEditCount ?? '-'}</td>
                <td style={styles.td}>{section.regenerateCount ?? '-'}</td>
                <td style={styles.td}>{section.attachmentCount ?? '-'}</td>
                <td style={styles.td}>
                  {section.firstDraftChars ?? '-'} → {section.finalDraftChars ?? '-'}
                </td>
                <td style={styles.td}>{section.careRequiredMissing ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={styles.card}>
        <h3 style={styles.title}>채팅 지시와 결과</h3>
        {Object.values(state.sections || {}).every((section: any) => !(section.chat || []).length) ? (
          <p style={styles.sub}>채팅 수정을 쓰지 않았다.</p>
        ) : null}
        {Object.values(state.sections || {})
          .filter((section: any) => (section.chat || []).length)
          .map((section: any) => (
            <div key={section.sectionId} style={{ marginBottom: 10 }}>
              <strong>{SECTION_NAMES[section.sectionId] || section.sectionId}</strong>
              <ul style={styles.list}>
                {(section.chat || []).map((entry: any) => (
                  <li key={entry.id}>
                    <span style={styles.tag}>{entry.role === 'user' ? '지시' : '결과'}</span>
                    {renderClinicalAnonymizedText(entry.text)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>

      <details style={styles.card}>
        <summary style={styles.summary}>최종 본문 (제출 시점)</summary>
        {Object.values(state.sections || {}).map((section: any) => (
          <div key={section.sectionId} style={{ marginTop: 10 }}>
            <strong>{SECTION_NAMES[section.sectionId] || section.sectionId}</strong>
            <p style={styles.body}>{renderClinicalAnonymizedText(section.draftText) || '(없음)'}</p>
          </div>
        ))}
      </details>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 16 },
  card: { background: '#fff', border: '1px solid #d9e0e8', borderRadius: 10, padding: 18 },
  title: { margin: '0 0 8px 0', fontSize: 17, color: '#17324d' },
  summary: { cursor: 'pointer', fontSize: 16, fontWeight: 700 },
  sub: { fontSize: 13, color: '#5a6c81' },
  list: { margin: '4px 0', paddingLeft: 20, fontSize: 14, lineHeight: 1.7 },
  answer: { padding: '6px 10px', marginTop: 4, background: '#eef7ee', borderRadius: 6, whiteSpace: 'pre-wrap' },
  tag: { display: 'inline-block', marginRight: 6, padding: '1px 8px', borderRadius: 999, background: '#eef2f6', fontSize: 12, fontWeight: 700, color: '#42566b' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '6px 10px', background: '#eef2f6', borderBottom: '1px solid #d9e0e8', fontSize: 13 },
  td: { padding: '6px 10px', borderBottom: '1px solid #eef1f4' },
  body: { whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, margin: '4px 0 0' }
};
