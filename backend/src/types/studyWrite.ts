/**
 * 실험용 Write의 상태. cases 문서의 `studyWrite` 필드에 저장된다.
 * Scaffold의 scaffoldState와는 별개이며 서로 참조하지 않는다.
 */

export type StudyWriteAnswerStatus = 'pending' | 'answered' | 'skipped';

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
  /** 'fixed' 는 1회차 고정 질문, 'generated' 는 체인이 만든 질문 */
  source: 'fixed' | 'generated';
  /** 답이 쓰일 CARE 섹션 */
  targetSectionIds: string[];
  /** CARE 세부 항목 (예: 11d, 9b). 고정 질문은 비울 수 있다 */
  careItem?: string;
  /** 필수 항목 빈칸이면 'required', 선택 항목이면 'optional', 사례 전체 질문이면 'case' */
  priority: 'required' | 'optional' | 'case';
  /** 왜 이 질문을 골랐는지 (체인 출력). 참여자에게는 보이지 않는다 */
  rationale?: string;
  status: StudyWriteAnswerStatus;
  answer: string;
  askedAt: string;
  answeredAt?: string;
  editHistory: StudyWriteAnswerEdit[];
}

export interface StudyWriteRound {
  roundNo: number;
  /** 'case' 는 사례 전체 질문, 'gap' 은 기록 빈칸 질문 */
  kind: 'case' | 'gap';
  questions: StudyWriteQuestion[];
  startedAt: string;
  completedAt?: string;
  /** 체인이 질문을 만들었을 때의 메타 (모델, 프롬프트 버전) */
  generation?: {
    model: string;
    promptVersion: string;
    generatedAt: string;
    candidateCount: number;
  };
}

export interface StudyWriteQuestionBudget {
  maxRounds: number;
  perRound: number;
  maxTotal: number;
}

export interface StudyWriteState {
  version: 'study-write-v1';
  inputSource?: { source: 'manual' | 'xlsx' | 'docx'; fileName?: string; visitCount: number } | null;
  questionBudget: StudyWriteQuestionBudget;
  rounds: StudyWriteRound[];
  /** 질의응답 단계가 시작된 시각 (1회차를 보여 준 때) */
  interviewStartedAt?: string;
  /** 질의응답을 마치고 초안 단계로 넘어간 시각 */
  interviewCompletedAt?: string;
  /** 분석(/process) 요청을 보낸 시각. 중복 요청을 막는 데 쓴다 */
  processingRequestedAt?: string;
  /** 최종 수정에 들어가 답 수정이 잠긴 시각 */
  answersLockedAt?: string;
  /** 최종 제출 시각 */
  submittedAt?: string;
  updatedAt: string;
}
