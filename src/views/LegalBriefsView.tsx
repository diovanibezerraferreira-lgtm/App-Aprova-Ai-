import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { LegalBrief } from '../types';
import { useAuth } from '../context/AuthContext';
import { fetchBriefsCatalog } from '../services/contentService';
import { TOTAL_LEGAL_BRIEFS_COUNT } from '../data/legalBriefs';
import {
  FileCheck,
  Scale,
  Copy,
  Check,
  BookOpen,
  Calendar,
  Compass,
  AlertCircle,
  Search,
  Layers,
  FolderOpen,
  Lock,
  Crown,
  Sparkles,
  RefreshCw,
  LogIn
} from 'lucide-react';

interface LegalBriefsViewProps {
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

export const LegalBriefsView: React.FC<LegalBriefsViewProps> = ({
  onOpenAuth,
  onOpenPremium
}) => {
  const { currentUser, isPremiumActive } = useAuth();
  const [briefs, setBriefs] = useState<LegalBrief[]>([]);
  const [serverIsPremium, setServerIsPremium] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedBriefId, setSelectedBriefId] = useState<string>('resposta-acusacao');
  const [activeSubTab, setActiveSubTab] = useState<'geral' | 'estrutura' | 'caso' | 'modelo'>('modelo');
  const [copiedDraft, setCopiedDraft] = useState<boolean>(false);
  const [selectedArea, setSelectedArea] = useState<string>('todas');
  const [selectedSubject, setSelectedSubject] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadBriefs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchBriefsCatalog();
      setBriefs(res.briefs);
      setServerIsPremium(res.isPremium);
      setSelectedBriefId(prev => {
        if (prev && res.briefs.some(b => b.id === prev)) return prev;
        return res.briefs[0]?.id || 'resposta-acusacao';
      });
    } catch (err: any) {
      setLoadError(err?.message || 'Não foi possível carregar o laboratório de peças processuais.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBriefs();
  }, [loadBriefs, currentUser?.uid, isPremiumActive]);

  // Unique list of subjects
  const availableSubjects = useMemo(() => {
    const list = Array.from(new Set(briefs.map(b => b.subject)));
    return ['todos', ...list];
  }, [briefs]);

  // Filtered briefs
  const filteredBriefs = useMemo(() => {
    return briefs.filter(b => {
      const matchArea = selectedArea === 'todas' || b.area === selectedArea;
      const matchSubject = selectedSubject === 'todos' || b.subject === selectedSubject;
      const matchSearch =
        !searchQuery.trim() ||
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.overview.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.legalBasis.toLowerCase().includes(searchQuery.toLowerCase());
      return matchArea && matchSubject && matchSearch;
    });
  }, [briefs, selectedArea, selectedSubject, searchQuery]);

  const selectedBrief =
    filteredBriefs.find(b => b.id === selectedBriefId) ||
    filteredBriefs[0] ||
    briefs[0];

  const freeBriefs = useMemo(() => briefs.filter(b => b.isFree), [briefs]);

  const handleCopyDraft = () => {
    if (!selectedBrief || selectedBrief.isLocked || !selectedBrief.fullDraft) {
      if (onOpenPremium) onOpenPremium();
      return;
    }
    navigator.clipboard.writeText(selectedBrief.fullDraft);
    setCopiedDraft(true);
    setTimeout(() => setCopiedDraft(false), 2000);
  };

  const getAreaColor = (area: string) => {
    switch (area) {
      case 'Direito Processual Civil':
      case 'Direito Civil':
        return 'text-sky-700 bg-sky-50 border-sky-200';
      case 'Direito Penal':
        return 'text-rose-700 bg-rose-50 border-rose-200';
      case 'Direito do Trabalho':
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'Direito Constitucional':
        return 'text-amber-800 bg-amber-50 border-amber-200';
      case 'Direito Tributário':
        return 'text-purple-700 bg-purple-50 border-purple-200';
      case 'Direito Empresarial':
        return 'text-indigo-700 bg-indigo-50 border-indigo-200';
      default:
        return 'text-slate-700 bg-slate-50 border-slate-200';
    }
  };

  const renderPremiumLockPanel = (sectionLabel: string) => (
    <div className="p-5 sm:p-8">
      <div className="rounded-2xl border-2 border-[#D4AF37]/40 bg-gradient-to-br from-[#0B1F3A] to-[#16365C] text-white p-5 sm:p-7 space-y-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#D4AF37] text-[#0B1F3A] flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div className="space-y-1 min-w-0">
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[#D4AF37]">
              <Crown className="w-3.5 h-3.5" />
              Conteúdo Exclusivo Premium
            </span>
            <h4 className="text-base sm:text-lg font-bold font-serif text-white break-words">
              {sectionLabel} bloqueado no Plano Gratuito
            </h4>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
              No plano gratuito você tem acesso integral às peças <strong>Resposta à Acusação (Direito Penal)</strong> e <strong>Reclamação Trabalhista (Direito do Trabalho)</strong>. Assine o Plano Premium por <strong>R$ 29,90/mês</strong> para desbloquear todas as {briefs.length || TOTAL_LEGAL_BRIEFS_COUNT} peças completas.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 pt-2">
          {onOpenPremium && (
            <button
              onClick={onOpenPremium}
              className="w-full sm:w-auto px-4 py-2.5 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-extrabold text-xs rounded-xl shadow transition-colors flex items-center justify-center gap-1.5 text-center"
            >
              <Crown className="w-4 h-4 shrink-0" />
              <span>Assinar Premium (R$ 29,90/mês)</span>
            </button>
          )}
          {!currentUser && onOpenAuth && (
            <button
              onClick={onOpenAuth}
              className="w-full sm:w-auto px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl border border-white/20 transition-colors flex items-center justify-center gap-1.5 text-center"
            >
              <LogIn className="w-4 h-4 text-[#D4AF37] shrink-0" />
              <span>Já sou assinante · Entrar</span>
            </button>
          )}
        </div>

        {freeBriefs.length > 0 && (
          <div className="pt-3 border-t border-white/15 space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 block">
              Ou acesse imediatamente uma das 2 peças completas gratuitas:
            </span>
            <div className="flex flex-wrap gap-2">
              {freeBriefs.map(fb => (
                <button
                  key={fb.id}
                  onClick={() => {
                    setSelectedArea('todas');
                    setSelectedSubject('todos');
                    setSearchQuery('');
                    setSelectedBriefId(fb.id);
                    setActiveSubTab('modelo');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 text-xs font-semibold transition-colors"
                >
                  {fb.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-start sm:items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shrink-0">
                <FileCheck className="w-4 h-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
                Laboratório de Peças Processuais (2ª Fase)
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Treinamento prático para a prova prático-profissional da OAB e concursos. {briefs.length || TOTAL_LEGAL_BRIEFS_COUNT} peças fundamentais com explicação, estrutura formal, caso hipotético e modelo demonstrativo completo.
            </p>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 shrink-0 self-start sm:self-auto">
            <Layers className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span>{briefs.length || TOTAL_LEGAL_BRIEFS_COUNT} Peças Cadastradas</span>
          </div>
        </div>
      </div>

      {/* Freemium Status Banner */}
      {!loading && !serverIsPremium && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-[#0B1F3A] to-[#16365C] text-white border border-[#D4AF37]/40 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs sm:text-sm font-bold text-white break-words">
                Modo Gratuito: 2 peças completas liberadas (Resposta à Acusação e Reclamação Trabalhista)
              </p>
              <p className="text-[11px] sm:text-xs text-slate-300 break-words">
                As demais {Math.max(0, (briefs.length || TOTAL_LEGAL_BRIEFS_COUNT) - 2)} peças exibem ficha técnica e prazos. Assine o Plano Premium para liberar todos os modelos e casos práticos.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!currentUser && onOpenAuth && (
              <button
                onClick={onOpenAuth}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition-colors"
              >
                Entrar
              </button>
            )}
            {onOpenPremium && (
              <button
                onClick={onOpenPremium}
                className="px-4 py-2 rounded-xl bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] text-xs font-extrabold shadow transition-colors flex items-center gap-1.5"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>Desbloquear 42 Peças · R$ 29,90</span>
              </button>
            )}
          </div>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            onClick={loadBriefs}
            className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 font-semibold flex items-center gap-1.5 hover:bg-rose-100"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tentar Novamente</span>
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white p-3.5 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 min-w-0 max-w-full">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 w-full min-w-0 max-w-full md:flex-1">
            <button
              onClick={() => { setSelectedArea('todas'); }}
              className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg max-w-full break-words transition-colors ${
                selectedArea === 'todas'
                  ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Todas as Áreas ({briefs.length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Processual Civil'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Processual Civil'
                  ? 'bg-sky-700 text-white shadow'
                  : 'bg-sky-50 text-sky-800 border border-sky-200 hover:bg-sky-100'
              }`}
            >
              Processo Civil ({briefs.filter(b => b.area === 'Direito Processual Civil').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Civil'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Civil'
                  ? 'bg-blue-700 text-white shadow'
                  : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              Direito Civil ({briefs.filter(b => b.area === 'Direito Civil').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Empresarial'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Empresarial'
                  ? 'bg-indigo-700 text-white shadow'
                  : 'bg-indigo-50 text-indigo-800 border border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              Direito Empresarial ({briefs.filter(b => b.area === 'Direito Empresarial').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Penal'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Penal'
                  ? 'bg-rose-700 text-white shadow'
                  : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              Direito Penal ({briefs.filter(b => b.area === 'Direito Penal').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito do Trabalho'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito do Trabalho'
                  ? 'bg-emerald-700 text-white shadow'
                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              Direito do Trabalho ({briefs.filter(b => b.area === 'Direito do Trabalho').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Constitucional'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Constitucional'
                  ? 'bg-amber-700 text-white shadow'
                  : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              Constitucional ({briefs.filter(b => b.area === 'Direito Constitucional').length})
            </button>
            <button
              onClick={() => { setSelectedArea('Direito Tributário'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                selectedArea === 'Direito Tributário'
                  ? 'bg-purple-700 text-white shadow'
                  : 'bg-purple-50 text-purple-800 border border-purple-200 hover:bg-purple-100'
              }`}
            >
              Tributário ({briefs.filter(b => b.area === 'Direito Tributário').length})
            </button>
          </div>

          <div className="relative w-full md:w-64 min-w-0 shrink-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar peça por título ou lei..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B1F3A]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-2 border-t border-slate-100 w-full max-w-full min-w-0 text-xs">
          <span className="font-bold text-slate-700 flex items-center gap-1 shrink-0 uppercase tracking-wide text-[11px] mr-1">
            <FolderOpen className="w-3.5 h-3.5 text-[#D4AF37]" />
            Assunto:
          </span>
          {availableSubjects.map(subj => {
            const isSelected = selectedSubject === subj;
            const count =
              subj === 'todos'
                ? briefs.length
                : briefs.filter(b => b.subject === subj).length;
            const label = subj === 'todos' ? 'Todos os Assuntos' : subj;
            return (
              <button
                key={subj}
                onClick={() => setSelectedSubject(subj)}
                className={`px-2.5 py-1 rounded-md font-medium max-w-full text-left break-words transition-colors text-[11px] sm:text-xs ${
                  isSelected
                    ? 'bg-[#0B1F3A] text-[#D4AF37] font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-2.5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-20 rounded-xl bg-white border border-slate-200 animate-pulse" />
            ))}
          </div>
          <div className="lg:col-span-8 h-96 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start min-w-0">
          {/* Left Col: Briefs Selector */}
          <div className="lg:col-span-4 w-full min-w-0 space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Peças Filtradas ({filteredBriefs.length}):
              </h2>
              {(selectedArea !== 'todas' || selectedSubject !== 'todos' || searchQuery) && (
                <button
                  onClick={() => {
                    setSelectedArea('todas');
                    setSelectedSubject('todos');
                    setSearchQuery('');
                  }}
                  className="text-[11px] text-[#0B1F3A] font-semibold hover:underline"
                >
                  Limpar Filtros
                </button>
              )}
            </div>

            <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
              {filteredBriefs.length > 0 ? (
                filteredBriefs.map((brief, idx) => {
                  const isSelected = selectedBrief && brief.id === selectedBrief.id;
                  return (
                    <button
                      key={brief.id}
                      onClick={() => {
                        setSelectedBriefId(brief.id);
                        setCopiedDraft(false);
                      }}
                      className={`w-full p-3.5 rounded-xl border text-left transition-all flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-[#0B1F3A] text-white border-[#0B1F3A] shadow-md ring-1 ring-[#D4AF37]/50'
                          : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 w-full min-w-0">
                        <div className="flex items-start gap-1.5 min-w-0 flex-1">
                          {brief.isLocked && (
                            <Lock className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isSelected ? 'text-[#D4AF37]' : 'text-slate-400'}`} />
                          )}
                          <span className="font-bold text-xs leading-snug line-clamp-2 break-words min-w-0">
                            {brief.title}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                            isSelected ? 'bg-white/15 text-[#D4AF37]' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`px-2 py-0.5 rounded font-semibold border ${
                            isSelected ? 'bg-white/10 text-white border-white/20' : getAreaColor(brief.area)
                          }`}
                        >
                          {brief.area}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            isSelected ? 'text-slate-300' : 'text-slate-500 bg-slate-100'
                          }`}
                        >
                          {brief.subject}
                        </span>
                        {brief.isFree && !serverIsPremium && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                            Gratuita
                          </span>
                        )}
                        {brief.isLocked && (
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold ${
                              isSelected
                                ? 'bg-[#D4AF37]/20 text-[#D4AF37] border border-[#D4AF37]/40'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            Premium
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200 space-y-2">
                  <p className="text-xs text-slate-500">Nenhuma peça encontrada para estes filtros.</p>
                  <button
                    onClick={() => {
                      setSelectedArea('todas');
                      setSelectedSubject('todos');
                      setSearchQuery('');
                    }}
                    className="px-3 py-1.5 bg-[#0B1F3A] text-[#D4AF37] rounded-lg text-xs font-semibold"
                  >
                    Restaurar Todas
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Col: Detail Deck */}
          {selectedBrief && (
            <div className="lg:col-span-8 w-full min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 sm:space-y-6">
              {/* Deck Header */}
              <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getAreaColor(selectedBrief.area)}`}>
                      {selectedBrief.area}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700 break-words">
                      Assunto: {selectedBrief.subject}
                    </span>
                    {selectedBrief.isFree && !serverIsPremium && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Amostra Gratuita Completa
                      </span>
                    )}
                    {selectedBrief.isLocked && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Exclusivo Premium
                      </span>
                    )}
                  </div>

                  <button
                    onClick={handleCopyDraft}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors shrink-0 ${
                      selectedBrief.isLocked
                        ? 'bg-[#0B1F3A] border-[#0B1F3A] text-[#D4AF37] hover:bg-[#16365C]'
                        : 'bg-white border-slate-300 hover:border-slate-400 text-slate-700'
                    }`}
                    title={selectedBrief.isLocked ? 'Disponível no Plano Premium' : 'Copiar modelo completo'}
                  >
                    {selectedBrief.isLocked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Desbloquear Modelo</span>
                      </>
                    ) : copiedDraft ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-700 font-semibold">Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar Modelo</span>
                      </>
                    )}
                  </button>
                </div>

                <h3 className="text-lg sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
                  {selectedBrief.title}
                </h3>

                {/* Sub-tabs (2x2 clean grid on mobile, flex-wrap on larger screens so nothing clips laterally) */}
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-stretch sm:items-center gap-1.5 pt-2 border-t border-slate-200 w-full max-w-full min-w-0">
                  <button
                    onClick={() => setActiveSubTab('modelo')}
                    className={`px-2.5 sm:px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center leading-tight min-w-0 ${
                      activeSubTab === 'modelo'
                        ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                        : 'bg-white/70 sm:bg-transparent text-slate-600 hover:text-slate-900 border border-slate-200 sm:border-transparent'
                    }`}
                  >
                    {selectedBrief.isLocked && <Lock className="w-3 h-3 shrink-0" />}
                    <span className="break-words">Modelo Completo</span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('estrutura')}
                    className={`px-2.5 sm:px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center leading-tight min-w-0 ${
                      activeSubTab === 'estrutura'
                        ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                        : 'bg-white/70 sm:bg-transparent text-slate-600 hover:text-slate-900 border border-slate-200 sm:border-transparent'
                    }`}
                  >
                    {selectedBrief.isLocked && <Lock className="w-3 h-3 shrink-0" />}
                    <span className="break-words">
                      Estrutura ({selectedBrief.structureStepsCount ?? selectedBrief.structureGuide.length} Etapas)
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('caso')}
                    className={`px-2.5 sm:px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center leading-tight min-w-0 ${
                      activeSubTab === 'caso'
                        ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                        : 'bg-white/70 sm:bg-transparent text-slate-600 hover:text-slate-900 border border-slate-200 sm:border-transparent'
                    }`}
                  >
                    {selectedBrief.isLocked && <Lock className="w-3 h-3 shrink-0" />}
                    <span className="break-words">Caso Hipotético FGV</span>
                  </button>
                  <button
                    onClick={() => setActiveSubTab('geral')}
                    className={`px-2.5 sm:px-3 py-2 sm:py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors flex items-center justify-center text-center leading-tight min-w-0 ${
                      activeSubTab === 'geral'
                        ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                        : 'bg-white/70 sm:bg-transparent text-slate-600 hover:text-slate-900 border border-slate-200 sm:border-transparent'
                    }`}
                  >
                    <span className="break-words">Ficha Técnica & Prazos</span>
                  </button>
                </div>
              </div>

              {/* Sub-tab 1: Modelo Demonstrativo */}
              {activeSubTab === 'modelo' && (
                selectedBrief.isLocked ? (
                  renderPremiumLockPanel('Modelo Demonstrativo Completo')
                ) : (
                  <div className="p-4 sm:p-6 space-y-4 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Modelo formal e completo para treinamento da 2ª Fase OAB:</span>
                      <span className="text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600 shrink-0">
                        Padrão FGV / Tribunais
                      </span>
                    </div>
                    <div className="relative w-full min-w-0">
                      <pre className="w-full max-w-full p-3 sm:p-6 bg-slate-900 text-slate-100 rounded-xl text-[11px] sm:text-sm font-mono overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed max-h-[600px] overflow-y-auto border border-slate-800">
                        {selectedBrief.fullDraft}
                      </pre>
                    </div>
                  </div>
                )
              )}

              {/* Sub-tab 2: Estrutura Passo a Passo */}
              {activeSubTab === 'estrutura' && (
                selectedBrief.isLocked ? (
                  renderPremiumLockPanel('Esqueleto & Estrutura Passo a Passo')
                ) : (
                  <div className="p-4 sm:p-6 space-y-4 min-w-0">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Siga este esqueleto estrutural rigoroso no momento de redigir sua prova prática para garantir a pontuação máxima no espelho da FGV:
                    </p>
                    <div className="space-y-4">
                      {selectedBrief.structureGuide.map((item, idx) => (
                        <div key={idx} className="p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 min-w-0">
                          <div className="flex items-start sm:items-center gap-2 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-[#0B1F3A] text-[#D4AF37] text-xs font-bold flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide break-words min-w-0">
                              {item.step}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-600 pl-0 sm:pl-8 leading-relaxed break-words">
                            {item.description}
                          </p>
                          <div className="pl-0 sm:pl-8 pt-1">
                            <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono text-[#0B1F3A] break-words [overflow-wrap:anywhere]">
                              💡 <span className="font-semibold text-slate-700">Dica Prática:</span> {item.practicalTip}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}

              {/* Sub-tab 3: Caso Hipotético */}
              {activeSubTab === 'caso' && (
                selectedBrief.isLocked ? (
                  renderPremiumLockPanel('Caso Hipotético FGV')
                ) : (
                  <div className="p-4 sm:p-6 space-y-4 min-w-0">
                    <div className="p-4 sm:p-5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-3 min-w-0">
                      <div className="flex items-start sm:items-center gap-2 text-xs font-bold text-amber-900 uppercase tracking-wide">
                        <AlertCircle className="w-4 h-4 text-[#D4AF37] shrink-0" />
                        <span className="break-words">{selectedBrief.caseScenario.title}</span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-serif break-words">
                        {selectedBrief.caseScenario.problemStatement}
                      </p>
                      <div className="pt-2 border-t border-amber-200/60 text-xs font-semibold text-slate-700 break-words">
                        <span className="text-[#0B1F3A]">Comando da Questão: </span>
                        {selectedBrief.caseScenario.clientNeeds}
                      </div>
                    </div>
                  </div>
                )
              )}

              {/* Sub-tab 4: Ficha Técnica & Prazos (Free Preview for all briefs) */}
              {activeSubTab === 'geral' && (
                <div className="p-4 sm:p-6 space-y-6 min-w-0">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-[#D4AF37] shrink-0" />
                      Visão Geral e Finalidade Processual:
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed break-words">
                      {selectedBrief.overview}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1 min-w-0">
                      <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                        <Scale className="w-3.5 h-3.5 text-[#0B1F3A] shrink-0" />
                        Fundamento Legal:
                      </span>
                      <p className="text-xs font-semibold text-slate-800 break-words">
                        {selectedBrief.legalBasis}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1 min-w-0">
                      <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        Prazo Processual:
                      </span>
                      <p className="text-xs font-semibold text-slate-800 break-words">
                        {selectedBrief.legalDeadlines}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1 md:col-span-2 min-w-0">
                      <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        Competência Jurisdicional / Endereçamento:
                      </span>
                      <p className="text-xs font-semibold text-slate-800 break-words">
                        {selectedBrief.jurisdiction}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
