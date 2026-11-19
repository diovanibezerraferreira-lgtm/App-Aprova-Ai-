import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Crown,
  CreditCard,
  Calendar,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RotateCcw,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Receipt,
  Lock,
  Sparkles,
} from 'lucide-react';
import { ActiveTab } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  fetchSubscriptionHistory,
  type SubscriptionHistoryResponse,
  type PaymentHistoryItem,
  type PaymentStatusTone,
} from '../services/asaasService';

interface SubscriptionHistoryViewProps {
  onSelectTab: (tab: ActiveTab) => void;
  onOpenAuth: () => void;
  onOpenPremium: () => void;
}

function formatDateBR(raw?: string | null): string {
  if (!raw) return 'Não registrada';
  const trimmed = raw.trim();
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateObj = ymdMatch
    ? new Date(`${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}T12:00:00-03:00`)
    : new Date(trimmed);

  if (Number.isNaN(dateObj.getTime())) return 'Não registrada';

  return dateObj.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

function getPaymentStatusBadge(tone: PaymentStatusTone, label: string) {
  switch (tone) {
    case 'confirmed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>{label}</span>
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>{label}</span>
        </span>
      );
    case 'overdue':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          <span>{label}</span>
        </span>
      );
    case 'refunded':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-300">
          <RotateCcw className="w-3.5 h-3.5 text-slate-600 shrink-0" />
          <span>{label}</span>
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          <XCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>{label}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          <span>{label}</span>
        </span>
      );
  }
}

