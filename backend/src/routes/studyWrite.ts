import express, { Request, Response } from 'express';
import multer from 'multer';
import { CaseModel } from '../models/caseModel';
import { inspectRecordFile, MAX_FILE_BYTES } from '../studyWrite/recordImport';
import {
  addCareInfoAnswer,
  allQuestions,
  generateCareItemQuestion,
  answerQuestion,
  canOpenNextRound,
  createInitialStudyWriteState,
  finishInterview,
  generateNextRound,
  isAnalysisReady,
  normalizeStudyWriteState,
  startInterview,
  toParticipantView
} from '../studyWrite/interview';
import { StudyWriteChatEntry, StudyWriteInterviewFinish, StudyWriteSectionState, StudyWriteState } from '../types/studyWrite';
import { appendResearchEvent, isResearchTracked, normalizeResearchState } from './cases';
import { emptySectionState, generateDrafts, runCareCheck, runRevise, STUDY_WRITE_REVISE_PROMPT_VERSION } from '../studyWrite/drafting';
import { findSubElement } from '../studyWrite/careSubElements';
import { CHAT_QUESTION_SUMMARY_SECTIONS, generateSectionChatQuestion } from '../studyWrite/chatQuestion';
import { checkManuscript } from '../studyWrite/manuscriptCheck';
import { runAiManuscriptCheck } from '../studyWrite/aiManuscriptCheck';
import { mergeRegeneratedPart, parseTitleDraft, TitlePart } from '../studyWrite/titleKeywords';
import { promptMeta } from '../llm/promptRegistry';
import { CARE_ITEMS_BY_SECTION, CARE_SECTION_NAMES, CARE_SECTION_ORDER } from '../studyWrite/careItems';
import {
  createAttachment,
  deleteAttachment,
  getAttachmentFile,
  listAttachments,
  updateAttachmentCaption
} from '../studyWrite/attachments';
import { randomUUID } from 'crypto';
import { buildStudyWriteManuscriptDocx } from '../studyWrite/manuscriptDocx';
import { parseAnchorDate } from '../studyWrite/relativeDates';
import { getStudyWritePreset, listStudyWritePresets } from '../studyWrite/presets';
import { preparedQuestionsForCase } from '../studyWrite/preparedQuestions';
import { PreparedAnalysis, preparedAnalysisForCase } from '../studyWrite/preparedAnalysis';
import { buildContentDispositionHeader } from '../utils/unicode';

/**
 * 실험용 Write 전용 경로. Scaffold 경로(/api/cases/:id/scaffold)와 파일을 공유하지 않는다.
 */
const router = express.Router();
const caseModel = new CaseModel();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

/**
 * 올린 기록 파일(xlsx, docx)의 내용을 돌려준다. 파일은 저장하지 않고, 추출한 텍스트만
 * 응답한다. 외부(LLM)로는 아무것도 보내지 않는다. 비식별은 이 뒤 사례를 만들어
 * 분석할 때 지금 Write와 같은 경로로 처리된다.
 */
router.post('/inspect', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }
    const result = await inspectRecordFile(file.buffer, file.originalname || '');
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '파일을 읽지 못했습니다.' });
  }
});

// ---------------------------------------------------------------------------
// 실험 사례 불러오기 (방문 기록만)

router.get('/presets', (_req: Request, res: Response) => {
  res.json({ presets: listStudyWritePresets() });
});

router.get('/presets/:presetId', (req: Request, res: Response) => {
  const preset = getStudyWritePreset(req.params.presetId);
  if (!preset) return res.status(404).json({ error: '사례를 찾지 못했습니다.' });
  return res.json(preset);
});

// ---------------------------------------------------------------------------
// 질의응답(인터뷰)

async function loadCase(caseId: string) {
  const caseData: any = await caseModel.getCase(caseId);
  if (!caseData) return null;
  return caseData;
}

async function saveState(caseId: string, state: StudyWriteState) {
  await caseModel.updateCase(caseId, { studyWrite: state } as any);
}

/**
 * 미리 돌린 분석 결과를 이 사례에 복사하고, 연구 세션이 있으면 case_processed 이벤트(prepared: true)를 남긴다.
 * 복사한 뒤의 사례를 돌려준다 (화면이 분석이 끝난 것으로 본다).
 */
async function copyPreparedAnalysis(caseData: any, analysis: PreparedAnalysis): Promise<any> {
  await caseModel.updateCase(caseData.id, { ...analysis.fields } as any);
  const researchState = normalizeResearchState(caseData.researchState, Boolean(caseData.studyConfig?.studyMode));
  if (isResearchTracked(researchState) && !researchState.interactionEvents.some((item) => item.eventType === 'case_processed')) {
    await caseModel.updateCase(caseData.id, {
      researchState: appendResearchEvent(researchState, {
        eventId: randomUUID(),
        eventType: 'case_processed',
        caseId: caseData.id,
        mode: 'write',
        sessionId: researchState.sessionId,
        participantCode: researchState.participantCode,
        metadata: {
          prepared: true,
          presetId: analysis.presetId,
          sourceCaseId: analysis.sourceCaseId,
          sourceExperimentCode: analysis.sourceExperimentCode
        }
      }) as any
    } as any);
  }
  console.log(`[studyWrite] ${caseData.id}: copied prepared analysis of ${analysis.presetId} from ${analysis.sourceCaseId}`);
  return loadCase(caseData.id);
}

const FINISH_REASONS: ReadonlyArray<StudyWriteInterviewFinish['reason']> = [
  'participant_button',
  'budget_reached',
  'no_more_questions',
  'unspecified'
];

/**
 * 질의응답을 끝낸 상태에 종료 기록을 붙이고, 연구 세션이 있으면 interview_finished 이벤트도 남긴다.
 * 이미 끝난 질의응답이면 아무것도 바꾸지 않는다. 참여자 화면과 동작에는 영향이 없다.
 */
