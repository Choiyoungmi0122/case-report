import express, { Request, Response } from 'express';
import multer from 'multer';
import { CaseModel } from '../models/caseModel';
import { inspectRecordFile, MAX_FILE_BYTES } from '../studyWrite/recordImport';
import {
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
import { StudyWriteState } from '../types/studyWrite';

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
// 질의응답(인터뷰)

async function loadCase(caseId: string) {
  const caseData: any = await caseModel.getCase(caseId);
  if (!caseData) return null;
  return caseData;
}

async function saveState(caseId: string, state: StudyWriteState) {
  await caseModel.updateCase(caseId, { studyWrite: state } as any);
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
      const caseData = await loadCase(req.params.caseId);
      if (!caseData) return null;
      let state = normalizeStudyWriteState(caseData.studyWrite || createInitialStudyWriteState(req.body?.inputSource));
      if (req.body?.inputSource && !state.inputSource) state = { ...state, inputSource: req.body.inputSource };
      state = startInterview(state);
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
    const { questionId, answer, skipped } = req.body || {};
    if (!questionId) return res.status(400).json({ error: 'questionId is required' });
    const result = await serialize(req.params.caseId, async () => {
      const caseData = await loadCase(req.params.caseId);
      if (!caseData) return null;
      const state = answerQuestion(normalizeStudyWriteState(caseData.studyWrite), String(questionId), {
        answer: typeof answer === 'string' ? answer : '',
        skipped: Boolean(skipped)
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
      const merged: StudyWriteState = generated.round
        ? { ...latestState, rounds: [...latestState.rounds, generated.round], updatedAt: new Date().toISOString() }
        : finishInterview(latestState);
      await saveState(latest.id, merged);
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
      const state = finishInterview(normalizeStudyWriteState(caseData.studyWrite));
      await saveState(caseData.id, state);
      return buildInterviewResponse(caseData, state);
    });
    if (!result) return res.status(404).json({ error: 'Case not found' });
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '끝내지 못했습니다.' });
  }
});

export default router;
