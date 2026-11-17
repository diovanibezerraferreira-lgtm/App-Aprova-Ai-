import React, { useState } from 'react';
import { Discipline, ActiveTab } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import {
  Scale,
  Award,
  BookOpen,
  FileCheck,
  CheckCircle2,
  Calendar,
  AlertCircle,
  Clock,
  ArrowRight
} from 'lucide-react';

interface OABHubViewProps {
  onSelectTab: (tab: ActiveTab) => void;
  onSelectDiscipline: (discipline: Discipline) => void;
}

export const OABHubView: React.FC<OABHubViewProps> = ({
  onSelectTab,
  onSelectDiscipline
}) => {
  const [activeFaseTab, setActiveFaseTab] = useState<'1fase' | '2fase'>('1fase');

  const strategicDisciplines = OAB_DISCIPLINES.filter(
    d => d.id === 'etica' || d.id === 'constitucional' || d.id === 'civil' || d.id === 'processo-civil' || d.id === 'penal' || d.id === 'trabalho'
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8 sm:space-y-10">
      
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
            <Scale className="w-4 h-4" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
            Central do Exame de Ordem (OAB)
          </h1>
        </div>
        <p className="text-xs text-slate-500 mt-1 break-words">
          Guia estratégico completo para conquistar sua carteira da OAB na 1ª e na 2ª Fase.
        </p>
      </div>

      {/* Fase Switcher */}
      <div className="flex flex-col sm:flex-row bg-slate-200/70 p-1.5 rounded-xl w-full max-w-md gap-1 sm:gap-0">
        <button
          onClick={() => setActiveFaseTab('1fase')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all text-center ${
            activeFaseTab === '1fase'
              ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          1ª Fase: Prova Objetiva (80 Questões)
        </button>
        <button
          onClick={() => setActiveFaseTab('2fase')}
          className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all text-center ${
            activeFaseTab === '2fase'
              ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          2ª Fase: Prático-Profissional (Peça + 4 Questões)
        </button>
      </div>

      {/* FASE 1 CONTENT */}
      {activeFaseTab === '1fase' && (
        <div className="space-y-8 animate-fade-in">
          
          {/* Strategy Banner */}
          <div className="bg-white p-4 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D4AF37]/15 text-[#0B1F3A] text-xs font-bold max-w-full">
              <Award className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="truncate">Regra de Ouro da 1ª Fase OAB</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
              A Meta é Cravar 40/80 (50% de Aproveitamento)
            </h2>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed max-w-3xl">
              Na 1ª Fase da OAB você não concorre com ninguém. Acertou 40 questões, está aprovado para a 2ª fase.
              Concentrar esforços no grupo das <strong>6 matérias essenciais</strong> representa mais de 45% da prova toda!
            </p>

            <div className="pt-2 flex flex-col sm:flex-row sm:flex-wrap gap-2.5 sm:gap-3">
              <button
                onClick={() => onSelectTab('questoes')}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-lg shadow transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Treinar Questões FGV</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
              <button
                onClick={() => onSelectTab('simulados')}
                className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Clock className="w-4 h-4 text-[#0B1F3A] shrink-0" />
                <span>Simulado com Cronômetro</span>
              </button>
            </div>
          </div>

          {/* Strategic Disciplines Weight */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Disciplinas Estratégicas com Maior Peso:
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {strategicDisciplines.map(disc => (
                <div
                  key={disc.id}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 hover:border-[#D4AF37] shadow-sm transition-all flex flex-col justify-between min-w-0"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="text-xs font-bold text-[#0B1F3A] uppercase min-w-0 break-words">
                        {disc.name}
                      </span>
                      <span className="text-xs bg-[#D4AF37]/20 text-[#0B1F3A] px-2 py-0.5 rounded-full font-bold shrink-0">
                        ~{disc.oabWeight} questões
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-3 break-words">
                      {disc.description}
                    </p>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                    <button
                      onClick={() => onSelectDiscipline(disc)}
                      className="text-xs text-[#0B1F3A] font-bold hover:text-[#D4AF37] transition-colors"
                    >
                      Ver Raio-X da Matéria →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Suggested 90-Day Roadmap */}
          <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 min-w-0">
            <h3 className="text-base font-bold font-serif text-[#0B1F3A] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#D4AF37] shrink-0" />
              <span>Cronograma Sugerido de 90 Dias</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-700">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 min-w-0">
                <span className="font-bold text-[#0B1F3A] block">Mês 1 · Base Sólida</span>
                <p>Estudo intensivo de Ética (Estatuto OAB e Código de Ética), Direito Constitucional e Direito Civil (Parte Geral e Contratos).</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 min-w-0">
                <span className="font-bold text-[#0B1F3A] block">Mês 2 · Processos & Penal</span>
                <p>Processo Civil (Recursos e Tutelas), Direito Penal (Teoria do Crime), Processo Penal e Direito do Trabalho com resolução de questões.</p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 min-w-0">
                <span className="font-bold text-[#0B1F3A] block">Mês 3 · Reta Final & Simulados</span>
                <p>Realização semanal de simulados cronometrados, revisão das matérias com 2 questões (ECA, CDC, Ambiental) e foco nos erros.</p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* FASE 2 CONTENT */}
      {activeFaseTab === '2fase' && (
        <div className="space-y-8 animate-fade-in">
          
          <div className="bg-white p-4 sm:p-8 rounded-2xl border border-slate-200 shadow-sm space-y-4 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0B1F3A]/5 text-[#0B1F3A] text-xs font-bold max-w-full">
              <FileCheck className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span className="truncate">Estrutura da Prova Prático-Profissional</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
              1 Peça Profissional (5,0 Pontos) + 4 Questões Discursivas (5,0 Pontos)
            </h2>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed max-w-3xl break-words">
              A nota mínima para aprovação é 6,0. A peça profissional vale metade da sua prova. Acertar a peça, o endereçamento, a tempestividade e todos os pedidos essenciais é fundamental para a aprovação.
            </p>

            <div className="pt-2">
              <button
                onClick={() => onSelectTab('pecas')}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs rounded-lg shadow transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Acessar Modelos no Laboratório de Peças</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            </div>
          </div>

          {/* Key Areas Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3 min-w-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-600 shrink-0" />
                2ª Fase em Direito Penal
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                As peças mais cobradas historicamente são <strong>Apelação</strong>, <strong>Memoriais Escritos</strong>, <strong>Resposta à Acusação</strong> e <strong>Recurso em Sentido Estrito (RESE)</strong>.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => onSelectTab('pecas')}
                  className="text-xs text-[#0B1F3A] font-bold hover:underline"
                >
                  Ver modelos de peças penais →
                </button>
              </div>
            </div>

            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3 min-w-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0" />
                2ª Fase em Direito do Trabalho
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                As peças rainhas da 2ª fase trabalhista são a <strong>Reclamação Trabalhista</strong>, a <strong>Contestação</strong> e o <strong>Recurso Ordinário (RO)</strong>.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => onSelectTab('pecas')}
                  className="text-xs text-[#0B1F3A] font-bold hover:underline"
                >
                  Ver modelos de peças trabalhistas →
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
