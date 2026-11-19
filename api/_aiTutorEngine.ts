import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Question } from '../src/types/index.js';

export const DEFAULT_FREE_AI_DAILY_LIMIT = 3;
export const DEFAULT_PREMIUM_AI_DAILY_LIMIT = 30;
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

export const GEMINI_REQUEST_TIMEOUT_MS = 18_000;

export const DEFAULT_MAX_OUTPUT_TOKENS = 480;
export const COMPLEX_MAX_OUTPUT_TOKENS = 760;

export const MAX_QUESTION_PROMPT_LENGTH = 600;
export const MAX_HISTORY_MESSAGES = 4;
export const MAX_HISTORY_ITEM_LENGTH = 450;

const PROHIBITED_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
  'gemini-2.0-flash-thinking',
]);

export interface AiTutorChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiTutorQuotaInfo {
  dateKey: string;
  planType: 'free' | 'premium';
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
}

export interface AiTutorGenerationResult {
  answer: string;
  model: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

export type AiTutorGenerateFn = (params: {
  model: string;
  systemInstruction: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  maxOutputTokens?: number;
}) => Promise<AiTutorGenerationResult>;

export function getAiTutorLimits(env: NodeJS.ProcessEnv = process.env): {
  freeDailyLimit: number;
  premiumDailyLimit: number;
} {
  const parseLimit = (raw: string | undefined, fallback: number, max: number) => {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 1) return fallback;
    return Math.min(max, Math.floor(num));
  };

  return {
    freeDailyLimit: parseLimit(env.AI_TUTOR_FREE_DAILY_LIMIT, DEFAULT_FREE_AI_DAILY_LIMIT, 50),
    premiumDailyLimit: parseLimit(
      env.AI_TUTOR_PREMIUM_DAILY_LIMIT,
      DEFAULT_PREMIUM_AI_DAILY_LIMIT,
      300
    ),
  };
}

export function resolveGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.GEMINI_MODEL || '').trim();
  if (!configured || PROHIBITED_MODELS.has(configured.toLowerCase())) {
    return DEFAULT_GEMINI_MODEL;
  }
  return configured;
}

export function buildThinkingConfigForModel(
  model: string
): { thinkingLevel: ThinkingLevel } | undefined {
  const normalized = model.trim().toLowerCase();
  if (normalized === 'gemini-3.1-flash-lite' || (normalized.startsWith('gemini-3') && normalized.includes('lite'))) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  if (normalized.startsWith('gemini-4') || normalized.startsWith('gemini-3')) {
    return { thinkingLevel: ThinkingLevel.LOW };
  }
  return undefined;
}

const COMPLEX_PROMPT_PATTERN =
  /quest[ãa]o semelhante|criar.*quest[ãa]o|todas as alternativas|demais.*errad|cada alternativa|alternativa por alternativa|detalh|aprofund|passo a passo|diferen[çc]a entre|compare/i;

export function resolveMaxOutputTokens(userMessage: string): number {
  const normalized = userMessage.trim();
  if (normalized.length > 220 || COMPLEX_PROMPT_PATTERN.test(normalized)) {
    return COMPLEX_MAX_OUTPUT_TOKENS;
  }
  return DEFAULT_MAX_OUTPUT_TOKENS;
}

export function sanitizeUserMessage(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_PROMPT_LENGTH);
}

export function sanitizeConversationHistory(raw: unknown): AiTutorChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: AiTutorChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role =
      (item as any).role === 'assistant'
        ? 'assistant'
        : (item as any).role === 'user'
          ? 'user'
          : null;
    if (!role || typeof (item as any).content !== 'string') continue;
    const normalized = (item as any).content.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const content =
      normalized.length > MAX_HISTORY_ITEM_LENGTH
        ? `${normalized.slice(0, MAX_HISTORY_ITEM_LENGTH - 3).trimEnd()}...`
        : normalized;
    cleaned.push({ role, content });
  }
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Builds concise legal-pedagogical system instructions for OAB and legal exams.
 * Minimizes prompt tokens while preserving strict anti-hallucination and anti-spoiler safeguards.
 */
