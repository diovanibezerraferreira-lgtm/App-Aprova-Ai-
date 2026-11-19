import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UserProfile } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import { useAuth } from '../context/AuthContext';
import {
  fetchStudyPlan,
  saveStudyPlanConfig,
  createStudyActivity,
  updateStudyActivity,
  completeStudyActivity,
  cancelStudyActivity,
  reopenStudyActivity,
  StudyPlanResponse,
  StudyPlanConfig,
  WeekdayIndex,
  PreferredTimeSlot,
} from '../services/contentService';
import { StudyCalendarPanel } from '../components/StudyCalendarPanel';
import {
  CalendarDays,
  Target,
  Clock,
  Flame,
  CheckCircle2,
  Sliders,
  Bell,
  BellRing,
  Sparkles,
  Crown,
  Save,
  RefreshCw,
  LogIn,
  ShieldAlert,
  ArrowRight,
  BarChart3,
  Plus,
  X,
  Info,
  Check,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react';

interface StudyPlanViewProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onGoToQuestions: () => void;
  onGoToPerformance: () => void;
  onOpenAuth: () => void;
  onOpenPremium: () => void;
}

type PlanSectionTab = 'calendario' | 'metas' | 'distribuicao' | 'lembretes';

const WEEKDAYS_LIST: { index: WeekdayIndex; short: string; full: string }[] = [
  { index: 1, short: 'Seg', full: 'Segunda-feira' },
  { index: 2, short: 'Ter', full: 'Terça-feira' },
  { index: 3, short: 'Qua', full: 'Quarta-feira' },
  { index: 4, short: 'Qui', full: 'Quinta-feira' },
  { index: 5, short: 'Sex', full: 'Sexta-feira' },
  { index: 6, short: 'Sáb', full: 'Sábado' },
  { index: 0, short: 'Dom', full: 'Domingo' },
];

const TIME_SLOTS_LIST: { id: PreferredTimeSlot; label: string; range: string }[] = [
  { id: 'manha', label: 'Manhã', range: '06h – 12h' },
  { id: 'tarde', label: 'Tarde', range: '12h – 18h' },
  { id: 'noite', label: 'Noite', range: '18h – 23h' },
  { id: 'madrugada', label: 'Madrugada', range: '23h – 06h' },
];

