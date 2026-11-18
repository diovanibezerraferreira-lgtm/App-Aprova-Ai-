import React from 'react';
import {
  Crown,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  QrCode,
  RefreshCw,
  AlertCircle,
  Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchSubscriptionStatus } from '../services/asaasService';
import { TOTAL_LEGAL_BRIEFS_COUNT } from '../data/legalBriefs';
import { TOTAL_QUESTIONS_COUNT } from '../data/questions';
import { TOTAL_STUDY_MATERIALS_COUNT } from '../data/studyMaterials';

interface PremiumViewProps {
  onOpenPremiumModal: () => void;
  onGoToQuestions: () => void;
}

export const PremiumView: React.FC<PremiumViewProps> = ({
  onOpenPremiumModal,
  onGoToQuestions
}) => {
  const { currentUser, userProfile, isPremiumActive } = useAuth();
  const [checking, setChecking] = React.useState(false);
  const [statusFeedback, setStatusFeedback] = React.useState<string | null>(null);

  const subStatus = userProfile?.subscriptionStatus || 'NONE';

  const handleRefreshStatus = async () => {
    if (!currentUser) return;
    setChecking(true);
    setStatusFeedback(null);
    try {
      const res = await fetchSubscriptionStatus();
      if (res.isPremium && res.subscriptionStatus === 'CANCELLED' && res.premiumUntil) {
        const untilStr = new Date(res.premiumUntil).toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        });
        setStatusFeedback(
          `Assinatura cancelada (sem novas cobranças), com acesso Premium ativo até ${untilStr}.`
        );
      } else if (res.isPremium) {
        setStatusFeedback('Assinatura confirmada pelo Asaas! Todos os recursos Premium estão ativos.');
      } else if (res.subscriptionStatus === 'PENDING') {
        setStatusFeedback('Pagamento pendente de confirmação bancária no Asaas.');
      } else if (res.subscriptionStatus === 'OVERDUE') {
        setStatusFeedback('Fatura em atraso. Clique em regularizar para gerar nova cobrança.');
      } else {
        setStatusFeedback('Nenhuma assinatura ativa localizada até o momento.');
      }
    } catch (err: any) {
      setStatusFeedback(err.message || 'Erro ao consultar status da assinatura.');
    } finally {
      setChecking(false);
    }
  };

  const comparisonItems = [
    {
      feature: 'Banco de Questões Didáticas',
      free: 'Até 10 questões por dia distribuídas entre as disciplinas',
      premium: `Acesso completo e ilimitado às ${TOTAL_QUESTIONS_COUNT.toLocaleString('pt-BR')} questões com filtro anti-repetição`
    },
    {
      feature: 'Comentários & Fundamentação Legal',
      free: 'Incluso nas 10 questões diárias gratuitas',
      premium: 'Ilimitado com artigos de lei e súmulas dos Tribunais'
    },
    {
      feature: 'Simulados Cronometrados FGV',
      free: '1 Simulado Express gratuito por dia',
      premium: '40 modalidades ilimitadas (OAB 80Q, Concursos e Customizados)'
    },
    {
      feature: 'Laboratório de Peças Processuais (2ª Fase)',
      free: '2 peças completas (Resposta à Acusação e Reclamação Trabalhista)',
      premium: `Todas as ${TOTAL_LEGAL_BRIEFS_COUNT} peças completas com casos práticos e esqueletos`
    },
    {
      feature: 'Biblioteca de Apostilas & Manuais',
      free: '3 apostilas com 1º capítulo liberado (Ética, Constitucional e Civil)',
      premium: `Todos os ${TOTAL_STUDY_MATERIALS_COUNT} manuais 50+ páginas e apostilas desbloqueados`
    },
    {
      feature: 'Painel de Desempenho & Métricas',
      free: 'Estatísticas básicas de treino',
      premium: 'Diagnóstico completo de pontos fracos e histórico na nuvem'
    },
    {
      feature: 'Formas de Pagamento & Segurança',
      free: 'Não aplicável',
      premium: 'Cartão de Crédito Recorrente ou Pix via Asaas (sem fidelidade)'
    }
  ];

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-10 sm:space-y-12">

      {/* Hero Pricing Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-bold uppercase tracking-wider max-w-full">
          <Crown className="w-4 h-4 shrink-0" />
          <span className="truncate">Aceleração para OAB & Concursos</span>
        </div>

        <h1 className="text-2xl sm:text-5xl font-bold font-serif text-[#0B1F3A] break-words">
          Invista na sua aprovação com o <span className="text-[#D4AF37]">Plano Premium</span>
        </h1>

        <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto break-words">
          Tenha acesso irrestrito ao maior acervo didático focado na 1ª e 2ª fase do Exame de Ordem e carreiras jurídicas por R$ 29,90/mês, com pagamento seguro via Cartão de Crédito recorrente ou Pix.
        </p>
      </div>

      {/* Active / Pending / Overdue Subscription Banner */}
      {currentUser && (isPremiumActive || subStatus === 'PENDING' || subStatus === 'OVERDUE') && (
        <div
          className={`max-w-4xl mx-auto rounded-2xl border p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0 ${
            isPremiumActive
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : subStatus === 'OVERDUE'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            {isPremiumActive ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : subStatus === 'OVERDUE' ? (
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5 min-w-0">
              <p className="font-bold text-sm">
                {isPremiumActive
                  ? subStatus === 'CANCELLED'
                    ? 'Plano Premium Ativo (Cancelamento Programado)'
                    : 'Seu Plano Premium está Ativo!'
                  : subStatus === 'OVERDUE'
                  ? 'Assinatura com Pagamento em Atraso'
                  : 'Assinatura Aguardando Confirmação de Pagamento'}
              </p>
              <p className="text-xs opacity-90 break-words [overflow-wrap:anywhere]">
                {isPremiumActive
                  ? subStatus === 'CANCELLED' && userProfile?.premiumUntil
                    ? `Conta vinculada: ${currentUser.email} · Acesso Premium pago válido até: ${new Date(
                        userProfile.premiumUntil
                      ).toLocaleDateString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                      })} (sem novas cobranças)`
                    : `Conta vinculada: ${currentUser.email}${
                        userProfile?.premiumUntil
                          ? ` · Válido até: ${new Date(userProfile.premiumUntil).toLocaleDateString('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                            })}`
                          : userProfile?.subscriptionDueDate
                          ? ` · Próximo vencimento: ${new Date(userProfile.subscriptionDueDate).toLocaleDateString('pt-BR')}`
                          : ''
                      }`
                  : 'A liberação ocorre automaticamente assim que o Asaas confirmar a compensação via webhook.'}
              </p>
              {statusFeedback && <p className="text-xs font-semibold pt-1 break-words">{statusFeedback}</p>}
            </div>
          </div>

          <button
            onClick={handleRefreshStatus}
            disabled={checking}
            className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-xl shadow-sm flex items-center justify-center gap-1.5 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? 'Consultando...' : 'Atualizar Status'}</span>
          </button>
        </div>
      )}

      {/* Main Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-4xl mx-auto items-stretch">

        {/* Gratuito */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-8 shadow-sm flex flex-col justify-between min-w-0">
          <div className="space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Plano de Entrada
            </span>
            <h2 className="text-2xl font-bold font-serif text-slate-900">
              Gratuito
            </h2>
            <div className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              R$ 0
              <span className="text-xs font-normal text-slate-500 ml-1">/ para sempre</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Ideal para quem quer experimentar a metodologia e treinar questões pontuais.
            </p>

            <ul className="space-y-3 pt-4 border-t border-slate-100 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Até <strong>10 questões por dia</strong> entre as disciplinas</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>1 Simulado Express</strong> gratuito por dia</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>2 peças completas</strong> (Resposta à Acusação e Reclamação Trabalhista)</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>3 apostilas</strong> com 1º capítulo liberado (Ética, Constitucional e Civil)</span>
              </li>
            </ul>
          </div>

          <div className="pt-8">
            <button
              onClick={onGoToQuestions}
              className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors"
            >
              Estudar Gratuitamente
            </button>
          </div>
        </div>

        {/* Premium R$ 29,90 */}
        <div className="bg-white rounded-3xl border-2 border-[#D4AF37] p-5 sm:p-8 shadow-2xl relative flex flex-col justify-between overflow-hidden min-w-0">
          <div className="absolute top-0 right-0 bg-[#D4AF37] text-[#0B1F3A] text-[10px] font-extrabold uppercase tracking-widest px-3 sm:px-4 py-1 rounded-bl-xl shadow">
            {isPremiumActive ? 'Plano Atual' : 'Mais Escolhido'}
          </div>

          <div className="space-y-4 pt-3 sm:pt-0">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-[#D4AF37] shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                Acesso Total Ilimitado
              </span>
            </div>
            <h2 className="text-2xl font-bold font-serif text-[#0B1F3A]">
              Premium Aprova Direito
            </h2>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-extrabold text-[#0B1F3A]">R$ 29,90</span>
              <span className="text-xs font-medium text-slate-500">/ mês</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Tudo o que você precisa em uma única assinatura mensal simples, transparente e sem fidelidade.
            </p>

            <ul className="space-y-3 pt-4 border-t border-slate-100 text-xs text-slate-800 font-medium">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Acesso completo às {TOTAL_QUESTIONS_COUNT.toLocaleString('pt-BR')} questões com filtro anti-repetição</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Simulados ilimitados com cronômetro oficial FGV</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Laboratório de 2ª fase completo com todas as {TOTAL_LEGAL_BRIEFS_COUNT} peças processuais</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Biblioteca completa com todos os {TOTAL_STUDY_MATERIALS_COUNT} manuais e apostilas</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Gráficos de evolução analítica por disciplina</span>
              </li>
            </ul>

            {/* Payment methods highlight */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-2 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-semibold">
                <CreditCard className="w-3.5 h-3.5 text-[#0B1F3A]" />
                Cartão Recorrente
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 font-semibold">
                <QrCode className="w-3.5 h-3.5 text-[#0B1F3A]" />
                Pix
              </span>
            </div>
          </div>

          <div className="pt-8">
            <button
              onClick={onOpenPremiumModal}
              className="w-full py-3.5 px-4 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-xl shadow-lg shadow-[#0B1F3A]/20 transition-all flex items-center justify-center gap-2"
            >
              <Crown className="w-4 h-4 shrink-0" />
              <span>
                {isPremiumActive
                  ? 'Gerenciar / Ver Detalhes da Assinatura'
                  : 'Assinar Premium (R$ 29,90/mês)'}
              </span>
            </button>
            <p className="text-[10px] text-center text-slate-400 mt-2 flex flex-wrap items-center justify-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600 shrink-0" />
              <span>Pagamento seguro via Asaas · Cancelamento a qualquer momento</span>
            </p>
          </div>
        </div>

      </div>

      {/* Comparison Table */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-8 shadow-sm space-y-6 min-w-0">
        <h2 className="text-xl font-bold font-serif text-[#0B1F3A] text-center">
          Comparativo Completo de Recursos
        </h2>

        {/* Mobile stacked comparison cards */}
        <div className="space-y-3 md:hidden">
          {comparisonItems.map((item, idx) => (
            <div key={idx} className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-2 min-w-0">
              <h3 className="text-xs font-bold text-[#0B1F3A] break-words">{item.feature}</h3>
              <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                <div className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 break-words">
                  <span className="font-semibold text-slate-500 block">Plano Gratuito</span>
                  <span>{item.free}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#0B1F3A] font-semibold break-words">
                  <span className="text-[10px] uppercase tracking-wider text-[#0B1F3A]/80 font-bold block">
                    Plano Premium
                  </span>
                  <span>{item.premium}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Tablet/Desktop Table */}
        <div className="hidden md:block w-full max-w-full overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="border-b border-slate-200 text-slate-600 uppercase font-semibold">
              <tr>
                <th className="py-3 px-4">Recurso / Ferramenta</th>
                <th className="py-3 px-4 text-center">Plano Gratuito</th>
                <th className="py-3 px-4 text-center text-[#0B1F3A] font-bold bg-[#D4AF37]/10 rounded-t-lg">
                  Plano Premium
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {comparisonItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">{item.feature}</td>
                  <td className="py-3.5 px-4 text-center text-slate-500">{item.free}</td>
                  <td className="py-3.5 px-4 text-center font-bold text-[#0B1F3A] bg-[#D4AF37]/5">
                    {item.premium}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
