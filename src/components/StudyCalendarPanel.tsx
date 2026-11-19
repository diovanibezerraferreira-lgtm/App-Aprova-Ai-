import React, { useState, useMemo } from 'react';
import { OAB_DISCIPLINES } from '../data/disciplines';
import {
  StudyActivityItem,
  StudyActivityType,
  StudyCalendarDaySummary,
} from '../services/contentService';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarClock,
  RotateCcw,
  BookOpen,
  FileText,
  HelpCircle,
  Trophy,
  Scale,
  X,
} from 'lucide-react';

export type CalendarViewMode = 'day' | 'week' | 'month';

export const ACTIVITY_TYPE_META: Record<
  StudyActivityType,
  { label: string; shortLabel: string; icon: React.FC<{ className?: string }> }
> = {
  revisao: { label: 'Revisão de conteúdo', shortLabel: 'Revisão', icon: BookOpen },
  apostila: { label: 'Leitura de apostila', shortLabel: 'Apostila', icon: FileText },
  questoes: { label: 'Resolução de questões', shortLabel: 'Questões', icon: HelpCircle },
  simulado: { label: 'Simulado', shortLabel: 'Simulado', icon: Trophy },
  peca: { label: 'Estudo de peça processual', shortLabel: 'Peça', icon: Scale },
};

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAY_MON_FIRST = [
  { label: 'Seg', dayOfWeek: 1 },
  { label: 'Ter', dayOfWeek: 2 },
  { label: 'Qua', dayOfWeek: 3 },
  { label: 'Qui', dayOfWeek: 4 },
  { label: 'Sex', dayOfWeek: 5 },
  { label: 'Sáb', dayOfWeek: 6 },
  { label: 'Dom', dayOfWeek: 0 },
];

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function toDateKey(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateKey: string, delta: number): string {
  const dt = parseDateKey(dateKey);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return toDateKey(dt);
}

function getMondayOfWeek(dateKey: string): string {
  const dt = parseDateKey(dateKey);
  const wd = dt.getUTCDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return toDateKey(dt);
}

function formatDatePtBr(dateKey: string): string {
  const dt = parseDateKey(dateKey);
  const wd = WEEKDAY_SHORT[dt.getUTCDay()];
  const day = String(dt.getUTCDate()).padStart(2, '0');
  const month = MONTH_NAMES_PT[dt.getUTCMonth()];
  return `${wd}, ${day} de ${month}`;
}

function formatMinutesLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

interface StudyCalendarPanelProps {
  todayDateKey: string;
  activities: StudyActivityItem[];
  calendarDays: Record<string, StudyCalendarDaySummary>;
  weeklySchedule: Record<string, string[]>;
  selectedDisciplines: string[];
  busy: boolean;
  onCreateActivity: (input: {
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
  }) => Promise<void>;
  onUpdateActivity: (input: {
    activityId: string;
    date?: string;
    startTime?: string;
    plannedMinutes?: number;
    disciplineId?: string;
    subject?: string;
    type?: StudyActivityType;
    notes?: string;
    restorePlanned?: boolean;
  }) => Promise<void>;
  onCompleteActivity: (input: {
    activityId: string;
    actualMinutes: number;
    notes?: string;
  }) => Promise<void>;
  onCancelActivity: (activityId: string) => Promise<void>;
  onReopenActivity: (activityId: string) => Promise<void>;
}

