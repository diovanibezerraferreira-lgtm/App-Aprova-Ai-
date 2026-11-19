import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';

export const LEADERBOARD_TIMEZONE = 'America/Sao_Paulo';
export const LEADERBOARD_SCORING_VERSION = 1;
export const LEADERBOARD_CONFIG_DOC_ID = 'default';

export const LEADERBOARD_COLLECTIONS = {
  config: 'leaderboard_config',
  privateProfiles: 'leaderboard_private_profiles',
  events: 'leaderboard_events',
  outbox: 'leaderboard_outbox',
  verifiedActions: 'leaderboard_verified_actions',
  publicProfiles: 'leaderboard_public',
  weekly: 'leaderboard_weekly',
  monthly: 'leaderboard_monthly',
} as const;

export const LEADERBOARD_POINTS = {
  QUESTION_FIRST_VALID_ANSWER: 5,
  QUESTION_CORRECT_BONUS: 5,
  SIMULADO_COMPLETED: 30,
  DAILY_GOAL_COMPLETED: 20,
  WEEKLY_GOAL_COMPLETED: 100,
  STREAK_7_DAYS_COMPLETED: 50,
  AI_TUTOR: 0,
} as const;

export type LeaderboardEventType =
  | 'question_answer'
  | 'simulado_completed'
  | 'daily_goal_completed'
  | 'weekly_goal_completed'
  | 'streak_7d_completed';

export type LeaderboardOutboxKind =
  | 'question_answer'
  | 'simulado_completed'
  | 'study_activity';

export interface LeaderboardConfig {
  active: boolean;
  launchAt: number | null;
  launchAtIso: string | null;
  launchDateKey: string | null;
  timezone: typeof LEADERBOARD_TIMEZONE;
  scoringVersion: number;
  rules: {
    questionFirstAnswer: number;
    questionCorrectBonus: number;
    simuladoCompleted: number;
    dailyGoalCompleted: number;
    weeklyGoalCompleted: number;
    streak7DaysCompleted: number;
    aiTutor: number;
  };
  updatedAt: string | null;
}

export interface LeaderboardPrivateProfile {
  uid: string;
  publicProfileId: string;
  nickname: string;
  avatar: string;
  dailyQuestionCounts: Record<string, number>;
  weeklyQuestionCounts: Record<string, number>;
  activeDateKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LeaderboardPublicProfile {
  publicProfileId: string;
  nickname: string;
  avatar: string;
  totalPoints: number;
  questionsPoints: number;
  simuladosPoints: number;
  goalsPoints: number;
  streakPoints: number;
  questionsAnsweredCount: number;
  questionsCorrectCount: number;
  simuladosCompletedCount: number;
  dailyGoalsCompletedCount: number;
  weeklyGoalsCompletedCount: number;
  streak7dCount: number;
  currentStreakDays: number;
  bestStreakDays: number;
  updatedAt: string;
}

export interface LeaderboardPeriodEntry {
  periodKey: string;
  publicProfileId: string;
  nickname: string;
  avatar: string;
  points: number;
  eventsCount: number;
  updatedAt: string;
}

export interface LeaderboardEventRecord {
  eventId: string;
  uid: string;
  publicProfileId: string;
  type: LeaderboardEventType;
  sourceId: string;
  points: number;
  basePoints: number;
  bonusPoints: number;
  dateKey: string;
  weekKey: string;
  monthKey: string;
  occurredAt: number;
  createdAt: string;
}

export interface LeaderboardOutboxRecord {
  outboxId: string;
  uid: string;
  kind: LeaderboardOutboxKind;
  sourceId: string;
  payload: Record<string, unknown>;
  occurredAt: number;
  status: 'pending' | 'processed' | 'skipped' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface LeaderboardVerifiedActionRecord {
  actionId: string;
  uid: string;
  kind: LeaderboardOutboxKind;
  sourceId: string;
  payload: Record<string, unknown>;
  occurredAt: number;
  serverVerified: true;
  createdAt: string;
}

export interface RetryBackoffOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface AwardedLeaderboardEventSummary {
  eventId: string;
  type: LeaderboardEventType;
  sourceId: string;
  points: number;
  basePoints: number;
  bonusPoints: number;
  dateKey: string;
  weekKey: string;
  monthKey: string;
}

export interface LeaderboardScoringOutcome {
  awarded: boolean;
  totalPointsAwarded: number;
  events: AwardedLeaderboardEventSummary[];
  reason:
    | 'AWARDED'
    | 'DUPLICATE_EVENT'
    | 'RANKING_INACTIVE'
    | 'BEFORE_LAUNCH'
    | 'INVALID_INPUT'
    | 'SESSION_OWNERSHIP_MISMATCH'
    | 'EMPTY_SIMULADO'
    | 'INCOMPLETE_SIMULADO'
    | 'NO_MILESTONE_REACHED'
    | 'TRANSIENT_FAILURE_QUEUED'
    | 'UNAVAILABLE';
  queuedForRecovery?: boolean;
  outboxId?: string;
  secondaryProofPersisted?: boolean;
}

const AVATAR_TOKENS = [
  'av_01',
  'av_02',
  'av_03',
  'av_04',
  'av_05',
  'av_06',
  'av_07',
  'av_08',
  'av_09',
  'av_10',
  'av_11',
  'av_12',
] as const;

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'uid',
  'userId',
  'email',
  'cpf',
  'name',
  'fullName',
  'plan',
  'isPremium',
  'subscriptionStatus',
  'subscriptionId',
  'asaasCustomerId',
  'premiumUntil',
  'paymentMethod',
  'lastPaymentDate',
  'lastConfirmedPaymentId',
  'subscriptionDueDate',
]);

export function getDefaultInactiveLeaderboardConfig(): LeaderboardConfig {
  return {
    active: false,
    launchAt: null,
    launchAtIso: null,
    launchDateKey: null,
    timezone: LEADERBOARD_TIMEZONE,
    scoringVersion: LEADERBOARD_SCORING_VERSION,
    rules: {
      questionFirstAnswer: LEADERBOARD_POINTS.QUESTION_FIRST_VALID_ANSWER,
      questionCorrectBonus: LEADERBOARD_POINTS.QUESTION_CORRECT_BONUS,
      simuladoCompleted: LEADERBOARD_POINTS.SIMULADO_COMPLETED,
      dailyGoalCompleted: LEADERBOARD_POINTS.DAILY_GOAL_COMPLETED,
      weeklyGoalCompleted: LEADERBOARD_POINTS.WEEKLY_GOAL_COMPLETED,
      streak7DaysCompleted: LEADERBOARD_POINTS.STREAK_7_DAYS_COMPLETED,
      aiTutor: LEADERBOARD_POINTS.AI_TUTOR,
    },
    updatedAt: null,
  };
}

export function getSaoPauloDateKeyFromMs(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LEADERBOARD_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestampMs));
}

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays);
  const dt = new Date(utc);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getWeekKeyFromDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return shiftDateKey(dateKey, -daysSinceMonday);
}

export function getMonthKeyFromDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function getPeriodKeysForTimestamp(timestampMs: number): {
  dateKey: string;
  weekKey: string;
  monthKey: string;
} {
  const dateKey = getSaoPauloDateKeyFromMs(timestampMs);
  return {
    dateKey,
    weekKey: getWeekKeyFromDateKey(dateKey),
    monthKey: getMonthKeyFromDateKey(dateKey),
  };
}

export function sanitizeDocIdSegment(raw: string, maxLen = 48): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) return 'unknown';
  if (cleaned.length <= maxLen) return cleaned;
  const hash = crypto.createHash('sha256').update(cleaned).digest('hex').slice(0, 12);
  return `${cleaned.slice(0, Math.max(8, maxLen - 13))}_${hash}`;
}

export function buildDeterministicEventId(
  uid: string,
  type: LeaderboardEventType,
  sourceId: string
): string {
  const prefixMap: Record<LeaderboardEventType, string> = {
    question_answer: 'ev_q',
    simulado_completed: 'ev_sim',
    daily_goal_completed: 'ev_gd',
    weekly_goal_completed: 'ev_gw',
    streak_7d_completed: 'ev_s7',
  };
  const hash = crypto
    .createHash('sha256')
    .update(`${uid.trim()}|${type}|${sourceId.trim()}`)
    .digest('hex')
    .slice(0, 32);
  return `${prefixMap[type]}_${hash}`;
}

export function buildDeterministicOutboxId(
  uid: string,
  kind: LeaderboardOutboxKind,
  sourceId: string
): string {
  const kindMap: Record<LeaderboardOutboxKind, string> = {
    question_answer: 'ob_q',
    simulado_completed: 'ob_sim',
    study_activity: 'ob_act',
  };
  const hash = crypto
    .createHash('sha256')
    .update(`${uid.trim()}|${kind}|${sourceId.trim()}`)
    .digest('hex')
    .slice(0, 32);
  return `${kindMap[kind]}_${hash}`;
}

