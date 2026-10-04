import { CaseMode, LogResearchEventRequest, caseApi } from '../services/api';

export function createResearchEventId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getStudyBasePath(mode: CaseMode) {
  return mode === 'scaffold' ? '/study/scaffold' : '/study/write';
}

export function getModeBasePath(mode: CaseMode, studyMode: boolean) {
  return studyMode ? getStudyBasePath(mode) : mode === 'scaffold' ? '/scaffold' : '/write';
}

export async function logResearchEvent(caseId: string, data: LogResearchEventRequest) {
  return caseApi.logResearchEvent(caseId, {
    ...data,
    eventId: data.eventId || createResearchEventId(data.eventType)
  });
}

/* ------------------------------------------------------------------------- *
 * Research session (expert formative study)
 *
 * The session identifier has to survive a page refresh and section navigation,
 * so it lives in localStorage rather than in component state or router state.
 * Ordinary /write and /scaffold users never touch this - a session only exists
 * once the researcher has entered a participant code.
 * ------------------------------------------------------------------------- */

export type ResearchSession = {
  participantCode: string;
  sessionId: string;
};

/**
 * One expert uses both Write and Scaffold in the same session, and the two are
 * joined afterwards by participantCode. The code is therefore stored ONCE for
 * the participant, not per mode - otherwise moving from Write to Scaffold shows
 * an empty field and a re-typed code (or a typo) silently breaks the linkage.
 *
 * The sessionId stays per mode: the two modes are separate activities and the
 * research export records each one's own session.
 */
const PARTICIPANT_CODE_KEY = () => 'research-participant-code';
const LEGACY_PARTICIPANT_CODE_KEY = (mode: CaseMode) => `research-participant-code:${mode}`;
const SESSION_ID_KEY = (mode: CaseMode) => `research-session-id:${mode}`;

function readStorage(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private browsing / storage disabled - the session simply is not remembered */
  }
}

function clearStorage(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function createSessionId(mode: CaseMode) {
  return `${mode}_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isResearchRoute(pathname: string) {
  return pathname.startsWith('/study/');
}

/**
 * The code is shared across modes. `mode` is still accepted so a code saved by
 * an earlier per-mode build is picked up instead of appearing blank.
 */
export function getStoredParticipantCode(mode: CaseMode) {
  return readStorage(PARTICIPANT_CODE_KEY()) || readStorage(LEGACY_PARTICIPANT_CODE_KEY(mode));
}

/**
 * Returns the session for this mode, minting and persisting one on first use.
 * Re-entering the page reuses the same sessionId, so a refresh mid-session does
 * not split the participant's trajectory into two sessions.
 */
export function getOrCreateResearchSessionId(mode: CaseMode) {
  const existing = readStorage(SESSION_ID_KEY(mode));
  if (existing) return existing;

  const created = createSessionId(mode);
  writeStorage(SESSION_ID_KEY(mode), created);
  return created;
}

export function setResearchParticipantCode(mode: CaseMode, participantCode: string) {
  const trimmed = participantCode.trim();
  if (trimmed) {
    writeStorage(PARTICIPANT_CODE_KEY(), trimmed);
  } else {
    clearStorage(PARTICIPANT_CODE_KEY());
  }
  // The per-mode key from earlier builds is no longer read as the source of
  // truth; clear it so a stale value cannot resurface for the next participant.
  clearStorage(LEGACY_PARTICIPANT_CODE_KEY(mode));
}

/**
 * Ends the participant's session so the next expert starts clean on the same
 * machine. Clears BOTH mode sessions and the shared code, otherwise the next
 * participant could inherit the previous one's identifiers.
 */
export function resetResearchSession(mode?: CaseMode) {
  const modes: CaseMode[] = mode ? [mode] : ['write', 'scaffold'];
  for (const item of modes) {
    clearStorage(SESSION_ID_KEY(item));
    clearStorage(LEGACY_PARTICIPANT_CODE_KEY(item));
  }
  clearStorage(PARTICIPANT_CODE_KEY());
}

/**
 * Metadata attached to a case created inside a research session. Only the
 * pseudonymous participantCode and the sessionId are sent - no names, no email.
 */
export function buildResearchCaseMetadata(params: {
  mode: CaseMode;
  participantCode: string;
  sessionId: string;
}) {
  return {
    sessionId: params.sessionId,
    participantCode: params.participantCode.trim() || undefined
  };
}