function formatMinutesAsHours(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export const StudyPlanView: React.FC<StudyPlanViewProps> = ({
  userProfile,
  onUpdateProfile,
  onGoToQuestions,
  onGoToPerformance,
  onOpenAuth,
  onOpenPremium,
}) => {
  const { currentUser, isPremiumActive } = useAuth();

  const [data, setData] = useState<StudyPlanResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState<boolean>(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<PlanSectionTab>('calendario');

  // Editable form drafts synchronized from backend
  const [draftPlan, setDraftPlan] = useState<StudyPlanConfig | null>(null);
  const [addDisciplineDay, setAddDisciplineDay] = useState<Record<string, string>>({});

  // Browser notification state (never requested automatically!)
  const [notificationSupported, setNotificationSupported] = useState<boolean>(false);
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [reminderTestMessage, setReminderTestMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationSupported(true);
      setNotificationPermission(window.Notification.permission);
    } else {
      setNotificationSupported(false);
    }
  }, []);

  const showTransientNotice = (msg: string) => {
    setFeedbackNotice(msg);
    setTimeout(() => {
      setFeedbackNotice((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  const loadStudyPlan = useCallback(async () => {
    if (!currentUser) {
      setData(null);
      setDraftPlan(null);
      setLoading(false);
      setErrorMessage(null);
      setIsUnavailable(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setIsUnavailable(false);

    try {
      const response = await fetchStudyPlan();
      setData(response);
      setDraftPlan(response.plan);
    } catch (err: any) {
      if (err?.status === 503) {
        setIsUnavailable(true);
      }
      setErrorMessage(
        err?.message ||
          'Não foi possível carregar seu Plano de Estudos no momento. Tente novamente em instantes.'
      );
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadStudyPlan();
  }, [loadStudyPlan, isPremiumActive]);

  const disciplineNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of OAB_DISCIPLINES) {
      map.set(d.id, d.name);
    }
    return map;
  }, []);

  const handleSavePlanDraft = async (overrideDraft?: StudyPlanConfig, successLabel?: string) => {
    const target = overrideDraft || draftPlan;
    if (!target) return;

    setSaving(true);
    setErrorMessage(null);
    try {
      const updated = await saveStudyPlanConfig({
        ...target,
        isConfigured: true,
      });
      setData(updated);
      setDraftPlan(updated.plan);

      // Keep local profile dailyGoalQuestions synchronized cleanly
      if (updated.plan.dailyGoalQuestions !== userProfile.dailyGoalQuestions) {
        onUpdateProfile({
          ...userProfile,
          dailyGoalQuestions: updated.plan.dailyGoalQuestions,
        });
      }

      showTransientNotice(successLabel || 'Plano de Estudos salvo com sucesso no Firebase.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDay = (day: WeekdayIndex) => {
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const exists = prev.availableDays.includes(day);
      const nextDays = exists
        ? prev.availableDays.filter((d) => d !== day)
        : [...prev.availableDays, day].sort((a, b) => a - b);
      return {
        ...prev,
        availableDays: nextDays.length > 0 ? nextDays : [day],
      };
    });
  };

  const handleToggleTimeSlot = (slot: PreferredTimeSlot) => {
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const exists = prev.preferredTimeSlots.includes(slot);
      const nextSlots = exists
        ? prev.preferredTimeSlots.filter((s) => s !== slot)
        : [...prev.preferredTimeSlots, slot];
      return {
        ...prev,
        preferredTimeSlots: nextSlots.length > 0 ? nextSlots : [slot],
      };
    });
  };

  const handleToggleDiscipline = (discId: string) => {
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const exists = prev.selectedDisciplines.includes(discId);
      const next = exists
        ? prev.selectedDisciplines.filter((id) => id !== discId)
        : [...prev.selectedDisciplines, discId];
      return {
        ...prev,
        selectedDisciplines: next,
      };
    });
  };

  const handleAddDisciplineToWeekday = (dayKey: string, discId: string) => {
    if (!discId) return;
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const existing = prev.weeklySchedule[dayKey] || [];
      if (existing.includes(discId) || existing.length >= 6) return prev;
      return {
        ...prev,
        weeklySchedule: {
          ...prev.weeklySchedule,
          [dayKey]: [...existing, discId],
        },
      };
    });
    setAddDisciplineDay((prev) => ({ ...prev, [dayKey]: '' }));
  };

  const handleRemoveDisciplineFromWeekday = (dayKey: string, discId: string) => {
    setDraftPlan((prev) => {
      if (!prev) return prev;
      const existing = prev.weeklySchedule[dayKey] || [];
      const nextList = existing.filter((id) => id !== discId);
      const nextSchedule = { ...prev.weeklySchedule };
      if (nextList.length === 0) {
        delete nextSchedule[dayKey];
      } else {
        nextSchedule[dayKey] = nextList;
      }
      return {
        ...prev,
        weeklySchedule: nextSchedule,
      };
    });
  };

  const handleApplySuggestionToDraft = () => {
    if (!data || !draftPlan) return;
    const cloned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(data.suggestedDistribution.schedule)) {
      cloned[k] = [...v];
    }
    setDraftPlan({
      ...draftPlan,
      weeklySchedule: cloned,
    });
    showTransientNotice(
      'Sugestão carregada no rascunho. Revise ou ajuste livremente e clique em "Salvar distribuição" para confirmar.'
    );
  };

  // Explicit opt-in for browser notifications (NEVER called on mount)
  const handleRequestNotificationPermission = async () => {
    if (!notificationSupported || typeof window === 'undefined') return;
    try {
      const result = await window.Notification.requestPermission();
      setNotificationPermission(result);
      if (result === 'granted') {
        setDraftPlan((prev) =>
          prev
            ? {
                ...prev,
                reminders: {
                  ...prev.reminders,
                  enabled: true,
                  browserNotificationsEnabled: true,
                },
              }
            : prev
        );
        setReminderTestMessage(
          'Permissão concedida! Clique em "Salvar lembretes" para gravar sua preferência.'
        );
      } else {
        setReminderTestMessage(
          'Permissão não concedida no navegador. Você pode continuar usando o calendário e alterar isso nas configurações do navegador quando desejar.'
        );
      }
    } catch {
      setReminderTestMessage(
        'Não foi possível solicitar permissão de notificação neste navegador.'
      );
    }
  };

  const handleTestLocalNotification = () => {
    if (!notificationSupported || notificationPermission !== 'granted') return;
    try {
      new window.Notification('Aprova Direito · Lembrete de Estudo', {
        body: `Meta de hoje: ${data?.tracking.todayAnswered ?? 0}/${
          draftPlan?.dailyGoalQuestions ?? 20
        } questões respondidas. Bons estudos!`,
        icon: '/icons/icon-192.png',
      });
      setReminderTestMessage('Notificação local de teste disparada com sucesso.');
    } catch {
      setReminderTestMessage(
        'Este ambiente/navegador restringiu a exibição imediata da notificação local.'
      );
    }
  };

  // Activity mutations
  const handleCreateActivity = async (input: Parameters<typeof createStudyActivity>[0]) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await createStudyActivity(input);
      setData(res.report);
      showTransientNotice(
        input.status === 'completed'
          ? 'Estudo concluído registrado com sucesso.'
          : 'Atividade agendada no seu calendário.'
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao criar atividade.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateActivity = async (input: Parameters<typeof updateStudyActivity>[0]) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await updateStudyActivity(input);
      setData(res.report);
      showTransientNotice('Atividade reagendada com sucesso.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao reagendar atividade.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteActivity = async (input: Parameters<typeof completeStudyActivity>[0]) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await completeStudyActivity(input);
      setData(res.report);
      showTransientNotice('Atividade marcada como concluída e tempo real contabilizado.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao concluir atividade.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelActivity = async (activityId: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await cancelStudyActivity(activityId);
      setData(res.report);
      showTransientNotice('Atividade cancelada (mantida no histórico sem apagar dados).');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao cancelar atividade.');
    } finally {
      setSaving(false);
    }
  };

  const handleReopenActivity = async (activityId: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const res = await reopenStudyActivity(activityId);
      setData(res.report);
      showTransientNotice('Atividade reaberta como planejada.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Erro ao reabrir atividade.');
    } finally {
      setSaving(false);
    }
  };

  // Unauthenticated Visitor View
  if (!currentUser) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
                Plano de Estudos e Calendário
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Organize metas diárias e semanais, distribua disciplinas e registre suas horas reais de estudo.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-5">
          <div className="max-w-2xl space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[#9A7B16]">
              Rotina Personalizada na Nuvem
            </p>
            <h2 className="text-xl font-bold font-serif text-[#0B1F3A]">
              Entre na sua conta para criar seu Plano de Estudos
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Suas metas de questões, horas semanais, calendário de atividades e sequência de dias estudados ficam salvos com segurança na sua conta Firebase e integrados automaticamente ao seu histórico real de questões e simulados.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-5 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              <LogIn className="w-4 h-4 text-[#D4AF37]" />
              <span>Entrar na minha conta</span>
            </button>
            <button
              type="button"
              onClick={onGoToQuestions}
              className="px-5 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-[#0B1F3A] text-sm font-semibold transition-colors inline-flex items-center gap-2"
            >
              <span>Resolver questões</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Initial Loading Skeleton
  if (loading && !data) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="border-b border-slate-200 pb-5 space-y-2">
          <div className="h-7 w-72 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-4 w-96 max-w-full bg-slate-100 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse" />
              <div className="h-8 w-16 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-32 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-6 h-80 animate-pulse" />
      </div>
    );
  }

  // Server Unavailable / Error State (never invents data)
  if (errorMessage && !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div className="border-b border-slate-200 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
                Plano de Estudos e Calendário
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                Organize sua preparação para OAB e concursos jurídicos.
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
                  : 'Não foi possível carregar seu Plano de Estudos'}
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">{errorMessage}</p>
              <p className="text-xs text-slate-500">
                Suas metas, atividades e histórico de questões continuam preservados com segurança.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={loadStudyPlan}
              className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar novamente</span>
            </button>
            <button
              type="button"
              onClick={onGoToQuestions}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-[#0B1F3A] text-xs sm:text-sm font-semibold hover:bg-slate-50"
            >
              Ir para Questões
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !draftPlan) return null;

  const { tracking, suggestedDistribution } = data;
  const isPremium = data.isPremium;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0 mt-0.5">
            <CalendarDays className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A] leading-tight">
              Plano de Estudos e Calendário
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Rotina de {userProfile.name} · Foco: {userProfile.studyFocus} ·{' '}
              <span className="tabular-nums">
                {data.plan.isConfigured
                  ? `${data.plan.availableDays.length} dias/semana configurados`
                  : 'Planejamento inicial aguardando configuração'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadStudyPlan}
            disabled={loading || saving}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          <button
            type="button"
            onClick={onGoToPerformance}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-[#0B1F3A] transition-colors inline-flex items-center gap-1.5"
          >
            <BarChart3 className="w-3.5 h-3.5 text-[#9A7B16]" />
            <span>Relatório de Desempenho</span>
          </button>

          <button
            type="button"
            onClick={onGoToQuestions}
            className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
          >
            <span>Resolver questões</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#D4AF37]" />
          </button>
        </div>
      </header>

      {/* Feedback / Error Banners */}
      {feedbackNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{feedbackNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            aria-label="Fechar aviso"
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="font-semibold underline shrink-0"
          >
            Fechar
          </button>
        </div>
      )}

      {/* First-time Setup Prompt (when student has not saved a plan yet) */}
      {!data.plan.isConfigured && (
        <div className="p-4 sm:p-5 rounded-2xl bg-[#0B1F3A] text-white border border-[#D4AF37]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              Configure seu Plano de Estudos
            </p>
            <p className="text-sm font-semibold">
              Você ainda não personalizou suas metas semanais, horários e disciplinas prioritárias.
            </p>
            <p className="text-xs text-slate-300">
              Defina seus dias disponíveis e metas para organizar seu calendário e acompanhar seu ritmo real de aprovação.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('metas')}
            className="px-4 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#C39E2B] text-[#0B1F3A] text-xs font-bold transition-colors shrink-0 self-start sm:self-auto"
          >
            Personalizar metas agora
          </button>
        </div>
      )}

      {/* 4. ACOMPANHAMENTO DAS METAS (KPI Strip) */}
      <section aria-label="Acompanhamento de metas" className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Questões Hoje */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Questões hoje
            </span>
            <Target className="w-4 h-4 text-[#0B1F3A] shrink-0" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0B1F3A] tabular-nums">
              {tracking.todayAnswered}
              <span className="text-sm font-medium text-slate-400">
                /{tracking.dailyGoalQuestions}
              </span>
            </p>
            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
              <div
                className="h-full rounded-full bg-[#D4AF37]"
                style={{ width: `${tracking.dailyGoalPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 tabular-nums mt-1">
              {tracking.dailyGoalPercent}% da meta diária
            </p>
          </div>
        </div>

        {/* Questões na Semana */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Questões semana
            </span>
            <BarChart3 className="w-4 h-4 text-[#0B1F3A] shrink-0" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0B1F3A] tabular-nums">
              {tracking.weekAnswered}
              <span className="text-sm font-medium text-slate-400">
                /{tracking.weeklyGoalQuestions}
              </span>
            </p>
            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
              <div
                className="h-full rounded-full bg-[#0B1F3A]"
                style={{ width: `${tracking.weeklyQuestionsPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 tabular-nums mt-1">
              {tracking.weeklyQuestionsPercent}% da meta semanal
            </p>
          </div>
        </div>

        {/* Horas Registradas vs Planejadas */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Horas na semana
            </span>
            <Clock className="w-4 h-4 text-emerald-700 shrink-0" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-700 tabular-nums">
              {formatMinutesAsHours(tracking.weeklyTotalLoggedMinutes)}
            </p>
            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{ width: `${tracking.weeklyHoursPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 tabular-nums mt-1">
              Meta {data.plan.weeklyGoalHours}h · Plan. {formatMinutesAsHours(tracking.weeklyPlannedMinutes)}
            </p>
          </div>
        </div>

        {/* Atividades Planejadas & Concluídas */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between space-y-2.5">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Atividades (sem.)
            </span>
            <CheckCircle2 className="w-4 h-4 text-[#9A7B16] shrink-0" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#0B1F3A] tabular-nums">
              {tracking.weekActivitiesCompleted}
              <span className="text-sm font-medium text-slate-400">
                /{tracking.weekActivitiesPlanned}
              </span>
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums mt-2">
              {tracking.weekSimuladosCompleted}{' '}
              {tracking.weekSimuladosCompleted === 1 ? 'simulado' : 'simulados'} na semana
            </p>
            <p className="text-[11px] text-slate-400 tabular-nums">
              Total concluídas: {tracking.activitiesTotalCompleted}
            </p>
          </div>
        </div>

        {/* Sequência de Dias Reais */}
        <div className="bg-[#0B1F3A] text-white rounded-2xl border border-[#0B1F3A] p-4 flex flex-col justify-between space-y-2.5 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              Sequência ativa
            </span>
            <Flame className="w-4 h-4 text-[#D4AF37] shrink-0" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white tabular-nums">
              {tracking.currentStreakDays}{' '}
              <span className="text-sm font-normal text-slate-300">
                {tracking.currentStreakDays === 1 ? 'dia' : 'dias'}
              </span>
            </p>
            <p className="text-[11px] text-slate-300 tabular-nums mt-2">
              Recorde: {tracking.longestStreakDays}d · {tracking.activeDaysThisWeek}d esta semana
            </p>
            <p className="text-[11px] text-[#D4AF37] tabular-nums">
              {tracking.activeDaysThisMonth} dias ativos no mês
            </p>
          </div>
        </div>
      </section>

      {/* Section Navigation Tabs */}
      <div
        className="flex items-center gap-1 overflow-x-auto bg-white p-1.5 rounded-2xl border border-slate-200"
        role="tablist"
        aria-label="Seções do Plano de Estudos"
      >
        {(
          [
            { id: 'calendario', label: 'Calendário e Atividades', icon: CalendarDays },
            { id: 'metas', label: 'Metas e Preferências', icon: Sliders },
            { id: 'distribuicao', label: 'Distribuição Semanal', icon: LayoutGrid },
            { id: 'lembretes', label: 'Lembretes e Cumprimento', icon: Bell },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveSection(tab.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#0B1F3A] text-white'
                  : 'text-slate-600 hover:text-[#0B1F3A] hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[#D4AF37]' : ''}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SECTION 1: CALENDÁRIO E ATIVIDADES */}
      {activeSection === 'calendario' && (
        <StudyCalendarPanel
          todayDateKey={tracking.todayDateKey}
          activities={data.activities}
          calendarDays={tracking.calendarDays}
          weeklySchedule={data.plan.weeklySchedule}
          selectedDisciplines={data.plan.selectedDisciplines}
          busy={saving}
          onCreateActivity={handleCreateActivity}
          onUpdateActivity={handleUpdateActivity}
          onCompleteActivity={handleCompleteActivity}
          onCancelActivity={handleCancelActivity}
          onReopenActivity={handleReopenActivity}
        />
      )}

      {/* SECTION 2: METAS E PREFERÊNCIAS */}
      {activeSection === 'metas' && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold font-serif text-[#0B1F3A]">
                Metas e Preferências de Estudo
              </h2>
              <p className="text-xs text-slate-500">
                Defina sua carga diária, metas semanais, dias disponíveis, horários e disciplinas prioritárias.
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSavePlanDraft()}
              className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold transition-colors inline-flex items-center gap-2 self-start sm:self-auto disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>{saving ? 'Salvando...' : 'Salvar preferências'}</span>
            </button>
          </div>

          {/* Numeric Goals */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label
                htmlFor="goal-daily-q"
                className="block text-xs font-bold text-[#0B1F3A]"
              >
                Meta diária de questões
              </label>
              <input
                id="goal-daily-q"
                type="number"
                min={5}
                max={200}
                value={draftPlan.dailyGoalQuestions}
                onChange={(e) =>
                  setDraftPlan({
                    ...draftPlan,
                    dailyGoalQuestions: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 text-sm font-semibold border border-slate-300 bg-white rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              />
              <p className="text-[11px] text-slate-500">
                Sincronizada automaticamente com seu Perfil e Relatório de Desempenho.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label
                htmlFor="goal-weekly-q"
                className="block text-xs font-bold text-[#0B1F3A]"
              >
                Meta semanal de questões
              </label>
              <input
                id="goal-weekly-q"
                type="number"
                min={10}
                max={1400}
                value={draftPlan.weeklyGoalQuestions}
                onChange={(e) =>
                  setDraftPlan({
                    ...draftPlan,
                    weeklyGoalQuestions: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 text-sm font-semibold border border-slate-300 bg-white rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              />
              <p className="text-[11px] text-slate-500">
                Sugestão para {draftPlan.availableDays.length} dias:{' '}
                {draftPlan.dailyGoalQuestions * Math.max(1, draftPlan.availableDays.length)} questões.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
              <label
                htmlFor="goal-weekly-h"
                className="block text-xs font-bold text-[#0B1F3A]"
              >
                Meta semanal de horas de estudo
              </label>
              <input
                id="goal-weekly-h"
                type="number"
                step={0.5}
                min={1}
                max={80}
                value={draftPlan.weeklyGoalHours}
                onChange={(e) =>
                  setDraftPlan({
                    ...draftPlan,
                    weeklyGoalHours: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 text-sm font-semibold border border-slate-300 bg-white rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
              />
              <p className="text-[11px] text-slate-500">
                Média de{' '}
                {formatMinutesAsHours(
                  Math.round(
                    ((draftPlan.weeklyGoalHours || 1) * 60) /
                      Math.max(1, draftPlan.availableDays.length)
                  )
                )}{' '}
                por dia disponível.
              </p>
            </div>
          </div>

          {/* Available Days & Preferred Time Slots */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2.5">
              <p className="text-xs font-bold text-[#0B1F3A]">Dias da semana disponíveis</p>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {WEEKDAYS_LIST.map((day) => {
                  const selected = draftPlan.availableDays.includes(day.index);
                  return (
                    <button
                      key={day.index}
                      type="button"
                      onClick={() => handleToggleDay(day.index)}
                      aria-pressed={selected}
                      className={`py-2.5 px-2 rounded-xl border text-xs font-semibold transition-colors ${
                        selected
                          ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              <p className="text-xs font-bold text-[#0B1F3A]">Horários preferenciais</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {TIME_SLOTS_LIST.map((slot) => {
                  const selected = draftPlan.preferredTimeSlots.includes(slot.id);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => handleToggleTimeSlot(slot.id)}
                      aria-pressed={selected}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      <p className="text-xs font-bold">{slot.label}</p>
                      <p
                        className={`text-[10px] tabular-nums ${
                          selected ? 'text-[#D4AF37]' : 'text-slate-500'
                        }`}
                      >
                        {slot.range}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Disciplines Selector */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-[#0B1F3A]">
                  Disciplinas que você deseja estudar ({draftPlan.selectedDisciplines.length}{' '}
                  selecionadas)
                </p>
                <p className="text-[11px] text-slate-500">
                  As disciplinas marcadas alimentam sua distribuição semanal e os atalhos do calendário.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setDraftPlan({
                      ...draftPlan,
                      selectedDisciplines: OAB_DISCIPLINES.filter((d) => d.oabWeight >= 5).map(
                        (d) => d.id
                      ),
                    })
                  }
                  className="font-semibold text-[#0B1F3A] hover:text-[#9A7B16]"
                >
                  Principais da OAB
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() =>
                    setDraftPlan({
                      ...draftPlan,
                      selectedDisciplines: OAB_DISCIPLINES.map((d) => d.id),
                    })
                  }
                  className="font-semibold text-[#0B1F3A] hover:text-[#9A7B16]"
                >
                  Selecionar todas
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {OAB_DISCIPLINES.map((disc) => {
                const selected = draftPlan.selectedDisciplines.includes(disc.id);
                return (
                  <button
                    key={disc.id}
                    type="button"
                    onClick={() => handleToggleDiscipline(disc.id)}
                    aria-pressed={selected}
                    className={`px-3 py-2.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-2 ${
                      selected
                        ? 'bg-[#0B1F3A]/[0.05] border-[#0B1F3A] text-[#0B1F3A]'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{disc.name}</p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        Peso OAB: ~{disc.oabWeight} q.
                      </p>
                    </div>
                    {selected && <Check className="w-4 h-4 text-[#0B1F3A] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSavePlanDraft()}
              className="px-5 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold transition-colors inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4 text-[#D4AF37]" />
              <span>{saving ? 'Salvando no Firebase...' : 'Salvar Plano de Estudos'}</span>
            </button>
          </div>
        </section>
      )}

      {/* SECTION 3: DISTRIBUIÇÃO DAS DISCIPLINAS */}
      {activeSection === 'distribuicao' && (
        <div className="space-y-6">
          {/* Smart Weekly Suggestion Panel (NEVER auto-applied without user consent) */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#9A7B16] shrink-0" />
                  <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                    Sugestão Inteligente de Distribuição Semanal
                  </h2>
                  <span className="text-[11px] font-bold text-[#9A7B16]">
                    {isPremium ? 'Premium Liberado' : 'Recurso Premium'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                  {suggestedDistribution.summary} Seu planejamento atual nunca é alterado automaticamente sem a sua confirmação.
                </p>
              </div>

              {isPremium ? (
                <button
                  type="button"
                  onClick={handleApplySuggestionToDraft}
                  className="px-4 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#C39E2B] text-[#0B1F3A] text-xs font-bold transition-colors shrink-0 self-start"
                >
                  Carregar sugestão no meu rascunho
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenPremium}
                  className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-[#D4AF37] text-xs font-bold transition-colors inline-flex items-center gap-1.5 shrink-0 self-start"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Liberar distribuição automática no Premium</span>
                </button>
              )}
            </div>

            {suggestedDistribution.rationale.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                {suggestedDistribution.rationale.map((line, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-700"
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] text-slate-500 tabular-nums flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Ritmo sugerido por dia disponível:{' '}
                <strong className="text-[#0B1F3A]">
                  {formatMinutesAsHours(suggestedDistribution.recommendedDailyMinutes)}
                </strong>
              </span>
              <span>·</span>
              <span>
                Meta diária sugerida:{' '}
                <strong className="text-[#0B1F3A]">
                  {suggestedDistribution.recommendedDailyQuestions} questões
                </strong>
              </span>
            </div>
          </section>

          {/* Editable Weekly Discipline Grid (Open to Free & Premium) */}
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                  Sua Grade Semanal de Disciplinas
                </h2>
                <p className="text-xs text-slate-500">
                  Organize livremente quais disciplinas estudar em cada dia disponível da semana.
                </p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  handleSavePlanDraft(draftPlan, 'Distribuição semanal salva com sucesso.')
                }
                className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold transition-colors inline-flex items-center gap-2 self-start sm:self-auto disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span>{saving ? 'Salvando...' : 'Salvar distribuição'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {WEEKDAYS_LIST.filter((d) => draftPlan.availableDays.includes(d.index)).map(
                (day) => {
                  const dayKey = String(day.index);
                  const assigned = draftPlan.weeklySchedule[dayKey] || [];
                  const selectablePool =
                    draftPlan.selectedDisciplines.length > 0
                      ? OAB_DISCIPLINES.filter((d) =>
                          draftPlan.selectedDisciplines.includes(d.id)
                        )
                      : OAB_DISCIPLINES;

                  return (
                    <div
                      key={dayKey}
                      className="p-4 rounded-xl bg-slate-50/70 border border-slate-200 space-y-3 flex flex-col justify-between"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-[#0B1F3A]">{day.full}</h3>
                          <span className="text-[11px] text-slate-500 tabular-nums">
                            {assigned.length} {assigned.length === 1 ? 'matéria' : 'matérias'}
                          </span>
                        </div>

                        {assigned.length === 0 ? (
                          <p className="text-xs text-slate-500 py-2">
                            Nenhuma disciplina atribuída a este dia.
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {assigned.map((discId) => (
                              <li
                                key={discId}
                                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs"
                              >
                                <span className="font-semibold text-[#0B1F3A] truncate">
                                  {disciplineNameById.get(discId) || discId}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDisciplineFromWeekday(dayKey, discId)}
                                  aria-label={`Remover ${disciplineNameById.get(discId) || discId}`}
                                  className="text-slate-400 hover:text-rose-600 shrink-0"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 pt-2 border-t border-slate-200/70">
                        <select
                          aria-label={`Adicionar disciplina em ${day.full}`}
                          value={addDisciplineDay[dayKey] || ''}
                          onChange={(e) =>
                            setAddDisciplineDay((prev) => ({
                              ...prev,
                              [dayKey]: e.target.value,
                            }))
                          }
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                        >
                          <option value="">Adicionar disciplina...</option>
                          {selectablePool
                            .filter((d) => !assigned.includes(d.id))
                            .map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            handleAddDisciplineToWeekday(dayKey, addDisciplineDay[dayKey] || '')
                          }
                          disabled={!addDisciplineDay[dayKey]}
                          className="p-1.5 rounded-lg bg-[#0B1F3A] text-white disabled:opacity-40 hover:bg-[#132E54]"
                          aria-label="Incluir disciplina"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        </div>
      )}

      {/* SECTION 4: LEMBRETES E RELATÓRIO DE CUMPRIMENTO */}
      {activeSection === 'lembretes' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Lembretes de Estudo */}
          <section className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#9A7B16] shrink-0" />
                  <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                    Lembretes de Estudo
                  </h2>
                </div>
                <p className="text-xs text-slate-500">
                  Escolha se deseja receber avisos locais no navegador para manter sua rotina em dia.
                </p>
              </div>
            </div>

            {/* Toggle & Time */}
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <div>
                  <p className="text-xs font-bold text-[#0B1F3A]">
                    Ativar rotina de lembretes salvos
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Salva seu horário e dias de lembrete no seu perfil do Firebase.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draftPlan.reminders.enabled}
                  onChange={(e) =>
                    setDraftPlan({
                      ...draftPlan,
                      reminders: {
                        ...draftPlan.reminders,
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 accent-[#0B1F3A]"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="reminder-time"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Horário preferencial do lembrete
                  </label>
                  <input
                    id="reminder-time"
                    type="time"
                    value={draftPlan.reminders.time}
                    onChange={(e) =>
                      setDraftPlan({
                        ...draftPlan,
                        reminders: {
                          ...draftPlan.reminders,
                          time: e.target.value,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>

                <div>
                  <p className="block text-xs font-semibold text-slate-700 mb-1">
                    Status no navegador
                  </p>
                  <div className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-50 border border-slate-200 text-slate-700">
                    {!notificationSupported
                      ? 'Notificações não suportadas neste navegador'
                      : notificationPermission === 'granted'
                        ? 'Permissão concedida pelo aluno'
                        : notificationPermission === 'denied'
                          ? 'Bloqueadas nas configurações do navegador'
                          : 'Aguardando sua escolha (não solicitada)'}
                  </div>
                </div>
              </div>

              {/* Opt-in explanation box */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed">
                  <BellRing className="w-4 h-4 text-[#0B1F3A] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-[#0B1F3A]">
                      Por que pedimos sua autorização apenas se você clicar abaixo?
                    </p>
                    <p>
                      As notificações servem exclusivamente para lembrá-lo das suas metas e atividades agendadas no Aprova Direito. Nunca solicitamos permissão automaticamente sem sua escolha.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {notificationSupported && notificationPermission !== 'granted' && (
                    <button
                      type="button"
                      onClick={handleRequestNotificationPermission}
                      className="px-3.5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-semibold transition-colors"
                    >
                      Ativar notificações no navegador
                    </button>
                  )}

                  {notificationSupported && notificationPermission === 'granted' && (
                    <button
                      type="button"
                      onClick={handleTestLocalNotification}
                      className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#0B1F3A] text-xs font-semibold transition-colors"
                    >
                      Testar lembrete local agora
                    </button>
                  )}
                </div>

                {reminderTestMessage && (
                  <p className="text-xs font-medium text-[#0B1F3A]">{reminderTestMessage}</p>
                )}
              </div>

              {/* Transparent Technical Note on Background Web Push */}
              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2 leading-relaxed">
                <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{data.remindersCapabilities.pushLimitationNote}</span>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    handleSavePlanDraft(draftPlan, 'Preferências de lembretes salvas com sucesso.')
                  }
                  className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5 text-[#D4AF37]" />
                  <span>Salvar lembretes</span>
                </button>
              </div>
            </div>
          </section>

          {/* Relatório de Cumprimento: Planejado vs Registrado por Tipo de Estudo */}
          <section className="lg:col-span-6 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#0B1F3A] shrink-0" />
                  <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                    Cumprimento por Tipo de Estudo
                  </h2>
                </div>
                <p className="text-xs text-slate-500">
                  Comparativo transparente entre tempo planejado e tempo efetivamente registrado.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Planejado na semana
                </p>
                <p className="text-lg font-bold text-[#0B1F3A] tabular-nums mt-0.5">
                  {formatMinutesAsHours(tracking.weeklyPlannedMinutes)}
                </p>
                <p className="text-[11px] text-slate-500">atividades agendadas</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Efetivo registrado (sem.)
                </p>
                <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">
                  {formatMinutesAsHours(tracking.weeklyTotalLoggedMinutes)}
                </p>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {formatMinutesAsHours(tracking.weeklyLoggedActivityMinutes)} ativ. +{' '}
                  {formatMinutesAsHours(tracking.weeklySimuladosMinutes)} simulados
                </p>
              </div>
            </div>

            {isPremium ? (
              <div className="divide-y divide-slate-100">
                {tracking.byActivityType.map((row) => {
                  const pct =
                    row.plannedCount > 0
                      ? Math.round((row.completedCount / row.plannedCount) * 100)
                      : 0;
                  return (
                    <div key={row.type} className="py-3 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#0B1F3A]">{row.label}</span>
                        <span className="text-slate-600 tabular-nums">
                          {row.completedCount}/{row.plannedCount} concluídas ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#0B1F3A]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                        <span>Planejado: {formatMinutesAsHours(row.plannedMinutes)}</span>
                        <span className="text-emerald-700 font-semibold">
                          Registrado: {formatMinutesAsHours(row.loggedMinutes)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-[#0B1F3A]">
                  Análise detalhada por modalidade (Plano Premium)
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  No Plano Gratuito você acompanha suas metas diárias, calendário e horas registradas totais. No Plano Premium, desbloqueie o detalhamento completo de cumprimento por modalidade (revisão, apostila, questões, simulados e peças) e a distribuição semanal inteligente.
                </p>
                <button
                  type="button"
                  onClick={onOpenPremium}
                  className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-[#D4AF37] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Conhecer Plano Premium (R$ 29,90/mês)</span>
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
};