export function buildDeterministicVerifiedActionId(
  uid: string,
  kind: LeaderboardOutboxKind,
  sourceId: string
): string {
  const kindMap: Record<LeaderboardOutboxKind, string> = {
    question_answer: 'va_q',
    simulado_completed: 'va_sim',
    study_activity: 'va_act',
  };
  const hash = crypto
    .createHash('sha256')
    .update(`${uid.trim()}|${kind}|${sourceId.trim()}`)
    .digest('hex')
    .slice(0, 32);
  return `${kindMap[kind]}_${hash}`;
}

export function buildPeriodDocId(periodKey: string, publicProfileId: string): string {
  return `${sanitizeDocIdSegment(periodKey, 20)}__${sanitizeDocIdSegment(publicProfileId, 64)}`;
}

export function generatePublicProfileId(): string {
  return `pub_${crypto.randomBytes(12).toString('hex')}`;
}

export function buildSafeAvatarToken(publicProfileId: string): string {
  const digest = crypto.createHash('sha256').update(publicProfileId).digest();
  return AVATAR_TOKENS[digest[0] % AVATAR_TOKENS.length];
}

/**
 * Generates a privacy-preserving pseudonym for the public leaderboard.
 * NEVER exposes full name, email, CPF, Firebase UID, or financial data.
 */
export function buildSafeDefaultNickname(
  rawName: unknown,
  publicProfileId: string
): string {
  const cleanId = publicProfileId.replace(/[^a-zA-Z0-9]/g, '');
  const tag = (cleanId.slice(-4) || '0000').toUpperCase();

  if (typeof rawName === 'string') {
    const trimmed = rawName.trim();
    // Reject anything resembling an email address, CPF, phone, or numeric ID
    if (trimmed && !trimmed.includes('@') && !/\d/.test(trimmed)) {
      const firstToken = trimmed.split(/\s+/)[0] || '';
      const alphaOnly = firstToken.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
      if (alphaOnly.length >= 2) {
        const capped = alphaOnly.slice(0, 14);
        const formatted = capped.charAt(0).toUpperCase() + capped.slice(1).toLowerCase();
        return `${formatted} #${tag}`;
      }
    }
  }

  return `Estudante #${tag}`;
}

export function assertPositivePoints(points: number, label: string): number {
  if (!Number.isInteger(points) || points <= 0) {
    throw new Error(`Pontuação inválida para ${label}: valor deve ser inteiro positivo.`);
  }
  return points;
}

export function assertNonNegativeCounter(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, num);
}

export function stripForbiddenPublicFields<T extends Record<string, unknown>>(obj: T): T {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!FORBIDDEN_PUBLIC_KEYS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized as T;
}

export function sanitizePublicProfile(
  profile: LeaderboardPublicProfile
): LeaderboardPublicProfile {
  return stripForbiddenPublicFields({
    publicProfileId: String(profile.publicProfileId),
    nickname: String(profile.nickname).slice(0, 32),
    avatar: String(profile.avatar).slice(0, 24),
    totalPoints: assertNonNegativeCounter(profile.totalPoints),
    questionsPoints: assertNonNegativeCounter(profile.questionsPoints),
    simuladosPoints: assertNonNegativeCounter(profile.simuladosPoints),
    goalsPoints: assertNonNegativeCounter(profile.goalsPoints),
    streakPoints: assertNonNegativeCounter(profile.streakPoints),
    questionsAnsweredCount: assertNonNegativeCounter(profile.questionsAnsweredCount),
    questionsCorrectCount: assertNonNegativeCounter(profile.questionsCorrectCount),
    simuladosCompletedCount: assertNonNegativeCounter(profile.simuladosCompletedCount),
    dailyGoalsCompletedCount: assertNonNegativeCounter(profile.dailyGoalsCompletedCount),
    weeklyGoalsCompletedCount: assertNonNegativeCounter(profile.weeklyGoalsCompletedCount),
    streak7dCount: assertNonNegativeCounter(profile.streak7dCount),
    currentStreakDays: assertNonNegativeCounter(profile.currentStreakDays),
    bestStreakDays: assertNonNegativeCounter(profile.bestStreakDays),
    updatedAt: String(profile.updatedAt),
  });
}

export function sanitizePeriodEntry(
  entry: LeaderboardPeriodEntry
): LeaderboardPeriodEntry {
  return stripForbiddenPublicFields({
    periodKey: String(entry.periodKey),
    publicProfileId: String(entry.publicProfileId),
    nickname: String(entry.nickname).slice(0, 32),
    avatar: String(entry.avatar).slice(0, 24),
    points: assertNonNegativeCounter(entry.points),
    eventsCount: assertNonNegativeCounter(entry.eventsCount),
    updatedAt: String(entry.updatedAt),
  });
}

/**
 * Parses Firestore leaderboard_config/default strictly.
 * NEVER auto-activates when missing or incomplete.
 */
export function normalizeLeaderboardConfig(
  rawData?: Record<string, any> | null
): LeaderboardConfig {
  const base = getDefaultInactiveLeaderboardConfig();
  if (!rawData || typeof rawData !== 'object') {
    return base;
  }

  let launchAt: number | null = null;
  if (typeof rawData.launchAt === 'number' && Number.isFinite(rawData.launchAt) && rawData.launchAt > 0) {
    launchAt = Math.floor(rawData.launchAt);
  } else if (typeof rawData.launchAtIso === 'string' && rawData.launchAtIso.trim()) {
    const parsed = Date.parse(rawData.launchAtIso.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      launchAt = Math.floor(parsed);
    }
  }

  const launchDateKey =
    launchAt !== null ? getSaoPauloDateKeyFromMs(launchAt) : null;
  const launchAtIso =
    typeof rawData.launchAtIso === 'string' && rawData.launchAtIso.trim()
      ? rawData.launchAtIso.trim()
      : launchAt !== null
        ? new Date(launchAt).toISOString()
        : null;

  // Ranking can ONLY be active when explicitly enabled AND a valid launchAt is configured
  const active = rawData.active === true && launchAt !== null && launchDateKey !== null;

  return {
    ...base,
    active,
    launchAt,
    launchAtIso,
    launchDateKey,
    scoringVersion:
      typeof rawData.scoringVersion === 'number' && rawData.scoringVersion >= 1
        ? Math.floor(rawData.scoringVersion)
        : LEADERBOARD_SCORING_VERSION,
    updatedAt: typeof rawData.updatedAt === 'string' ? rawData.updatedAt : null,
  };
}

/**
 * Explicit admin-only configuration helper for activating or scheduling the official ranking launch.
 * Never called automatically by student actions.
 */
export async function configureOfficialLeaderboardLaunch(
  db: Firestore,
  params: {
    active: boolean;
    launchAtIso?: string | null;
    launchAtMs?: number | null;
    nowMs?: number;
  }
): Promise<LeaderboardConfig> {
  const nowMs = params.nowMs ?? Date.now();
  let launchAt: number | null = null;
  let launchAtIso: string | null = null;

  if (typeof params.launchAtMs === 'number' && Number.isFinite(params.launchAtMs) && params.launchAtMs > 0) {
    launchAt = Math.floor(params.launchAtMs);
    launchAtIso = params.launchAtIso?.trim() || new Date(launchAt).toISOString();
  } else if (typeof params.launchAtIso === 'string' && params.launchAtIso.trim()) {
    const parsed = Date.parse(params.launchAtIso.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('Data/hora oficial de lançamento inválida. Informe ISO 8601 com fuso horário (ex.: 2026-06-01T00:00:00-03:00).');
    }
    launchAt = Math.floor(parsed);
    launchAtIso = params.launchAtIso.trim();
  }

  if (params.active && launchAt === null) {
    throw new Error('Para ativar o ranking oficial, é obrigatório configurar a data e o horário oficial de lançamento.');
  }

  const config: LeaderboardConfig = {
    ...getDefaultInactiveLeaderboardConfig(),
    active: params.active && launchAt !== null,
    launchAt,
    launchAtIso,
    launchDateKey: launchAt !== null ? getSaoPauloDateKeyFromMs(launchAt) : null,
    updatedAt: new Date(nowMs).toISOString(),
  };

  await db
    .collection(LEADERBOARD_COLLECTIONS.config)
    .doc(LEADERBOARD_CONFIG_DOC_ID)
    .set(config);

  return config;
}

export function isEligibleForLeaderboard(
  config: LeaderboardConfig,
  occurredAt: number
): { eligible: true } | { eligible: false; reason: 'RANKING_INACTIVE' | 'BEFORE_LAUNCH' } {
  if (!config.active || config.launchAt === null || !config.launchDateKey) {
    return { eligible: false, reason: 'RANKING_INACTIVE' };
  }
  if (!Number.isFinite(occurredAt) || occurredAt < config.launchAt) {
    return { eligible: false, reason: 'BEFORE_LAUNCH' };
  }
  return { eligible: true };
}

export function calculateQuestionPoints(isCorrect: boolean): {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
} {
  const basePoints = LEADERBOARD_POINTS.QUESTION_FIRST_VALID_ANSWER;
  const bonusPoints = isCorrect ? LEADERBOARD_POINTS.QUESTION_CORRECT_BONUS : 0;
  return {
    basePoints,
    bonusPoints,
    totalPoints: assertPositivePoints(basePoints + bonusPoints, 'question_answer'),
  };
}

