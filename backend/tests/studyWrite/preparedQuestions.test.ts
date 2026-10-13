/**
 * 미리 만든 질문(프리셋 EMR): 1회차에 고정 3개 + 미리 만든 질문을 한꺼번에 넣고, 회차를 더 열지 않는다.
 * 방문 기록이 준비 때와 다르면 쓰지 않는다.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  FIXED_CASE_QUESTIONS,
  PreparedQuestionSet,
  canOpenNextRound,
  createInitialStudyWriteState,
  startInterview,
  answerQuestion,
  allQuestions
} from '../../src/studyWrite/interview';
import { PREPARED_DIR, preparedQuestionsForCase, savePreparedQuestions, visitsFingerprint } from '../../src/studyWrite/preparedQuestions';

const visits = [
  { type: '초진', date: '2025-01-01T09:00', soapText: 'S) 두통\nO) BP 120/80' },
  { type: '재진', date: '2025-01-08T09:00', soapText: 'S) 두통 감소' }
];

const prepared: PreparedQuestionSet = {
  presetId: `unit-test-${process.pid}`,
  preparedCaseId: 'case_prep',
  visitsFingerprint: visitsFingerprint(visits),
  generation: { model: 'test-model', promptVersion: 'SW-Q2:v5', generatedAt: '2026-10-13T00:00:00Z', candidateCount: 5 },
  questions: [
    { text: '침 유침 시간은 몇 분이었나요?', targetSectionIds: ['THERAPEUTIC_INTERVENTION'], careItem: '9b', rationale: 'r1' },
    { text: '초진 때 활력징후를 측정했나요?', targetSectionIds: ['CLINICAL_FINDINGS'], careItem: '6', rationale: 'r2' },
    { text: '한약은 하루 몇 번 복용했나요?', targetSectionIds: ['THERAPEUTIC_INTERVENTION'], careItem: '9b' }
  ]
};

// 1. 미리 만든 질문이 있으면 한 회차에 모두
let state = startInterview(createInitialStudyWriteState({ source: 'preset', visitCount: 2, presetId: prepared.presetId }), prepared);
assert.equal(state.rounds.length, 1);
const round = state.rounds[0];
assert.equal(round.questions.length, FIXED_CASE_QUESTIONS.length + prepared.questions.length);
assert.deepEqual(round.questions.map((q) => q.source), ['fixed', 'fixed', 'fixed', 'generated', 'generated', 'generated']);
assert.deepEqual(round.questions.map((q) => q.order), [1, 2, 3, 4, 5, 6]);
assert.equal(round.questions[3].rationale, 'r1');
assert.equal(round.questions[0].priority, 'case');
assert.equal(round.generation?.prepared?.presetId, prepared.presetId);
assert.deepEqual(state.questionBudget, { maxRounds: 1, perRound: 6, maxTotal: 6 });

// 다 답하면 다음 회차는 열리지 않는다 (화면이 질의응답을 끝낸다)
for (const question of allQuestions(state)) state = answerQuestion(state, question.id, { answer: '답' });
assert.equal(canOpenNextRound(state).ok, false);

// 2. 없으면 기존처럼 고정 3개만
const plain = startInterview(createInitialStudyWriteState(), null);
assert.equal(plain.rounds[0].questions.length, 3);
assert.equal(plain.rounds[0].generation, undefined);
assert.equal(plain.questionBudget.maxRounds, 3);

// 2-1. 미리 만든 질문이 0개여도(기록이 충실한 사례) 고정 3개를 한 회차로 묻고 회차를 더 열지 않는다
const empty = startInterview(createInitialStudyWriteState(), { ...prepared, questions: [] });
assert.equal(empty.rounds[0].questions.length, 3);
assert.equal(empty.questionBudget.maxRounds, 1);
assert.ok(empty.rounds[0].generation?.prepared);

// 3. 파일에서 읽기: 기록이 같을 때만
const file = savePreparedQuestions(prepared);
try {
  assert.ok(file.startsWith(PREPARED_DIR));
  assert.equal(preparedQuestionsForCase({ visits }, prepared.presetId)?.questions.length, 3);
  // 줄바꿈 형식(\r\n)만 다르면 같은 기록
  const crlf = visits.map((visit) => ({ ...visit, soapText: visit.soapText.replace(/\n/g, '\r\n') }));
  assert.ok(preparedQuestionsForCase({ visits: crlf }, prepared.presetId));
  const edited = [{ ...visits[0], soapText: `${visits[0].soapText} 추가` }, visits[1]];
  assert.equal(preparedQuestionsForCase({ visits: edited }, prepared.presetId), null);
  assert.equal(preparedQuestionsForCase({ visits }, 'no-such-preset'), null);
  assert.equal(preparedQuestionsForCase({ visits }, undefined), null);
  assert.throws(() => savePreparedQuestions({ ...prepared, presetId: '../escape' }));
} finally {
  fs.rmSync(file, { force: true });
  if (fs.existsSync(PREPARED_DIR) && fs.readdirSync(PREPARED_DIR).length === 0) fs.rmdirSync(PREPARED_DIR);
}
assert.ok(!fs.existsSync(path.join(PREPARED_DIR, `${prepared.presetId}.json`)));

console.log('prepared questions tests passed');
