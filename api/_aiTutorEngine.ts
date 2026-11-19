import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { Question } from '../src/types/index.js';

export const DEFAULT_FREE_AI_DAILY_LIMIT = 3;
export const DEFAULT_PREMIUM_AI_DAILY_LIMIT = 30;
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export const MAX_QUESTION_PROMPT_LENGTH = 600;
export const MAX_HISTORY_MESSAGES = 6;
export const MAX_HISTORY_ITEM_LENGTH = 1200;

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

export function sanitizeUserMessage(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_PROMPT_LENGTH);
}

export function sanitizeConversationHistory(raw: unknown): AiTutorChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: AiTutorChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as any).role === 'assistant' ? 'assistant' : (item as any).role === 'user' ? 'user' : null;
    const content =
      typeof (item as any).content === 'string'
        ? (item as any).content.trim().slice(0, MAX_HISTORY_ITEM_LENGTH)
        : '';
    if (!role || !content) continue;
    cleaned.push({ role, content });
  }
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

/**
 * Builds strict legal-pedagogical system instructions for OAB and legal exams.
 * Enforces anti-hallucination rules and strict anti-spoiler protection when solution is locked.
 */
export function buildAiTutorSystemInstruction(params: {
  canViewSolution: boolean;
}): string {
  const baseRules = [
    'Você é o Professor Virtual de Direito do aplicativo Aprova Direito, especialista na preparação para o Exame de Ordem (OAB/FGV) e concursos públicos jurídicos no Brasil.',
    'Responda sempre em português do Brasil, de forma clara, didática, objetiva e organizada em tópicos curtos quando útil (idealmente entre 150 e 380 palavras, salvo se o aluno pedir uma questão semelhante ou detalhamento completo das quatro alternativas).',
    'DIRETRIZES RÍGIDAS DE PRECISÃO JURÍDICA:',
    '1. NUNCA invente números de artigos de lei, incisos, parágrafos, leis, súmulas ou julgados (STF/STJ/TST). Cite apenas dispositivos presentes na fundamentação fornecida ou normas clássicas e inequívocas das quais você tenha certeza absoluta.',
    '2. Diferencie claramente em sua explicação: (a) Texto legal / norma aplicável, (b) Interpretação doutrinária ou pedagógica, e (c) Entendimento jurisprudencial (quando aplicável e realmente consolidado).',
    '3. Quando não houver informação suficiente na questão ou na fundamentação disponível para confirmar um detalhe específico, declare isso com transparência.',
    '4. Priorize sempre o conteúdo da questão fornecida e a fundamentação jurídica cadastrada no banco.',
    '5. Nunca apresente sua resposta como se fosse o gabarito oficial da banca examinadora; trate-a como orientação didática de apoio ao estudo.',
    '6. Se o aluno pedir uma questão semelhante para treino, crie 1 questão inédita no padrão FGV com 4 alternativas (A a D) e forneça uma breve explicação pedagógica ao final.',
  ];

  if (!params.canViewSolution) {
    baseRules.push(
      'REGRA ABSOLUTA DE BLOQUEIO DE GABARITO (MODO ORIENTADOR SEM SPOILER):',
      '- Este aluno ainda NÃO respondeu a questão e NÃO tem autorização para ver o gabarito oficial neste momento.',
      '- VOCÊ ESTÁ TERMINANTEMENTE PROIBIDO de revelar, sugerir, confirmar ou insinuar qual alternativa (A, B, C ou D) é a correta ou quais são as erradas.',
      '- Mesmo que o aluno pergunte diretamente "qual é a resposta certa?" ou "por que a letra X está correta?", recuse educadamente revelar o gabarito antes da resposta e ofereça explicação conceitual dos institutos jurídicos envolvidos no enunciado para ajudá-lo a raciocinar sozinho.',
      '- Incentive o aluno a marcar sua resposta na tela para desbloquear o gabarito oficial, o comentário completo e a análise alternativa por alternativa.'
    );
  } else {
    baseRules.push(
      'MODO ANÁLISE COMPLETA (GABARITO LIBERADO):',
      '- O aluno já tem autorização para visualizar o gabarito e o comentário oficial fornecidos no contexto.',
      '- Quando perguntado, explique com clareza por que a alternativa correta está alinhada ao ordenamento jurídico e por que cada uma das demais alternativas apresenta erro técnico, pegadinha típica da FGV ou contradição com a lei.',
      '- Mantenha coerência com o gabarito oficial e a fundamentação jurídica fornecidos no contexto da questão.'
    );
  }

  return baseRules.join('\n');
}