async function finishWithRecord(
  caseData: any,
  state: StudyWriteState,
  reason: StudyWriteInterviewFinish['reason'],
  stopReason?: string
): Promise<StudyWriteState> {
  if (state.interviewCompletedAt) return state;
  const finished = finishInterview(state);
  const questions = allQuestions(finished);
  const answeredTimes = questions
    .map((question) => (question.answeredAt ? new Date(question.answeredAt).getTime() : NaN))
    .filter((value) => !Number.isNaN(value));
  const at = finished.interviewCompletedAt || new Date().toISOString();
  const record: StudyWriteInterviewFinish = {
    reason,
    at,
    roundCount: finished.rounds.length,
    answeredCount: questions.filter((question) => question.status !== 'pending').length,
    questionCount: questions.length,
    analysisReady: isAnalysisReady(caseData),
    secondsSinceLastAnswer: answeredTimes.length
      ? Math.round((new Date(at).getTime() - Math.max(...answeredTimes)) / 1000)
      : null,
    ...(stopReason ? { stopReason } : {})
  };
  const next: StudyWriteState = { ...finished, interviewFinish: record };
  await saveState(caseData.id, next);

  const researchState = normalizeResearchState(caseData.researchState, Boolean(caseData.studyConfig?.studyMode));
  if (isResearchTracked(researchState)) {
    try {
      await caseModel.updateCase(caseData.id, {
        researchState: appendResearchEvent(researchState, {
          eventId: randomUUID(),
          eventType: 'interview_finished',
          caseId: caseData.id,
          mode: 'write',
          sessionId: researchState.sessionId,
          participantCode: researchState.participantCode,
          metadata: { ...record }
        }) as any
      } as any);
    } catch (error) {
      // 이벤트 기록 실패가 질의응답 종료를 막지 않는다 (종료 기록은 studyWrite.interviewFinish 에 이미 있다).
      console.error(`[studyWrite] interview_finished event not saved for ${caseData.id}`, error);
    }
  }
  return next;
}

function buildInterviewResponse(caseData: any, state: StudyWriteState) {
  const pending = Array.isArray(caseData.pendingTermConfirmations) ? caseData.pendingTermConfirmations : [];
  return {
    caseId: caseData.id,
    experimentCode: caseData.experiment_code || null,
    analysis: {
      ready: isAnalysisReady(caseData),
      currentStep: caseData.chainProgress?.currentStep || null,
      completedSteps: caseData.chainProgress?.completedSteps || [],
      blocked: Boolean(caseData.reviewRequired?.blocked || caseData.reviewRequired?.required),
      processingRequestedAt: state.processingRequestedAt || null
    },
    pendingTermCount: pending.filter((item: any) => item?.status === 'PENDING').length,
    nextRound: canOpenNextRound(state),
    interview: toParticipantView(state)
  };
}

// 같은 사례에 대한 쓰기는 순서대로 처리한다 (읽고-고치고-쓰기 사이의 유실 방지).
const writeQueues = new Map<string, Promise<unknown>>();
function serialize<T>(caseId: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(caseId) || Promise.resolve();
  const next = previous.then(task, task);
  writeQueues.set(caseId, next.catch(() => undefined));
  return next;
}

router.get('/cases/:caseId/interview', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    return res.json(buildInterviewResponse(caseData, state));
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || '불러오지 못했습니다.' });
  }
});

/**
 * 1회차(고정 질문)를 연다. 분석 요청을 보냈다고 표시해 두면, 화면이 새로고침돼도
 * 분석을 두 번 요청하지 않는다.
 */
router.post('/cases/:caseId/interview/start', async (req: Request, res: Response) => {
  try {
    const result = await serialize(req.params.caseId, async () => {
      let caseData = await loadCase(req.params.caseId);
      if (!caseData) return null;
      let state = normalizeStudyWriteState(caseData.studyWrite || createInitialStudyWriteState(req.body?.inputSource));
      if (req.body?.inputSource && !state.inputSource) state = { ...state, inputSource: req.body.inputSource };
      // 프리셋 EMR 기록 분석을 미리 돌려 둔 결과가 있으면 처음 시작할 때 복사한다 (studyWrite/preparedAnalysis.ts).
      // 분석을 기다리지 않을 뿐 질문은 그대로 실시간이다. 이미 분석했거나 분석 요청을 보낸 사례에는 하지 않는다.
      if (
        state.rounds.length === 0 &&
        !state.processingRequestedAt &&
        !state.analysisSource &&
        state.inputSource?.source === 'preset' &&
        !(Array.isArray(caseData.sectionDrafts) && caseData.sectionDrafts.length > 0)
      ) {
        const analysis = preparedAnalysisForCase(caseData, state.inputSource.presetId);
        if (analysis) {
          caseData = await copyPreparedAnalysis(caseData, analysis);
          state = {
            ...state,
            analysisSource: {
              kind: 'prepared',
              presetId: analysis.presetId,
              sourceCaseId: analysis.sourceCaseId,
              sourceExperimentCode: analysis.sourceExperimentCode,
              snapshotCreatedAt: analysis.createdAt,
              copiedAt: new Date().toISOString()
            }
          };
        }
      }
      // 프리셋 EMR 로 미리 만든 질문이 있으면 1회차에 모두 넣는다 (studyWrite/preparedQuestions.ts).
      // 2026-10-13 꺼 둠: 실험 참여자 S01·S02 와 같은 조건(1회차 고정 3개 → 2·3회차 실시간 생성)을 지킨다.
      // 다시 켜려면 STUDY_WRITE_PREPARED_QUESTIONS=1 (실험 설계를 바꾸는 일이므로 연구자 결정 필요).
      const prepared =
        process.env.STUDY_WRITE_PREPARED_QUESTIONS === '1' &&
        state.rounds.length === 0 &&
        state.inputSource?.source === 'preset'
          ? preparedQuestionsForCase(caseData, state.inputSource.presetId)
          : null;
      state = startInterview(state, prepared);
      if (req.body?.processingRequested && !state.processingRequestedAt) {
        state = { ...state, processingRequestedAt: new Date().toISOString() };
      }
      await saveState(caseData.id, state);
      return buildInterviewResponse(caseData, state);
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '시작하지 못했습니다.' });
  }
});

