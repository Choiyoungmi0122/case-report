import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  caseApi,
  StudyWriteAttachment,
  StudyWriteCareItemStatus,
  StudyWriteCareSubItem,
  StudyWriteDraftsResponse,
  StudyWriteQuestion,
  StudyWriteSection
} from '../services/api';
import { renderClinicalAnonymizedText } from '../utils/publicationRenderer';
import TimelineTable, { parseTimelineRows } from '../components/studyWrite/TimelineTable';
import { ANSWER_CHOICES, answerStatusLabel, choiceToBody, AnswerChoiceValue } from '../utils/studyWriteAnswers';
import {
  careCompliance,
  complianceLevel,
  effectiveCareStatus,
  isCareSatisfied,
  isPartialItem,
  overallCareCompliance,
  sectionSubCompliance,
  subCompliance,
  uncheckedSuffix
} from '../utils/studyWriteCare';
import { convertRelativeDates, toRawOffset } from '../utils/relativeDates';
import DateAnchorBar from '../components/studyWrite/DateAnchorBar';
import TitleKeywordsEditor from '../components/studyWrite/TitleKeywordsEditor';
import RecordViewer from '../components/studyWrite/RecordViewer';
import { parseTitleDraft } from '../utils/titleKeywords';
import './StudyWriteDraftPage.css';

/**
 * 실험용 Write ⑤ 전체 초안 생성 → ⑥ 섹션별 화면.
 * 왼쪽: 섹션 목록(빠진 필수 요소 수). 가운데: 초안과 표·그림. 오른쪽: 이 섹션의 채팅 수정,
 * CARE 점검, 내 답변(수정 가능).
 */

const POLL_MS = 3000;

const STATUS_LABEL: Record<StudyWriteCareItemStatus, string> = {
  present: '있음',
  in_record_not_in_draft: '초안에 빠짐',
  not_in_record: '없음',
  not_applicable: '해당 없음',
  unchecked: '판정 없음'
};

/** 상태 배지에 쓰는 기호와 한 줄 설명 */
const STATUS_META: Record<StudyWriteCareItemStatus, { mark: string; note: string }> = {
  present: { mark: '✓', note: '초안에 들어 있음' },
  in_record_not_in_draft: { mark: '!', note: '기록에는 있는데 초안에 없음. 수정 요청으로 넣을 수 있음' },
  not_in_record: { mark: '✕', note: '기록에도 답변에도 없음. 알고 있으면 내 답변에 보충' },
  not_applicable: { mark: '–', note: '이 증례에는 해당 없음' },
  unchecked: { mark: '?', note: '점검 결과를 받지 못함(없다는 뜻이 아님). 위의 "전체 점검하기"로 다시 점검' }
};

/** 9b 개입 묶음 이름 (backend/src/studyWrite/careSubElements.ts 의 MODALITY_LABELS 와 같다) */
const MODALITY_LABEL: Record<string, string> = {
  herbal: '한약',
  acupuncture: '침·전침',
  pharmacopuncture: '약침',
  moxibustion: '뜸',
  cupping: '부항',
  western: '양약',
  lifestyle: '생활 지도·상담',
  other: '그 밖의 치료'
};

function missingRequiredCount(section: StudyWriteSection) {
  // 판정 없음은 누락으로 세지 않는다
  return (
    section.careCheck?.items.filter((item) => {
      const status = effectiveCareStatus(item);
      return item.required && status !== 'unchecked' && !isCareSatisfied(status);
    }).length || 0
  );
}

