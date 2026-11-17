import React, { useState, useEffect, useCallback } from 'react';
import { StudyMaterial } from '../types';
import { OAB_DISCIPLINES } from '../data/disciplines';
import { useAuth } from '../context/AuthContext';
import { fetchMaterialsCatalog } from '../services/contentService';
import { TOTAL_STUDY_MATERIALS_COUNT } from '../data/studyMaterials';
import {
  BookOpen,
  Eye,
  Clock,
  User,
  X,
  Scale,
  CheckCircle2,
  Search,
  Check,
  Filter,
  Layers,
  FileCheck,
  ChevronRight,
  ChevronLeft,
  Lock,
  Crown,
  Sparkles,
  RefreshCw,
  LogIn
} from 'lucide-react';

interface StudyGuidesViewProps {
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

export const StudyGuidesView: React.FC<StudyGuidesViewProps> = ({
  onOpenAuth,
  onOpenPremium
}) => {
  const { currentUser, isPremiumActive } = useAuth();
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [serverIsPremium, setServerIsPremium] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [viewMode, setViewMode] = useState<'chapters' | 'continuous'>('chapters');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualTypeFilter, setManualTypeFilter] = useState<'all' | 'extensive' | 'summaries'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'todas' | 'fundamental' | 'material' | 'processual' | 'especial'>('todas');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('todas');
  const [inBookSearch, setInBookSearch] = useState('');

  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('aprovadireito_completed_apostilas');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchMaterialsCatalog();
      setMaterials(res.materials);
      setServerIsPremium(res.isPremium);
    } catch (err: any) {
      setLoadError(err?.message || 'Não foi possível carregar as apostilas e manuais.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials, currentUser?.uid, isPremiumActive]);

  const selectedMaterial = selectedMaterialId
    ? materials.find(m => m.id === selectedMaterialId) || null
    : null;

  const toggleCompleted = (matId: string) => {
    setCompletedIds(prev => {
      const updated = prev.includes(matId) ? prev.filter(id => id !== matId) : [...prev, matId];
      try {
        localStorage.setItem('aprovadireito_completed_apostilas', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const filteredMaterials = materials.filter(m => {
    const matchesSearch =
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.author.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (manualTypeFilter === 'extensive' && !m.isExtensiveManual && !(m.pageCount && m.pageCount >= 50)) {
      return false;
    }
    if (manualTypeFilter === 'summaries' && (m.isExtensiveManual || (m.pageCount && m.pageCount >= 50))) {
      return false;
    }

    if (disciplineFilter !== 'todas' && m.disciplineId !== disciplineFilter) {
      return false;
    }

    if (categoryFilter !== 'todas') {
      const disc = OAB_DISCIPLINES.find(d => d.id === m.disciplineId);
      if (disc?.category !== categoryFilter) return false;
    }

    return true;
  });

  const handleOpenReader = (material: StudyMaterial) => {
    setSelectedMaterialId(material.id);
    setActiveChapterIndex(0);
    setViewMode('chapters');
    setInBookSearch('');
  };

  const extensiveCount = materials.filter(m => m.isExtensiveManual || (m.pageCount && m.pageCount >= 50)).length;

  const activeChapter = selectedMaterial?.chapters[activeChapterIndex];
  const isChapterLocked = Boolean(!serverIsPremium && activeChapter?.isLocked);

  const renderLockedChapterPanel = (title: string, allowJumpToChapter1: boolean) => (
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
          <h3 className="text-base sm:text-lg font-bold font-serif text-white break-words">
            {title}
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-words">
            No plano gratuito, o <strong>1º capítulo</strong> está liberado nas apostilas de <strong>Ética Profissional</strong>, <strong>Direito Constitucional</strong> e <strong>Direito Civil</strong>. Assine o Plano Premium por <strong>R$ 29,90/mês</strong> para desbloquear todos os capítulos dos {materials.length || TOTAL_STUDY_MATERIALS_COUNT} manuais e apostilas e a leitura em Livro Completo.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 pt-2">
        {onOpenPremium && (
          <button
            onClick={() => {
              setSelectedMaterialId(null);
              onOpenPremium();
            }}
            className="px-4 py-2.5 bg-[#D4AF37] hover:bg-[#C59F2A] text-[#0B1F3A] font-extrabold text-xs rounded-xl shadow transition-colors flex items-center gap-1.5"
          >
            <Crown className="w-4 h-4" />
            <span>Assinar Premium (R$ 29,90/mês)</span>
          </button>
        )}
        {allowJumpToChapter1 && (
          <button
            onClick={() => {
              setViewMode('chapters');
              setActiveChapterIndex(0);
            }}
            className="px-4 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 text-xs font-bold rounded-xl transition-colors"
          >
            Ler Capítulo 1 Gratuito
          </button>
        )}
        {!currentUser && onOpenAuth && (
          <button
            onClick={() => {
              setSelectedMaterialId(null);
              onOpenAuth();
            }}
            className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-xl border border-white/20 transition-colors flex items-center gap-1.5"
          >
            <LogIn className="w-4 h-4 text-[#D4AF37]" />
            <span>Já sou assinante · Entrar</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="min-w-0">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#D4AF37] shadow-md shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold font-serif text-[#0B1F3A] break-words">
                Biblioteca Jurídica de Apostilas & Manuais
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Manuais extensivos com mais de 50 páginas e resumos de alta fixação para as 20 disciplinas da OAB e Concursos.
              </p>
            </div>
          </div>
        </div>

        {/* Global Search */}
        <div className="relative w-full sm:max-w-xs min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar manual ou tema..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] bg-white"
          />
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
                Modo Gratuito: 3 apostilas com o 1º capítulo liberado (Ética, Direito Constitucional e Direito Civil)
              </p>
              <p className="text-[11px] sm:text-xs text-slate-300 break-words">
                Os demais capítulos e apostilas são exclusivos do Plano Premium (R$ 29,90/mês).
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
                <span>Liberar Acervo Completo · R$ 29,90</span>
              </button>
            )}
          </div>
        </div>
      )}

      {loadError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex flex-wrap items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            onClick={loadMaterials}
            className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 font-semibold flex items-center gap-1.5 hover:bg-rose-100"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tentar Novamente</span>
          </button>
        </div>
      )}

      {/* Main Filter Tabs */}
      <div className="bg-[#0B1F3A]/5 p-1.5 rounded-2xl grid grid-cols-1 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 text-xs font-bold">
        <button
          onClick={() => setManualTypeFilter('all')}
          className={`px-3 sm:px-4 py-2 rounded-xl transition-all text-left sm:text-center max-w-full ${
            manualTypeFilter === 'all'
              ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
              : 'text-slate-700 hover:text-[#0B1F3A]'
          }`}
        >
          Acervo Completo ({materials.length || TOTAL_STUDY_MATERIALS_COUNT})
        </button>
        <button
          onClick={() => setManualTypeFilter('extensive')}
          className={`px-3 sm:px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 text-left sm:text-center max-w-full ${
            manualTypeFilter === 'extensive'
              ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
              : 'text-slate-700 hover:text-[#0B1F3A]'
          }`}
        >
          <Layers className="w-4 h-4 text-[#D4AF37] shrink-0" />
          <span className="break-words">Manuais Extensivos (50+ Páginas) ({extensiveCount})</span>
        </button>
        <button
          onClick={() => setManualTypeFilter('summaries')}
          className={`px-3 sm:px-4 py-2 rounded-xl transition-all text-left sm:text-center max-w-full ${
            manualTypeFilter === 'summaries'
              ? 'bg-[#0B1F3A] text-[#D4AF37] shadow-sm'
              : 'text-slate-700 hover:text-[#0B1F3A]'
          }`}
        >
          Resumos por Disciplina ({Math.max(0, materials.length - extensiveCount)})
        </button>
      </div>

      {/* Secondary Category & Discipline Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategoryFilter('todas')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              categoryFilter === 'todas'
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Todas as Áreas
          </button>
          <button
            onClick={() => setCategoryFilter('fundamental')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              categoryFilter === 'fundamental'
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Fundamentais
          </button>
          <button
            onClick={() => setCategoryFilter('material')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              categoryFilter === 'material'
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Direito Material
          </button>
          <button
            onClick={() => setCategoryFilter('processual')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              categoryFilter === 'processual'
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Direito Processual
          </button>
          <button
            onClick={() => setCategoryFilter('especial')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              categoryFilter === 'especial'
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Especializadas
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0 max-w-full">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            value={disciplineFilter}
            onChange={e => setDisciplineFilter(e.target.value)}
            className="w-full sm:w-auto min-w-0 max-w-full flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B1F3A]"
          >
            <option value="todas">Filtrar por disciplina...</option>
            {OAB_DISCIPLINES.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {completedIds.length > 0 && (
            <span className="text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full font-semibold border border-emerald-200 shrink-0">
              {completedIds.length} lidas
            </span>
          )}
        </div>
      </div>

      {/* Loading Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-72 rounded-3xl bg-white border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredMaterials.map(mat => {
            const discipline = OAB_DISCIPLINES.find(d => d.id === mat.disciplineId);
            const isCompleted = completedIds.includes(mat.id);
            const isExtensive = mat.isExtensiveManual || (mat.pageCount && mat.pageCount >= 50);
            const isLockedCard = Boolean(!serverIsPremium && mat.isFullyLocked);

            return (
              <div
                key={mat.id}
                className={`min-w-0 bg-white rounded-3xl border shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col justify-between ${
                  isExtensive
                    ? 'border-[#D4AF37]/50 ring-1 ring-[#D4AF37]/30'
                    : isCompleted
                    ? 'border-emerald-300'
                    : 'border-slate-200'
                }`}
              >
                <div
                  className={`p-4 sm:p-6 text-white relative overflow-hidden ${
                    isExtensive
                      ? 'bg-gradient-to-br from-[#0B1F3A] via-[#16365C] to-[#0B1F3A]'
                      : 'bg-[#0B1F3A]'
                  }`}
                >
                  <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-white/5 rounded-full" />

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 mb-2">
                    <span className="font-semibold text-[#D4AF37] uppercase tracking-wider min-w-0 break-words">
                      {discipline?.name || mat.disciplineId}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!serverIsPremium && mat.hasFreePreview && (
                        <span className="bg-emerald-500 text-white px-2 py-0.5 rounded-md text-[10px] font-extrabold">
                          Cap. 1 Gratuito
                        </span>
                      )}
                      {isLockedCard && (
                        <span className="bg-white/15 text-[#D4AF37] border border-[#D4AF37]/40 px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          Premium
                        </span>
                      )}
                      {isExtensive ? (
                        <span className="bg-[#D4AF37] text-[#0B1F3A] px-2 py-0.5 rounded-md text-[10px] font-extrabold flex items-center gap-1 shadow-xs shrink-0">
                          <Layers className="w-3 h-3" />
                          {mat.pageCount || 50} Págs
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] shrink-0">
                          <Clock className="w-3 h-3 text-[#D4AF37]" />
                          {mat.estimatedReadTime}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="text-base font-bold font-serif text-white leading-snug line-clamp-2">
                    {mat.title}
                  </h3>

                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-300">
                    <div className="flex items-center gap-1.5 truncate">
                      <User className="w-3 h-3 shrink-0" />
                      <span className="truncate">{mat.author}</span>
                    </div>
                    {isCompleted && (
                      <span className="flex items-center gap-1 text-emerald-400 font-bold shrink-0">
                        <Check className="w-3.5 h-3.5" />
                        Lida
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                  <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                    {mat.description}
                  </p>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {mat.chapters.length} Módulos / Capítulos
                    </span>
                    <span className="text-[#0B1F3A] font-bold">
                      {isLockedCard
                        ? 'Exclusivo Premium'
                        : !serverIsPremium && mat.hasFreePreview
                        ? 'Cap. 1 Liberado'
                        : isExtensive
                        ? 'Livro Completo 50+ Págs'
                        : 'Leitura Dinâmica'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      onClick={() => handleOpenReader(mat)}
                      className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#0B1F3A]" />
                      <span>Sumário</span>
                    </button>

                    <button
                      onClick={() => handleOpenReader(mat)}
                      className="py-2.5 px-3 rounded-xl bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] text-xs font-bold flex items-center justify-center gap-1.5 shadow transition-colors"
                    >
                      {isLockedCard ? <Lock className="w-3.5 h-3.5" /> : <BookOpen className="w-3.5 h-3.5" />}
                      <span>
                        {isLockedCard
                          ? 'Assinar'
                          : !serverIsPremium && mat.hasFreePreview
                          ? 'Ler Cap. 1'
                          : isExtensive
                          ? 'Abrir Manual'
                          : 'Ler Agora'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && filteredMaterials.length === 0 && (
        <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 space-y-3">
          <p className="text-sm text-slate-600">Nenhum material encontrado para estes filtros.</p>
          <button
            onClick={() => {
              setManualTypeFilter('all');
              setCategoryFilter('todas');
              setDisciplineFilter('todas');
              setSearchQuery('');
            }}
            className="px-4 py-2 bg-[#0B1F3A] text-[#D4AF37] text-xs font-bold rounded-xl"
          >
            Limpar Filtros
          </button>
        </div>
      )}

      {/* Advanced In-App Book Reader Modal */}
      {selectedMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-1.5 sm:p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div className="relative w-full max-w-5xl max-h-[94vh] bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col min-w-0">
            {/* Top Reader Bar */}
            <div className="p-3 sm:p-4 bg-[#0B1F3A] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 border-b border-[#D4AF37]/30 shrink-0 min-w-0">
              <div className="flex items-center justify-between gap-2 min-w-0 flex-1">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <BookOpen className="w-5 h-5 text-[#D4AF37] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="font-serif font-bold text-sm sm:text-base break-words line-clamp-2 sm:truncate">
                        {selectedMaterial.title}
                      </span>
                      {selectedMaterial.pageCount && (
                        <span className="px-2 py-0.5 rounded bg-[#D4AF37] text-[#0B1F3A] text-[10px] font-extrabold shrink-0">
                          {selectedMaterial.pageCount} Págs Didáticas
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 truncate">{selectedMaterial.author}</p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedMaterialId(null)}
                  className="sm:hidden p-1.5 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                  aria-label="Fechar Leitor"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                <div className="flex items-center bg-white/10 rounded-lg p-0.5 text-[11px] sm:text-xs">
                  <button
                    onClick={() => setViewMode('chapters')}
                    className={`px-2 sm:px-2.5 py-1 rounded font-semibold transition-colors whitespace-nowrap ${
                      viewMode === 'chapters' ? 'bg-[#D4AF37] text-[#0B1F3A]' : 'text-slate-300'
                    }`}
                  >
                    Por Capítulo
                  </button>
                  <button
                    onClick={() => setViewMode('continuous')}
                    className={`px-2 sm:px-2.5 py-1 rounded font-semibold transition-colors whitespace-nowrap flex items-center gap-1 ${
                      viewMode === 'continuous' ? 'bg-[#D4AF37] text-[#0B1F3A]' : 'text-slate-300'
                    }`}
                  >
                    {!serverIsPremium && <Lock className="w-3 h-3" />}
                    <span>Livro Completo</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="hidden sm:flex items-center bg-white/10 rounded-lg p-0.5 text-xs">
                    <button
                      onClick={() => setFontSize('sm')}
                      className={`px-2 py-1 rounded ${fontSize === 'sm' ? 'bg-[#D4AF37] text-[#0B1F3A] font-bold' : 'text-slate-200'}`}
                    >
                      A-
                    </button>
                    <button
                      onClick={() => setFontSize('base')}
                      className={`px-2 py-1 rounded ${fontSize === 'base' ? 'bg-[#D4AF37] text-[#0B1F3A] font-bold' : 'text-slate-200'}`}
                    >
                      A
                    </button>
                    <button
                      onClick={() => setFontSize('lg')}
                      className={`px-2 py-1 rounded ${fontSize === 'lg' ? 'bg-[#D4AF37] text-[#0B1F3A] font-bold' : 'text-slate-200'}`}
                    >
                      A+
                    </button>
                  </div>

                  <button
                    onClick={() => toggleCompleted(selectedMaterial.id)}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                      completedIds.includes(selectedMaterial.id)
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white/10 hover:bg-white/20 text-slate-200'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">
                      {completedIds.includes(selectedMaterial.id) ? 'Concluído' : 'Marcar como Lido'}
                    </span>
                  </button>

                  <button
                    onClick={() => setSelectedMaterialId(null)}
                    className="hidden sm:inline-flex p-1 rounded-full text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                    aria-label="Fechar Leitor"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Reader Sub-Bar */}
            <div className="px-3 sm:px-5 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 text-xs text-slate-600 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileCheck className="w-4 h-4 text-[#0B1F3A] shrink-0" />
                <span className="break-words min-w-0">
                  {viewMode === 'chapters'
                    ? `Capítulo ${activeChapterIndex + 1} de ${selectedMaterial.chapters.length} ${
                        selectedMaterial.pageCount
                          ? `(Volume Geral: ${selectedMaterial.pageCount} páginas)`
                          : ''
                      }`
                    : `Visualização Contínua · Todos os ${selectedMaterial.chapters.length} capítulos do Volume`}
                </span>
              </div>

              <div className="relative w-full sm:max-w-xs min-w-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={inBookSearch}
                  onChange={e => setInBookSearch(e.target.value)}
                  placeholder="Pesquisar capítulo..."
                  className="w-full pl-8 pr-3 py-1 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#0B1F3A]"
                />
              </div>
            </div>

            {/* Reader Body */}
            <div className="flex-1 flex flex-col md:grid md:grid-cols-12 min-h-0 overflow-hidden">
              {/* Sidebar TOC */}
              <div className="md:col-span-4 min-w-0 max-h-36 sm:max-h-44 md:max-h-none bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 p-2.5 sm:p-4 overflow-y-auto space-y-1.5 sm:space-y-2 shrink-0">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Sumário do Manual ({selectedMaterial.chapters.length} partes):
                </div>
                {selectedMaterial.chapters
                  .map((ch, idx) => ({ ch, idx }))
                  .filter(({ ch }) => !inBookSearch.trim() || ch.title.toLowerCase().includes(inBookSearch.toLowerCase()))
                  .map(({ ch, idx }) => {
                    const isCurrent = idx === activeChapterIndex && viewMode === 'chapters';
                    const chLocked = Boolean(!serverIsPremium && ch.isLocked);
                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          setActiveChapterIndex(idx);
                          setViewMode('chapters');
                        }}
                        className={`w-full p-2.5 sm:p-3 rounded-xl text-left text-xs transition-colors flex items-start justify-between gap-2 min-w-0 ${
                          isCurrent
                            ? 'bg-[#0B1F3A] text-[#D4AF37] font-bold shadow-xs'
                            : 'text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="font-bold shrink-0">{idx + 1}.</span>
                          <span className="line-clamp-2 leading-snug break-words min-w-0">{ch.title}</span>
                        </div>
                        {chLocked && (
                          <Lock className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isCurrent ? 'text-[#D4AF37]' : 'text-slate-400'}`} />
                        )}
                      </button>
                    );
                  })}
              </div>

              {/* Main Reading Window */}
              <div className="flex-1 md:col-span-8 min-w-0 min-h-0 p-3.5 sm:p-8 lg:p-10 overflow-y-auto overflow-x-hidden space-y-6 sm:space-y-8">
                {viewMode === 'chapters' && activeChapter && (
                  <div className="space-y-6 min-w-0">
                    <div className="border-b border-slate-200 pb-4">
                      <div className="text-xs font-bold text-[#D4AF37] uppercase tracking-wider mb-1 flex items-center gap-2">
                        <span>Capítulo {activeChapterIndex + 1} de {selectedMaterial.chapters.length}</span>
                        {!isChapterLocked && !serverIsPremium && (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px]">
                            Liberado Gratuitamente
                          </span>
                        )}
                      </div>
                      <h2 className="text-lg sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">
                        {activeChapter.title}
                      </h2>
                    </div>

                    {isChapterLocked ? (
                      renderLockedChapterPanel(
                        `Capítulo ${activeChapterIndex + 1} bloqueado para assinantes Premium`,
                        Boolean(selectedMaterial.hasFreePreview)
                      )
                    ) : (
                      <>
                        <div
                          className={`text-slate-800 leading-relaxed space-y-4 min-w-0 ${
                            fontSize === 'sm' ? 'text-xs' : fontSize === 'lg' ? 'text-base sm:text-lg' : 'text-sm'
                          }`}
                        >
                          <p className="whitespace-pre-line text-left sm:text-justify font-serif sm:font-sans break-words [overflow-wrap:anywhere]">
                            {activeChapter.content}
                          </p>
                        </div>

                        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2 min-w-0">
                          <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5 uppercase tracking-wide">
                            <Scale className="w-4 h-4 text-amber-700 shrink-0" />
                            <span>Dispositivos Legais e Fundamentação Jurisprudencial:</span>
                          </span>
                          <div className="flex flex-wrap gap-1.5 min-w-0">
                            {activeChapter.keyStatutes.map((st, i) => (
                              <span
                                key={i}
                                className="px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-amber-950 text-xs font-semibold shadow-2xs break-words [overflow-wrap:anywhere] max-w-full"
                              >
                                {st}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 min-w-0">
                          <span className="text-xs font-bold text-slate-800 uppercase tracking-wide block">
                            Pontos Vitais para Gabaritar a Prova:
                          </span>
                          <ul className="space-y-2 text-xs text-slate-700">
                            {activeChapter.summaryPoints.map((pt, i) => (
                              <li key={i} className="flex items-start gap-2 min-w-0">
                                <CheckCircle2 className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                                <span className="leading-relaxed break-words min-w-0">{pt}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </>
                    )}

                    {/* Prev / Next Pagination controls */}
                    <div className="pt-6 border-t border-slate-100 grid grid-cols-2 sm:flex sm:items-center sm:justify-between gap-2 text-xs">
                      <button
                        onClick={() => setActiveChapterIndex(prev => Math.max(0, prev - 1))}
                        disabled={activeChapterIndex === 0}
                        className="px-2.5 sm:px-4 py-2 rounded-xl border border-slate-300 font-bold disabled:opacity-30 hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <ChevronLeft className="w-4 h-4 shrink-0" />
                        <span>Anterior</span>
                      </button>

                      <button
                        onClick={() =>
                          setActiveChapterIndex(prev =>
                            Math.min(selectedMaterial.chapters.length - 1, prev + 1)
                          )
                        }
                        disabled={activeChapterIndex === selectedMaterial.chapters.length - 1}
                        className="px-2.5 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-[#0B1F3A] text-white font-bold disabled:opacity-30 hover:bg-[#16365C] transition-colors flex items-center justify-center gap-1.5 shadow"
                      >
                        <span className="sm:hidden">Próximo</span>
                        <span className="hidden sm:inline">Próximo Capítulo</span>
                        <ChevronRight className="w-4 h-4 shrink-0" />
                      </button>
                    </div>
                  </div>
                )}

                {viewMode === 'continuous' && (
                  !serverIsPremium ? (
                    renderLockedChapterPanel(
                      'Modo Livro Completo disponível exclusivamente no Plano Premium',
                      Boolean(selectedMaterial.hasFreePreview)
                    )
                  ) : (
                    <div className="space-y-10 sm:space-y-12 min-w-0">
                      <div className="p-4 sm:p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center space-y-2">
                        <h2 className="text-lg sm:text-2xl font-bold font-serif text-[#0B1F3A] break-words">{selectedMaterial.title}</h2>
                        <p className="text-xs text-slate-600">{selectedMaterial.author} · {selectedMaterial.edition || 'Edição Completa'}</p>
                        <p className="text-xs text-[#0B1F3A] font-semibold">{selectedMaterial.chapters.length} capítulos em sequência contínua</p>
                      </div>

                      {selectedMaterial.chapters.map((ch, idx) => (
                        <div key={idx} className="space-y-4 border-b border-slate-200 pb-8 min-w-0">
                          <div className="text-xs font-bold text-[#D4AF37] uppercase tracking-wide">
                            Parte {idx + 1} de {selectedMaterial.chapters.length}
                          </div>
                          <h3 className="text-lg sm:text-xl font-bold font-serif text-[#0B1F3A] break-words">{ch.title}</h3>

                          <div
                            className={`text-slate-800 leading-relaxed space-y-4 min-w-0 ${
                              fontSize === 'sm' ? 'text-xs' : fontSize === 'lg' ? 'text-base' : 'text-sm'
                            }`}
                          >
                            <p className="whitespace-pre-line text-left sm:text-justify font-serif sm:font-sans break-words [overflow-wrap:anywhere]">{ch.content}</p>
                          </div>

                          <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs min-w-0">
                            <strong className="text-amber-900 block mb-1">Dispositivos Aplicados:</strong>
                            <div className="flex flex-wrap gap-1 min-w-0">
                              {ch.keyStatutes.map((st, i) => (
                                <span key={i} className="px-2 py-0.5 rounded bg-white border border-amber-200 text-amber-900 text-[11px] break-words [overflow-wrap:anywhere] max-w-full">
                                  {st}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
