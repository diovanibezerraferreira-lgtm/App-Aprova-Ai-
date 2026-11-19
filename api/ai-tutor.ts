import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { readJsonBody, getTodayDateKey } from './_accessControl.js';
import { MOCK_QUESTIONS } from './_data/questions.js';
import { OAB_DISCIPLINES } from './_data/disciplines.js';
import {
  buildAiTutorQuestionContext,
  buildAiTutorSystemInstruction,
  buildGeminiContents,
  createDefaultGeminiGenerator,
  extractSanitizedSdkError,
  getAiTutorLimits,
  isTimeoutGeminiError,
  resolveGeminiModel,
  sanitizeConversationHistory,
  sanitizeUserMessage,
  type AiTutorGenerateFn,
  type AiTutorQuotaInfo,
} from './_aiTutorEngine.js';

export interface AiTutorDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  readJsonBody: typeof readJsonBody;
  getTodayDateKey: () => string;
  generateAiAnswer: AiTutorGenerateFn;
  getLimits: typeof getAiTutorLimits;
  resolveModel: typeof resolveGeminiModel;
  nowMs?: () => number;
}

const defaultDeps: AiTutorDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  readJsonBody,
  getTodayDateKey,
  generateAiAnswer: (params) => createDefaultGeminiGenerator(process.env.GEMINI_API_KEY)(params),
  getLimits: getAiTutorLimits,
  resolveModel: resolveGeminiModel,
  nowMs: () => Date.now(),
};

const questionMap = new Map(MOCK_QUESTIONS.map((q) => [q.id, q]));
const disciplineNameMap = new Map<string, string>(OAB_DISCIPLINES.map((d) => [d.id, d.name]));

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function sanitizeKey(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function getQueryParams(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url || '/api/ai-tutor', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

async function resolveUserTutorContext(params: {
  db: any;
  uid: string;
  questionId: string;
  dateKey: string;
  nowMs: number;
  limits: { freeDailyLimit: number; premiumDailyLimit: number };
}) {
  const { db, uid, questionId, dateKey, nowMs, limits } = params;
  const userRef = db.collection('users').doc(uid);
  const aiUsageRef = userRef.collection('ai_tutor_usage').doc(dateKey);
  const answerDocRef = questionId ? userRef.collection('answers').doc(questionId) : null;
  const dailyUsageKey = sanitizeKey(`${dateKey}_uid_${uid}`);
  const dailyUsageRef = db.collection('daily_usage').doc(dailyUsageKey);

  const [userSnap, aiUsageSnap, answerSnap, dailyUsageSnap] = await Promise.all([
    userRef.get(),
    aiUsageRef.get(),
    answerDocRef ? answerDocRef.get() : Promise.resolve({ exists: false, data: () => undefined }),
    dailyUsageRef.get(),
  ]);

  const userData: Record<string, any> = userSnap.exists ? userSnap.data() || {} : {};
  const premiumEval = evaluatePremiumAccess(userData, nowMs);

  const aiUsageData: Record<string, any> = aiUsageSnap.exists ? aiUsageSnap.data() || {} : {};
  const usedToday = Math.max(0, Math.floor(Number(aiUsageData.count) || 0));
  const dailyLimit = premiumEval.isPremium ? limits.premiumDailyLimit : limits.freeDailyLimit;

  const quota: AiTutorQuotaInfo = {
    dateKey,
    planType: premiumEval.isPremium ? 'premium' : 'free',
    dailyLimit,
    usedToday,
    remainingToday: Math.max(0, dailyLimit - usedToday),
  };

  // Authoritative anti-spoiler check:
  // Free users may ONLY see solution/gabarito if they already answered this question (in answers or daily_usage)
  const dailyUsageData: Record<string, any> = dailyUsageSnap.exists
    ? dailyUsageSnap.data() || {}
    : {};
  const answeredTodayIds: string[] = Array.isArray(dailyUsageData.questionIds)
    ? dailyUsageData.questionIds
    : [];
  const hasStoredAnswer = Boolean(answerSnap && answerSnap.exists);
  const answeredToday = Boolean(questionId && answeredTodayIds.includes(questionId));

  const canViewSolution = premiumEval.isPremium || hasStoredAnswer || answeredToday;
  const storedSelectedOptionId =
    hasStoredAnswer && typeof answerSnap.data?.()?.selectedOptionId === 'string'
      ? answerSnap.data().selectedOptionId
      : null;

  return {
    isPremium: premiumEval.isPremium,
    subscriptionStatus: premiumEval.subscriptionStatus,
    canViewSolution,
    storedSelectedOptionId,
    quota,
    aiUsageRef,
  };
}

function mapAiProviderError(err: any): { status: number; code: string; message: string } {
  const code = String(err?.code || '').toUpperCase();
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const msg = String(err?.message || '').toUpperCase();

  if (code === 'AI_PROVIDER_NOT_CONFIGURED') {
    return {
      status: 503,
      code: 'AI_UNAVAILABLE',
      message:
        'O Professor Virtual com IA está temporariamente indisponível no servidor. Tente novamente mais tarde.',
    };
  }

  if (code === 'AI_TIMEOUT' || isTimeoutGeminiError(err)) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message:
        'O Professor Virtual demorou mais do que o esperado para responder. Tente novamente em instantes — nenhuma consulta foi descontada da sua cota.',
    };
  }

  if (code === 'AI_EMPTY_RESPONSE') {
    return {
      status: 502,
      code: 'AI_EMPTY_RESPONSE',
      message:
        'O Professor Virtual retornou uma resposta vazia. Tente novamente em instantes — nenhuma consulta foi descontada da sua cota.',
    };
  }

  if (status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('QUOTA')) {
    return {
      status: 503,
      code: 'AI_PROVIDER_RATE_LIMITED',
      message:
        'O Professor Virtual recebeu muitas solicitações neste momento. Aguarde alguns instantes e tente novamente — nenhuma consulta foi descontada da sua cota.',
    };
  }

  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    return {
      status: 503,
      code: 'AI_PROVIDER_AUTH_ERROR',
      message:
        'Serviço do Professor Virtual temporariamente indisponível por configuração do provedor de IA. Nenhuma consulta foi descontada da sua cota.',
    };
  }

  return {
    status: 503,
    code: 'AI_PROVIDER_ERROR',
    message:
      'Não foi possível obter a resposta do Professor Virtual neste momento. Tente novamente em instantes — nenhuma consulta foi descontada da sua cota.',
  };
}

