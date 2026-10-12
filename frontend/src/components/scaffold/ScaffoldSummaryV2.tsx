import type { ReactNode } from 'react';
import type { ScaffoldStateResponse } from '../../services/api';
import { renderClinicalAnonymizedText } from '../../utils/publicationRenderer';
import { getSectionsByGroup, sortBySufficiencyQuestionOrder, splitScaffoldDraftSentences } from '../../utils/scaffoldUi';
import { getCaseNoteTypeLabel } from './CaseNotesV2';
import './ScaffoldSummaryV2.css';

/**
 * Scaffold V2 "내 학습 기록" 화면 본문 (2026-10-12).
 *
 * 교수자가 이 화면만 보고 학생이 증례보고를 어떻게 쓰려 했는지와 무엇이 부족한지 판단할 수 있게 정리한다.
 *  1. 한눈에 보기: 메모·초안·판단·표시한 문장의 개수와 분포 (사실만 센다. 점수를 매기지 않는다)
 *  2. 주요 특징: 스스로 돌아본 내 초안, AI 초안에서 짚은 점, 궁금한 점, 더 확인하려는 정보 (2026-10-12 이름을 순화)
 *  3. 단계별 기록: 메모 표 → AI 보기 전 판단 표 → 내 초안과 AI 초안 나란히 → 표시한 문장 → 돌아보기
 *  4. 참고: 이 사례의 기록에 있는 정보 (연구자가 정리한 CARE 세부 항목표)
 * 저장된 값만 보여 주고 새로 추정하지 않는다. V1 화면은 ScaffoldSummaryPage 의 기존 본문을 그대로 쓴다.
 */

type Props = {
  data: ScaffoldStateResponse;
  sectionIds: string[];
  sectionName: (sectionId: string) => string;
  judgmentName: (judgment: string) => string;
  sufficiencyName: (judgment: string) => string;
};

const CARE_ITEM_LABELS: Record<string, string> = {
  '9a': '9a 치료 종류',
  '9b': '9b 용량·기간·빈도',
  '9c': '9c 치료 변경·이유'
};

const FLAG_ORDER = ['differs_from_record', 'needs_additional_confirmation', 'needs_instructor_review', 'want_to_add'];
const SUFFICIENCY_ORDER = ['available_in_record', 'needs_additional_confirmation', 'needs_instructor_review', 'unavailable'];

const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.다])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

function countParts(entries: Array<[string, number]>, render: (key: string) => string) {
  const parts = entries.filter(([, count]) => count > 0).map(([key, count]) => `${render(key)} ${count}`);
  return parts.length > 0 ? parts.join(' · ') : '없음';
}

function tally(keys: string[]) {
  const map = new Map<string, number>();
  keys.forEach((key) => map.set(key, (map.get(key) || 0) + 1));
  return map;
}

/** AI 초안 본문에서 학생이 표시한 문장을 찾아 강조한다. 못 찾은 문장은 그대로 둔다. */
function highlightFlagged(text: string, flagged: Array<{ sentence: string; kind: string; label: string; number: number }>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let best: { index: number; item: (typeof flagged)[number] } | null = null;
    for (const item of flagged) {
      if (!item.sentence) continue;
      const index = rest.indexOf(item.sentence);
      if (index >= 0 && (!best || index < best.index)) best = { index, item };
    }
    if (!best) {
      nodes.push(renderClinicalAnonymizedText(rest));
      break;
    }
    if (best.index > 0) nodes.push(renderClinicalAnonymizedText(rest.slice(0, best.index)));
    nodes.push(
      <mark key={`flag-${key++}`} className={`scaffold-summary-v2__flag is-${best.item.kind}`}>
        {renderClinicalAnonymizedText(best.item.sentence)}
        <sup>
          {best.item.number} {best.item.label}
        </sup>
      </mark>
    );
    rest = rest.slice(best.index + best.item.sentence.length);
  }
  return nodes;
}

