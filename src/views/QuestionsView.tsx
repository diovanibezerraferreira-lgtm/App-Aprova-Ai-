import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { QuestionItem } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import { TOTAL_QUESTIONS_COUNT, FREE_DAILY_QUESTIONS_LIMIT } from '../data/questions';
import { saveQuestionAnswer, getStoredAnswers, resetQuestionAnswers } from '../utils/storage';
import { useAuth } from '../context/AuthContext';
import {
  fetchQuestionsFeed,
  submitQuestionAnswer,
  ApiAccessError,
  DailyQuotaInfo,
  AiTutorMessageItem
} from '../services/contentService';
import { QuestionAiTutorPanel } from '../components/QuestionAiTutorPanel';
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  RotateCcw,
  BookOpen,
  Scale,
  Filter,
  Info,
  SlidersHorizontal,
  Flame,
  BookmarkCheck,
  RefreshCw,
  Sparkles,
  Check,
  Tag,
  Lock,
  Crown,
  LogIn,
  ChevronLeft,
  ChevronRight,
  GraduationCap
} from 'lucide-react';

interface QuestionsViewProps {
  initialDisciplineId?: string;
  retryQuestionIds?: string[];
  onClearRetryMode?: () => void;
  onRefreshPerformance?: () => void;
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

interface RevealedSolution {
  correctOptionId: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  legalFoundation: string;
}

export const QuestionsView: React.FC<QuestionsViewProps> = ({
  initialDisciplineId,
  retryQuestionIds,
  onClearRetryMode,
  onRefreshPerformance,
  onOpenAuth,
  onOpenPremium
}) => {
  const { currentUser, isPremiumActive } = useAuth();
  const isRetryMode = Boolean(retryQuestionIds && retryQuestionIds.length > 0);
  const retryIdsKey = isRetryMode ? retryQuestionIds!.join(',') : '';

  const [selectedDiscipline, setSelectedDiscipline] = useState<string>(initialDisciplineId || 'todas');
  const [selectedSubject, setSelectedSubject] = useState<string>('todos');
  const [selectedDifficulty, setSelectedDifficulty] = useState<'todas' | 'Fácil' | 'Médio' | 'Difícil'>('todas');
  const [page, setPage] = useState<number>(1);

  // Server feed state
  const [questionsPool, setQuestionsPool] = useState<QuestionItem[]>([]);
  const [serverIsPremium, setServerIsPremium] = useState<boolean>(false);
  const [quota, setQuota] = useState<DailyQuotaInfo | null>(null);
  const [catalogTotal, setCatalogTotal] = useState<number>(TOTAL_QUESTIONS_COUNT);
  const [byDisciplineStats, setByDisciplineStats] = useState<Record<string, number>>({});
  const [availableSubjects, setAvailableSubjects] = useState<{ name: string; count: number }[]>([]);
  const [difficultyCounts, setDifficultyCounts] = useState({ todas: 0, facil: 0, medio: 0, dificil: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: 300, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Interaction & grading state
  const [storageVersion, setStorageVersion] = useState<number>(0);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(0);
  const [selectedOptionId, setSelectedOptionId] = useState<'A' | 'B' | 'C' | 'D' | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [revealedSolutions, setRevealedSolutions] = useState<Record<string, RevealedSolution>>({});
  const [limitReachedMessage, setLimitReachedMessage] = useState<string | null>(null);
  const [sessionHits, setSessionHits] = useState<number>(0);
  const [sessionMisses, setSessionMisses] = useState<number>(0);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  // Professor Virtual IA state (conversation preserved per questionId during session)
  const [aiTutorOpen, setAiTutorOpen] = useState<boolean>(false);
  const [aiTutorHistoryByQuestion, setAiTutorHistoryByQuestion] = useState<
    Record<string, AiTutorMessageItem[]>
  >({});

  const handleAppendAiMessages = useCallback(
    (questionId: string, added: AiTutorMessageItem[]) => {
      setAiTutorHistoryByQuestion((prev) => ({
        ...prev,
        [questionId]: [...(prev[questionId] || []), ...added],
      }));
    },
    []
  );

  const handleResetAiConversation = useCallback((questionId: string) => {
    setAiTutorHistoryByQuestion((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (initialDisciplineId) {
      setSelectedDiscipline(initialDisciplineId);
      setSelectedSubject('todos');
      setPage(1);
      setCurrentQueueIndex(0);
      setSelectedOptionId(null);
      setIsAnswered(false);
    }
  }, [initialDisciplineId]);

  useEffect(() => {
    if (retryIdsKey) {
      setCurrentQueueIndex(0);
      setSelectedOptionId(null);
      setIsAnswered(false);
    }
  }, [retryIdsKey]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchQuestionsFeed(
        isRetryMode
          ? { questionIds: retryQuestionIds }
          : {
              disciplineId: selectedDiscipline,
              subject: selectedSubject,
              difficulty: selectedDifficulty,
              page,
              limit: 300,
            }
      );

      setQuestionsPool(res.questions);
      setServerIsPremium(res.isPremium);
      setQuota(res.quota);
      setCatalogTotal(res.catalogStats.total);
      setByDisciplineStats(res.catalogStats.byDiscipline);
      setAvailableSubjects(res.availableSubjects);
      setDifficultyCounts(res.difficultyCounts);
      setPagination(res.pagination);

      if (!res.isPremium && res.quota.questionsRemaining <= 0) {
        setLimitReachedMessage(
          `Você atingiu o limite diário de ${res.quota.questionsLimit} questões gratuitas de hoje. Assine o Plano Premium para continuar sem limites.`
        );
      } else {
        setLimitReachedMessage(null);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Não foi possível carregar as questões do servidor.');
    } finally {
      setLoading(false);
    }
  }, [isRetryMode, retryIdsKey, selectedDiscipline, selectedSubject, selectedDifficulty, page]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed, currentUser?.uid, isPremiumActive]);

  const storedAnswers = useMemo(() => {
    return getStoredAnswers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion]);

  const answersMap = useMemo(() => {
    return new Map(storedAnswers.map(a => [a.questionId, a]));
  }, [storedAnswers]);

  const unansweredPool = useMemo(() => {
    return questionsPool.filter(q => !answersMap.has(q.id));
  }, [questionsPool, answersMap]);

  const answeredPool = useMemo(() => {
    return questionsPool.filter(q => answersMap.has(q.id));
  }, [questionsPool, answersMap]);

  const isCycleComplete = !isRetryMode && questionsPool.length > 0 && unansweredPool.length === 0;

  const activeQueue = useMemo(() => {
    if (questionsPool.length === 0) return [];
    if (isRetryMode) return questionsPool;
    if (unansweredPool.length > 0) return unansweredPool;
    return answeredPool;
  }, [isRetryMode, questionsPool, unansweredPool, answeredPool]);

  const safeIndex = currentQueueIndex < activeQueue.length ? currentQueueIndex : 0;
  const currentQuestion: QuestionItem | undefined = activeQueue[safeIndex];
  const previousAnswer = currentQuestion ? answersMap.get(currentQuestion.id) : undefined;

  const activeSolution: RevealedSolution | null = useMemo(() => {
    if (!currentQuestion) return null;
    if (revealedSolutions[currentQuestion.id]) {
      return revealedSolutions[currentQuestion.id];
    }
    if (currentQuestion.correctOptionId) {
      return {
        correctOptionId: currentQuestion.correctOptionId,
        explanation: currentQuestion.explanation,
        legalFoundation: currentQuestion.legalFoundation,
      };
    }
    return null;
  }, [currentQuestion, revealedSolutions]);

  const handleDisciplineChange = (discId: string) => {
    if (isRetryMode && onClearRetryMode) onClearRetryMode();
    setSelectedDiscipline(discId);
    setSelectedSubject('todos');
    setPage(1);
    setCurrentQueueIndex(0);
    setSelectedOptionId(null);
    setIsAnswered(false);
  };

  const handleSubjectChange = (subject: string) => {
    setSelectedSubject(subject);
    setPage(1);
    setCurrentQueueIndex(0);
    setSelectedOptionId(null);
    setIsAnswered(false);
  };

  const handleDifficultyChange = (diff: 'todas' | 'Fácil' | 'Médio' | 'Difícil') => {
    setSelectedDifficulty(diff);
    setPage(1);
    setCurrentQueueIndex(0);
    setSelectedOptionId(null);
    setIsAnswered(false);
  };

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D') => {
    if (isAnswered || submitting) return;
    setSelectedOptionId(optId);
  };

  const handleConfirmAnswer = async () => {
    if (!selectedOptionId || !currentQuestion || isAnswered || submitting) return;

    setSubmitting(true);
    try {
      const result = await submitQuestionAnswer(currentQuestion.id, selectedOptionId);

      setRevealedSolutions(prev => ({
        ...prev,
        [currentQuestion.id]: {
          correctOptionId: result.correctOptionId,
          explanation: result.explanation,
          legalFoundation: result.legalFoundation,
        },
      }));

      setIsAnswered(true);
      setLimitReachedMessage(null);

      if (result.isCorrect) {
        setSessionHits(prev => prev + 1);
      } else {
        setSessionMisses(prev => prev + 1);
      }

      if (!result.isPremium && result.questionsLimit !== null) {
        setQuota(prev =>
          prev
            ? {
                ...prev,
                questionsUsed: result.questionsUsed,
                questionsRemaining: result.questionsRemaining ?? 0,
                answeredQuestionIdsToday: prev.answeredQuestionIdsToday.includes(currentQuestion.id)
                  ? prev.answeredQuestionIdsToday
                  : [...prev.answeredQuestionIdsToday, currentQuestion.id],
              }
            : null
        );
      }

      saveQuestionAnswer({
        questionId: currentQuestion.id,
        selectedOptionId,
        isCorrect: result.isCorrect,
        timestamp: Date.now(),
        disciplineId: currentQuestion.disciplineId,
        subject: currentQuestion.subject,
      });

      if (onRefreshPerformance) onRefreshPerformance();
    } catch (err: any) {
      if (err instanceof ApiAccessError && err.code === 'DAILY_LIMIT_REACHED') {
        setLimitReachedMessage(err.message);
        setQuota(prev =>
          prev
            ? {
                ...prev,
                questionsUsed: err.details?.questionsLimit ?? FREE_DAILY_QUESTIONS_LIMIT,
                questionsRemaining: 0,
              }
            : null
        );
      } else {
        setLoadError(err?.message || 'Erro ao validar resposta no servidor.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    setSelectedOptionId(null);
    setIsAnswered(false);
    setStorageVersion(v => v + 1);

    if (activeQueue.length > 1) {
      setCurrentQueueIndex(prev => (prev + 1) % activeQueue.length);
    } else {
      setCurrentQueueIndex(0);
    }
  };

  const handleResetCurrent = () => {
    setSelectedOptionId(null);
    setIsAnswered(false);
  };

  const handleResetCycle = () => {
    if (questionsPool.length === 0) return;
    const idsToReset = questionsPool.map(q => q.id);
    resetQuestionAnswers(idsToReset);
    setStorageVersion(v => v + 1);
    setCurrentQueueIndex(0);
    setSelectedOptionId(null);
    setIsAnswered(false);
    setResetNotice('Ciclo reiniciado! As questões deste filtro foram restauradas como inéditas para novo treinamento.');
    setTimeout(() => {
      setResetNotice(null);
    }, 4500);
  };

  const currentDisciplineInfo = OAB_DISCIPLINES.find(d => d.id === currentQuestion?.disciplineId);

  const progressPercent = questionsPool.length > 0
    ? Math.round((answeredPool.length / questionsPool.length) * 100)
    : 0;

  const quotaLimit = quota?.questionsLimit || FREE_DAILY_QUESTIONS_LIMIT;
  const quotaUsed = quota?.questionsUsed || 0;
  const quotaRemaining = quota?.questionsRemaining ?? quotaLimit;
  const isFreeQuotaExhausted = !serverIsPremium && quotaRemaining <= 0;

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5 sm:space-y-6">
      {/* Header & Filter Controls */}
      <div className="space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shadow-sm shrink-0">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
                  Banco de Questões Comentadas
                </h1>
                <p className="text-xs text-slate-500">
                  {serverIsPremium
                    ? `Acesso Premium completo às ${catalogTotal.toLocaleString('pt-BR')} questões comentadas com controle anti-repetição.`
                    : `Plano Gratuito: até ${quotaLimit} questões por dia distribuídas entre as disciplinas.`}
                </p>
              </div>
            </div>
          </div>

          {/* Session Counters */}
          <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2 sm:gap-3 bg-white px-3 sm:px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-xs max-w-full">
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold whitespace-nowrap">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Acertos: {sessionHits}</span>
            </div>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <div className="flex items-center gap-1.5 text-rose-700 font-semibold whitespace-nowrap">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Erros: {sessionMisses}</span>
            </div>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <div className="text-slate-700 font-medium whitespace-nowrap">
              Aproveitamento:{' '}
              <span className="font-bold text-[#0B1F3A]">
                {sessionHits + sessionMisses > 0
                  ? `${Math.round((sessionHits / (sessionHits + sessionMisses)) * 100)}%`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Retry Wrong Questions Mode Banner */}
        {isRetryMode && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <RotateCcw className="w-4 h-4 text-[#9A7B16] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0B1F3A]">
                  Modo Revisão de Erros ({activeQueue.length} {activeQueue.length === 1 ? 'questão' : 'questões'})
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Refazendo questões erradas selecionadas a partir do seu Relatório de Desempenho. Suas novas respostas atualizam seu histórico automaticamente.
                </p>
              </div>
            </div>
            {onClearRetryMode && (
              <button
                onClick={onClearRetryMode}
                className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-xs font-semibold text-[#0B1F3A] transition-colors shrink-0 text-center"
              >
                Voltar ao banco completo
              </button>
            )}
          </div>
        )}

        {/* Daily Freemium Quota Tracker */}
        {!loading && !serverIsPremium && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-[#0B1F3A] to-[#16365C] text-white border border-[#D4AF37]/40 shadow-md space-y-3 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 text-xs font-bold text-[#D4AF37] uppercase tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>Cota Diária do Plano Gratuito</span>
                </div>
                <p className="text-xs sm:text-sm font-semibold text-white">
                  {quotaUsed} de {quotaLimit} questões respondidas hoje ·{' '}
                  <span className={quotaRemaining > 0 ? 'text-emerald-300' : 'text-amber-300'}>
                    {quotaRemaining > 0
                      ? `${quotaRemaining} restante${quotaRemaining > 1 ? 's' : ''} hoje`
                      : 'Limite diário atingido'}
                  </span>
                </p>
                <p className="text-[11px] text-slate-300">
                  Amostra diária distribuída entre as 21 disciplinas. No Plano Premium (R$ 29,90/mês) você desbloqueia todas as {catalogTotal.toLocaleString('pt-BR')} questões sem limites.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 min-w-0">
                {!currentUser && onOpenAuth && (
                  <button
                    onClick={onOpenAuth}
                    className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-colors text-center"
                  >
                    Entrar
                  </button>
                )}
                {onOpenPremium && (
                  <button
                    onClick={onOpenPremium}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] text-xs font-extrabold shadow transition-colors flex items-center justify-center gap-1.5 text-center"
                  >
                    <Crown className="w-3.5 h-3.5 shrink-0" />
                    <span>Liberar {catalogTotal.toLocaleString('pt-BR')} Questões</span>
                  </button>
                )}
              </div>
            </div>

            <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isFreeQuotaExhausted ? 'bg-rose-400' : 'bg-[#D4AF37]'
                }`}
                style={{ width: `${Math.min(100, Math.round((quotaUsed / quotaLimit) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Limit Reached Alert */}
        {limitReachedMessage && !serverIsPremium && (
          <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border-2 border-[#D4AF37] text-[#0B1F3A] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#0B1F3A] text-[#D4AF37] flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="text-sm font-bold text-[#0B1F3A]">
                  Limite de {quotaLimit} questões diárias atingido
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {limitReachedMessage}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 min-w-0">
              {!currentUser && onOpenAuth && (
                <button
                  onClick={onOpenAuth}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-bold text-slate-800 flex items-center justify-center gap-1.5"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" />
                  <span>Já sou assinante</span>
                </button>
              )}
              {onOpenPremium && (
                <button
                  onClick={onOpenPremium}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] text-xs font-extrabold shadow flex items-center justify-center gap-1.5 text-center"
                >
                  <Crown className="w-3.5 h-3.5 shrink-0" />
                  <span>Assinar Premium (R$ 29,90/mês)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {loadError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>{loadError}</span>
            <button
              onClick={loadFeed}
              className="px-3 py-1 rounded-lg bg-white border border-rose-300 font-semibold flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Tentar Novamente</span>
            </button>
          </div>
        )}

        {/* Notice Banner */}
        {resetNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-center justify-between gap-2 animate-fade-in shadow-sm">
            <div className="flex items-center gap-2 font-medium">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{resetNotice}</span>
            </div>
            <button
              onClick={() => setResetNotice(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold px-2 py-0.5 rounded"
            >
              OK
            </button>
          </div>
        )}

        {/* Discipline Selector Pills + Dropdown */}
        <div className="space-y-2 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
              Disciplina:
            </span>
            <div className="w-full sm:w-auto min-w-0 max-w-full flex items-center gap-1.5 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedDiscipline}
                onChange={e => handleDisciplineChange(e.target.value)}
                className="flex-1 sm:w-auto min-w-0 max-w-full overflow-hidden text-ellipsis px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0B1F3A]"
              >
                <option value="todas">Todas as Disciplinas ({catalogTotal})</option>
                {OAB_DISCIPLINES.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({byDisciplineStats[d.id] || 300} questões)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 w-full max-w-full min-w-0">
            <button
              onClick={() => handleDisciplineChange('todas')}
              className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg max-w-full break-words transition-colors ${
                selectedDiscipline === 'todas'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              Todas ({catalogTotal})
            </button>
            {OAB_DISCIPLINES.map(disc => {
              const isSelected = selectedDiscipline === disc.id;
              const count = byDisciplineStats[disc.id] || 300;
              return (
                <button
                  key={disc.id}
                  onClick={() => handleDisciplineChange(disc.id)}
                  className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-lg max-w-full break-words transition-colors ${
                    isSelected
                      ? 'bg-[#0B1F3A] text-[#D4AF37] font-semibold shadow'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {disc.shortName} {count > 0 ? `(${count})` : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme / Subject Selector Bar */}
        <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm space-y-2 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <Tag className="w-3.5 h-3.5 text-[#0B1F3A] shrink-0" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Tema / Assunto:
              </span>
              <span className="text-[11px] text-slate-500">
                {availableSubjects.length} temas disponíveis
              </span>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0 max-w-full">
              <select
                value={selectedSubject}
                onChange={e => handleSubjectChange(e.target.value)}
                className="flex-1 sm:w-auto min-w-0 max-w-full overflow-hidden text-ellipsis px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-[#0B1F3A]"
              >
                <option value="todos">
                  Todos os Temas ({availableSubjects.reduce((acc, s) => acc + s.count, 0)})
                </option>
                {availableSubjects.map(s => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.count} questões)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 w-full max-w-full min-w-0 pt-1 text-[11px]">
            <button
              onClick={() => handleSubjectChange('todos')}
              className={`px-2.5 py-1 rounded-md font-medium max-w-full text-left break-words transition-colors ${
                selectedSubject === 'todos'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] font-bold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todos os Temas
            </button>
            {availableSubjects.slice(0, 8).map(s => (
              <button
                key={s.name}
                onClick={() => handleSubjectChange(s.name)}
                className={`px-2.5 py-1 rounded-md max-w-full text-left break-words transition-colors ${
                  selectedSubject === s.name
                    ? 'bg-[#0B1F3A] text-[#D4AF37] font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s.name} ({s.count})
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty Bar & Repetition Status */}
        <div className="bg-slate-100/90 p-2.5 sm:p-3 rounded-xl border border-slate-200/90 flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <SlidersHorizontal className="w-4 h-4 text-[#0B1F3A]" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Dificuldade:
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => handleDifficultyChange('todas')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  selectedDifficulty === 'todas'
                    ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                Todas ({difficultyCounts.todas})
              </button>
              <button
                onClick={() => handleDifficultyChange('Fácil')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  selectedDifficulty === 'Fácil'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Fácil ({difficultyCounts.facil})</span>
              </button>
              <button
                onClick={() => handleDifficultyChange('Médio')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  selectedDifficulty === 'Médio'
                    ? 'bg-amber-500 text-slate-900 font-bold shadow-sm'
                    : 'bg-white text-amber-800 border border-amber-200 hover:bg-amber-50'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>Médio ({difficultyCounts.medio})</span>
              </button>
              <button
                onClick={() => handleDifficultyChange('Difícil')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                  selectedDifficulty === 'Difícil'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-white text-rose-800 border border-rose-200 hover:bg-rose-50'
                }`}
              >
                <Flame className="w-3 h-3 text-rose-500" />
                <span>Difícil ({difficultyCounts.dificil})</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-between md:justify-end text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Progresso no lote:</span>
              <span className="font-bold text-[#0B1F3A]">
                {answeredPool.length}/{questionsPool.length} ({progressPercent}%)
              </span>
            </div>
            {answeredPool.length > 0 && (
              <button
                onClick={handleResetCycle}
                title="Reiniciar o ciclo de questões deste lote"
                className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 hover:text-[#0B1F3A] border border-slate-300 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors shadow-sm"
              >
                <RefreshCw className="w-3 h-3 text-[#D4AF37]" />
                <span>Reiniciar Ciclo</span>
              </button>
            )}
          </div>
        </div>

        {/* Premium Pagination Strip */}
        {serverIsPremium && pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs">
            <span className="text-slate-600 font-medium">
              Página <strong>{pagination.page}</strong> de <strong>{pagination.totalPages}</strong> ({pagination.total} questões neste filtro)
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setPage(p => Math.max(1, p - 1));
                  setCurrentQueueIndex(0);
                  setSelectedOptionId(null);
                  setIsAnswered(false);
                }}
                disabled={page <= 1}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-700 font-semibold disabled:opacity-40 hover:bg-slate-50 flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Anterior</span>
              </button>
              <button
                onClick={() => {
                  setPage(p => Math.min(pagination.totalPages, p + 1));
                  setCurrentQueueIndex(0);
                  setSelectedOptionId(null);
                  setIsAnswered(false);
                }}
                disabled={page >= pagination.totalPages}
                className="px-2.5 py-1 rounded-lg bg-[#0B1F3A] text-[#D4AF37] font-semibold disabled:opacity-40 hover:bg-[#16365C] flex items-center gap-1"
              >
                <span>Próximo Lote</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {questionsPool.length > 0 && (
          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#D4AF37] h-full transition-all duration-300 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {isCycleComplete && (
          <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 shadow-sm animate-fade-in">
            <div className="flex items-start sm:items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 text-slate-900 font-bold flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-sm text-[#0B1F3A]">
                  Ciclo Completo! Todas as {questionsPool.length} questões deste lote já foram respondidas.
                </p>
                <p className="text-slate-600 mt-0.5">
                  Modo de Revisão e Fixação ativo. As perguntas estão sendo revisitadas em sequência.
                </p>
              </div>
            </div>
            <button
              onClick={handleResetCycle}
              className="px-3.5 py-2 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 shrink-0 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reiniciar Ciclo deste Tema</span>
            </button>
          </div>
        )}
      </div>

      {/* Loading skeleton or Question Card */}
      {loading ? (
        <div className="h-96 bg-white rounded-2xl border border-slate-200 animate-pulse" />
      ) : currentQuestion ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="px-4 sm:px-6 py-3 sm:py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="font-bold text-[#0B1F3A] uppercase tracking-wide break-words">
                {currentDisciplineInfo?.name || currentQuestion.disciplineId}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-700 font-medium break-words">{currentQuestion.subject}</span>
              <span className="text-slate-300">·</span>
              <span
                className={`px-2 py-0.5 rounded-md font-bold text-[11px] border ${
                  currentQuestion.difficulty === 'Fácil'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : currentQuestion.difficulty === 'Médio'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {currentQuestion.difficulty}
              </span>

              {previousAnswer ? (
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border inline-flex items-center gap-1 max-w-full break-words ${
                    previousAnswer.isCorrect
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-amber-50 text-amber-900 border-amber-300'
                  }`}
                >
                  <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                  <span>Revisão ({previousAnswer.isCorrect ? 'Acertada anterior' : 'Errou anterior'})</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-[#0B1F3A]/5 text-[#0B1F3A] border border-[#0B1F3A]/20 inline-flex items-center gap-1 max-w-full">
                  <BookmarkCheck className="w-3 h-3 text-[#D4AF37] shrink-0" />
                  <span>Inédita</span>
                </span>
              )}
            </div>

            <div className="text-slate-500 font-medium break-words max-w-full">
              Fila: {safeIndex + 1} de {activeQueue.length} {isCycleComplete ? '(Revisão)' : '(Inéditas)'}
            </div>
          </div>

          <div className="p-4 sm:p-8 space-y-5 sm:space-y-6 min-w-0">
            <div className="text-slate-900 text-sm sm:text-base leading-relaxed min-w-0">
              <p className="font-normal whitespace-pre-line break-words [overflow-wrap:anywhere]">
                {currentQuestion.statement}
              </p>
            </div>

            <div className="space-y-3 pt-2 min-w-0">
              {currentQuestion.options.map(option => {
                const isSelected = selectedOptionId === option.id;
                const isCorrect = Boolean(activeSolution && option.id === activeSolution.correctOptionId);

                let optionStyles = 'border-slate-200 hover:border-[#0B1F3A]/40 hover:bg-slate-50/50 bg-white';
                let badgeStyles = 'bg-slate-100 text-slate-700 border-slate-300';

                if (isSelected && !isAnswered) {
                  optionStyles = 'border-[#0B1F3A] bg-[#0B1F3A]/5 ring-1 ring-[#0B1F3A]';
                  badgeStyles = 'bg-[#0B1F3A] text-white border-[#0B1F3A]';
                }

                if (isAnswered && activeSolution) {
                  if (isCorrect) {
                    optionStyles = 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500';
                    badgeStyles = 'bg-emerald-600 text-white border-emerald-600';
                  } else if (isSelected && !isCorrect) {
                    optionStyles = 'border-rose-500 bg-rose-50/60 ring-1 ring-rose-500';
                    badgeStyles = 'bg-rose-600 text-white border-rose-600';
                  } else {
                    optionStyles = 'border-slate-200 bg-slate-50/40 opacity-70';
                  }
                }

                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelectOption(option.id)}
                    disabled={isAnswered || submitting}
                    className={`w-full p-3 sm:p-4 rounded-xl border text-left transition-all flex items-start gap-2.5 sm:gap-3.5 min-w-0 ${optionStyles}`}
                  >
                    <span
                      className={`w-7 h-7 rounded-lg border font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 transition-colors ${badgeStyles}`}
                    >
                      {option.id}
                    </span>
                    <span className="text-xs sm:text-sm text-slate-800 leading-snug flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {option.text}
                    </span>
                    {isAnswered && activeSolution && isCorrect && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    )}
                    {isAnswered && activeSolution && isSelected && !isCorrect && (
                      <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Answer & Next Controls */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 sm:gap-3">
              <div className="w-full sm:w-auto">
                {!isAnswered ? (
                  isFreeQuotaExhausted && !quota?.answeredQuestionIdsToday?.includes(currentQuestion.id) ? (
                    onOpenPremium && (
                      <button
                        onClick={onOpenPremium}
                        className="w-full sm:w-auto px-4 sm:px-5 py-2.5 rounded-xl font-extrabold text-xs bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] shadow-sm flex items-center justify-center gap-2 text-center"
                      >
                        <Crown className="w-4 h-4 shrink-0" />
                        <span>Desbloquear Questões Ilimitadas</span>
                      </button>
                    )
                  ) : (
                    <button
                      onClick={handleConfirmAnswer}
                      disabled={!selectedOptionId || submitting}
                      className={`w-full sm:w-auto px-5 sm:px-6 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm text-center ${
                        selectedOptionId && !submitting
                          ? 'bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37]'
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      {submitting ? 'Validando...' : 'Responder Questão'}
                    </button>
                  )
                ) : (
                  <button
                    onClick={handleResetCurrent}
                    className="w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Tentar Novamente</span>
                  </button>
                )}
              </div>

              <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAiTutorOpen((prev) => !prev)}
                  aria-expanded={aiTutorOpen}
                  className={`w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 border ${
                    aiTutorOpen
                      ? 'bg-[#0B1F3A] text-[#D4AF37] border-[#0B1F3A] shadow-sm'
                      : 'bg-white hover:bg-[#0B1F3A]/5 text-[#0B1F3A] border-[#0B1F3A]/30'
                  }`}
                >
                  <GraduationCap className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <span>{aiTutorOpen ? 'Ocultar Professor IA' : 'Consultar Professor IA'}</span>
                </button>

                <button
                  onClick={handleNextQuestion}
                  className="w-full sm:w-auto px-5 py-2.5 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-2"
                >
                  <span>Próxima Questão</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              </div>
            </div>

            {/* Explanation & Legal Foundation Section */}
            {isAnswered && activeSolution && (
              <div className="mt-6 pt-6 border-t border-slate-200 space-y-4 animate-fade-in">
                <div
                  className={`p-4 rounded-xl border flex items-start gap-3 ${
                    selectedOptionId === activeSolution.correctOptionId
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  {selectedOptionId === activeSolution.correctOptionId ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="text-sm font-bold">
                      {selectedOptionId === activeSolution.correctOptionId
                        ? 'Parabéns! Resposta Correta.'
                        : `Resposta Incorreta. A alternativa correta é a letra ${activeSolution.correctOptionId}.`}
                    </h4>
                    <p className="text-xs mt-0.5 opacity-90">
                      Confira abaixo os fundamentos jurídicos e doutrinários da questão.
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 sm:p-5 rounded-xl border border-slate-200 space-y-3 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#0B1F3A]">
                    <BookOpen className="w-4 h-4 text-[#D4AF37] shrink-0" />
                    <span>Comentário Didático da Questão</span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed break-words [overflow-wrap:anywhere]">
                    {activeSolution.explanation}
                  </p>

                  <div className="pt-2 border-t border-slate-200 min-w-0">
                    <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5 text-[#0B1F3A] shrink-0" />
                      Fundamento Jurídico:
                    </span>
                    <p className="text-xs text-slate-600 mt-0.5 font-medium break-words [overflow-wrap:anywhere]">
                      {activeSolution.legalFoundation}
                    </p>
                  </div>

                  {currentQuestion.examReference && (
                    <div className="pt-1 text-[11px] text-slate-400 break-words">
                      Referência: {currentQuestion.examReference}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Professor Virtual com IA (vinculado à questão atual) */}
            <QuestionAiTutorPanel
              isOpen={aiTutorOpen}
              onClose={() => setAiTutorOpen(false)}
              question={currentQuestion}
              disciplineName={currentDisciplineInfo?.name || currentQuestion.disciplineId}
              isQuestionAnsweredInView={isAnswered || Boolean(activeSolution)}
              messages={aiTutorHistoryByQuestion[currentQuestion.id] || []}
              onAppendMessages={handleAppendAiMessages}
              onResetConversation={handleResetAiConversation}
              onOpenAuth={onOpenAuth}
              onOpenPremium={onOpenPremium}
            />
          </div>

          <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="break-words">Questão didática e fundamentada para exame da OAB e concursos.</span>
            </div>
            <span className="text-slate-400 text-[10px] shrink-0">ID: {currentQuestion.id}</span>
          </div>
        </div>
      ) : (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Filter className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-800">Nenhuma questão encontrada para este filtro</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Não há questões no filtro selecionado no momento.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              onClick={() => handleDifficultyChange('todas')}
              className="px-4 py-2 bg-[#0B1F3A] text-[#D4AF37] text-xs font-semibold rounded-lg shadow-sm"
            >
              Ver Todas as Dificuldades
            </button>
            <button
              onClick={() => {
                handleDisciplineChange('todas');
                handleDifficultyChange('todas');
              }}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200"
            >
              Limpar Todos os Filtros
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
