import type { Discipline, Question } from '../src/types/index.js';

export type EvolutionPeriodDays = 7 | 30 | 90;

export interface RawAnswerRecord {
  questionId: string;
  disciplineId?: string;
  subject?: string;
  selectedOptionId?: string;
  isCorrect?: boolean;
  timestamp?: unknown;
  updatedAt?: unknown;
}

export interface RawSimuladoRecord {
  id: string;
  configTitle?: string;
  disciplineId?: string;
  totalQuestions?: number;
  correctAnswers?: number;
  timeSpentSeconds?: number;
  date?: unknown;
  createdAt?: unknown;
}

export interface PeriodComparison {
  periodDays: EvolutionPeriodDays;
  hasEnoughData: boolean;
  minRequiredPerPeriod: number;
  currentCount: number;
  previousCount: number;
  currentAccuracy: number | null;
  previousAccuracy: number | null;
  accuracyDelta: number | null;
  volumeDelta: number;
}

export interface EvolutionPoint {
  dateKey: string;
  label: string;
  answered: number;
  correct: number;
  incorrect: number;
  accuracyPercent: number;
}

export interface EvolutionSeries {
  periodDays: EvolutionPeriodDays;
  totalAnswered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercent: number;
  activeDays: number;
  hasEnoughData: boolean;
  insufficientReason: string | null;
  points: EvolutionPoint[];
  comparison: PeriodComparison;
}

export type DisciplineAttentionStatus = 'strong' | 'evolving' | 'attention' | 'insufficient';

export interface DisciplinePerformanceItem {
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
  status: DisciplineAttentionStatus;
  statusLabel: string;
}

export interface UnstudiedDisciplineItem {
  disciplineId: string;
  disciplineName: string;
  shortName: string;
  oabWeight: number;
  catalogCount: number;
}

export interface SubjectPerformanceItem {
  disciplineId: string;
  disciplineName: string;
  subject: string;
  answered: number;
  correct: number;
  incorrect: number;
  accuracyPercent: number;
  catalogCount: number;
}

export interface SubjectInsights {
  hasEnoughData: boolean;
  minAnswersPerSubject: number;
  totalTrackedSubjects: number;
  strongest: SubjectPerformanceItem[];
  weakest: SubjectPerformanceItem[];
  understudied: SubjectPerformanceItem[];
}

export interface ErrorHistoryItem {
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

export interface ErrorHistoryDisciplineFilterOption {
  disciplineId: string;
  disciplineName: string;
  count: number;
}

export interface ErrorHistorySection {
  totalErrors: number;
  filteredTotal: number;
  selectedDisciplineId: string;
  page: number;
  limit: number;
  totalPages: number;
  availableDisciplines: ErrorHistoryDisciplineFilterOption[];
  retryableQuestionIds: string[];
  items: ErrorHistoryItem[];
}

export interface SimuladoHistoryItem {
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

export interface SimuladoHistorySection {
  total: number;
  averageAccuracy: number | null;
  page: number;
  limit: number;
  totalPages: number;
  items: SimuladoHistoryItem[];
}

export interface StudyRecommendationItem {
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

export interface RecommendationsSection {
  hasEnoughData: boolean;
  minRequiredAnswers: number;
  currentAnswers: number;
  message: string | null;
  items: StudyRecommendationItem[];
}

export interface PerformanceOverview {
  hasAnswers: boolean;
  totalAnswered: number;
  totalCorrect: number;
  totalIncorrect: number;
  accuracyPercent: number;
  todayAnswered: number;
  simuladosCompleted: number;
  studiedDisciplinesCount: number;
  totalDisciplinesCount: number;
  periodComparison: PeriodComparison;
}

export interface PerformanceReportPayload {
  generatedAt: string;
  isPremium: boolean;
  subscriptionStatus: string;
  overview: PerformanceOverview;
  evolution: Record<'7' | '30' | '90', EvolutionSeries>;
  disciplines: DisciplinePerformanceItem[];
  unstudiedDisciplines: UnstudiedDisciplineItem[];
  subjects: SubjectInsights;
  errorHistory: ErrorHistorySection;
  simuladosHistory: SimuladoHistorySection;
  recommendations: RecommendationsSection;
}

export interface BuildPerformanceReportParams {
  answers: RawAnswerRecord[];
  simulados: RawSimuladoRecord[];
  questionsMap: Map<string, Question>;
  disciplines: Discipline[];
  catalogSubjectCounts: Map<string, { disciplineId: string; subject: string; count: number }>;
  catalogDisciplineCounts: Map<string, number>;
  isPremium: boolean;
  subscriptionStatus: string;
  nowMs?: number;
  errorsPage?: number;
  errorsLimit?: number;
  errorDisciplineId?: string;
  simuladosPage?: number;
  simuladosLimit?: number;
}

export const MIN_ANSWERS_FOR_RECOMMENDATIONS = 10;
export const MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION = 5;
export const MIN_ANSWERS_FOR_SUBJECT_RANKING = 3;
export const MIN_ANSWERS_FOR_PERIOD_COMPARISON = 5;
export const MIN_ACTIVE_DAYS_FOR_EVOLUTION = 2;

const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Handle unix seconds vs milliseconds defensively
    return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toMillis === 'function') {
      try {
        const ms = (obj.toMillis as () => number)();
        if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return Math.round(ms);
      } catch {
        // ignore
      }
    }
    if (typeof obj.seconds === 'number' && Number.isFinite(obj.seconds)) {
      const nanos = typeof obj.nanoseconds === 'number' ? obj.nanoseconds : 0;
      return Math.round(obj.seconds * 1000 + nanos / 1_000_000);
    }
    if (typeof obj._seconds === 'number' && Number.isFinite(obj._seconds)) {
      const nanos = typeof obj._nanoseconds === 'number' ? obj._nanoseconds : 0;
      return Math.round(obj._seconds * 1000 + nanos / 1_000_000);
    }
  }
  return null;
}

