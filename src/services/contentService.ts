import { auth } from './firebase';
import type {
  Question,
  QuestionItem,
  SimuladoConfig,
  LegalBrief,
  StudyMaterial,
} from '../types';

export interface DailyQuotaInfo {
  dateKey: string;
  isPremium: boolean;
  questionsLimit: number;
  questionsUsed: number;
  questionsRemaining: number;
  answeredQuestionIdsToday: string[];
  simuladosLimit: number;
  simuladosUsed: number;
  simuladosRemaining: number;
}

export interface QuestionsFeedResponse {
  isPremium: boolean;
  subscriptionStatus: string;
  quota: DailyQuotaInfo;
  catalogStats: {
    total: number;
    byDiscipline: Record<string, number>;
  };
  availableSubjects: { name: string; count: number }[];
  difficultyCounts: {
    todas: number;
    facil: number;
    medio: number;
    dificil: number;
  };
  questions: QuestionItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SubmitQuestionAnswerResponse {
  isPremium: boolean;
  questionId: string;
  isCorrect: boolean;
  correctOptionId: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  legalFoundation: string;
  examReference?: string;
  questionsLimit: number | null;
  questionsUsed: number;
  questionsRemaining: number | null;
}

export interface SimuladosCatalogResponse {
  isPremium: boolean;
  subscriptionStatus: string;
  quota: DailyQuotaInfo;
  presets: (SimuladoConfig & {
    category: 'oab-oficial' | 'concursos' | 'blocos' | 'rapidos' | 'disciplina';
    badge?: string;
    isFree: boolean;
    isLocked: boolean;
  })[];
}

export interface StartSimuladoResponse {
  isPremium: boolean;
  sessionId: string;
  title: string;
  disciplineId: string;
  timeLimitMinutes: number;
  questions: QuestionItem[];
  quota: DailyQuotaInfo;
}

export interface FinishSimuladoResponse {
  sessionId: string;
  totalQuestions: number;
  correctAnswers: number;
  answers: {
    questionId: string;
    selectedOptionId?: 'A' | 'B' | 'C' | 'D';
    isCorrect: boolean;
  }[];
  gradedQuestions: Question[];
}

export interface BriefsResponse {
  isPremium: boolean;
  subscriptionStatus: string;
  total: number;
  freeCount: number;
  freeIds: string[];
  briefs: LegalBrief[];
}

export interface MaterialsResponse {
  isPremium: boolean;
  subscriptionStatus: string;
  total: number;
  freeCount: number;
  freeIds: string[];
  materials: StudyMaterial[];
}

export class ApiAccessError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiAccessError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function buildAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken(forceRefresh);
      if (typeof token === 'string' && token.split('.').length === 3) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn('Could not attach auth token:', e);
    }
  }
  return headers;
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const sendWithHeaders = async (authHeaders: Record<string, string>) => {
    return fetch(url, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...authHeaders,
        ...(options?.headers || {}),
      },
    });
  };

  let res = await sendWithHeaders(await buildAuthHeaders(false));

  if (res.status === 401 && auth.currentUser) {
    res = await sendWithHeaders(await buildAuthHeaders(true));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiAccessError(
      res.status,
      data?.error || 'REQUEST_ERROR',
      data?.message || data?.error || `Erro na requisição (${res.status})`,
      data
    );
  }
  return data as T;
}

export async function fetchQuestionsFeed(params: {
  disciplineId?: string;
  subject?: string;
  difficulty?: string;
  page?: number;
  limit?: number;
}): Promise<QuestionsFeedResponse> {
  const search = new URLSearchParams();
  if (params.disciplineId) search.set('disciplineId', params.disciplineId);
  if (params.subject) search.set('subject', params.subject);
  if (params.difficulty) search.set('difficulty', params.difficulty);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));

  return apiRequest<QuestionsFeedResponse>(`/api/questions?${search.toString()}`, {
    method: 'GET',
  });
}

export async function submitQuestionAnswer(
  questionId: string,
  selectedOptionId: 'A' | 'B' | 'C' | 'D'
): Promise<SubmitQuestionAnswerResponse> {
  return apiRequest<SubmitQuestionAnswerResponse>('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ questionId, selectedOptionId }),
  });
}

export async function fetchSimuladosCatalog(): Promise<SimuladosCatalogResponse> {
  return apiRequest<SimuladosCatalogResponse>('/api/simulados', {
    method: 'GET',
  });
}

export async function startSimuladoSession(params: {
  presetId?: string;
  customConfig?: {
    disciplineId: string;
    difficulty: string;
    questionCount: number;
    timeLimitMinutes: number;
  };
}): Promise<StartSimuladoResponse> {
  return apiRequest<StartSimuladoResponse>('/api/simulados', {
    method: 'POST',
    body: JSON.stringify({
      action: 'start',
      presetId: params.presetId,
      customConfig: params.customConfig,
    }),
  });
}

export async function finishSimuladoSession(params: {
  sessionId: string;
  userAnswers: Record<number, 'A' | 'B' | 'C' | 'D'>;
}): Promise<FinishSimuladoResponse> {
  return apiRequest<FinishSimuladoResponse>('/api/simulados', {
    method: 'POST',
    body: JSON.stringify({
      action: 'finish',
      sessionId: params.sessionId,
      userAnswers: params.userAnswers,
    }),
  });
}

export async function fetchBriefsCatalog(): Promise<BriefsResponse> {
  return apiRequest<BriefsResponse>('/api/briefs', {
    method: 'GET',
  });
}

export async function fetchMaterialsCatalog(): Promise<MaterialsResponse> {
  return apiRequest<MaterialsResponse>('/api/materials', {
    method: 'GET',
  });
}