export const StudyCalendarPanel: React.FC<StudyCalendarPanelProps> = ({
  todayDateKey,
  activities,
  calendarDays,
  weeklySchedule,
  selectedDisciplines,
  busy,
  onCreateActivity,
  onUpdateActivity,
  onCompleteActivity,
  onCancelActivity,
  onReopenActivity,
}) => {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [selectedDate, setSelectedDate] = useState<string>(todayDateKey);
  const [monthCursor, setMonthCursor] = useState<{ year: number; month: number }>(() => {
    const dt = parseDateKey(todayDateKey);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() };
  });

  // Create / direct study log modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [createAsCompleted, setCreateAsCompleted] = useState<boolean>(false);
  const [formType, setFormType] = useState<StudyActivityType>('questoes');
  const [formDisciplineId, setFormDisciplineId] = useState<string>(
    selectedDisciplines[0] || 'etica'
  );
  const [formSubject, setFormSubject] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(todayDateKey);
  const [formTime, setFormTime] = useState<string>('19:00');
  const [formPlannedMinutes, setFormPlannedMinutes] = useState<number>(45);
  const [formActualMinutes, setFormActualMinutes] = useState<number>(45);
  const [formNotes, setFormNotes] = useState<string>('');

  // Complete activity modal state
  const [completingActivity, setCompletingActivity] = useState<StudyActivityItem | null>(null);
  const [completeMinutesInput, setCompleteMinutesInput] = useState<number>(45);
  const [completeNotesInput, setCompleteNotesInput] = useState<string>('');

  // Reschedule modal state
  const [reschedulingActivity, setReschedulingActivity] = useState<StudyActivityItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(todayDateKey);
  const [rescheduleTime, setRescheduleTime] = useState<string>('19:00');
  const [reschedulePlanned, setReschedulePlanned] = useState<number>(45);

  const disciplineNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of OAB_DISCIPLINES) {
      map.set(d.id, d.name);
    }
    return map;
  }, []);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, StudyActivityItem[]>();
    for (const act of activities) {
      const list = map.get(act.date) || [];
      list.push(act);
      map.set(act.date, list);
    }
    return map;
  }, [activities]);

  // Week days for weekly view
  const weekDates = useMemo(() => {
    const monday = getMondayOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [selectedDate]);

  // Month grid cells (Monday-first 6 rows x 7 cols = 42 cells or 35 cells)
  const monthGridCells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1));
    const firstWeekday = firstOfMonth.getUTCDay(); // 0=Sun..6=Sat
    const leadingDays = firstWeekday === 0 ? 6 : firstWeekday - 1;
    const daysInMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month + 1, 0)).getUTCDate();
    const totalCells = leadingDays + daysInMonth > 35 ? 42 : 35;

    const cells: Array<{ dateKey: string; inCurrentMonth: boolean; dayNumber: number }> = [];
    for (let i = 0; i < totalCells; i++) {
      const dt = new Date(Date.UTC(monthCursor.year, monthCursor.month, 1 - leadingDays + i));
      cells.push({
        dateKey: toDateKey(dt),
        inCurrentMonth: dt.getUTCMonth() === monthCursor.month,
        dayNumber: dt.getUTCDate(),
      });
    }
    return cells;
  }, [monthCursor]);

  const openCreateModal = (asCompleted: boolean, dateOverride?: string) => {
    setCreateAsCompleted(asCompleted);
    setFormDate(dateOverride || selectedDate);
    setFormDisciplineId(selectedDisciplines[0] || 'etica');
    setFormSubject('');
    setFormNotes('');
    setFormPlannedMinutes(45);
    setFormActualMinutes(45);
    setShowCreateModal(true);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreateActivity({
      type: formType,
      disciplineId: formDisciplineId,
      subject: formSubject.trim(),
      date: formDate,
      startTime: formTime,
      plannedMinutes: Math.max(5, Math.min(600, Number(formPlannedMinutes) || 45)),
      actualMinutes: createAsCompleted
        ? Math.max(1, Math.min(600, Number(formActualMinutes) || 45))
        : undefined,
      status: createAsCompleted ? 'completed' : 'planned',
      notes: formNotes.trim(),
    });
    setSelectedDate(formDate);
    setShowCreateModal(false);
  };

  const openCompleteModal = (act: StudyActivityItem) => {
    setCompletingActivity(act);
    setCompleteMinutesInput(act.plannedMinutes || 45);
    setCompleteNotesInput(act.notes || '');
  };

  const handleSubmitComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingActivity) return;
    await onCompleteActivity({
      activityId: completingActivity.id,
      actualMinutes: Math.max(1, Math.min(600, Number(completeMinutesInput) || 30)),
      notes: completeNotesInput.trim(),
    });
    setCompletingActivity(null);
  };

  const openRescheduleModal = (act: StudyActivityItem) => {
    setReschedulingActivity(act);
    setRescheduleDate(act.date);
    setRescheduleTime(act.startTime || '19:00');
    setReschedulePlanned(act.plannedMinutes || 45);
  };

  const handleSubmitReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedulingActivity) return;
    await onUpdateActivity({
      activityId: reschedulingActivity.id,
      date: rescheduleDate,
      startTime: rescheduleTime,
      plannedMinutes: Math.max(5, Math.min(600, Number(reschedulePlanned) || 45)),
      restorePlanned: reschedulingActivity.status === 'cancelled',
    });
    setSelectedDate(rescheduleDate);
    setReschedulingActivity(null);
  };

  const handleNavigatePeriod = (direction: -1 | 1) => {
    if (viewMode === 'day') {
      setSelectedDate((prev) => addDays(prev, direction));
    } else if (viewMode === 'week') {
      setSelectedDate((prev) => addDays(prev, direction * 7));
    } else {
      setMonthCursor((prev) => {
        const dt = new Date(Date.UTC(prev.year, prev.month + direction, 1));
        return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() };
      });
    }
  };

  const handleJumpToday = () => {
    setSelectedDate(todayDateKey);
    const dt = parseDateKey(todayDateKey);
    setMonthCursor({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() });
  };

  const selectedDaySummary = calendarDays[selectedDate];
  const selectedDayActivities = activitiesByDate.get(selectedDate) || [];
  const selectedDayWeekday = String(parseDateKey(selectedDate).getUTCDay());
  const scheduledDisciplinesForDay = weeklySchedule[selectedDayWeekday] || [];

  return (
    <div className="space-y-5">
      {/* Calendar Header Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* View Mode Segmented Switcher */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200"
              role="tablist"
              aria-label="Visualização do calendário"
            >
              {(
                [
                  { id: 'day', label: 'Diária' },
                  { id: 'week', label: 'Semanal' },
                  { id: 'month', label: 'Mensal' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === tab.id}
                  onClick={() => setViewMode(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    viewMode === tab.id
                      ? 'bg-[#0B1F3A] text-white'
                      : 'text-slate-600 hover:text-[#0B1F3A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Period Navigation */}
            <div className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
              <button
                type="button"
                onClick={() => handleNavigatePeriod(-1)}
                aria-label="Período anterior"
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-[#0B1F3A] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleJumpToday}
                className="px-2.5 py-1 text-xs font-semibold text-[#0B1F3A] hover:text-[#9A7B16] transition-colors whitespace-nowrap"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => handleNavigatePeriod(1)}
                aria-label="Próximo período"
                className="p-1.5 rounded-lg hover:bg-white text-slate-600 hover:text-[#0B1F3A] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <span className="text-sm font-bold text-[#0B1F3A] tabular-nums">
              {viewMode === 'month'
                ? `${MONTH_NAMES_PT[monthCursor.month]} de ${monthCursor.year}`
                : viewMode === 'week'
                  ? `Semana de ${weekDates[0].split('-').reverse().slice(0, 2).join('/')} a ${weekDates[6]
                      .split('-')
                      .reverse()
                      .slice(0, 2)
                      .join('/')}`
                  : formatDatePtBr(selectedDate)}
            </span>
          </div>

          {/* Primary Actions: Plan Activity vs Log Completed Study */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => openCreateModal(false)}
              className="px-3.5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Plus className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Planejar atividade</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => openCreateModal(true)}
              className="px-3.5 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#C39E2B] text-[#0B1F3A] text-xs font-bold transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Registrar estudo concluído</span>
            </button>
          </div>
        </div>

        {/* WEEKLY VIEW GRID */}
        {viewMode === 'week' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5 pt-1">
            {weekDates.map((dateKey) => {
              const dt = parseDateKey(dateKey);
              const wdIndex = dt.getUTCDay();
              const isToday = dateKey === todayDateKey;
              const isSelected = dateKey === selectedDate;
              const daySum = calendarDays[dateKey];
              const dayActs = (activitiesByDate.get(dateKey) || []).filter(
                (a) => a.status !== 'cancelled'
              );
              const dayDisciplines = weeklySchedule[String(wdIndex)] || [];

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                  className={`text-left p-3 rounded-xl border transition-colors flex flex-col justify-between min-h-[126px] ${
                    isSelected
                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                      : isToday
                        ? 'bg-amber-50/60 border-[#D4AF37] text-[#0B1F3A]'
                        : 'bg-slate-50/70 hover:bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wider ${
                          isSelected ? 'text-[#D4AF37]' : 'text-slate-500'
                        }`}
                      >
                        {WEEKDAY_SHORT[wdIndex]}
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          isSelected ? 'text-white' : 'text-[#0B1F3A]'
                        }`}
                      >
                        {String(dt.getUTCDate()).padStart(2, '0')}
                      </span>
                    </div>

                    {dayDisciplines.length > 0 && (
                      <p
                        className={`text-[11px] leading-snug line-clamp-2 ${
                          isSelected ? 'text-slate-200' : 'text-slate-600'
                        }`}
                      >
                        {dayDisciplines
                          .map((id) => disciplineNameById.get(id) || id)
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  <div
                    className={`pt-2 mt-2 border-t text-[11px] tabular-nums space-y-0.5 ${
                      isSelected ? 'border-white/15 text-slate-200' : 'border-slate-200/80 text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span>Atividades</span>
                      <strong className={isSelected ? 'text-white' : 'text-[#0B1F3A]'}>
                        {dayActs.filter((a) => a.status === 'completed').length}/{dayActs.length}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span>Questões</span>
                      <strong className={isSelected ? 'text-[#D4AF37]' : 'text-emerald-700'}>
                        {daySum?.questionsAnswered || 0}
                      </strong>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* MONTHLY VIEW GRID */}
        {viewMode === 'month' && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-7 gap-1.5 text-center">
              {WEEKDAY_MON_FIRST.map((col) => (
                <div
                  key={col.label}
                  className="text-[11px] font-bold uppercase tracking-wider text-slate-500 py-1"
                >
                  {col.label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {monthGridCells.map((cell) => {
                const isToday = cell.dateKey === todayDateKey;
                const isSelected = cell.dateKey === selectedDate;
                const daySum = calendarDays[cell.dateKey];
                const hasReal = Boolean(daySum?.hasRealActivity);
                const plannedCount = daySum?.plannedActivities || 0;
                const completedCount = daySum?.completedActivities || 0;
                const questionsCount = daySum?.questionsAnswered || 0;

                return (
                  <button
                    key={cell.dateKey}
                    type="button"
                    onClick={() => setSelectedDate(cell.dateKey)}
                    className={`p-1.5 sm:p-2.5 rounded-xl border text-left transition-colors min-h-[64px] sm:min-h-[82px] flex flex-col justify-between ${
                      isSelected
                        ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                        : isToday
                          ? 'bg-amber-50/70 border-[#D4AF37] text-[#0B1F3A]'
                          : cell.inCurrentMonth
                            ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800'
                            : 'bg-slate-50/60 border-slate-100 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold tabular-nums">{cell.dayNumber}</span>
                      {hasReal && (
                        <CheckCircle2
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-[#D4AF37]' : 'text-emerald-600'
                          }`}
                          aria-label="Dia com atividade real registrada"
                        />
                      )}
                    </div>

                    <div
                      className={`text-[10px] leading-tight tabular-nums space-y-0.5 ${
                        isSelected ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      {questionsCount > 0 && (
                        <p className="truncate font-semibold">{questionsCount} q.</p>
                      )}
                      {plannedCount > 0 && (
                        <p className="truncate">
                          {completedCount}/{plannedCount} ativ.
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Dia com estudo real (questões, simulado ou atividade concluída)
              </span>
              <span>Clique em qualquer dia para ver ou agendar atividades.</span>
            </div>
          </div>
        )}
      </div>

      {/* SELECTED DAY DETAIL & ACTIVITIES LIST (Visible across Day, Week, and Month views) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#9A7B16] shrink-0" />
              <h3 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
                {formatDatePtBr(selectedDate)}
                {selectedDate === todayDateKey ? ' (Hoje)' : ''}
              </h3>
            </div>
            {scheduledDisciplinesForDay.length > 0 && (
              <p className="text-xs text-slate-600">
                Disciplinas previstas para este dia da semana:{' '}
                <strong className="text-[#0B1F3A]">
                  {scheduledDisciplinesForDay
                    .map((id) => disciplineNameById.get(id) || id)
                    .join(' · ')}
                </strong>
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => openCreateModal(false, selectedDate)}
            className="px-3.5 py-2 rounded-xl border border-slate-300 hover:border-[#0B1F3A] text-xs font-semibold text-[#0B1F3A] transition-colors self-start sm:self-auto inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar neste dia</span>
          </button>
        </div>

        {/* Selected Day Real Summary Strip: Planned vs Actually Recorded */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Questões reais no dia
            </p>
            <p className="text-lg font-bold text-[#0B1F3A] tabular-nums mt-0.5">
              {selectedDaySummary?.questionsAnswered || 0}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {selectedDaySummary?.questionsCorrect || 0} acertos
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Simulados no dia
            </p>
            <p className="text-lg font-bold text-[#0B1F3A] tabular-nums mt-0.5">
              {selectedDaySummary?.simuladosCompleted || 0}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {formatMinutesLabel(selectedDaySummary?.simuladosMinutes || 0)} registrados
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Tempo planejado
            </p>
            <p className="text-lg font-bold text-[#0B1F3A] tabular-nums mt-0.5">
              {formatMinutesLabel(selectedDaySummary?.plannedMinutes || 0)}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {selectedDaySummary?.plannedActivities || 0} atividade(s)
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Tempo efetivo registrado
            </p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums mt-0.5">
              {formatMinutesLabel(selectedDaySummary?.totalLoggedMinutes || 0)}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              {selectedDaySummary?.completedActivities || 0} concluída(s)
            </p>
          </div>
        </div>

        {/* Activities List for Selected Day */}
        {selectedDayActivities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center space-y-2">
            <p className="text-sm font-bold text-[#0B1F3A]">
              Nenhuma atividade agendada ou registrada para este dia
            </p>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Planeje uma revisão, leitura de apostila, bateria de questões, simulado ou peça processual — ou registre um estudo já concluído.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {selectedDayActivities.map((act) => {
              const typeMeta = ACTIVITY_TYPE_META[act.type] || ACTIVITY_TYPE_META.revisao;
              const TypeIcon = typeMeta.icon;
              const isCompleted = act.status === 'completed';
              const isCancelled = act.status === 'cancelled';

              return (
                <article
                  key={act.id}
                  className={`py-4 first:pt-1 last:pb-1 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    isCancelled ? 'opacity-65' : ''
                  }`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                      <span className="font-bold text-[#0B1F3A] tabular-nums">
                        {act.startTime}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        <TypeIcon className="w-3.5 h-3.5 text-[#9A7B16] shrink-0" />
                        <span>{typeMeta.label}</span>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span
                        className={`font-semibold inline-flex items-center gap-1 ${
                          isCompleted
                            ? 'text-emerald-700'
                            : isCancelled
                              ? 'text-slate-500'
                              : 'text-[#0B1F3A]'
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : isCancelled ? (
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>
                          {isCompleted
                            ? 'Concluída'
                            : isCancelled
                              ? 'Cancelada'
                              : 'Planejada'}
                        </span>
                      </span>
                    </div>

                    <h4
                      className={`text-sm font-bold text-[#0B1F3A] ${
                        isCancelled ? 'line-through text-slate-500' : ''
                      }`}
                    >
                      {act.disciplineName}
                      {act.subject ? ` — ${act.subject}` : ''}
                    </h4>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                      <span>
                        Tempo planejado: <strong>{formatMinutesLabel(act.plannedMinutes)}</strong>
                      </span>
                      {isCompleted && (
                        <span className="text-emerald-700">
                          Tempo registrado: <strong>{formatMinutesLabel(act.actualMinutes)}</strong>
                        </span>
                      )}
                    </div>

                    {act.notes && (
                      <p className="text-xs text-slate-500 leading-relaxed">{act.notes}</p>
                    )}
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {!isCompleted && !isCancelled && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openCompleteModal(act)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Concluir</span>
                      </button>
                    )}

                    {!isCompleted && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openRescheduleModal(act)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#0B1F3A] bg-white text-xs font-semibold text-[#0B1F3A] transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                        <span>{isCancelled ? 'Reagendar' : 'Reagendar'}</span>
                      </button>
                    )}

                    {!isCompleted && !isCancelled && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onCancelActivity(act.id)}
                        className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 transition-colors disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}

                    {isCompleted && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onReopenActivity(act.id)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reabrir</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL: CREATE PLANNED ACTIVITY OR LOG COMPLETED STUDY */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={createAsCompleted ? 'Registrar estudo concluído' : 'Nova atividade de estudo'}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold font-serif text-[#0B1F3A]">
                  {createAsCompleted ? 'Registrar Estudo Concluído' : 'Nova Atividade Planejada'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {createAsCompleted
                    ? 'Informe o tempo efetivamente dedicado para somar às suas horas reais.'
                    : 'Agende a atividade no calendário. Ela só será marcada como concluída quando você confirmar.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                aria-label="Fechar janela"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tipo de estudo
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as StudyActivityType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  >
                    {(Object.keys(ACTIVITY_TYPE_META) as StudyActivityType[]).map((key) => (
                      <option key={key} value={key}>
                        {ACTIVITY_TYPE_META[key].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Disciplina
                  </label>
                  <select
                    value={formDisciplineId}
                    onChange={(e) => setFormDisciplineId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  >
                    <option value="geral">Estudo Geral / Revisão Integrada</option>
                    {OAB_DISCIPLINES.map((disc) => (
                      <option key={disc.id} value={disc.id}>
                        {disc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assunto / tema específico
                </label>
                <input
                  type="text"
                  maxLength={140}
                  placeholder="Ex.: Prerrogativas do advogado, Controle de Constitucionalidade..."
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Data</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Horário</label>
                  <input
                    type="time"
                    required
                    value={formTime}
                    onChange={(e) => setFormTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {createAsCompleted ? 'Planejado (min)' : 'Duração estimada (min)'}
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    required
                    value={formPlannedMinutes}
                    onChange={(e) => setFormPlannedMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>
              </div>

              {createAsCompleted && (
                <div>
                  <label className="block text-xs font-semibold text-emerald-800 mb-1">
                    Tempo efetivamente dedicado (minutos)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    required
                    value={formActualMinutes}
                    onChange={(e) => setFormActualMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-emerald-300 bg-emerald-50/40 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Anotações (opcional)
                </label>
                <textarea
                  rows={2}
                  maxLength={600}
                  placeholder="Artigos revisados, páginas lidas ou observações..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  {createAsCompleted ? 'Registrar estudo' : 'Salvar no calendário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: COMPLETE ACTIVITY WITH ACTUAL TIME */}
      {completingActivity && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Concluir atividade de estudo"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold font-serif text-[#0B1F3A]">
                  Concluir Atividade
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {completingActivity.disciplineName}
                  {completingActivity.subject ? ` — ${completingActivity.subject}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCompletingActivity(null)}
                aria-label="Fechar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitComplete} className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 tabular-nums">
                Tempo planejado originalmente:{' '}
                <strong className="text-[#0B1F3A]">
                  {formatMinutesLabel(completingActivity.plannedMinutes)}
                </strong>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tempo efetivamente dedicado (em minutos)
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  required
                  value={completeMinutesInput}
                  onChange={(e) => setCompleteMinutesInput(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Resumo / observações (opcional)
                </label>
                <textarea
                  rows={2}
                  maxLength={600}
                  value={completeNotesInput}
                  onChange={(e) => setCompleteNotesInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCompletingActivity(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  Confirmar conclusão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESCHEDULE ACTIVITY */}
      {reschedulingActivity && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Reagendar atividade"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold font-serif text-[#0B1F3A]">
                  Reagendar Atividade
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {reschedulingActivity.disciplineName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReschedulingActivity(null)}
                aria-label="Fechar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitReschedule} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nova data
                  </label>
                  <input
                    type="date"
                    required
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Novo horário
                  </label>
                  <input
                    type="time"
                    required
                    value={rescheduleTime}
                    onChange={(e) => setRescheduleTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Duração planejada (minutos)
                </label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  required
                  value={reschedulePlanned}
                  onChange={(e) => setReschedulePlanned(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl tabular-nums focus:outline-none focus:ring-2 focus:ring-[#0B1F3A]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReschedulingActivity(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-white text-xs font-bold transition-colors disabled:opacity-50"
                >
                  Salvar reagendamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
