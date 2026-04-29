import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

export interface Visit {
  type: '초진' | '재진';
  date: string;
  soapText: string;
  structured?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  };
}

export interface CreateCaseRequest {
  visits: Visit[];
  title?: string;
  metadata?: any;
  skipSanitize?: boolean;
}

export interface Case {
  id: string;
  createdAt: string;
  title?: string;
  visits: Visit[];
  finalComposeStatus?: FinalComposeStatus;
  sectionEvidenceMap?: Record<string, string[]>;
  sectionStatusMap?: Record<string, SectionStatusInfo>;
  sectionStates?: Array<{
    sectionId: string;
    status: string;
    rationaleText: string;
    missingInfoBullets: string[];
    recommendedQuestions: string[];
  }>;
  sectionDrafts?: Array<{
    sectionId: string;
    evidenceCardIdsUsed: string[];
    draftText: string;
    openIssues: string[];
  }>;
  draftsBySection?: Record<string, string>;
  finalDraft?: FinalDraft | null;
}

export interface SectionStatusInfo {
  status: string;
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
}

export interface SectionOverview {
  section: string;
  status: string;
  rationaleText: string;
  draftSnippet: string;
}

export interface SectionDetail {
  section: string;
  status: string;
  rationaleText: string;
  missingInfoBullets: string[];
  recommendedQuestions: string[];
  draftsBySection?: Record<string, string>;
  sectionMissingInfo?: string[];
  commonMissingInfo?: string[];
  sectionQuestions?: string[];
  commonQuestions?: string[];
  commonQnaHistory?: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  currentDraft: string;
  evidence?: string[];
  evidenceCards?: Array<{
    id?: string;
    normalizedText?: string;
    tags?: string[];
  }>;
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  canUndo?: boolean;
  uiHints?: SectionUiHints;
}

export interface SectionUiHints {
  stage: 'empty' | 'draft_created' | 'questions_available' | 'refined_no_questions';
  subtitle: string;
  emptyMessage: string;
  hideStartButton: boolean;
}

export interface FinalDraft {
  fullTextBySection: Record<string, string>;
  titleSuggestions: string[];
  abstractSuggestion: string;
  careChecklistEvaluation: Record<
    string,
    {
      status: 'FULFILLED' | 'INSUFFICIENT' | 'MISSING';
      rationale: string;
    }
  >;
}