router.post('/cases/:caseId/interview/answer', async (req: Request, res: Response) => {
  try {
    const { questionId, answer, skipped, skipReason, deferred } = req.body || {};
    if (!questionId) return res.status(400).json({ error: 'questionId is required' });
    const result = await serialize(req.params.caseId, async () => {
      const caseData = await loadCase(req.params.caseId);
      if (!caseData) return null;
      const state = answerQuestion(normalizeStudyWriteState(caseData.studyWrite), String(questionId), {
        answer: typeof answer === 'string' ? answer : '',
        skipped: Boolean(skipped),
        skipReason: typeof skipReason === 'string' ? skipReason : undefined,
        deferred: Boolean(deferred)
      });
      await saveState(caseData.id, state);
      return buildInterviewResponse(caseData, state);
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '저장하지 못했습니다.' });
  }
});

/**
 * 다음 회차를 만든다. 분석이 아직이면 409 를 돌려주고, 체인이 질문을 만들지 않으면
 * 질의응답을 끝낸 상태를 돌려준다.
 */
router.post('/cases/:caseId/interview/next-round', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    let state = normalizeStudyWriteState(caseData.studyWrite);
    const gate = canOpenNextRound(state);
    if (!gate.ok) {
      return res.status(400).json({ error: gate.reason, ...buildInterviewResponse(caseData, state) });
    }
    if (!isAnalysisReady(caseData)) {
      return res.status(409).json({ error: '기록 분석이 아직 끝나지 않았습니다.', ...buildInterviewResponse(caseData, state) });
    }

    // 체인 호출은 길어서 큐 밖에서 하고, 저장만 큐 안에서 한다. 그 사이 답 수정이
    // 들어와도 회차 추가는 덮어쓰지 않도록 최신 상태 위에 회차를 붙인다.
    const generated = await generateNextRound(state, caseData);
    const result = await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      if (!latest) return null;
      const latestState = normalizeStudyWriteState(latest.studyWrite);
      let merged: StudyWriteState;
      if (generated.round) {
        merged = { ...latestState, rounds: [...latestState.rounds, generated.round], updatedAt: new Date().toISOString() };
        await saveState(latest.id, merged);
      } else {
        merged = await finishWithRecord(latest, latestState, 'no_more_questions', generated.stopReason);
      }
      state = merged;
      return { ...buildInterviewResponse(latest, merged), stopReason: generated.stopReason || null };
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '다음 질문을 만들지 못했습니다.' });
  }
});

/** 참여자가 "질문은 여기까지"를 눌렀을 때. 남은 상한을 쓰지 않고 초안 단계로 간다. */
router.post('/cases/:caseId/interview/finish', async (req: Request, res: Response) => {
  try {
    const result = await serialize(req.params.caseId, async () => {
      const caseData = await loadCase(req.params.caseId);
      if (!caseData) return null;
      // 화면이 어느 경로로 끝냈는지 보낸다: 버튼(participant_button) 또는 상한 도달(budget_reached)
      const reason = FINISH_REASONS.includes(req.body?.reason) ? req.body.reason : 'unspecified';
      const state = await finishWithRecord(caseData, normalizeStudyWriteState(caseData.studyWrite), reason);
      return buildInterviewResponse(caseData, state);
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '끝내지 못했습니다.' });
  }
});

// ---------------------------------------------------------------------------
// 초안 (⑤ 전체 초안 생성, ⑥ 섹션별 수정)

function buildDraftsResponse(caseData: any, state: StudyWriteState, attachments: Awaited<ReturnType<typeof listAttachments>>) {
  const sections = CARE_SECTION_ORDER.map((sectionId) => {
    const section = state.sections?.[sectionId] || emptySectionState(sectionId);
    return {
      ...section,
      name: CARE_SECTION_NAMES[sectionId],
      attachments: attachments.filter((item) => item.sectionId === sectionId)
    };
  });
  return {
    caseId: caseData.id,
    experimentCode: caseData.experiment_code || null,
    generation: state.draftGeneration || { status: 'idle', targetSectionIds: [], doneSectionIds: [], failedSectionIds: [] },
    interview: toParticipantView(state),
    answersLockedAt: state.answersLockedAt || null,
    submittedAt: state.submittedAt || null,
    /** 첫 기록일 (넣었으면). 화면이 상대 날짜를 실제 날짜로 바꿔 보여 준다 */
    dateAnchor: state.dateAnchor || null,
    relativeDates: Boolean(state.inputSource?.relativeDates),
    sections
  };
}

/** 원고 검사 (코드 검사, AI 호출 없음): 용량·날짜·시점·추측·부재·처방명·이상반응·환자 관점·남은 표시 */
router.get('/cases/:caseId/manuscript-check', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    const findings = checkManuscript({ caseData, state });
    return res.json({ checkedAt: new Date().toISOString(), findings });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || '원고를 검사하지 못했습니다.' });
  }
});

/** AI 원고 검사 (SW-V1 섹션별 기록·답 대조 + SW-V2 섹션 사이 비교). 고치지 않고 찾기만 한다 */
router.post('/cases/:caseId/manuscript-check/ai', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    const started = Date.now();
    const result = await runAiManuscriptCheck({ caseData, state });
    return res.json({ checkedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10, ...result });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'AI 검사를 하지 못했습니다.' });
  }
});

router.get('/cases/:caseId/drafts', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    const attachments = await listAttachments(caseData.id);
    return res.json(buildDraftsResponse(caseData, state, attachments));
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || '불러오지 못했습니다.' });
  }
});

/**
 * 전체(또는 지정 섹션) 초안 생성. 오래 걸리므로 바로 응답하고 뒤에서 돈다. 진행은
 * GET /drafts 의 generation 으로 본다. 섹션 하나가 끝날 때마다 저장한다.
 */
