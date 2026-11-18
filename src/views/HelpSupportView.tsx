import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  ChevronDown,
  ShieldCheck,
  HelpCircle,
  Copy,
  Check,
  AlertCircle,
  ExternalLink,
  Crown,
  User,
} from 'lucide-react';
import { ActiveTab } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  SUPPORT_EMAIL,
  SUPPORT_SUBJECT_OPTIONS,
  SUPPORT_FAQ_ITEMS,
  SupportSubjectOption,
  buildDirectSupportMailtoUrl,
  buildSupportMailtoUrl,
} from '../utils/supportCenter';

interface HelpSupportViewProps {
  onSelectTab: (tab: ActiveTab) => void;
}

export const HelpSupportView: React.FC<HelpSupportViewProps> = ({ onSelectTab }) => {
  const { currentUser, userProfile } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState<SupportSubjectOption>('Pagamento');
  const [description, setDescription] = useState('');

  const [formError, setFormError] = useState<string | null>(null);
  const [preparedMailtoUrl, setPreparedMailtoUrl] = useState<string | null>(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [openFaqIds, setOpenFaqIds] = useState<Record<string, boolean>>({
    'acessar-premium': true,
  });

  // Pre-fill user name and email cleanly when available, never using fallback placeholder strings
  useEffect(() => {
    const candidateName = (userProfile?.name || currentUser?.displayName || '').trim();
    if (
      candidateName &&
      candidateName.toLowerCase() !== 'estudante' &&
      candidateName.toLowerCase() !== 'estudante concurseiro'
    ) {
      setName((prev) => prev || candidateName);
    }

    const candidateEmail = (currentUser?.email || (userProfile?.isRegistered ? userProfile.email : '') || '').trim();
    if (candidateEmail && candidateEmail !== 'estudante@aprovadireito.com.br') {
      setEmail((prev) => prev || candidateEmail);
    }
  }, [currentUser?.displayName, currentUser?.email, userProfile?.name, userProfile?.email, userProfile?.isRegistered]);

  const toggleFaq = (id: string) => {
    setOpenFaqIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopyEmail = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(SUPPORT_EMAIL);
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2500);
      }
    } catch {
      // Clipboard may be blocked in restricted browser contexts
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setFormError('Descreva o problema ou dúvida antes de abrir seu aplicativo de e-mail.');
      return;
    }

    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Informe um endereço de e-mail válido ou deixe o campo em branco.');
      return;
    }

    const mailtoUrl = buildSupportMailtoUrl({
      name,
      email: trimmedEmail,
      subject,
      description: trimmedDescription,
    });

    setPreparedMailtoUrl(mailtoUrl);

    // Trigger user's default mail client via standard anchor click (avoids window.open / popup blocks)
    const anchor = document.createElement('a');
    anchor.href = mailtoUrl;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8 sm:space-y-10 animate-fade-in">
      {/* Page Header */}
      <header className="bg-[#0B1F3A] text-white rounded-2xl p-6 sm:p-8 border border-[#D4AF37]/30 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl min-w-0">
            <div className="flex items-center gap-2 text-[#D4AF37] text-xs font-semibold tracking-wide">
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span>Central de Atendimento · Aprova Direito</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold font-serif text-white tracking-tight">
              Ajuda e Suporte
            </h1>
            <p className="text-sm text-slate-200 leading-relaxed max-w-prose">
              Tire dúvidas sobre sua assinatura Premium, acesso às questões e apostilas ou envie uma solicitação diretamente para a nossa equipe de atendimento.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href={buildDirectSupportMailtoUrl()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] rounded-xl bg-[#D4AF37] hover:bg-[#E6C86E] text-[#0B1F3A] font-bold text-xs sm:text-sm shadow-sm transition-colors whitespace-nowrap shrink-0"
            >
              <Mail className="w-4 h-4 shrink-0" />
              <span>Enviar e-mail ao suporte</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main 2-Column Content: Direct Channel + Contact Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
        {/* Left Column: Official Channel, Quick Shortcuts & Security */}
        <aside className="lg:col-span-5 space-y-5 min-w-0">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold font-serif text-[#0B1F3A]">
                Canal Oficial de Atendimento
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Para dúvidas sobre pagamentos, recuperação de acesso ou suporte técnico, escreva diretamente para o nosso e-mail oficial.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="space-y-1 min-w-0">
                <span className="text-xs font-medium text-slate-500 block">
                  E-mail oficial de suporte
                </span>
                <p className="text-sm font-bold text-[#0B1F3A] break-all">
                  {SUPPORT_EMAIL}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href={buildDirectSupportMailtoUrl()}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs transition-colors whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span>Enviar e-mail ao suporte</span>
                </a>

                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedEmail ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>Copiar e-mail</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onSelectTab('premium')}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0B1F3A] font-semibold text-xs transition-colors whitespace-nowrap"
              >
                <Crown className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                <span>Verificar Status Premium</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTab('perfil')}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-100 hover:bg-slate-200 text-[#0B1F3A] font-semibold text-xs transition-colors whitespace-nowrap"
              >
                <User className="w-3.5 h-3.5 text-[#0B1F3A] shrink-0" />
                <span>Meu Perfil</span>
              </button>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-2.5">
            <div className="flex items-center gap-2 text-[#0B1F3A] font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Orientação de Segurança</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Nossa equipe nunca solicita sua senha de acesso, código de verificação ou número completo do cartão de crédito. Ao enviar sua mensagem, informe apenas o e-mail da conta e uma descrição objetiva da situação.
            </p>
          </section>
        </aside>

        {/* Right Column: Contact Form */}
        <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 shadow-sm space-y-6 min-w-0">
          <div className="space-y-1 border-b border-slate-100 pb-4">
            <h2 className="text-lg sm:text-xl font-bold font-serif text-[#0B1F3A]">
              Formulário de Contato
            </h2>
            <p className="text-xs sm:text-sm text-slate-600">
              Preencha os campos abaixo. Ao clicar em <strong>Enviar solicitação</strong>, seu aplicativo de e-mail será aberto com destinatário, assunto e descrição prontos para você revisar e enviar.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="support-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Nome do usuário
                </label>
                <input
                  id="support-name"
                  type="text"
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full min-w-0 px-3.5 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] focus:border-[#0B1F3A]"
                />
              </div>

              <div>
                <label
                  htmlFor="support-email"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  E-mail do usuário
                </label>
                <input
                  id="support-email"
                  type="email"
                  maxLength={160}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="w-full min-w-0 px-3.5 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] focus:border-[#0B1F3A]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="support-subject"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Assunto
              </label>
              <select
                id="support-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value as SupportSubjectOption)}
                className="w-full min-w-0 px-3.5 py-2.5 min-h-[44px] text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] focus:border-[#0B1F3A]"
              >
                {SUPPORT_SUBJECT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="support-description"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Descrição do problema <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="support-description"
                required
                rows={5}
                maxLength={2000}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Explique o que aconteceu, a tela em que ocorreu e, se for sobre pagamento, a data aproximada do pagamento (sem informar senhas ou dados de cartão)."
                className="w-full min-w-0 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] focus:border-[#0B1F3A] resize-y"
              />
            </div>

            {formError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {preparedMailtoUrl && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-2">
                <p className="font-semibold">
                  Aplicativo de e-mail acionado para {SUPPORT_EMAIL}
                </p>
                <p className="leading-relaxed text-amber-900">
                  A mensagem ainda não foi enviada automaticamente pelo site. Conclua o envio no seu aplicativo de e-mail para que nossa equipe receba sua solicitação.
                </p>
                <a
                  href={preparedMailtoUrl}
                  className="inline-flex items-center gap-1.5 font-bold text-[#0B1F3A] hover:underline"
                >
                  <span>Abrir aplicativo de e-mail novamente</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </a>
              </div>
            )}

            <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="text-xs text-slate-500">
                Destinatário: <strong className="text-slate-700">{SUPPORT_EMAIL}</strong>
              </span>

              <button
                type="submit"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] bg-[#0B1F3A] hover:bg-[#16365C] text-[#D4AF37] font-bold text-xs sm:text-sm rounded-xl shadow-sm transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>Enviar solicitação</span>
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Expandable FAQ Section */}
      <section
        aria-labelledby="faq-heading"
        className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-8 shadow-sm space-y-5"
      >
        <div className="space-y-1 border-b border-slate-100 pb-4">
          <h2 id="faq-heading" className="text-lg sm:text-xl font-bold font-serif text-[#0B1F3A]">
            Perguntas Frequentes
          </h2>
          <p className="text-xs sm:text-sm text-slate-600">
            Respostas diretas sobre planos, pagamento, cancelamento e recuperação de acesso no Aprova Direito.
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {SUPPORT_FAQ_ITEMS.map((item) => {
            const isOpen = Boolean(openFaqIds[item.id]);
            const panelId = `faq-panel-${item.id}`;
            const buttonId = `faq-btn-${item.id}`;
            return (
              <div key={item.id} className="py-1">
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => toggleFaq(item.id)}
                  className="w-full flex items-center justify-between gap-4 py-3.5 min-h-[48px] text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B1F3A] rounded-lg px-1"
                >
                  <span className="text-sm sm:text-base font-semibold text-[#0B1F3A] group-hover:text-[#16365C]">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#0B1F3A] shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-[#D4AF37]' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="pb-4 px-1 text-xs sm:text-sm text-slate-600 leading-relaxed max-w-4xl"
                  >
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