/**
 * Pure validator for simulado completion eligibility:
 * - Must have authenticated uid matching session.ownerUid
 * - Must have at least 1 question
 * - 100% of questions must have a valid option selected from the official question's options
 */
export function validateSimuladoForRanking(params: {
  uid: string | null | undefined;
  sessionOwnerUid: string | null | undefined;
  questionIds: string[];
  answers: Array<{ questionId: string; selectedOptionId: unknown; validOptionIds: string[] }>;
}):
  | { valid: true; totalQuestions: number }
  | {
      valid: false;
      reason: 'INVALID_INPUT' | 'SESSION_OWNERSHIP_MISMATCH' | 'EMPTY_SIMULADO' | 'INCOMPLETE_SIMULADO';
    } {
  const uid = typeof params.uid === 'string' ? params.uid.trim() : '';
  const ownerUid = typeof params.sessionOwnerUid === 'string' ? params.sessionOwnerUid.trim() : '';

  if (!uid) {
    return { valid: false, reason: 'INVALID_INPUT' };
  }
  if (!ownerUid || ownerUid !== uid) {
    return { valid: false, reason: 'SESSION_OWNERSHIP_MISMATCH' };
  }
  if (!Array.isArray(params.questionIds) || params.questionIds.length === 0) {
    return { valid: false, reason: 'EMPTY_SIMULADO' };
  }
  if (!Array.isArray(params.answers) || params.answers.length !== params.questionIds.length) {
    return { valid: false, reason: 'INCOMPLETE_SIMULADO' };
  }

  for (let i = 0; i < params.questionIds.length; i++) {
    const expectedQId = params.questionIds[i];
    const ans = params.answers[i];
    if (!ans || ans.questionId !== expectedQId) {
      return { valid: false, reason: 'INCOMPLETE_SIMULADO' };
    }
    if (typeof ans.selectedOptionId !== 'string' || !ans.selectedOptionId.trim()) {
      return { valid: false, reason: 'INCOMPLETE_SIMULADO' };
    }
    if (!Array.isArray(ans.validOptionIds) || !ans.validOptionIds.includes(ans.selectedOptionId)) {
      return { valid: false, reason: 'INCOMPLETE_SIMULADO' };
    }
  }

  return { valid: true, totalQuestions: params.questionIds.length };
}

/**
 * Extracts completed 7-day consecutive post-launch study milestones and current/best streak.
 * Pure, deterministic, and safe under out-of-order outbox recovery.
 */
export function computeStreakMilestones(
  rawDateKeys: string[],
  launchDateKey: string
): {
  sortedUniqueDates: string[];
  milestones: Array<{ startDateKey: string; endDateKey: string }>;
  currentStreakDays: number;
  bestStreakDays: number;
} {
  const uniqueSet = new Set<string>();
  for (const key of rawDateKeys) {
    if (isValidDateKey(key) && key >= launchDateKey) {
      uniqueSet.add(key);
    }
  }

  const sortedUniqueDates = Array.from(uniqueSet).sort();
  if (sortedUniqueDates.length === 0) {
    return {
      sortedUniqueDates: [],
      milestones: [],
      currentStreakDays: 0,
      bestStreakDays: 0,
    };
  }

  const milestones: Array<{ startDateKey: string; endDateKey: string }> = [];
  let milestoneRun = 0;
  let fullRun = 0;
  let bestStreakDays = 0;
  let prevDate: string | null = null;

  for (const dateKey of sortedUniqueDates) {
    const isConsecutive = prevDate !== null && shiftDateKey(prevDate, 1) === dateKey;
    fullRun = isConsecutive ? fullRun + 1 : 1;
    if (fullRun > bestStreakDays) bestStreakDays = fullRun;

    milestoneRun = isConsecutive ? milestoneRun + 1 : 1;
    if (milestoneRun === 7) {
      milestones.push({
        startDateKey: shiftDateKey(dateKey, -6),
        endDateKey: dateKey,
      });
      milestoneRun = 0;
    }

    prevDate = dateKey;
  }

  return {
    sortedUniqueDates,
    milestones,
    currentStreakDays: fullRun,
    bestStreakDays,
  };
}

function clampGoalInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function resolveUserGoalTargets(userData: Record<string, any> | undefined): {
  dailyGoalQuestions: number;
  weeklyGoalQuestions: number;
} {
  const plan = userData?.studyPlan && typeof userData.studyPlan === 'object' ? userData.studyPlan : {};
  const dailyGoalQuestions = clampGoalInt(
    plan.dailyGoalQuestions ?? userData?.dailyGoalQuestions,
    5,
    200,
    20
  );
  const weeklyGoalQuestions = clampGoalInt(
    plan.weeklyGoalQuestions,
    10,
    1400,
    Math.min(1400, Math.max(10, dailyGoalQuestions * 5))
  );
  return { dailyGoalQuestions, weeklyGoalQuestions };
}

function trimCounterMap(
  map: Record<string, number>,
  maxEntries: number
): Record<string, number> {
  const entries = Object.entries(map)
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const kept = entries.slice(-maxEntries);
  const out: Record<string, number> = {};
  for (const [k, v] of kept) {
    out[k] = Math.floor(v);
  }
  return out;
}

function trimDateKeys(dates: string[], maxEntries = 420): string[] {
  return dates.slice(-maxEntries);
}

function sanitizeErrorForOutbox(err: unknown): string {
  const rawCode = (err as any)?.code;
  const rawMsg = String((err as any)?.message || 'TRANSIENT_ERROR');
  const safeMsg = rawMsg
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[redacted]')
    .slice(0, 180);
  return rawCode !== undefined ? `[${String(rawCode)}] ${safeMsg}` : safeMsg;
}

interface PendingAwardEvent {
  eventId: string;
  type: LeaderboardEventType;
  sourceId: string;
  points: number;
  basePoints: number;
  bonusPoints: number;
  dateKey: string;
  weekKey: string;
  monthKey: string;
  occurredAt: number;
}

/**
 * Core atomic Firestore transaction that credits a primary action (optional) +
 * any newly achieved post-launch goals / 7-day streaks.
 * Strictly reads ALL documents before performing ANY writes.
 */