export function getSaoPauloDateKey(timestampMs: number): string {
  const shifted = new Date(timestampMs + SAO_PAULO_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatShortDateLabel(dateKey: string): string {
  const parts = dateKey.split('-');
  if (parts.length !== 3) return dateKey;
  return `${parts[2]}/${parts[1]}`;
}

function dateKeyToDayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / DAY_MS);
}

function normalizeOptionId(raw: unknown): 'A' | 'B' | 'C' | 'D' {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'A' || upper === 'B' || upper === 'C' || upper === 'D') {
    return upper;
  }
  return 'A';
}

function roundPercent(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 100);
}

export function buildQuestionCatalogIndexes(questions: Question[]) {
  const questionsMap = new Map<string, Question>();
  const catalogSubjectCounts = new Map<
    string,
    { disciplineId: string; subject: string; count: number }
  >();
  const catalogDisciplineCounts = new Map<string, number>();

  for (const q of questions) {
    questionsMap.set(q.id, q);
    catalogDisciplineCounts.set(
      q.disciplineId,
      (catalogDisciplineCounts.get(q.disciplineId) || 0) + 1
    );
    const subjectKey = `${q.disciplineId}::${q.subject}`;
    const existing = catalogSubjectCounts.get(subjectKey);
    if (existing) {
      existing.count += 1;
    } else {
      catalogSubjectCounts.set(subjectKey, {
        disciplineId: q.disciplineId,
        subject: q.subject,
        count: 1,
      });
    }
  }

  return { questionsMap, catalogSubjectCounts, catalogDisciplineCounts };
}

interface NormalizedAnswer {
  questionId: string;
  disciplineId: string;
  disciplineName: string;
  subject: string;
  selectedOptionId: 'A' | 'B' | 'C' | 'D';
  isCorrect: boolean;
  timestampMs: number | null;
  dateKey: string | null;
  dayIndex: number | null;
  question: Question | null;
}

function buildEvolutionSeries(
  periodDays: EvolutionPeriodDays,
  normalizedAnswers: NormalizedAnswer[],
  todayDayIndex: number
): EvolutionSeries {
  const currentStartDay = todayDayIndex - (periodDays - 1);
  const previousStartDay = currentStartDay - periodDays;
  const previousEndDay = currentStartDay - 1;

  const byDate = new Map<string, { answered: number; correct: number }>();
  let currentAnswered = 0;
  let currentCorrect = 0;
  let previousAnswered = 0;
  let previousCorrect = 0;

  for (const ans of normalizedAnswers) {
    if (ans.dayIndex === null || ans.dateKey === null) continue;
    if (ans.dayIndex >= currentStartDay && ans.dayIndex <= todayDayIndex) {
      currentAnswered += 1;
      if (ans.isCorrect) currentCorrect += 1;

      const bucket = byDate.get(ans.dateKey) || { answered: 0, correct: 0 };
      bucket.answered += 1;
      if (ans.isCorrect) bucket.correct += 1;
      byDate.set(ans.dateKey, bucket);
    } else if (ans.dayIndex >= previousStartDay && ans.dayIndex <= previousEndDay) {
      previousAnswered += 1;
      if (ans.isCorrect) previousCorrect += 1;
    }
  }

  const points: EvolutionPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, bucket]) => ({
      dateKey,
      label: formatShortDateLabel(dateKey),
      answered: bucket.answered,
      correct: bucket.correct,
      incorrect: bucket.answered - bucket.correct,
      accuracyPercent: roundPercent(bucket.correct, bucket.answered),
    }));

  const activeDays = points.length;
  const hasEnoughData = activeDays >= MIN_ACTIVE_DAYS_FOR_EVOLUTION;
  let insufficientReason: string | null = null;

  if (currentAnswered === 0) {
    insufficientReason = `Nenhuma questão respondida nos últimos ${periodDays} dias. Resolva questões para iniciar sua curva de evolução.`;
  } else if (!hasEnoughData) {
    insufficientReason = `Há respostas registradas em apenas ${activeDays} dia neste período (${currentAnswered} ${
      currentAnswered === 1 ? 'questão' : 'questões'
    }). Estude em pelo menos ${MIN_ACTIVE_DAYS_FOR_EVOLUTION} dias diferentes para visualizar a curva de evolução.`;
  }

  const hasComparisonData =
    currentAnswered >= MIN_ANSWERS_FOR_PERIOD_COMPARISON &&
    previousAnswered >= MIN_ANSWERS_FOR_PERIOD_COMPARISON;

  const currentAccuracy = currentAnswered > 0 ? roundPercent(currentCorrect, currentAnswered) : null;
  const previousAccuracy =
    previousAnswered > 0 ? roundPercent(previousCorrect, previousAnswered) : null;

  return {
    periodDays,
    totalAnswered: currentAnswered,
    totalCorrect: currentCorrect,
    totalIncorrect: currentAnswered - currentCorrect,
    accuracyPercent: roundPercent(currentCorrect, currentAnswered),
    activeDays,
    hasEnoughData,
    insufficientReason,
    points,
    comparison: {
      periodDays,
      hasEnoughData: hasComparisonData,
      minRequiredPerPeriod: MIN_ANSWERS_FOR_PERIOD_COMPARISON,
      currentCount: currentAnswered,
      previousCount: previousAnswered,
      currentAccuracy: hasComparisonData ? currentAccuracy : null,
      previousAccuracy: hasComparisonData ? previousAccuracy : null,
      accuracyDelta:
        hasComparisonData && currentAccuracy !== null && previousAccuracy !== null
          ? currentAccuracy - previousAccuracy
          : null,
      volumeDelta: currentAnswered - previousAnswered,
    },
  };
}

