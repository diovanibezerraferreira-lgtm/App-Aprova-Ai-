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

export interface PerformancePeriodComparison {
  periodDays: 7 | 30 | 90;
  hasEnoughData: boolean;
  minRequiredPerPeriod: number;
  currentCount: number;
  previousCount: number;
  currentAccuracy: number | null;
  previousAccuracy: number | null;
  accuracyDelta: number | null;
  volumeDelta: number;
}

export interface PerformanceEvolutionPoint {
  dateKey: string;
  label: string;
  answered: number;
  correct: number;
  incorrect: number;
  accuracyPercent: number;
}

export interface PerformanceEvolutionSeries {
  periodDays: 7 | 30 | 90;
  totalAnswered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercent: number;
  activeDays: number;
  hasEnoughData: boolean;
  insufficientReason: string | null;
  points: PerformanceEvolutionPoint[];
  comparison: PerformancePeriodComparison;
}

export interface PerformanceDisciplineItem {
  disciplineId: string;
  disciplineName: string;
  shortName: string;
  oabWeight: number;
  answered: number;
  correct: number;
  incorrect: number;
  accuracyPercent: number;
  needsAttention: boolean;
  attentionReason: string | null;
  status: 'strong' | 'evolving' | 'attention' | 'insufficient';
  statusLabel: string;
}

export interface PerformanceUnstudiedDiscipline {
  disciplineId: string;
  disciplineName: string;
  shortName: string;
  oabWeight: number;
  catalogCount: number;
}

export interface PerformanceSubjectItem {
  disciplineId: string;
  disciplineName: string;
  subject: string;
  answered: number;
  correct: number;
  incorrect: number;
  accuracyPercent: number;
  catalogCount: number;
}

export interface PerformanceErrorHistoryItem {
  questionId: string;
  disciplineId: string;
  disciplineName: string;
  subject: string;
  statement: string;
  answeredAt: number;
  answeredAtIso: string;
  selectedOptionId: 'A' | 'B' | 'C' | 'D';
  selectedOptionText: string;
  correctOptionId: 'A' | 'B' | 'C' | 'D' | null;
  correctOptionText: string;
  explanation: string;
  legalFoundation: string;
  difficulty: string;
  examReference: string | null;
}

export interface PerformanceSimuladoHistoryItem {
  id: string;
  configTitle: string;
  disciplineId: string;
  disciplineName: string;
  totalQuestions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  accuracyPercent: number;
  timeSpentSeconds: number;
  dateIso: string;
}

export interface PerformanceRecommendationItem {
  id: string;
  priority: 'alta' | 'media' | 'informativa';
  category: 'disciplina' | 'assunto' | 'revisao' | 'cobertura' | 'simulado';
  title: string;
  description: string;
  metricSummary: string;
  actionLabel: string;
  targetDisciplineId?: string;
  targetQuestionIds?: string[];
}

export interface PerformanceReportResponse {
  generatedAt: string;
  isPremium: boolean;
  subscriptionStatus: string;
  overview: {
    hasAnswers: boolean;
    totalAnswered: number;
    totalCorrect: number;
    totalIncorrect: number;
    accuracyPercent: number;
    todayAnswered: number;
    simuladosCompleted: number;
    studiedDisciplinesCount: number;
    totalDisciplinesCount: number;
    periodComparison: PerformancePeriodComparison;
  };
  evolution: Record<'7' | '30' | '90', PerformanceEvolutionSeries>;
  disciplines: PerformanceDisciplineItem[];
  unstudiedDisciplines: PerformanceUnstudiedDiscipline[];
  subjects: {
    hasEnoughData: boolean;
    minAnswersPerSubject: number;
    totalTrackedSubjects: number;
    strongest: PerformanceSubjectItem[];
    weakest: PerformanceSubjectItem[];
    understudied: PerformanceSubjectItem[];
  };
  errorHistory: {
    totalErrors: number;
    filteredTotal: number;
    selectedDisciplineId: string;
    page: number;
    limit: number;
    totalPages: number;
    availableDisciplines: { disciplineId: string; disciplineName: string; count: number }[];
    retryableQuestionIds: string[];
    items: PerformanceErrorHistoryItem[];
  };
  simuladosHistory: {
    total: number;
    averageAccuracy: number | null;
    page: number;
    limit: number;
    totalPages: number;
    items: PerformanceSimuladoHistoryItem[];
  };
  recommendations: {
    hasEnoughData: boolean;
    minRequiredAnswers: number;
    currentAnswers: number;
    message: string | null;
    items: PerformanceRecommendationItem[];
  };
}