async function executeAtomicScoringTransaction(
  db: Firestore,
  params: {
    uid: string;
    occurredAt: number;
    nowMs: number;
    primaryAction:
      | { kind: 'question_answer'; questionId: string; isCorrect: boolean }
      | { kind: 'simulado_completed'; sessionId: string }
      | { kind: 'study_activity'; activityId: string };
  }
): Promise<LeaderboardScoringOutcome> {
  const uid = params.uid.trim();
  if (!uid || !Number.isFinite(params.occurredAt)) {
    return {
      awarded: false,
      totalPointsAwarded: 0,
      events: [],
      reason: 'INVALID_INPUT',
    };
  }

  const { dateKey, weekKey, monthKey } = getPeriodKeysForTimestamp(params.occurredAt);
  const nowIso = new Date(params.nowMs).toISOString();

  const configRef = db.collection(LEADERBOARD_COLLECTIONS.config).doc(LEADERBOARD_CONFIG_DOC_ID);
  const userRef = db.collection('users').doc(uid);
  const privateProfileRef = db.collection(LEADERBOARD_COLLECTIONS.privateProfiles).doc(uid);

  let primaryEventId: string | null = null;
  if (params.primaryAction.kind === 'question_answer') {
    primaryEventId = buildDeterministicEventId(uid, 'question_answer', params.primaryAction.questionId);
  } else if (params.primaryAction.kind === 'simulado_completed') {
    primaryEventId = buildDeterministicEventId(uid, 'simulado_completed', params.primaryAction.sessionId);
  }

  const dailyGoalEventId = buildDeterministicEventId(uid, 'daily_goal_completed', dateKey);
  const weeklyGoalEventId = buildDeterministicEventId(uid, 'weekly_goal_completed', weekKey);

  return db.runTransaction(async (tx) => {
    // PHASE 1: Read configuration, user profile, private leaderboard state, and candidate primary/goal events
    const [
      configSnap,
      userSnap,
      privateSnap,
      primaryEventSnap,
      dailyGoalSnap,
      weeklyGoalSnap,
    ] = await Promise.all([
      tx.get(configRef),
      tx.get(userRef),
      tx.get(privateProfileRef),
      primaryEventId
        ? tx.get(db.collection(LEADERBOARD_COLLECTIONS.events).doc(primaryEventId))
        : Promise.resolve(null),
      tx.get(db.collection(LEADERBOARD_COLLECTIONS.events).doc(dailyGoalEventId)),
      tx.get(db.collection(LEADERBOARD_COLLECTIONS.events).doc(weeklyGoalEventId)),
    ]);

    const config = normalizeLeaderboardConfig(configSnap.exists ? (configSnap.data() as any) : null);
    const eligibility = isEligibleForLeaderboard(config, params.occurredAt);
    if (!eligibility.eligible) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: eligibility.reason,
      };
    }

    // If primary event already exists (duplicate question answer or duplicate simulado sessionId), award 0 points
    if (primaryEventId && primaryEventSnap?.exists) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: 'DUPLICATE_EVENT',
      };
    }

    const userData = userSnap.exists ? (userSnap.data() as Record<string, any>) : {};
    const { dailyGoalQuestions, weeklyGoalQuestions } = resolveUserGoalTargets(userData);

    const existingPrivate = privateSnap.exists
      ? (privateSnap.data() as Partial<LeaderboardPrivateProfile>)
      : null;

    const publicProfileId =
      typeof existingPrivate?.publicProfileId === 'string' && existingPrivate.publicProfileId.trim()
        ? existingPrivate.publicProfileId.trim()
        : generatePublicProfileId();

    const nickname =
      typeof existingPrivate?.nickname === 'string' && existingPrivate.nickname.trim()
        ? existingPrivate.nickname.trim()
        : buildSafeDefaultNickname(userData.name, publicProfileId);

    const avatar =
      typeof existingPrivate?.avatar === 'string' && existingPrivate.avatar.trim()
        ? existingPrivate.avatar.trim()
        : buildSafeAvatarToken(publicProfileId);

    const dailyQuestionCounts: Record<string, number> = {
      ...(existingPrivate?.dailyQuestionCounts || {}),
    };
    const weeklyQuestionCounts: Record<string, number> = {
      ...(existingPrivate?.weeklyQuestionCounts || {}),
    };
    const priorActiveDateKeys = Array.isArray(existingPrivate?.activeDateKeys)
      ? existingPrivate!.activeDateKeys.filter((d) => isValidDateKey(d) && d >= config.launchDateKey!)
      : [];

    const eventsToCreate: PendingAwardEvent[] = [];

    // 1. Primary action event
    if (params.primaryAction.kind === 'question_answer') {
      const qPts = calculateQuestionPoints(params.primaryAction.isCorrect);
      eventsToCreate.push({
        eventId: primaryEventId!,
        type: 'question_answer',
        sourceId: params.primaryAction.questionId,
        points: qPts.totalPoints,
        basePoints: qPts.basePoints,
        bonusPoints: qPts.bonusPoints,
        dateKey,
        weekKey,
        monthKey,
        occurredAt: params.occurredAt,
      });

      dailyQuestionCounts[dateKey] = assertNonNegativeCounter(dailyQuestionCounts[dateKey]) + 1;
      weeklyQuestionCounts[weekKey] = assertNonNegativeCounter(weeklyQuestionCounts[weekKey]) + 1;
    } else if (params.primaryAction.kind === 'simulado_completed') {
      const simPts = assertPositivePoints(
        LEADERBOARD_POINTS.SIMULADO_COMPLETED,
        'simulado_completed'
      );
      eventsToCreate.push({
        eventId: primaryEventId!,
        type: 'simulado_completed',
        sourceId: params.primaryAction.sessionId,
        points: simPts,
        basePoints: simPts,
        bonusPoints: 0,
        dateKey,
        weekKey,
        monthKey,
        occurredAt: params.occurredAt,
      });
    }

    // 2. Daily & weekly goal checks (proven strictly by server-verified post-launch unique questions)
    if (
      params.primaryAction.kind === 'question_answer' &&
      !dailyGoalSnap.exists &&
      assertNonNegativeCounter(dailyQuestionCounts[dateKey]) >= dailyGoalQuestions
    ) {
      const pts = assertPositivePoints(
        LEADERBOARD_POINTS.DAILY_GOAL_COMPLETED,
        'daily_goal_completed'
      );
      eventsToCreate.push({
        eventId: dailyGoalEventId,
        type: 'daily_goal_completed',
        sourceId: dateKey,
        points: pts,
        basePoints: pts,
        bonusPoints: 0,
        dateKey,
        weekKey,
        monthKey,
        occurredAt: params.occurredAt,
      });
    }

    if (
      params.primaryAction.kind === 'question_answer' &&
      !weeklyGoalSnap.exists &&
      assertNonNegativeCounter(weeklyQuestionCounts[weekKey]) >= weeklyGoalQuestions
    ) {
      const pts = assertPositivePoints(
        LEADERBOARD_POINTS.WEEKLY_GOAL_COMPLETED,
        'weekly_goal_completed'
      );
      eventsToCreate.push({
        eventId: weeklyGoalEventId,
        type: 'weekly_goal_completed',
        sourceId: weekKey,
        points: pts,
        basePoints: pts,
        bonusPoints: 0,
        dateKey,
        weekKey,
        monthKey,
        occurredAt: params.occurredAt,
      });
    }

    // 3. 7-day consecutive post-launch study streak check
    const nextStreakEval = computeStreakMilestones(
      [...priorActiveDateKeys, dateKey],
      config.launchDateKey!
    );

    const candidateStreakEvents = nextStreakEval.milestones.map((m) => ({
      milestone: m,
      eventId: buildDeterministicEventId(uid, 'streak_7d_completed', m.endDateKey),
    }));

    // Read candidate streak event docs BEFORE any write
    const streakEventSnaps = await Promise.all(
      candidateStreakEvents.map((c) =>
        tx.get(db.collection(LEADERBOARD_COLLECTIONS.events).doc(c.eventId))
      )
    );

    for (let i = 0; i < candidateStreakEvents.length; i++) {
      if (!streakEventSnaps[i].exists) {
        const endDateKey = candidateStreakEvents[i].milestone.endDateKey;
        const pts = assertPositivePoints(
          LEADERBOARD_POINTS.STREAK_7_DAYS_COMPLETED,
          'streak_7d_completed'
        );
        eventsToCreate.push({
          eventId: candidateStreakEvents[i].eventId,
          type: 'streak_7d_completed',
          sourceId: endDateKey,
          points: pts,
          basePoints: pts,
          bonusPoints: 0,
          dateKey: endDateKey,
          weekKey: getWeekKeyFromDateKey(endDateKey),
          monthKey: getMonthKeyFromDateKey(endDateKey),
          occurredAt: params.occurredAt,
        });
      }
    }

    const activeDatesChanged =
      !existingPrivate ||
      nextStreakEval.sortedUniqueDates.length !== priorActiveDateKeys.length;

    // If study_activity triggered no new streak milestone and date was already recorded, nothing to write
    if (eventsToCreate.length === 0 && !activeDatesChanged) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: 'NO_MILESTONE_REACHED',
      };
    }

    // Read public profile + affected weekly/monthly period docs BEFORE any write
    const publicProfileRef = db
      .collection(LEADERBOARD_COLLECTIONS.publicProfiles)
      .doc(publicProfileId);

    const affectedWeekKeys = Array.from(new Set(eventsToCreate.map((e) => e.weekKey)));
    const affectedMonthKeys = Array.from(new Set(eventsToCreate.map((e) => e.monthKey)));

    const [publicSnap, weeklySnaps, monthlySnaps] = await Promise.all([
      tx.get(publicProfileRef),
      Promise.all(
        affectedWeekKeys.map((wk) =>
          tx.get(
            db
              .collection(LEADERBOARD_COLLECTIONS.weekly)
              .doc(buildPeriodDocId(wk, publicProfileId))
          )
        )
      ),
      Promise.all(
        affectedMonthKeys.map((mk) =>
          tx.get(
            db
              .collection(LEADERBOARD_COLLECTIONS.monthly)
              .doc(buildPeriodDocId(mk, publicProfileId))
          )
        )
      ),
    ]);

    // PHASE 2: Perform atomic writes
    const nextPrivateProfile: LeaderboardPrivateProfile = {
      uid,
      publicProfileId,
      nickname,
      avatar,
      dailyQuestionCounts: trimCounterMap(dailyQuestionCounts, 35),
      weeklyQuestionCounts: trimCounterMap(weeklyQuestionCounts, 12),
      activeDateKeys: trimDateKeys(nextStreakEval.sortedUniqueDates, 420),
      createdAt: existingPrivate?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    tx.set(privateProfileRef, nextPrivateProfile);

    // Aggregate deltas for public profile
    const existingPublic = publicSnap.exists
      ? (publicSnap.data() as Partial<LeaderboardPublicProfile>)
      : {};

    let totalPointsDelta = 0;
    let questionsPointsDelta = 0;
    let simuladosPointsDelta = 0;
    let goalsPointsDelta = 0;
    let streakPointsDelta = 0;
    let questionsAnsweredDelta = 0;
    let questionsCorrectDelta = 0;
    let simuladosCompletedDelta = 0;
    let dailyGoalsDelta = 0;
    let weeklyGoalsDelta = 0;
    let streak7dDelta = 0;

    const weekDeltas = new Map<string, { points: number; events: number }>();
    const monthDeltas = new Map<string, { points: number; events: number }>();

    for (const ev of eventsToCreate) {
      const safePts = assertPositivePoints(ev.points, ev.type);
      totalPointsDelta += safePts;

      if (ev.type === 'question_answer') {
        questionsPointsDelta += safePts;
        questionsAnsweredDelta += 1;
        if (ev.bonusPoints > 0) questionsCorrectDelta += 1;
      } else if (ev.type === 'simulado_completed') {
        simuladosPointsDelta += safePts;
        simuladosCompletedDelta += 1;
      } else if (ev.type === 'daily_goal_completed') {
        goalsPointsDelta += safePts;
        dailyGoalsDelta += 1;
      } else if (ev.type === 'weekly_goal_completed') {
        goalsPointsDelta += safePts;
        weeklyGoalsDelta += 1;
      } else if (ev.type === 'streak_7d_completed') {
        streakPointsDelta += safePts;
        streak7dDelta += 1;
      }

      const wEntry = weekDeltas.get(ev.weekKey) || { points: 0, events: 0 };
      wEntry.points += safePts;
      wEntry.events += 1;
      weekDeltas.set(ev.weekKey, wEntry);

      const mEntry = monthDeltas.get(ev.monthKey) || { points: 0, events: 0 };
      mEntry.points += safePts;
      mEntry.events += 1;
      monthDeltas.set(ev.monthKey, mEntry);

      const eventDoc: LeaderboardEventRecord = {
        eventId: ev.eventId,
        uid,
        publicProfileId,
        type: ev.type,
        sourceId: ev.sourceId,
        points: safePts,
        basePoints: ev.basePoints,
        bonusPoints: ev.bonusPoints,
        dateKey: ev.dateKey,
        weekKey: ev.weekKey,
        monthKey: ev.monthKey,
        occurredAt: ev.occurredAt,
        createdAt: nowIso,
      };
      tx.set(db.collection(LEADERBOARD_COLLECTIONS.events).doc(ev.eventId), eventDoc);
    }

    const nextPublicProfile = sanitizePublicProfile({
      publicProfileId,
      nickname,
      avatar,
      totalPoints: assertNonNegativeCounter(existingPublic.totalPoints) + totalPointsDelta,
      questionsPoints: assertNonNegativeCounter(existingPublic.questionsPoints) + questionsPointsDelta,
      simuladosPoints: assertNonNegativeCounter(existingPublic.simuladosPoints) + simuladosPointsDelta,
      goalsPoints: assertNonNegativeCounter(existingPublic.goalsPoints) + goalsPointsDelta,
      streakPoints: assertNonNegativeCounter(existingPublic.streakPoints) + streakPointsDelta,
      questionsAnsweredCount:
        assertNonNegativeCounter(existingPublic.questionsAnsweredCount) + questionsAnsweredDelta,
      questionsCorrectCount:
        assertNonNegativeCounter(existingPublic.questionsCorrectCount) + questionsCorrectDelta,
      simuladosCompletedCount:
        assertNonNegativeCounter(existingPublic.simuladosCompletedCount) + simuladosCompletedDelta,
      dailyGoalsCompletedCount:
        assertNonNegativeCounter(existingPublic.dailyGoalsCompletedCount) + dailyGoalsDelta,
      weeklyGoalsCompletedCount:
        assertNonNegativeCounter(existingPublic.weeklyGoalsCompletedCount) + weeklyGoalsDelta,
      streak7dCount:
        assertNonNegativeCounter(existingPublic.streak7dCount) + streak7dDelta,
      currentStreakDays: nextStreakEval.currentStreakDays,
      bestStreakDays: Math.max(
        assertNonNegativeCounter(existingPublic.bestStreakDays),
        nextStreakEval.bestStreakDays
      ),
      updatedAt: nowIso,
    });

    tx.set(publicProfileRef, nextPublicProfile);

    for (let i = 0; i < affectedWeekKeys.length; i++) {
      const wk = affectedWeekKeys[i];
      const delta = weekDeltas.get(wk)!;
      const existingW = weeklySnaps[i].exists
        ? (weeklySnaps[i].data() as Partial<LeaderboardPeriodEntry>)
        : {};
      const nextW = sanitizePeriodEntry({
        periodKey: wk,
        publicProfileId,
        nickname,
        avatar,
        points: assertNonNegativeCounter(existingW.points) + delta.points,
        eventsCount: assertNonNegativeCounter(existingW.eventsCount) + delta.events,
        updatedAt: nowIso,
      });
      tx.set(
        db
          .collection(LEADERBOARD_COLLECTIONS.weekly)
          .doc(buildPeriodDocId(wk, publicProfileId)),
        nextW
      );
    }

    for (let i = 0; i < affectedMonthKeys.length; i++) {
      const mk = affectedMonthKeys[i];
      const delta = monthDeltas.get(mk)!;
      const existingM = monthlySnaps[i].exists
        ? (monthlySnaps[i].data() as Partial<LeaderboardPeriodEntry>)
        : {};
      const nextM = sanitizePeriodEntry({
        periodKey: mk,
        publicProfileId,
        nickname,
        avatar,
        points: assertNonNegativeCounter(existingM.points) + delta.points,
        eventsCount: assertNonNegativeCounter(existingM.eventsCount) + delta.events,
        updatedAt: nowIso,
      });
      tx.set(
        db
          .collection(LEADERBOARD_COLLECTIONS.monthly)
          .doc(buildPeriodDocId(mk, publicProfileId)),
        nextM
      );
    }

    return {
      awarded: eventsToCreate.length > 0,
      totalPointsAwarded: totalPointsDelta,
      events: eventsToCreate.map((ev) => ({
        eventId: ev.eventId,
        type: ev.type,
        sourceId: ev.sourceId,
        points: ev.points,
        basePoints: ev.basePoints,
        bonusPoints: ev.bonusPoints,
        dateKey: ev.dateKey,
        weekKey: ev.weekKey,
        monthKey: ev.monthKey,
      })),
      reason: eventsToCreate.length > 0 ? 'AWARDED' : 'NO_MILESTONE_REACHED',
    };
  });
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Checks leaderboard_config/default strictly read-only.
 * Returns eligibility without writing anything when ranking is inactive or pre-launch.
 */