export function buildPerformanceReport(
  params: BuildPerformanceReportParams
): PerformanceReportPayload {
  const nowMs = params.nowMs ?? Date.now();
  const todayDateKey = getSaoPauloDateKey(nowMs);
  const todayDayIndex = dateKeyToDayIndex(todayDateKey);

  const disciplineById = new Map<string, Discipline>();
  for (const d of params.disciplines) {
    disciplineById.set(d.id, d);
  }

  // Deduplicate by questionId preserving latest valid answer if duplicates ever exist
  const normalizedAnswers: NormalizedAnswer[] = [];
  for (const raw of params.answers) {
    if (!raw || typeof raw.questionId !== 'string' || !raw.questionId.trim()) continue;
    const questionId = raw.questionId.trim();
    const catalogQuestion = params.questionsMap.get(questionId) || null;
    const disciplineId =
      catalogQuestion?.disciplineId ||
      (typeof raw.disciplineId === 'string' && raw.disciplineId.trim()
        ? raw.disciplineId.trim()
        : 'geral');
    const discipline = disciplineById.get(disciplineId);
    const disciplineName = discipline?.name || disciplineId;
    const subject =
      catalogQuestion?.subject ||
      (typeof raw.subject === 'string' && raw.subject.trim()
        ? raw.subject.trim()
        : 'Assunto geral');

    const timestampMs = normalizeTimestampMs(raw.timestamp ?? raw.updatedAt);
    const dateKey = timestampMs !== null ? getSaoPauloDateKey(timestampMs) : null;
    const dayIndex = dateKey !== null ? dateKeyToDayIndex(dateKey) : null;

    normalizedAnswers.push({
      questionId,
      disciplineId,
      disciplineName,
      subject,
      selectedOptionId: normalizeOptionId(raw.selectedOptionId),
      isCorrect: Boolean(raw.isCorrect),
      timestampMs,
      dateKey,
      dayIndex,
      question: catalogQuestion,
    });
  }

  const totalAnswered = normalizedAnswers.length;
  const totalCorrect = normalizedAnswers.filter((a) => a.isCorrect).length;
  const totalIncorrect = totalAnswered - totalCorrect;
  const overallAccuracy = roundPercent(totalCorrect, totalAnswered);
  const todayAnswered = normalizedAnswers.filter((a) => a.dateKey === todayDateKey).length;

  // Evolution series for 7, 30 and 90 days
  const evolution7 = buildEvolutionSeries(7, normalizedAnswers, todayDayIndex);
  const evolution30 = buildEvolutionSeries(30, normalizedAnswers, todayDayIndex);
  const evolution90 = buildEvolutionSeries(90, normalizedAnswers, todayDayIndex);

  // Discipline performance
  const disciplineBuckets = new Map<string, { answered: number; correct: number }>();
  for (const ans of normalizedAnswers) {
    const bucket = disciplineBuckets.get(ans.disciplineId) || { answered: 0, correct: 0 };
    bucket.answered += 1;
    if (ans.isCorrect) bucket.correct += 1;
    disciplineBuckets.set(ans.disciplineId, bucket);
  }

  const disciplines: DisciplinePerformanceItem[] = [];
  const unstudiedDisciplines: UnstudiedDisciplineItem[] = [];

  for (const disc of params.disciplines) {
    const bucket = disciplineBuckets.get(disc.id);
    if (!bucket || bucket.answered === 0) {
      unstudiedDisciplines.push({
        disciplineId: disc.id,
        disciplineName: disc.name,
        shortName: disc.shortName,
        oabWeight: disc.oabWeight,
        catalogCount: params.catalogDisciplineCounts.get(disc.id) || 0,
      });
      continue;
    }

    const accuracyPercent = roundPercent(bucket.correct, bucket.answered);
    const hasMinSample = bucket.answered >= MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION;
    const belowCriticalThreshold = hasMinSample && accuracyPercent < 60;
    const significantlyBelowAverage =
      hasMinSample &&
      totalAnswered >= MIN_ANSWERS_FOR_RECOMMENDATIONS &&
      accuracyPercent <= overallAccuracy - 10;

    const needsAttention = belowCriticalThreshold || significantlyBelowAverage;
    let attentionReason: string | null = null;
    if (belowCriticalThreshold && significantlyBelowAverage) {
      attentionReason = `Aproveitamento de ${accuracyPercent}% (abaixo da meta de 60% e ${
        overallAccuracy - accuracyPercent
      } p.p. abaixo da sua média geral).`;
    } else if (belowCriticalThreshold) {
      attentionReason = `Aproveitamento de ${accuracyPercent}% em ${bucket.answered} questões (abaixo da referência de 60%).`;
    } else if (significantlyBelowAverage) {
      attentionReason = `${
        overallAccuracy - accuracyPercent
      } p.p. abaixo da sua média geral de ${overallAccuracy}%.`;
    }

    let status: DisciplineAttentionStatus;
    let statusLabel: string;
    if (!hasMinSample) {
      status = 'insufficient';
      statusLabel = 'Poucas respostas';
    } else if (needsAttention) {
      status = 'attention';
      statusLabel = 'Precisa de atenção';
    } else if (accuracyPercent >= 75) {
      status = 'strong';
      statusLabel = 'Bom domínio';
    } else {
      status = 'evolving';
      statusLabel = 'Em evolução';
    }

    disciplines.push({
      disciplineId: disc.id,
      disciplineName: disc.name,
      shortName: disc.shortName,
      oabWeight: disc.oabWeight,
      answered: bucket.answered,
      correct: bucket.correct,
      incorrect: bucket.answered - bucket.correct,
      accuracyPercent,
      needsAttention,
      attentionReason,
      status,
      statusLabel,
    });
  }

  // Handle any legacy answers referencing a disciplineId not in OAB_DISCIPLINES
  for (const [discId, bucket] of disciplineBuckets.entries()) {
    if (disciplineById.has(discId)) continue;
    const accuracyPercent = roundPercent(bucket.correct, bucket.answered);
    const hasMinSample = bucket.answered >= MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION;
    const needsAttention = hasMinSample && accuracyPercent < 60;
    disciplines.push({
      disciplineId: discId,
      disciplineName: discId,
      shortName: discId,
      oabWeight: 0,
      answered: bucket.answered,
      correct: bucket.correct,
      incorrect: bucket.answered - bucket.correct,
      accuracyPercent,
      needsAttention,
      attentionReason: needsAttention
        ? `Aproveitamento de ${accuracyPercent}% em ${bucket.answered} questões.`
        : null,
      status: !hasMinSample
        ? 'insufficient'
        : needsAttention
          ? 'attention'
          : accuracyPercent >= 75
            ? 'strong'
            : 'evolving',
      statusLabel: !hasMinSample
        ? 'Poucas respostas'
        : needsAttention
          ? 'Precisa de atenção'
          : accuracyPercent >= 75
            ? 'Bom domínio'
            : 'Em evolução',
    });
  }

  unstudiedDisciplines.sort((a, b) => b.oabWeight - a.oabWeight || a.disciplineName.localeCompare(b.disciplineName, 'pt-BR'));

  // Default order for disciplines: attention / worst first so API response is deterministic
  disciplines.sort(
    (a, b) =>
      a.accuracyPercent - b.accuracyPercent ||
      b.answered - a.answered ||
      a.disciplineName.localeCompare(b.disciplineName, 'pt-BR')
  );

  // Subject performance (based on real question bank subjects)
  const subjectBuckets = new Map<
    string,
    {
      disciplineId: string;
      disciplineName: string;
      subject: string;
      answered: number;
      correct: number;
      wrongQuestionIds: string[];
    }
  >();

  for (const ans of normalizedAnswers) {
    const key = `${ans.disciplineId}::${ans.subject}`;
    const existing = subjectBuckets.get(key) || {
      disciplineId: ans.disciplineId,
      disciplineName: ans.disciplineName,
      subject: ans.subject,
      answered: 0,
      correct: 0,
      wrongQuestionIds: [],
    };
    existing.answered += 1;
    if (ans.isCorrect) {
      existing.correct += 1;
    } else {
      existing.wrongQuestionIds.push(ans.questionId);
    }
    subjectBuckets.set(key, existing);
  }

  const allAnsweredSubjects: SubjectPerformanceItem[] = Array.from(subjectBuckets.entries()).map(
    ([key, b]) => ({
      disciplineId: b.disciplineId,
      disciplineName: b.disciplineName,
      subject: b.subject,
      answered: b.answered,
      correct: b.correct,
      incorrect: b.answered - b.correct,
      accuracyPercent: roundPercent(b.correct, b.answered),
      catalogCount: params.catalogSubjectCounts.get(key)?.count || 0,
    })
  );

  const qualifiedSubjects = allAnsweredSubjects.filter(
    (s) => s.answered >= MIN_ANSWERS_FOR_SUBJECT_RANKING
  );

  const strongestSubjects = qualifiedSubjects
    .filter((s) => s.accuracyPercent >= 70)
    .sort(
      (a, b) =>
        b.accuracyPercent - a.accuracyPercent ||
        b.answered - a.answered ||
        a.subject.localeCompare(b.subject, 'pt-BR')
    )
    .slice(0, 8);

  const weakestSubjects = qualifiedSubjects
    .filter((s) => s.incorrect > 0 && s.accuracyPercent < 70)
    .sort(
      (a, b) =>
        a.accuracyPercent - b.accuracyPercent ||
        b.incorrect - a.incorrect ||
        a.subject.localeCompare(b.subject, 'pt-BR')
    )
    .slice(0, 8);

  // Understudied subjects: prioritize lightly answered (1-2 answers) in studied disciplines,
  // then unattempted catalog subjects from high-weight OAB disciplines.
  const lightlyStudied = allAnsweredSubjects
    .filter((s) => s.answered > 0 && s.answered < MIN_ANSWERS_FOR_SUBJECT_RANKING)
    .sort((a, b) => a.answered - b.answered || b.catalogCount - a.catalogCount);

  const unattemptedCatalogSubjects: SubjectPerformanceItem[] = [];
  if (totalAnswered > 0) {
    const studiedDisciplineIds = new Set(disciplines.map((d) => d.disciplineId));
    for (const [key, meta] of params.catalogSubjectCounts.entries()) {
      if (subjectBuckets.has(key)) continue;
      const disc = disciplineById.get(meta.disciplineId);
      if (!disc) continue;
      // Prefer subjects inside disciplines the student already touches or core OAB subjects (weight >= 5)
      if (!studiedDisciplineIds.has(meta.disciplineId) && disc.oabWeight < 5) continue;
      unattemptedCatalogSubjects.push({
        disciplineId: meta.disciplineId,
        disciplineName: disc.name,
        subject: meta.subject,
        answered: 0,
        correct: 0,
        incorrect: 0,
        accuracyPercent: 0,
        catalogCount: meta.count,
      });
    }
    unattemptedCatalogSubjects.sort((a, b) => {
      const weightA = disciplineById.get(a.disciplineId)?.oabWeight || 0;
      const weightB = disciplineById.get(b.disciplineId)?.oabWeight || 0;
      return weightB - weightA || b.catalogCount - a.catalogCount || a.subject.localeCompare(b.subject, 'pt-BR');
    });
  }

  const understudiedSubjects = [...lightlyStudied, ...unattemptedCatalogSubjects].slice(0, 8);

  const subjects: SubjectInsights = {
    hasEnoughData: strongestSubjects.length > 0 || weakestSubjects.length > 0,
    minAnswersPerSubject: MIN_ANSWERS_FOR_SUBJECT_RANKING,
    totalTrackedSubjects: allAnsweredSubjects.length,
    strongest: strongestSubjects,
    weakest: weakestSubjects,
    understudied: understudiedSubjects,
  };

  // Error history (paginated + discipline filter)
  const allErrors = normalizedAnswers
    .filter((a) => !a.isCorrect)
    .sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));

  const errorDisciplineCounts = new Map<string, { disciplineName: string; count: number }>();
  for (const err of allErrors) {
    const cur = errorDisciplineCounts.get(err.disciplineId) || {
      disciplineName: err.disciplineName,
      count: 0,
    };
    cur.count += 1;
    errorDisciplineCounts.set(err.disciplineId, cur);
  }

  const availableErrorDisciplines: ErrorHistoryDisciplineFilterOption[] = Array.from(
    errorDisciplineCounts.entries()
  )
    .map(([disciplineId, info]) => ({
      disciplineId,
      disciplineName: info.disciplineName,
      count: info.count,
    }))
    .sort((a, b) => b.count - a.count || a.disciplineName.localeCompare(b.disciplineName, 'pt-BR'));

  const selectedErrorDiscipline =
    params.errorDisciplineId &&
    params.errorDisciplineId !== 'todas' &&
    errorDisciplineCounts.has(params.errorDisciplineId)
      ? params.errorDisciplineId
      : 'todas';

  const filteredErrors =
    selectedErrorDiscipline === 'todas'
      ? allErrors
      : allErrors.filter((e) => e.disciplineId === selectedErrorDiscipline);

  const errorsLimit = Math.min(25, Math.max(1, Math.floor(params.errorsLimit || 10)));
  const errorsTotalPages = Math.max(1, Math.ceil(filteredErrors.length / errorsLimit));
  const errorsPage = Math.min(
    errorsTotalPages,
    Math.max(1, Math.floor(params.errorsPage || 1))
  );
  const errorStart = (errorsPage - 1) * errorsLimit;
  const pagedErrors: ErrorHistoryItem[] = filteredErrors
    .slice(errorStart, errorStart + errorsLimit)
    .map((err) => {
      const q = err.question;
      const selectedOpt = q?.options.find((o) => o.id === err.selectedOptionId);
      const correctOpt = q?.options.find((o) => o.id === q.correctOptionId);
      const answeredAt = err.timestampMs ?? 0;

      return {
        questionId: err.questionId,
        disciplineId: err.disciplineId,
        disciplineName: err.disciplineName,
        subject: err.subject,
        statement:
          q?.statement ||
          'Enunciado indisponível para este registro legado no banco atual.',
        answeredAt,
        answeredAtIso: answeredAt > 0 ? new Date(answeredAt).toISOString() : '',
        selectedOptionId: err.selectedOptionId,
        selectedOptionText: selectedOpt?.text || `Alternativa ${err.selectedOptionId}`,
        correctOptionId: q?.correctOptionId || null,
        correctOptionText:
          correctOpt?.text ||
          (q?.correctOptionId ? `Alternativa ${q.correctOptionId}` : 'Gabarito indisponível'),
        explanation: q?.explanation || '',
        legalFoundation: q?.legalFoundation || '',
        difficulty: q?.difficulty || 'Médio',
        examReference: q?.examReference || null,
      };
    });

  const retryableQuestionIds = filteredErrors
    .filter((e) => e.question !== null)
    .slice(0, 20)
    .map((e) => e.questionId);

  const errorHistory: ErrorHistorySection = {
    totalErrors: allErrors.length,
    filteredTotal: filteredErrors.length,
    selectedDisciplineId: selectedErrorDiscipline,
    page: errorsPage,
    limit: errorsLimit,
    totalPages: errorsTotalPages,
    availableDisciplines: availableErrorDisciplines,
    retryableQuestionIds,
    items: pagedErrors,
  };

  // Simulados history (paginated, sorted newest first)
  const normalizedSimulados: (SimuladoHistoryItem & { sortMs: number })[] = [];
  for (const raw of params.simulados) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) continue;
    const totalQ = Math.max(0, Number(raw.totalQuestions) || 0);
    const correctQ = Math.min(totalQ, Math.max(0, Number(raw.correctAnswers) || 0));
    const timeSec = Math.max(0, Number(raw.timeSpentSeconds) || 0);
    const sortMs = normalizeTimestampMs(raw.date ?? raw.createdAt) ?? 0;
    const discId =
      typeof raw.disciplineId === 'string' && raw.disciplineId.trim()
        ? raw.disciplineId.trim()
        : 'todas';
    const discName =
      discId === 'todas'
        ? 'Simulado Geral'
        : disciplineById.get(discId)?.name || discId;

    normalizedSimulados.push({
      id: raw.id.trim(),
      configTitle:
        typeof raw.configTitle === 'string' && raw.configTitle.trim()
          ? raw.configTitle.trim()
          : 'Simulado OAB',
      disciplineId: discId,
      disciplineName: discName,
      totalQuestions: totalQ,
      correctAnswers: correctQ,
      incorrectAnswers: Math.max(0, totalQ - correctQ),
      accuracyPercent: roundPercent(correctQ, totalQ),
      timeSpentSeconds: timeSec,
      dateIso: sortMs > 0 ? new Date(sortMs).toISOString() : '',
      sortMs,
    });
  }

  normalizedSimulados.sort((a, b) => b.sortMs - a.sortMs);

  const simuladosLimit = Math.min(20, Math.max(1, Math.floor(params.simuladosLimit || 8)));
  const simuladosTotalPages = Math.max(1, Math.ceil(normalizedSimulados.length / simuladosLimit));
  const simuladosPage = Math.min(
    simuladosTotalPages,
    Math.max(1, Math.floor(params.simuladosPage || 1))
  );
  const simStart = (simuladosPage - 1) * simuladosLimit;

  const simuladosAverageAccuracy =
    normalizedSimulados.length > 0
      ? Math.round(
          normalizedSimulados.reduce((acc, s) => acc + s.accuracyPercent, 0) /
            normalizedSimulados.length
        )
      : null;

  const simuladosHistory: SimuladoHistorySection = {
    total: normalizedSimulados.length,
    averageAccuracy: simuladosAverageAccuracy,
    page: simuladosPage,
    limit: simuladosLimit,
    totalPages: simuladosTotalPages,
    items: normalizedSimulados.slice(simStart, simStart + simuladosLimit).map(({ sortMs: _s, ...item }) => item),
  };

  // Deterministic, data-driven study recommendations (strict minimum threshold)
  const recommendations = buildStudyRecommendations({
    totalAnswered,
    totalIncorrect,
    overallAccuracy,
    disciplines,
    unstudiedDisciplines,
    weakestSubjects,
    subjectBuckets,
    retryableQuestionIds,
    simuladosTotal: normalizedSimulados.length,
    simuladosAverageAccuracy,
  });

  return {
    generatedAt: new Date(nowMs).toISOString(),
    isPremium: params.isPremium,
    subscriptionStatus: params.subscriptionStatus,
    overview: {
      hasAnswers: totalAnswered > 0,
      totalAnswered,
      totalCorrect,
      totalIncorrect,
      accuracyPercent: overallAccuracy,
      todayAnswered,
      simuladosCompleted: normalizedSimulados.length,
      studiedDisciplinesCount: disciplines.length,
      totalDisciplinesCount: params.disciplines.length,
      periodComparison: evolution30.comparison,
    },
    evolution: {
      '7': evolution7,
      '30': evolution30,
      '90': evolution90,
    },
    disciplines,
    unstudiedDisciplines,
    subjects,
    errorHistory,
    simuladosHistory,
    recommendations,
  };
}