export async function fetchQuestionsFeed(params: {
  disciplineId?: string;
  subject?: string;
  difficulty?: string;
  page?: number;
  limit?: number;
  questionIds?: string[];
}): Promise<QuestionsFeedResponse> {
  const search = new URLSearchParams();
  if (params.questionIds && params.questionIds.length > 0) {
    search.set('questionIds', params.questionIds.slice(0, 50).join(','));
  } else {
    if (params.disciplineId) search.set('disciplineId', params.disciplineId);
    if (params.subject) search.set('subject', params.subject);
    if (params.difficulty) search.set('difficulty', params.difficulty);
    if (params.page) search.set('page', String(params.page));
    if (params.limit) search.set('limit', String(params.limit));
  }

  return apiRequest<QuestionsFeedResponse>(`/api/questions?${search.toString()}`, {
    method: 'GET',
  });
}

export async function fetchPerformanceReport(params?: {
  errorsPage?: number;
  errorsLimit?: number;
  errorDisciplineId?: string;
  simuladosPage?: number;
  simuladosLimit?: number;
}): Promise<PerformanceReportResponse> {
  const search = new URLSearchParams();
  if (params?.errorsPage) search.set('errorsPage', String(params.errorsPage));
  if (params?.errorsLimit) search.set('errorsLimit', String(params.errorsLimit));
  if (params?.errorDisciplineId && params.errorDisciplineId !== 'todas') {
    search.set('errorDisciplineId', params.errorDisciplineId);
  }
  if (params?.simuladosPage) search.set('simuladosPage', String(params.simuladosPage));
  if (params?.simuladosLimit) search.set('simuladosLimit', String(params.simuladosLimit));

  const qs = search.toString();
  return apiRequest<PerformanceReportResponse>(
    qs ? `/api/performance-report?${qs}` : '/api/performance-report',
    { method: 'GET' }
  );
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

// ============================================================================
// Plano de Estudos & Calendário
// ============================================================================

export type StudyActivityType =
  | 'revisao'
  | 'apostila'
  | 'questoes'
  | 'simulado'
  | 'peca';

export type StudyActivityStatus = 'planned' | 'completed' | 'cancelled';
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PreferredTimeSlot = 'manha' | 'tarde' | 'noite' | 'madrugada';

export interface StudyReminderSettings {
  enabled: boolean;
  time: string;
  days: WeekdayIndex[];
  browserNotificationsEnabled: boolean;
}

export interface StudyPlanConfig {
  isConfigured: boolean;
  dailyGoalQuestions: number;
  weeklyGoalQuestions: number;
  weeklyGoalHours: number;
  availableDays: WeekdayIndex[];
  preferredTimeSlots: PreferredTimeSlot[];
  selectedDisciplines: string[];
  weeklySchedule: Record<string, string[]>;
  reminders: StudyReminderSettings;
  updatedAt: string | null;
}

export interface StudyActivityItem {
  id: string;
  title: string;
  type: StudyActivityType;
  disciplineId: string;
  disciplineName: string;
  subject: string;
  date: string;
  startTime: string;
  plannedMinutes: number;
  actualMinutes: number;
  status: StudyActivityStatus;
  notes: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyCalendarDaySummary {
  dateKey: string;
  questionsAnswered: number;
  questionsCorrect: number;
  simuladosCompleted: number;
  simuladosMinutes: number;
  plannedActivities: number;
  completedActivities: number;
  cancelledActivities: number;
  plannedMinutes: number;
  loggedActivityMinutes: number;
  totalLoggedMinutes: number;
  hasRealActivity: boolean;
}

export interface StudyActivityTypeBreakdown {
  type: StudyActivityType;
  label: string;
  plannedCount: number;
  completedCount: number;
  plannedMinutes: number;
  loggedMinutes: number;
}

export interface StudyPlanSuggestedDistribution {
  basedOnPerformance: boolean;
  summary: string;
  rationale: string[];
  schedule: Record<string, string[]>;
  recommendedDailyMinutes: number;
  recommendedDailyQuestions: number;
}

export interface StudyPlanTracking {
  todayDateKey: string;
  weekStartKey: string;
  weekEndKey: string;
  todayAnswered: number;
  dailyGoalQuestions: number;
  dailyGoalPercent: number;
  weekAnswered: number;
  weeklyGoalQuestions: number;
  weeklyQuestionsPercent: number;
  weeklyGoalMinutes: number;
  weeklyPlannedMinutes: number;
  weeklyLoggedActivityMinutes: number;
  weeklySimuladosMinutes: number;
  weeklyTotalLoggedMinutes: number;
  weeklyHoursPercent: number;
  totalLoggedMinutesAllTime: number;
  activitiesTotalPlanned: number;
  activitiesTotalCompleted: number;
  activitiesTotalCancelled: number;
  weekActivitiesPlanned: number;
  weekActivitiesCompleted: number;
  weekSimuladosCompleted: number;
  totalSimuladosCompleted: number;
  currentStreakDays: number;
  longestStreakDays: number;
  activeDaysThisWeek: number;
  activeDaysThisMonth: number;
  calendarDays: Record<string, StudyCalendarDaySummary>;
  byActivityType: StudyActivityTypeBreakdown[];
}

export interface StudyPlanResponse {
  generatedAt: string;
  isPremium: boolean;
  subscriptionStatus: string;
  plan: StudyPlanConfig;
  activities: StudyActivityItem[];
  tracking: StudyPlanTracking;
  suggestedDistribution: StudyPlanSuggestedDistribution;
  remindersCapabilities: {
    browserLocalSupported: boolean;
    backgroundPushConfigured: boolean;
    pushLimitationNote: string;
  };
}

export interface StudyActivityActionResponse {
  activity: StudyActivityItem;
  report: StudyPlanResponse;
}

export async function fetchStudyPlan(): Promise<StudyPlanResponse> {
  return apiRequest<StudyPlanResponse>('/api/study-plan', {
    method: 'GET',
  });
}

export async function saveStudyPlanConfig(
  plan: Partial<StudyPlanConfig>
): Promise<StudyPlanResponse> {
  return apiRequest<StudyPlanResponse>('/api/study-plan', {
    method: 'PUT',
    body: JSON.stringify({ plan }),
  });
}

export async function createStudyActivity(input: {
  type: StudyActivityType;
  disciplineId: string;
  subject?: string;
  title?: string;
  date: string;
  startTime: string;
  plannedMinutes: number;
  actualMinutes?: number;
  status?: 'planned' | 'completed';
  notes?: string;
}): Promise<StudyActivityActionResponse> {
  return apiRequest<StudyActivityActionResponse>('/api/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_activity',
      ...input,
    }),
  });
}