export async function readLeaderboardConfigEligibility(
  db: Firestore,
  occurredAt: number
): Promise<
  | { eligible: true; config: LeaderboardConfig }
  | { eligible: false; config: LeaderboardConfig; reason: 'RANKING_INACTIVE' | 'BEFORE_LAUNCH' }
> {
  const snap = await db
    .collection(LEADERBOARD_COLLECTIONS.config)
    .doc(LEADERBOARD_CONFIG_DOC_ID)
    .get();
  const config = normalizeLeaderboardConfig(snap.exists ? (snap.data() as Record<string, any>) : null);
  const check = isEligibleForLeaderboard(config, occurredAt);
  if (!check.eligible) {
    return { eligible: false, config, reason: check.reason };
  }
  return { eligible: true, config };
}

/**
 * Persists a server-verified immutable proof doc in leaderboard_verified_actions.
 * Used exclusively by server endpoints when ranking is active & post-launch so secondary
 * reconciliation can recover points even if BOTH the main transaction AND outbox writes fail.
 */
export async function persistServerVerifiedAction(
  db: Firestore,
  params: {
    uid: string;
    kind: LeaderboardOutboxKind;
    sourceId: string;
    payload: Record<string, unknown>;
    occurredAt: number;
    nowMs?: number;
  }
): Promise<string> {
  const actionId = buildDeterministicVerifiedActionId(params.uid, params.kind, params.sourceId);
  const ref = db.collection(LEADERBOARD_COLLECTIONS.verifiedActions).doc(actionId);
  const record: LeaderboardVerifiedActionRecord = {
    actionId,
    uid: params.uid.trim(),
    kind: params.kind,
    sourceId: params.sourceId.trim(),
    payload: params.payload,
    occurredAt: params.occurredAt,
    serverVerified: true,
    createdAt: new Date(params.nowMs ?? Date.now()).toISOString(),
  };
  await ref.set(record, { merge: true });
  return actionId;
}

/**
 * Persists a deterministic outbox job when a transient failure interrupts scoring.
 */
export async function enqueueLeaderboardOutbox(
  db: Firestore,
  params: {
    uid: string;
    kind: LeaderboardOutboxKind;
    sourceId: string;
    payload: Record<string, unknown>;
    occurredAt: number;
    error: unknown;
    nowMs?: number;
  }
): Promise<string> {
  const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();
  const outboxId = buildDeterministicOutboxId(params.uid, params.kind, params.sourceId);
  const ref = db.collection(LEADERBOARD_COLLECTIONS.outbox).doc(outboxId);

  const existingSnap = await ref.get();
  const existing = existingSnap.exists
    ? (existingSnap.data() as Partial<LeaderboardOutboxRecord>)
    : null;

  if (existing?.status === 'processed') {
    return outboxId;
  }

  const record: LeaderboardOutboxRecord = {
    outboxId,
    uid: params.uid,
    kind: params.kind,
    sourceId: params.sourceId,
    payload: params.payload,
    occurredAt: params.occurredAt,
    status: 'pending',
    attempts: assertNonNegativeCounter(existing?.attempts) + 1,
    lastError: sanitizeErrorForOutbox(params.error),
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    processedAt: null,
  };

  await ref.set(record, { merge: true });
  return outboxId;
}

/**
 * Short retry with exponential backoff for transient failures when writing to leaderboard_outbox.
 */
