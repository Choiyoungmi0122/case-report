import assert from 'node:assert/strict';
import { CareSection } from '../../src/types';
import {
  appendResearchEvent,
  buildInitialResearchState,
  isResearchTracked,
  normalizeResearchState
} from '../../src/routes/cases';

/**
 * Expert formative study invariants for session identification:
 *   participantCode <-> sessionId <-> caseId <-> mode
 * must stay linked across page reloads and section navigation.
 */
function run() {
  // --- a research session links all four identifiers ------------------------
  const state = buildInitialResearchState({
    caseId: 'case-expert-1',
    mode: 'write',
    studyMode: false,
    sessionId: 'write_session_fixed_01',
    participantCode: 'E01'
  });

  assert.equal(state.sessionId, 'write_session_fixed_01');
  assert.equal(state.participantCode, 'E01');
  assert.ok(state.startedAt);
  assert.deepEqual(
    state.interactionEvents.map((item) => item.eventType),
    ['session_start', 'case_created', 'mode_assigned']
  );
  for (const event of state.interactionEvents) {
    assert.equal(event.caseId, 'case-expert-1');
    assert.equal(event.mode, 'write');
    assert.equal(event.sessionId, 'write_session_fixed_01');
    assert.equal(event.participantCode, 'E01');
  }

  // --- expert sessions are tracked without studyConfig.studyMode -----------
  // (so the scaffold reveal gate, whose required activities the expert study is
  //  meant to decide, is not enforced on them)
  assert.equal(state.studyMode, false);
  assert.equal(isResearchTracked(state), true);
  assert.equal(isResearchTracked(normalizeResearchState(null)), false);
  assert.equal(isResearchTracked(normalizeResearchState({ studyMode: true })), true);

  // --- re-entering the session must not mint a new sessionId ---------------
  const reloaded = normalizeResearchState(JSON.parse(JSON.stringify(state)));
  assert.equal(reloaded.sessionId, state.sessionId);
  assert.equal(reloaded.participantCode, 'E01');
  assert.equal(reloaded.startedAt, state.startedAt);
  assert.equal(reloaded.interactionEvents.length, 3);

  // --- events inherit the session and are de-duplicated by eventId ---------
  let advanced = appendResearchEvent(reloaded, {
    eventId: 'section-open-1',
    eventType: 'section_opened',
    caseId: 'case-expert-1',
    mode: 'write',
    sectionId: CareSection.PATIENT_INFORMATION,
    sessionId: reloaded.sessionId,
    participantCode: reloaded.participantCode
  });
  assert.equal(advanced.interactionEvents.length, 4);

  advanced = appendResearchEvent(advanced, {
    eventId: 'section-open-1',
    eventType: 'section_opened',
    caseId: 'case-expert-1',
    mode: 'write',
    sectionId: CareSection.PATIENT_INFORMATION
  });
  assert.equal(advanced.interactionEvents.length, 4, 'duplicate eventId must not be appended twice');
  assert.equal(advanced.sessionId, 'write_session_fixed_01');

  // --- session_completed is what stamps completedAt ------------------------
  assert.equal(advanced.completedAt, undefined);
  const completed = appendResearchEvent(advanced, {
    eventId: 'session-complete-1',
    eventType: 'session_completed',
    caseId: 'case-expert-1',
    mode: 'write'
  });
  assert.ok(completed.completedAt);
  assert.equal(completed.participantCode, 'E01');

  // completedAt must not be overwritten by a second completion event
  const completedTwice = appendResearchEvent(completed, {
    eventId: 'session-complete-2',
    eventType: 'session_completed',
    caseId: 'case-expert-1',
    mode: 'write'
  });
  assert.equal(completedTwice.completedAt, completed.completedAt);

  // --- a session id is generated when the caller supplies none -------------
  const generated = buildInitialResearchState({
    caseId: 'case-expert-2',
    mode: 'scaffold',
    studyMode: false,
    participantCode: 'E02'
  });
  assert.ok(generated.sessionId && generated.sessionId.length > 0);
  assert.equal(generated.interactionEvents[0].sessionId, generated.sessionId);

  console.log('research session tests passed');
}

run();
