/**
 * 연구자용 '다시 보기' 모드.
 *
 * 실험번호 조회 화면에서 참가자가 보던 실습 화면을 그대로 열어 보되, 그 참가자의
 * 기록(초안, 판단, 회고, 행동 로그, 타이머)이 바뀌지 않게 한다. 대상 케이스 ID를
 * 탭 단위(sessionStorage)로 기억하고, API 계층이 그 케이스에 대한 변경 요청을 막는다.
 */
const STORAGE_KEY = 'care.readOnlyViewCaseId';
export const READ_ONLY_VIEW_HEADER = 'X-Read-Only-View';
export const READ_ONLY_VIEW_MESSAGE = '다시 보기 모드에서는 내용이 저장되지 않습니다.';

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getReadOnlyViewCaseId(): string | null {
  return readStorage() || null;
}

export function startReadOnlyView(caseId: string) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, caseId);
  } catch {
    // sessionStorage를 쓸 수 없으면 다시 보기 모드를 켤 수 없다. 서버 쪽 차단은
    // 헤더가 있어야 동작하므로, 이 경우 화면을 열지 않도록 호출부에서 확인한다.
  }
}

export function stopReadOnlyView() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 요청 URL이 다시 보기 대상 케이스에 대한 것인지. */
export function isReadOnlyViewRequest(url: string | undefined): boolean {
  const caseId = getReadOnlyViewCaseId();
  if (!caseId || !url) return false;
  return url.includes(`/cases/${caseId}`);
}

/** 화면 진행에 영향이 없는 기록성 요청. 다시 보기에서는 조용히 건너뛴다. */
export function isTelemetryRequest(url: string | undefined): boolean {
  return /\/(scaffold|research)\/(events|session)(\?|$)/.test(String(url || ''));
}

export function readOnlyViewPath(caseId: string): string {
  // 0번(시작 안내)부터 연다
  return `/study/scaffold/cases/${caseId}?readonly=1&phase=intro`;
}