function buildStudyRecommendations(ctx: {
  totalAnswered: number;
  totalIncorrect: number;
  overallAccuracy: number;
  disciplines: DisciplinePerformanceItem[];
  unstudiedDisciplines: UnstudiedDisciplineItem[];
  weakestSubjects: SubjectPerformanceItem[];
  subjectBuckets: Map<
    string,
    {
      disciplineId: string;
      disciplineName: string;
      subject: string;
      answered: number;
      correct: number;
      wrongQuestionIds: string[];
    }
  >;
  retryableQuestionIds: string[];
  simuladosTotal: number;
  simuladosAverageAccuracy: number | null;
}): RecommendationsSection {
  if (ctx.totalAnswered < MIN_ANSWERS_FOR_RECOMMENDATIONS) {
    const remaining = MIN_ANSWERS_FOR_RECOMMENDATIONS - ctx.totalAnswered;
    return {
      hasEnoughData: false,
      minRequiredAnswers: MIN_ANSWERS_FOR_RECOMMENDATIONS,
      currentAnswers: ctx.totalAnswered,
      message:
        ctx.totalAnswered === 0
          ? `Responda pelo menos ${MIN_ANSWERS_FOR_RECOMMENDATIONS} questões para receber recomendações personalizadas baseadas no seu desempenho real.`
          : `Você já respondeu ${ctx.totalAnswered} ${
              ctx.totalAnswered === 1 ? 'questão' : 'questões'
            }. Responda mais ${remaining} para liberarmos diagnósticos confiáveis sem conclusões precipitadas.`,
      items: [],
    };
  }

  const items: StudyRecommendationItem[] = [];

  // 1. Disciplines needing attention (lowest accuracy among >= 5 answers)
  const attentionDisciplines = ctx.disciplines
    .filter((d) => d.needsAttention)
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent || b.oabWeight - a.oabWeight);

  if (attentionDisciplines.length > 0) {
    const top = attentionDisciplines[0];
    items.push({
      id: `disc-attention-${top.disciplineId}`,
      priority: 'alta',
      category: 'disciplina',
      title: `Reforçar ${top.disciplineName}`,
      description:
        top.attentionReason ||
        `Seu aproveitamento atual em ${top.disciplineName} está em ${top.accuracyPercent}% (${top.correct} de ${top.answered} questões). Priorize revisões dirigidas nesta matéria.`,
      metricSummary: `${top.accuracyPercent}% em ${top.answered} questões`,
      actionLabel: `Treinar ${top.shortName}`,
      targetDisciplineId: top.disciplineId,
    });
  }

  // 2. Weakest subject with >= 2 errors
  const criticalSubject = ctx.weakestSubjects.find((s) => s.incorrect >= 2);
  if (criticalSubject) {
    const bucket = ctx.subjectBuckets.get(
      `${criticalSubject.disciplineId}::${criticalSubject.subject}`
    );
    const subjectWrongIds = (bucket?.wrongQuestionIds || []).slice(0, 15);
    items.push({
      id: `subj-weak-${criticalSubject.disciplineId}-${criticalSubject.subject}`,
      priority: 'alta',
      category: 'assunto',
      title: `Revisar o assunto "${criticalSubject.subject}"`,
      description: `Em ${criticalSubject.disciplineName}, este assunto concentra ${criticalSubject.incorrect} ${
        criticalSubject.incorrect === 1 ? 'erro' : 'erros'
      } (${criticalSubject.accuracyPercent}% de aproveitamento em ${criticalSubject.answered} questões). Refazer os erros ajuda a fixar a fundamentação legal.`,
      metricSummary: `${criticalSubject.incorrect} erros · ${criticalSubject.accuracyPercent}% de acerto`,
      actionLabel: subjectWrongIds.length > 0 ? 'Refazer erros do assunto' : 'Praticar disciplina',
      targetDisciplineId: criticalSubject.disciplineId,
      targetQuestionIds: subjectWrongIds.length > 0 ? subjectWrongIds : undefined,
    });
  }

  // 3. Accumulated error retry recommendation
  if (ctx.retryableQuestionIds.length >= 3) {
    const batch = ctx.retryableQuestionIds.slice(0, 10);
    items.push({
      id: 'retry-recent-errors',
      priority: items.length === 0 ? 'alta' : 'media',
      category: 'revisao',
      title: 'Refazer suas questões erradas recentes',
      description: `Você possui ${ctx.totalIncorrect} ${
        ctx.totalIncorrect === 1 ? 'erro registrado' : 'erros registrados'
      } no histórico. A revisão espaçada das questões erradas acelera a retenção dos dispositivos mais cobrados.`,
      metricSummary: `${batch.length} questões selecionadas para revisão`,
      actionLabel: `Refazer ${batch.length} questões erradas`,
      targetQuestionIds: batch,
    });
  }

  // 4. High-weight OAB disciplines with low or zero coverage
  const priorityUnstudied = ctx.unstudiedDisciplines.find((d) => d.oabWeight >= 5);
  const lowVolumeCoreDiscipline = ctx.disciplines
    .filter((d) => d.oabWeight >= 5 && d.answered < MIN_ANSWERS_FOR_DISCIPLINE_ATTENTION)
    .sort((a, b) => b.oabWeight - a.oabWeight || a.answered - b.answered)[0];

  if (priorityUnstudied) {
    items.push({
      id: `coverage-unstudied-${priorityUnstudied.disciplineId}`,
      priority: 'media',
      category: 'cobertura',
      title: `Iniciar prática em ${priorityUnstudied.disciplineName}`,
      description: `${priorityUnstudied.disciplineName} tem peso relevante na 1ª Fase da OAB (aprox. ${priorityUnstudied.oabWeight} questões na prova) e ainda não possui respostas no seu histórico.`,
      metricSummary: `0 respondidas · peso ${priorityUnstudied.oabWeight} na OAB`,
      actionLabel: `Praticar ${priorityUnstudied.shortName}`,
      targetDisciplineId: priorityUnstudied.disciplineId,
    });
  } else if (lowVolumeCoreDiscipline) {
    items.push({
      id: `coverage-low-${lowVolumeCoreDiscipline.disciplineId}`,
      priority: 'media',
      category: 'cobertura',
      title: `Aumentar volume em ${lowVolumeCoreDiscipline.disciplineName}`,
      description: `Você respondeu apenas ${lowVolumeCoreDiscipline.answered} ${
        lowVolumeCoreDiscipline.answered === 1 ? 'questão' : 'questões'
      } em ${lowVolumeCoreDiscipline.disciplineName}, disciplina de alto peso na prova (${lowVolumeCoreDiscipline.oabWeight} questões). Ampliar a amostra permite um diagnóstico mais preciso.`,
      metricSummary: `${lowVolumeCoreDiscipline.answered} respondidas · peso ${lowVolumeCoreDiscipline.oabWeight}`,
      actionLabel: `Treinar ${lowVolumeCoreDiscipline.shortName}`,
      targetDisciplineId: lowVolumeCoreDiscipline.disciplineId,
    });
  }

  // 5. Simulado consolidation recommendation
  if (ctx.totalAnswered >= 20 && ctx.simuladosTotal === 0) {
    items.push({
      id: 'simulado-first',
      priority: 'informativa',
      category: 'simulado',
      title: 'Realizar seu primeiro simulado cronometrado',
      description: `Você já acumula ${ctx.totalAnswered} questões resolvidas (${ctx.overallAccuracy}% de acertos). Fazer um simulado com tempo controlado ajuda a medir ritmo de prova e resistência.`,
      metricSummary: '0 simulados concluídos',
      actionLabel: 'Ir para Simulados',
    });
  } else if (ctx.simuladosTotal > 0 && ctx.simuladosAverageAccuracy !== null && ctx.simuladosAverageAccuracy < 60) {
    items.push({
      id: 'simulado-below-target',
      priority: 'media',
      category: 'simulado',
      title: 'Elevar desempenho em simulados cronometrados',
      description: `Sua média nos simulados concluídos é de ${ctx.simuladosAverageAccuracy}% (referência de aprovação OAB: 50% mínimo, meta segura 65%+). Alterne revisões de erros com novos simulados.`,
      metricSummary: `Média de ${ctx.simuladosAverageAccuracy}% em ${ctx.simuladosTotal} ${
        ctx.simuladosTotal === 1 ? 'simulado' : 'simulados'
      }`,
      actionLabel: 'Fazer novo simulado',
    });
  }

  // Fallback constructive recommendation when student has strong performance across all metrics
  if (items.length === 0) {
    items.push({
      id: 'maintain-consistency',
      priority: 'informativa',
      category: 'cobertura',
      title: 'Manter consistência e ampliar repertório',
      description: `Seu desempenho geral está sólido (${ctx.overallAccuracy}% de acertos em ${ctx.totalAnswered} questões). Continue variando disciplinas e simulados para consolidar a memória de longo prazo.`,
      metricSummary: `${ctx.overallAccuracy}% de aproveitamento geral`,
      actionLabel: 'Continuar praticando',
    });
  }

  return {
    hasEnoughData: true,
    minRequiredAnswers: MIN_ANSWERS_FOR_RECOMMENDATIONS,
    currentAnswers: ctx.totalAnswered,
    message: null,
    items: items.slice(0, 5),
  };
}
