import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, KeyRound, RefreshCw, Send, CheckCircle2, AlertTriangle, 
  Users, Crown, Mail, Clock, FileText, BarChart3, Lock, ShieldCheck, Play 
} from 'lucide-react';

interface CampaignDefinition {
  id: string;
  day: number;
  title: string;
  targetAudience: string;
  subject: string;
  headline: string;
  ctaText: string;
}

interface ConversionMetrics {
  totalUsers: number;
  freeUsers: number;
  eligibleUsers: number;
  activePremium: number;
  conversionRate: number;
}

interface HistoryStats {
  sent: number;
  pending: number;
  failed: number;
  unknown: number;
}

export const AdminConversionView: React.FC = () => {
  const [adminSecret, setAdminSecret] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('aprova_admin_secret') || '';
  });
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [metrics, setMetrics] = useState<ConversionMetrics | null>(null);
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignDefinition[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('campaign-day-0');

  // Simulation state
  const [simUid, setSimUid] = useState<string>('test_user_123');
  const [simEmail, setSimEmail] = useState<string>('estudante@test.com');
  const [simHeadline, setSimHeadline] = useState<string>('');
  const [simCta, setSimCta] = useState<string>('');
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState<boolean>(false);

  const fetchConversionData = async (secretToUse: string) => {
    if (!secretToUse.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin-conversion', {
        method: 'GET',
        headers: {
          'x-admin-secret': secretToUse.trim()
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Falha na autenticação administrativa.');
      }
      setMetrics(data.metrics);
      setHistoryStats(data.historyStats);
      setCampaigns(data.campaigns || []);
      setIsAuthenticated(true);
      sessionStorage.setItem('aprova_admin_secret', secretToUse.trim());
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao carregar dados da Central de Conversão.');
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminSecret) {
      fetchConversionData(adminSecret);
    }
  }, []);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchConversionData(adminSecret);
  };

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminSecret) return;
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await fetch('/api/admin-conversion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret.trim()
        },
        body: JSON.stringify({
          action: 'test-dry-run',
          uid: simUid,
          to: simEmail,
          campaignId: selectedCampaignId,
          headline: simHeadline || undefined,
          ctaText: simCta || undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Erro na simulação.');
      }
      setSimResult(data);
    } catch (err: any) {
      setSimResult({ success: false, error: err.message });
    } finally {
      setSimLoading(false);
    }
  };

  const activeCampaign = campaigns.find(c => c.id === selectedCampaignId) || campaigns[0];

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto my-12 bg-white p-8 rounded-2xl shadow-xl border border-slate-200">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-[#0B1F3A] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-md">
            <Lock className="w-7 h-7 text-[#D4AF37]" />
          </div>
          <h1 className="text-xl font-bold font-serif text-[#0B1F3A]">Central de Conversão</h1>
          <p className="text-xs text-slate-500 mt-1">Acesso restrito a administradores autorizados do Aprova Direito</p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Segredo Administrativo (Admin Secret)</label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="password"
                value={adminSecret}
                onChange={e => setAdminSecret(e.target.value)}
                placeholder="Insira o segredo administrativo..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#0B1F3A] hover:bg-[#152e52] text-[#D4AF37] font-semibold text-xs tracking-wider uppercase rounded-lg shadow transition-all flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            <span>Entrar na Central de Conversão</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0B1F3A] text-white p-6 rounded-2xl shadow-lg border border-[#D4AF37]/30">
        <div>
          <div className="flex items-center gap-2 text-[#D4AF37] text-xs font-semibold tracking-wider uppercase mb-1">
            <Crown className="w-4 h-4" />
            <span>Gestão de Campanhas & Funil de Conversão</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold">Central de Conversão</h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1">
            Monitoramento de elegibilidade, campanhas de e-mail (Dias 0, 1, 3, 5, 7) e proteção LGPD/Premium.
          </p>
        </div>
        <button
          onClick={() => fetchConversionData(adminSecret)}
          className="self-start md:self-auto px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition flex items-center gap-2 border border-white/10"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Métricas</span>
        </button>
      </div>

      {/* Metrics Grid */}
      {metrics && historyStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium uppercase">Total de Usuários</span>
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-bold font-serif text-[#0B1F3A]">{metrics.totalUsers}</div>
            <div className="text-[11px] text-slate-500 mt-1">{metrics.freeUsers} gratuitos, {metrics.activePremium} premium</div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium uppercase">Usuários Elegíveis</span>
              <Mail className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold font-serif text-emerald-700">{metrics.eligibleUsers}</div>
            <div className="text-[11px] text-slate-500 mt-1">Gratuitos com consentimento de e-mail</div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium uppercase">Taxa de Conversão</span>
              <BarChart3 className="w-4 h-4 text-[#D4AF37]" />
            </div>
            <div className="text-2xl font-bold font-serif text-[#0B1F3A]">{metrics.conversionRate}%</div>
            <div className="text-[11px] text-slate-500 mt-1">{metrics.activePremium} assinantes ativos</div>
          </div>

          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-medium uppercase">Histórico (Enviados / Pendentes)</span>
              <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-xl font-bold font-serif text-indigo-900">{historyStats.sent} / {historyStats.pending}</div>
            <div className="text-[11px] text-slate-500 mt-1">{historyStats.failed} falhas, {historyStats.unknown} desconhecidos</div>
          </div>
        </div>
      )}

      {/* Campaigns Section (Days 0, 1, 3, 5, 7) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-serif font-bold text-[#0B1F3A]">Campanhas do Funil (Dias 0 a 7)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Selecione uma campanha para visualizar o template e executar testes de simulação protegidos.</p>
        </div>

        {/* Campaign Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
          {campaigns.map(camp => {
            const isSelected = camp.id === selectedCampaignId;
            return (
              <button
                key={camp.id}
                onClick={() => setSelectedCampaignId(camp.id)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition flex items-center gap-2 ${
                  isSelected
                    ? 'bg-[#0B1F3A] text-[#D4AF37] shadow'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Dia {camp.day} - {camp.title}</span>
              </button>
            );
          })}
        </div>

        {activeCampaign && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
            {/* Template Details */}
            <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-1 bg-[#0B1F3A]/10 text-[#0B1F3A] rounded-md text-[11px] font-bold">
                  Campanha Dia {activeCampaign.day}
                </span>
                <span className="text-xs text-slate-500">{activeCampaign.targetAudience}</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Assunto do E-mail</label>
                <div className="p-2.5 bg-white rounded-lg border border-slate-300 text-xs font-medium text-slate-800">
                  {activeCampaign.subject}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Título / Headline</label>
                <div className="p-2.5 bg-white rounded-lg border border-slate-300 text-xs text-slate-800">
                  {activeCampaign.headline}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Texto do Botão (CTA)</label>
                <div className="p-2.5 bg-white rounded-lg border border-slate-300 text-xs font-bold text-[#0B1F3A] bg-amber-50/50">
                  {activeCampaign.ctaText}
                </div>
              </div>
            </div>

            {/* Dry-Run Simulation Box */}
            <div className="bg-amber-50/40 p-5 rounded-xl border border-amber-200/60 space-y-4">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                <Play className="w-4 h-4 text-[#D4AF37]" />
                <span>Simulador de Envio Seguro (Dry-Run)</span>
              </div>
              <p className="text-xs text-slate-600">
                Execute um teste controlado validando o motor de campanhas (`sendCampaignEmailWithGuards`) sem disparar e-mails reais e sem acessar o Firestore de produção.
              </p>

              <form onSubmit={handleRunSimulation} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">UID do Usuário de Teste</label>
                  <input
                    type="text"
                    value={simUid}
                    onChange={e => setSimUid(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail do Destinatário</label>
                  <input
                    type="email"
                    value={simEmail}
                    onChange={e => setSimEmail(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={simLoading}
                  className="w-full py-2 bg-[#D4AF37] hover:bg-[#c29e2e] text-[#0B1F3A] font-bold text-xs uppercase rounded-lg shadow-sm transition flex items-center justify-center gap-2"
                >
                  {simLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Executar Teste Simulado (Dry-Run)</span>
                </button>
              </form>

              {simResult && (
                <div className={`p-3 rounded-lg text-xs border ${simResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  <p className="font-bold">{simResult.success ? '✅ Simulação Concluída com Sucesso' : '❌ Falha na Simulação'}</p>
                  <pre className="mt-1 text-[10px] overflow-x-auto bg-white/80 p-2 rounded border border-slate-200 text-slate-700 font-mono">
                    {JSON.stringify(simResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