/**
 * Assembles the authorized question context sent to the LLM.
 * CRITICAL: Never injects correctOptionId, explanation, or legalFoundation when canViewSolution is false.
 */
export function buildAiTutorQuestionContext(params: {
  question: Question;
  disciplineName: string;
  canViewSolution: boolean;
  selectedOptionId?: string | null;
}): string {
  const { question, disciplineName, canViewSolution, selectedOptionId } = params;

  const lines: string[] = [
    '=== CONTEXTO DA QUESTÃO SELECIONADA ===',
    `ID da questão: ${question.id}`,
    `Disciplina: ${disciplineName}`,
    `Assunto: ${question.subject}`,
    `Dificuldade: ${question.difficulty}`,
  ];

  if (question.examReference) {
    lines.push(`Referência: ${question.examReference}`);
  }

  lines.push('', 'Enunciado:', question.statement, '', 'Alternativas:');
  for (const opt of question.options) {
    lines.push(`${opt.id}) ${opt.text}`);
  }

  if (canViewSolution) {
    lines.push(
      '',
      '=== DADOS OFICIAIS LIBERADOS PARA ESTE ALUNO ===',
      `Gabarito oficial cadastrado no banco: Alternativa ${question.correctOptionId}`,
      `Comentário oficial do banco: ${question.explanation || 'Não informado no banco.'}`,
      `Fundamentação jurídica cadastrada no banco: ${question.legalFoundation || 'Não informada no banco.'}`
    );
    if (selectedOptionId && ['A', 'B', 'C', 'D'].includes(selectedOptionId)) {
      lines.push(`Alternativa marcada pelo aluno: ${selectedOptionId}`);
    }
  } else {
    lines.push(
      '',
      '=== STATUS DE ACESSO ===',
      'Gabarito oficial e comentário oficial BLOQUEADOS (aluno gratuito ainda não respondeu esta questão). NÃO revele nem indique qual alternativa é a correta.'
    );
  }

  return lines.join('\n');
}

export function buildGeminiContents(params: {
  questionContext: string;
  history: AiTutorChatMessage[];
  userMessage: string;
}): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [
    {
      role: 'user',
      parts: [
        {
          text: `${params.questionContext}\n\nUtilize exclusivamente os dados acima como base principal para responder às dúvidas do aluno sobre esta questão.`,
        },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          text: 'Entendido. Analisei a questão e respeitarei integralmente as regras de precisão jurídica e o status de liberação do gabarito. Qual é a sua dúvida?',
        },
      ],
    },
  ];

  for (const msg of params.history) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: params.userMessage }],
  });

  return contents;
}

function isRetryableGeminiError(err: any): boolean {
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(err?.message || '').toUpperCase();
  return (
    msg.includes('UNAVAILABLE') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('FETCH FAILED')
  );
}

/**
 * Creates a server-side Gemini generator using @google/genai.
 * Never exposes GEMINI_API_KEY outside server runtime.
 */
export function createDefaultGeminiGenerator(
  apiKey: string | undefined = process.env.GEMINI_API_KEY
): AiTutorGenerateFn {
  return async ({ model, systemInstruction, contents }) => {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey || cleanKey === 'MY_GEMINI_API_KEY') {
      const err: any = new Error('AI_PROVIDER_NOT_CONFIGURED');
      err.code = 'AI_PROVIDER_NOT_CONFIGURED';
      err.status = 503;
      throw err;
    }

    const ai = new GoogleGenAI({
      apiKey: cleanKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    let lastErr: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.LOW,
            },
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
        lastErr = err;
        if (attempt === 0 && isRetryableGeminiError(err)) {
          await new Promise((resolve) => setTimeout(resolve, 450));
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  };
}
