import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QuestionItem } from '../types';
import { useAuth } from '../context/AuthContext';
import {
  fetchAiTutorStatus,
  askQuestionAiTutor,
  ApiAccessError,
  AiTutorMessageItem,
  AiTutorQuotaStatus,
} from '../services/contentService';
import {
  GraduationCap,
  X,
  Send,
  RotateCcw,
  ShieldAlert,
  Lock,
  Crown,
  LogIn,
  Scale,
  Info,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

interface QuestionAiTutorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  question: QuestionItem;
  disciplineName: string;
  isQuestionAnsweredInView: boolean;
  messages: AiTutorMessageItem[];
  onAppendMessages: (questionId: string, added: AiTutorMessageItem[]) => void;
  onResetConversation: (questionId: string) => void;
  onOpenAuth?: () => void;
  onOpenPremium?: () => void;
}

const UNLOCKED_PROMPTS: string[] = [
  'Por que essa alternativa está correta?',
  'Por que as demais estão erradas?',
  'Qual artigo de lei fundamenta a resposta?',
  'Pode explicar de forma mais simples?',
  'Como a FGV costuma cobrar esse assunto?',
  'Pode dar um exemplo prático?',
  'Pode criar uma questão semelhante?',
];

const LOCKED_PROMPTS: string[] = [
  'Explique os conceitos jurídicos do enunciado sem revelar o gabarito',
  'Pode explicar este tema de forma mais simples?',
  'Como a FGV costuma cobrar esse assunto?',
  'Pode dar um exemplo prático desse instituto?',
];