router.post('/cases/:caseId/drafts/generate', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const initial = normalizeStudyWriteState(caseData.studyWrite);
    if (initial.submittedAt) return res.status(400).json({ error: '이미 제출한 사례입니다.' });
    if (!isAnalysisReady(caseData)) return res.status(409).json({ error: '기록 분석이 아직 끝나지 않았습니다.' });
    if (initial.draftGeneration?.status === 'running') {
      const attachments = await listAttachments(caseData.id);
      return res.status(202).json(buildDraftsResponse(caseData, initial, attachments));
    }

    const requested: string[] = Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [];
    const targetSectionIds = requested.filter((id) => (CARE_SECTION_ORDER as readonly string[]).includes(id));
    const targets = targetSectionIds.length > 0 ? targetSectionIds : [...CARE_SECTION_ORDER];
    const source: 'answers' | 'answers_edited' = targetSectionIds.length > 0 ? 'answers_edited' : 'answers';

    const started = await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      const state = normalizeStudyWriteState(latest.studyWrite);
      const next: StudyWriteState = {
        ...state,
        interviewCompletedAt: state.interviewCompletedAt || new Date().toISOString(),
        firstGeneration: state.firstGeneration || (source === 'answers' ? { startedAt: new Date().toISOString() } : undefined),
        draftGeneration: {
          status: 'running',
          startedAt: new Date().toISOString(),
          targetSectionIds: targets,
          doneSectionIds: [],
          failedSectionIds: []
        },
        updatedAt: new Date().toISOString()
      };
      await saveState(latest.id, next);
      return next;
    });

    // 뒤에서 돈다. 응답은 먼저 보낸다.
    void (async () => {
      const finish = async (status: 'done' | 'failed', lastError?: string) =>
        serialize(req.params.caseId, async () => {
          const latest = await loadCase(req.params.caseId);
          const state = normalizeStudyWriteState(latest.studyWrite);
          const generation = state.draftGeneration!;
          const finishedAt = new Date().toISOString();
          await saveState(latest.id, {
            ...state,
            draftGeneration: { ...generation, status, finishedAt, lastError },
            firstGeneration:
              state.firstGeneration && !state.firstGeneration.finishedAt ? { ...state.firstGeneration, finishedAt } : state.firstGeneration,
            updatedAt: finishedAt
          });
        });
      try {
        await generateDrafts({
          caseData,
          state: started,
          sectionIds: targets,
          source,
          onSection: async (section) => {
            await serialize(req.params.caseId, async () => {
              const latest = await loadCase(req.params.caseId);
              const state = normalizeStudyWriteState(latest.studyWrite);
              const generation = state.draftGeneration!;
              await saveState(latest.id, {
                ...state,
                sections: { ...(state.sections || {}), [section.sectionId]: section },
                draftGeneration: { ...generation, doneSectionIds: [...generation.doneSectionIds, section.sectionId] },
                updatedAt: new Date().toISOString()
              });
            });
          },
          onError: async (sectionId, message) => {
            await serialize(req.params.caseId, async () => {
              const latest = await loadCase(req.params.caseId);
              const state = normalizeStudyWriteState(latest.studyWrite);
              const generation = state.draftGeneration!;
              await saveState(latest.id, {
                ...state,
                draftGeneration: { ...generation, failedSectionIds: [...generation.failedSectionIds, sectionId], lastError: message },
                updatedAt: new Date().toISOString()
              });
            });
          }
        });
        const latest = await loadCase(req.params.caseId);
        const failed = normalizeStudyWriteState(latest.studyWrite).draftGeneration?.failedSectionIds || [];
        await finish(failed.length === targets.length ? 'failed' : 'done');
      } catch (error: any) {
        console.error('[study-write] draft generation failed', error);
        await finish('failed', error?.message || 'failed');
      }
    })();

    const attachments = await listAttachments(caseData.id);
    return res.status(202).json(buildDraftsResponse(caseData, started, attachments));
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '초안을 만들지 못했습니다.' });
  }
});

