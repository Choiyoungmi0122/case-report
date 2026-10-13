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
  /** 수정 요청 채팅의 "질문 받기"에서 온 답이면 그 채팅 항목 id */
  chatEntryId?: string;
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
    /** 프리셋 EMR 로 실험 전에 미리 만든 질문이면 그 출처 (2026-10-13부터) */
    prepared?: {
      presetId: string;
      preparedCaseId: string;
      visitsFingerprint: string;
      /** 고찰 질문(SW-Q5)으로 채웠으면 그 버전 */
      discussionPromptVersion?: string;
      discussionPromptTemplateHash?: string;
    };
  };
}

/**
 * 질의응답 종료 기록.
 * - participant_button: 분석을 기다리는 동안 보이는 "질문은 여기까지" 버튼 (참여자인지 옆의 연구자인지는 알 수 없다)
 * - budget_reached: 회차·질문 수 상한에 닿아 화면이 자동으로 끝냄
 * - no_more_questions: 다음 회차를 만들려 했는데 체인이 물을 질문이 없다고 함
 * - unspecified: 이유 없이 끝내기 요청이 옴 (옛 화면 등)
 */
export interface StudyWriteInterviewFinish {
  reason: 'participant_button' | 'budget_reached' | 'no_more_questions' | 'unspecified';
  at: string;
  /** 끝날 때까지 열린 회차 수와 답한 질문 수 */
  roundCount: number;
  answeredCount: number;
  questionCount: number;
  /** 끝날 때 기록 분석이 끝나 있었는지 (false 면 분석을 기다리던 중) */
  analysisReady: boolean;
  /** 마지막 답부터 종료까지 걸린 초 */
  secondsSinceLastAnswer: number | null;
  /** no_more_questions 일 때 체인이 적은 이유 */
  stopReason?: string;
}

export interface StudyWriteQuestionBudget {
  maxRounds: number;
  perRound: number;
  maxTotal: number;
}

/**
 * 'unchecked'(판정 없음): SW-C 응답에서 그 항목의 판정을 찾지 못한 것. "없음(not_in_record)"이 아니다. 2026-10-12부터 쓴다.
 * 그 전(2026-10-11)에는 같은 경우를 not_in_record + hint "점검 결과를 받지 못한 항목…"으로 저장했다. 읽을 때는
 * studyWrite/careStatus.ts 의 effectiveCareStatus 로 둘을 같게 본다.
 */
export type StudyWriteCareItemStatus = 'present' | 'in_record_not_in_draft' | 'not_in_record' | 'not_applicable' | 'unchecked';

/**
 * 항목 아래 하위 요소의 판정 (체크리스트 v2, studyWrite/careSubElements.ts). 2026-10-12부터 모든 섹션에 붙는다
 * (그날 먼저 네 섹션, 이어 나머지 여덟 섹션). 항목 판정과 따로 매긴다.
 */
export interface StudyWriteCareSubItem {
  id: string;
  label: string;
  required: boolean;
  /** 9b 개입 묶음 (base 는 묶음 없음) */
  group: string;
  groupLabel: string;
  criterion: string;
  source: string;
  condition?: string;
  /** 조건이 붙은 요소에서 모델이 판정한 조건 충족 여부. false 면 status 는 not_applicable */
  conditionMet?: boolean;
  /** 두 번 점검한 판정이 갈렸으면 true (합친 판정은 있음 쪽, drafting.CARE_CHECK_RUNS) */
  disagreed?: boolean;
  status: StudyWriteCareItemStatus;
  hint: string;
}

export interface StudyWriteCareCheck {
  checkedAt: string;
  promptVersion: string;
  promptTemplateHash?: string;
  /** 'care-checklist:v1' 항목만, 'care-checklist:v2' 하위 요소까지. 없으면 v1 */
  checklistVersion?: string;
  /** 같은 입력으로 점검한 횟수 (2026-10-12부터 2, 그 전 결과는 없음 = 1) */
  checkRuns?: number;
  /** 9b 개입 묶음: 점검한 것과, 기록·답변·초안에서 찾지 못해 점검하지 않은 것 */
  modalities?: { checked: string[]; skipped: string[] };
  items: Array<{
    code: string;
    label: string;
    required: boolean;
    status: StudyWriteCareItemStatus;
    hint: string;
    /** 두 번 점검한 판정이 갈렸으면 true */
    disagreed?: boolean;
    subItems?: StudyWriteCareSubItem[];
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
  /** 'question': "질문 받기"로 AI 가 한 질문 (SW-Q4). 답은 질의응답에 저장되고 섹션을 고쳐 쓴다 */
  kind?: 'question';
  /** 질문일 때: 답에 들어가면 좋은 요소, 채우려는 CARE 항목·하위 요소, 고른 이유, 답한 시각 */
  hint?: string;
  targetCode?: string;
  reason?: string;
  answeredAt?: string;
  /** 질문을 건너뛴 시각 (건너뛴 질문은 답을 기다리지 않고, 다시 묻지 않는다) */
  skippedAt?: string;
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
  /** 질의응답이 어떻게 끝났는지 (2026-10-13부터 기록. S01·S02 에는 없다) */
  interviewFinish?: StudyWriteInterviewFinish;
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