export function buildAiTutorSystemInstruction(params: {
  canViewSolution: boolean;
}): string {
  const baseRules = [
    'Você é o Professor Virtual de Direito do Aprova Direito (OAB/FGV e concursos).',
    'Responda em português do Brasil, direto à dúvida, sem saudações, sem repetir o enunciado/alternativas e sem conclusões genéricas. Use tópicos curtos; respostas curtas para dúvidas simples e explicação objetiva para análises completas.',
    'Precisão jurídica:',
    '1. NUNCA invente números de artigos de lei, súmulas ou julgados (STF/STJ/TST); cite apenas dispositivos fornecidos ou normas clássicas inequívocas.',
    '2. Diferencie norma legal, explicação pedagógica e jurisprudência consolidada quando aplicável; se faltar dado, declare.',
    '3. Apoio didático (não substitui o gabarito oficial). Se pedirem questão semelhante, gere 1 questão inédita padrão FGV (A–D) com breve justificativa.',
  ];

  if (!params.canViewSolution) {
    baseRules.push(
      'SEM SPOILER: aluno gratuito ainda não respondeu. VOCÊ ESTÁ TERMINANTEMENTE PROIBIDO de revelar, sugerir ou confirmar qual alternativa (A–D) é correta ou errada. Explique apenas os conceitos jurídicos e oriente a responder na tela.'
    );
  } else {
    baseRules.push(
      'GABARITO LIBERADO: mantenha coerência com o gabarito e a fundamentação fornecidos, destacando erros técnicos e pegadinhas da FGV quando solicitado.'
    );
  }

  return baseRules.join('\n');
}

/**
 * Assembles a compact, authorized question context sent to the LLM.
 * Avoids repeating explanation/legalFoundation when already represented.
 * CRITICAL: Never injects correctOptionId, explanation, or legalFoundation when canViewSolution is false.
 */
export function buildAiTutorQuestionContext(params: {
  question: Question;
  disciplineName: string;
  canViewSolution: boolean;
  selectedOptionId?: string | null;
}): string {
  const { question, disciplineName, canViewSolution, selectedOptionId } = params;

  const headerParts = [`Disciplina: ${disciplineName}`, `Assunto: ${question.subject}`];
  if (question.examReference) {
    headerParts.push(`Ref.: ${question.examReference}`);
  }

  const lines: string[] = [
    headerParts.join(' | '),
    `Enunciado: ${question.statement.trim()}`,
    'Alternativas:',
    ...question.options.map((opt) => `${opt.id}) ${opt.text.trim()}`),
  ];

  if (canViewSolution) {
    const answerParts = [`Gabarito oficial: Alternativa ${question.correctOptionId}`];
    if (selectedOptionId && ['A', 'B', 'C', 'D'].includes(selectedOptionId)) {
      answerParts.push(`Marcada pelo aluno: ${selectedOptionId}`);
    }
    lines.push(answerParts.join(' | '));

    const cleanExplanation = (question.explanation || '').trim();
    const cleanFoundation = (question.legalFoundation || '').trim();

    if (cleanExplanation) {
      lines.push(`Comentário: ${cleanExplanation}`);
    }
    if (
      cleanFoundation &&
      (!cleanExplanation || !cleanExplanation.toLowerCase().includes(cleanFoundation.toLowerCase()))
    ) {
      lines.push(`Fundamentação: ${cleanFoundation}`);
    }
  } else {
    lines.push('Status: Gabarito bloqueado (não revelar nem indicar alternativa correta).');
  }

  return lines.join('\n');
}

/**
 * Builds compact multi-turn contents without artificial priming turns or repeated question payloads.
 */
