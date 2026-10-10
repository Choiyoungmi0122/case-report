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
import { StudyWriteSectionState, StudyWriteState } from '../types/studyWrite';
import { emptySectionState, generateDrafts, runCareCheck, runRevise, STUDY_WRITE_REVISE_PROMPT_VERSION } from '../studyWrite/drafting';
import { CARE_SECTION_NAMES, CARE_SECTION_ORDER } from '../studyWrite/careItems';
import {
  createAttachment,
  deleteAttachment,
  getAttachmentFile,
  listAttachments,
  updateAttachmentCaption
} from '../studyWrite/attachments';
import { randomUUID } from 'crypto';
import { buildStudyWriteManuscriptDocx } from '../studyWrite/manuscriptDocx';
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
    sections
  };
}

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
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) return res.status(400).json({ error: '지시를 적어 주세요.' });
    const { caseId, sectionId } = req.params;
    if (!(CARE_SECTION_ORDER as readonly string[]).includes(sectionId)) return res.status(400).json({ error: '알 수 없는 섹션입니다.' });

    const caseData = await loadCase(caseId);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    const state = normalizeStudyWriteState(caseData.studyWrite);
    if (state.submittedAt) return res.status(400).json({ error: '이미 제출한 사례입니다.' });
    const section = state.sections?.[sectionId];
    if (!section || !section.draftText) return res.status(400).json({ error: '이 섹션의 초안이 아직 없습니다.' });

    const revised = await runRevise({ caseData, state, section, instruction });
    const changed = revised.draftText.trim() !== section.draftText.trim();
    const careCheck = changed ? await runCareCheck({ caseData, state, sectionId, draftText: revised.draftText }) : section.careCheck;

    const result = await serialize(caseId, async () => {
      const latest = await loadCase(caseId);
      const latestState = normalizeStudyWriteState(latest.studyWrite);
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
                instruction,
                changeSummary: revised.changeSummary,
                outOfRecordClaims: revised.outOfRecordClaims
              }
            ]
          : current.history,
        chat: [
          ...current.chat,
          { id: `swc-${randomUUID()}`, role: 'user', text: instruction, at: now },
          {
            id: `swc-${randomUUID()}`,
            role: 'assistant',
            text: changed ? revised.changeSummary : `${revised.changeSummary} (초안은 바뀌지 않았습니다)`,
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
        history: [...current.history, { version: current.version + 1, text: draftText, source: 'manual', at: now }]
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
