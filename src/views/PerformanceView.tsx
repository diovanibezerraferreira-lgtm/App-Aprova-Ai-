import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UserProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { getStoredAnswers, getStoredSimulados } from '../utils/storage';
import {
  fetchPerformanceReport,
  PerformanceReportResponse,
  PerformanceDisciplineItem,
  PerformanceSubjectItem,
  PerformanceRecommendationItem,
} from '../services/contentService';
import { PerformanceEvolutionChart } from '../components/PerformanceEvolutionChart';
import {
  BarChart3,
  Target,
  CheckCircle2,
  XCircle,
  Trophy,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  RefreshCw,
  BookOpen,
  Compass,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogIn,
  ShieldAlert,
  Sparkles,
  Scale,
  Filter,
  TrendingUp,
  TrendingDown,
  Layers,
  Award,
  Check,
} from 'lucide-react';

interface PerformanceViewProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onGoToQuestions: () => void;
  onGoToSimulados?: () => void;
  onPracticeDiscipline?: (disciplineId: string) => void;
  onRetryQuestions?: (questionIds: string[]) => void;
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

type DisciplineSortMode = 'worst' | 'best' | 'volume';
type SubjectTabMode = 'weakest' | 'strongest' | 'understudied';

function formatDatePtBr(iso: string): string {
  if (!iso) return 'Data não registrada';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Data não registrada';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  userProfile,
  onUpdateProfile,
  onGoToQuestions,
  onGoToSimulados,
  onPracticeDiscipline,
  onRetryQuestions,
  onOpenAuth,
  onOpenPremium,
}) => {
  const { currentUser, isPremiumActive } = useAuth();

  // Server report state
  const [report, setReport] = useState<PerformanceReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);

  // Interactive UI controls
  const [selectedPeriod, setSelectedPeriod] = useState<'7' | '30' | '90'>('30');
  const [disciplineSort, setDisciplineSort] = useState<DisciplineSortMode>('worst');
  const [showUnstudiedDisciplines, setShowUnstudiedDisciplines] = useState<boolean>(false);
  const [subjectTab, setSubjectTab] = useState<SubjectTabMode>('weakest');

  // Error history pagination & filter
  const [errorsPage, setErrorsPage] = useState<number>(1);
  const [errorDisciplineId, setErrorDisciplineId] = useState<string>('todas');
  const [expandedErrorIds, setExpandedErrorIds] = useState<Record<string, boolean>>({});

  // Simulados pagination
  const [simuladosPage, setSimuladosPage] = useState<number>(1);

  // Daily goal inline editing
  const [editingGoal, setEditingGoal] = useState<boolean>(false);
  const [goalInput, setGoalInput] = useState<number>(userProfile.dailyGoalQuestions || 20);

  useEffect(() => {
    setGoalInput(userProfile.dailyGoalQuestions || 20);
  }, [userProfile.dailyGoalQuestions]);

  const loadReport = useCallback(async () => {
    if (!currentUser) {
      setReport(null);
      setLoading(false);
      setErrorMessage(null);
      setIsUnavailable(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setIsUnavailable(false);

    try {
      const data = await fetchPerformanceReport({
        errorsPage,
        errorsLimit: 8,
        errorDisciplineId,
        simuladosPage,
        simuladosLimit: 6,
      });
      setReport(data);
    } catch (err: any) {
      const status = err?.status;
      if (status === 503) {
        setIsUnavailable(true);
      }
      setErrorMessage(
        err?.message ||
          'Não foi possível carregar seu relatório de desempenho no momento. Tente novamente em instantes.'
      );
    } finally {
      setLoading(false);
    }
  }, [currentUser, errorsPage, errorDisciplineId, simuladosPage]);

  useEffect(() => {
    loadReport();
  }, [loadReport, isPremiumActive]);

  // Local visitor fallback summary (read-only, only when unauthenticated)
  const localGuestSummary = useMemo(() => {
    if (currentUser) return null;
    const answers = getStoredAnswers();
    const simulados = getStoredSimulados();
    const total = answers.length;
    const correct = answers.filter((a) => a.isCorrect).length;
    const incorrect = total - correct;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    return {
      total,
      correct,
      incorrect,
      accuracy,
      simuladosCount: simulados.length,
    };
  }, [currentUser]);

  const sortedDisciplines = useMemo<PerformanceDisciplineItem[]>(() => {
    if (!report) return [];
    const list = [...report.disciplines];
    if (disciplineSort === 'best') {
      list.sort(
        (a, b) =>
          b.accuracyPercent - a.accuracyPercent ||
          b.answered - a.answered ||
          a.disciplineName.localeCompare(b.disciplineName, 'pt-BR')
      );
    } else if (disciplineSort === 'volume') {
      list.sort(
        (a, b) =>
          b.answered - a.answered ||
          b.accuracyPercent - a.accuracyPercent ||
          a.disciplineName.localeCompare(b.disciplineName, 'pt-BR')
      );
    } else {
      list.sort(
        (a, b) =>
          a.accuracyPercent - b.accuracyPercent ||
          b.answered - a.answered ||
          a.disciplineName.localeCompare(b.disciplineName, 'pt-BR')
      );
    }
    return list;
  }, [report, disciplineSort]);

  const attentionCount = useMemo(() => {
    if (!report) return 0;
    return report.disciplines.filter((d) => d.needsAttention).length;
  }, [report]);

  const handleSaveGoal = () => {
    const validGoal = Math.max(5, Math.min(200, Number(goalInput) || 20));
    onUpdateProfile({ ...userProfile, dailyGoalQuestions: validGoal });
    setGoalInput(validGoal);
    setEditingGoal(false);
  };

  const handleRecommendationAction = (rec: PerformanceRecommendationItem) => {
    if (rec.targetQuestionIds && rec.targetQuestionIds.length > 0 && onRetryQuestions) {
      onRetryQuestions(rec.targetQuestionIds);
      return;
    }
    if (rec.targetDisciplineId && onPracticeDiscipline) {
      onPracticeDiscipline(rec.targetDisciplineId);
      return;
    }
    if (rec.category === 'simulado' && onGoToSimulados) {
      onGoToSimulados();
      return;
    }
    onGoToQuestions();
  };

  const toggleErrorExplanation = (questionId: string) => {
    setExpandedErrorIds((prev) => ({
      ...prev,
      [questionId]: !prev[questionId],
    }));
  };

  const handleErrorDisciplineChange = (discId: string) => {
    setErrorDisciplineId(discId);
    setErrorsPage(1);
  };

  // Unauthenticated Visitor State
  if (!currentUser) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
                Relatório de Desempenho Inteligente
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Acompanhe sua evolução real por período, disciplina, assunto e histórico de erros.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[#9A7B16]">
              Histórico Individual Protegido
            </p>
            <h2 className="text-xl font-bold font-serif text-[#0B1F3A]">
              Entre na sua conta para acessar seu relatório completo
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Seu desempenho é calculado exclusivamente a partir das suas respostas e simulados sincronizados na nuvem, com análise por disciplina, assuntos críticos, revisão comentada de erros e recomendações de estudo personalizadas.
            </p>
          </div>

          {localGuestSummary && localGuestSummary.total > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Sessão local
                </p>
                <p className="text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                  {localGuestSummary.total}
                </p>
                <p className="text-[11px] text-slate-500">questões respondidas</p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Acertos
                </p>
                <p className="text-xl font-bold text-emerald-700 tabular-nums mt-1">
                  {localGuestSummary.correct}
                </p>
                <p className="text-[11px] text-slate-500">neste navegador</p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Erros
                </p>
                <p className="text-xl font-bold text-rose-700 tabular-nums mt-1">
                  {localGuestSummary.incorrect}
                </p>
                <p className="text-[11px] text-slate-500">para revisar</p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Aproveitamento
                </p>
                <p className="text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
                  {localGuestSummary.accuracy}%
                </p>
                <p className="text-[11px] text-slate-500">
                  {localGuestSummary.simuladosCount} simulados
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-5 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-sm font-semibold transition-colors inline-flex items-center gap-2"
              >
                <LogIn className="w-4 h-4 text-[#D4AF37]" />
                <span>Entrar na minha conta</span>
              </button>
            )}
            <button
              type="button"
              onClick={onGoToQuestions}
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-[#0B1F3A] border border-slate-300 text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              <span>Resolver questões</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading Skeleton (Initial Load)
  if (loading && !report) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-5">
          <div className="space-y-2">
            <div className="h-7 w-72 bg-slate-200 rounded-lg animate-pulse" />
            <div className="h-4 w-96 max-w-full bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3"
            >
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse" />
              <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 h-72 animate-pulse" />
      </div>
    );
  }

  // Error / Unavailable State (never invents zeros or fake data)
  if (errorMessage && !report) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
                Relatório de Desempenho Inteligente
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Diagnóstico baseado exclusivamente no seu histórico real de estudos.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-amber-200 p-6 sm:p-8 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1.5 min-w-0">
              <h2 className="text-base font-bold text-[#0B1F3A]">
                {isUnavailable
                  ? 'Serviço temporariamente indisponível'
                  : 'Não foi possível carregar o relatório'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">{errorMessage}</p>
              <p className="text-xs text-slate-500">
                Seus registros de respostas e simulados permanecem preservados com segurança.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={loadReport}
              className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs sm:text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar novamente</span>
            </button>
            <button
              type="button"
              onClick={onGoToQuestions}
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#0B1F3A] text-xs sm:text-sm font-semibold transition-colors"
            >
              Ir para Questões
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!report) return null;

  const { overview, evolution, subjects, errorHistory, simuladosHistory, recommendations } = report;
  const activeEvolution = evolution[selectedPeriod];
  const dailyGoal = Math.max(5, userProfile.dailyGoalQuestions || 20);
  const dailyGoalProgress = Math.min(100, Math.round((overview.todayAnswered / dailyGoal) * 100));
  const activeSubjectsList: PerformanceSubjectItem[] =
    subjectTab === 'strongest'
      ? subjects.strongest
      : subjectTab === 'weakest'
        ? subjects.weakest
        : subjects.understudied;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Page Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0 mt-0.5">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A] leading-tight">
              Relatório de Desempenho Inteligente
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Métricas reais de {userProfile.name} · Foco: {userProfile.studyFocus} ·{' '}
              <span className="tabular-nums">
                {overview.studiedDisciplinesCount} de {overview.totalDisciplinesCount} disciplinas praticadas
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadReport}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar dados</span>
          </button>

          {errorHistory.retryableQuestionIds.length > 0 && onRetryQuestions && (
            <button
              type="button"
              onClick={() => onRetryQuestions(errorHistory.retryableQuestionIds.slice(0, 10))}
              className="px-3.5 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#C39E2B] text-[#0B1F3A] text-xs font-bold transition-colors inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Refazer erros ({Math.min(10, errorHistory.retryableQuestionIds.length)})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onGoToQuestions}
            className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
          >
            <span>Praticar questões</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#D4AF37]" />
          </button>
        </div>
      </header>

      {/* Non-blocking error notice if refresh failed while showing cached report */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={loadReport}
            className="font-semibold underline shrink-0"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* 1. PAINEL GERAL (KPI Strip + Meta Diária) */}
      <section aria-label="Painel geral de desempenho" className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* Total Respondidas */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Respondidas
              </span>
              <BookOpen className="w-4 h-4 text-[#0B1F3A] shrink-0" />
            </div>
            <div className="mt-3">
              <p className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tabular-nums">
                {overview.totalAnswered.toLocaleString('pt-BR')}
              </p>
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {overview.todayAnswered} hoje
              </p>
            </div>
          </div>

          {/* Total Acertos */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Acertos
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            </div>
            <div className="mt-3">
              <p className="text-2xl sm:text-3xl font-bold text-emerald-700 tabular-nums">
                {overview.totalCorrect.toLocaleString('pt-BR')}
              </p>
              <p className="text-xs text-slate-500 mt-1">respostas corretas</p>
            </div>
          </div>

          {/* Total Erros */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Erros
              </span>
              <XCircle className="w-4 h-4 text-rose-700 shrink-0" />
            </div>
            <div className="mt-3">
              <p className="text-2xl sm:text-3xl font-bold text-rose-700 tabular-nums">
                {overview.totalIncorrect.toLocaleString('pt-BR')}
              </p>
              <p className="text-xs text-slate-500 mt-1">disponíveis para revisão</p>
            </div>
          </div>

          {/* Percentual Geral + Evolução vs Período Anterior */}
          <div className="bg-[#0B1F3A] text-white rounded-2xl border border-[#0B1F3A] p-4 sm:p-5 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Aproveitamento
              </span>
              <Target className="w-4 h-4 text-[#D4AF37] shrink-0" />
            </div>
            <div className="mt-3">
              <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
                {overview.hasAnswers ? `${overview.accuracyPercent}%` : '—'}
              </p>
              {overview.periodComparison.hasEnoughData &&
              overview.periodComparison.accuracyDelta !== null ? (
                <p
                  className={`text-xs font-semibold tabular-nums mt-1 inline-flex items-center gap-1 ${
                    overview.periodComparison.accuracyDelta >= 0
                      ? 'text-emerald-300'
                      : 'text-rose-300'
                  }`}
                >
                  {overview.periodComparison.accuracyDelta >= 0 ? (
                    <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>
                    {overview.periodComparison.accuracyDelta > 0
                      ? `+${overview.periodComparison.accuracyDelta}`
                      : overview.periodComparison.accuracyDelta}{' '}
                    p.p. vs. 30d anteriores
                  </span>
                </p>
              ) : (
                <p className="text-xs text-slate-300 mt-1">
                  {overview.hasAnswers ? 'Referência OAB: 50%+' : 'Sem respostas ainda'}
                </p>
              )}
            </div>
          </div>

          {/* Simulados Concluídos */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Simulados
              </span>
              <Trophy className="w-4 h-4 text-[#9A7B16] shrink-0" />
            </div>
            <div className="mt-3">
              <p className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] tabular-nums">
                {overview.simuladosCompleted.toLocaleString('pt-BR')}
              </p>
              <p className="text-xs text-slate-500 tabular-nums mt-1">
                {simuladosHistory.averageAccuracy !== null
                  ? `Média de ${simuladosHistory.averageAccuracy}%`
                  : 'Nenhum simulado concluído'}
              </p>
            </div>
          </div>
        </div>

        {/* Daily Study Goal Bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-[#0B1F3A]">
                Meta Diária de Questões
              </span>
              <span className="font-semibold text-slate-700 tabular-nums">
                {overview.todayAnswered} / {dailyGoal} hoje ({dailyGoalProgress}%)
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#D4AF37] transition-all duration-300"
                style={{ width: `${dailyGoalProgress}%` }}
              />
            </div>
          </div>

          <div className="shrink-0">
            {editingGoal ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={goalInput}
                  onChange={(e) => setGoalInput(Number(e.target.value))}
                  aria-label="Nova meta diária de questões"
                  className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-[#0B1F3A] tabular-nums"
                />
                <button
                  type="button"
                  onClick={handleSaveGoal}
                  className="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-white text-xs font-semibold hover:bg-[#132E54] transition-colors inline-flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Salvar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGoalInput(dailyGoal);
                    setEditingGoal(false);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditingGoal(true)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#0B1F3A] transition-colors"
              >
                Ajustar meta diária
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Empty Account State Banner (when zero answers AND zero simulados) */}
      {!overview.hasAnswers && overview.simuladosCompleted === 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0B1F3A]/5 text-[#0B1F3A] flex items-center justify-center mx-auto">
            <Compass className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h2 className="text-lg font-bold font-serif text-[#0B1F3A]">
              Seu histórico ainda está começando
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Responda questões ou conclua um simulado para gerar automaticamente sua curva de evolução, ranking por disciplina, mapa de assuntos e recomendações personalizadas.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <button
              type="button"
              onClick={onGoToQuestions}
              className="px-5 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              <span>Responder primeiras questões</span>
              <ArrowRight className="w-4 h-4 text-[#D4AF37]" />
            </button>
            {onGoToSimulados && (
              <button
                type="button"
                onClick={onGoToSimulados}
                className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#0B1F3A] text-sm font-semibold transition-colors"
              >
                Iniciar um simulado
              </button>
            )}
          </div>
        </section>
      )}

      {/* 2. EVOLUÇÃO DO DESEMPENHO + 6. RECOMENDAÇÕES INTELIGENTES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 min-w-0">
          <PerformanceEvolutionChart
            series={activeEvolution}
            selectedPeriod={selectedPeriod}
            onSelectPeriod={setSelectedPeriod}
          />
        </div>

        {/* Recomendações Inteligentes */}
        <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4 min-w-0">
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#9A7B16] shrink-0" />
                <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                  Recomendações de Estudo
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                Prioridades calculadas a partir dos seus índices reais de acertos e erros.
              </p>
            </div>
          </div>

          {!recommendations.hasEnoughData ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-5 space-y-3">
              <p className="text-sm font-bold text-[#0B1F3A]">
                Coletando base mínima de estudo
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {recommendations.message}
              </p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 tabular-nums">
                  <span>Progresso para diagnóstico</span>
                  <span>
                    {recommendations.currentAnswers} / {recommendations.minRequiredAnswers} questões
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#0B1F3A] transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (recommendations.currentAnswers / recommendations.minRequiredAnswers) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.items.map((rec) => (
                <article
                  key={rec.id}
                  className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/90 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#0B1F3A] leading-snug">
                      {rec.title}
                    </h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        rec.priority === 'alta'
                          ? 'text-rose-700'
                          : rec.priority === 'media'
                            ? 'text-[#9A7B16]'
                            : 'text-slate-500'
                      }`}
                    >
                      {rec.priority === 'alta'
                        ? 'Prioridade alta'
                        : rec.priority === 'media'
                          ? 'Recomendado'
                          : 'Consolidação'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{rec.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                      {rec.metricSummary}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRecommendationAction(rec)}
                      className="text-xs font-bold text-[#0B1F3A] hover:text-[#9A7B16] transition-colors inline-flex items-center gap-1"
                    >
                      <span>{rec.actionLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Free Plan subtle note without changing access rules */}
          {!report.isPremium && onOpenPremium && (
            <div className="p-3.5 rounded-xl bg-[#0B1F3A]/[0.03] border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2 text-xs text-slate-600 min-w-0">
                <Sparkles className="w-4 h-4 text-[#9A7B16] shrink-0 mt-0.5" />
                <span>
                  Com o <strong className="text-[#0B1F3A]">Plano Premium</strong>, você resolve questões ilimitadas e amplia seu diagnóstico em todas as 21 disciplinas.
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenPremium}
                className="px-3 py-1.5 rounded-lg bg-[#0B1F3A] text-white text-[11px] font-semibold hover:bg-[#132E54] shrink-0 self-start sm:self-auto"
              >
                Conhecer Premium
              </button>
            </div>
          )}
        </section>
      </div>

      {/* 3. DESEMPENHO POR DISCIPLINA */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Scale className="w-4 h-4 text-[#0B1F3A] shrink-0" />
              <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                Desempenho por Disciplina
              </h2>
              {attentionCount > 0 && (
                <span className="text-xs font-semibold text-rose-700 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {attentionCount} {attentionCount === 1 ? 'disciplina precisa' : 'disciplinas precisam'} de atenção
                  </span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Compare volume de estudo, acertos, erros e percentual real em cada ramo do Direito.
            </p>
          </div>

          {/* Sort Controls */}
          <div
            className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 border border-slate-200 self-start sm:self-auto"
            role="group"
            aria-label="Ordenar disciplinas"
          >
            {(
              [
                { id: 'worst', label: 'Pior desempenho' },
                { id: 'best', label: 'Melhor desempenho' },
                { id: 'volume', label: 'Mais respondidas' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDisciplineSort(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  disciplineSort === opt.id
                    ? 'bg-[#0B1F3A] text-white'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {sortedDisciplines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-2">
            <p className="text-sm font-bold text-[#0B1F3A]">Nenhuma disciplina respondida ainda</p>
            <p className="text-xs text-slate-600">
              Assim que você responder questões, seu desempenho será agrupado automaticamente por disciplina.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedDisciplines.map((disc) => (
              <div
                key={disc.disciplineId}
                className="py-4 first:pt-1 last:pb-1 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4"
              >
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                      <h3 className="text-sm font-bold text-[#0B1F3A]">{disc.disciplineName}</h3>
                      {disc.oabWeight > 0 && (
                        <span className="text-[11px] text-slate-500 tabular-nums">
                          Peso OAB: {disc.oabWeight} q.
                        </span>
                      )}
                      <span
                        className={`text-[11px] font-semibold inline-flex items-center gap-1 ${
                          disc.status === 'attention'
                            ? 'text-rose-700'
                            : disc.status === 'strong'
                              ? 'text-emerald-700'
                              : disc.status === 'evolving'
                                ? 'text-[#9A7B16]'
                                : 'text-slate-500'
                        }`}
                      >
                        {disc.status === 'attention' && <AlertTriangle className="w-3.5 h-3.5" />}
                        {disc.status === 'strong' && <CheckCircle2 className="w-3.5 h-3.5" />}
                        <span>{disc.statusLabel}</span>
                      </span>
                    </div>

                    <span className="text-base font-bold text-[#0B1F3A] tabular-nums">
                      {disc.accuracyPercent}%
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        disc.status === 'attention'
                          ? 'bg-rose-600'
                          : disc.status === 'strong'
                            ? 'bg-emerald-600'
                            : disc.status === 'evolving'
                              ? 'bg-[#D4AF37]'
                              : 'bg-slate-400'
                      }`}
                      style={{ width: `${disc.accuracyPercent}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        Respondidas: <strong className="text-[#0B1F3A]">{disc.answered}</strong>
                      </span>
                      <span className="text-emerald-700">
                        Acertos: <strong>{disc.correct}</strong>
                      </span>
                      <span className="text-rose-700">
                        Erros: <strong>{disc.incorrect}</strong>
                      </span>
                    </div>
                    {disc.attentionReason && (
                      <p className="text-[11px] text-rose-700">{disc.attentionReason}</p>
                    )}
                  </div>
                </div>

                {onPracticeDiscipline && (
                  <button
                    type="button"
                    onClick={() => onPracticeDiscipline(disc.disciplineId)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-[#0B1F3A] hover:bg-slate-50 text-xs font-semibold text-[#0B1F3A] transition-colors shrink-0 self-start md:self-center inline-flex items-center gap-1.5"
                  >
                    <span>Praticar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Unstudied Disciplines Accordion */}
        {report.unstudiedDisciplines.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowUnstudiedDisciplines((v) => !v)}
              className="flex items-center justify-between w-full text-left py-2 text-xs font-semibold text-slate-600 hover:text-[#0B1F3A] transition-colors"
            >
              <span>
                Disciplinas ainda sem respostas ({report.unstudiedDisciplines.length})
              </span>
              {showUnstudiedDisciplines ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {showUnstudiedDisciplines && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
                {report.unstudiedDisciplines.map((item) => (
                  <div
                    key={item.disciplineId}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#0B1F3A] truncate">
                        {item.disciplineName}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Peso OAB: {item.oabWeight} · {item.catalogCount} questões no banco
                      </p>
                    </div>
                    {onPracticeDiscipline && (
                      <button
                        type="button"
                        onClick={() => onPracticeDiscipline(item.disciplineId)}
                        className="text-xs font-semibold text-[#0B1F3A] hover:text-[#9A7B16] shrink-0"
                      >
                        Iniciar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4. DESEMPENHO POR ASSUNTO */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#0B1F3A] shrink-0" />
              <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                Desempenho por Assunto
              </h2>
            </div>
            <p className="text-xs text-slate-500">
              Classificação real por tema jurídico das questões respondidas (mínimo de{' '}
              {subjects.minAnswersPerSubject} questões por assunto para ranqueamento de força ou fraqueza).
            </p>
          </div>

          <div
            className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1 border border-slate-200 self-start sm:self-auto"
            role="tablist"
            aria-label="Filtro de assuntos"
          >
            {(
              [
                { id: 'weakest', label: `Maior erro (${subjects.weakest.length})` },
                { id: 'strongest', label: `Maior acerto (${subjects.strongest.length})` },
                { id: 'understudied', label: `Pouco estudados (${subjects.understudied.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={subjectTab === tab.id}
                onClick={() => setSubjectTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  subjectTab === tab.id
                    ? 'bg-[#0B1F3A] text-white'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeSubjectsList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-1.5">
            <p className="text-sm font-bold text-[#0B1F3A]">
              {subjectTab === 'weakest'
                ? 'Nenhum assunto crítico identificado'
                : subjectTab === 'strongest'
                  ? 'Nenhum assunto consolidado ainda'
                  : 'Nenhum assunto listado nesta categoria'}
            </p>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              {subjectTab === 'understudied'
                ? 'Responda questões para mapearmos os assuntos prioritários ainda pouco explorados.'
                : `Para evitar conclusões precipitadas, exibimos assuntos neste ranking a partir de ${subjects.minAnswersPerSubject} questões respondidas no mesmo tema.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {activeSubjectsList.map((subj) => (
              <div
                key={`${subj.disciplineId}-${subj.subject}`}
                className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/90 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {subj.disciplineName}
                      </p>
                      <h3 className="text-sm font-bold text-[#0B1F3A] leading-snug mt-0.5">
                        {subj.subject}
                      </h3>
                    </div>
                    <span
                      className={`text-base font-bold tabular-nums shrink-0 ${
                        subjectTab === 'understudied'
                          ? 'text-slate-600'
                          : subj.accuracyPercent >= 70
                            ? 'text-emerald-700'
                            : 'text-rose-700'
                      }`}
                    >
                      {subj.answered > 0 ? `${subj.accuracyPercent}%` : '0 q.'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  {subj.answered > 0 && (
                    <div className="w-full h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          subj.accuracyPercent >= 70
                            ? 'bg-emerald-600'
                            : subj.accuracyPercent >= 50
                              ? 'bg-[#D4AF37]'
                              : 'bg-rose-600'
                        }`}
                        style={{ width: `${subj.accuracyPercent}%` }}
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-600 tabular-nums">
                    {subj.answered > 0 ? (
                      <span>
                        {subj.answered} respondidas · {subj.correct} acertos · {subj.incorrect} erros
                      </span>
                    ) : (
                      <span>
                        Ainda não respondido · {subj.catalogCount} questões disponíveis
                      </span>
                    )}

                    {onPracticeDiscipline && (
                      <button
                        type="button"
                        onClick={() => onPracticeDiscipline(subj.disciplineId)}
                        className="font-semibold text-[#0B1F3A] hover:text-[#9A7B16] transition-colors shrink-0"
                      >
                        Praticar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. HISTÓRICO DE ERROS (PAGINADO + REFAZER QUESTÕES) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-700 shrink-0" />
              <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                Histórico de Erros e Revisão
              </h2>
            </div>
            <p className="text-xs text-slate-500 tabular-nums">
              {errorHistory.totalErrors === 0
                ? 'Nenhuma questão errada registrada até o momento.'
                : `${errorHistory.totalErrors} ${
                    errorHistory.totalErrors === 1 ? 'erro registrado' : 'erros registrados'
                  } no seu histórico real. Revise a fundamentação e refaça para consolidar.`}
            </p>
          </div>

          {errorHistory.totalErrors > 0 && (
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Filter by discipline */}
              <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
                <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <select
                  aria-label="Filtrar erros por disciplina"
                  value={errorDisciplineId}
                  onChange={(e) => handleErrorDisciplineChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-[#0B1F3A] focus:outline-none max-w-[200px]"
                >
                  <option value="todas">
                    Todas as disciplinas ({errorHistory.totalErrors})
                  </option>
                  {errorHistory.availableDisciplines.map((opt) => (
                    <option key={opt.disciplineId} value={opt.disciplineId}>
                      {opt.disciplineName} ({opt.count})
                    </option>
                  ))}
                </select>
              </div>

              {errorHistory.retryableQuestionIds.length > 0 && onRetryQuestions && (
                <button
                  type="button"
                  onClick={() => onRetryQuestions(errorHistory.retryableQuestionIds.slice(0, 10))}
                  className="px-3.5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>
                    Refazer questões erradas ({Math.min(10, errorHistory.retryableQuestionIds.length)})
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {errorHistory.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-1.5">
            <p className="text-sm font-bold text-[#0B1F3A]">
              {overview.hasAnswers
                ? 'Sem erros pendentes nesta visualização'
                : 'Nenhum erro registrado ainda'}
            </p>
            <p className="text-xs text-slate-600">
              {overview.hasAnswers
                ? 'Excelente trabalho! Quando você errar alguma questão, ela aparecerá aqui com comentário e opção de refazer.'
                : 'Responda questões para acompanhar seu caderno automático de erros.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {errorHistory.items.map((item) => {
              const isExpanded = Boolean(expandedErrorIds[item.questionId]);
              return (
                <article
                  key={`${item.questionId}-${item.answeredAt}`}
                  className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 sm:p-5 space-y-3.5"
                >
                  {/* Metadata header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600">
                      <span className="font-bold text-[#0B1F3A]">{item.disciplineName}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-medium text-slate-700">{item.subject}</span>
                      {item.examReference && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="text-slate-500">{item.examReference}</span>
                        </>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      Respondida em {formatDatePtBr(item.answeredAtIso)}
                    </span>
                  </div>

                  {/* Statement */}
                  <p className="text-sm text-slate-800 leading-relaxed">{item.statement}</p>

                  {/* Selected vs Correct comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200/80 space-y-1">
                      <p className="font-bold text-rose-800 inline-flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Sua alternativa: {item.selectedOptionId}</span>
                      </p>
                      <p className="text-rose-900/90 leading-relaxed">{item.selectedOptionText}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200/80 space-y-1">
                      <p className="font-bold text-emerald-800 inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Resposta correta:{' '}
                          {item.correctOptionId ? item.correctOptionId : 'Indisponível'}
                        </span>
                      </p>
                      <p className="text-emerald-900/90 leading-relaxed">
                        {item.correctOptionText}
                      </p>
                    </div>
                  </div>

                  {/* Explanation Expandable + Retry Button */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    {item.explanation || item.legalFoundation ? (
                      <button
                        type="button"
                        onClick={() => toggleErrorExplanation(item.questionId)}
                        className="text-xs font-semibold text-[#0B1F3A] hover:text-[#9A7B16] transition-colors inline-flex items-center gap-1"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-4 h-4" />
                            <span>Ocultar comentário</span>
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-4 h-4" />
                            <span>Ver comentário e fundamentação</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        Comentário indisponível para este registro
                      </span>
                    )}

                    {onRetryQuestions && item.correctOptionId && (
                      <button
                        type="button"
                        onClick={() => onRetryQuestions([item.questionId])}
                        className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-xs font-semibold text-[#0B1F3A] transition-colors inline-flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[#9A7B16]" />
                        <span>Refazer esta questão</span>
                      </button>
                    )}
                  </div>

                  {isExpanded && (item.explanation || item.legalFoundation) && (
                    <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-2 text-xs leading-relaxed">
                      {item.explanation && (
                        <div>
                          <p className="font-bold text-[#0B1F3A] mb-0.5">Comentário jurídico</p>
                          <p className="text-slate-700">{item.explanation}</p>
                        </div>
                      )}
                      {item.legalFoundation && (
                        <div className="pt-1 border-t border-slate-100">
                          <p className="font-bold text-[#9A7B16] mb-0.5">Fundamentação legal</p>
                          <p className="text-slate-700">{item.legalFoundation}</p>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}

            {/* Error History Pagination */}
            {errorHistory.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500 tabular-nums">
                  Página {errorHistory.page} de {errorHistory.totalPages} ·{' '}
                  {errorHistory.filteredTotal} erros
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={errorHistory.page <= 1 || loading}
                    onClick={() => setErrorsPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                  <button
                    type="button"
                    disabled={errorHistory.page >= errorHistory.totalPages || loading}
                    onClick={() => setErrorsPage((p) => Math.min(errorHistory.totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <span>Próxima</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 7. HISTÓRICO DE SIMULADOS CONCLUÍDOS */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#9A7B16] shrink-0" />
              <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                Histórico de Simulados Concluídos
              </h2>
            </div>
            <p className="text-xs text-slate-500 tabular-nums">
              {simuladosHistory.total === 0
                ? 'Nenhum simulado concluído registrado até o momento.'
                : `${simuladosHistory.total} ${
                    simuladosHistory.total === 1 ? 'simulado concluído' : 'simulados concluídos'
                  } · Média geral de ${simuladosHistory.averageAccuracy ?? 0}%`}
            </p>
          </div>

          {onGoToSimulados && (
            <button
              type="button"
              onClick={onGoToSimulados}
              className="px-3.5 py-2 rounded-xl border border-slate-200 hover:border-[#0B1F3A] text-xs font-semibold text-[#0B1F3A] transition-colors self-start sm:self-auto inline-flex items-center gap-1.5"
            >
              <span>Novo simulado</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {simuladosHistory.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-1.5">
            <p className="text-sm font-bold text-[#0B1F3A]">Sem simulados registrados</p>
            <p className="text-xs text-slate-600">
              Conclua um simulado cronometrado para registrar seu tempo de prova e aproveitamento aqui.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 pr-4">Simulado</th>
                    <th className="py-2.5 px-3">Área</th>
                    <th className="py-2.5 px-3">Data</th>
                    <th className="py-2.5 px-3 text-right">Acertos</th>
                    <th className="py-2.5 px-3 text-right">Tempo</th>
                    <th className="py-2.5 pl-3 text-right">Aproveitamento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {simuladosHistory.items.map((sim) => (
                    <tr key={sim.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 pr-4 font-bold text-[#0B1F3A]">{sim.configTitle}</td>
                      <td className="py-3 px-3 text-slate-600">{sim.disciplineName}</td>
                      <td className="py-3 px-3 text-slate-500 tabular-nums">
                        {formatDatePtBr(sim.dateIso)}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-700 tabular-nums">
                        {sim.correctAnswers}/{sim.totalQuestions}
                      </td>
                      <td className="py-3 px-3 text-right text-slate-500 tabular-nums">
                        {formatDuration(sim.timeSpentSeconds)}
                      </td>
                      <td className="py-3 pl-3 text-right font-bold tabular-nums">
                        <span
                          className={
                            sim.accuracyPercent >= 60
                              ? 'text-emerald-700'
                              : sim.accuracyPercent >= 50
                                ? 'text-[#9A7B16]'
                                : 'text-rose-700'
                          }
                        >
                          {sim.accuracyPercent}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards */}
            <div className="md:hidden space-y-3">
              {simuladosHistory.items.map((sim) => (
                <div
                  key={sim.id}
                  className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0B1F3A]">{sim.configTitle}</p>
                      <p className="text-[11px] text-slate-500">{sim.disciplineName}</p>
                    </div>
                    <span
                      className={`text-base font-bold tabular-nums shrink-0 ${
                        sim.accuracyPercent >= 60
                          ? 'text-emerald-700'
                          : sim.accuracyPercent >= 50
                            ? 'text-[#9A7B16]'
                            : 'text-rose-700'
                      }`}
                    >
                      {sim.accuracyPercent}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 tabular-nums pt-1 border-t border-slate-200/70">
                    <span>
                      {sim.correctAnswers}/{sim.totalQuestions} acertos
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDuration(sim.timeSpentSeconds)}
                    </span>
                    <span className="text-slate-500">{formatDatePtBr(sim.dateIso)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Simulados Pagination */}
            {simuladosHistory.totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                <span className="text-slate-500 tabular-nums">
                  Página {simuladosHistory.page} de {simuladosHistory.totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={simuladosHistory.page <= 1 || loading}
                    onClick={() => setSimuladosPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                  <button
                    type="button"
                    disabled={simuladosHistory.page >= simuladosHistory.totalPages || loading}
                    onClick={() =>
                      setSimuladosPage((p) => Math.min(simuladosHistory.totalPages, p + 1))
                    }
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <span>Próxima</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
