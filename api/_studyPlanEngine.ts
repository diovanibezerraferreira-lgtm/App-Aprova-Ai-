import type { Discipline, Question } from '../src/types/index.js';
import {
  normalizeTimestampMs,
  getSaoPauloDateKey,
  MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION,
  type RawAnswerRecord,
  type RawSimuladoRecord,
} from './_performanceAnalytics.js';

export type StudyActivityType =
  | 'revisao'
  | 'apostila'
  | 'questoes'
  | 'simulado'
  | 'peca';

export type StudyActivityStatus = 'planned' | 'completed' | 'cancelled';

export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Dom ... 6=Sáb

export type PreferredTimeSlot = 'manha' | 'tarde' | 'noite' | 'madrugada';

export interface StudyReminderSettings {
  enabled: boolean;
  time: string; // HH:mm
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
  weeklySchedule: Record<string, string[]>; // key: '0'..'6', value: disciplineId[]
  reminders: StudyReminderSettings;
  updatedAt: string | null;
}

export interface StudyActivityRecord {
  id: string;
  title: string;
  type: StudyActivityType;
  disciplineId: string;
  disciplineName: string;
  subject: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  plannedMinutes: number;
  actualMinutes: number;
  status: StudyActivityStatus;
  notes: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarDaySummary {
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

export interface ActivityTypeBreakdown {
  type: StudyActivityType;
  label: string;
  plannedCount: number;
  completedCount: number;
  plannedMinutes: number;
  loggedMinutes: number;
}

export interface SuggestedWeeklyDistribution {
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
  calendarDays: Record<string, CalendarDaySummary>;
  byActivityType: ActivityTypeBreakdown[];
}

export interface StudyPlanPayload {
  generatedAt: string;
  isPremium: boolean;
  subscriptionStatus: string;
  plan: StudyPlanConfig;
  activities: StudyActivityRecord[];
  tracking: StudyPlanTracking;
  suggestedDistribution: SuggestedWeeklyDistribution;
  remindersCapabilities: {
    browserLocalSupported: boolean;
    backgroundPushConfigured: boolean;
    pushLimitationNote: string;
  };
}

export const ACTIVITY_TYPE_LABELS: Record<StudyActivityType, string> = {
  revisao: 'Revisão de conteúdo',
  apostila: 'Leitura de apostila',
  questoes: 'Resolução de questões',
  simulado: 'Simulado',
  peca: 'Estudo de peça processual',
};

export const VALID_ACTIVITY_TYPES: StudyActivityType[] = [
  'revisao',
  'apostila',
  'questoes',
  'simulado',
  'peca',
];

export const VALID_TIME_SLOTS: PreferredTimeSlot[] = [
  'manha',
  'tarde',
  'noite',
  'madrugada',
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function createDefaultStudyPlan(dailyGoalQuestions = 20): StudyPlanConfig {
  const safeDaily = clampInt(dailyGoalQuestions, 5, 200, 20);
  return {
    isConfigured: false,
    dailyGoalQuestions: safeDaily,
    weeklyGoalQuestions: safeDaily * 5,
    weeklyGoalHours: 10,
    availableDays: [1, 2, 3, 4, 5],
    preferredTimeSlots: ['noite'],
    selectedDisciplines: ['etica', 'constitucional', 'civil', 'processo-civil', 'penal'],
    weeklySchedule: {},
    reminders: {
      enabled: false,
      time: '19:00',
      days: [1, 2, 3, 4, 5],
      browserNotificationsEnabled: false,
    },
    updatedAt: null,
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.round(num * 2) / 2; // Allow half-hours (e.g. 10.5h)
  return Math.min(max, Math.max(min, rounded));
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  const [y, m, d] = trimmed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidTimeString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return false;
  const [hh, mm] = trimmed.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export function dateKeyToDayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

export function dayIndexToDateKey(dayIndex: number): string {
  const dt = new Date(dayIndex * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekdayFromDateKey(dateKey: string): WeekdayIndex {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as WeekdayIndex;
}

/**
 * Computes Monday..Sunday week bounds in America/Sao_Paulo for a given YYYY-MM-DD dateKey.
 */
export function getWeekBounds(dateKey: string): { weekStartKey: string; weekEndKey: string } {
  const dayIdx = dateKeyToDayIndex(dateKey);
  const weekday = getWeekdayFromDateKey(dateKey); // 0=Sun, 1=Mon...6=Sat
  const offsetFromMonday = weekday === 0 ? 6 : weekday - 1;
  const weekStartIdx = dayIdx - offsetFromMonday;
  const weekEndIdx = weekStartIdx + 6;
  return {
    weekStartKey: dayIndexToDateKey(weekStartIdx),
    weekEndKey: dayIndexToDateKey(weekEndIdx),
  };
}

export function sanitizeStudyPlanInput(
  raw: any,
  validDisciplineIds: Set<string>,
  fallbackDailyGoal = 20
): StudyPlanConfig {
  const defaults = createDefaultStudyPlan(fallbackDailyGoal);
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const dailyGoalQuestions = clampInt(
    raw.dailyGoalQuestions,
    5,
    200,
    defaults.dailyGoalQuestions
  );
  const weeklyGoalQuestions = clampInt(
    raw.weeklyGoalQuestions,
    10,
    1400,
    dailyGoalQuestions * 5
  );
  const weeklyGoalHours = clampNumber(raw.weeklyGoalHours, 1, 80, defaults.weeklyGoalHours);

  const rawDays: unknown[] = Array.isArray(raw.availableDays) ? raw.availableDays : defaults.availableDays;
  const availableDays = Array.from(
    new Set(
      rawDays
        .map((d) => Number(d))
        .filter((d): d is WeekdayIndex => Number.isInteger(d) && d >= 0 && d <= 6)
    )
  ).sort((a, b) => a - b);

  const rawSlots: unknown[] = Array.isArray(raw.preferredTimeSlots)
    ? raw.preferredTimeSlots
    : defaults.preferredTimeSlots;
  const preferredTimeSlots = Array.from(
    new Set(
      rawSlots.filter((s): s is PreferredTimeSlot =>
        typeof s === 'string' && (VALID_TIME_SLOTS as string[]).includes(s)
      )
    )
  );

  const rawDisciplines: unknown[] = Array.isArray(raw.selectedDisciplines)
    ? raw.selectedDisciplines
    : defaults.selectedDisciplines;
  const selectedDisciplines = Array.from(
    new Set(
      rawDisciplines
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter((id) => Boolean(id) && validDisciplineIds.has(id))
    )
  );

  const weeklySchedule: Record<string, string[]> = {};
  if (raw.weeklySchedule && typeof raw.weeklySchedule === 'object') {
    for (const key of ['0', '1', '2', '3', '4', '5', '6']) {
      const list = (raw.weeklySchedule as Record<string, unknown>)[key];
      if (Array.isArray(list)) {
        const clean = Array.from(
          new Set(
            list
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id) => Boolean(id) && validDisciplineIds.has(id))
          )
        ).slice(0, 6);
        if (clean.length > 0) {
          weeklySchedule[key] = clean;
        }
      }
    }
  }

  const rawReminders = raw.reminders && typeof raw.reminders === 'object' ? raw.reminders : {};
  const reminderDaysRaw: unknown[] = Array.isArray(rawReminders.days)
    ? rawReminders.days
    : availableDays;
  const reminderDays = Array.from(
    new Set(
      reminderDaysRaw
        .map((d) => Number(d))
        .filter((d): d is WeekdayIndex => Number.isInteger(d) && d >= 0 && d <= 6)
    )
  ).sort((a, b) => a - b);

  return {
    isConfigured: raw.isConfigured === false ? false : true,
    dailyGoalQuestions,
    weeklyGoalQuestions,
    weeklyGoalHours,
    availableDays: availableDays.length > 0 ? availableDays : [1, 2, 3, 4, 5],
    preferredTimeSlots: preferredTimeSlots.length > 0 ? preferredTimeSlots : ['noite'],
    selectedDisciplines,
    weeklySchedule,
    reminders: {
      enabled: Boolean(rawReminders.enabled),
      time: isValidTimeString(rawReminders.time) ? rawReminders.time.trim() : '19:00',
      days: reminderDays,
      browserNotificationsEnabled: Boolean(rawReminders.browserNotificationsEnabled),
    },
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function normalizeStoredActivity(
  id: string,
  raw: Record<string, any>,
  disciplineMap: Map<string, Discipline>
): StudyActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const date = isValidDateKey(raw.date) ? raw.date.trim() : null;
  if (!date) return null;

  const type: StudyActivityType = (VALID_ACTIVITY_TYPES as string[]).includes(String(raw.type))
    ? (raw.type as StudyActivityType)
    : 'revisao';

  const disciplineId =
    typeof raw.disciplineId === 'string' && raw.disciplineId.trim()
      ? raw.disciplineId.trim()
      : 'geral';
  const disciplineName =
    disciplineId === 'geral' || disciplineId === 'todas'
      ? 'Estudo Geral'
      : disciplineMap.get(disciplineId)?.name || disciplineId;

  const status: StudyActivityStatus =
    raw.status === 'completed' || raw.status === 'cancelled' ? raw.status : 'planned';

  const plannedMinutes = clampInt(raw.plannedMinutes, 5, 600, 45);
  const actualMinutes =
    status === 'completed'
      ? clampInt(raw.actualMinutes, 1, 600, plannedMinutes)
      : clampInt(raw.actualMinutes, 0, 600, 0);

  const subject =
    typeof raw.subject === 'string' ? raw.subject.trim().slice(0, 140) : '';
  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 160)
      : `${ACTIVITY_TYPE_LABELS[type]} · ${disciplineName}`;

  const startTime = isValidTimeString(raw.startTime) ? raw.startTime.trim() : '19:00';
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 600) : '';
  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt.trim()
      ? raw.createdAt.trim()
      : new Date().toISOString();
  const updatedAt =
    typeof raw.updatedAt === 'string' && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : createdAt;
  const completedAt =
    status === 'completed' && typeof raw.completedAt === 'string' && raw.completedAt.trim()
      ? raw.completedAt.trim()
      : null;

  return {
    id,
    title,
    type,
    disciplineId,
    disciplineName,
    subject,
    date,
    startTime,
    plannedMinutes,
    actualMinutes,
    status,
    notes,
    completedAt,
    createdAt,
    updatedAt,
  };
}

export function computeStudyStreaks(
  activeDateKeys: Set<string>,
  todayDateKey: string
): { currentStreakDays: number; longestStreakDays: number } {
  if (activeDateKeys.size === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  const sortedIndices = Array.from(activeDateKeys)
    .filter(isValidDateKey)
    .map(dateKeyToDayIndex)
    .sort((a, b) => a - b);

  if (sortedIndices.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  let longest = 1;
  let running = 1;
  for (let i = 1; i < sortedIndices.length; i++) {
    if (sortedIndices[i] === sortedIndices[i - 1] + 1) {
      running += 1;
      if (running > longest) longest = running;
    } else if (sortedIndices[i] > sortedIndices[i - 1] + 1) {
      running = 1;
    }
  }

  const activeIndexSet = new Set(sortedIndices);
  const todayIdx = dateKeyToDayIndex(todayDateKey);
  // Streak is active if student studied today OR yesterday (grace window while today is still in progress)
  let anchorIdx: number | null = null;
  if (activeIndexSet.has(todayIdx)) {
    anchorIdx = todayIdx;
  } else if (activeIndexSet.has(todayIdx - 1)) {
    anchorIdx = todayIdx - 1;
  }

  let current = 0;
  if (anchorIdx !== null) {
    let cursor = anchorIdx;
    while (activeIndexSet.has(cursor)) {
      current += 1;
      cursor -= 1;
    }
  }

  return {
    currentStreakDays: current,
    longestStreakDays: longest,
  };
}

export function generateSuggestedWeeklySchedule(params: {
  plan: StudyPlanConfig;
  disciplines: Discipline[];
  answers: RawAnswerRecord[];
  questionsMap: Map<string, Question>;
}): SuggestedWeeklyDistribution {
  const { plan, disciplines, answers, questionsMap } = params;
  const disciplineMap = new Map<string, Discipline>(disciplines.map((d) => [d.id, d]));

  const availableDays: WeekdayIndex[] =
    plan.availableDays.length > 0 ? plan.availableDays : [1, 2, 3, 4, 5];

  // Choose target pool: student's selected disciplines or top 6 OAB weight disciplines
  const targetDisciplineIds =
    plan.selectedDisciplines.length > 0
      ? plan.selectedDisciplines.filter((id) => disciplineMap.has(id))
      : [...disciplines]
          .sort((a, b) => b.oabWeight - a.oabWeight)
          .slice(0, 6)
          .map((d) => d.id);

  // Deduplicate real answers by questionId to evaluate discipline performance honestly
  const dedupedAnswers = new Map<string, RawAnswerRecord>();
  for (const ans of answers) {
    if (!ans || typeof ans.questionId !== 'string' || !ans.questionId.trim()) continue;
    dedupedAnswers.set(ans.questionId.trim(), ans);
  }

  const perfByDiscipline = new Map<string, { answered: number; correct: number }>();
  for (const ans of dedupedAnswers.values()) {
    const q = questionsMap.get(ans.questionId);
    const discId = q?.disciplineId || ans.disciplineId || '';
    if (!discId || !disciplineMap.has(discId)) continue;
    const bucket = perfByDiscipline.get(discId) || { answered: 0, correct: 0 };
    bucket.answered += 1;
    if (ans.isCorrect) bucket.correct += 1;
    perfByDiscipline.set(discId, bucket);
  }

  let basedOnPerformance = false;
  const scored = targetDisciplineIds.map((id) => {
    const disc = disciplineMap.get(id)!;
    const stats = perfByDiscipline.get(id);
    const answered = stats?.answered || 0;
    const accuracy = answered > 0 ? Math.round(((stats?.correct || 0) / answered) * 100) : null;

    let priorityScore = disc.oabWeight * 3;
    let reason = `Peso relevante na OAB (${disc.oabWeight} questões)`;

    if (answered >= MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION && accuracy !== null) {
      basedOnPerformance = true;
      if (accuracy < 60) {
        priorityScore += 50;
        reason = `Reforço prioritário (${accuracy}% de acerto em ${answered} questões)`;
      } else if (accuracy < 72) {
        priorityScore += 25;
        reason = `Em consolidação (${accuracy}% de acerto em ${answered} questões)`;
      } else {
        priorityScore += 5;
        reason = `Manutenção (${accuracy}% de acerto em ${answered} questões)`;
      }
    } else if (answered === 0) {
      priorityScore += 15;
      reason = `Ainda não iniciada no histórico (peso ${disc.oabWeight})`;
    }

    return {
      disciplineId: id,
      disciplineName: disc.name,
      oabWeight: disc.oabWeight,
      priorityScore,
      accuracy,
      answered,
      reason,
    };
  });

  scored.sort(
    (a, b) =>
      b.priorityScore - a.priorityScore ||
      b.oabWeight - a.oabWeight ||
      a.disciplineName.localeCompare(b.disciplineName, 'pt-BR')
  );

  // Target 1-2 disciplines per available day depending on daily hours / discipline count
  const avgDailyMinutes = Math.max(
    30,
    Math.round((plan.weeklyGoalHours * 60) / Math.max(1, availableDays.length))
  );
  const slotsPerDay =
    scored.length > availableDays.length || avgDailyMinutes >= 90 ? 2 : 1;
  const totalSlots = availableDays.length * slotsPerDay;

  // Build weighted slot queue: top priority disciplines get extra slots when capacity permits
  const slotQueue: string[] = [];
  if (scored.length > 0) {
    // First pass: guarantee every selected discipline appears at least once (up to totalSlots)
    for (const item of scored) {
      if (slotQueue.length < totalSlots) {
        slotQueue.push(item.disciplineId);
      }
    }
    // Second pass: fill remaining slots with highest-priority disciplines
    let cursor = 0;
    while (slotQueue.length < totalSlots) {
      const candidate = scored[cursor % Math.min(scored.length, 4)];
      slotQueue.push(candidate.disciplineId);
      cursor += 1;
    }
  }

  const schedule: Record<string, string[]> = {};
  for (const day of availableDays) {
    schedule[String(day)] = [];
  }

  // Distribute across available days avoiding duplicate discipline on the exact same day
  for (let i = 0; i < slotQueue.length; i++) {
    const discId = slotQueue[i];
    const primaryDayIdx = i % availableDays.length;
    let placed = false;

    for (let offset = 0; offset < availableDays.length; offset++) {
      const dayKey = String(availableDays[(primaryDayIdx + offset) % availableDays.length]);
      if (schedule[dayKey].length < slotsPerDay && !schedule[dayKey].includes(discId)) {
        schedule[dayKey].push(discId);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const fallbackDayKey = String(availableDays[primaryDayIdx]);
      if (!schedule[fallbackDayKey].includes(discId)) {
        schedule[fallbackDayKey].push(discId);
      }
    }
  }

  const rationale = scored.slice(0, 4).map((item) => `${item.disciplineName}: ${item.reason}.`);
  const recommendedDailyQuestions = Math.max(
    5,
    Math.round(plan.weeklyGoalQuestions / Math.max(1, availableDays.length))
  );

  const summary = basedOnPerformance
    ? `Distribuição sugerida para ${availableDays.length} ${
        availableDays.length === 1 ? 'dia disponível' : 'dias disponíveis'
      }, priorizando disciplinas com menor aproveitamento real e maior peso na OAB.`
    : `Distribuição sugerida para ${availableDays.length} ${
        availableDays.length === 1 ? 'dia disponível' : 'dias disponíveis'
      }, equilibrando suas disciplinas escolhidas pelo peso da prova (responda ao menos ${MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION} questões por disciplina para ajustes por desempenho).`;

  return {
    basedOnPerformance,
    summary,
    rationale,
    schedule,
    recommendedDailyMinutes: avgDailyMinutes,
    recommendedDailyQuestions,
  };
}

export interface BuildStudyPlanPayloadParams {
  userData: Record<string, any>;
  rawActivities: Array<{ id: string; data: Record<string, any> }>;
  answers: RawAnswerRecord[];
  simulados: RawSimuladoRecord[];
  disciplines: Discipline[];
  questionsMap: Map<string, Question>;
  isPremium: boolean;
  subscriptionStatus: string;
  nowMs?: number;
}

export function buildStudyPlanPayload(
  params: BuildStudyPlanPayloadParams
): StudyPlanPayload {
  const nowMs = params.nowMs ?? Date.now();
  const todayDateKey = getSaoPauloDateKey(nowMs);
  const { weekStartKey, weekEndKey } = getWeekBounds(todayDateKey);
  const currentMonthPrefix = todayDateKey.slice(0, 7); // YYYY-MM

  const disciplineMap = new Map<string, Discipline>(params.disciplines.map((d) => [d.id, d]));
  const validDisciplineIds = new Set<string>(params.disciplines.map((d) => d.id));

  const fallbackDailyGoal = clampInt(params.userData?.dailyGoalQuestions, 5, 200, 20);
  const storedPlanRaw = params.userData?.studyPlan;
  const plan: StudyPlanConfig = storedPlanRaw
    ? sanitizeStudyPlanInput(
        {
          ...storedPlanRaw,
          // Keep dailyGoalQuestions synchronized with root profile field
          dailyGoalQuestions:
            storedPlanRaw.dailyGoalQuestions ?? fallbackDailyGoal,
          isConfigured: storedPlanRaw.isConfigured ?? true,
        },
        validDisciplineIds,
        fallbackDailyGoal
      )
    : createDefaultStudyPlan(fallbackDailyGoal);

  // Normalize activities sorted chronologically (date ASC, startTime ASC)
  const activities: StudyActivityRecord[] = [];
  for (const item of params.rawActivities) {
    const normalized = normalizeStoredActivity(item.id, item.data, disciplineMap);
    if (normalized) activities.push(normalized);
  }
  activities.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.createdAt.localeCompare(b.createdAt)
  );

  // Calendar day accumulator
  const calendarDays: Record<string, CalendarDaySummary> = {};
  const ensureDay = (dateKey: string): CalendarDaySummary => {
    if (!calendarDays[dateKey]) {
      calendarDays[dateKey] = {
        dateKey,
        questionsAnswered: 0,
        questionsCorrect: 0,
        simuladosCompleted: 0,
        simuladosMinutes: 0,
        plannedActivities: 0,
        completedActivities: 0,
        cancelledActivities: 0,
        plannedMinutes: 0,
        loggedActivityMinutes: 0,
        totalLoggedMinutes: 0,
        hasRealActivity: false,
      };
    }
    return calendarDays[dateKey];
  };

  const realActivityDateKeys = new Set<string>();

  // 1. Deduplicate answers strictly by questionId (each question counted at most ONCE per history rule)
  const uniqueAnswers = new Map<string, { isCorrect: boolean; timestampMs: number | null }>();
  for (const raw of params.answers) {
    if (!raw || typeof raw.questionId !== 'string' || !raw.questionId.trim()) continue;
    const qId = raw.questionId.trim();
    const ts = normalizeTimestampMs(raw.timestamp ?? raw.updatedAt);
    const existing = uniqueAnswers.get(qId);
    if (!existing || (ts !== null && (existing.timestampMs === null || ts >= existing.timestampMs))) {
      uniqueAnswers.set(qId, {
        isCorrect: Boolean(raw.isCorrect),
        timestampMs: ts,
      });
    }
  }

  let todayAnswered = 0;
  let weekAnswered = 0;

  for (const ans of uniqueAnswers.values()) {
    if (ans.timestampMs === null) continue;
    const dateKey = getSaoPauloDateKey(ans.timestampMs);
    const day = ensureDay(dateKey);
    day.questionsAnswered += 1;
    if (ans.isCorrect) day.questionsCorrect += 1;
    day.hasRealActivity = true;
    realActivityDateKeys.add(dateKey);

    if (dateKey === todayDateKey) todayAnswered += 1;
    if (dateKey >= weekStartKey && dateKey <= weekEndKey) weekAnswered += 1;
  }

  // 2. Integrate completed simulados (read-only, deduplicated by simulado id)
  const uniqueSimulados = new Map<string, RawSimuladoRecord>();
  for (const sim of params.simulados) {
    if (!sim || typeof sim.id !== 'string' || !sim.id.trim()) continue;
    uniqueSimulados.set(sim.id.trim(), sim);
  }

  let weekSimuladosCompleted = 0;
  let weeklySimuladosMinutes = 0;
  let totalSimuladosMinutesAllTime = 0;

  for (const sim of uniqueSimulados.values()) {
    const ts = normalizeTimestampMs(sim.date ?? sim.createdAt);
    const durationMinutes = Math.max(0, Math.round((Number(sim.timeSpentSeconds) || 0) / 60));
    totalSimuladosMinutesAllTime += durationMinutes;

    if (ts === null) continue;
    const dateKey = getSaoPauloDateKey(ts);
    const day = ensureDay(dateKey);
    day.simuladosCompleted += 1;
    day.simuladosMinutes += durationMinutes;
    day.totalLoggedMinutes += durationMinutes;
    day.hasRealActivity = true;
    realActivityDateKeys.add(dateKey);

    if (dateKey >= weekStartKey && dateKey <= weekEndKey) {
      weekSimuladosCompleted += 1;
      weeklySimuladosMinutes += durationMinutes;
    }
  }

  // 3. Aggregate planned vs completed vs cancelled activities (NEVER auto-completing planned ones)
  let activitiesTotalPlanned = 0;
  let activitiesTotalCompleted = 0;
  let activitiesTotalCancelled = 0;
  let weekActivitiesPlanned = 0;
  let weekActivitiesCompleted = 0;
  let weeklyPlannedMinutes = 0;
  let weeklyLoggedActivityMinutes = 0;
  let totalLoggedActivityMinutesAllTime = 0;

  const typeMap = new Map<StudyActivityType, ActivityTypeBreakdown>();
  for (const t of VALID_ACTIVITY_TYPES) {
    typeMap.set(t, {
      type: t,
      label: ACTIVITY_TYPE_LABELS[t],
      plannedCount: 0,
      completedCount: 0,
      plannedMinutes: 0,
      loggedMinutes: 0,
    });
  }

  for (const act of activities) {
    const inCurrentWeek = act.date >= weekStartKey && act.date <= weekEndKey;
    const day = ensureDay(act.date);
    const typeStat = typeMap.get(act.type)!;

    if (act.status === 'cancelled') {
      activitiesTotalCancelled += 1;
      day.cancelledActivities += 1;
      continue;
    }

    // Both 'planned' and 'completed' represent scheduled/planned commitments
    activitiesTotalPlanned += 1;
    day.plannedActivities += 1;
    day.plannedMinutes += act.plannedMinutes;
    typeStat.plannedCount += 1;
    typeStat.plannedMinutes += act.plannedMinutes;

    if (inCurrentWeek) {
      weekActivitiesPlanned += 1;
      weeklyPlannedMinutes += act.plannedMinutes;
    }

    if (act.status === 'completed') {
      activitiesTotalCompleted += 1;
      day.completedActivities += 1;
      day.loggedActivityMinutes += act.actualMinutes;
      day.totalLoggedMinutes += act.actualMinutes;
      day.hasRealActivity = true;

      typeStat.completedCount += 1;
      typeStat.loggedMinutes += act.actualMinutes;
      totalLoggedActivityMinutesAllTime += act.actualMinutes;

      const completedDateKey = act.completedAt
        ? (() => {
            const ms = normalizeTimestampMs(act.completedAt);
            return ms !== null ? getSaoPauloDateKey(ms) : act.date;
          })()
        : act.date;
      realActivityDateKeys.add(completedDateKey);
      if (completedDateKey !== act.date) {
        ensureDay(completedDateKey).hasRealActivity = true;
      }

      if (inCurrentWeek) {
        weekActivitiesCompleted += 1;
        weeklyLoggedActivityMinutes += act.actualMinutes;
      }
    }
  }

  const weeklyGoalMinutes = Math.round(plan.weeklyGoalHours * 60);
  const weeklyTotalLoggedMinutes = weeklyLoggedActivityMinutes + weeklySimuladosMinutes;
  const totalLoggedMinutesAllTime = totalLoggedActivityMinutesAllTime + totalSimuladosMinutesAllTime;

  const { currentStreakDays, longestStreakDays } = computeStudyStreaks(
    realActivityDateKeys,
    todayDateKey
  );

  let activeDaysThisWeek = 0;
  let activeDaysThisMonth = 0;
  for (const key of realActivityDateKeys) {
    if (key >= weekStartKey && key <= weekEndKey) activeDaysThisWeek += 1;
    if (key.startsWith(currentMonthPrefix)) activeDaysThisMonth += 1;
  }

  const suggestedDistribution = generateSuggestedWeeklySchedule({
    plan,
    disciplines: params.disciplines,
    answers: params.answers,
    questionsMap: params.questionsMap,
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    isPremium: params.isPremium,
    subscriptionStatus: params.subscriptionStatus,
    plan,
    activities,
    tracking: {
      todayDateKey,
      weekStartKey,
      weekEndKey,
      todayAnswered,
      dailyGoalQuestions: plan.dailyGoalQuestions,
      dailyGoalPercent: Math.min(
        100,
        Math.round((todayAnswered / Math.max(1, plan.dailyGoalQuestions)) * 100)
      ),
      weekAnswered,
      weeklyGoalQuestions: plan.weeklyGoalQuestions,
      weeklyQuestionsPercent: Math.min(
        100,
        Math.round((weekAnswered / Math.max(1, plan.weeklyGoalQuestions)) * 100)
      ),
      weeklyGoalMinutes,
      weeklyPlannedMinutes,
      weeklyLoggedActivityMinutes,
      weeklySimuladosMinutes,
      weeklyTotalLoggedMinutes,
      weeklyHoursPercent: Math.min(
        100,
        Math.round((weeklyTotalLoggedMinutes / Math.max(1, weeklyGoalMinutes)) * 100)
      ),
      totalLoggedMinutesAllTime,
      activitiesTotalPlanned,
      activitiesTotalCompleted,
      activitiesTotalCancelled,
      weekActivitiesPlanned,
      weekActivitiesCompleted,
      weekSimuladosCompleted,
      totalSimuladosCompleted: uniqueSimulados.size,
      currentStreakDays,
      longestStreakDays,
      activeDaysThisWeek,
      activeDaysThisMonth,
      calendarDays,
      byActivityType: Array.from(typeMap.values()),
    },
    suggestedDistribution,
    remindersCapabilities: {
      browserLocalSupported: true,
      backgroundPushConfigured: false,
      pushLimitationNote:
        'Notificações locais no navegador funcionam quando o aplicativo está aberto. Lembretes Push em segundo plano (com o aplicativo fechado) exigem configuração adicional de infraestrutura Web Push/FCM (chaves VAPID e disparador agendado).',
    },
  };
}
