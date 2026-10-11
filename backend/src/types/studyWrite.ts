/**
 * 실험용 Write의 상태. cases 문서의 `studyWrite` 필드에 저장된다.
 * Scaffold의 scaffoldState와는 별개이며 서로 참조하지 않는다.
 */

/**
 * answered: 글로 답함. skipped: 답하지 않기로 함(skipReason 참고). deferred: "자료 확인 필요" — 참여자가
 * 제공된 기록을 아직 충분히 보지 못해 보류함(정보 부재가 아님, 나중에 다시 답할 수 있음).
 */
export type StudyWriteAnswerStatus = 'pending' | 'answered' | 'skipped' | 'deferred';

/** skipped 의 이유. 옛 데이터(이유 없음)는 not_in_record("모름 / 기록에 없음")로 본다 */
export type StudyWriteSkipReason = 'not_in_record' | 'cannot_confirm' | 'needs_follow_up';

export interface StudyWriteAnswerEdit {
  /** 바꾸기 전 답 */
  previousAnswer: string;
  previousStatus: StudyWriteAnswerStatus;
  editedAt: string;
}

export interface StudyWriteQuestion {
  id: string;
  roundNo: number;
  /** 질문 순서 (1부터, 전체 기준) */
  order: number;
  text: string;
  /** 'fixed' 는 1회차 고정 질문, 'generated' 는 체인이 만든 질문, 'care_check' 는 CARE 점검에서 사용자가 직접 넣은 정보 */
  source: 'fixed' | 'generated' | 'care_check';
  /** 답이 쓰일 CARE 섹션 */
  targetSectionIds: string[];
  /** CARE 세부 항목 (예: 11d, 9b). 고정 질문은 비울 수 있다 */
  careItem?: string;
  /** 필수 항목 빈칸이면 'required', 선택 항목이면 'optional', 사례 전체 질문이면 'case' */
  priority: 'required' | 'optional' | 'case';
  /** 왜 이 질문을 골랐는지 (체인 출력). 참여자에게는 보이지 않는다 */
  rationale?: string;
  status: StudyWriteAnswerStatus;
  /** status 가 skipped 일 때의 이유. 없으면 not_in_record 로 본다 (2026-10-12 이전 데이터) */
  skipReason?: StudyWriteSkipReason;
  answer: string;
  askedAt: string;
  answeredAt?: string;
  editHistory: StudyWriteAnswerEdit[];
}

export interface StudyWriteRound {
  roundNo: number;
  /** 'case' 는 사례 전체 질문, 'gap' 은 기록 빈칸 질문, 'care_check' 는 CARE 점검에서 사용자가 더한 정보 */
  kind: 'case' | 'gap' | 'care_check';
  questions: StudyWriteQuestion[];
  startedAt: string;
  completedAt?: string;
  /** 체인이 질문을 만들었을 때의 메타 (모델, 프롬프트 버전) */
  generation?: {
    model: string;
    promptVersion: string;
    /** 시스템 프롬프트 템플릿 해시 (2026-10-11부터) */
    promptTemplateHash?: string;
    generatedAt: string;
    candidateCount: number;
    /** 기록 전문이 길어 뒷부분을 잘라 보냈으면 true */
    recordTruncated?: boolean;
  };
}

export interface StudyWriteQuestionBudget {
  maxRounds: number;
  perRound: number;
  maxTotal: number;
}

export type StudyWriteCareItemStatus = 'present' | 'in_record_not_in_draft' | 'not_in_record' | 'not_applicable';

export interface StudyWriteCareCheck {
  checkedAt: string;
  promptVersion: string;
  promptTemplateHash?: string;
  items: Array<{
    code: string;
    label: string;
    required: boolean;
    status: StudyWriteCareItemStatus;
    hint: string;
  }>;
}

export interface StudyWriteDraftVersion {
  version: number;
  text: string;
  /** answers: 질의응답 반영 초안, answers_edited: 답 수정 뒤 재작성, revise: 채팅 지시, manual: 직접 편집 */
  source: 'answers' | 'answers_edited' | 'revise' | 'manual';
  at: string;
  model?: string;
  promptVersion?: string;
  promptTemplateHash?: string;
  usedQuestionIds?: string[];
  notes?: string[];
  instruction?: string;
  changeSummary?: string;
  outOfRecordClaims?: string[];
}

export interface StudyWriteChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  /** assistant 가 초안을 바꿨으면 그 버전 */
  resultVersion?: number;
}

export interface StudyWriteSectionState {
  sectionId: string;
  draftText: string;
  version: number;
  history: StudyWriteDraftVersion[];
  chat: StudyWriteChatEntry[];
  careCheck: StudyWriteCareCheck | null;
  /** 표·그림 첨부 id (study_write_attachments 컬렉션) 순서대로 */
  attachmentIds: string[];
  lastGeneratedAt?: string;
}

export interface StudyWriteDraftGeneration {
  status: 'idle' | 'running' | 'done' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  targetSectionIds: string[];
  doneSectionIds: string[];
  failedSectionIds: string[];
  lastError?: string;
}

export interface StudyWriteState {
  version: 'study-write-v1';
  inputSource?: {
    source: 'manual' | 'xlsx' | 'docx' | 'pdf' | 'preset';
    fileName?: string;
    visitCount: number;
    /** 날짜가 첫 기록일 기준 일수뿐인 기록. 입력 칸의 날짜는 임의 기준일이다 */
    relativeDates?: boolean;
    presetId?: string;
  } | null;
  questionBudget: StudyWriteQuestionBudget;
  rounds: StudyWriteRound[];
  /** 질의응답 단계가 시작된 시각 (1회차를 보여 준 때) */
  interviewStartedAt?: string;
  /** 질의응답을 마치고 초안 단계로 넘어간 시각 */
  interviewCompletedAt?: string;
  /** 분석(/process) 요청을 보낸 시각. 중복 요청을 막는 데 쓴다 */
  processingRequestedAt?: string;
  /** 섹션별 초안 상태. 키는 CARE 섹션 id */
  sections?: Record<string, StudyWriteSectionState>;
  draftGeneration?: StudyWriteDraftGeneration;
  /** 처음 전체 초안 생성 (⑤). 부분 재작성과 구분해 소요 시간을 잰다 */
  firstGeneration?: { startedAt: string; finishedAt?: string };
  /** 최종 수정에 들어가 답 수정이 잠긴 시각 */
  answersLockedAt?: string;
  /** 최종 제출 시각 */
  submittedAt?: string;
  /**
   * 첫 기록일. 넣으면 화면과 Word 에서 "첫 기록일 +N일"을 실제 날짜로 보여 준다(저장된 초안은 그대로).
   * studyWrite/relativeDates.ts 참고
   */
  dateAnchor?: { date: string; format: 'iso' | 'ko'; setAt?: string } | null;
  updatedAt: string;
}