export async function updateStudyActivity(input: {
  activityId: string;
  date?: string;
  startTime?: string;
  type?: StudyActivityType;
  disciplineId?: string;
  subject?: string;
  title?: string;
  plannedMinutes?: number;
  notes?: string;
  restorePlanned?: boolean;
}): Promise<StudyActivityActionResponse> {
  return apiRequest<StudyActivityActionResponse>('/api/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      action: 'update_activity',
      ...input,
    }),
  });
}

export async function completeStudyActivity(input: {
  activityId: string;
  actualMinutes: number;
  notes?: string;
}): Promise<StudyActivityActionResponse> {
  return apiRequest<StudyActivityActionResponse>('/api/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      action: 'complete_activity',
      ...input,
    }),
  });
}

export async function cancelStudyActivity(
  activityId: string
): Promise<StudyActivityActionResponse> {
  return apiRequest<StudyActivityActionResponse>('/api/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      action: 'cancel_activity',
      activityId,
    }),
  });
}

export async function reopenStudyActivity(
  activityId: string
): Promise<StudyActivityActionResponse> {
  return apiRequest<StudyActivityActionResponse>('/api/study-plan', {
    method: 'POST',
    body: JSON.stringify({
      action: 'reopen_activity',
      activityId,
    }),
  });
}