export const QuestionAiTutorPanel: React.FC<QuestionAiTutorPanelProps> = ({
  isOpen,
  onClose,
  question,
  disciplineName,
  isQuestionAnsweredInView,
  messages,
  onAppendMessages,
  onResetConversation,
  onOpenAuth,
  onOpenPremium,
}) => {
  const { currentUser, isPremiumActive } = useAuth();

  const [inputText, setInputText] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(false);
  const [quota, setQuota] = useState<AiTutorQuotaStatus | null>(null);
  const [solutionUnlocked, setSolutionUnlocked] = useState<boolean>(false);
  const [premiumLimitHint, setPremiumLimitHint] = useState<number>(30);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const pendingPromptRef = useRef<string>('');

  const cancelActiveRequest = useCallback((restorePrompt = false) => {
    activeRequestIdRef.current += 1;
    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
      activeAbortRef.current = null;
    }
    if (restorePrompt && pendingPromptRef.current) {
      setInputText((prev) => (prev.trim() ? prev : pendingPromptRef.current));
    }
    pendingPromptRef.current = '';
    setSending(false);
  }, []);

  // Abort in-flight AI call cleanly when panel closes, question changes, or component unmounts
  useEffect(() => {
    return () => {
      activeRequestIdRef.current += 1;
      if (activeAbortRef.current) {
        activeAbortRef.current.abort();
        activeAbortRef.current = null;
      }
      setSending(false);
    };
  }, [isOpen, question?.id]);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    if (!isOpen || !currentUser || !question?.id) return;
    setLoadingStatus(true);
    setErrorMessage(null);
    try {
      const status = await fetchAiTutorStatus(question.id, { signal });
      if (signal?.aborted) return;
      if (status?.quota) {
        setQuota(status.quota);
        setLimitReached(status.quota.remainingToday <= 0);
      }
      setSolutionUnlocked(Boolean(status?.solutionUnlocked));
      if (typeof status?.limits?.premiumDailyLimit === 'number') {
        setPremiumLimitHint(status.limits.premiumDailyLimit);
      }
    } catch (err: any) {
      if (signal?.aborted || (err instanceof ApiAccessError && err.code === 'REQUEST_ABORTED')) {
        return;
      }
      setErrorMessage(
        err?.message || 'Não foi possível verificar sua cota do Professor IA no momento.'
      );
    } finally {
      if (!signal?.aborted) {
        setLoadingStatus(false);
      }
    }
  }, [isOpen, currentUser, question?.id]);

  useEffect(() => {
    const controller = new AbortController();
    refreshStatus(controller.signal);
    return () => controller.abort();
  }, [refreshStatus, isQuestionAnsweredInView, isPremiumActive]);

  useEffect(() => {
    if (isOpen && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [isOpen, messages.length, sending]);

  if (!isOpen) return null;

  const handleSendQuestion = async (rawPrompt: string) => {
    const text = rawPrompt.trim();
    if (!text || sending || !currentUser) return;

    if (activeAbortRef.current) {
      activeAbortRef.current.abort();
    }

    const controller = new AbortController();
    activeAbortRef.current = controller;
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    const targetQuestionId = question.id;

    setSending(true);
    setErrorMessage(null);

    const userMsg: AiTutorMessageItem = {
      id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    const historyPayload = messages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    pendingPromptRef.current = text;
    setInputText('');

    try {
      const response = await askQuestionAiTutor(
        {
          questionId: targetQuestionId,
          message: text,
          history: historyPayload,
        },
        { signal: controller.signal }
      );

      if (requestId !== activeRequestIdRef.current) return;

      const cleanAnswer =
        typeof response?.answer === 'string' ? response.answer.trim() : '';
      if (!cleanAnswer) {
        setErrorMessage(
          'O Professor Virtual retornou uma resposta vazia. Tente novamente em instantes — nenhuma consulta foi descontada.'
        );
        setInputText(text);
        return;
      }

      const assistantMsg: AiTutorMessageItem = {
        id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: cleanAnswer,
        timestamp: new Date().toISOString(),
      };

      pendingPromptRef.current = '';
      onAppendMessages(targetQuestionId, [userMsg, assistantMsg]);
      if (response.quota) {
        setQuota(response.quota);
        setLimitReached(response.quota.remainingToday <= 0);
      }
      if (typeof response.solutionUnlocked === 'boolean') {
        setSolutionUnlocked(response.solutionUnlocked);
      }
    } catch (err: any) {
      if (requestId !== activeRequestIdRef.current) return;

      if (err instanceof ApiAccessError && err.code === 'REQUEST_ABORTED') {
        setInputText(text);
        return;
      }

      if (err instanceof ApiAccessError && err.code === 'AI_DAILY_LIMIT_REACHED') {
        setLimitReached(true);
        if (err.details?.quota) {
          setQuota(err.details.quota);
        }
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          err?.message ||
            'Não foi possível obter resposta do Professor IA no momento. Tente novamente em instantes.'
        );
      }
      // Restore text so the student doesn't lose what they typed
      setInputText(text);
    } finally {
      if (requestId === activeRequestIdRef.current) {
        activeAbortRef.current = null;
        pendingPromptRef.current = '';
        setSending(false);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendQuestion(inputText);
  };

  const quickPrompts = solutionUnlocked ? UNLOCKED_PROMPTS : LOCKED_PROMPTS;

  return (
    <section
      aria-label="Professor Virtual com Inteligência Artificial"
      className="mt-5 rounded-2xl border-2 border-[#0B1F3A]/20 bg-white shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="bg-[#0B1F3A] text-white px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-white/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37] shrink-0">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold font-serif text-white leading-tight truncate">
              Professor Virtual IA · {disciplineName}
            </h3>
            <p className="text-[11px] text-slate-300 truncate">
              Assunto: {question.subject} · Questão {question.id}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onResetConversation(question.id);
                setErrorMessage(null);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
              title="Iniciar nova consulta para esta questão"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#D4AF37]" />
              <span>Nova consulta</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Professor IA"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-header: Quota + Anti-spoiler notice */}
      <div className="px-4 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-600 min-w-0">
          <Scale className="w-3.5 h-3.5 text-[#9A7B16] shrink-0" />
          <span className="break-words">
            {currentUser
              ? solutionUnlocked
                ? 'Modo análise completa: gabarito e fundamentação da questão disponíveis.'
                : 'Modo orientador: responda a questão primeiro para liberar o gabarito e o comentário oficial.'
              : 'Entre na sua conta para conversar com o Professor Virtual sobre esta questão.'}
          </span>
        </div>

        {currentUser && quota && (
          <span className="font-semibold text-[#0B1F3A] tabular-nums whitespace-nowrap shrink-0">
            {quota.remainingToday} de {quota.dailyLimit} consultas restantes hoje (
            {quota.planType === 'premium' ? 'Premium' : 'Gratuito'})
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 sm:p-5 space-y-4">
        {/* Unauthenticated Gate */}
        {!currentUser ? (
          <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
            <div className="w-10 h-10 rounded-xl bg-[#0B1F3A] text-[#D4AF37] flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h4 className="text-sm font-bold text-[#0B1F3A]">
                Autenticação necessária para consultar o Professor IA
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Faça login na sua conta para tirar dúvidas jurídicas sobre enunciados, alternativas e artigos de lei com segurança e controle de cota.
              </p>
            </div>
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-4 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-[#D4AF37] text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Entrar na minha conta</span>
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Anti-spoiler Notice when Free user hasn't answered yet */}
            {!loadingStatus && !solutionUnlocked && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[#9A7B16] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  <strong>Proteção de gabarito ativa:</strong> enquanto você não responder esta questão, o Professor IA explicará os conceitos jurídicos envolvidos sem revelar qual alternativa é a correta.
                </p>
              </div>
            )}

            {/* Quick Suggested Questions */}
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Perguntas rápidas para esta questão
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending || limitReached}
                    onClick={() => handleSendQuestion(prompt)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-[#0B1F3A] hover:text-white hover:border-[#0B1F3A] text-slate-700 text-xs font-medium text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation History */}
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 text-xs text-slate-600 leading-relaxed">
                  Selecione uma das perguntas rápidas acima ou escreva sua dúvida jurídica específica abaixo. O histórico desta conversa permanece salvo durante a sessão enquanto você navega entre as questões.
                </div>
              ) : (
                messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${
                          isUser
                            ? 'bg-[#0B1F3A] text-white'
                            : 'bg-slate-50 border border-slate-200 text-slate-800'
                        }`}
                      >
                        <div
                          className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${
                            isUser ? 'text-[#D4AF37]' : 'text-[#0B1F3A]'
                          }`}
                        >
                          {isUser ? 'Você' : 'Professor Virtual IA'}
                        </div>
                        <div className="whitespace-pre-line">{msg.content}</div>
                      </div>
                    </div>
                  );
                })
              )}

              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-4 py-3 bg-slate-50 border border-slate-200 text-xs text-slate-600 flex flex-wrap items-center gap-2.5">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-[#0B1F3A] animate-spin shrink-0" />
                      <span>Analisando o enunciado e a fundamentação jurídica...</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        cancelActiveRequest(true);
                        setErrorMessage('Consulta cancelada.');
                      }}
                      className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Error or Quota Reached Alert */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  {limitReached ? (
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
                {limitReached && quota?.planType === 'free' && onOpenPremium && (
                  <button
                    type="button"
                    onClick={onOpenPremium}
                    className="px-3.5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-[#D4AF37] text-xs font-bold inline-flex items-center gap-1.5 shrink-0 self-start sm:self-auto"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    <span>Ampliar para {premiumLimitHint}/dia</span>
                  </button>
                )}
              </div>
            )}

            {/* Input Form */}
            <form onSubmit={handleFormSubmit} className="flex flex-col sm:flex-row gap-2 pt-1">
              <input
                type="text"
                maxLength={600}
                disabled={sending || limitReached}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  limitReached
                    ? 'Limite diário de consultas ao Professor IA atingido.'
                    : 'Digite sua dúvida sobre esta questão (ex.: qual a pegadinha da alternativa C?)...'
                }
                aria-label="Pergunta ao Professor Virtual IA"
                className="flex-1 min-w-0 px-3.5 py-2.5 text-xs sm:text-sm border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0B1F3A] disabled:bg-slate-100 disabled:text-slate-400"
              />
              <button
                type="submit"
                disabled={sending || limitReached || inputText.trim().length < 2}
                className="px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#132E54] text-[#D4AF37] text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </button>
            </form>

            {/* Legal Accuracy Disclaimer */}
            <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-2.5">
              Aviso pedagógico: as respostas do Professor Virtual são geradas por inteligência artificial com base nos dados da questão e têm caráter complementar de estudo — não substituem o gabarito oficial da banca nem a conferência direta da legislação vigente.
            </p>
          </>
        )}
      </div>
    </section>
  );
};
