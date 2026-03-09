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
  currentDraft: string;
  evidence: string[];
  qnaHistory: Array<{
    question: string;
    answer: string;
    timestamp: string;
  }>;
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

  getNextQuestion: async (caseId: string, sectionId: string, userAnswers?: any[]) => {
    const response = await api.post<{
      question: string;
      context?: string;
      isComplete: boolean;
    }>(`/cases/${caseId}/sections/${sectionId}/next-question`, { userAnswers });
    return response.data;
  },

  submitAnswer: async (
    caseId: string,
    sectionId: string,
    answerText: string,
    question?: string
  ) => {
    const response = await api.post<{
      updatedDraft: string;
      isComplete: boolean;
      nextQuestion?: string;
      qnaHistory: any[];
    }>(`/cases/${caseId}/sections/${sectionId}/answer`, {
      answerText,
      question
    });
    return response.data;
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
  }
};