export interface FinalComposeStatus {
  status: 'IDLE' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface CommonQuestionResponse {
  questions: string[];
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
  missingInfo: string[];
}

export const caseApi = {
  getAllCases: async () => {
    const response = await api.get<{ cases: Case[] }>('/cases');
    return response.data;
  },

  createCase: async (data: CreateCaseRequest) => {
    const response = await api.post<{ caseId: string }>('/cases', data);
    return response.data;
  },

  processCase: async (caseId: string) => {
    const response = await api.post<{ caseId: string; sectionsOverview: SectionOverview[] }>(
      `/cases/${caseId}/process`
    );
    return response.data;
  },

  getCase: async (caseId: string) => {
    const response = await api.get<Case>(`/cases/${caseId}`);
    return response.data;
  },

  getSections: async (caseId: string) => {
    const response = await api.get<{ sections: SectionOverview[] }>(
      `/cases/${caseId}/sections`
    );
    return response.data;
  },

  getSectionDetail: async (caseId: string, sectionId: string) => {
    const response = await api.get<SectionDetail>(
      `/cases/${caseId}/sections/${sectionId}`
    );
    return response.data;
  },

  reviewSection: async (caseId: string, sectionId: string) => {
    const response = await api.post<SectionDetail>(
      `/cases/${caseId}/sections/${sectionId}/review`
    );
    return response.data;
  },

  getNextQuestion: async (caseId: string, sectionId: string, _userAnswers?: any[]) => {
    const response = await api.post<{
      nextQuestion: string | null;
      whyThisQuestion: string;
      updatedDraftText: string;
      needMore: boolean;
      remainingItems: string[];
      updatedDraftsBySection?: Record<string, string>;
      sectionQuestions?: string[];
      commonQuestions?: string[];
      sectionMissingInfo?: string[];
      commonMissingInfo?: string[];
      commonQnaHistory?: CommonQuestionResponse['qnaHistory'];
      insufficiencyReason: string | null;
      qnaHistory: any[];
      uiHints?: SectionUiHints;
    }>(`/cases/${caseId}/sections/${sectionId}/next`, {});

    const data = response.data;

    return {
      question: data.nextQuestion || '',
      sectionQuestions: data.sectionQuestions || [],
      commonQuestions: data.commonQuestions || [],
      sectionMissingInfo: data.sectionMissingInfo || [],
      commonMissingInfo: data.commonMissingInfo || [],
      updatedDraftsBySection: data.updatedDraftsBySection || {},
      commonQnaHistory: data.commonQnaHistory || [],
      context: data.whyThisQuestion,
      isComplete: !data.needMore,
      uiHints: data.uiHints
    };
  },

  submitAnswer: async (
    caseId: string,
    sectionId: string,
    answerText: string,
    question?: string
  ) => {
    const response = await api.post<{
      nextQuestion: string | null;
      whyThisQuestion: string;
      updatedDraftText: string;
      updatedDraftsBySection?: Record<string, string>;
      needMore: boolean;
      remainingItems: string[];
      sectionQuestions?: string[];
      commonQuestions?: string[];
      sectionMissingInfo?: string[];
      commonMissingInfo?: string[];
      commonQnaHistory?: CommonQuestionResponse['qnaHistory'];
      insufficiencyReason: string | null;
      qnaHistory: any[];
      lightweight?: boolean;
      uiHints?: SectionUiHints;
    }>(`/cases/${caseId}/sections/${sectionId}/next`, {
      userAnswer: answerText,
      question
    });

    const data = response.data;

    return {
      updatedDraft: data.updatedDraftText,
      updatedDraftsBySection: data.updatedDraftsBySection || {},
      isComplete: !data.needMore,
      nextQuestion: data.nextQuestion || undefined,
      sectionQuestions: data.sectionQuestions || [],
      commonQuestions: data.commonQuestions || [],
      sectionMissingInfo: data.sectionMissingInfo || [],
      commonMissingInfo: data.commonMissingInfo || [],
      commonQnaHistory: data.commonQnaHistory || [],
      qnaHistory: data.qnaHistory,
      lightweight: Boolean(data.lightweight),
      uiHints: data.uiHints
    };
  },

  updateCaseTitle: async (caseId: string, title: string) => {
    const response = await api.patch<{ success: boolean }>(
      `/cases/${caseId}/title`,
      { title }
    );
    return response.data;
  },

  updateFrontMatter: async (
    caseId: string,
    payload: { title: string; keywords: string[]; discussion?: string }
  ) => {
    const response = await api.patch<{
      success: boolean;
      title: string;
      keywords: string[];
      draftsBySection: Record<string, string>;
    }>(`/cases/${caseId}/front-matter`, payload);
    return response.data;
  },

  deleteCase: async (caseId: string) => {
    const response = await api.delete<{ success: boolean }>(`/cases/${caseId}`);
    return response.data;
  },

  composeFinalDraft: async (
    caseId: string,
    payload?: {
      contributionAnswers?: Array<{ question: string; answer: string }>;
    }
  ) => {
    const response = await api.post<{
      caseId: string;
      started: boolean;
      finalComposeStatus: FinalComposeStatus;
    }>(
      `/cases/${caseId}/final-compose`,
      payload || {}
    );
    return response.data;
  },

  getFinalComposeStatus: async (caseId: string) => {
    const response = await api.get<{
      caseId: string;
      title?: string;
      finalDraft: FinalDraft | null;
      finalComposeStatus: FinalComposeStatus;
    }>(`/cases/${caseId}/final-compose-status`);
    return response.data;
  },

  getCommonQuestions: async (caseId: string) => {
    const response = await api.get<CommonQuestionResponse>(`/cases/${caseId}/common-questions`);
    return response.data;
  },

  submitCommonAnswer: async (caseId: string, question: string, answer: string) => {
    const response = await api.post<{
      updatedDraftsBySection: Record<string, string>;
      qnaHistory: CommonQuestionResponse['qnaHistory'];
    }>(`/cases/${caseId}/common-questions/answer`, {
      question,
      answer
    });
    return response.data;
  },

  undoLastAnswer: async (caseId: string) => {
    const response = await api.post<{
      success: boolean;
      undone?: {
        kind: 'COMMON' | 'SECTION';
        question: string;
        sectionId?: string;
      };
      remainingUndoCount: number;
    }>(`/cases/${caseId}/undo-last-answer`);
    return response.data;
  }
};