export function buildGeminiContents(params: {
  questionContext: string;
  history: AiTutorChatMessage[];
  userMessage: string;
}): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (params.history.length === 0) {
    contents.push({
      role: 'user',
      parts: [{ text: `${params.questionContext}\n\nDúvida do aluno: ${params.userMessage}` }],
    });
    return contents;
  }

  let contextAttached = false;
  for (const msg of params.history) {
    if (!contextAttached && msg.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text: `${params.questionContext}\n\nDúvida do aluno: ${msg.content}` }],
      });
      contextAttached = true;
    } else {
      if (!contextAttached) {
        contents.push({
          role: 'user',
          parts: [{ text: params.questionContext }],
        });
        contextAttached = true;
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  contents.push({
    role: 'user',
    parts: [{ text: params.userMessage }],
  });

  return contents;
}

export interface SanitizedSdkErrorDiagnostic {
  origin: 'local_abort_timeout' | 'sdk_api_error' | 'network_or_abort' | 'unknown';
  localTimedOut: boolean;
  abortSignalAborted: boolean;
  errorName: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  causeCode: string | null;
  googleCode: number | null;
  googleStatus: string | null;
  googleMessage: string | null;
}

export function sanitizeDiagnosticText(raw: unknown, maxLen = 240): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    // Redact Google API keys (e.g. AIza...)
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[REDACTED_KEY]')
    // Redact query parameters carrying secrets
    .replace(/([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"'}\]]+/gi, '$1[REDACTED]')
    // Redact key/header assignments
    .replace(
      /((?:api[_-]?key|x-goog-api-key|authorization)\s*[:=]\s*)(?:Bearer\s+)?[^\s"',}\]]+/gi,
      '$1[REDACTED]'
    )
    // Redact Bearer tokens
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED_TOKEN]')
    // Redact JWT tokens
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    // Redact e-mail addresses
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    // Redact CPF patterns
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED_CPF]')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}...` : cleaned;
}

function parseGoogleApiErrorPayload(rawMessage: string): {
  googleCode: number | null;
  googleStatus: string | null;
  googleMessage: string | null;
} {
  const trimmed = rawMessage.trim();
  let candidateJson: string | null = null;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    candidateJson = trimmed;
  } else {
    const startIdx = trimmed.indexOf('{');
    const endIdx = trimmed.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      candidateJson = trimmed.slice(startIdx, endIdx + 1);
    }
  }

  if (candidateJson) {
    try {
      const parsed = JSON.parse(candidateJson);
      const errObj = parsed && typeof parsed.error === 'object' ? parsed.error : parsed;
      if (errObj && typeof errObj === 'object') {
        const googleCode =
          typeof errObj.code === 'number' && Number.isFinite(errObj.code) ? errObj.code : null;
        const googleStatus =
          typeof errObj.status === 'string' ? sanitizeDiagnosticText(errObj.status, 64) : null;
        const googleMessage =
          typeof errObj.message === 'string'
            ? sanitizeDiagnosticText(errObj.message, 240)
            : sanitizeDiagnosticText(trimmed, 240);
        if (googleCode !== null || googleStatus !== null || googleMessage !== null) {
          return { googleCode, googleStatus, googleMessage };
        }
      }
    } catch {
      // Fallback to sanitized raw message below
    }
  }

  return {
    googleCode: null,
    googleStatus: null,
    googleMessage: sanitizeDiagnosticText(trimmed, 240),
  };
}

/**
 * Extracts strictly technical, sanitized diagnostic fields from a GoogleGenAI SDK error.
 * Never includes API keys, tokens, question content, answers, or personal data.
 */
export function extractSanitizedSdkError(
  err: any,
  context: { localTimedOut?: boolean; abortSignalAborted?: boolean } = {}
): SanitizedSdkErrorDiagnostic {
  const localTimedOut = Boolean(context.localTimedOut);
  const abortSignalAborted = Boolean(context.abortSignalAborted);

  const errorName =
    typeof err?.name === 'string' ? sanitizeDiagnosticText(err.name, 64) : null;

  const rawStatus = Number(err?.status ?? err?.statusCode ?? 0);
  const httpStatus = Number.isFinite(rawStatus) && rawStatus > 0 ? rawStatus : null;

  const errorCode =
    typeof err?.code === 'string' || typeof err?.code === 'number'
      ? sanitizeDiagnosticText(String(err.code), 64)
      : null;

  const rawCauseCode = err?.cause?.code ?? err?.cause?.name ?? null;
  const causeCode =
    typeof rawCauseCode === 'string' || typeof rawCauseCode === 'number'
      ? sanitizeDiagnosticText(String(rawCauseCode), 64)
      : null;

  const rawMessage = typeof err?.message === 'string' ? err.message : '';
  const { googleCode, googleStatus, googleMessage } = parseGoogleApiErrorPayload(rawMessage);

  let origin: SanitizedSdkErrorDiagnostic['origin'] = 'unknown';
  if (localTimedOut) {
    origin = 'local_abort_timeout';
  } else if (errorName === 'ApiError' || httpStatus !== null || googleStatus !== null) {
    origin = 'sdk_api_error';
  } else if (
    errorName === 'AbortError' ||
    errorName === 'TimeoutError' ||
    errorName === 'TypeError' ||
    errorCode !== null ||
    causeCode !== null
  ) {
    origin = 'network_or_abort';
  }

  return {
    origin,
    localTimedOut,
    abortSignalAborted,
    errorName,
    httpStatus,
    errorCode,
    causeCode,
    googleCode,
    googleStatus,
    googleMessage,
  };
}

