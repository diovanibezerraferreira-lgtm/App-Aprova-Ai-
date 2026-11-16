import React from 'react';
import { ActiveTab, Discipline, UserProfile } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import { LEGAL_BRIEFS } from '../data/legalBriefs';
import {
  Scale,
  Award,
  BookOpen,
  Clock,
  FileCheck,
  BarChart3,
  CheckCircle2,
  Crown,
  ArrowRight,
  ShieldAlert,
  Sparkles,
  Users,
  ChevronRight,
  GraduationCap,
  Smartphone
} from 'lucide-react';
import { PWAInstallButton } from '../components/PWAInstallBanner';

interface HomeViewProps {
  onSelectTab: (tab: ActiveTab) => void;
  onSelectDiscipline: (discipline: Discipline) => void;
  onOpenAuth: () => void;
  onOpenPremium: () => void;
  userProfile: UserProfile;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectTab,
  onSelectDiscipline,
  onOpenAuth,
  onOpenPremium,
  userProfile
}) => {
  const benefits = [
    {
      icon: CheckCircle2,
      title: 'Questões Comentadas Fundamentadas',
      description: 'Cada alternativa comentada com citação direta dos artigos da CF/88, Códigos e súmulas dos Tribunais Superiores.'
    },
    {
      icon: Clock,
      title: 'Simulados Cronometrados FGV',
      description: 'Treine a gestão de tempo em ambiente realista com cronômetro regressivo, diagnóstico de acertos e revisão dos erros.'
    },
    {
      icon: FileCheck,
      title: 'Laboratório de Peças Processuais (2ª Fase)',
      description: `${LEGAL_BRIEFS.length} peças fundamentais das 7 áreas da 2ª fase com análise de competência, prazos, estrutura passo a passo e modelos completos.`
    },
    {
      icon: BookOpen,
      title: 'Apostilas Didáticas Integradas',
      description: 'Leitor interno com resumos doutrinários diretos ao ponto, sem necessidade de downloads externos ou links quebrados.'
    },
    {
      icon: BarChart3,
      title: 'Métricas Reais de Desempenho',
      description: 'Controle sua taxa de acerto por matéria, acompanhe o histórico de evolução e defina sua meta diária de estudos.'
    },
    {
      icon: Award,
      title: 'Foco no Raio-X da FGV',
      description: 'Destaque especial para as 20 disciplinas da 1ª Fase OAB, priorizando matérias estratégicas como Ética e Constitucional.'
    },
    {
      icon: Smartphone,
      title: 'Aplicativo PWA (Android & iPhone)',
      description: 'Instale o app direto no seu celular com ícone na tela inicial, abertura em tela cheia e acesso ultrarrápido com cache inteligente.'
    }
  ];

  return (
    <div className="w-full overflow-x-clip space-y-12 sm:space-y-16 pb-12">
      
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-[#0B1F3A] text-white">
        {/* Background Image with Measured Scrim */}
        <div className="absolute inset-0 z-0 opacity-25 mix-blend-luminosity">
          <img
            src="/src/assets/images/legal_study_hero_1793818915779.jpg"
            alt="Ambiente de estudos jurídicos e advocacia"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center"
          />
        </div>
        <div className="absolute inset-0 z-0 bg-gradient-to-r from-[#071527] via-[#0B1F3A]/90 to-[#0B1F3A]/70" />

        <div className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-12 sm:py-24">
          <div className="max-w-3xl space-y-6 min-w-0">
            
            {/* Tagline kicker */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 text-[#D4AF37] text-[11px] sm:text-xs font-semibold tracking-wide uppercase max-w-full">
              <Scale className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Plataforma Oficial de Estudos · OAB & Concursos</span>
            </div>

            {/* Main Headline requested */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-bold font-serif tracking-tight text-white leading-tight break-words">
              Sua aprovação começa com a <span className="text-[#D4AF37]">preparação de hoje</span>
            </h1>

            {/* Subtitle */}
            <p className="text-sm sm:text-lg text-slate-300 leading-relaxed max-w-2xl break-words">
              Domine as 20 disciplinas da 1ª Fase da OAB e carreiras jurídicas com questões didáticas comentadas, simulados com cronômetro e laboratório prático de peças processuais de 2ª Fase.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 pt-2">
              <button
                onClick={() => onSelectTab('questoes')}
                className="w-full sm:w-auto px-5 sm:px-6 py-3 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-bold text-sm rounded-xl shadow-lg shadow-[#D4AF37]/20 transition-all flex items-center justify-center gap-2 group"
              >
                <span>Resolver Questões Agora</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>

              <button
                onClick={() => onSelectTab('simulados')}
                className="w-full sm:w-auto px-5 sm:px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-sm rounded-xl border border-white/20 transition-colors flex items-center justify-center gap-2"
              >
                <Clock className="w-4 h-4 text-[#D4AF37]" />
                <span>Iniciar Simulado</span>
              </button>

              <PWAInstallButton variant="hero" />

              {!userProfile.isRegistered ? (
                <button
                  onClick={onOpenAuth}
                  className="px-3 sm:px-5 py-2.5 text-slate-200 hover:text-white font-medium text-sm transition-colors underline underline-offset-4"
                >
                  Entrar ou Criar conta
                </button>
              ) : (
                <span className="text-xs text-slate-300 flex items-center gap-1.5 px-3 py-2 bg-white/5 rounded-lg border border-white/10 max-w-full min-w-0">
                  <GraduationCap className="w-4 h-4 text-[#D4AF37] shrink-0" />
                  <span className="truncate">Bem-vindo(a), {userProfile.name}</span>
                </span>
              )}
            </div>

            {/* Quick Proof metrics strip */}
            <div className="pt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 border-t border-white/10 text-xs text-slate-300 max-w-2xl">
              <div className="min-w-0">
                <span className="block text-lg sm:text-xl font-bold text-[#D4AF37] tabular-nums">800+</span>
                <span className="text-slate-400">Questões Comentadas</span>
              </div>
              <div className="min-w-0">
                <span className="block text-lg sm:text-xl font-bold text-white tabular-nums">50+ Págs</span>
                <span className="text-slate-400">Manuais & Apostilas</span>
              </div>
              <div className="min-w-0">
                <span className="block text-lg sm:text-xl font-bold text-white tabular-nums">32+</span>
                <span className="text-slate-400">Simulados & Concursos</span>
              </div>
              <div className="min-w-0">
                <span className="block text-lg sm:text-xl font-bold text-[#D4AF37] tabular-nums">80Q / 5h</span>
                <span className="text-slate-400">Simulador Oficial FGV</span>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Main Container */}
      <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-12 sm:space-y-16">

        {/* Benefits Section */}
        <section className="space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
              Metodologia de Alta Performance
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
              Tudo o que você precisa para ser Aprovado
            </h2>
            <p className="text-sm text-slate-600">
              Desenvolvido estrategicamente com foco no modelo de cobrança da FGV e dos principais certames jurídicos do país.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {benefits.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={idx}
                  className="p-5 sm:p-6 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between min-w-0"
                >
                  <div className="space-y-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#0B1F3A]/5 border border-[#0B1F3A]/10 flex items-center justify-center text-[#0B1F3A]">
                      <Icon className="w-5 h-5 text-[#0B1F3A]" />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 break-words">
                      {item.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed break-words">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Disciplines Section (20 OAB Disciplines) */}
        <section className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                Grade Completa da 1ª Fase OAB
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A] break-words">
                Disciplinas do Exame de Ordem
              </h2>
              <p className="text-xs text-slate-500 mt-1 break-words">
                Clique em qualquer disciplina para ver peso na prova, temas mais cobrados e questões comentadas.
              </p>
            </div>
            <button
              onClick={() => onSelectTab('questoes')}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B1F3A] hover:text-[#D4AF37] transition-colors self-start md:self-auto shrink-0"
            >
              <span>Ver todas no Banco de Questões</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 sm:gap-3">
            {OAB_DISCIPLINES.map(disc => {
              const isHighlight = disc.id === 'etica' || disc.id === 'constitucional';
              return (
                <button
                  key={disc.id}
                  onClick={() => onSelectDiscipline(disc)}
                  className={`p-3 sm:p-3.5 rounded-xl border text-left transition-all group flex flex-col justify-between min-h-[110px] min-w-0 w-full ${
                    isHighlight
                      ? 'bg-amber-50/70 border-[#D4AF37]/50 hover:border-[#D4AF37] hover:shadow-md'
                      : 'bg-white border-slate-200 hover:border-[#0B1F3A]/40 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 w-full min-w-0">
                    <span className="text-xs font-semibold text-slate-900 group-hover:text-[#0B1F3A] line-clamp-2 min-w-0 break-words">
                      {disc.name}
                    </span>
                    {isHighlight && (
                      <span className="text-[9px] sm:text-[10px] bg-[#D4AF37] text-[#0B1F3A] px-1.5 py-0.5 rounded font-bold shrink-0">
                        Top Peso
                      </span>
                    )}
                  </div>
                  <div className="pt-2 flex items-center justify-between gap-1 text-[10px] sm:text-[11px] text-slate-500 border-t border-slate-100 mt-2 w-full">
                    <span className="truncate">~{disc.oabWeight} questões</span>
                    <span className="text-[#D4AF37] font-semibold group-hover:translate-x-0.5 transition-transform shrink-0">
                      Ver →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Feature Spotlight: 2ª Fase Peças Processuais */}
        <section className="bg-gradient-to-br from-[#0B1F3A] to-[#16365C] rounded-3xl p-5 sm:p-10 text-white relative overflow-hidden shadow-xl">
          <div className="max-w-2xl space-y-4 relative z-10 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-[#D4AF37] text-xs font-semibold max-w-full">
              <FileCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Preparação Avançada de 2ª Fase OAB</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold font-serif text-white break-words">
              Laboratório Prático de Peças Processuais
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Não perca pontos em endereçamento, tempestividade ou falta de pedidos. Treine as {LEGAL_BRIEFS.length} principais peças cobradas nas 2ª fases da OAB (Civil, Processo Civil, Penal, Trabalho, Constitucional, Tributário e Empresarial) com casos hipotéticos e modelos demonstrativos redigidos.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => onSelectTab('pecas')}
                className="px-5 py-2.5 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-bold text-xs rounded-lg transition-colors flex items-center gap-2 shadow"
              >
                <span>Acessar Laboratório de Peças</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onSelectTab('apostilas')}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-lg border border-white/20 transition-colors"
              >
                Consultar Apostilas Doutrinárias
              </button>
            </div>
          </div>
        </section>

        {/* Premium Plan Showcase */}
        <section className="space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <div className="inline-flex items-center gap-1 text-[#D4AF37] text-xs font-bold uppercase tracking-wider">
              <Crown className="w-4 h-4" />
              <span>Planos e Investimento</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold font-serif text-[#0B1F3A]">
              Escolha o plano ideal para sua rotina
            </h2>
            <p className="text-sm text-slate-600">
              Tenha acesso a ferramentas de ponta para garantir sua aprovação de primeira.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-4xl mx-auto">
            
            {/* Free Plan */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 shadow-sm flex flex-col justify-between min-w-0">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-slate-900">Plano Gratuito</h3>
                  <span className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full font-medium">
                    Acesso Básico
                  </span>
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  R$ 0 <span className="text-xs font-normal text-slate-500">/ sempre</span>
                </div>
                <p className="text-xs text-slate-600">
                  Ideal para conhecer a plataforma e realizar treinos diários demonstrativos.
                </p>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-4 border-t border-slate-100">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Acesso a questões demonstrativas com gabarito</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>1 simulado express por dia</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Visualização de modelos de peças processuais</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>Painel básico de acompanhamento local</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-100">
                <button
                  onClick={() => onSelectTab('questoes')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors"
                >
                  Estudar Gratuitamente
                </button>
              </div>
            </div>

            {/* Premium Plan */}
            <div className="bg-white rounded-2xl border-2 border-[#D4AF37] p-5 sm:p-8 shadow-xl relative flex flex-col justify-between min-w-0 mt-2 md:mt-0">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#D4AF37] text-[#0B1F3A] text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full shadow max-w-[90%] truncate text-center">
                Recomendado para Concurso & OAB
              </div>

              <div className="space-y-4 pt-2 sm:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-lg font-bold text-[#0B1F3A] flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-[#D4AF37] shrink-0" />
                    Plano Premium
                  </h3>
                  <span className="text-xs bg-[#D4AF37]/20 text-[#0B1F3A] px-2.5 py-1 rounded-full font-bold">
                    Acesso Ilimitado
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#0B1F3A]">
                  R$ 29,90 <span className="text-xs font-normal text-slate-500">/ mês</span>
                </div>
                <p className="text-xs text-slate-600">
                  A preparação completa e sem restrições para quem não pode perder tempo.
                </p>
                <ul className="space-y-2.5 text-xs text-slate-700 pt-4 border-t border-slate-100">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span><strong>Acesso ilimitado</strong> a todo o banco de questões</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span><strong>Simulados ilimitados</strong> com cronômetro oficial da prova</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span><strong>Laboratório de 2ª fase</strong> completo com {LEGAL_BRIEFS.length} peças</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span><strong>Biblioteca completa</strong> de apostilas e resumos</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                    <span><strong>Gráficos analíticos</strong> de fraquezas e evolução</span>
                  </li>
                </ul>
              </div>

              <div className="pt-6 mt-6 border-t border-slate-100">
                <button
                  onClick={onOpenPremium}
                  className="w-full py-3 px-4 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  <Crown className="w-4 h-4 shrink-0" />
                  <span>
                    {userProfile.isPremium
                      ? 'Seu Plano Premium está Ativo'
                      : 'Assinar Premium (R$ 29,90/mês)'}
                  </span>
                </button>
                <p className="text-[10px] text-center text-slate-400 mt-2">
                  Cartão de Crédito Recorrente ou Pix · Sem fidelidade
                </p>
              </div>
            </div>

          </div>
        </section>

      </div>

      {/* Institutional Footer */}
      <footer className="bg-[#071527] text-slate-400 text-xs border-t border-slate-800 pt-10 sm:pt-12 pb-20 lg:pb-12 mt-12 sm:mt-16">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            
            {/* Col 1: Brand & Disclaimer */}
            <div className="md:col-span-2 space-y-3 min-w-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-[#D4AF37] flex items-center justify-center text-[#0B1F3A] shrink-0">
                  <Scale className="w-4 h-4" />
                </div>
                <span className="font-serif text-base font-bold text-white tracking-wide">
                  APROVA DIREITO
                </span>
              </div>
              <p className="text-slate-400 leading-relaxed max-w-md break-words">
                Plataforma independente de apoio didático para estudantes de Direito, bacharéis e candidatos ao Exame de Ordem da OAB e certames públicos das carreiras jurídicas.
              </p>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-400 flex items-start gap-2 max-w-md min-w-0">
                <ShieldAlert className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                <span className="break-words">
                  <strong>Nota Didática:</strong> As questões, simulações e peças contidas nesta plataforma são de caráter estritamente pedagógico e demonstrativo, sem vínculo oficial com a OAB ou a banca examinadora FGV.
                </span>
              </div>
            </div>

            {/* Col 2: Navigation Links */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-white font-semibold uppercase tracking-wider text-[11px]">
                Navegação Rápida
              </h4>
              <ul className="space-y-1.5">
                <li><button onClick={() => onSelectTab('oab')} className="hover:text-[#D4AF37] transition-colors text-left">Exame OAB 1ª e 2ª Fase</button></li>
                <li><button onClick={() => onSelectTab('concursos')} className="hover:text-[#D4AF37] transition-colors text-left">Carreiras Jurídicas</button></li>
                <li><button onClick={() => onSelectTab('questoes')} className="hover:text-[#D4AF37] transition-colors text-left">Banco de Questões</button></li>
                <li><button onClick={() => onSelectTab('simulados')} className="hover:text-[#D4AF37] transition-colors text-left">Simulados Cronometrados</button></li>
                <li><button onClick={() => onSelectTab('pecas')} className="hover:text-[#D4AF37] transition-colors text-left">Laboratório de Peças</button></li>
                <li><button onClick={() => onSelectTab('apostilas')} className="hover:text-[#D4AF37] transition-colors text-left">Biblioteca de Apostilas</button></li>
              </ul>
            </div>

            {/* Col 3: Institutional & Help */}
            <div className="space-y-2 min-w-0">
              <h4 className="text-white font-semibold uppercase tracking-wider text-[11px]">
                Institucional & Suporte
              </h4>
              <ul className="space-y-1.5">
                <li><button onClick={onOpenPremium} className="hover:text-[#D4AF37] transition-colors text-left">Assinatura Premium</button></li>
                <li><button onClick={() => onSelectTab('desempenho')} className="hover:text-[#D4AF37] transition-colors text-left">Painel de Desempenho</button></li>
                <li><button onClick={onOpenAuth} className="hover:text-[#D4AF37] transition-colors text-left">Área do Aluno</button></li>
                <li><span className="text-slate-500">Termos de Uso Didáticos</span></li>
                <li><span className="text-slate-500">Política de Privacidade</span></li>
                <li><span className="text-slate-500 break-words [overflow-wrap:anywhere]">contato@aprovadireito.com.br</span></li>
              </ul>
            </div>

          </div>

          <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 text-center sm:text-left">
            <span>© 2026 Aprova Direito. Todos os direitos reservados.</span>
            <span>Feito para a sua aprovação jurídica.</span>
          </div>
        </div>
      </footer>

    </div>
  );
};