export async function enqueueLeaderboardOutboxWithRetry(
  db: Firestore,
  params: {
    uid: string;
    kind: LeaderboardOutboxKind;
    sourceId: string;
    payload: Record<string, unknown>;
    occurredAt: number;
    error: unknown;
    nowMs?: number;
  },
  retryOptions: RetryBackoffOptions = {}
): Promise<{ ok: true; outboxId: string; attempts: number } | { ok: false; attempts: number; lastError: string }> {
  const maxAttempts = Math.min(5, Math.max(1, retryOptions.maxAttempts ?? 3));
  const baseDelayMs = Math.min(1000, Math.max(0, retryOptions.baseDelayMs ?? 80));
  const sleep = retryOptions.sleepFn ?? defaultSleep;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const outboxId = await enqueueLeaderboardOutbox(db, params);
      return { ok: true, outboxId, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    lastError: sanitizeErrorForOutbox(lastErr),
  };
}

/**
 * Safely executes scoring for a valid question answer.
 * Never throws; persists server proof when active, retries outbox write with backoff on transient failure.
 */
export async function recordQuestionAnswerScore(
  db: Firestore | null,
  params: {
    uid: string | null | undefined;
    questionId: string;
    isCorrect: boolean;
    occurredAt?: number;
    nowMs?: number;
    retryOptions?: RetryBackoffOptions;
  }
): Promise<LeaderboardScoringOutcome> {
  if (!db) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'UNAVAILABLE' };
  }
  const uid = typeof params.uid === 'string' ? params.uid.trim() : '';
  const questionId = typeof params.questionId === 'string' ? params.questionId.trim() : '';
  if (!uid || !questionId) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'INVALID_INPUT' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const occurredAt = params.occurredAt ?? nowMs;
  const payload = { questionId, isCorrect: Boolean(params.isCorrect) };
  let secondaryProofPersisted = false;

  // Step 0: Fast read-only eligibility gate (0 writes while inactive or pre-launch)
  try {
    const preCheck = await readLeaderboardConfigEligibility(db, occurredAt);
    if (!preCheck.eligible) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: preCheck.reason,
      };
    }

    // Step 1: Write-ahead immutable server proof for secondary reconciliation
    try {
      await persistServerVerifiedAction(db, {
        uid,
        kind: 'question_answer',
        sourceId: questionId,
        payload,
        occurredAt,
        nowMs,
      });
      secondaryProofPersisted = true;
    } catch {
      // Do not abort main scoring transaction if proof write fails transiently
    }
  } catch {
    // If pre-check read itself fails transiently, proceed to main tx / outbox recovery flow
  }

  try {
    return await executeAtomicScoringTransaction(db, {
      uid,
      occurredAt,
      nowMs,
      primaryAction: {
        kind: 'question_answer',
        questionId,
        isCorrect: Boolean(params.isCorrect),
      },
    });
  } catch (err) {
    console.warn('Falha transitória ao registrar pontuação de questão no ranking:', sanitizeErrorForOutbox(err));
    const retryRes = await enqueueLeaderboardOutboxWithRetry(
      db,
      {
        uid,
        kind: 'question_answer',
        sourceId: questionId,
        payload,
        occurredAt,
        error: err,
        nowMs,
      },
      params.retryOptions
    );
    if (retryRes.ok) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: 'TRANSIENT_FAILURE_QUEUED',
        queuedForRecovery: true,
        outboxId: retryRes.outboxId,
        secondaryProofPersisted,
      };
    }

    console.warn('Falha ao gravar evento na fila de recuperação do ranking após retries:', retryRes.lastError);
    return {
      awarded: false,
      totalPointsAwarded: 0,
      events: [],
      reason: 'UNAVAILABLE',
      queuedForRecovery: false,
      secondaryProofPersisted,
    };
  }
}

/**
 * Safely executes scoring for a 100%-completed, owner-validated simulado.
 * Never throws; retries outbox write with backoff on transient failure and relies on
 * simulado_sessions + leaderboard_verified_actions for secondary reconciliation.
 */
export async function recordSimuladoCompletionScore(
  db: Firestore | null,
  params: {
    uid: string | null | undefined;
    sessionId: string;
    sessionOwnerUid: string | null | undefined;
    questionIds: string[];
    answers: Array<{ questionId: string; selectedOptionId: unknown; validOptionIds: string[] }>;
    occurredAt?: number;
    nowMs?: number;
    retryOptions?: RetryBackoffOptions;
  }
): Promise<LeaderboardScoringOutcome> {
  if (!db) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'UNAVAILABLE' };
  }

  const validation = validateSimuladoForRanking({
    uid: params.uid,
    sessionOwnerUid: params.sessionOwnerUid,
    questionIds: params.questionIds,
    answers: params.answers,
  });

  if (!validation.valid) {
    return {
      awarded: false,
      totalPointsAwarded: 0,
      events: [],
      reason: validation.reason,
    };
  }

  const uid = params.uid!.trim();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : '';
  if (!sessionId) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'INVALID_INPUT' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const occurredAt = params.occurredAt ?? nowMs;
  const payload = {
    sessionId,
    totalQuestions: validation.totalQuestions,
    fullyAnswered: true,
  };
  let secondaryProofPersisted = false;

  try {
    const preCheck = await readLeaderboardConfigEligibility(db, occurredAt);
    if (!preCheck.eligible) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: preCheck.reason,
      };
    }

    try {
      await persistServerVerifiedAction(db, {
        uid,
        kind: 'simulado_completed',
        sourceId: sessionId,
        payload,
        occurredAt,
        nowMs,
      });
      secondaryProofPersisted = true;
    } catch {
      // simulado_sessions also acts as an independent persistent server proof
    }
  } catch {
    // Proceed to main tx / outbox fallback
  }

  try {
    return await executeAtomicScoringTransaction(db, {
      uid,
      occurredAt,
      nowMs,
      primaryAction: {
        kind: 'simulado_completed',
        sessionId,
      },
    });
  } catch (err) {
    console.warn('Falha transitória ao registrar pontuação de simulado no ranking:', sanitizeErrorForOutbox(err));
    const retryRes = await enqueueLeaderboardOutboxWithRetry(
      db,
      {
        uid,
        kind: 'simulado_completed',
        sourceId: sessionId,
        payload,
        occurredAt,
        error: err,
        nowMs,
      },
      params.retryOptions
    );
    if (retryRes.ok) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: 'TRANSIENT_FAILURE_QUEUED',
        queuedForRecovery: true,
        outboxId: retryRes.outboxId,
        secondaryProofPersisted,
      };
    }

    console.warn('Falha ao gravar simulado na fila de recuperação do ranking após retries:', retryRes.lastError);
    return {
      awarded: false,
      totalPointsAwarded: 0,
      events: [],
      reason: 'UNAVAILABLE',
      queuedForRecovery: false,
      secondaryProofPersisted,
    };
  }
}

/**
 * Safely records a completed study-plan activity day for 7-day consecutive streak verification.
 * Study activities themselves award 0 direct points, only counting as valid study days for the 7-day streak.
 */
export async function recordStudyActivityStreakCheck(
  db: Firestore | null,
  params: {
    uid: string | null | undefined;
    activityId: string;
    occurredAt?: number;
    nowMs?: number;
    retryOptions?: RetryBackoffOptions;
  }
): Promise<LeaderboardScoringOutcome> {
  if (!db) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'UNAVAILABLE' };
  }
  const uid = typeof params.uid === 'string' ? params.uid.trim() : '';
  const activityId = typeof params.activityId === 'string' ? params.activityId.trim() : '';
  if (!uid || !activityId) {
    return { awarded: false, totalPointsAwarded: 0, events: [], reason: 'INVALID_INPUT' };
  }

  const nowMs = params.nowMs ?? Date.now();
  const occurredAt = params.occurredAt ?? nowMs;
  const payload = { activityId };
  let secondaryProofPersisted = false;

  try {
    const preCheck = await readLeaderboardConfigEligibility(db, occurredAt);
    if (!preCheck.eligible) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: preCheck.reason,
      };
    }

    try {
      await persistServerVerifiedAction(db, {
        uid,
        kind: 'study_activity',
        sourceId: activityId,
        payload,
        occurredAt,
        nowMs,
      });
      secondaryProofPersisted = true;
    } catch {
      // users/{uid}/study_activities also persists the server-authored completion
    }
  } catch {
    // Proceed to main tx / outbox fallback
  }

  try {
    return await executeAtomicScoringTransaction(db, {
      uid,
      occurredAt,
      nowMs,
      primaryAction: {
        kind: 'study_activity',
        activityId,
      },
    });
  } catch (err) {
    console.warn('Falha transitória ao verificar sequência no ranking:', sanitizeErrorForOutbox(err));
    const retryRes = await enqueueLeaderboardOutboxWithRetry(
      db,
      {
        uid,
        kind: 'study_activity',
        sourceId: activityId,
        payload,
        occurredAt,
        error: err,
        nowMs,
      },
      params.retryOptions
    );
    if (retryRes.ok) {
      return {
        awarded: false,
        totalPointsAwarded: 0,
        events: [],
        reason: 'TRANSIENT_FAILURE_QUEUED',
        queuedForRecovery: true,
        outboxId: retryRes.outboxId,
        secondaryProofPersisted,
      };
    }

    console.warn('Falha ao gravar atividade na fila de recuperação do ranking após retries:', retryRes.lastError);
    return {
      awarded: false,
      totalPointsAwarded: 0,
      events: [],
      reason: 'UNAVAILABLE',
      queuedForRecovery: false,
      secondaryProofPersisted,
    };
  }
}

