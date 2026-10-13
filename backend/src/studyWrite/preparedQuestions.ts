import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PreparedQuestionSet } from './interview';

/**
 * 프리셋 EMR 로 실험 전에 미리 만든 기록 빈칸 질문 (2026-10-13).
 *
 * - scripts/prepareStudyWriteQuestions.ts 가 프리셋을 한 번 분석하고 SW-Q2 로 질문 2~4개를 만들어
 *   backend/data/study-write-prepared/<presetId>.json 에 둔다 (data/ 는 git 에 올라가지 않음).
 * - 질의응답을 시작할 때 사례의 방문 기록이 준비할 때와 같으면(지문 비교) 그 질문을 고정 질문 뒤에 붙여 한 회차로 묻는다.
 *   프리셋을 고쳤거나 참여자가 기록을 바꿨으면 지문이 달라 쓰지 않고, 기존 방식(2·3회차 생성)으로 돌아간다.
 */

export const PREPARED_DIR = path.resolve(__dirname, '../../data/study-write-prepared');

/** 방문 기록 지문: 순서, 구분(초진/재진), 본문. 날짜는 상대 날짜 프리셋에서 기준일에 따라 바뀌므로 넣지 않는다. */
export function visitsFingerprint(visits: any[]): string {
  const canonical = (Array.isArray(visits) ? visits : []).map((visit) => [
    String(visit?.type || ''),
    String(visit?.soapText ?? visit?.text ?? '').replace(/\r\n/g, '\n').trim()
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

function fileFor(presetId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(presetId)) throw new Error(`invalid presetId: ${presetId}`);
  return path.join(PREPARED_DIR, `${presetId}.json`);
}

export function loadPreparedQuestions(presetId: string): PreparedQuestionSet | null {
  try {
    const file = fileFor(presetId);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.questions) || typeof parsed.visitsFingerprint !== 'string') return null;
    return parsed as PreparedQuestionSet;
  } catch (error) {
    console.error(`[studyWrite] prepared questions for ${presetId} unreadable`, error);
    return null;
  }
}

export function savePreparedQuestions(set: PreparedQuestionSet): string {
  fs.mkdirSync(PREPARED_DIR, { recursive: true });
  const file = fileFor(set.presetId);
  fs.writeFileSync(file, `${JSON.stringify(set, null, 2)}\n`, 'utf8');
  return file;
}

/** 이 사례에 쓸 수 있는 미리 만든 질문. 프리셋으로 시작했고 기록이 준비 때와 같을 때만 돌려준다. */
export function preparedQuestionsForCase(caseData: any, presetId: string | undefined): PreparedQuestionSet | null {
  if (!presetId) return null;
  const prepared = loadPreparedQuestions(presetId);
  if (!prepared) return null;
  const fingerprint = visitsFingerprint(caseData?.visits || []);
  if (fingerprint !== prepared.visitsFingerprint) {
    console.warn(
      `[studyWrite] prepared questions for ${presetId} skipped: visits changed (${fingerprint} != ${prepared.visitsFingerprint})`
    );
    return null;
  }
  return prepared;
}
