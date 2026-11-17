import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { DisciplineId, Question, QuestionItem, SimuladoConfig, SimuladoResult } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import { SIMULADO_PRESETS, ExtendedSimuladoConfig } from '../data/simulados';
import { saveSimuladoResult } from '../utils/storage';
import { useAuth } from '../context/AuthContext';
import {
  fetchSimuladosCatalog,
  startSimuladoSession,
  finishSimuladoSession,
  ApiAccessError,
  DailyQuotaInfo
} from '../services/contentService';
import {
  Clock,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Award,
  ChevronRight,
  ChevronLeft,
  Pause,
  Flag,
  BarChart3,
  ListFilter,
  BookOpen,
  Lock,
  Crown,
  Sparkles,
  LogIn
} from 'lucide-react';

interface SimuladosViewProps {
  onRefreshPerformance?: () => void;
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

export const SimuladosView: React.FC<SimuladosViewProps> = ({
  onRefreshPerformance,
  onOpenAuth,
  onOpenPremium
}) => {
  const { currentUser, isPremiumActive } = useAuth();

  // Screens: 'setup' | 'active' | 'result'
  const [screen, setScreen] = useState<'setup' | 'active' | 'result'>('setup');

  // Server catalog & quota state
  const [presets, setPresets] = useState<
    (ExtendedSimuladoConfig & { isFree?: boolean; isLocked?: boolean })[]
  >(SIMULADO_PRESETS.map(p => ({ ...p, isFree: p.id === 'simulado-express-10', isLocked: p.id !== 'simulado-express-10' })));
  const [serverIsPremium, setServerIsPremium] = useState<boolean>(false);
  const [quota, setQuota] = useState<DailyQuotaInfo | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [starting, setStarting] = useState<boolean>(false);
  const [finishing, setFinishing] = useState<boolean>(false);
  const [accessBannerMsg, setAccessBannerMsg] = useState<string | null>(null);

  // Setup options
  const [presetCategoryFilter, setPresetCategoryFilter] = useState<'all' | 'oab-oficial' | 'concursos' | 'blocos' | 'rapidos' | 'disciplina'>('all');
  const [selectedDiscipline, setSelectedDiscipline] = useState<string>('todas');
  const [customDifficulty, setCustomDifficulty] = useState<'todas' | 'Fácil' | 'Médio' | 'Difícil'>('todas');
  const [customQuestionCount, setCustomQuestionCount] = useState<number>(20);
  const [customTimeMinutes, setCustomTimeMinutes] = useState<number>(45);

  // Active Simulado State
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [simuladoTitle, setSimuladoTitle] = useState<string>('');
  const [simuladoDisciplineId, setSimuladoDisciplineId] = useState<string>('todas');
  const [simuladoTotalTimeSeconds, setSimuladoTotalTimeSeconds] = useState<number>(900);
  const [activeQuestions, setActiveQuestions] = useState<QuestionItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, 'A' | 'B' | 'C' | 'D'>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<Record<number, boolean>>({});
  const [secondsRemaining, setSecondsRemaining] = useState<number>(900);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);
  const [navFilter, setNavFilter] = useState<'all' | 'unanswered' | 'flagged'>('all');
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const finishingRef = useRef<boolean>(false);