export default function ScaffoldSummaryV2({ data, sectionIds, sectionName, judgmentName, sufficiencyName }: Props) {
  const state = data.scaffoldState;
  const notes = state.caseMap?.caseNotes || [];
  const reviewItems = state.reviewItems || [];
  const evidenceTextById = new Map<string, string>(
    (data.evidenceCards || []).map((card: any) => [String(card.id), String(card.sourceText || card.normalizedText || '')])
  );
  const multiSection = sectionIds.length > 1;
  const tag = (sectionId: string) => (multiSection ? `[${sectionName(sectionId)}] ` : '');

  const sections = sectionIds.map((sectionId) => {
    const snapshot: any = (state.preRevealSnapshots || []).find((item) => item.sectionId === sectionId);
    const reflection: any = (state.sectionReflections || []).find((item) => item.sectionId === sectionId);
    const progress: any = (state.sectionProgress || []).find((item) => item.sectionId === sectionId);
    const preAi: any = snapshot || reflection || {};
    const ownDraft = String(preAi.learnerNotes || '').trim();
    const missingItems: string[] = Array.from(
      new Set(((preAi.learnerIdentifiedMissingItems || []) as string[]).map((item) => String(item).trim()).filter(Boolean))
    );
    const keyItems: string[] = Array.from(
      new Set(
        ((preAi.learnerKeyInformationItems || preAi.learnerIdentifiedKeyInfo || []) as string[])
          .map((item) => String(item).trim())
          .filter(Boolean)
      )
    );
    const selectedEvidence: any[] = preAi.selectedEvidence || [];
    const sufficiency = sortBySufficiencyQuestionOrder(
      reviewItems.filter((item) => item.sectionId === sectionId && item.sourceType !== 'draft_sentence'),
      (item) => item.id
    );
    const aiDraft = String((data.sectionDrafts || []).find((draft) => draft.sectionId === sectionId)?.draftText || '');
    // 표시한 문장 번호는 작성 화면에서 학생이 본 AI 문장 번호(splitScaffoldDraftSentences 순서)와 같게 하고, 그 순서로 정렬한다.
    const aiSentenceList = splitScaffoldDraftSentences(aiDraft);
    const flagged = reviewItems
      .filter(
        (item) =>
          item.sectionId === sectionId &&
          item.sourceType === 'draft_sentence' &&
          item.judgment !== 'supported_by_record' &&
          item.judgment !== 'pending'
      )
      .map((item, index) => {
        const position = aiSentenceList.findIndex((sentence) => sentence.trim() === String(item.sourceText || '').trim());
        return { item, number: position >= 0 ? position + 1 : aiSentenceList.length + index + 1 };
      })
      .sort((a, b) => a.number - b.number);
    const post = reflection?.postAiReflection || {};
    // AI 비교 단계 없이 글만 쓰는 "추가 작성" 항목(제목·초록·서론·고찰·환자 관점·환자 동의 등)
    const writeOnly =
      getSectionsByGroup('additional_authoring').some((item) => item.sectionId === sectionId) &&
      !progress?.recordReviewCompleted &&
      !progress?.draftRevealed &&
      sufficiency.length === 0 &&
      flagged.length === 0;
    return { sectionId, progress, ownDraft, missingItems, keyItems, selectedEvidence, sufficiency, flagged, aiDraft, post, writeOnly };
  });

  // ---------------------------------------------------------------- 1. 한눈에 보기
  const noteTypeCounts = tally(notes.map((note) => note.type || 'observation'));
  const aiNoteCount = notes.filter((note) => note.origin === 'ai_suggestion' || note.id.startsWith('case-note-ai-')).length;
  const careCounts = tally(notes.flatMap((note) => (note.careItems && note.careItems.length > 0 ? note.careItems : ['none'])));
  const visitCounts = tally(notes.map((note) => (note.visitIndex ? String(note.visitIndex) : 'none')));
  const visitKeys = Array.from(visitCounts.keys()).sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : Number(a) - Number(b)));
  const allSufficiency = sections.flatMap((section) => section.sufficiency);
  const sufficiencyCounts = tally(allSufficiency.map((item) => item.judgment));
  const allFlagged = sections.flatMap((section) => section.flagged.map(({ item }) => item));
  const flagCounts = tally(allFlagged.map((item) => item.judgment));
  const draftChars = sections.reduce((sum, section) => sum + section.ownDraft.length, 0);
  const draftSentences = sections.reduce((sum, section) => sum + sentencesOf(section.ownDraft).length, 0);
  const aiSentences = sections.reduce((sum, section) => sum + splitScaffoldDraftSentences(section.aiDraft).length, 0);

  const overview: Array<{ label: string; value: string; detail?: string }> = [
    {
      label: '기록 읽기 메모',
      value: `${notes.length}개`,
      detail: `${countParts(
        ['observation', 'question', 'literature'].map((type) => [type, noteTypeCounts.get(type) || 0] as [string, number]),
        (type) => getCaseNoteTypeLabel(type)
      )}${aiNoteCount > 0 ? ` · 그중 AI 추천에서 가져옴 ${aiNoteCount}` : ''}`
    },
    {
      label: '메모가 다룬 세부 항목',
      value: countParts(['9a', '9b', '9c'].map((code) => [code, careCounts.get(code) || 0] as [string, number]), (code) => code),
      detail: (careCounts.get('none') || 0) > 0 ? `항목을 붙이지 않은 메모 ${careCounts.get('none')}` : undefined
    },
    {
      label: '메모를 남긴 회차',
      value: countParts(
        visitKeys.map((key) => [key, visitCounts.get(key) || 0] as [string, number]),
        (key) => (key === 'none' ? '미지정' : `${key}회차`)
      )
    },
    {
      label: '내 초안',
      value: draftChars > 0 ? `${draftChars}자 · ${draftSentences}문장` : '쓰지 않음'
    },
    {
      label: 'AI 보기 전 정보 충분성 판단',
      value: `${allSufficiency.length}개 질문`,
      detail: countParts(
        SUFFICIENCY_ORDER.map((key) => [key, sufficiencyCounts.get(key) || 0] as [string, number]),
        (key) => sufficiencyName(key)
      )
    },
    {
      label: 'AI 초안에서 표시한 문장',
      value: `${allFlagged.length}개${aiSentences > 0 ? ` / 전체 ${aiSentences}문장` : ''}`,
      detail: countParts(FLAG_ORDER.map((key) => [key, flagCounts.get(key) || 0] as [string, number]), (key) => judgmentName(key))
    }
  ];

  // ---------------------------------------------------------------- 2. 주요 특징
  const selfGaps = sections.filter((section) => String(section.post.changedJudgment || '').trim());
  const aiProblems: string[] = [
    ...sections
      .filter((section) => String(section.post.missingInDraft || '').trim())
      .map((section) => `${tag(section.sectionId)}${section.post.missingInDraft}`),
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }) => item.judgment === 'differs_from_record')
        .map(({ item, number }) => `${tag(section.sectionId)}AI 문장 ${number} (기록과 다름): ${item.note || item.sourceText}`)
    )
  ];
  const questions: string[] = [
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }) => item.judgment === 'needs_instructor_review')
        .map(({ item, number }) => `${tag(section.sectionId)}AI 문장 ${number}: ${item.note || item.sourceText}`)
    ),
    ...sections.flatMap((section) =>
      section.sufficiency
        .filter((item) => item.judgment === 'needs_instructor_review')
        .map((item) => `${tag(section.sectionId)}${item.sourceText}${item.note ? ` — ${item.note}` : ''}`)
    ),
    ...sections
      .filter((section) => String(section.post.unresolvedQuestion || '').trim())
      .map((section) => `${tag(section.sectionId)}${section.post.unresolvedQuestion}`)
  ];
  const toCheck: string[] = [
    ...sections.flatMap((section) => section.missingItems.map((item) => `${tag(section.sectionId)}부족하다고 본 정보: ${item}`)),
    ...sections.flatMap((section) =>
      section.sufficiency
        .filter((item) => item.judgment === 'needs_additional_confirmation' || item.judgment === 'unavailable')
        .map(
          (item) =>
            `${tag(section.sectionId)}${item.sourceText} → ${sufficiencyName(item.judgment)}${item.note ? ` — ${item.note}` : ''}`
        )
    ),
    ...sections.flatMap((section) =>
      section.flagged
        .filter(({ item }) => item.judgment === 'needs_additional_confirmation')
        .map(({ item, number }) => `${tag(section.sectionId)}AI 문장 ${number} (기록만으로 확인하기 어려움): ${item.note || item.sourceText}`)
    ),
    ...notes
      .filter((note) => note.type === 'question' || note.type === 'literature')
      .map((note) => `${getCaseNoteTypeLabel(note.type)} 메모${note.visitIndex ? ` (${note.visitIndex}회차)` : ''}: ${note.text}`)
  ];

  const renderBullets = (items: string[], empty: string) =>
    items.length > 0 ? (
      <ul className="scaffold-summary-v2__bullets">
        {items.map((item, index) => (
          <li key={`${index}-${item.slice(0, 20)}`}>{item}</li>
        ))}
      </ul>
    ) : (
      <p className="scaffold-summary-v2__empty">{empty}</p>
    );

  const sortedNotes = [...notes].sort(
    (a, b) => (a.visitIndex ?? 99) - (b.visitIndex ?? 99) || String(a.createdAt).localeCompare(String(b.createdAt))
  );

  return (
    <div className="scaffold-summary-v2">
      <section className="scaffold-summary-v2__panel" aria-labelledby="summary-v2-overview">
        <h2 id="summary-v2-overview">한눈에 보기</h2>
        <p className="scaffold-summary-v2__lead">
          실험번호 {data.experiment_code || data.experimentCode || '-'} · 방문 기록 {data.visits?.length ?? 0}회 · 실습 항목{' '}
          {sectionIds.map(sectionName).join(', ')}. 개수와 분포만 셉니다. 맞고 틀림은 아래 기록을 보고 판단합니다.
        </p>
        <dl className="scaffold-summary-v2__stats">
          {overview.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                <strong>{item.value}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="scaffold-summary-v2__panel is-attention" aria-labelledby="summary-v2-attention">
        <h2 id="summary-v2-attention">주요 특징</h2>
        <div className="scaffold-summary-v2__attention-grid">
          <div>
            <h3>스스로 돌아본 내 초안</h3>
            {selfGaps.length > 0 ? (
              selfGaps.map((section) => (
                <p key={section.sectionId}>
                  {tag(section.sectionId)}
                  {section.post.changedJudgment}
                </p>
              ))
            ) : (
              <p className="scaffold-summary-v2__empty">적은 내용이 없습니다.</p>
            )}
          </div>
          <div>
            <h3>AI 초안에서 짚은 점</h3>
            {renderBullets(aiProblems, '적은 내용이 없습니다.')}
          </div>
          <div>
            <h3>궁금한 점</h3>
            {renderBullets(questions, '적은 내용이 없습니다.')}
          </div>
          <div>
            <h3>더 확인하려는 정보</h3>
            {renderBullets(toCheck, '적은 내용이 없습니다.')}
          </div>
        </div>
      </section>

      <section className="scaffold-summary-v2__panel" aria-labelledby="summary-v2-notes">
        <h2 id="summary-v2-notes">1. 기록 읽기: 남긴 메모 {notes.length}개</h2>
        {sortedNotes.length > 0 ? (
          <div className="scaffold-summary-v2__table-wrap">
            <table className="scaffold-summary-v2__table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>회차</th>
                  <th style={{ width: 110 }}>종류</th>
                  <th style={{ width: 150 }}>세부 항목</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {sortedNotes.map((note) => (
                  <tr key={note.id}>
                    <td>{note.visitIndex ? `${note.visitIndex}회차` : '미지정'}</td>
                    <td>{getCaseNoteTypeLabel(note.type)}</td>
                    <td>{(note.careItems || []).map((code) => CARE_ITEM_LABELS[code] || code).join(', ') || '-'}</td>
                    <td>
                      {note.text}
                      {note.origin === 'ai_suggestion' || note.id.startsWith('case-note-ai-') ? (
                        <span className="scaffold-summary-v2__badge">AI 추천에서 가져옴</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="scaffold-summary-v2__empty">메모가 없습니다.</p>
        )}
      </section>

      {sections.some((section) => section.writeOnly) ? (
        <section className="scaffold-summary-v2__panel" aria-labelledby="summary-v2-write-only">
          <h2 id="summary-v2-write-only">추가 작성한 항목</h2>
          <p className="scaffold-summary-v2__lead">AI 초안과 비교하는 단계 없이 학생이 직접 쓴 항목입니다.</p>
          <dl className="scaffold-summary-v2__reflection">
            {sections
              .filter((section) => section.writeOnly)
              .map((section) => (
                <div key={section.sectionId}>
                  <dt>
                    {sectionName(section.sectionId)} · {section.ownDraft.length}자
                  </dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{section.ownDraft || '쓰지 않았습니다.'}</dd>
                </div>
              ))}
          </dl>
        </section>
      ) : null}

      {sections.filter((section) => !section.writeOnly).map((section) => {
        const careMap = data.careElementMap?.[section.sectionId] || [];
        return (
          <section key={section.sectionId} className="scaffold-summary-v2__panel" aria-label={sectionName(section.sectionId)}>
            {multiSection ? <h2>{sectionName(section.sectionId)}</h2> : null}

            <h2>2. AI 초안을 보기 전 판단</h2>
            {section.sufficiency.length > 0 ? (
              <div className="scaffold-summary-v2__table-wrap">
                <table className="scaffold-summary-v2__table">
                  <thead>
                    <tr>
                      <th>질문</th>
                      <th style={{ width: 170 }}>학생의 판단</th>
                      <th style={{ width: '40%' }}>이유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.sufficiency.map((item) => (
                      <tr key={item.id}>
                        <td>{item.sourceText}</td>
                        <td className={`scaffold-summary-v2__judgment is-${item.judgment}`}>{sufficiencyName(item.judgment)}</td>
                        <td>{item.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="scaffold-summary-v2__empty">판단한 질문이 없습니다.</p>
            )}
            {section.missingItems.length > 0 ? (
              <div className="scaffold-summary-v2__sub">
                <h3>초안을 쓰며 부족하다고 본 정보</h3>
                {renderBullets(section.missingItems, '')}
              </div>
            ) : null}
            {section.selectedEvidence.length > 0 || section.keyItems.length > 0 ? (
              <div className="scaffold-summary-v2__sub">
                <h3>기록에서 고른 근거와 핵심 정보</h3>
                {renderBullets(
                  [
                    ...section.selectedEvidence.map((item) =>
                      renderClinicalAnonymizedText(item.label || evidenceTextById.get(String(item.id)) || item.id)
                    ),
                    ...section.keyItems
                  ],
                  ''
                )}
              </div>
            ) : null}

            <h2>3. 내 초안과 AI 초안</h2>
            <div className="scaffold-summary-v2__compare">
              <div className="scaffold-summary-v2__draft is-own">
                <h3>학생이 쓴 초안 (AI 보기 전)</h3>
                <p>{section.ownDraft || '쓰지 않았습니다.'}</p>
              </div>
              <div className="scaffold-summary-v2__draft is-ai">
                <h3>AI 초안 {section.flagged.length > 0 ? `(학생이 표시한 문장 ${section.flagged.length}개 강조)` : ''}</h3>
                {section.progress?.draftRevealed ? (
                  <p>
                    {highlightFlagged(
                      section.aiDraft,
                      section.flagged.map(({ item, number }) => ({
                        sentence: item.sourceText,
                        kind: item.judgment,
                        label: judgmentName(item.judgment),
                        number
                      }))
                    )}
                  </p>
                ) : (
                  <p className="scaffold-summary-v2__empty">아직 AI 초안을 열지 않았습니다.</p>
                )}
              </div>
            </div>
            {section.flagged.length > 0 ? (
              <div className="scaffold-summary-v2__table-wrap">
                <table className="scaffold-summary-v2__table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>표시한 AI 문장</th>
                      <th style={{ width: 150 }}>종류</th>
                      <th style={{ width: '38%' }}>이유와 연결한 기록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.flagged.map(({ item, number }) => (
                      <tr key={item.id}>
                        <td>{number}</td>
                        <td>{renderClinicalAnonymizedText(item.sourceText)}</td>
                        <td className={`scaffold-summary-v2__judgment is-${item.judgment}`}>{judgmentName(item.judgment)}</td>
                        <td>
                          {item.note ? <div>{item.note}</div> : null}
                          {(item.evidenceIds || []).map((id) =>
                            evidenceTextById.get(String(id)) ? (
                              <div key={id} className="scaffold-summary-v2__evidence">
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
            ) : section.progress?.draftRevealed ? (
              <p className="scaffold-summary-v2__empty">다시 볼 문장으로 표시한 것이 없습니다.</p>
            ) : null}

            <h2>4. 돌아보기 (AI 초안을 읽은 뒤)</h2>
            <dl className="scaffold-summary-v2__reflection">
              <div>
                <dt>내 초안에서 빠졌거나 부족했던 내용</dt>
                <dd>{section.post.changedJudgment || '적은 내용이 없습니다.'}</dd>
              </div>
              <div>
                <dt>AI 초안에서 부족하거나 의심스러운 내용</dt>
                <dd>{section.post.missingInDraft || '적은 내용이 없습니다.'}</dd>
              </div>
              <div>
                <dt>교수님이나 전문가에게 묻고 싶은 것</dt>
                <dd>{section.post.unresolvedQuestion || '적은 내용이 없습니다.'}</dd>
              </div>
            </dl>

            {careMap.length > 0 ? (
              <details className="scaffold-summary-v2__reference">
                <summary>참고: 이 사례 기록에 있는 정보 (연구자 정리, 학생 초안과 견주어 보기)</summary>
                <div className="scaffold-summary-v2__table-wrap">
                  <table className="scaffold-summary-v2__table">
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>CARE 세부 항목</th>
                        <th>기록에 있는 정보</th>
                        <th style={{ width: '34%' }}>기록에서 찾기 어려운 정보</th>
                      </tr>
                    </thead>
                    <tbody>
                      {careMap.map((element) => (
                        <tr key={element.code}>
                          <td>
                            {element.code} {element.label}
                            <div className="scaffold-summary-v2__muted">{element.required ? '필수' : '선택'}</div>
                          </td>
                          <td>
                            <ul>
                              {element.inRecord.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <ul>
                              {element.notInRecord.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