export function isTimeoutGeminiError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const name = String(err?.name || '').toUpperCase();
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const msg = String(err?.message || '').toUpperCase();
  return (
    code === 'AI_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    name === 'ABORTERROR' ||
    name === 'TIMEOUTERROR' ||
    status === 408 ||
    status === 504 ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('TIMED OUT') ||
    msg.includes('TIMEOUT') ||
    msg.includes('ABORTED')
  );
}

export interface GeminiGeneratorOptions {
  timeoutMs?: number;
  clientFactory?: (config: {
    apiKey: string;
    httpOptions: {
      retryOptions: { attempts: number };
      headers: Record<string, string>;
    };
  }) => {
    models: {
      generateContent: (params: any) => Promise<{
        text?: string;
        usageMetadata?: any;
      }>;
    };
  };
}

/**
 * Creates a server-side Gemini generator using @google/genai.
 * Uses a single authoritative AbortController timeout (avoiding conflicting SDK
 * timers and premature X-Server-Timeout deadlines) and disables retries so every
 * consultation performs at most 1 bounded call to Gemini.
 * Never exposes GEMINI_API_KEY outside server runtime.
 */
export function createDefaultGeminiGenerator(
  apiKey: string | undefined = process.env.GEMINI_API_KEY,
  options: GeminiGeneratorOptions = {}
): AiTutorGenerateFn {
  const timeoutMs = Math.max(
    50,
    Math.min(25_000, Math.floor(options.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS))
  );

  return async ({ model, systemInstruction, contents, maxOutputTokens }) => {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey || cleanKey === 'MY_GEMINI_API_KEY') {
      const err: any = new Error('AI_PROVIDER_NOT_CONFIGURED');
      err.code = 'AI_PROVIDER_NOT_CONFIGURED';
      err.status = 503;
      throw err;
    }

    // Do NOT set httpOptions.timeout alongside AbortController: the SDK turns
    // httpOptions.timeout into both a second AbortController and an X-Server-Timeout
    // header that caused premature Google 504 DEADLINE_EXCEEDED responses (~15s).
    const clientConfig = {
      apiKey: cleanKey,
      httpOptions: {
        retryOptions: {
          attempts: 1,
        },
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    };

    const ai = options.clientFactory
      ? options.clientFactory(clientConfig)
      : new GoogleGenAI(clientConfig);

    const thinkingConfig = buildThinkingConfigForModel(model);
    const effectiveMaxOutputTokens =
      typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens >= 64
        ? Math.min(COMPLEX_MAX_OUTPUT_TOKENS, Math.floor(maxOutputTokens))
        : DEFAULT_MAX_OUTPUT_TOKENS;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: effectiveMaxOutputTokens,
          abortSignal: controller.signal,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });

      const text = (response.text || '').trim();
      if (!text) {
        const emptyErr: any = new Error('O provedor de IA retornou uma resposta vazia.');
        emptyErr.code = 'AI_EMPTY_RESPONSE';
        emptyErr.status = 502;
        throw emptyErr;
      }

      const meta: any = response.usageMetadata || {};
      return {
        answer: text,
        model,
        usage: {
          inputTokens:
            typeof meta.promptTokenCount === 'number' ? meta.promptTokenCount : null,
          outputTokens:
            typeof meta.candidatesTokenCount === 'number' ? meta.candidatesTokenCount : null,
          totalTokens:
            typeof meta.totalTokenCount === 'number' ? meta.totalTokenCount : null,
        },
      };
    } catch (err: any) {
      const sdkDiagnostic = extractSanitizedSdkError(err, {
        localTimedOut: timedOut,
        abortSignalAborted: controller.signal.aborted,
      });

      if (timedOut || isTimeoutGeminiError(err)) {
        const timeoutErr: any = new Error('Tempo limite excedido ao aguardar o provedor de IA.');
        timeoutErr.code = 'AI_TIMEOUT';
        timeoutErr.status = 504;
        timeoutErr.sdkDiagnostic = sdkDiagnostic;
        throw timeoutErr;
      }

      if (err && typeof err === 'object') {
        try {
          err.sdkDiagnostic = sdkDiagnostic;
        } catch {
          // ignore non-extensible error objects
        }
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