/** 섹션 옆 채팅: 지시를 받아 그 섹션을 고쳐 쓰고 CARE 점검을 다시 한다. */
router.post('/cases/:caseId/sections/:sectionId/revise', async (req: Request, res: Response) => {
  try {
    // 직접 수정 뒤 "전체가 괜찮은지" 점검: 고친 내용은 지키고 나머지와 어긋나는 곳만 다듬는다
    const reviewAfterEdit = Boolean(req.body?.reviewAfterEdit);
    // 제목 섹션의 제목 또는 핵심 단어만 다시 만들기 (↻). 지시는 서버가 정하고, 다른 줄은 원래 글자 그대로 둔다
    const regeneratePart: TitlePart | null =
      req.body?.regeneratePart === 'title' || req.body?.regeneratePart === 'keywords' ? req.body.regeneratePart : null;
    if (regeneratePart && req.params.sectionId !== 'TITLE') return res.status(400).json({ error: '제목 섹션에서만 쓸 수 있습니다.' });
    // 수정 요청 채팅의 "질문 받기"에 대한 답: 질의응답에 저장하고 그 답으로 고쳐 쓴다
    const chatAnswer =
      req.body?.chatAnswer && typeof req.body.chatAnswer.entryId === 'string'
        ? { entryId: String(req.body.chatAnswer.entryId), answer: String(req.body.chatAnswer.answer || '').trim().slice(0, 3000) }
        : null;
    if (chatAnswer && !chatAnswer.answer) return res.status(400).json({ error: '답을 적어 주세요.' });
    const instruction = reviewAfterEdit
      ? '임상의가 이 섹션을 직접 고쳤다. [직접 수정 전 초안]과 [현재 초안]을 비교해 임상의가 바꾼 곳(추가·삭제·수정)을 찾는다. 임상의가 바꾼 내용은 임상의가 넣은 사실로 보고 그대로 둔다. 기록에 없는 내용이어도 지우거나 되돌리지 않는다(기록에 없는 새 사실이면 그 문장 끝에 "[기록 외 내용: 직접 수정]"만 붙인다). 그 변경 때문에 나머지 문장과 어긋나게 된 곳(같은 내용의 중복, 앞뒤 모순, 용어·시제·표기 불일치, 끊긴 흐름)만 최소한으로 다듬는다. 새 사실을 더하지 않는다. 어긋나는 곳이 없으면 초안을 한 글자도 바꾸지 않고 changeSummary 에 "직접 고친 내용과 나머지가 어긋나는 곳이 없어 그대로 두었다"고 쓴다. 바꿨으면 무엇을 바꿨는지 구체적으로 쓴다.'
      : regeneratePart || chatAnswer
        ? '' // 아래에서 현재 초안·질문을 보고 정한다
        : String(req.body?.instruction || '').trim();
    if (!instruction && !regeneratePart && !chatAnswer) return res.status(400).json({ error: '지시를 적어 주세요.' });
    // 초안에서 드래그한 부분 (선택). 너무 길면 자른다
    let selectedText = reviewAfterEdit || regeneratePart || chatAnswer ? undefined : String(req.body?.selectedText || '').trim().slice(0, 2000) || undefined;
    const { caseId, sectionId } = req.params;
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });

    const caseData = await loadCase(caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    if (state.submittedAt) return res.status(400).json({ error: '이미 제출한 사례입니다.' });
    const section = state.sections?.[sectionId];
    if (!section || !section.draftText) return res.status(400).json({ error: '이 섹션의 초안이 아직 없습니다.' });
    let effectiveInstruction = instruction;
    const askedEntry = chatAnswer ? section.chat.find((entry) => entry.id === chatAnswer.entryId && entry.kind === 'question') : undefined;
    if (chatAnswer) {
      if (!askedEntry) return res.status(400).json({ error: '답할 질문을 찾지 못했습니다.' });
      if (askedEntry.answeredAt) return res.status(400).json({ error: '이미 답한 질문입니다.' });
      if (askedEntry.skippedAt) return res.status(400).json({ error: '건너뛴 질문입니다. 질문을 다시 받아 주세요.' });
      if (state.answersLockedAt) return res.status(400).json({ error: '최종 수정 단계에 들어가 답을 더할 수 없습니다.' });
      effectiveInstruction = `임상의에게 이 섹션을 더 자세히 쓰기 위해 "${askedEntry.text}"라고 물었고, 임상의가 이렇게 답했다: "${chatAnswer.answer}". 이 답에 담긴 사실을 이 섹션의 알맞은 자리에 반영한다. 답 가운데 "모른다", "적지 않았다", "기록하지 않았다"처럼 정보가 없다는 부분은 본문에 쓰지 않는다(부재 문장 금지). 답에 없는 내용은 더하지 않고, 답과 무관한 문장은 글자 그대로 둔다. 반영할 사실이 없으면 초안을 바꾸지 않는다.`;
    }
    if (regeneratePart) {
      const parsed = parseTitleDraft(section.draftText);
      // 같은 것이 다시 나오지 않게 지금까지 나온 제목·핵심 단어를 함께 준다
      const earlier = [...new Set(section.history.map((item) => parseTitleDraft(item.text)).map((item) => (regeneratePart === 'title' ? item.title : item.keywords.join(', '))).filter(Boolean))].slice(-6);
      if (regeneratePart === 'title') {
        selectedText = parsed.titleIndex >= 0 ? parsed.lines[parsed.titleIndex] : undefined;
        effectiveInstruction = `제목만 새로 쓴다. 쓰기 규칙(국내 한의 증례보고 제목 형식, 진단 또는 주소·주된 치료·대상, 인과를 단정하지 않음)을 지키고, 지금까지 나온 제목과 다른 표현으로 쓴다. 핵심 단어 줄은 그대로 둔다. 지금까지 나온 제목: ${earlier.map((item) => `"${item}"`).join(', ') || '(없음)'}`;
      } else {
        selectedText = parsed.keywordsIndex >= 0 ? parsed.lines[parsed.keywordsIndex] : undefined;
        effectiveInstruction = `핵심 단어만 새로 고른다. "핵심 단어: …" 한 줄로, 3~5개를 쉼표로 나누고 그중 하나는 "증례보고"로 한다. 기록과 초안에 나온 진단·변증·처방·증상에서 고른다. 지금까지와 다른 조합으로 고른다. 제목 줄은 그대로 둔다. 지금까지 나온 핵심 단어: ${earlier.map((item) => `"${item}"`).join(' / ') || '(없음)'}`;
      }
    }

    // 전체 점검에는 마지막 AI 판(직접 수정 전)을 함께 준다. 직접 고친 곳을 모델이 알아보게
    const previousDraft = reviewAfterEdit
      ? [...section.history].reverse().find((item) => item.source !== 'manual' && item.text !== section.draftText)?.text
      : undefined;
    const revised = await runRevise({ caseData, state, section, instruction: effectiveInstruction, selectedText, previousDraft });
    // 제목·핵심 단어 다시 만들기: 바꾸려던 줄만 가져오고 나머지는 원래 초안 그대로
    if (regeneratePart) revised.draftText = mergeRegeneratedPart(section.draftText, revised.draftText, regeneratePart);
    const changed = revised.draftText.trim() !== section.draftText.trim();
    const careCheck = changed ? await runCareCheck({ caseData, state, sectionId, draftText: revised.draftText }) : section.careCheck;

    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      const loadedState = normalizeStudyWriteState(latest.studyWrite);
      // 질문 받기의 답은 질의응답(care_check 회차)에 질문과 함께 남긴다. 나중에 다시 쓸 때도 쓰인다
      const latestState =
        chatAnswer && askedEntry
          ? addCareInfoAnswer(loadedState, {
              sectionId,
              code: askedEntry.targetCode || '',
              label: '',
              required: Boolean(askedEntry.targetCode && careTargetDef(sectionId, askedEntry.targetCode)?.required),
              answer: chatAnswer.answer,
              question: askedEntry.text,
              chatEntryId: askedEntry.id
            })
          : loadedState;
      const current = latestState.sections?.[sectionId] || section;
      const now = new Date().toISOString();
      const version = changed ? current.version + 1 : current.version;
      const next: StudyWriteSectionState = {
        ...current,
        draftText: changed ? revised.draftText : current.draftText,
        version,
        history: changed
          ? [
              ...current.history,
              {
                version,
                text: revised.draftText,
                source: 'revise',
                at: now,
                model: revised.model,
                promptVersion: STUDY_WRITE_REVISE_PROMPT_VERSION,
                // 라벨만으로는 문구가 바뀐 것을 알 수 없어 템플릿 해시를 함께 남긴다 (참가자별 프롬프트 복원용)
                promptTemplateHash: promptMeta('SW_R').promptTemplateHash,
                instruction: effectiveInstruction,
                changeSummary: revised.changeSummary,
                outOfRecordClaims: revised.outOfRecordClaims
              }
            ]
          : current.history,
        chat: [
          ...current.chat.map((entry) => (askedEntry && entry.id === askedEntry.id ? { ...entry, answeredAt: now } : entry)),
          {
            id: `swc-${randomUUID()}`,
            role: 'user',
            // 드래그로 고른 부분이 있으면 채팅에 함께 남긴다. 전체 점검은 짧은 표시로
            text: reviewAfterEdit
              ? '[직접 수정 후 전체 점검] 고친 내용은 지키고, 나머지와 어긋나는 곳만 다듬어 줘.'
              : chatAnswer
                ? chatAnswer.answer
                : regeneratePart
                  ? regeneratePart === 'title'
                    ? '[제목 다시 만들기]'
                    : '[핵심 단어 다시 고르기]'
                  : selectedText
                ? `「${selectedText.length > 80 ? `${selectedText.slice(0, 80)}…` : selectedText}」 ${instruction}`
                : instruction,
            at: now
          },
          {
            id: `swc-${randomUUID()}`,
            role: 'assistant',
            // 본문이 그대로면 모델이 "삭제했다"고 써도 믿지 않고, 안 바꾼 이유를 구체적으로 알린다
            text: changed
              ? revised.changeSummary
              : `초안을 바꾸지 않았습니다. ${
                  revised.noChangeReason ||
                  (/바꾸지 않|변경하지 않|수정하지 않/.test(revised.changeSummary) ? revised.changeSummary : '') ||
                  '지시에 해당하는 내용이 이 섹션에 없거나 이미 반영되어 있습니다. 다른 섹션의 내용이면 그 섹션에서 요청해 주세요.'
                }`,
            at: now,
            resultVersion: changed ? version : undefined
          }
        ],
        careCheck
      };
      const merged: StudyWriteState = {
        ...latestState,
        sections: { ...(latestState.sections || {}), [sectionId]: next },
        updatedAt: now
      };
      await saveState(latest.id, merged);
      const attachments = await listAttachments(latest.id);
      return buildDraftsResponse(latest, merged, attachments);
    });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '고치지 못했습니다.' });
  }
});

