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
  skipSanitize?: boolean; // 임시 저장 시 원본 텍스트 저장
}

export interface Case {
  id: string;
  createdAt: string;
  title?: string;
  visits: Visit[];
  sectionEvidenceMap?: Record<string, string[]>;
  sectionStatusMap?: Record<string, SectionStatusInfo>;
  draftsBySection?: Record<string, string>;
  aiPipeline?: {
    chain7?: {
      final_sections?: Record<string, string>;
    };
    [key: string]: any;
  } | null;
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
  sectionMissingInfo?: string[];
  commonMissingInfo?: string[];
  sectionQuestions?: string[];
  commonQuestions?: string[];
  currentDraft: string;
  evidence: string[]; // NOTE: backend actually returns evidenceCards; mapped in component
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
}

export interface AiPipelineStartResponse {
  chain1: any;
  chain2: any;
  chain3: any;
  chain4: { missing: string[] };
  chain5: { clarification_questions: string[] };
  is_complete: boolean;
}

export interface AiPipelineAnswerResponse {
  chain6: any;
  chain4: { missing: string[] };
  chain5: { clarification_questions: string[] };
  chain7: {
    final_sections: Record<string, string>;
  } | null;
  is_complete: boolean;
}

export interface AiPipelineRunFullResponse {
  chain1: any;
  chain2: any;
  chain3: any;
  chain4: { missing: string[] };
  chain5: { clarification_questions: string[] };
  interactive_trace: Array<{
    qa: { question: string; answer: string };
    chain6: any;
    chain4_after_chain6: { missing: string[] };
    chain5_after_chain6: { clarification_questions: string[] };
  }>;
  chain7: {
    final_sections: Record<string, string>;
  };
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

  /**
   * Chain4 Q&A: get next question (or mark complete).
   * This is an adapter over POST /cases/:id/sections/:sectionId/next.
   */
  getNextQuestion: async (caseId: string, sectionId: string, _userAnswers?: any[]) => {
    // For initial question we don't send userAnswer/question.
    const response = await api.post<{
      nextQuestion: string | null;
      whyThisQuestion: string;
      updatedDraftText: string;
      needMore: boolean;
      remainingItems: string[];
      sectionQuestions?: string[];
      commonQuestions?: string[];
      sectionMissingInfo?: string[];
      commonMissingInfo?: string[];
      insufficiencyReason: string | null;
      qnaHistory: any[];
    }>(`/cases/${caseId}/sections/${sectionId}/next`, {});

    const data = response.data;

    return {
      question: data.nextQuestion || '',
      sectionQuestions: data.sectionQuestions || [],
      commonQuestions: data.commonQuestions || [],
      sectionMissingInfo: data.sectionMissingInfo || [],
      commonMissingInfo: data.commonMissingInfo || [],
      context: data.whyThisQuestion,
      isComplete: !data.needMore
    };
  },

  /**
   * Chain4 Q&A: submit an answer and receive updated draft + next question.
   * Adapter over POST /cases/:id/sections/:sectionId/next.
   */
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
      insufficiencyReason: string | null;
      qnaHistory: any[];
      lightweight?: boolean;
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
      qnaHistory: data.qnaHistory,
      lightweight: Boolean(data.lightweight)
    };
  },

  updateCaseTitle: async (caseId: string, title: string) => {
    const response = await api.patch<{ success: boolean }>(
      `/cases/${caseId}/title`,
      { title }
    );
    return response.data;
  },

  deleteCase: async (caseId: string) => {
    const response = await api.delete<{ success: boolean }>(`/cases/${caseId}`);
    return response.data;
  },

  saveAiPipelineResult: async (
    caseId: string,
    payload: {
      chain1: any;
      chain2: any;
      chain3: any;
      chain4: any;
      chain5: any;
      chain7: any;
      qnaHistory: Array<{ question: string; answer: string }>;
    }
  ) => {
    const response = await api.post<{ success: boolean; caseId: string }>(
      `/cases/${caseId}/ai-pipeline`,
      payload
    );
    return response.data;
  },

  composeFinalDraft: async (
    caseId: string,
    payload?: {
      contributionAnswers?: Array<{ question: string; answer: string }>;
    }
  ) => {
    const response = await api.post<{ caseId: string; finalDraft: FinalDraft }>(
      `/cases/${caseId}/final-compose`,
      payload || {}
    );
    return response.data;
  }
};

export const aiPipelineApi = {
  start: async (text: string) => {
    const response = await api.post<AiPipelineStartResponse>('/ai/pipeline/start', { text });
    return response.data;
  },

  answer: async (params: {
    current_draft: Record<string, any>;
    question: string;
    answer: string;
  }) => {
    const response = await api.post<AiPipelineAnswerResponse>('/ai/pipeline/answer', params);
    return response.data;
  },

  runFull: async (params: {
    text: string;
    qa_items?: Array<{ question: string; answer: string }>;
  }) => {
    const response = await api.post<AiPipelineRunFullResponse>('/ai/pipeline/run-full', {
      text: params.text,
      qa_items: params.qa_items || []
    });
    return response.data;
  }
};
