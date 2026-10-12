/**
 * Scaffold 섹션 완료 판정 (2026-10-12).
 *
 * 완료는 두 가지다.
 *  1. AI 초안 검토까지 끝낸 섹션: recordReviewCompleted · missingInfoReviewCompleted · draftRevealed · draftReviewCompleted.
 *  2. AI 비교 단계 없이 글만 쓰는 "추가 작성" 섹션(제목·초록·서론·고찰·환자 관점·환자 동의)에 글을 저장한 경우:
 *     authoringCompleted. AI 검토 플래그를 거짓으로 켜지 않고 따로 둔다.
 * "추가 작성" 목록은 frontend utils/scaffoldUi.ts 의 additional_authoring 그룹과 같아야 한다.
 */
export const WRITE_ONLY_SECTION_IDS = new Set([
  'PATIENT_PERSPECTIVE',
  'INFORMED_CONSENT',
  'DISCUSSION_CONCLUSION',
  'INTRODUCTION',
  'TITLE',
  'ABSTRACT'
]);

export function isWriteOnlySection(sectionId: unknown): boolean {
  return WRITE_ONLY_SECTION_IDS.has(String(sectionId || ''));
}

export function isScaffoldProgressComplete(progress: any): boolean {
  if (!progress) return false;
  if (
    progress.recordReviewCompleted &&
    progress.missingInfoReviewCompleted &&
    progress.draftRevealed &&
    progress.draftReviewCompleted
  ) {
    return true;
  }
  return progress.authoringCompleted === true && isWriteOnlySection(progress.sectionId);
}