/** 직접 편집한 본문 저장 (⑦ 최종 수정에서 쓴다). */
router.put('/cases/:caseId/sections/:sectionId/draft', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    const draftText = String(req.body?.draftText ?? '');
    // 초안 화면의 직접 수정은 CARE 점검도 다시 돌린다 (최종 화면의 자동 저장은 요청하지 않음)
    const recheckCare = Boolean(req.body?.recheckCare);
    const before = await loadCase(caseId);
    if (!before) return res.status(404).json({ error: 'Case not found' });
    const beforeState = normalizeStudyWriteState(before.studyWrite);
    const beforeSection = beforeState.sections?.[sectionId];
    const careCheck =
      recheckCare && draftText.trim() && beforeSection && beforeSection.draftText !== draftText
        ? await runCareCheck({ caseData: before, state: beforeState, sectionId, draftText })
        : null;
    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      if (state.submittedAt) throw new Error('이미 제출한 사례입니다.');
      const current = state.sections?.[sectionId] || emptySectionState(sectionId);
      if (current.draftText === draftText) {
        return buildDraftsResponse(latest, state, await listAttachments(latest.id));
      }
      const now = new Date().toISOString();
      const next: StudyWriteSectionState = {
        ...current,
        draftText,
        version: current.version + 1,
        history: [...current.history, { version: current.version + 1, text: draftText, source: 'manual', at: now }],
        ...(careCheck ? { careCheck } : {})
      };
      const merged: StudyWriteState = { ...state, sections: { ...(state.sections || {}), [sectionId]: next }, updatedAt: now };
      await saveState(latest.id, merged);
      return buildDraftsResponse(latest, merged, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '저장하지 못했습니다.' });
  }
});

/**
 * 초안은 그대로 두고 CARE 점검만 다시 돌린다. 하위 요소(체크리스트 v2)가 생기기 전에 점검한 섹션을
 * 새 기준으로 보거나, 판정 없음 항목을 다시 판정할 때 쓴다. 초안 버전은 바뀌지 않는다.
 */
router.post('/cases/:caseId/sections/:sectionId/care-check', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });
    const before = await loadCase(caseId);
    if (!before) return res.status(404).json({ error: 'Case not found' });
    const beforeState = normalizeStudyWriteState(before.studyWrite);
    if (beforeState.submittedAt) return res.status(400).json({ error: '이미 제출한 사례입니다.' });
    const draftText = beforeState.sections?.[sectionId]?.draftText || '';
    if (!draftText.trim()) return res.status(400).json({ error: '점검할 초안이 없습니다.' });
    const careCheck = await runCareCheck({ caseData: before, state: beforeState, sectionId, draftText });
    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      const current = state.sections?.[sectionId];
      // 점검하는 사이 초안이 바뀌었으면 저장하지 않는다 (옛 초안의 판정이 된다)
      if (!current || current.draftText !== draftText) {
        throw new Error('점검하는 사이 초안이 바뀌었습니다. 다시 점검해 주세요.');
      }
      const now = new Date().toISOString();
      const merged: StudyWriteState = {
        ...state,
        sections: { ...(state.sections || {}), [sectionId]: { ...current, careCheck } },
        updatedAt: now
      };
      await saveState(latest.id, merged);
      return buildDraftsResponse(latest, merged, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '점검하지 못했습니다.' });
  }
});

// ---------------------------------------------------------------------------
// 표·그림 첨부

const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