  // Result State
  const [gradedQuestions, setGradedQuestions] = useState<Question[]>([]);
  const [latestResult, setLatestResult] = useState<SimuladoResult | null>(null);
  const [resultFilter, setResultFilter] = useState<'wrong' | 'all' | 'flagged'>('wrong');

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await fetchSimuladosCatalog();
      setPresets(res.presets);
      setServerIsPremium(res.isPremium);
      setQuota(res.quota);
    } catch (err: any) {
      console.warn('Could not load simulados catalog:', err);
      setCatalogError(err?.message || 'Não foi possível sincronizar o catálogo de simulados com o servidor.');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog, currentUser?.uid, isPremiumActive]);

  const handleConfirmFinish = useCallback(async () => {
    if (finishingRef.current || !activeSessionId) return;
    finishingRef.current = true;
    setFinishing(true);
    setShowSubmitModal(false);
    if (timerRef.current) clearTimeout(timerRef.current);

    try {
      const graded = await finishSimuladoSession({
        sessionId: activeSessionId,
        userAnswers,
      });

      const result: SimuladoResult = {
        id: 'sim-' + Date.now(),
        configTitle: simuladoTitle || `Simulado (${graded.totalQuestions} Questões)`,
        disciplineId: simuladoDisciplineId as DisciplineId | 'todas',
        totalQuestions: graded.totalQuestions,
        correctAnswers: graded.correctAnswers,
        timeSpentSeconds: simuladoTotalTimeSeconds - Math.max(0, secondsRemaining),
        date: new Date().toLocaleDateString('pt-BR'),
        answers: graded.answers,
      };

      saveSimuladoResult(result);
      setGradedQuestions(graded.gradedQuestions);
      setLatestResult(result);
      setScreen('result');
      loadCatalog();
      if (onRefreshPerformance) onRefreshPerformance();
    } catch (err: any) {
      setAccessBannerMsg(err?.message || 'Erro ao finalizar e corrigir o simulado no servidor.');
    } finally {
      finishingRef.current = false;
      setFinishing(false);
    }
  }, [
    activeSessionId,
    userAnswers,
    simuladoTitle,
    simuladoDisciplineId,
    simuladoTotalTimeSeconds,
    secondsRemaining,
    loadCatalog,
    onRefreshPerformance
  ]);

  // Timer Effect
  useEffect(() => {
    if (screen === 'active' && !isTimerPaused && secondsRemaining > 0) {
      timerRef.current = setTimeout(() => {
        setSecondsRemaining(prev => prev - 1);
      }, 1000);
    } else if (screen === 'active' && secondsRemaining <= 0 && activeSessionId) {
      handleConfirmFinish();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [screen, isTimerPaused, secondsRemaining, activeSessionId, handleConfirmFinish]);

  const handleStartSimulado = async (preset?: SimuladoConfig & { isLocked?: boolean }) => {
    if (starting) return;

    if (!serverIsPremium && (!preset || preset.isLocked || preset.id !== 'simulado-express-10')) {
      setAccessBannerMsg(
        'Esta modalidade completa é exclusiva do Plano Premium (R$ 29,90/mês). No plano gratuito você pode fazer 1 Simulado Express (10 questões) por dia.'
      );
      if (onOpenPremium) onOpenPremium();
      return;
    }

    setStarting(true);
    setAccessBannerMsg(null);
    finishingRef.current = false;

    try {
      const started = await startSimuladoSession(
        preset
          ? { presetId: preset.id }
          : {
              customConfig: {
                disciplineId: selectedDiscipline,
                difficulty: customDifficulty,
                questionCount: customQuestionCount,
                timeLimitMinutes: customTimeMinutes,
              },
            }
      );

      setActiveSessionId(started.sessionId);
      setSimuladoTitle(started.title);
      setSimuladoDisciplineId(started.disciplineId || 'todas');
      setSimuladoTotalTimeSeconds(started.timeLimitMinutes * 60);
      setSecondsRemaining(started.timeLimitMinutes * 60);
      setActiveQuestions(started.questions);
      setGradedQuestions([]);
      setQuota(started.quota);
      setUserAnswers({});
      setFlaggedQuestions({});
      setCurrentIndex(0);
      setIsTimerPaused(false);
      setShowSubmitModal(false);
      setScreen('active');
    } catch (err: any) {
      if (err instanceof ApiAccessError) {
        setAccessBannerMsg(err.message);
        if (err.code === 'DAILY_LIMIT_REACHED') {
          setQuota(prev =>
            prev
              ? { ...prev, simuladosUsed: prev.simuladosLimit, simuladosRemaining: 0 }
              : null
          );
        }
      } else {
        setAccessBannerMsg(err?.message || 'Não foi possível iniciar o simulado no momento.');
      }
    } finally {
      setStarting(false);
    }
  };

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D') => {
    setUserAnswers(prev => ({
      ...prev,
      [currentIndex]: optId
    }));
  };

  const handleToggleFlag = (index: number) => {
    setFlaggedQuestions(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const formatTimer = (totalSecs: number) => {
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
      return `${hours}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const reviewQuestions = gradedQuestions.length > 0 ? gradedQuestions : [];

  const disciplineBreakdown = useMemo(() => {
    if (!latestResult || reviewQuestions.length === 0) return [];

    const statsMap: Record<string, { total: number; correct: number; name: string }> = {};

    reviewQuestions.forEach((q, idx) => {
      const dId = q.disciplineId;
      if (!statsMap[dId]) {
        const disc = OAB_DISCIPLINES.find(d => d.id === dId);
        statsMap[dId] = {
          total: 0,
          correct: 0,
          name: disc?.shortName || disc?.name || dId
        };
      }
      statsMap[dId].total += 1;
      if (latestResult.answers[idx]?.isCorrect) {
        statsMap[dId].correct += 1;
      }
    });

    return Object.entries(statsMap).map(([id, val]) => ({
      id,
      name: val.name,
      total: val.total,
      correct: val.correct,
      pct: Math.round((val.correct / val.total) * 100)
    }));
  }, [latestResult, reviewQuestions]);

  const expressPreset = presets.find(p => p.id === 'simulado-express-10');
  const officialOabPreset = presets.find(p => p.id === 'simulado-oab-41') || presets[0];
  const simLimit = quota?.simuladosLimit ?? 1;
  const simUsed = quota?.simuladosUsed ?? 0;
  const simRemaining = quota?.simuladosRemaining ?? 1;

  // -------------------------------------------------------------
  // RENDER: SETUP SCREEN
  // -------------------------------------------------------------
  if (screen === 'setup') {
    return (
      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fade-in">
        {/* Title Header */}
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shadow-md shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold font-serif text-[#0B1F3A] break-words">
                Simulador Oficial OAB & Desafios Temáticos
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5 break-words">
                Treine com cronômetro real, marcação de questões para revisão e distribuição oficial das 20 disciplinas da prova.
              </p>
            </div>
          </div>
        </div>

        {catalogError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words">{catalogError}</span>
            <button
              onClick={loadCatalog}
              className="px-3 py-1 rounded-lg bg-white border border-rose-300 font-semibold flex items-center gap-1 shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Tentar Novamente</span>
            </button>
          </div>
        )}

        {/* Freemium Free Express Card + Daily Quota Strip */}
        {!loadingCatalog && !serverIsPremium && (
          <div className="rounded-3xl bg-white border-2 border-[#D4AF37]/60 shadow-md p-4 sm:p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold">
                    Plano Gratuito · 1 Simulado Express/dia
                  </span>
                  <span className="text-xs font-bold text-[#0B1F3A]">
                    Cota de hoje: {simUsed} de {simLimit} usado
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-bold font-serif text-[#0B1F3A] break-words">
                  Simulado Express Gratuito (10 Questões · 15 min)
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed break-words">
                  Experimente a correção oficial com gabarito comentado ao final. Para acessar as 80 questões oficiais OAB, concursos e simulados ilimitados, assine o Plano Premium.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 shrink-0">
                <button
                  onClick={() => expressPreset && handleStartSimulado(expressPreset)}
                  disabled={starting || simRemaining <= 0}
                  className={`w-full sm:w-auto px-4 sm:px-5 py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow transition-all text-center ${
                    simRemaining > 0 && !starting
                      ? 'bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37]'
                      : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span>
                    {starting
                      ? 'Iniciando...'
                      : simRemaining > 0
                      ? 'Iniciar Simulado Express Gratuito'
                      : 'Cota diária já utilizada hoje'}
                  </span>
                </button>

                {onOpenPremium && (
                  <button
                    onClick={onOpenPremium}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] text-xs font-extrabold shadow flex items-center justify-center gap-1.5 text-center"
                  >
                    <Crown className="w-3.5 h-3.5 shrink-0" />
                    <span>Liberar Todos · R$ 29,90</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Access / Limit Banner */}
        {accessBannerMsg && (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-[#D4AF37] text-[#0B1F3A] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#0B1F3A] text-[#D4AF37] flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-xs sm:text-sm font-bold text-[#0B1F3A]">{accessBannerMsg}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!currentUser && onOpenAuth && (
                <button
                  onClick={onOpenAuth}
                  className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 flex items-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>Já sou assinante</span>
                </button>
              )}
              {onOpenPremium && (
                <button
                  onClick={onOpenPremium}
                  className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] text-xs font-extrabold shadow flex items-center gap-1.5"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Assinar Premium (R$ 29,90/mês)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Featured Big Card: Official 80-Question Exam */}
        <div className="bg-gradient-to-br from-[#0B1F3A] via-[#122b4d] to-[#0B1F3A] rounded-3xl p-5 sm:p-8 text-white shadow-xl border border-[#D4AF37]/30 relative overflow-hidden">
          <div className="absolute -right-8 -bottom-8 w-48 h-48 bg-[#D4AF37]/10 rounded-full blur-2xl" />
          <div className="max-w-3xl space-y-4 relative z-10 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 text-[#D4AF37] text-xs font-bold uppercase tracking-wider max-w-full">
                <Award className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Simulação Real Oficial</span>
              </div>
              {!serverIsPremium && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 border border-white/20 text-[#D4AF37] text-xs font-bold">
                  <Lock className="w-3 h-3" />
                  Exclusivo Premium
                </span>
              )}
            </div>

            <h2 className="text-xl sm:text-3xl font-bold font-serif text-white break-words">
              Simulado Oficial 1ª Fase OAB (80 Questões)
            </h2>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
              Reprodução idêntica do exame da FGV: 80 questões balanceadas exatamente com o peso oficial de cada disciplina (8 de Ética, 6 de Constitucional, Civil, Proc. Civil, Penal e Proc. Penal, 5 de Trabalho, Proc. do Trabalho, Administrativo e Tributário, 4 de Empresarial e 2 de cada matéria transversal).
            </p>

            <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 text-xs font-semibold text-slate-300 pt-2">
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                <Clock className="w-4 h-4 text-[#D4AF37] shrink-0" />
                <span>300 minutos (5 horas de prova)</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                <BarChart3 className="w-4 h-4 text-[#D4AF37] shrink-0" />
                <span>Meta de Aprovação: 40 acertos (50%)</span>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                <Flag className="w-4 h-4 text-[#D4AF37] shrink-0" />
                <span>Marcar para revisar habilitado</span>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={() => officialOabPreset && handleStartSimulado(officialOabPreset)}
                disabled={starting}
                className="w-full sm:w-auto px-5 sm:px-6 py-3 bg-[#D4AF37] hover:bg-[#c59f2a] text-[#0B1F3A] font-extrabold text-sm rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
              >
                {!serverIsPremium ? (
                  <Lock className="w-4 h-4 shrink-0" />
                ) : (
                  <Play className="w-4 h-4 fill-current shrink-0" />
                )}
                <span>
                  {!serverIsPremium
                    ? 'Desbloquear Simulado Oficial (80 Questões)'
                    : starting
                    ? 'Preparando Prova...'
                    : 'Iniciar Simulado Oficial (80 Questões)'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Presets Category Filter Tabs & Grid */}
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#0B1F3A]" />
              <span>Modalidades, Concursos & Desafios</span>
            </h2>
            <span className="text-xs text-slate-500 font-semibold">{presets.length} simulados prontos</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <button
              onClick={() => setPresetCategoryFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'all'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Todos ({presets.length})
            </button>
            <button
              onClick={() => setPresetCategoryFilter('oab-oficial')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'oab-oficial'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Provas Oficiais OAB (80Q)
            </button>
            <button
              onClick={() => setPresetCategoryFilter('concursos')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'concursos'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Carreiras Jurídicas
            </button>
            <button
              onClick={() => setPresetCategoryFilter('blocos')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'blocos'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Blocos & Especiais
            </button>
            <button
              onClick={() => setPresetCategoryFilter('rapidos')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'rapidos'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Sprints & Rápidos
            </button>
            <button
              onClick={() => setPresetCategoryFilter('disciplina')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                presetCategoryFilter === 'disciplina'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Por Disciplina (21)
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {presets
              .filter(p => presetCategoryFilter === 'all' || p.category === presetCategoryFilter)
              .map(preset => {
                const isLocked = Boolean(!serverIsPremium && preset.isLocked);
                const isExpressFree = Boolean(preset.id === 'simulado-express-10');
                return (
                  <div
                    key={preset.id}
                    className={`bg-white p-4 sm:p-5 rounded-2xl border shadow-sm hover:shadow-md transition-all flex flex-col justify-between min-w-0 ${
                      isExpressFree && !serverIsPremium
                        ? 'border-emerald-300 ring-1 ring-emerald-200'
                        : 'border-slate-200 hover:border-[#D4AF37]'
                    }`}
                  >
                    <div className="space-y-2.5 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                        <span className="text-[11px] bg-[#0B1F3A]/5 text-[#0B1F3A] px-2.5 py-0.5 rounded-full font-bold truncate max-w-full">
                          {preset.level}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
                          {isExpressFree && !serverIsPremium && (
                            <span className="bg-emerald-100 border border-emerald-200 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              Gratuito (1/dia)
                            </span>
                          )}
                          {isLocked && (
                            <span className="bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-extrabold px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" />
                              Premium
                            </span>
                          )}
                          {!isLocked && preset.badge && (
                            <span className="bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#0B1F3A] text-[10px] font-extrabold px-2 py-0.5 rounded-md">
                              {preset.badge}
                            </span>
                          )}
                          <span className="text-xs text-slate-500 flex items-center gap-1 font-semibold">
                            <Clock className="w-3.5 h-3.5 text-[#D4AF37]" />
                            {preset.timeLimitMinutes} min
                          </span>
                        </div>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 leading-snug break-words">
                        {preset.title}
                      </h3>

                      <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed break-words">
                        {preset.description}
                      </p>
                    </div>

                    <div className="pt-4 mt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-700">
                        {preset.questionCount} Questões
                      </span>
                      <button
                        onClick={() => handleStartSimulado(preset)}
                        disabled={starting || (isExpressFree && !serverIsPremium && simRemaining <= 0)}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-1.5 ${
                          isLocked
                            ? 'bg-slate-100 hover:bg-[#0B1F3A] text-slate-700 hover:text-[#D4AF37] border border-slate-200'
                            : isExpressFree && !serverIsPremium && simRemaining <= 0
                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            : 'bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37]'
                        }`}
                      >
                        {isLocked ? (
                          <>
                            <Lock className="w-3 h-3" />
                            <span>Premium</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>
                              {isExpressFree && !serverIsPremium && simRemaining <= 0
                                ? 'Usado hoje'
                                : 'Iniciar'}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Custom Simulado Builder */}
        <div className="bg-white p-4 sm:p-8 rounded-3xl border border-slate-200 space-y-6 shadow-sm min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-[#D4AF37] shrink-0" />
              <h2 className="text-base font-bold text-[#0B1F3A]">
                Personalizar Simulado à Sua Medida
              </h2>
            </div>
            {!serverIsPremium && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
                <Lock className="w-3 h-3" />
                Exclusivo Plano Premium
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 min-w-0">
            <div className="min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Disciplina
              </label>
              <select
                value={selectedDiscipline}
                onChange={e => setSelectedDiscipline(e.target.value)}
                className="w-full min-w-0 max-w-full overflow-hidden text-ellipsis px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              >
                <option value="todas">Todas as Disciplinas (Geral OAB)</option>
                {OAB_DISCIPLINES.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.oabWeight}Q peso)
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Dificuldade
              </label>
              <select
                value={customDifficulty}
                onChange={e => setCustomDifficulty(e.target.value as any)}
                className="w-full min-w-0 max-w-full overflow-hidden text-ellipsis px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              >
                <option value="todas">Todas as Dificuldades (Mesclado)</option>
                <option value="Fácil">Fácil (Fundamentos & Conceitos)</option>
                <option value="Médio">Médio (Padrão Oficial FGV)</option>
                <option value="Difícil">Difícil (Casos Críticos & Pegadinhas)</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Quantidade de Questões
              </label>
              <select
                value={customQuestionCount}
                onChange={e => setCustomQuestionCount(Number(e.target.value))}
                className="w-full min-w-0 max-w-full overflow-hidden text-ellipsis px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              >
                <option value={10}>10 questões (Treino Rápido)</option>
                <option value={20}>20 questões (Sprint Diário)</option>
                <option value={40}>40 questões (Meia Prova)</option>
                <option value={80}>80 questões (Prova Completa)</option>
              </select>
            </div>

            <div className="min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                Tempo Limite
              </label>
              <select
                value={customTimeMinutes}
                onChange={e => setCustomTimeMinutes(Number(e.target.value))}
                className="w-full min-w-0 max-w-full overflow-hidden text-ellipsis px-3.5 py-2.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos (1 hora)</option>
                <option value={150}>150 minutos (2h30)</option>
                <option value={300}>300 minutos (5 horas)</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={() => handleStartSimulado()}
              disabled={starting}
              className="w-full sm:w-auto px-6 py-3 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-2"
            >
              {!serverIsPremium ? <Lock className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              <span>
                {!serverIsPremium ? 'Assinar Premium para Personalizar' : 'Iniciar Simulado Customizado'}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: ACTIVE SIMULADO
  // -------------------------------------------------------------
  if (screen === 'active') {
    const currentQuestion = activeQuestions[currentIndex];
    const answeredCount = Object.keys(userAnswers).length;
    const unansweredCount = activeQuestions.length - answeredCount;
    const flaggedCount = Object.values(flaggedQuestions).filter(Boolean).length;
    const isWarning = secondsRemaining < 300;

    const filteredNavIndices = activeQuestions.map((_, i) => i).filter(idx => {
      if (navFilter === 'unanswered') return userAnswers[idx] === undefined;
      if (navFilter === 'flagged') return Boolean(flaggedQuestions[idx]);
      return true;
    });

    return (
      <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-5 sm:space-y-6 animate-fade-in">
        {/* Sticky Control Bar */}
        <div className="sticky top-[98px] sm:top-16 z-30 bg-[#0B1F3A] text-white p-2.5 sm:p-4 rounded-2xl shadow-xl border border-[#D4AF37]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center justify-between gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono font-bold text-xs sm:text-sm border transition-colors shrink-0 ${
                  isWarning
                    ? 'bg-rose-950/80 border-rose-500 text-rose-300 animate-pulse'
                    : 'bg-white/10 border-white/20 text-[#D4AF37]'
                }`}
              >
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="tabular-nums">{formatTimer(secondsRemaining)}</span>
              </div>

              <button
                onClick={() => setIsTimerPaused(!isTimerPaused)}
                aria-label={isTimerPaused ? 'Retomar cronômetro' : 'Pausar cronômetro'}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-xs flex items-center gap-1 transition-colors shrink-0"
              >
                {isTimerPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{isTimerPaused ? 'Retomar' : 'Pausar'}</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] sm:text-xs text-slate-300 shrink-0 sm:hidden">
              <span className="tabular-nums">
                <strong className="text-white">{answeredCount}</strong>/{activeQuestions.length}
              </span>
              {flaggedCount > 0 && (
                <span className="text-amber-400 flex items-center gap-0.5 font-semibold tabular-nums">
                  <Flag className="w-3 h-3 fill-current" />
                  {flaggedCount}
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <div>
              Respondidas: <strong className="text-white">{answeredCount}</strong> / {activeQuestions.length}
            </div>
            {flaggedCount > 0 && (
              <div className="text-amber-400 flex items-center gap-1 font-semibold">
                <Flag className="w-3.5 h-3.5 fill-current" />
                <span>{flaggedCount} marcadas</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={finishing}
            className="w-full sm:w-auto px-4 py-1.5 sm:py-2 bg-gradient-to-r from-[#D4AF37] to-[#C59F2A] hover:from-[#E6C86E] hover:to-[#D4AF37] text-[#0B1F3A] font-extrabold text-xs rounded-lg shadow transition-all text-center shrink-0"
          >
            {finishing ? 'Corrigindo...' : 'Finalizar Simulado'}
          </button>
        </div>

        {/* Question Navigation Matrix */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <ListFilter className="w-3.5 h-3.5 text-[#0B1F3A]" />
              <span>Navegador de Questões</span>
            </div>

            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <button
                onClick={() => setNavFilter('all')}
                className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                  navFilter === 'all' ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Todas ({activeQuestions.length})
              </button>
              <button
                onClick={() => setNavFilter('unanswered')}
                className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                  navFilter === 'unanswered' ? 'bg-[#0B1F3A] text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Em Branco ({unansweredCount})
              </button>
              <button
                onClick={() => setNavFilter('flagged')}
                className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                  navFilter === 'flagged' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Marcadas ({flaggedCount})
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
            {filteredNavIndices.map(idx => {
              const isCurrent = idx === currentIndex;
              const hasAnswer = userAnswers[idx] !== undefined;
              const isFlagged = flaggedQuestions[idx];

              return (
                <button
                  key={idx}
                  onClick={() => setCurrentIndex(idx)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center relative transition-all ${
                    isCurrent
                      ? 'bg-[#0B1F3A] text-[#D4AF37] ring-2 ring-[#D4AF37] shadow'
                      : isFlagged
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : hasAnswer
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {idx + 1}
                  {isFlagged && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border border-white" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Question Card */}
        {currentQuestion && (
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-8 space-y-5 sm:space-y-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 text-xs text-slate-500 border-b border-slate-100 pb-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="px-2.5 py-1 rounded-md bg-[#0B1F3A] text-[#D4AF37] font-bold uppercase tracking-wider shrink-0">
                  Questão {currentIndex + 1} de {activeQuestions.length}
                </span>
                <span className="font-semibold text-slate-700 break-words">
                  {OAB_DISCIPLINES.find(d => d.id === currentQuestion.disciplineId)?.name || currentQuestion.disciplineId}
                </span>
                <span className="text-slate-300 hidden sm:inline">·</span>
                <span className="text-slate-500 break-words">{currentQuestion.subject}</span>
              </div>

              <button
                onClick={() => handleToggleFlag(currentIndex)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all max-w-full ${
                  flaggedQuestions[currentIndex]
                    ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <Flag className={`w-3.5 h-3.5 shrink-0 ${flaggedQuestions[currentIndex] ? 'fill-amber-600 text-amber-600' : ''}`} />
                <span>{flaggedQuestions[currentIndex] ? 'Marcada para Revisar' : 'Marcar para Revisar'}</span>
              </button>
            </div>

            <p className="text-sm sm:text-base text-slate-900 leading-relaxed whitespace-pre-line font-normal break-words [overflow-wrap:anywhere]">
              {currentQuestion.statement}
            </p>

            <div className="space-y-3 pt-2">
              {currentQuestion.options.map(option => {
                const isSelected = userAnswers[currentIndex] === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelectOption(option.id)}
                    className={`w-full p-3 sm:p-4 rounded-xl border text-left transition-all flex items-start gap-2.5 sm:gap-3.5 min-w-0 ${
                      isSelected
                        ? 'border-[#0B1F3A] bg-[#0B1F3A]/5 ring-1.5 ring-[#0B1F3A]'
                        : 'border-slate-200 hover:border-slate-400 bg-white'
                    }`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                        isSelected ? 'bg-[#0B1F3A] text-[#D4AF37]' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {option.id}
                    </span>
                    <span className="text-xs sm:text-sm text-slate-800 leading-snug flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {option.text}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 border-t border-slate-100 grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-2">
              <button
                onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
                disabled={currentIndex === 0}
                className="px-2.5 sm:px-4 py-2 rounded-xl border border-slate-200 sm:border-transparent text-xs font-bold text-slate-600 hover:text-slate-900 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-colors"
              >
                <ChevronLeft className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">Anterior</span>
                <span className="hidden sm:inline">Questão Anterior</span>
              </button>

              <button
                onClick={() => setCurrentIndex(prev => Math.min(activeQuestions.length - 1, prev + 1))}
                disabled={currentIndex === activeQuestions.length - 1}
                className="px-3 sm:px-5 py-2 sm:py-2.5 bg-[#0B1F3A] text-white hover:bg-[#16365C] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-colors disabled:opacity-40"
              >
                <span className="sm:hidden">Próxima</span>
                <span className="hidden sm:inline">Próxima Questão</span>
                <ChevronRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showSubmitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in overflow-y-auto">
            <div className="bg-white max-w-md w-full rounded-3xl p-4 sm:p-8 space-y-4 sm:space-y-6 shadow-2xl border border-slate-200 my-4 max-h-[92vh] overflow-y-auto">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 break-words">Entregar Simulado?</h3>
                  <p className="text-xs text-slate-500 break-words">Revise seu progresso antes de concluir a prova.</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 sm:gap-3 p-2.5 sm:p-4 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                <div className="min-w-0">
                  <span className="block text-base sm:text-xl font-bold text-emerald-600 tabular-nums">{answeredCount}</span>
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block truncate">Respondidas</span>
                </div>
                <div className="min-w-0">
                  <span className="block text-base sm:text-xl font-bold text-rose-500 tabular-nums">{unansweredCount}</span>
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block truncate">Em Branco</span>
                </div>
                <div className="min-w-0">
                  <span className="block text-base sm:text-xl font-bold text-amber-600 tabular-nums">{flaggedCount}</span>
                  <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium block truncate">Marcadas</span>
                </div>
              </div>

              {unansweredCount > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
                  <p className="font-bold">Atenção:</p>
                  <p>Você ainda possui {unansweredCount} questão(ões) sem resposta. No exame da OAB, não há penalidade por chutar.</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 pt-2">
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Continuar Prova
                </button>
                <button
                  onClick={handleConfirmFinish}
                  disabled={finishing}
                  className="px-4 py-2.5 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] rounded-xl text-xs font-bold shadow transition-colors"
                >
                  {finishing ? 'Corrigindo...' : 'Confirmar e Finalizar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: RESULTS SCREEN
  // -------------------------------------------------------------
  if (screen === 'result' && latestResult) {
    const total = latestResult.totalQuestions;
    const correct = latestResult.correctAnswers;
    const percent = Math.round((correct / total) * 100);
    const isApproved = percent >= 50;

    const wrongIndices: number[] = [];
    reviewQuestions.forEach((_, idx) => {
      if (!latestResult.answers[idx]?.isCorrect) {
        wrongIndices.push(idx);
      }
    });

    const flaggedIndices: number[] = [];
    reviewQuestions.forEach((_, idx) => {
      if (flaggedQuestions[idx]) {
        flaggedIndices.push(idx);
      }
    });

    const displayIndices =
      resultFilter === 'wrong'
        ? wrongIndices
        : resultFilter === 'flagged'
        ? flaggedIndices
        : reviewQuestions.map((_, i) => i);

    return (
      <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fade-in">
        {/* Results Banner */}
        <div
          className={`p-5 sm:p-10 rounded-3xl text-white shadow-xl relative overflow-hidden ${
            isApproved
              ? 'bg-gradient-to-br from-[#0B1F3A] via-[#16365C] to-[#0B1F3A]'
              : 'bg-gradient-to-br from-slate-900 via-[#1E293B] to-slate-900'
          }`}
        >
          <div className="max-w-3xl space-y-4 min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#D4AF37] text-xs font-semibold max-w-full">
              <Award className="w-4 h-4 shrink-0" />
              <span className="truncate">Gabarito e Desempenho Oficial</span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-bold font-serif text-white break-words">
              {isApproved ? 'Aprovado! Excelente Desempenho' : 'Em Desenvolvimento · Continue Firme'}
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
              {isApproved
                ? `Você alcançou ${percent}% de aproveitamento (${correct} acertos de ${total} questões). A marca mínima exigida na 1ª Fase da OAB é de 50%. Parabéns!`
                : `Você atingiu ${percent}% de aproveitamento (${correct} acertos de ${total} questões). A pontuação de corte da 1ª Fase da OAB é de 50%. Revise o gabarito comentado abaixo.`}
            </p>

            <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-4 border-t border-white/10 max-w-md">
              <div className="min-w-0">
                <span className="block text-lg sm:text-3xl font-extrabold text-[#D4AF37] tabular-nums">
                  {percent}%
                </span>
                <span className="text-[10px] sm:text-xs text-slate-300 block truncate">Aproveit.</span>
              </div>
              <div className="min-w-0">
                <span className="block text-lg sm:text-3xl font-extrabold text-white tabular-nums">
                  {correct}/{total}
                </span>
                <span className="text-[10px] sm:text-xs text-slate-300 block truncate">Acertos</span>
              </div>
              <div className="min-w-0">
                <span className="block text-lg sm:text-3xl font-extrabold text-white tabular-nums">
                  {Math.round(latestResult.timeSpentSeconds / 60)} min
                </span>
                <span className="text-[10px] sm:text-xs text-slate-300 block truncate">Tempo Gasto</span>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={() => setScreen('setup')}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-extrabold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Voltar aos Simulados</span>
              </button>
              {!serverIsPremium && onOpenPremium && (
                <button
                  onClick={onOpenPremium}
                  className="w-full sm:w-auto px-5 py-2.5 bg-white/15 hover:bg-white/25 text-white font-bold text-xs rounded-xl border border-white/25 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Crown className="w-4 h-4 text-[#D4AF37]" />
                  <span>Assinar Premium para Simulados Ilimitados</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Breakdown by Discipline Card */}
        {disciplineBreakdown.length > 1 && (
          <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#0B1F3A] shrink-0" />
                <span>Desempenho por Disciplina</span>
              </h2>
              <span className="text-xs text-slate-500">{disciplineBreakdown.length} matérias avaliadas</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {disciplineBreakdown.map(item => (
                <div key={item.id} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-800 truncate min-w-0">{item.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        item.pct >= 70
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.pct >= 50
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {item.pct}%
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        item.pct >= 70 ? 'bg-emerald-500' : item.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>

                  <div className="text-[11px] text-slate-500 flex justify-between">
                    <span>Acertos:</span>
                    <strong className="text-slate-700">
                      {item.correct} de {item.total}
                    </strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Review Section */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2 min-w-0">
              <BookOpen className="w-5 h-5 text-[#0B1F3A] shrink-0" />
              <h2 className="text-lg font-bold font-serif text-[#0B1F3A] break-words">
                Revisão e Fundamentação Questão a Questão
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                onClick={() => setResultFilter('wrong')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  resultFilter === 'wrong'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Apenas Erradas ({wrongIndices.length})
              </button>
              <button
                onClick={() => setResultFilter('all')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                  resultFilter === 'all'
                    ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Todas as Questões ({total})
              </button>
              {flaggedIndices.length > 0 && (
                <button
                  onClick={() => setResultFilter('flagged')}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                    resultFilter === 'flagged'
                      ? 'bg-amber-500 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Marcadas ({flaggedIndices.length})
                </button>
              )}
            </div>
          </div>

          {displayIndices.length === 0 ? (
            <div className="p-6 sm:p-8 text-center bg-emerald-50 border border-emerald-200 rounded-3xl text-emerald-900 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <p className="font-bold text-sm">Nenhuma questão para exibir neste filtro!</p>
              <p className="text-xs text-emerald-700">
                Você gabaritou todas as questões ou não marcou nenhuma nesta categoria.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {displayIndices.map(idx => {
                const questionObj = reviewQuestions[idx];
                if (!questionObj) return null;

                const answerItem = latestResult.answers[idx];
                const isCorrect = answerItem?.isCorrect;
                const correctOption = questionObj.options.find(o => o.id === questionObj.correctOptionId);
                const markedOption = questionObj.options.find(o => o.id === answerItem?.selectedOptionId);

                return (
                  <div
                    key={idx}
                    className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4 min-w-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 border-b border-slate-100 pb-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-bold text-[#0B1F3A] shrink-0">
                          Questão {idx + 1}
                        </span>
                        <span className="text-slate-300 hidden sm:inline">·</span>
                        <span className="font-semibold text-slate-700 uppercase break-words">
                          {questionObj.disciplineId} · {questionObj.subject}
                        </span>
                        {flaggedQuestions[idx] && (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold flex items-center gap-1 shrink-0">
                            <Flag className="w-2.5 h-2.5 fill-current" />
                            Marcada
                          </span>
                        )}
                      </div>

                      <span
                        className={`font-bold flex items-center gap-1 shrink-0 ${
                          isCorrect ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isCorrect ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Você acertou
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            Você errou
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-medium whitespace-pre-line break-words [overflow-wrap:anywhere]">
                      {questionObj.statement}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div
                        className={`p-3.5 rounded-xl border min-w-0 ${
                          isCorrect
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50 border-rose-200 text-rose-900'
                        }`}
                      >
                        <span className="font-bold block mb-1">
                          Sua Resposta: Letra {answerItem?.selectedOptionId || '(Em branco)'}
                        </span>
                        <p className="text-[11px] leading-snug break-words [overflow-wrap:anywhere]">
                          {markedOption ? markedOption.text : 'Não respondida no tempo de prova'}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 min-w-0">
                        <span className="font-bold block mb-1">
                          Gabarito Oficial: Letra {questionObj.correctOptionId}
                        </span>
                        <p className="text-[11px] leading-snug text-emerald-800 break-words [overflow-wrap:anywhere]">
                          {correctOption ? correctOption.text : ''}
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2 min-w-0">
                      <div className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                        <span>Comentário & Explicação:</span>
                      </div>
                      <p className="leading-relaxed break-words [overflow-wrap:anywhere]">{questionObj.explanation}</p>
                      <p className="text-[11px] text-[#0B1F3A] font-semibold pt-1 border-t border-slate-200 break-words [overflow-wrap:anywhere]">
                        Fundamento Legal: {questionObj.legalFoundation}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
