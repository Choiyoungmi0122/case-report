import fs from 'fs';
import path from 'path';
import { promptFingerprint, PromptKey } from '../llm/promptRegistry';
import { visitsFingerprint } from './preparedQuestions';

/**
 * 프리셋 EMR 기록 분석을 실험 전에 미리 돌려 둔 결과 (2026-10-13, 연구자 결정).
 *
 * - 참여자가 고정 질문 3개에 답한 뒤 분석(1~4분)을 기다리지 않게 한다. 질문은 그대로 실시간이다:
 *   2·3회차 질문은 참여자 답과 이 분석 결과로 그때 만든다(SW-Q2 v4, S01 과 같다).
 * - scripts/prepareStudyWriteAnalysis.ts 가 같은 파이프라인(CHAIN1~5)으로 분석한 준비용 사례에서 분석 결과 필드만 떠
 *   backend/data/study-write-analysis/<presetId>.json 에 둔다 (data/ 는 git 에 올라가지 않음).
 * - 질의응답을 처음 시작할 때, 방문 기록 지문과 분석 체인(CHAIN1~5)의 프롬프트 지문이 지금과 같을 때만 복사한다.
 *   하나라도 다르면 쓰지 않고 지금처럼 그 자리에서 분석한다.
 * - S01(가상환자)·S02(임교수님)가 쓴 프리셋은 만들지 않는다 (그 사례들은 실시간 분석으로 진행됐다).
 * - 끄려면 STUDY_WRITE_PREPARED_ANALYSIS=0.
 */

export const ANALYSIS_DIR = path.resolve(__dirname, '../../data/study-write-analysis');

/** /process(reprocessCaseFromStoredTerms)가 채우는 분석 결과 필드. 참여자·연구 기록 필드는 넣지 않는다. */
export const ANALYSIS_FIELDS = [
  'deidentifiedEMRs',
  'pendingTermConfirmations',
  'reviewRequired',
  'staleState',
  'processingCache',
  'chainCache',
  'chainProgress',
  'evidenceCards',
  'sectionEvidenceMap',
  'sectionStatusMap',
  'draftsBySection',
  'sectionStates',
  'commonMissingItems',
  'commonQuestionSets',
  'sectionDrafts',
  'sectionAdequacyReviews',
  'timelineEvents',
  'finalComposeStatus'
] as const;

const ANALYSIS_CHAINS: PromptKey[] = ['CHAIN1', 'CHAIN2', 'CHAIN3', 'CHAIN4', 'CHAIN5'];

export interface PreparedAnalysis {
  presetId: string;
  /** 분석을 돌린 준비용 사례 (cases 컬렉션, 제목 "[사전 준비] …") */
  sourceCaseId: string;
  sourceExperimentCode: string;
  visitsFingerprint: string;
  /** 분석 체인별 프롬프트 지문 (버전|템플릿 해시|모델). 지금과 다르면 쓰지 않는다 */
  chainFingerprints: Record<string, string>;
  createdAt: string;
  fields: Partial<Record<(typeof ANALYSIS_FIELDS)[number], unknown>>;
}

export function currentChainFingerprints(): Record<string, string> {
  return Object.fromEntries(ANALYSIS_CHAINS.map((key) => [key, promptFingerprint(key)]));
}

function fileFor(presetId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(presetId)) throw new Error(`invalid presetId: ${presetId}`);
  return path.join(ANALYSIS_DIR, `${presetId}.json`);
}

/**
 * 분석이 끝난 사례 문서(원본 그대로, lean)에서 스냅샷을 만든다. 사례의 chainCache 에 남은 프롬프트 지문이
 * 지금 지문과 다르면(옛 프롬프트로 분석한 사례) 만들지 않는다.
 */
export function buildPreparedAnalysis(presetId: string, doc: any): PreparedAnalysis {
  const current = currentChainFingerprints();
  for (const key of ANALYSIS_CHAINS) {
    const recorded = doc?.chainCache?.[key]?.promptFingerprint;
    if (recorded !== current[key]) {
      throw new Error(`${doc?.id} 의 ${key} 프롬프트 지문이 지금과 다릅니다 (${recorded} != ${current[key]}). 분석을 새로 돌리세요.`);
    }
  }
  const fields: PreparedAnalysis['fields'] = {};
  for (const field of ANALYSIS_FIELDS) if (doc[field] !== undefined) fields[field] = doc[field];
  return {
    presetId,
    sourceCaseId: doc.id,
    sourceExperimentCode: doc.experiment_code,
    visitsFingerprint: visitsFingerprint(doc.visits || []),
    chainFingerprints: current,
    createdAt: new Date().toISOString(),
    fields
  };
}

export function savePreparedAnalysis(snapshot: PreparedAnalysis): string {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  const file = fileFor(snapshot.presetId);
  fs.writeFileSync(file, JSON.stringify(snapshot), 'utf8');
  return file;
}

export function loadPreparedAnalysis(presetId: string): PreparedAnalysis | null {
  try {
    const file = fileFor(presetId);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && parsed.fields && typeof parsed.visitsFingerprint === 'string' ? (parsed as PreparedAnalysis) : null;
  } catch (error) {
    console.error(`[studyWrite] prepared analysis for ${presetId} unreadable`, error);
    return null;
  }
}

/** 이 사례에 복사할 수 있는 미리 돌린 분석. 꺼져 있거나, 기록·프롬프트가 다르면 null (그 자리에서 분석한다). */
export function preparedAnalysisForCase(caseData: any, presetId: string | undefined): PreparedAnalysis | null {
  if (process.env.STUDY_WRITE_PREPARED_ANALYSIS === '0' || !presetId) return null;
  const snapshot = loadPreparedAnalysis(presetId);
  if (!snapshot) return null;
  const fingerprint = visitsFingerprint(caseData?.visits || []);
  if (fingerprint !== snapshot.visitsFingerprint) {
    console.warn(`[studyWrite] prepared analysis for ${presetId} skipped: visits changed (${fingerprint} != ${snapshot.visitsFingerprint})`);
    return null;
  }
  const current = currentChainFingerprints();
  const stale = Object.keys(current).filter((key) => snapshot.chainFingerprints?.[key] !== current[key]);
  if (stale.length > 0) {
    console.warn(`[studyWrite] prepared analysis for ${presetId} skipped: prompts changed (${stale.join(', ')})`);
    return null;
  }
  return snapshot;
}