router.post('/cases/:caseId/sections/:sectionId/attachments', attachmentUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
    const caseData = await loadCase(caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    if (state.submittedAt) return res.status(400).json({ error: '이미 제출한 사례입니다.' });
    const created = await createAttachment({
      caseId,
      sectionId,
      fileName: req.file.originalname || 'file',
      mimeType: req.file.mimetype || '',
      buffer: req.file.buffer,
      caption: typeof req.body?.caption === 'string' ? req.body.caption : ''
    });
    await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      const latestState = normalizeStudyWriteState(latest.studyWrite);
      const current = latestState.sections?.[sectionId] || emptySectionState(sectionId);
      await saveState(latest.id, {
        ...latestState,
        sections: { ...(latestState.sections || {}), [sectionId]: { ...current, attachmentIds: [...current.attachmentIds, created.id] } },
        updatedAt: new Date().toISOString()
      });
    });
    return res.json(created);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '올리지 못했습니다.' });
  }
});

router.get('/cases/:caseId/attachments/:attachmentId/file', async (req: Request, res: Response) => {
  const file = await getAttachmentFile(req.params.caseId, req.params.attachmentId);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(file.data);
});

router.put('/cases/:caseId/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const updated = await updateAttachmentCaption(req.params.caseId, req.params.attachmentId, String(req.body?.caption || ''));
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '저장하지 못했습니다.' });
  }
});

router.delete('/cases/:caseId/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const { caseId, attachmentId } = req.params;
    const removed = await deleteAttachment(caseId, attachmentId);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      const state = normalizeStudyWriteState(latest.studyWrite);
      const sections = Object.fromEntries(
        Object.entries(state.sections || {}).map(([id, section]) => [
          id,
          { ...section, attachmentIds: section.attachmentIds.filter((item) => item !== attachmentId) }
        ])
      );
      await saveState(latest.id, { ...state, sections, updatedAt: new Date().toISOString() });
    });
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '지우지 못했습니다.' });
  }
});

// ---------------------------------------------------------------------------
// ⑦ 최종 수정 (답 잠금) · 제출 · ⑧ Word

/** 최종 수정에 들어간다. 이때부터 질의응답 답은 고칠 수 없다 (직접 편집한 글이 덮이지 않게). */
/**
 * CARE 점검에서 "기록에 없음"인 항목에 사용자가 정보를 직접 넣는다. 저장만 하고, 섹션 재생성은
 * 화면이 /drafts/generate 로 따로 요청한다.
 */
/** CARE 점검의 "없음" 항목을 쓰기 위한 질문을 만든다 (SW-Q3). 저장하지 않는다. */
/**
 * CARE 점검에서 "이 정보 입력하기"의 대상: 항목(예: "9b") 또는 하위 요소(예: "9b-H4", 체크리스트 v2).
 * 하위 요소면 항목 번호·묶음·기준을 붙인 설명을 질문 체인에 넘긴다.
 */
function careTargetDef(sectionId: string, code: string): { label: string; required: boolean } | null {
  const item = (CARE_ITEMS_BY_SECTION[sectionId] || []).find((entry) => entry.code === code);
  if (item) return { label: item.label, required: item.required };
  const sub = findSubElement(sectionId, code);
  if (!sub) return null;
  const group = sub.groupLabel ? `${sub.groupLabel} ` : '';
  const condition = sub.condition ? ` (조건: ${sub.condition})` : '';
  return { label: `${sub.itemCode} ${group}하위 요소 "${sub.label}": ${sub.criterion}${condition}`, required: sub.required };
}

/**
 * 수정 요청 채팅의 "질문 받기" (SW-Q4): 이 섹션을 더 자세히 쓰기 위한 질문 하나를 만들어 채팅에 AI 질문으로 남긴다.
 * 답은 revise 의 chatAnswer 로 받는다.
 */
router.post('/cases/:caseId/sections/:sectionId/chat-question', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });
    const caseData = await loadCase(caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    if (state.submittedAt || state.answersLockedAt) return res.status(400).json({ error: '최종 수정 단계에서는 질문을 받을 수 없습니다.' });
    const sectionBefore = state.sections?.[sectionId];
    if (!sectionBefore?.draftText) return res.status(400).json({ error: '이 섹션의 초안이 아직 없습니다.' });
    // 빠진 CARE 항목을 알아야 질문을 고를 수 있다. 점검이 없거나 하위 요소 기준 전 결과면 먼저 다시 점검한다
    const freshCheck =
      sectionBefore.careCheck?.checklistVersion === 'care-checklist:v2' || CHAT_QUESTION_SUMMARY_SECTIONS.has(sectionId)
        ? null
        : await runCareCheck({ caseData, state, sectionId, draftText: sectionBefore.draftText });
    const stateForQuestion: StudyWriteState = freshCheck
      ? { ...state, sections: { ...(state.sections || {}), [sectionId]: { ...sectionBefore, careCheck: freshCheck } } }
      : state;
    const generated = await generateSectionChatQuestion({ caseData, state: stateForQuestion, sectionId });
    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      if (!latest) return null;
      const latestState = normalizeStudyWriteState(latest.studyWrite);
      const current = latestState.sections?.[sectionId];
      if (!current) throw new Error('이 섹션의 초안이 아직 없습니다.');
      const now = new Date().toISOString();
      const entry: StudyWriteChatEntry =
        generated.kind === 'question'
          ? {
              id: `swc-${randomUUID()}`,
              role: 'assistant',
              text: generated.question,
              at: now,
              kind: 'question',
              hint: generated.hint,
              targetCode: generated.targetCode,
              reason: generated.reason
            }
          : { id: `swc-${randomUUID()}`, role: 'assistant', text: generated.message, at: now };
      const merged: StudyWriteState = {
        ...latestState,
        sections: {
          ...(latestState.sections || {}),
          [sectionId]: {
            ...current,
            chat: [...current.chat, entry],
            // 점검하는 사이 초안이 바뀌지 않았을 때만 새 점검 결과를 남긴다
            ...(freshCheck && current.draftText === sectionBefore.draftText ? { careCheck: freshCheck } : {})
          }
        },
        updatedAt: now
      };
      await saveState(latest.id, merged);
      return buildDraftsResponse(latest, merged, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '질문을 만들지 못했습니다.' });
  }
});