export async function handleAiTutor(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AiTutorDeps = defaultDeps
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return sendJson(res, 405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Utilize GET ou POST.',
    });
  }

  // 1. Block Preview environments that share Production Firestore
  if (deps.isPreviewSharingProductionFirestore()) {
    return sendJson(res, 403, {
      error: 'PREVIEW_PRODUCTION_FIRESTORE_BLOCKED',
      message:
        'Ambiente Preview bloqueado por segurança para evitar acesso ao Firestore de Produção.',
      blocked: true,
    });
  }

  // 2. Strictly require Firebase Auth
  let user: { uid: string; email?: string };
  try {
    user = await deps.verifyFirebaseUser(req);
  } catch (err: any) {
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
      message:
        err?.message || 'Entre na sua conta para consultar o Professor Virtual com IA.',
    });
  }

  // 3. Enforce strict user isolation on query params BEFORE touching Firestore
  const queryParams = getQueryParams(req);
  const queryUid = (queryParams.get('uid') || queryParams.get('userId') || '').trim();
  if (queryUid && queryUid !== user.uid) {
    return sendJson(res, 403, {
      error: 'FORBIDDEN',
      message: 'Acesso negado: você não pode consultar dados ou cotas de outro usuário.',
      blocked: true,
    });
  }

  let body: any = null;
  if (method === 'POST') {
    try {
      body = await deps.readJsonBody(req);
    } catch {
      return sendJson(res, 400, {
        error: 'INVALID_JSON',
        message: 'Corpo da requisição JSON inválido.',
      });
    }

    const bodyUid =
      typeof body?.uid === 'string'
        ? body.uid.trim()
        : typeof body?.userId === 'string'
          ? body.userId.trim()
          : '';
    if (bodyUid && bodyUid !== user.uid) {
      return sendJson(res, 403, {
        error: 'FORBIDDEN',
        message: 'Acesso negado: você não pode enviar consultas em nome de outro usuário.',
        blocked: true,
      });
    }
  }

  // 4. Require Firestore Admin availability (HTTP 503 if unavailable)
  const db = deps.getAdminFirestore();
  if (!db) {
    return sendJson(res, 503, {
      error: 'SERVICE_UNAVAILABLE',
      message:
        'Serviço do Professor Virtual temporariamente indisponível. Não foi possível conectar ao banco de dados.',
      unavailable: true,
    });
  }

  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const dateKey = deps.getTodayDateKey();
  const limits = deps.getLimits();

  // GET: Return current daily AI quota & authoritative solutionUnlocked status for a question
  if (method === 'GET') {
    const questionId = (queryParams.get('questionId') || '').trim();
    if (questionId && !questionMap.has(questionId)) {
      return sendJson(res, 404, {
        error: 'QUESTION_NOT_FOUND',
        message: 'Questão não encontrada no banco oficial.',
      });
    }

    try {
      const ctx = await resolveUserTutorContext({
        db,
        uid: user.uid,
        questionId,
        dateKey,
        nowMs,
        limits,
      });

      return sendJson(res, 200, {
        isPremium: ctx.isPremium,
        solutionUnlocked: ctx.canViewSolution,
        quota: ctx.quota,
        limits: {
          freeDailyLimit: limits.freeDailyLimit,
          premiumDailyLimit: limits.premiumDailyLimit,
        },
        disclaimer:
          'Explicação didática assistida por IA. Não substitui o gabarito oficial da banca examinadora.',
      });
    } catch (err) {
      console.error('Erro ao consultar cota do Professor IA no Firestore:', err);
      return sendJson(res, 503, {
        error: 'SERVICE_UNAVAILABLE',
        message:
          'Não foi possível verificar sua cota do Professor Virtual no momento. Tente novamente em instantes.',
        unavailable: true,
      });
    }
  }

  // POST: Validate question & user message
  const questionId = typeof body?.questionId === 'string' ? body.questionId.trim() : '';
  const userMessage = sanitizeUserMessage(body?.message);
  const history = sanitizeConversationHistory(body?.history);

  if (!questionId) {
    return sendJson(res, 400, {
      error: 'INVALID_REQUEST',
      message: 'Selecione uma questão válida para consultar o Professor Virtual.',
    });
  }

  const question = questionMap.get(questionId);
  if (!question) {
    return sendJson(res, 404, {
      error: 'QUESTION_NOT_FOUND',
      message: 'Questão não encontrada no banco de questões.',
    });
  }

  if (userMessage.length < 2) {
    return sendJson(res, 400, {
      error: 'EMPTY_MESSAGE',
      message: 'Escreva uma dúvida ou selecione uma das perguntas sugeridas.',
    });
  }

  let ctx: Awaited<ReturnType<typeof resolveUserTutorContext>>;
  try {
    ctx = await resolveUserTutorContext({
      db,
      uid: user.uid,
      questionId,
      dateKey,
      nowMs,
      limits,
    });
  } catch (err) {
    console.error('Erro ao validar contexto do Professor IA no Firestore:', err);
    return sendJson(res, 503, {
      error: 'SERVICE_UNAVAILABLE',
      message:
        'Não foi possível validar sua conta no momento. Tente novamente em instantes.',
      unavailable: true,
    });
  }

  // 5. Enforce server-side daily AI consultation limit
  if (ctx.quota.remainingToday <= 0) {
    return sendJson(res, 429, {
      error: 'AI_DAILY_LIMIT_REACHED',
      message: ctx.isPremium
        ? `Você atingiu o limite diário de ${ctx.quota.dailyLimit} consultas ao Professor IA hoje. Sua cota será renovada automaticamente amanhã.`
        : `Você atingiu o limite diário de ${ctx.quota.dailyLimit} consultas gratuitas ao Professor IA. Assine o Plano Premium para ampliar seu limite para ${limits.premiumDailyLimit} consultas por dia.`,
      quota: ctx.quota,
      isPremium: ctx.isPremium,
      solutionUnlocked: ctx.canViewSolution,
    });
  }

  // 6. Build authorized prompt (NEVER leaking gabarito/explanation if !ctx.canViewSolution)
  const disciplineName = disciplineNameMap.get(question.disciplineId) || question.disciplineId;
  const systemInstruction = buildAiTutorSystemInstruction({
    canViewSolution: ctx.canViewSolution,
  });
  const questionContext = buildAiTutorQuestionContext({
    question,
    disciplineName,
    canViewSolution: ctx.canViewSolution,
    selectedOptionId: ctx.canViewSolution ? ctx.storedSelectedOptionId : null,
  });
  const contents = buildGeminiContents({
    questionContext,
    history,
    userMessage,
  });

  // 7. Call Gemini API strictly on backend
  const model = deps.resolveModel();
  const aiStartMs = Date.now();
  let generation: Awaited<ReturnType<AiTutorGenerateFn>>;
  try {
    generation = await deps.generateAiAnswer({
      model,
      systemInstruction,
      contents,
    });

    if (typeof generation?.answer !== 'string' || !generation.answer.trim()) {
      const emptyErr: any = new Error('O provedor de IA retornou uma resposta vazia.');
      emptyErr.code = 'AI_EMPTY_RESPONSE';
      emptyErr.status = 502;
      throw emptyErr;
    }
  } catch (err: any) {
    const elapsedMs = Date.now() - aiStartMs;
    const mapped = mapAiProviderError(err);
    const sdkDiagnostic =
      err?.sdkDiagnostic && typeof err.sdkDiagnostic === 'object'
        ? err.sdkDiagnostic
        : extractSanitizedSdkError(err);

    console.error(
      JSON.stringify({
        event: 'ai_tutor_provider_error',
        model,
        mappedCode: mapped.code,
        mappedHttpStatus: mapped.status,
        elapsedMs,
        sdk: sdkDiagnostic,
      })
    );

    return sendJson(res, mapped.status, {
      error: mapped.code,
      message: mapped.message,
      quota: ctx.quota,
      solutionUnlocked: ctx.canViewSolution,
      unavailable: true,
    });
  }

  const cleanAnswer = generation.answer.trim();

  // 8. Record usage atomically ONLY AFTER a successful AI response
  let updatedUsed = ctx.quota.usedToday + 1;
  const nowIso = new Date(nowMs).toISOString();
  try {
    if (typeof db.runTransaction === 'function') {
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ctx.aiUsageRef);
        const current = snap.exists ? snap.data() || {} : {};
        const prevCount = Math.max(0, Math.floor(Number(current.count) || 0));
        updatedUsed = prevCount + 1;
        tx.set(
          ctx.aiUsageRef,
          {
            dateKey,
            count: updatedUsed,
            planType: ctx.isPremium ? 'premium' : 'free',
            lastQuestionId: question.id,
            updatedAt: nowIso,
          },
          { merge: true }
        );
      });
    } else {
      await ctx.aiUsageRef.set(
        {
          dateKey,
          count: updatedUsed,
          planType: ctx.isPremium ? 'premium' : 'free',
          lastQuestionId: question.id,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }
  } catch (usageErr) {
    // Do not fail the already-generated response if usage write has a transient warning,
    // just log cleanly on the server.
    console.warn('Aviso ao registrar consumo do Professor IA no Firestore:', usageErr);
  }

  const updatedQuota: AiTutorQuotaInfo = {
    dateKey,
    planType: ctx.isPremium ? 'premium' : 'free',
    dailyLimit: ctx.quota.dailyLimit,
    usedToday: updatedUsed,
    remainingToday: Math.max(0, ctx.quota.dailyLimit - updatedUsed),
  };

  return sendJson(res, 200, {
    questionId: question.id,
    disciplineName,
    subject: question.subject,
    answer: cleanAnswer,
    solutionUnlocked: ctx.canViewSolution,
    isPremium: ctx.isPremium,
    quota: updatedQuota,
    disclaimer:
      'Explicação didática gerada por IA para apoiar seus estudos. Não substitui o gabarito oficial da banca examinadora.',
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleAiTutor(req, res, defaultDeps);
}