/**
 * Idempotent recovery processor for a single leaderboard_outbox item.
 * Re-applies the exact deterministic transaction without ever duplicating points.
 * - BEFORE_LAUNCH -> terminal 'skipped' (zero retroactive points ever)
 * - RANKING_INACTIVE -> keeps 'pending' (temporary pause never discards valid post-launch events)
 * - allowFailedRetry -> allows protected admin routines to safely recover previously 'failed' items
 */
export async function reprocessLeaderboardOutboxItem(
  db: Firestore,
  item: LeaderboardOutboxRecord,
  options: number | { nowMs?: number; allowFailedRetry?: boolean } = Date.now()
): Promise<{
  outboxId: string;
  status: LeaderboardOutboxRecord['status'];
  deferredInactive?: boolean;
  outcome: LeaderboardScoringOutcome | null;
}> {
  const nowMs = typeof options === 'number' ? options : (options.nowMs ?? Date.now());
  const allowFailedRetry = typeof options === 'number' ? false : Boolean(options.allowFailedRetry);
  const outboxRef = db.collection(LEADERBOARD_COLLECTIONS.outbox).doc(item.outboxId);
  const nowIso = new Date(nowMs).toISOString();

  if (item.status === 'processed' || item.status === 'skipped') {
    return { outboxId: item.outboxId, status: item.status, outcome: null };
  }
  if (item.status === 'failed' && !allowFailedRetry) {
    return { outboxId: item.outboxId, status: 'failed', outcome: null };
  }

  let primaryAction:
    | { kind: 'question_answer'; questionId: string; isCorrect: boolean }
    | { kind: 'simulado_completed'; sessionId: string }
    | { kind: 'study_activity'; activityId: string };

  if (item.kind === 'question_answer') {
    primaryAction = {
      kind: 'question_answer',
      questionId: String(item.payload?.questionId || item.sourceId),
      isCorrect: Boolean(item.payload?.isCorrect),
    };
  } else if (item.kind === 'simulado_completed') {
    if (item.payload?.fullyAnswered !== true) {
      await outboxRef.set(
        { status: 'skipped', updatedAt: nowIso, processedAt: nowIso, lastError: 'INCOMPLETE_SIMULADO' },
        { merge: true }
      );
      return { outboxId: item.outboxId, status: 'skipped', outcome: null };
    }
    primaryAction = {
      kind: 'simulado_completed',
      sessionId: String(item.payload?.sessionId || item.sourceId),
    };
  } else {
    primaryAction = {
      kind: 'study_activity',
      activityId: String(item.payload?.activityId || item.sourceId),
    };
  }

  try {
    const outcome = await executeAtomicScoringTransaction(db, {
      uid: item.uid,
      occurredAt: item.occurredAt,
      nowMs,
      primaryAction,
    });

    // If ranking is temporarily inactive, keep item pending (do NOT permanently skip valid events)
    if (outcome.reason === 'RANKING_INACTIVE') {
      return {
        outboxId: item.outboxId,
        status: item.status,
        deferredInactive: true,
        outcome,
      };
    }

    const terminalStatus: LeaderboardOutboxRecord['status'] =
      outcome.reason === 'BEFORE_LAUNCH' ? 'skipped' : 'processed';

    await outboxRef.set(
      {
        status: terminalStatus,
        attempts: assertNonNegativeCounter(item.attempts) + 1,
        lastError: null,
        updatedAt: nowIso,
        processedAt: nowIso,
      },
      { merge: true }
    );

    return { outboxId: item.outboxId, status: terminalStatus, outcome };
  } catch (err) {
    const nextAttempts = assertNonNegativeCounter(item.attempts) + 1;
    const nextStatus: LeaderboardOutboxRecord['status'] =
      nextAttempts >= 10 ? 'failed' : 'pending';
    await outboxRef.set(
      {
        status: nextStatus,
        attempts: nextAttempts,
        lastError: sanitizeErrorForOutbox(err),
        updatedAt: nowIso,
      },
      { merge: true }
    );
    return { outboxId: item.outboxId, status: nextStatus, outcome: null };
  }
}

export interface OutboxReprocessResult {
  processed: number;
  skipped: number;
  failed: number;
  deferredInactive: number;
  totalPointsRecovered: number;
  pagesScanned: number;
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Paginated, cursor-based global (or per-user) recovery processor for leaderboard_outbox.
 * Supports arbitrarily large backlogs (>100 documents) via cursor pagination and optional
 * recovery of previously exhausted ('failed') outbox items.
 */
export async function reprocessPendingLeaderboardOutbox(
  db: Firestore,
  options: {
    uid?: string;
    limit?: number;
    pageSize?: number;
    maxTotal?: number;
    cursor?: string | null;
    includeFailed?: boolean;
    nowMs?: number;
  } = {}
): Promise<OutboxReprocessResult> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? options.limit ?? 50));
  const maxTotal = Math.min(2000, Math.max(1, options.maxTotal ?? options.limit ?? 500));
  const nowMs = options.nowMs ?? Date.now();
  const statusesToProcess: Array<'pending' | 'failed'> = options.includeFailed
    ? ['pending', 'failed']
    : ['pending'];

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let deferredInactive = 0;
  let totalPointsRecovered = 0;
  let pagesScanned = 0;
  let totalVisited = 0;
  let hasMore = false;
  let nextCursor: string | null = null;

  const rawCursor = typeof options.cursor === 'string' ? options.cursor.trim() : '';
  let startStatusIdx = 0;
  let parsedCursorId: string | null = null;
  if (rawCursor) {
    if (rawCursor.startsWith('failed:') && statusesToProcess.includes('failed')) {
      startStatusIdx = statusesToProcess.indexOf('failed');
      parsedCursorId = rawCursor.slice('failed:'.length).trim() || null;
    } else if (rawCursor.startsWith('pending:')) {
      startStatusIdx = 0;
      parsedCursorId = rawCursor.slice('pending:'.length).trim() || null;
    } else {
      parsedCursorId = rawCursor;
    }
  }

  for (let statusIdx = startStatusIdx; statusIdx < statusesToProcess.length; statusIdx++) {
    const targetStatus = statusesToProcess[statusIdx];
    let lastDocSnap: any = null;
    let initialCursorId = statusIdx === startStatusIdx ? parsedCursorId : null;

    while (totalVisited < maxTotal) {
      const remaining = maxTotal - totalVisited;
      const fetchSize = Math.min(pageSize, remaining);

      let query: any = db
        .collection(LEADERBOARD_COLLECTIONS.outbox)
        .where('status', '==', targetStatus);

      if (options.uid) {
        query = query.where('uid', '==', options.uid);
      }

      if (lastDocSnap && typeof query.startAfter === 'function') {
        query = query.startAfter(lastDocSnap);
      } else if (initialCursorId && typeof query.startAfter === 'function') {
        const cursorSnap = await db
          .collection(LEADERBOARD_COLLECTIONS.outbox)
          .doc(initialCursorId)
          .get();
        if (cursorSnap.exists) {
          query = query.startAfter(cursorSnap);
        }
        initialCursorId = null;
      }

      const snap = await query.limit(fetchSize).get();
      if (!snap.docs || snap.docs.length === 0) {
        break;
      }

      pagesScanned += 1;
      lastDocSnap = snap.docs[snap.docs.length - 1];

      const pageItems = snap.docs
        .map((doc: any) => doc.data() as LeaderboardOutboxRecord)
        .sort((a: LeaderboardOutboxRecord, b: LeaderboardOutboxRecord) => a.occurredAt - b.occurredAt);

      for (const item of pageItems) {
        totalVisited += 1;
        const res = await reprocessLeaderboardOutboxItem(db, item, {
          nowMs,
          allowFailedRetry: targetStatus === 'failed',
        });
        if (res.deferredInactive) {
          deferredInactive += 1;
        } else if (res.status === 'processed') {
          processed += 1;
          totalPointsRecovered += res.outcome?.totalPointsAwarded ?? 0;
        } else if (res.status === 'skipped') {
          skipped += 1;
        } else {
          failed += 1;
        }
      }

      if (snap.docs.length < fetchSize) {
        break;
      }

      if (totalVisited >= maxTotal) {
        hasMore = true;
        nextCursor = lastDocSnap?.id ? `${targetStatus}:${lastDocSnap.id}` : null;
        break;
      }
    }

    if (totalVisited >= maxTotal) {
      if (statusIdx < statusesToProcess.length - 1) {
        hasMore = true;
      }
      break;
    }
  }

  return {
    processed,
    skipped,
    failed,
    deferredInactive,
    totalPointsRecovered,
    pagesScanned,
    hasMore,
    nextCursor,
  };
}