/** "질문 받기"의 질문을 건너뛴다. 건너뛴 질문은 답을 기다리지 않고, 다시 묻지 않는다 */
router.post('/cases/:caseId/sections/:sectionId/chat-question/:entryId/skip', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId, entryId } = req.params;
    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      if (state.submittedAt) throw new Error('이미 제출한 사례입니다.');
      const current = state.sections?.[sectionId];
      const entry = current?.chat.find((item) => item.id === entryId && item.kind === 'question');
      if (!current || !entry) throw new Error('건너뛸 질문을 찾지 못했습니다.');
      if (entry.answeredAt || entry.skippedAt) return buildDraftsResponse(latest, state, await listAttachments(latest.id));
      const now = new Date().toISOString();
      const merged: StudyWriteState = {
        ...state,
        sections: {
          ...(state.sections || {}),
          [sectionId]: { ...current, chat: current.chat.map((item) => (item.id === entryId ? { ...item, skippedAt: now } : item)) }
        },
        updatedAt: now
      };
      await saveState(latest.id, merged);
      return buildDraftsResponse(latest, merged, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '건너뛰지 못했습니다.' });
  }
});

router.post('/cases/:caseId/sections/:sectionId/care-question', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    const code = String(req.body?.code || '').trim();
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });
    const def = careTargetDef(sectionId, code);
    if (!def) return res.status(400).json({ error: '알 수 없는 CARE 항목입니다.' });
    const caseData = await loadCase(caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    if (state.submittedAt || state.answersLockedAt) return res.status(400).json({ error: '이미 답 수정이 잠긴 사례입니다.' });
    const result = await generateCareItemQuestion({
      caseData,
      state,
      sectionId,
      sectionName: CARE_SECTION_NAMES[sectionId] || sectionId,
      code,
      label: def.label,
      required: def.required
    });
    return res.json({ code, ...result });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '질문을 만들지 못했습니다.' });
  }
});

router.post('/cases/:caseId/sections/:sectionId/care-info', async (req: Request, res: Response) => {
  try {
    const { caseId, sectionId } = req.params;
    const code = String(req.body?.code || '').trim();
    const answer = String(req.body?.answer || '');
    const question = typeof req.body?.question === 'string' ? req.body.question : undefined;
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });
    const def = careTargetDef(sectionId, code);
    if (!def) return res.status(400).json({ error: '알 수 없는 CARE 항목입니다.' });
    const result = await serialize(caseId, async () => {
      const caseData = await loadCase(caseId);
      if (!caseData) return null;
      const state = normalizeStudyWriteState(caseData.studyWrite);
      if (state.submittedAt) throw new Error('이미 제출한 사례입니다.');
      const next = addCareInfoAnswer(state, { sectionId, code, label: def.label, required: def.required, answer, question });
      await saveState(caseData.id, next);
      return buildDraftsResponse(caseData, next, await listAttachments(caseData.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '저장하지 못했습니다.' });
  }
});

/**
 * 첫 기록일을 넣거나(date: 'YYYY-MM-DD') 지운다(date: null). 보여 주는 방식만 바꾸므로 제출 뒤에도 된다.
 */
router.put('/cases/:caseId/date-anchor', async (req: Request, res: Response) => {
  try {
    const rawDate = req.body?.date;
    const format = req.body?.format === 'ko' ? 'ko' : 'iso';
    if (rawDate !== null && parseAnchorDate(String(rawDate || '')) === null) {
      return res.status(400).json({ error: '날짜를 YYYY-MM-DD 형식으로 넣어 주세요.' });
    }
    const result = await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      const now = new Date().toISOString();
      const next: StudyWriteState = {
        ...state,
        dateAnchor: rawDate === null ? null : { date: String(rawDate), format, setAt: now },
        updatedAt: now
      };
      await saveState(latest.id, next);
      return buildDraftsResponse(latest, next, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '저장하지 못했습니다.' });
  }
});

router.post('/cases/:caseId/lock-answers', async (req: Request, res: Response) => {
  try {
    const result = await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      const next: StudyWriteState = state.answersLockedAt
        ? state
        : { ...state, answersLockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (next !== state) await saveState(latest.id, next);
      return buildDraftsResponse(latest, next, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '잠그지 못했습니다.' });
  }
});

router.post('/cases/:caseId/submit', async (req: Request, res: Response) => {
  try {
    const result = await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      if (!latest) return null;
      const state = normalizeStudyWriteState(latest.studyWrite);
      const now = new Date().toISOString();
      const next: StudyWriteState = state.submittedAt
        ? state
        : { ...state, answersLockedAt: state.answersLockedAt || now, submittedAt: now, updatedAt: now };
      if (next !== state) {
        await saveState(latest.id, next);
        await caseModel.updateCase(latest.id, { sessionOutcome: { status: 'completed' } } as any);
      }
      return buildDraftsResponse(latest, next, await listAttachments(latest.id));
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '제출하지 못했습니다.' });
  }
});

router.get('/cases/:caseId/manuscript.docx', async (req: Request, res: Response) => {
  try {
    const caseData = await loadCase(req.params.caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    const attachments = await listAttachments(caseData.id);
    const buffer = await buildStudyWriteManuscriptDocx({
      caseId: caseData.id,
      experimentCode: caseData.experiment_code,
      state,
      attachments
    });
    // 내보낸 기록을 남긴다 (연구용 내보내기의 exportLogs 와 같은 자리).
    await serialize(req.params.caseId, async () => {
      const latest = await loadCase(req.params.caseId);
      const logs = Array.isArray(latest.exportLogs) ? latest.exportLogs : [];
      await caseModel.updateCase(latest.id, {
        exportLogs: [
          ...logs,
          { exportId: `export_${Date.now()}`, requestedAt: new Date().toISOString(), mode: 'study_write_manuscript', layout: 'sections', succeeded: true, fileName: 'case-report_study-write.docx' }
        ]
      } as any);
    });
    const fileName = `증례보고_초안_${caseData.experiment_code || caseData.id}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', buildContentDispositionHeader(fileName));
    return res.send(buffer);
  } catch (error: any) {
    console.error('[study-write] docx export failed', error);
    return res.status(500).json({ error: error?.message || 'Word 파일을 만들지 못했습니다.' });
  }
});

export default router;
