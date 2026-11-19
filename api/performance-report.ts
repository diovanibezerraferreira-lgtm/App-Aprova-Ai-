import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { MOCK_QUESTIONS } from './_data/questions.js';
import { OAB_DISCIPLINES } from './_data/disciplines.js';
import {
  buildPerformanceReport,
  buildQuestionCatalogIndexes,
  type RawAnswerRecord,
  type RawSimuladoRecord,
} from './_performanceAnalytics.js';

export interface PerformanceReportDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  nowMs?: () => number;
}

const defaultDeps: PerformanceReportDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  nowMs: () => Date.now(),
};

// Build question catalog lookup maps once per serverless worker lifecycle (O(1) per answer)
const cachedCatalogIndexes = buildQuestionCatalogIndexes(MOCK_QUESTIONS);

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function parseQueryParams(req: IncomingMessage) {
  try {
    const rawUrl = req.url || '/api/performance-report';
    const parsed = new URL(rawUrl, 'http://localhost');

    const errorsPageRaw = Number(parsed.searchParams.get('errorsPage') || '1');
    const errorsLimitRaw = Number(parsed.searchParams.get('errorsLimit') || '10');
    const simuladosPageRaw = Number(parsed.searchParams.get('simuladosPage') || '1');
    const simuladosLimitRaw = Number(parsed.searchParams.get('simuladosLimit') || '8');

    return {
      requestedUid: (
        parsed.searchParams.get('uid') ||
        parsed.searchParams.get('userId') ||
        ''
      ).trim(),
      errorsPage: Number.isFinite(errorsPageRaw) && errorsPageRaw >= 1 ? Math.floor(errorsPageRaw) : 1,
      errorsLimit:
        Number.isFinite(errorsLimitRaw) && errorsLimitRaw >= 1
          ? Math.min(25, Math.floor(errorsLimitRaw))
          : 10,
      errorDisciplineId: (parsed.searchParams.get('errorDisciplineId') || 'todas').trim() || 'todas',
      simuladosPage:
        Number.isFinite(simuladosPageRaw) && simuladosPageRaw >= 1
          ? Math.floor(simuladosPageRaw)
          : 1,
      simuladosLimit:
        Number.isFinite(simuladosLimitRaw) && simuladosLimitRaw >= 1
          ? Math.min(20, Math.floor(simuladosLimitRaw))
          : 8,
    };
  } catch {
    return {
      requestedUid: '',
      errorsPage: 1,
      errorsLimit: 10,
      errorDisciplineId: 'todas',
      simuladosPage: 1,
      simuladosLimit: 8,
    };
  }
}

export async function handlePerformanceReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: PerformanceReportDeps = defaultDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido. Use GET.' });
  }

  // 1. Protect production Firestore from preview deployments
  if (deps.isPreviewSharingProductionFirestore()) {
    return sendJson(res, 403, {
      error:
        'Ambiente Preview bloqueado por segurança para evitar leitura no Firestore de Produção.',
      blocked: true,
    });
  }

  // 2. Require authenticated Firebase user
  let user: { uid: string; email?: string };
  try {
    user = await deps.verifyFirebaseUser(req);
  } catch (err: any) {
    return sendJson(res, 401, {
      error: err?.message || 'Autenticação obrigatória para consultar o relatório de desempenho.',
    });
  }

  const query = parseQueryParams(req);

  // 3. Enforce strict user isolation — never trust uid/userId query params
  if (query.requestedUid && query.requestedUid !== user.uid) {
    return sendJson(res, 403, {
      error: 'Acesso negado: você só pode consultar o seu próprio histórico de desempenho.',
      blocked: true,
    });
  }

  // 4. Read-only access to Firestore Admin — return HTTP 503 if unavailable
  const db = deps.getAdminFirestore();
  if (!db) {
    return sendJson(res, 503, {
      error:
        'Serviço de relatório de desempenho temporariamente indisponível. Não foi possível conectar ao banco de dados.',
      unavailable: true,
    });
  }

  let userData: Record<string, any> = {};
  let answers: RawAnswerRecord[] = [];
  let simulados: RawSimuladoRecord[] = [];

  try {
    const userDocRef = db.collection('users').doc(user.uid);
    const [userSnap, answersSnap, simuladosSnap] = await Promise.all([
      userDocRef.get(),
      userDocRef.collection('answers').get(),
      userDocRef.collection('simulados').get(),
    ]);

    userData = userSnap.exists ? userSnap.data() || {} : {};

    answers = answersSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        questionId:
          typeof data.questionId === 'string' && data.questionId.trim()
            ? data.questionId.trim()
            : doc.id,
        disciplineId: typeof data.disciplineId === 'string' ? data.disciplineId : undefined,
        subject: typeof data.subject === 'string' ? data.subject : undefined,
        selectedOptionId:
          typeof data.selectedOptionId === 'string' ? data.selectedOptionId : undefined,
        isCorrect: Boolean(data.isCorrect),
        timestamp: data.timestamp,
        updatedAt: data.updatedAt,
      };
    });

    simulados = simuladosSnap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        id: typeof data.id === 'string' && data.id.trim() ? data.id.trim() : doc.id,
        configTitle: typeof data.configTitle === 'string' ? data.configTitle : undefined,
        disciplineId: typeof data.disciplineId === 'string' ? data.disciplineId : undefined,
        totalQuestions: typeof data.totalQuestions === 'number' ? data.totalQuestions : 0,
        correctAnswers: typeof data.correctAnswers === 'number' ? data.correctAnswers : 0,
        timeSpentSeconds: typeof data.timeSpentSeconds === 'number' ? data.timeSpentSeconds : 0,
        date: data.date,
        createdAt: data.createdAt,
      };
    });
  } catch (err) {
    console.error('Erro ao ler histórico de desempenho no Firestore Admin:', err);
    return sendJson(res, 503, {
      error:
        'Não foi possível carregar seu relatório de desempenho no momento devido a uma indisponibilidade temporária do servidor. Tente novamente em instantes.',
      unavailable: true,
    });
  }

  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const premiumEval = evaluatePremiumAccess(userData, nowMs);

  const report = buildPerformanceReport({
    answers,
    simulados,
    questionsMap: cachedCatalogIndexes.questionsMap,
    disciplines: OAB_DISCIPLINES,
    catalogSubjectCounts: cachedCatalogIndexes.catalogSubjectCounts,
    catalogDisciplineCounts: cachedCatalogIndexes.catalogDisciplineCounts,
    isPremium: premiumEval.isPremium,
    subscriptionStatus: premiumEval.subscriptionStatus,
    nowMs,
    errorsPage: query.errorsPage,
    errorsLimit: query.errorsLimit,
    errorDisciplineId: query.errorDisciplineId,
    simuladosPage: query.simuladosPage,
    simuladosLimit: query.simuladosLimit,
  });

  return sendJson(res, 200, report);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handlePerformanceReport(req, res, defaultDeps);
}
