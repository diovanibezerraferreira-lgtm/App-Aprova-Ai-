import React, { useState, useEffect } from 'react';
import {
  PerformanceEvolutionPoint,
  PerformanceEvolutionSeries,
} from '../services/contentService';
import { Calendar, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface PerformanceEvolutionChartProps {
  series: PerformanceEvolutionSeries;
  selectedPeriod: '7' | '30' | '90';
  onSelectPeriod: (period: '7' | '30' | '90') => void;
}

export const PerformanceEvolutionChart: React.FC<PerformanceEvolutionChartProps> = ({
  series,
  selectedPeriod,
  onSelectPeriod,
}) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    setActiveIndex(series.points.length > 0 ? series.points.length - 1 : null);
  }, [selectedPeriod, series.points.length]);

  const points = series.points;
  const maxAnswered = Math.max(1, ...points.map((p) => p.answered));

  // Chart SVG dimensions
  const width = 680;
  const height = 240;
  const padLeft = 42;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const getX = (index: number) => {
    if (points.length <= 1) return padLeft + plotW / 2;
    return padLeft + (index / (points.length - 1)) * plotW;
  };

  const getAccuracyY = (percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    return padTop + plotH - (clamped / 100) * plotH;
  };

  const getBarHeight = (answered: number) => {
    return Math.max(4, Math.round((answered / maxAnswered) * (plotH * 0.65)));
  };

  const barWidth =
    points.length > 0 ? Math.min(28, Math.max(8, Math.floor((plotW / Math.max(points.length, 4)) * 0.45))) : 16;

  const polylinePoints = points
    .map((pt, idx) => `${getX(idx).toFixed(1)},${getAccuracyY(pt.accuracyPercent).toFixed(1)}`)
    .join(' ');

  const areaPath =
    points.length >= 2
      ? `M ${getX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} ` +
        points
          .map((pt, idx) => `L ${getX(idx).toFixed(1)},${getAccuracyY(pt.accuracyPercent).toFixed(1)}`)
          .join(' ') +
        ` L ${getX(points.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
      : '';

  const activePoint: PerformanceEvolutionPoint | null =
    activeIndex !== null && points[activeIndex] ? points[activeIndex] : points[points.length - 1] || null;

  const labelStep = points.length <= 8 ? 1 : Math.ceil(points.length / 7);

  const comp = series.comparison;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
      {/* Header + Period Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[#0B1F3A] shrink-0" />
            <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
              Evolução do Desempenho
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            Percentual de acertos (linha) e volume de questões respondidas (barras) nos dias com atividade real.
          </p>
        </div>

        {/* Segmented Period Selector */}
        <div
          className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200 self-start sm:self-auto"
          role="tablist"
          aria-label="Período de evolução"
        >
          {(['7', '30', '90'] as const).map((period) => {
            const isSelected = selectedPeriod === period;
            return (
              <button
                key={period}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectPeriod(period)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#0B1F3A] text-white'
                    : 'text-slate-600 hover:text-[#0B1F3A]'
                }`}
              >
                {period} dias
              </button>
            );
          })}
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Questões nos últimos {series.periodDays} dias
          </p>
          <p className="text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
            {series.totalAnswered.toLocaleString('pt-BR')}
          </p>
          <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
            {series.activeDays} {series.activeDays === 1 ? 'dia ativo' : 'dias ativos'} no período
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Aproveitamento no período
          </p>
          <p className="text-xl font-bold text-[#0B1F3A] tabular-nums mt-1">
            {series.totalAnswered > 0 ? `${series.accuracyPercent}%` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
            {series.totalCorrect} acertos · {series.totalIncorrect} erros
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Comparação vs. {series.periodDays}d anteriores
          </p>
          {comp.hasEnoughData && comp.accuracyDelta !== null ? (
            <>
              <div className="flex items-center gap-1.5 mt-1">
                {comp.accuracyDelta > 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : comp.accuracyDelta < 0 ? (
                  <TrendingDown className="w-4 h-4 text-rose-700 shrink-0" />
                ) : (
                  <Minus className="w-4 h-4 text-slate-500 shrink-0" />
                )}
                <p
                  className={`text-xl font-bold tabular-nums ${
                    comp.accuracyDelta > 0
                      ? 'text-emerald-700'
                      : comp.accuracyDelta < 0
                        ? 'text-rose-700'
                        : 'text-slate-700'
                  }`}
                >
                  {comp.accuracyDelta > 0 ? `+${comp.accuracyDelta}` : comp.accuracyDelta} p.p.
                </p>
              </div>
              <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                Antes: {comp.previousAccuracy}% ({comp.previousCount} q.)
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-600 mt-1.5">Base em formação</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Mínimo de {comp.minRequiredPerPeriod} questões em cada período
              </p>
            </>
          )}
        </div>
      </div>

      {/* Chart Area or Insufficient History Message */}
      {!series.hasEnoughData ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 sm:p-8 text-center space-y-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0B1F3A]/5 text-[#0B1F3A] flex items-center justify-center mx-auto">
            <Calendar className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-[#0B1F3A]">
            Histórico insuficiente para o gráfico de {series.periodDays} dias
          </p>
          <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
            {series.insufficientReason}
          </p>
          {points.length === 1 && (
            <p className="text-xs font-medium text-slate-700 tabular-nums pt-1">
              Registro real em {points[0].label}: {points[0].answered}{' '}
              {points[0].answered === 1 ? 'questão' : 'questões'} ({points[0].accuracyPercent}% de acertos).
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Interactive Selected Point Detail Bar */}
          {activePoint && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#0B1F3A]/[0.03] border border-slate-200/80 text-xs">
              <div className="flex items-center gap-2 font-semibold text-[#0B1F3A] tabular-nums">
                <Calendar className="w-3.5 h-3.5 text-[#9A7B16] shrink-0" />
                <span>Dia {activePoint.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums text-slate-700">
                <span>
                  Aproveitamento:{' '}
                  <strong className="text-[#0B1F3A]">{activePoint.accuracyPercent}%</strong>
                </span>
                <span>
                  Questões: <strong className="text-[#0B1F3A]">{activePoint.answered}</strong>
                </span>
                <span className="text-emerald-700 font-medium">{activePoint.correct} acertos</span>
                <span className="text-rose-700 font-medium">{activePoint.incorrect} erros</span>
              </div>
            </div>
          )}

          {/* Responsive SVG Chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto min-w-[320px] select-none"
              role="img"
              aria-label={`Gráfico de evolução dos últimos ${series.periodDays} dias`}
            >
              <defs>
                <linearGradient id="aprovaAccuracyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0B1F3A" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="#0B1F3A" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {/* Horizontal grid lines (0%, 25%, 50%, 75%, 100%) */}
              {[0, 25, 50, 75, 100].map((tick) => {
                const y = getAccuracyY(tick);
                return (
                  <g key={tick}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={width - padRight}
                      y2={y}
                      stroke={tick === 50 ? '#D4AF37' : '#E2E8F0'}
                      strokeWidth={tick === 50 ? 1.2 : 1}
                      strokeDasharray={tick === 50 ? '4 4' : undefined}
                      opacity={tick === 50 ? 0.65 : 1}
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px]"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              {/* Volume bars (real answered count per active date) */}
              {points.map((pt, idx) => {
                const cx = getX(idx);
                const bh = getBarHeight(pt.answered);
                const isSelected = activePoint?.dateKey === pt.dateKey;
                return (
                  <rect
                    key={`bar-${pt.dateKey}`}
                    x={cx - barWidth / 2}
                    y={padTop + plotH - bh}
                    width={barWidth}
                    height={bh}
                    rx={3}
                    fill={isSelected ? '#D4AF37' : '#CBD5E1'}
                    opacity={isSelected ? 0.5 : 0.45}
                  />
                );
              })}

              {/* Area under accuracy line */}
              {areaPath && <path d={areaPath} fill="url(#aprovaAccuracyFill)" />}

              {/* Accuracy line */}
              <polyline
                fill="none"
                stroke="#0B1F3A"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={polylinePoints}
              />

              {/* Interactive points & date labels */}
              {points.map((pt, idx) => {
                const cx = getX(idx);
                const cy = getAccuracyY(pt.accuracyPercent);
                const isSelected = activePoint?.dateKey === pt.dateKey;
                const showLabel = idx % labelStep === 0 || idx === points.length - 1;

                return (
                  <g
                    key={pt.dateKey}
                    className="cursor-pointer"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => setActiveIndex(idx)}
                  >
                    {/* Invisible hit target */}
                    <rect
                      x={cx - 18}
                      y={padTop}
                      width={36}
                      height={plotH + 20}
                      fill="transparent"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isSelected ? 6 : 4}
                      fill={isSelected ? '#D4AF37' : '#0B1F3A'}
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                    {showLabel && (
                      <text
                        x={cx}
                        y={height - 10}
                        textAnchor="middle"
                        className={`text-[10px] ${
                          isSelected ? 'fill-[#0B1F3A] font-bold' : 'fill-slate-500'
                        }`}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {pt.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Clean Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-[#0B1F3A] inline-block" />
                Percentual de acertos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 inline-block" />
                Questões respondidas no dia
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 border-t border-dashed border-[#D4AF37] inline-block" />
                Referência 50% (OAB)
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Info className="w-3 h-3 shrink-0" />
              Exibe somente datas com respostas reais
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