export const SubscriptionHistoryView: React.FC<SubscriptionHistoryViewProps> = ({
  onSelectTab,
  onOpenAuth,
  onOpenPremium,
}) => {
  const { currentUser } = useAuth();
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<SubscriptionHistoryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const PAGE_SIZE = 10;

  const loadHistory = useCallback(
    async (targetPage: number) => {
      if (!currentUser) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const result = await fetchSubscriptionHistory(targetPage, PAGE_SIZE);
        setData(result);
        setPage(result.pagination.page);
      } catch (err: any) {
        setErrorMsg(
          err?.message || 'Não foi possível carregar os dados da sua assinatura no momento.'
        );
      } finally {
        setLoading(false);
      }
    },
    [currentUser]
  );

  useEffect(() => {
    if (currentUser) {
      loadHistory(1);
    } else {
      setData(null);
      setErrorMsg(null);
    }
  }, [currentUser, loadHistory]);

  if (!currentUser) {
    return (
      <div className="w-full max-w-xl mx-auto px-3 sm:px-4 py-12 sm:py-16 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] mx-auto shadow-lg">
          <Lock className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold font-serif text-[#0B1F3A]">Minha Assinatura</h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
            Faça login com sua conta Aprova Direito para consultar sua assinatura, validade do
            acesso Premium e histórico completo de pagamentos.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={onOpenAuth}
            className="w-full sm:w-auto px-6 py-2.5 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-xl shadow transition-colors"
          >
            Fazer Login ou Criar Conta
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('perfil')}
            className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
          >
            Voltar ao Perfil
          </button>
        </div>
      </div>
    );
  }

  const summary = data?.summary;
  const payments: PaymentHistoryItem[] = data?.payments || [];
  const pagination = data?.pagination;
  const plansCatalog = data?.plansCatalog || [
    {
      id: 'monthly',
      name: 'Plano Premium Mensal',
      price: 29.9,
      cycle: 'MONTHLY',
      installmentCount: null,
      installmentValue: null,
      billingLabel: 'R$ 29,90 / mês',
      checkoutEnabled: true,
    },
    {
      id: 'annual',
      name: 'Plano Premium Anual',
      price: 249.0,
      cycle: 'YEARLY',
      installmentCount: 12,
      installmentValue: 20.75,
      billingLabel: 'R$ 249,00 / ano (até 12x de R$ 20,75)',
      checkoutEnabled: false,
    },
  ];

  const renderPremiumSituationBadge = () => {
    if (!summary) return null;
    switch (summary.accessState) {
      case 'active_renewal':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Premium Ativo</span>
          </span>
        );
      case 'cancelled_active':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300">
            <Crown className="w-4 h-4 text-[#B89020] shrink-0" />
            <span>Premium Ativo (Renovação Cancelada)</span>
          </span>
        );
      case 'expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Premium Expirado</span>
          </span>
        );
      case 'overdue':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Pagamento em Atraso</span>
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Aguardando Pagamento</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
            <span>Plano Gratuito</span>
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fade-in">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="space-y-2 min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('perfil')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0B1F3A] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Voltar ao Perfil</span>
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
              <Crown className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
                Minha Assinatura
              </h1>
              <p className="text-xs text-slate-500 break-words">
                Detalhes da assinatura, validade do acesso Premium e histórico oficial de pagamentos.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => loadHistory(page)}
          disabled={loading}
          className="self-start sm:self-auto px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-[#0B1F3A] text-xs font-bold flex items-center gap-2 transition-colors shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar informações</span>
        </button>
      </div>

      {/* Request-level error */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-xs sm:text-sm">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => loadHistory(page)}
            className="self-start sm:self-auto px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold transition-colors shrink-0"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton */}
      {loading && !data && (
        <div className="space-y-4" aria-label="Carregando dados da assinatura">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-4 animate-pulse">
            <div className="h-5 w-48 bg-slate-200 rounded" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="h-16 bg-slate-100 rounded-xl" />
              <div className="h-16 bg-slate-100 rounded-xl" />
              <div className="h-16 bg-slate-100 rounded-xl" />
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 space-y-3 animate-pulse">
            <div className="h-5 w-56 bg-slate-200 rounded" />
            <div className="h-12 bg-slate-100 rounded-xl" />
            <div className="h-12 bg-slate-100 rounded-xl" />
          </div>
        </div>
      )}

      {/* Subscription Summary Card */}
      {summary && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="bg-[#0B1F3A] px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#D4AF37]">
                Situação da Conta
              </span>
              <h2 className="text-base sm:text-lg font-bold font-serif text-white">
                {summary.plan.name}
              </h2>
            </div>
            <div>{renderPremiumSituationBadge()}</div>
          </div>

          {/* Contextual explanatory banner for cancelled-with-active-access / expired / pending */}
          {summary.isCancelledWithActiveAccess && summary.premiumUntil && (
            <div className="px-5 sm:px-6 py-3.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
              <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Assinatura cancelada sem novas cobranças:</strong> sua renovação automática
                está desativada, mas seu acesso Premium já pago permanece liberado até{' '}
                <strong className="tabular-nums">{formatDateBR(summary.premiumUntil)}</strong>.
              </p>
            </div>
          )}

          {summary.accessState === 'expired' && (
            <div className="px-5 sm:px-6 py-3.5 bg-rose-50 border-b border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-950">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Período Premium encerrado</strong>
                  {summary.premiumUntil
                    ? ` em ${formatDateBR(summary.premiumUntil)}.`
                    : '.'}{' '}
                  Sua conta voltou ao plano gratuito até uma nova confirmação de assinatura.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenPremium}
                className="self-start sm:self-auto px-4 py-2 rounded-lg bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs transition-colors shrink-0"
              >
                Reativar Premium Mensal
              </button>
            </div>
          )}

          {(summary.accessState === 'pending' || summary.accessState === 'overdue') && (
            <div className="px-5 sm:px-6 py-3.5 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  {summary.accessState === 'overdue'
                    ? 'Há uma cobrança vencida aguardando regularização no Asaas.'
                    : 'Sua assinatura aguarda a confirmação do pagamento no Asaas para liberação do Premium.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenPremium}
                className="self-start sm:self-auto px-4 py-2 rounded-lg bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs transition-colors shrink-0"
              >
                Ver Detalhes do Checkout
              </button>
            </div>
          )}

          {/* Details Grid */}
          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Plano Contratado
              </span>
              <p className="text-sm font-bold text-[#0B1F3A]">{summary.plan.name}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Valor do Plano
              </span>
              <p className="text-sm font-bold text-[#0B1F3A] tabular-nums">
                {summary.plan.id === 'free'
                  ? 'Gratuito (R$ 0,00)'
                  : summary.plan.billingLabel}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Situação Atual do Premium
              </span>
              <p className="text-sm font-bold text-[#0B1F3A]">
                {summary.isPremium
                  ? summary.isCancelledWithActiveAccess
                    ? 'Ativo até o fim do período pago'
                    : 'Liberado e Ativo'
                  : summary.isExpired
                    ? 'Expirado'
                    : 'Inativo (Plano Gratuito)'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Data de Início</span>
              </span>
              <p className="text-sm font-bold text-slate-800 tabular-nums">
                {summary.startDate ? formatDateBR(summary.startDate) : 'Não registrada'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>Validade do Premium</span>
              </span>
              <p className="text-sm font-bold text-slate-800 tabular-nums">
                {summary.premiumUntil
                  ? formatDateBR(summary.premiumUntil)
                  : summary.isPremium
                    ? 'Ciclo vigente'
                    : 'Sem validade ativa'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Situação no Asaas
              </span>
              <p className="text-sm font-bold text-slate-800">
                {summary.asaasSubscriptionStatusLabel}
              </p>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Renovação da Assinatura
                </span>
                <p className="text-sm font-bold text-[#0B1F3A]">{summary.renewalLabel}</p>
              </div>
              {summary.nextDueDate && summary.renewalStatus === 'active' && (
                <div className="text-xs text-slate-600 tabular-nums">
                  Próximo vencimento previsto:{' '}
                  <strong className="text-slate-900">{formatDateBR(summary.nextDueDate)}</strong>
                </div>
              )}
              {summary.plan.id === 'free' && !summary.hasSubscriptionRecord && (
                <button
                  type="button"
                  onClick={onOpenPremium}
                  className="self-start sm:self-auto px-4 py-2 rounded-lg bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs transition-colors flex items-center gap-1.5"
                >
                  <Crown className="w-3.5 h-3.5 fill-current" />
                  <span>Assinar Premium (R$ 29,90/mês)</span>
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Payment History Section */}
      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="w-4.5 h-4.5 text-[#0B1F3A]" />
            <h2 className="text-base sm:text-lg font-bold font-serif text-[#0B1F3A]">
              Histórico de Pagamentos
            </h2>
          </div>
          {pagination && pagination.totalCount > 0 && (
            <span className="text-xs text-slate-500 tabular-nums">
              {pagination.totalCount}{' '}
              {pagination.totalCount === 1 ? 'registro encontrado' : 'registros encontrados'}
            </span>
          )}
        </div>

        {/* Asaas synchronization warning (never fabricates rows) */}
        {data && !data.asaasSynced && data.asaasError && (
          <div className="p-5 sm:p-6 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs sm:text-sm text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>{data.asaasError}</span>
            </div>
            <button
              type="button"
              onClick={() => loadHistory(page)}
              className="self-start sm:self-auto px-3.5 py-1.5 rounded-lg bg-[#0B1F3A] text-[#D4AF37] text-xs font-bold hover:bg-[#16365C] transition-colors shrink-0"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Empty state */}
        {data && data.asaasSynced && payments.length === 0 && (
          <div className="p-8 sm:p-10 text-center space-y-2">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <CreditCard className="w-5 h-5" />
            </div>
            <p className="text-sm font-semibold text-slate-800">
              Nenhum pagamento registrado até o momento
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Quando você realizar cobranças no Aprova Direito, a data, o valor, a forma de
              pagamento e o status oficial do Asaas aparecerão aqui.
            </p>
          </div>
        )}

        {/* Populated History: Desktop Table + Mobile Cards */}
        {payments.length > 0 && (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-6">Data</th>
                    <th className="py-3 px-4">Valor</th>
                    <th className="py-3 px-4">Forma de Pagamento</th>
                    <th className="py-3 px-4">Identificação</th>
                    <th className="py-3 px-6 text-right">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-6 font-medium text-slate-800 tabular-nums whitespace-nowrap">
                        {formatDateBR(payment.date)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-[#0B1F3A] tabular-nums whitespace-nowrap">
                        {formatCurrencyBRL(payment.value)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                        {payment.paymentMethodLabel}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-500">
                        {payment.id}
                      </td>
                      <td className="py-3.5 px-6 text-right whitespace-nowrap">
                        {getPaymentStatusBadge(payment.statusTone, payment.statusLabel)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {payments.map((payment) => (
                <div key={payment.id} className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[#0B1F3A] tabular-nums">
                      {formatCurrencyBRL(payment.value)}
                    </span>
                    {getPaymentStatusBadge(payment.statusTone, payment.statusLabel)}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>
                      <span className="text-[11px] text-slate-400 block">Data</span>
                      <span className="font-medium text-slate-800 tabular-nums">
                        {formatDateBR(payment.date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-400 block">Forma de Pagamento</span>
                      <span className="font-medium text-slate-800">
                        {payment.paymentMethodLabel}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono break-all">
                    ID: {payment.id}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination Bar */}
            {pagination && (pagination.totalPages > 1 || pagination.hasMore || page > 1) && (
              <div className="px-5 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={loading || page <= 1}
                  onClick={() => loadHistory(page - 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-[#0B1F3A] inline-flex items-center gap-1 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Anterior</span>
                </button>

                <span className="text-xs font-medium text-slate-600 tabular-nums">
                  Página {pagination.page}
                  {pagination.totalPages > 0 ? ` de ${pagination.totalPages}` : ''}
                </span>

                <button
                  type="button"
                  disabled={loading || !pagination.hasMore}
                  onClick={() => loadHistory(page + 1)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-semibold text-[#0B1F3A] inline-flex items-center gap-1 transition-colors"
                >
                  <span>Próxima</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Plans Catalog Structure (Monthly active + Annual prepared without checkout) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#D4AF37]" />
          <h2 className="text-sm sm:text-base font-bold font-serif text-[#0B1F3A]">
            Planos Disponíveis no Aprova Direito
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plansCatalog.map((planItem) => {
            const isCurrentUserPlan =
              summary?.isPremium && summary?.plan.id === planItem.id;
            return (
              <div
                key={planItem.id}
                className={`p-5 rounded-2xl border bg-white flex flex-col justify-between gap-4 ${
                  planItem.checkoutEnabled
                    ? 'border-[#D4AF37]/60'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#0B1F3A]">{planItem.name}</h3>
                    {isCurrentUserPlan ? (
                      <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-[#D4AF37]/25 text-[#0B1F3A]">
                        Seu plano atual
                      </span>
                    ) : !planItem.checkoutEnabled ? (
                      <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-200 text-slate-700">
                        Em breve
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700">
                        Disponível
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-bold text-[#0B1F3A] tabular-nums">
                    {formatCurrencyBRL(planItem.price)}
                    <span className="text-xs font-medium text-slate-500">
                      {planItem.cycle === 'YEARLY' ? ' / ano' : ' / mês'}
                    </span>
                  </p>
                  {planItem.installmentCount && planItem.installmentValue && (
                    <p className="text-xs text-slate-600 tabular-nums">
                      Em até {planItem.installmentCount}x de{' '}
                      <strong>{formatCurrencyBRL(planItem.installmentValue)}</strong>
                    </p>
                  )}
                </div>

                {planItem.checkoutEnabled ? (
                  summary?.accessState !== 'active_renewal' && (
                    <button
                      type="button"
                      onClick={onOpenPremium}
                      className="w-full py-2.5 px-4 rounded-lg bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Crown className="w-3.5 h-3.5 fill-current" />
                      <span>
                        {summary?.isCancelledWithActiveAccess
                          ? 'Contratar Nova Assinatura Mensal'
                          : 'Assinar Plano Mensal (R$ 29,90)'}
                      </span>
                    </button>
                  )
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Contratação do plano anual em preparação para os próximos ciclos.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