export interface ServerReconciliationResult {
  active: boolean;
  scannedVerifiedActions: number;
  scannedSimuladoSessions: number;
  recovered: number;
  alreadyScored: number;
  skippedIneligible: number;
  errors: number;
  totalPointsRecovered: number;
  pagesScanned: number;
  hasMore: boolean;
}

/**
 * Secondary reconciliation exclusively from server-authored persistent collections:
 * 1) leaderboard_verified_actions (server-only proof of validated question/simulado/activity actions)
 * 2) simulado_sessions (server-only completed sessions with fullyAnsweredForRanking === true and ownerUid === completedByUid)
 * NEVER reads client-writable collections (e.g. users/{uid}/answers or users/{uid}/simulados).
 * Strictly enforces config.active === true and occurredAt >= config.launchAt.
 */
export async function reconcileLeaderboardFromServerSources(
  db: Firestore,
  options: {
    pageSize?: number;
    maxTotal?: number;
    nowMs?: number;
  } = {}
): Promise<ServerReconciliationResult> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50));
  const maxTotal = Math.min(2000, Math.max(1, options.maxTotal ?? 500));
  const nowMs = options.nowMs ?? Date.now();

  const configSnap = await db
    .collection(LEADERBOARD_COLLECTIONS.config)
    .doc(LEADERBOARD_CONFIG_DOC_ID)
    .get();
  const config = normalizeLeaderboardConfig(
    configSnap.exists ? (configSnap.data() as Record<string, any>) : null
  );

  if (!config.active || config.launchAt === null || !config.launchDateKey) {
    return {
      active: false,
      scannedVerifiedActions: 0,
      scannedSimuladoSessions: 0,
      recovered: 0,
      alreadyScored: 0,
      skippedIneligible: 0,
      errors: 0,
      totalPointsRecovered: 0,
      pagesScanned: 0,
      hasMore: false,
    };
  }

  let scannedVerifiedActions = 0;
  let scannedSimuladoSessions = 0;
  let recovered = 0;
  let alreadyScored = 0;
  let skippedIneligible = 0;
  let errors = 0;
  let totalPointsRecovered = 0;
  let pagesScanned = 0;
  let totalVisited = 0;
  let hasMore = false;

  // Source 1: leaderboard_verified_actions (paginated)
  {
    let lastDocSnap: any = null;
    while (totalVisited < maxTotal) {
      const fetchSize = Math.min(pageSize, maxTotal - totalVisited);
      let query: any = db.collection(LEADERBOARD_COLLECTIONS.verifiedActions);
      if (lastDocSnap && typeof query.startAfter === 'function') {
        query = query.startAfter(lastDocSnap);
      }
      const snap = await query.limit(fetchSize).get();
      if (!snap.docs || snap.docs.length === 0) break;

      pagesScanned += 1;
      lastDocSnap = snap.docs[snap.docs.length - 1];

      const docs = snap.docs
        .map((d: any) => d.data() as LeaderboardVerifiedActionRecord)
        .sort((a: LeaderboardVerifiedActionRecord, b: LeaderboardVerifiedActionRecord) => a.occurredAt - b.occurredAt);

      for (const action of docs) {
        totalVisited += 1;
        scannedVerifiedActions += 1;

        if (
          action.serverVerified !== true ||
          typeof action.uid !== 'string' ||
          !action.uid.trim() ||
          !Number.isFinite(action.occurredAt) ||
          action.occurredAt < config.launchAt
        ) {
          skippedIneligible += 1;
          continue;
        }

        try {
          if (action.kind === 'question_answer') {
            const questionId = String(action.payload?.questionId || action.sourceId).trim();
            if (!questionId) {
              skippedIneligible += 1;
              continue;
            }
            const evId = buildDeterministicEventId(action.uid, 'question_answer', questionId);
            const evSnap = await db.collection(LEADERBOARD_COLLECTIONS.events).doc(evId).get();
            if (evSnap.exists) {
              alreadyScored += 1;
              continue;
            }
            const outcome = await executeAtomicScoringTransaction(db, {
              uid: action.uid,
              occurredAt: action.occurredAt,
              nowMs,
              primaryAction: {
                kind: 'question_answer',
                questionId,
                isCorrect: Boolean(action.payload?.isCorrect),
              },
            });
            if (outcome.awarded) {
              recovered += 1;
              totalPointsRecovered += outcome.totalPointsAwarded;
            } else if (outcome.reason === 'DUPLICATE_EVENT') {
              alreadyScored += 1;
            } else {
              skippedIneligible += 1;
            }
          } else if (action.kind === 'simulado_completed') {
            const sessionId = String(action.payload?.sessionId || action.sourceId).trim();
            if (!sessionId || action.payload?.fullyAnswered !== true) {
              skippedIneligible += 1;
              continue;
            }
            const evId = buildDeterministicEventId(action.uid, 'simulado_completed', sessionId);
            const evSnap = await db.collection(LEADERBOARD_COLLECTIONS.events).doc(evId).get();
            if (evSnap.exists) {
              alreadyScored += 1;
              continue;
            }
            const outcome = await executeAtomicScoringTransaction(db, {
              uid: action.uid,
              occurredAt: action.occurredAt,
              nowMs,
              primaryAction: {
                kind: 'simulado_completed',
                sessionId,
              },
            });
            if (outcome.awarded) {
              recovered += 1;
              totalPointsRecovered += outcome.totalPointsAwarded;
            } else if (outcome.reason === 'DUPLICATE_EVENT') {
              alreadyScored += 1;
            } else {
              skippedIneligible += 1;
            }
          } else if (action.kind === 'study_activity') {
            const activityId = String(action.payload?.activityId || action.sourceId).trim();
            if (!activityId) {
              skippedIneligible += 1;
              continue;
            }
            const outcome = await executeAtomicScoringTransaction(db, {
              uid: action.uid,
              occurredAt: action.occurredAt,
              nowMs,
              primaryAction: {
                kind: 'study_activity',
                activityId,
              },
            });
            if (outcome.awarded) {
              recovered += 1;
              totalPointsRecovered += outcome.totalPointsAwarded;
            } else {
              alreadyScored += 1;
            }
          }
        } catch {
          errors += 1;
        }
      }

      if (snap.docs.length < fetchSize) break;
      if (totalVisited >= maxTotal) {
        hasMore = true;
        break;
      }
    }
  }

  // Source 2: simulado_sessions (independent server-authored record of completed 100%-valid simulados)
  if (totalVisited < maxTotal) {
    let lastDocSnap: any = null;
    while (totalVisited < maxTotal) {
      const fetchSize = Math.min(pageSize, maxTotal - totalVisited);
      let query: any = db
        .collection('simulado_sessions')
        .where('fullyAnsweredForRanking', '==', true);
      if (lastDocSnap && typeof query.startAfter === 'function') {
        query = query.startAfter(lastDocSnap);
      }
      const snap = await query.limit(fetchSize).get();
      if (!snap.docs || snap.docs.length === 0) break;

      pagesScanned += 1;
      lastDocSnap = snap.docs[snap.docs.length - 1];

      for (const doc of snap.docs) {
        totalVisited += 1;
        scannedSimuladoSessions += 1;
        const s = doc.data() as Record<string, any>;

        const ownerUid = typeof s?.ownerUid === 'string' ? s.ownerUid.trim() : '';
        const completedByUid = typeof s?.completedByUid === 'string' ? s.completedByUid.trim() : '';
        const completedAt = typeof s?.completedAt === 'number' ? s.completedAt : 0;
        const sessionId = typeof s?.id === 'string' && s.id.trim() ? s.id.trim() : doc.id;
        const hasQuestions = Array.isArray(s?.questionIds) && s.questionIds.length > 0;

        if (
          !ownerUid ||
          ownerUid !== completedByUid ||
          !hasQuestions ||
          s?.fullyAnsweredForRanking !== true ||
          completedAt < config.launchAt
        ) {
          skippedIneligible += 1;
          continue;
        }

        try {
          const evId = buildDeterministicEventId(ownerUid, 'simulado_completed', sessionId);
          const evSnap = await db.collection(LEADERBOARD_COLLECTIONS.events).doc(evId).get();
          if (evSnap.exists) {
            alreadyScored += 1;
            continue;
          }
          const outcome = await executeAtomicScoringTransaction(db, {
            uid: ownerUid,
            occurredAt: completedAt,
            nowMs,
            primaryAction: {
              kind: 'simulado_completed',
              sessionId,
            },
          });
          if (outcome.awarded) {
            recovered += 1;
            totalPointsRecovered += outcome.totalPointsAwarded;
          } else if (outcome.reason === 'DUPLICATE_EVENT') {
            alreadyScored += 1;
          } else {
            skippedIneligible += 1;
          }
        } catch {
          errors += 1;
        }
      }

      if (snap.docs.length < fetchSize) break;
      if (totalVisited >= maxTotal) {
        hasMore = true;
        break;
      }
    }
  }

  return {
    active: true,
    scannedVerifiedActions,
    scannedSimuladoSessions,
    recovered,
    alreadyScored,
    skippedIneligible,
    errors,
    totalPointsRecovered,
    pagesScanned,
    hasMore,
  };
}