export default function StudyWriteDraftPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudyWriteDraftsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>('TITLE');
  const [tab, setTab] = useState<'chat' | 'care' | 'answers'>('chat');
  // 원문 EMR 보기 (왼쪽 목록 맨 아래)
  const [recordOpen, setRecordOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [instruction, setInstruction] = useState('');
  // 보낸 뒤 입력 칸 높이를 원래대로
  useEffect(() => {
    if (!instruction && composerRef.current) composerRef.current.style.height = 'auto';
  }, [instruction]);
  // CARE 점검의 "수정 요청으로 넣기": 채팅 탭으로 넘어간 뒤 입력창으로 스크롤하고 커서를 끝에 둔다
  const [focusComposerAt, setFocusComposerAt] = useState(0);
  useEffect(() => {
    if (!focusComposerAt) return;
    const timer = window.setTimeout(() => {
      const box = composerRef.current;
      if (!box) return;
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box.focus({ preventScroll: true });
      box.setSelectionRange(box.value.length, box.value.length);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusComposerAt]);
  const [revising, setRevising] = useState(false);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  // 내 답변 탭: 기본은 이 섹션에 쓰인 답만, 원하면 전체
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  // CARE 점검의 "기록에 없음" 항목에 정보를 직접 넣는 입력칸 (열린 항목 코드와 내용)
  const [careInfoCode, setCareInfoCode] = useState<string | null>(null);
  const [careInfoText, setCareInfoText] = useState('');
  const [careInfoSaving, setCareInfoSaving] = useState(false);
  // 그 항목을 쓰기 위해 AI 가 만든 질문 (버튼을 누르면 먼저 묻는다)
  const [careQuestion, setCareQuestion] = useState<{ code: string; question: string; hint: string } | null>(null);
  const [careQuestionLoading, setCareQuestionLoading] = useState(false);

  // CARE 점검만 다시 (초안은 그대로)
  const [careRechecking, setCareRechecking] = useState(false);
  const recheckCare = async (sectionId: string) => {
    if (!caseId) return;
    setCareRechecking(true);
    setError(null);
    try {
      setData(await caseApi.recheckStudyWriteCare(caseId, sectionId));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '점검하지 못했습니다.');
    } finally {
      setCareRechecking(false);
    }
  };

  /** "이 정보 입력하기": 빈 칸 대신 그 항목을 쓰기 위한 질문을 먼저 받아 보여 준다 */
  const openCareQuestion = async (sectionId: string, code: string) => {
    if (!caseId) return;
    setCareInfoCode(code);
    setCareInfoText('');
    setCareQuestion(null);
    setCareQuestionLoading(true);
    try {
      const result = await caseApi.askStudyWriteCareQuestion(caseId, sectionId, code);
      setCareQuestion({ code, question: result.question, hint: result.hint });
    } catch (nextError: any) {
      setCareQuestion({ code, question: '이 항목에 쓸 수 있는 내용을 적어 주세요.', hint: '' });
      setError(nextError?.response?.data?.error || null);
    } finally {
      setCareQuestionLoading(false);
    }
  };

  /** 답을 질문과 함께 저장하고 이 섹션만 다시 쓴다 */
  const submitCareInfo = async (sectionId: string, code: string) => {
    if (!caseId || !careInfoText.trim()) return;
    setCareInfoSaving(true);
    setError(null);
    try {
      await caseApi.addStudyWriteCareInfo(caseId, sectionId, {
        code,
        answer: careInfoText.trim(),
        question: careQuestion?.code === code ? careQuestion.question : undefined
      });
      setData(await caseApi.generateStudyWriteDrafts(caseId, [sectionId]));
      setCareInfoCode(null);
      setCareInfoText('');
      setCareQuestion(null);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setCareInfoSaving(false);
    }
  };
  const [dirtySectionIds, setDirtySectionIds] = useState<string[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const kicked = useRef(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const generation = data?.generation;
  const running = generation?.status === 'running';
  const hasAnyDraft = Boolean(data?.sections.some((section) => section.draftText));
  const section = data?.sections.find((item) => item.sectionId === selectedId) || data?.sections[0];
  const questions = useMemo(() => data?.interview.rounds.flatMap((round) => round.questions) || [], [data]);

  const refresh = useCallback(async () => {
    if (!caseId) return null;
    const next = await caseApi.getStudyWriteDrafts(caseId);
    setData(next);
    return next;
  }, [caseId]);

  // 처음: 초안이 없으면 생성 시작
  useEffect(() => {
    if (!caseId) return;
    (async () => {
      try {
        const next = await caseApi.getStudyWriteDrafts(caseId);
        setData(next);
        const none = !next.sections.some((item) => item.draftText);
        if (none && next.generation.status !== 'running' && !kicked.current) {
          kicked.current = true;
          setData(await caseApi.generateStudyWriteDrafts(caseId));
        }
      } catch (nextError: any) {
        setError(nextError?.response?.data?.error || nextError?.message || '불러오지 못했습니다.');
      }
    })();
  }, [caseId]);

  // 생성 중이면 폴링
  useEffect(() => {
    if (!caseId || !running) return;
    const timer = window.setInterval(() => refresh().catch(() => undefined), POLL_MS);
    return () => window.clearInterval(timer);
  }, [caseId, running, refresh]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [section?.chat.length, revising]);

  // ── 수정 요청 채팅의 "질문 받기" ──
  const [askingQuestion, setAskingQuestion] = useState(false);
  // 답을 기다리는 AI 질문: 마지막 AI 질문이 아직 답이 없고 건너뛰지 않았으면 (건너뛰기는 서버에 저장)
  const pendingQuestion = (() => {
    const last = [...(section?.chat || [])].reverse().find((entry) => entry.kind === 'question');
    return last && !last.answeredAt && !last.skippedAt ? last : null;
  })();
  const [skipping, setSkipping] = useState(false);
  const skipQuestion = async () => {
    if (!caseId || !section || !pendingQuestion || skipping) return;
    setSkipping(true);
    setError(null);
    try {
      setData(await caseApi.skipStudyWriteChatQuestion(caseId, section.sectionId, pendingQuestion.id));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '건너뛰지 못했습니다.');
    } finally {
      setSkipping(false);
    }
  };
  const askQuestion = async () => {
    if (!caseId || !section || askingQuestion) return;
    setAskingQuestion(true);
    setError(null);
    try {
      setData(await caseApi.askStudyWriteChatQuestion(caseId, section.sectionId));
      setFocusComposerAt(Date.now());
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '질문을 받지 못했습니다.');
    } finally {
      setAskingQuestion(false);
    }
  };

  const sendInstruction = async () => {
    if (!caseId || !section || revising) return;
    const text = instruction.trim();
    if (!text) return;
    setRevising(true);
    setError(null);
    try {
      setData(
        pendingQuestion
          ? await caseApi.answerStudyWriteChatQuestion(caseId, section.sectionId, pendingQuestion.id, text)
          : await caseApi.reviseStudyWriteSection(caseId, section.sectionId, text)
      );
      setInstruction('');
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '고치지 못했습니다.');
    } finally {
      setRevising(false);
    }
  };

  // ── 초안에서 드래그해 고치기 ──
  // 선택한 글과 떠 있는 작은 창의 위치(화면 좌표), 모드(메뉴 / AI 지시 / 직접 고치기)
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [selMode, setSelMode] = useState<'menu' | 'ai' | 'edit'>('menu');
  const [selInstruction, setSelInstruction] = useState('');
  const [selEditText, setSelEditText] = useState('');
  const [selBusy, setSelBusy] = useState(false);
  // 섹션 전체 직접 편집
  const [fullEditOpen, setFullEditOpen] = useState(false);
  const [fullEditText, setFullEditText] = useState('');
  // 직접 고친 뒤 "전체가 괜찮은지" 점검을 권하는 섹션들
  const [needsReview, setNeedsReview] = useState<Record<string, boolean>>({});
  const [reviewing, setReviewing] = useState(false);

  const reviewAfterEdit = async () => {
    if (!caseId || !section || reviewing) return;
    setReviewing(true);
    setError(null);
    try {
      setData(await caseApi.reviewStudyWriteSectionAfterEdit(caseId, section.sectionId));
      setNeedsReview((prev) => ({ ...prev, [section.sectionId]: false }));
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '점검하지 못했습니다.');
    } finally {
      setReviewing(false);
    }
  };
  const mainTextRef = useRef<HTMLDivElement | null>(null);
  // 초안을 고치는 동안 가운데 초안 위에 띄울 문구 (없으면 null)
  const draftBusy: string | null = revising
    ? pendingQuestion
      ? '답을 반영해 초안을 고쳐 쓰는 중…'
      : '수정 요청대로 초안을 고쳐 쓰는 중…'
    : reviewing
      ? '직접 고친 내용과 나머지를 점검하는 중…'
      : careInfoSaving
        ? '입력한 정보로 이 섹션을 다시 쓰는 중…'
        : selBusy
          ? '고친 내용을 반영하는 중…'
          : null;

  // 첫 기록일을 넣었으면 "첫 기록일 +N일"을 실제 날짜로 보여 준다 (저장된 초안은 그대로)
  const anchor = data?.dateAnchor || null;
  const dated = (text: string) => (anchor ? convertRelativeDates(text, anchor).text : text);

  /** 화면에서 드래그한 글이 원문(상대 날짜)의 어디인지. 날짜로 바꿔 보여 준 경우도 되돌려 찾는다 */
  const rawRangeOfSelection = (raw: string, selected: string): [number, number] | null => {
    if (anchor) {
      const conversion = convertRelativeDates(raw, anchor);
      const at = conversion.text.indexOf(selected);
      if (at >= 0) return [toRawOffset(conversion, at, 'start'), toRawOffset(conversion, at + selected.length, 'end')];
    }
    const direct = raw.indexOf(selected);
    return direct >= 0 ? [direct, direct + selected.length] : null;
  };

  const captureSelection = () => {
    if (locked || !section?.draftText) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (!sel || sel.rangeCount === 0 || text.length < 2 || !mainTextRef.current) {
      // 그냥 클릭했으면 떠 있던 창을 닫는다
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!mainTextRef.current.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    setSelection({ text, top: rect.bottom + 8, left: Math.max(16, Math.min(rect.left, window.innerWidth - 420)) });
    setSelMode('menu');
    setSelInstruction('');
    setSelEditText(text);
  };

  const closeSelection = () => {
    setSelection(null);
    setSelMode('menu');
  };

  /** 드래그한 부분만 AI 가 고친다 */
  const reviseSelection = async () => {
    if (!caseId || !section || !selection || !selInstruction.trim()) return;
    setSelBusy(true);
    setError(null);
    try {
      // 날짜로 바꿔 보여 준 부분이면 원문 표기로 되돌려 보낸다 (모델은 상대 날짜 원문을 본다)
      const range = rawRangeOfSelection(section.draftText, selection.text);
      const selectedRaw = range ? section.draftText.slice(range[0], range[1]) : selection.text;
      setData(await caseApi.reviseStudyWriteSection(caseId, section.sectionId, selInstruction.trim(), selectedRaw));
      closeSelection();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '고치지 못했습니다.');
    } finally {
      setSelBusy(false);
    }
  };

  /** 드래그한 부분을 사람이 직접 바꿔 저장한다. 원문에서 못 찾으면 전체 편집으로 넘어간다 */
  const saveSelectionEdit = async () => {
    if (!caseId || !section || !selection) return;
    const raw = section.draftText;
    const range = rawRangeOfSelection(raw, selection.text);
    if (!range) {
      setFullEditText(raw);
      setFullEditOpen(true);
      closeSelection();
      setError('선택한 부분을 원문에서 그대로 찾지 못해 전체 편집으로 열었습니다.');
      return;
    }
    const nextText = raw.slice(0, range[0]) + selEditText + raw.slice(range[1]);
    setSelBusy(true);
    setError(null);
    try {
      setData(await caseApi.saveStudyWriteSectionDraft(caseId, section.sectionId, nextText, { recheckCare: true }));
      setNeedsReview((prev) => ({ ...prev, [section.sectionId]: true }));
      closeSelection();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSelBusy(false);
    }
  };

  const saveFullEdit = async () => {
    if (!caseId || !section) return;
    setSelBusy(true);
    setError(null);
    try {
      setData(await caseApi.saveStudyWriteSectionDraft(caseId, section.sectionId, fullEditText, { recheckCare: true }));
      setNeedsReview((prev) => ({ ...prev, [section.sectionId]: true }));
      setFullEditOpen(false);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
    } finally {
      setSelBusy(false);
    }
  };

  // 섹션을 바꾸면 선택과 전체 편집을 닫는다
  useEffect(() => {
    setSelection(null);
    setFullEditOpen(false);
  }, [selectedId]);

  const uploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !caseId || !section) return;
    setUploading(true);
    setError(null);
    try {
      await caseApi.uploadStudyWriteAttachment(caseId, section.sectionId, file, caption);
      setCaption('');
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '올리지 못했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const saveCaption = async (attachment: StudyWriteAttachment, value: string) => {
    if (!caseId || value === attachment.caption) return;
    try {
      await caseApi.updateStudyWriteAttachmentCaption(caseId, attachment.id, value);
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '제목을 저장하지 못했습니다.');
    }
  };

  const removeAttachment = async (attachment: StudyWriteAttachment) => {
    if (!caseId || !window.confirm(`"${attachment.caption || attachment.fileName}"을(를) 지울까요?`)) return;
    try {
      await caseApi.deleteStudyWriteAttachment(caseId, attachment.id);
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '지우지 못했습니다.');
    }
  };

  const saveAnswer = async (question: StudyWriteQuestion, choice?: AnswerChoiceValue) => {
    if (!caseId) return;
    const answer = answerDraft.trim();
    if (!choice && !answer) {
      setError('답을 적거나 선택지를 골라 주세요.');
      return;
    }
    try {
      await caseApi.answerStudyWriteQuestion(caseId, choice ? choiceToBody(question.id, choice) : { questionId: question.id, answer });
      setEditingAnswerId(null);
      setDirtySectionIds((prev) => Array.from(new Set([...prev, ...question.targetSectionIds])));
      await refresh();
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '답을 저장하지 못했습니다.');
    }
  };

  const regenerateDirty = async () => {
    if (!caseId || dirtySectionIds.length === 0) return;
    setRegenerating(true);
    try {
      setData(await caseApi.generateStudyWriteDrafts(caseId, dirtySectionIds));
      setDirtySectionIds([]);
    } catch (nextError: any) {
      setError(nextError?.response?.data?.error || nextError?.message || '다시 쓰지 못했습니다.');
    } finally {
      setRegenerating(false);
    }
  };

  const locked = Boolean(data?.answersLockedAt || data?.submittedAt);

  if (data && !hasAnyDraft) {
    const done = generation?.doneSectionIds.length || 0;
    const total = generation?.targetSectionIds.length || 12;
    return (
      <div className="sw-draft sw-draft--loading">
        <div>
          <p className="sw-draft__eyebrow">실험용 Write · 초안 생성</p>
          <h1>답한 내용을 바탕으로 초안을 쓰고 있습니다</h1>
          <p>섹션 {done} / {total} 완료. 보통 2~3분 걸립니다. 끝난 섹션부터 열립니다.</p>
          <div className="sw-draft__progress">
            <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          {generation?.status === 'failed' ? (
            <div className="sw-draft__error">
              초안을 만들지 못했습니다. {generation.lastError || ''}
              <button type="button" onClick={() => caseId && caseApi.generateStudyWriteDrafts(caseId).then(setData)}>
                다시 시도
              </button>
            </div>
          ) : null}
          {error ? <div className="sw-draft__error">{error}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sw-draft">
      <header className="sw-draft__header">
        <div>
          <p className="sw-draft__eyebrow">실험용 Write · 초안</p>
          <h1>섹션별 초안</h1>
        </div>
        <div className="sw-draft__meta">
          {data?.experimentCode ? <span>실험번호 {data.experimentCode}</span> : null}
          {(() => {
            const all = data ? overallCareCompliance(data.sections) : null;
            return all ? (
              <span className={`sw-draft__overall is-${complianceLevel(all)}`} title={`CARE 세부 항목 ${all.ok}/${all.total} 충족 · 필수 ${all.requiredOk}/${all.requiredTotal}${uncheckedSuffix(all)}`}>
                CARE 준수율 {all.pct}% · 필수 {all.requiredPct ?? '-'}%
              </span>
            ) : null;
          })()}
          {running ? (
            <span className="is-busy">
              초안 생성 중 {generation?.doneSectionIds.length} / {generation?.targetSectionIds.length}
            </span>
          ) : null}
          <button type="button" className="is-secondary" onClick={() => navigate(`/study/write/cases/${caseId}/interview`)}>
            질의응답 보기
          </button>
          <button type="button" disabled={running || !hasAnyDraft} onClick={() => navigate(`/study/write/cases/${caseId}/final`)}>
            {locked ? '최종 수정으로' : '최종 수정으로 (답 수정 잠김)'}
          </button>
        </div>
      </header>

      {error ? <div className="sw-draft__error">{error}</div> : null}
      {data && caseId ? <DateAnchorBar caseId={caseId} data={data} onChange={setData} /> : null}
      {dirtySectionIds.length > 0 ? (
        <div className="sw-draft__notice">
          답을 고쳤습니다. 관련 섹션({dirtySectionIds.length}개)을 다시 쓸까요?
          <button type="button" disabled={regenerating || running} onClick={() => void regenerateDirty()}>
            {regenerating ? '다시 쓰는 중…' : '관련 섹션 다시 쓰기'}
          </button>
          <button type="button" className="is-secondary" onClick={() => setDirtySectionIds([])}>
            나중에
          </button>
        </div>
      ) : null}

      <div className="sw-draft__body">
        <nav className="sw-draft__nav">
          {data?.sections.map((item) => {
            const missing = missingRequiredCount(item);
            const pending = running && !item.draftText;
            return (
              <button
                key={item.sectionId}
                type="button"
                className={`sw-draft__nav-item${item.sectionId === section?.sectionId ? ' is-active' : ''}`}
                onClick={() => setSelectedId(item.sectionId)}
              >
                <span>{item.name}</span>
                {pending ? <em>쓰는 중</em> : null}
                {!pending && !item.draftText ? <em>없음</em> : null}
                {(() => {
                  const c = careCompliance(item);
                  return c ? (
                    <i
                      className={`sw-draft__nav-pct is-${complianceLevel(c)}`}
                      title={`CARE 준수 ${c.ok}/${c.total} (필수 ${c.requiredOk}/${c.requiredTotal}${missing > 0 ? `, 필수 ${missing}개 빠짐` : ''})`}
                    >
                      {c.pct}%
                    </i>
                  ) : null;
                })()}
              </button>
            );
          })}
          <div className="sw-draft__nav-divider" />
          <button type="button" className="sw-draft__nav-item sw-draft__nav-record" onClick={() => setRecordOpen(true)}>
            <span>원문 EMR 보기</span>
          </button>
        </nav>
        {caseId ? (
          <RecordViewer
            caseId={caseId}
            isOpen={recordOpen}
            onClose={() => setRecordOpen(false)}
            relativeDates={Boolean(data?.relativeDates)}
            formatDate={dated}
          />
        ) : null}

        <main className="sw-draft__main">
          {section ? (
            <>
              <div className="sw-draft__section-head">
                <h2>{section.name}</h2>
                <span>
                  버전 {section.version}
                  {section.draftText && !locked && !fullEditOpen ? (
                    <button
                      type="button"
                      className="is-link sw-draft__edit-toggle"
                      onClick={() => {
                        setFullEditText(section.draftText);
                        setFullEditOpen(true);
                        closeSelection();
                      }}
                    >
                      직접 편집
                    </button>
                  ) : null}
                </span>
              </div>
              {section.draftText && !locked && !fullEditOpen ? (
                <p className="sw-draft__drag-hint">
                  {section.sectionId === 'TITLE'
                    ? '↻ 를 누르면 AI가 그 줄만 다시 만들고, ↶ 로 이전 것으로 되돌리며, ✎ 로 직접 고칠 수 있습니다.'
                    : '문장을 드래그하면 그 부분만 AI에게 고치게 하거나 직접 고칠 수 있습니다.'}
                </p>
              ) : null}
              {needsReview[section.sectionId] && !locked && !fullEditOpen ? (
                <div className="sw-draft__review-banner">
                  <span>직접 고친 내용이 있습니다. 고친 부분 때문에 나머지와 어긋나는 곳이 없는지 AI가 한 번 더 볼까요? 고친 내용은 그대로 둡니다.</span>
                  <div>
                    <button type="button" disabled={reviewing || revising} onClick={() => void reviewAfterEdit()}>
                      {reviewing ? '점검 중…' : '전체 점검하기'}
                    </button>
                    <button
                      type="button"
                      className="is-secondary"
                      disabled={reviewing}
                      onClick={() => setNeedsReview((prev) => ({ ...prev, [section.sectionId]: false }))}
                    >
                      괜찮아요
                    </button>
                  </div>
                </div>
              ) : null}
              <div className={`sw-draft__content${draftBusy ? ' is-busy' : ''}`} aria-busy={Boolean(draftBusy)}>
              {fullEditOpen ? (
                <div className="sw-draft__full-edit">
                  <textarea
                    value={fullEditText}
                    onChange={(event) => setFullEditText(event.target.value)}
                    rows={Math.max(8, Math.min(30, Math.ceil(fullEditText.length / 60) + 2))}
                    spellCheck={false}
                    disabled={selBusy}
                  />
                  <div>
                    <button type="button" disabled={selBusy || fullEditText === section.draftText} onClick={() => void saveFullEdit()}>
                      {selBusy ? '저장 중…' : '저장'}
                    </button>
                    <button type="button" className="is-secondary" disabled={selBusy} onClick={() => setFullEditOpen(false)}>
                      취소
                    </button>
                  </div>
                </div>
              ) : section.draftText && section.sectionId === 'TITLE' && parseTitleDraft(section.draftText).titleIndex >= 0 ? (
                // 제목·핵심 단어는 따로: ↻ 다시 만들기, ✎ 직접 고치기
                <TitleKeywordsEditor
                  text={section.draftText}
                  history={section.history}
                  readOnly={locked}
                  disabled={revising || reviewing || running}
                  onRegenerate={async (part) => {
                    if (!caseId) return;
                    setError(null);
                    try {
                      setData(await caseApi.regenerateStudyWriteTitlePart(caseId, part));
                    } catch (nextError: any) {
                      setError(nextError?.response?.data?.error || nextError?.message || '다시 만들지 못했습니다.');
                    }
                  }}
                  onSave={async (nextText) => {
                    if (!caseId) return;
                    setError(null);
                    try {
                      setData(await caseApi.saveStudyWriteSectionDraft(caseId, 'TITLE', nextText, { recheckCare: true }));
                    } catch (nextError: any) {
                      setError(nextError?.response?.data?.error || nextError?.message || '저장하지 못했습니다.');
                      throw nextError;
                    }
                  }}
                />
              ) : section.draftText && section.sectionId === 'TIMELINE' && parseTimelineRows(section.draftText) ? (
                // 타임라인은 CARE 표로 보여 준다 (날짜 | 경과 요약 | 진단 검사 | 치료 개입). 원본 글은 접어 둔다
                <>
                  <details className="sw-draft__timeline-source">
                    <summary>원본 글 보기 (표를 만드는 글: 한 줄 = 한 행, 칸은 "|"로 나눔)</summary>
                    <pre>{dated(section.draftText)}</pre>
                    <p>고치려면 위의 "직접 편집"을 누르세요. 최종 수정 화면에서도 이 글을 고칩니다.</p>
                  </details>
                  <div ref={mainTextRef} onMouseUp={captureSelection}>
                    <TimelineTable text={dated(section.draftText)} />
                  </div>
                </>
              ) : section.draftText ? (
                <div className="sw-draft__text" ref={mainTextRef} onMouseUp={captureSelection}>
                  {renderClinicalAnonymizedText(dated(section.draftText))}
                </div>
              ) : (
                <p className="sw-draft__empty">{running ? '이 섹션은 아직 쓰는 중입니다.' : '이 섹션의 초안이 없습니다.'}</p>
              )}
                {draftBusy ? (
                  <div className="sw-draft__busy" role="status">
                    <div className="sw-draft__busy-box">
                      <span className="sw-draft__spinner" aria-hidden="true" />
                      <strong>{draftBusy}</strong>
                    </div>
                  </div>
                ) : null}
              </div>

              <section className="sw-draft__attachments">
                <h3>표와 그림</h3>
                {section.attachments.length === 0 ? <p className="sw-draft__empty">아직 넣은 표나 그림이 없습니다.</p> : null}
                {section.attachments.map((attachment, index) => (
                  <div key={attachment.id} className="sw-draft__attachment">
                    <div className="sw-draft__attachment-head">
                      <strong>
                        {attachment.kind === 'table' ? '표' : '그림'} · {attachment.fileName}
                      </strong>
                      {!locked ? (
                        <button type="button" className="is-link" onClick={() => void removeAttachment(attachment)}>
                          지우기
                        </button>
                      ) : null}
                    </div>
                    {attachment.kind === 'image' && caseId ? (
                      <img src={caseApi.studyWriteAttachmentFileUrl(caseId, attachment.id)} alt={attachment.caption || attachment.fileName} />
                    ) : null}
                    {attachment.kind === 'table' && attachment.tableRows ? (
                      <div className="sw-draft__table">
                        <table>
                          <tbody>
                            {attachment.tableRows.slice(0, 12).map((row, rowIndex) => (
                              <tr key={rowIndex}>
                                {row.map((cell, cellIndex) =>
                                  rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {attachment.tableRows.length > 12 ? <p>… 외 {attachment.tableRows.length - 12}행</p> : null}
                      </div>
                    ) : null}
                    <label className="sw-draft__caption">
                      <span>{attachment.kind === 'table' ? '표' : '그림'} 제목</span>
                      <input
                        defaultValue={attachment.caption}
                        placeholder={`예: ${attachment.kind === 'table' ? '표' : '그림'} ${index + 1}. 치료 경과`}
                        disabled={locked}
                        onBlur={(event) => void saveCaption(attachment, event.target.value)}
                      />
                    </label>
                  </div>
                ))}
                {!locked ? (
                  <div className="sw-draft__upload">
                    <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="먼저 제목을 적고 파일을 고르세요 (나중에 고칠 수 있음)" />
                    <label className={`sw-draft__file${uploading ? ' is-busy' : ''}`}>
                      <input type="file" accept=".png,.jpg,.jpeg,.xlsx" onChange={uploadFile} disabled={uploading} />
                      {uploading ? '올리는 중…' : '그림(png·jpg) 또는 표(xlsx) 올리기'}
                    </label>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>

        <aside className="sw-draft__side">
          <div className="sw-draft__tabs">
            <button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>
              수정 요청
            </button>
            <button type="button" className={tab === 'care' ? 'is-active' : ''} onClick={() => setTab('care')}>
              CARE 점검{section && missingRequiredCount(section) > 0 ? ` (${missingRequiredCount(section)})` : ''}
            </button>
            <button type="button" className={tab === 'answers' ? 'is-active' : ''} onClick={() => setTab('answers')}>
              내 답변{questions.some((question) => question.status === 'deferred') ? ` (보류 ${questions.filter((question) => question.status === 'deferred').length})` : ''}
            </button>
          </div>

          {tab === 'chat' && section ? (
            <div className="sw-draft__chat">
              <div className="sw-draft__chat-log" ref={chatRef}>
                <div className="sw-chat sw-chat--system">
                  이 섹션을 어떻게 고칠지 적어 주세요. 예: "용량과 복용법을 넣어 줘", "둘째 문장은 빼 줘", "더 간결하게".
                  기록에 없는 내용을 넣으라고 하면 그 문장에 표시가 붙습니다.
                </div>
                {section.chat.map((entry) =>
                  entry.kind === 'question' ? (
                    // "질문 받기"로 AI 가 한 질문
                    <div key={entry.id} className={`sw-chat sw-chat--assistant sw-chat--question${entry.answeredAt || entry.skippedAt ? ' is-answered' : ''}`}>
                      <span className="sw-chat__role">AI 질문{entry.answeredAt ? ' · 답함' : entry.skippedAt ? ' · 건너뜀' : ''}</span>
                      <div className="sw-chat__question">{renderClinicalAnonymizedText(dated(entry.text))}</div>
                      {entry.hint ? <small>답에 들어가면 좋은 것: {entry.hint}</small> : null}
                      {entry.reason ? <small className="sw-chat__reason">{dated(entry.reason)}</small> : null}
                    </div>
                  ) : (
                    <div key={entry.id} className={`sw-chat sw-chat--${entry.role}`}>
                      {entry.role === 'user' || entry.role === 'assistant' ? (
                        <span className="sw-chat__role">{entry.role === 'user' ? '나' : 'AI'}</span>
                      ) : null}
                      {entry.role === 'assistant' ? renderClinicalAnonymizedText(dated(entry.text)) : entry.text}
                      {entry.resultVersion ? <small>초안 버전 {entry.resultVersion}</small> : null}
                    </div>
                  )
                )}
                {askingQuestion ? <div className="sw-chat sw-chat--system">무엇을 여쭤볼지 고르는 중…</div> : null}
                {revising ? <div className="sw-chat sw-chat--system">{pendingQuestion ? '답을 저장하고 이 섹션에 반영하는 중…' : '고쳐 쓰는 중…'}</div> : null}
              </div>
              {!locked ? (
                <div className="sw-draft__chat-composer">
                  {pendingQuestion ? (
                    <div className="sw-draft__ask is-answering">
                      <span>AI 질문에 답하는 중입니다. 보내면 답이 "내 답변"에 저장되고 이 섹션에 반영됩니다.</span>
                      <button type="button" className="is-secondary" disabled={revising || skipping} onClick={() => void skipQuestion()}>
                        {skipping ? '건너뛰는 중…' : '건너뛰기'}
                      </button>
                    </div>
                  ) : (
                    <div className="sw-draft__ask">
                      <span>무엇을 더 써야 할지 모르겠으면 AI가 이 섹션을 자세히 쓰기 위한 질문을 드립니다.</span>
                      <button
                        type="button"
                        disabled={askingQuestion || revising || !section.draftText}
                        onClick={() => void askQuestion()}
                      >
                        {askingQuestion ? '질문 고르는 중…' : '질문 받기'}
                      </button>
                    </div>
                  )}
                  <div className="sw-draft__chat-box">
                    <textarea
                      ref={composerRef}
                      value={instruction}
                      onChange={(event) => {
                        setInstruction(event.target.value);
                        // 입력 길이에 맞춰 늘어난다 (최대 높이는 CSS)
                        event.target.style.height = 'auto';
                        event.target.style.height = `${event.target.scrollHeight}px`;
                      }}
                      rows={1}
                      placeholder={pendingQuestion ? 'AI 질문에 답해 주세요' : '이 섹션을 어떻게 고칠까요?'}
                      disabled={revising || !section.draftText}
                      onKeyDown={(event) => {
                        // Enter 보내기, Shift+Enter 줄바꿈 (일반 채팅과 같게)
                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void sendInstruction();
                        }
                      }}
                    />
                    <button
                      type="button"
                      aria-label="보내기"
                      title="보내기 (Enter)"
                      disabled={revising || !instruction.trim() || !section.draftText}
                      onClick={() => void sendInstruction()}
                    >
                      ↑
                    </button>
                  </div>
                  <p className="sw-draft__chat-hint">Enter 보내기 · Shift+Enter 줄바꿈</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'care' && section ? (
            <div className="sw-draft__care">
              {section.careCheck ? (
                (() => {
                  const items = section.careCheck.items;
                  const required = items.filter((item) => item.required);
                  const optional = items.filter((item) => !item.required);
                  const okCount = (list: typeof items) => list.filter((item) => isCareSatisfied(effectiveCareStatus(item))).length;
                  /** 수정 요청·정보 입력 버튼과 입력칸. 항목(예: "9b")과 하위 요소(예: "9b-H4")에 같이 쓴다 */
                  const renderActions = (code: string, requestLabel: string, status: StudyWriteCareItemStatus) => (
                    <>
                      {status === 'in_record_not_in_draft' && !locked ? (
                        <button
                          type="button"
                          className="sw-care-item__action"
                          onClick={() => {
                            setInstruction(`${requestLabel} 내용을 기록에서 찾아 이 섹션에 넣어 줘.`);
                            setTab('chat');
                            setFocusComposerAt(Date.now());
                          }}
                        >
                          수정 요청으로 넣기
                        </button>
                      ) : null}
                      {status === 'not_in_record' && !locked && careInfoCode !== code ? (
                        <button
                          type="button"
                          className="sw-care-item__action"
                          disabled={running || careInfoSaving || careQuestionLoading}
                          onClick={() => void openCareQuestion(section.sectionId, code)}
                        >
                          이 정보 입력하기
                        </button>
                      ) : null}
                      {status === 'not_in_record' && !locked && careInfoCode === code ? (
                        <div className="sw-care-item__input">
                          <div className="sw-care-item__question">
                            <span>AI 질문</span>
                            {careQuestionLoading || careQuestion?.code !== code ? (
                              <p className="is-loading">이 항목을 쓰기 위해 무엇을 여쭤볼지 고르는 중…</p>
                            ) : (
                              <>
                                <p>{careQuestion.question}</p>
                                {careQuestion.hint ? <small>답에 들어가면 좋은 것: {careQuestion.hint}</small> : null}
                              </>
                            )}
                          </div>
                          <textarea
                            value={careInfoText}
                            autoFocus
                            rows={3}
                            placeholder="답을 적어 주세요. 저장하면 이 섹션을 다시 씁니다."
                            disabled={careInfoSaving || careQuestionLoading}
                            onChange={(event) => setCareInfoText(event.target.value)}
                          />
                          <div>
                            <button
                              type="button"
                              disabled={careInfoSaving || careQuestionLoading || !careInfoText.trim()}
                              onClick={() => void submitCareInfo(section.sectionId, code)}
                            >
                              {careInfoSaving ? '저장 중…' : '답하고 다시 쓰기'}
                            </button>
                            <button
                              type="button"
                              className="is-secondary"
                              disabled={careInfoSaving}
                              onClick={() => {
                                setCareInfoCode(null);
                                setCareQuestion(null);
                              }}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  );
                  /** 하위 요소 한 줄 */
                  const renderSub = (sub: StudyWriteCareSubItem) => (
                    <li key={sub.id} className={`sw-care-sub__row is-${sub.status}`}>
                      <span className="sw-care-sub__mark" aria-label={STATUS_LABEL[sub.status]}>
                        {STATUS_META[sub.status].mark}
                      </span>
                      <div className="sw-care-sub__body">
                        <div className="sw-care-sub__head">
                          <span className={`sw-draft__tag${sub.required ? ' is-required' : ''}`}>
                            {sub.id} {sub.required ? '필수' : '선택'}
                          </span>
                          <strong>{sub.label}</strong>
                          <em className="sw-care-sub__state">{STATUS_LABEL[sub.status]}</em>
                        </div>
                        <p className="sw-care-sub__criterion">
                          {sub.criterion}
                          {sub.condition ? ` · 조건: ${sub.condition}` : ''}
                        </p>
                        {sub.hint ? <p className="sw-care-item__hint">{renderClinicalAnonymizedText(dated(sub.hint))}</p> : null}
                        {renderActions(sub.id, `${sub.groupLabel ? `${sub.groupLabel} ` : ''}${sub.label}`, sub.status)}
                      </div>
                    </li>
                  );
                  /** 항목 아래 하위 요소 (체크리스트 v2). 빠진 것이 있으면 펼쳐 둔다 */
                  const renderSubs = (subs: StudyWriteCareSubItem[]) => {
                    const c = subCompliance(subs);
                    if (!c) return null;
                    const missingRequired = c.requiredApplicable - c.requiredPresent;
                    const groups: Array<{ label: string; items: StudyWriteCareSubItem[] }> = [];
                    for (const sub of subs) {
                      const last = groups[groups.length - 1];
                      if (last && last.label === sub.groupLabel) last.items.push(sub);
                      else groups.push({ label: sub.groupLabel, items: [sub] });
                    }
                    return (
                      <details className="sw-care-sub" open={c.present < c.applicable || c.unchecked > 0}>
                        <summary>
                          하위 요소 {c.present} / {c.applicable} 있음
                          {missingRequired > 0 ? <b> · 필수 {missingRequired}개 빠짐</b> : null}
                          {c.notApplicable > 0 ? ` · 해당 없음 ${c.notApplicable}` : ''}
                          {c.unchecked > 0 ? ` · 판정 없음 ${c.unchecked}` : ''}
                        </summary>
                        {groups.map((group) => (
                          <div key={group.label || 'base'} className="sw-care-sub__group">
                            {group.label ? <h5>{group.label}</h5> : null}
                            <ul>{group.items.map(renderSub)}</ul>
                          </div>
                        ))}
                      </details>
                    );
                  };
                  const renderItem = (rawItem: (typeof items)[number]) => {
                    const item = { ...rawItem, status: effectiveCareStatus(rawItem) };
                    const subs = rawItem.subItems || [];
                    // 하위 요소 판정이 있으면 버튼은 하위 요소마다 단다 (질문이 더 좁아진다)
                    const hasJudgedSubs = subs.some((sub) => sub.status !== 'unchecked');
                    const partial = isPartialItem(item);
                    const mark = partial ? '◐' : STATUS_META[item.status].mark;
                    const stateLabel = partial ? '일부' : STATUS_LABEL[item.status];
                    const note = partial ? '항목은 들어 있지만 필수 하위 요소가 빠짐. 아래 목록 참고' : STATUS_META[item.status].note;
                    return (
                    <li key={item.code} className={`sw-care-item is-${partial ? 'partial' : item.status}`}>
                      <div className="sw-care-item__status" aria-label={stateLabel}>
                        <span className="sw-care-item__mark">{mark}</span>
                        <span className="sw-care-item__state">{stateLabel}</span>
                      </div>
                      <div className="sw-care-item__body">
                        <div className="sw-care-item__head">
                          <span className={`sw-draft__tag${item.required ? ' is-required' : ''}`}>
                            {item.code} {item.required ? '필수' : '선택'}
                          </span>
                          <strong>{item.label}</strong>
                        </div>
                        <p className="sw-care-item__note">{note}</p>
                        {item.hint ? <p className="sw-care-item__hint">{renderClinicalAnonymizedText(dated(item.hint))}</p> : null}
                        {!hasJudgedSubs ? renderActions(item.code, item.label.split('.')[0].split('(')[0].trim(), item.status) : null}
                        {renderSubs(subs)}
                      </div>
                    </li>
                    );
                  };
                  return (
                    <>
                      <div className="sw-care-summary">
                        {(() => {
                          const c = careCompliance(section);
                          return c ? (
                            <div className={`sw-care-summary__box sw-care-summary__box--pct is-${complianceLevel(c)}`}>
                              <span>이 섹션 CARE 준수율</span>
                              <strong>{c.pct}%</strong>
                              <em>
                                세부 항목 {c.ok} / {c.total} 충족 · 필수 {c.requiredOk} / {c.requiredTotal}
                                {uncheckedSuffix(c)}
                              </em>
                            </div>
                          ) : null;
                        })()}
                        {(() => {
                          const sc = sectionSubCompliance(section);
                          return sc ? (
                            <div
                              className={`sw-care-summary__box sw-care-summary__box--sub${
                                sc.requiredPresent < sc.requiredApplicable ? ' is-missing' : ' is-ok'
                              }`}
                              title="해당 없음과 판정 없음은 분모에서 뺍니다. 위 준수율(항목 단위)과 따로 셉니다."
                            >
                              <span>하위 요소</span>
                              <strong>{sc.pct}%</strong>
                              <em>
                                {sc.present} / {sc.applicable} 있음 · 필수 {sc.requiredPresent} / {sc.requiredApplicable}
                                {sc.unchecked > 0 ? ` · 판정 없음 ${sc.unchecked}` : ''}
                              </em>
                            </div>
                          ) : null;
                        })()}
                        <div className={`sw-care-summary__box${okCount(required) === required.length ? ' is-ok' : ' is-missing'}`}>
                          <span>필수</span>
                          <strong>
                            {okCount(required)} / {required.length}
                          </strong>
                          <em>{okCount(required) === required.length ? '모두 있음' : `${required.length - okCount(required)}개 빠짐`}</em>
                        </div>
                        <div className="sw-care-summary__box">
                          <span>선택</span>
                          <strong>
                            {okCount(optional)} / {optional.length}
                          </strong>
                          <em>{optional.length === 0 ? '없음' : `${optional.length - okCount(optional)}개 빠짐`}</em>
                        </div>
                      </div>
                      {!data?.submittedAt ? (
                        <div className="sw-care-recheck">
                          {section.careCheck.checklistVersion !== 'care-checklist:v2' ? (
                            <span>이 점검은 하위 요소 기준이 생기기 전 결과입니다.</span>
                          ) : null}
                          <button
                            type="button"
                            className="sw-care-item__action"
                            disabled={careRechecking || running || careInfoSaving}
                            onClick={() => void recheckCare(section.sectionId)}
                          >
                            {careRechecking ? '점검 중…' : 'CARE 다시 점검'}
                          </button>
                        </div>
                      ) : null}
                      {section.careCheck.modalities && section.careCheck.modalities.checked.length + section.careCheck.modalities.skipped.length > 0 ? (
                        <p className="sw-care-modalities">
                          하위 요소를 점검한 개입:{' '}
                          {section.careCheck.modalities.checked.map((key) => MODALITY_LABEL[key] || key).join(', ') || '없음'}
                          {section.careCheck.modalities.skipped.length > 0
                            ? ` · 기록·답변·초안에서 찾지 못해 점검하지 않은 개입: ${section.careCheck.modalities.skipped
                                .map((key) => MODALITY_LABEL[key] || key)
                                .join(', ')}`
                            : ''}
                        </p>
                      ) : null}
                      {required.length > 0 ? (
                        <>
                          <h4 className="sw-care-group">필수 항목</h4>
                          <ul>{required.map(renderItem)}</ul>
                        </>
                      ) : null}
                      {optional.length > 0 ? (
                        <>
                          <h4 className="sw-care-group">선택 항목</h4>
                          <ul>{optional.map(renderItem)}</ul>
                        </>
                      ) : null}
                    </>
                  );
                })()
              ) : (
                <p className="sw-draft__empty">아직 점검 결과가 없습니다.</p>
              )}
            </div>
          ) : null}

          {tab === 'answers' ? (
            (() => {
              const sectionName = (id: string) => data?.sections.find((item) => item.sectionId === id)?.name || id;
              const relevant = section
                ? questions.filter((question) => question.priority === 'case' || question.targetSectionIds.includes(section.sectionId))
                : questions;
              const shown = showAllAnswers ? questions : relevant;
              return (
                <div className="sw-draft__answers">
                  <div className="sw-answers__head">
                    <p>
                      {showAllAnswers
                        ? `질의응답 답 전체 ${questions.length}개.`
                        : `이 섹션을 쓸 때 참고한 답 ${relevant.length}개.`}{' '}
                      {locked ? '최종 수정 단계라 고칠 수 없습니다.' : '고치면 관련 섹션을 다시 쓸 수 있습니다.'}
                    </p>
                    {questions.length !== relevant.length ? (
                      <button type="button" className="is-link" onClick={() => setShowAllAnswers((value) => !value)}>
                        {showAllAnswers ? '이 섹션 것만' : `전체 보기 (${questions.length})`}
                      </button>
                    ) : null}
                  </div>
                  {shown.length === 0 ? <p className="sw-draft__empty">이 섹션에 쓰인 답이 없습니다.</p> : null}
                  {shown.map((question) => (
                    <article key={question.id} className="sw-answer">
                      <header className="sw-answer__head">
                        <span className="sw-answer__no">질문 {question.order}</span>
                        <span className="sw-answer__sections">{question.targetSectionIds.map(sectionName).join(' · ')}</span>
                        {!locked && editingAnswerId !== question.id ? (
                          <button
                            type="button"
                            className="is-link sw-answer__edit"
                            onClick={() => {
                              setEditingAnswerId(question.id);
                              setAnswerDraft(question.answer);
                            }}
                          >
                            수정
                          </button>
                        ) : null}
                      </header>
                      <p className="sw-answer__question">{question.text}</p>
                      {editingAnswerId === question.id ? (
                        <div className="sw-draft__answer-edit">
                          <textarea value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} rows={4} autoFocus placeholder="답을 적거나 아래 선택지를 고르세요" />
                          <div className="sw-answer__choices">
                            {ANSWER_CHOICES.map((choice) => (
                              <button key={choice.value} type="button" className="is-secondary" title={choice.description} onClick={() => void saveAnswer(question, choice.value)}>
                                {choice.label}
                              </button>
                            ))}
                          </div>
                          <div>
                            <button type="button" onClick={() => void saveAnswer(question)}>
                              저장
                            </button>
                            <button type="button" className="is-secondary" onClick={() => setEditingAnswerId(null)}>
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="sw-answer__text">
                          {question.status === 'answered' ? (
                            question.answer
                          ) : (
                            <em className={question.status === 'deferred' ? 'is-deferred' : ''}>
                              {answerStatusLabel(question)}
                              {question.status === 'deferred' && !locked ? ' — 기록을 확인한 뒤 "수정"으로 답해 주세요' : ''}
                            </em>
                          )}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              );
            })()
          ) : null}
        </aside>
      </div>

      {selection && section && !locked ? (
        <div className="sw-select-pop" style={{ top: selection.top, left: selection.left }} onMouseDown={(event) => event.stopPropagation()}>
          <div className="sw-select-pop__quote">「{selection.text.length > 90 ? `${selection.text.slice(0, 90)}…` : selection.text}」</div>
          {selMode === 'menu' ? (
            <div className="sw-select-pop__row">
              <button type="button" onClick={() => setSelMode('ai')}>
                AI에게 고치기
              </button>
              {section.sectionId !== 'TIMELINE' ? (
                <button type="button" className="is-secondary" onClick={() => setSelMode('edit')}>
                  직접 고치기
                </button>
              ) : null}
              <button type="button" className="is-secondary" onClick={closeSelection} aria-label="닫기">
                ✕
              </button>
            </div>
          ) : null}
          {selMode === 'ai' ? (
            <>
              <textarea
                value={selInstruction}
                autoFocus
                rows={2}
                placeholder="이 부분을 어떻게 고칠까요? 예: 더 간결하게 / 날짜를 넣어 줘"
                disabled={selBusy}
                onChange={(event) => setSelInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void reviseSelection();
                  }
                  if (event.key === 'Escape') closeSelection();
                }}
              />
              <div className="sw-select-pop__row">
                <button type="button" disabled={selBusy || !selInstruction.trim()} onClick={() => void reviseSelection()}>
                  {selBusy ? '고치는 중…' : '이 부분만 고치기'}
                </button>
                <button type="button" className="is-secondary" disabled={selBusy} onClick={closeSelection}>
                  취소
                </button>
              </div>
            </>
          ) : null}
          {selMode === 'edit' ? (
            <>
              <textarea
                value={selEditText}
                autoFocus
                rows={Math.max(2, Math.min(8, Math.ceil(selEditText.length / 50)))}
                disabled={selBusy}
                onChange={(event) => setSelEditText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSelection();
                }}
              />
              <div className="sw-select-pop__row">
                <button type="button" disabled={selBusy || selEditText === selection.text} onClick={() => void saveSelectionEdit()}>
                  {selBusy ? '저장 중…' : '이렇게 바꾸기'}
                </button>
                <button type="button" className="is-secondary" disabled={selBusy} onClick={closeSelection}>
                  취소
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
