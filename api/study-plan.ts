import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { readJsonBody } from './_accessControl.js';
import { MOCK_QUESTIONS } from './_data/questions.js';
import { OAB_DISCIPLINES } from './_data/disciplines.js';
import {
  buildQuestionCatalogIndexes,
  type RawAnswerRecord,
  type RawSimuladoRecord,
} from './_performanceAnalytics.js';
import {
  buildStudyPlanPayload,
  sanitizeStudyPlanInput,
  normalizeStoredActivity,
  clampInt,
  isValidDateKey,
  isValidTimeString,
  VALID_ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  type StudyActivityType,
} from './_studyPlanEngine.js';
import { recordStudyActivityStreakCheck } from './_leaderboardEngine.js';

export interface StudyPlanDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  readJsonBody: typeof readJsonBody;
  nowMs?: () => number;
  generateId?: () => string;
}

const defaultDeps: StudyPlanDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  readJsonBody,
  nowMs: () => Date.now(),
  generateId: () => `act_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
};

const cachedCatalog = buildQuestionCatalogIndexes(MOCK_QUESTIONS);
const validDisciplineIds = new Set<string>(OAB_DISCIPLINES.map((d) => d.id));
const disciplineMap = new Map(OAB_DISCIPLINES.map((d) => [d.id, d]));

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function getRequestedUidFromUrl(req: IncomingMessage): string {
  try {
    const parsed = new URL(req.url || '/api/study-plan', 'http://localhost');
    return (parsed.searchParams.get('uid') || parsed.searchParams.get('userId') || '').trim();
  } catch {
    return '';
  }
}

function isValidActivityId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function loadUserStudyContext(
  db: any,
  uid: string,
  nowMs: number
) {
  const userDocRef = db.collection('users').doc(uid);
  const [userSnap, answersSnap, simuladosSnap, activitiesSnap] = await Promise.all([
    userDocRef.get(),
    userDocRef.collection('answers').get(),
    userDocRef.collection('simulados').get(),
    userDocRef.collection('study_activities').get(),
  ]);

  const userData: Record<string, any> = userSnap.exists ? userSnap.data() || {} : {};

  const answers: RawAnswerRecord[] = answersSnap.docs.map((doc: any) => {
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

  const simulados: RawSimuladoRecord[] = simuladosSnap.docs.map((doc: any) => {
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

  const rawActivities: Array<{ id: string; data: Record<string, any> }> =
    activitiesSnap.docs.map((doc: any) => ({
      id: doc.id,
      data: doc.data() || {},
    }));

  const premiumEval = evaluatePremiumAccess(userData, nowMs);

  return {
    userDocRef,
    userData,
    answers,
    simulados,
    rawActivities,
    premiumEval,
  };
}

export async function handleStudyPlan(
  req: IncomingMessage,
  res: ServerResponse,
  deps: StudyPlanDeps = defaultDeps
) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'PUT' && method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido. Use GET, PUT ou POST.' });
  }

  // 1. Protect production Firestore from preview environments
  if (deps.isPreviewSharingProductionFirestore()) {
    return sendJson(res, 403, {
      error:
        'Ambiente Preview bloqueado por segurança para evitar acesso ao Firestore de Produção.',
      blocked: true,
    });
  }

  // 2. Require authenticated Firebase user
  let user: { uid: string; email?: string };
  try {
    user = await deps.verifyFirebaseUser(req);
  } catch (err: any) {
    return sendJson(res, 401, {
      error: err?.message || 'Autenticação obrigatória para acessar seu Plano de Estudos.',
    });
  }

  // 3. Enforce strict user isolation from query params
  const requestedQueryUid = getRequestedUidFromUrl(req);
  if (requestedQueryUid && requestedQueryUid !== user.uid) {
    return sendJson(res, 403, {
      error: 'Acesso negado: você só pode visualizar e alterar o seu próprio Plano de Estudos.',
      blocked: true,
    });
  }

  // 4. Read body if mutating & verify body does not spoof another uid
  let body: any = null;
  if (method === 'PUT' || method === 'POST') {
    try {
      body = await deps.readJsonBody(req);
    } catch {
      return sendJson(res, 400, { error: 'Corpo da requisição JSON inválido.' });
    }
    const bodyUid =
      typeof body?.uid === 'string'
        ? body.uid.trim()
        : typeof body?.userId === 'string'
          ? body.userId.trim()
          : '';
    if (bodyUid && bodyUid !== user.uid) {
      return sendJson(res, 403, {
        error: 'Acesso negado: não é permitido alterar dados de outro usuário.',
        blocked: true,
      });
    }
  }

  // 5. Require Firestore Admin availability (HTTP 503 if unavailable)
  const db = deps.getAdminFirestore();
  if (!db) {
    return sendJson(res, 503, {
      error:
        'Serviço do Plano de Estudos temporariamente indisponível. Não foi possível conectar ao banco de dados.',
      unavailable: true,
    });
  }

  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // GET: read-only full study plan + tracking
  if (method === 'GET') {
    try {
      const ctx = await loadUserStudyContext(db, user.uid, nowMs);
      const payload = buildStudyPlanPayload({
        userData: ctx.userData,
        rawActivities: ctx.rawActivities,
        answers: ctx.answers,
        simulados: ctx.simulados,
        disciplines: OAB_DISCIPLINES,
        questionsMap: cachedCatalog.questionsMap,
        isPremium: ctx.premiumEval.isPremium,
        subscriptionStatus: ctx.premiumEval.subscriptionStatus,
        nowMs,
      });
      return sendJson(res, 200, payload);
    } catch (err) {
      console.error('Erro ao ler Plano de Estudos no Firestore Admin:', err);
      return sendJson(res, 503, {
        error:
          'Não foi possível carregar seu Plano de Estudos no momento. Tente novamente em instantes.',
        unavailable: true,
      });
    }
  }

  // PUT: update study plan preferences & goals (never touching financial fields, answers, or simulados)
  if (method === 'PUT') {
    try {
      const userDocRef = db.collection('users').doc(user.uid);
      const userSnap = await userDocRef.get();
      const existingData: Record<string, any> = userSnap.exists ? userSnap.data() || {} : {};
      const fallbackDaily = clampInt(existingData.dailyGoalQuestions, 5, 200, 20);

      const mergedRaw = {
        ...(existingData.studyPlan || {}),
        ...(body?.plan && typeof body.plan === 'object' ? body.plan : body || {}),
        isConfigured: true,
        updatedAt: nowIso,
      };

      const sanitizedPlan = sanitizeStudyPlanInput(
        mergedRaw,
        validDisciplineIds,
        fallbackDaily
      );

      // Update ONLY studyPlan + dailyGoalQuestions + updatedAt (preserving all financial & profile fields)
      await userDocRef.set(
        {
          dailyGoalQuestions: sanitizedPlan.dailyGoalQuestions,
          studyPlan: sanitizedPlan,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      const ctx = await loadUserStudyContext(db, user.uid, nowMs);
      const payload = buildStudyPlanPayload({
        userData: {
          ...ctx.userData,
          dailyGoalQuestions: sanitizedPlan.dailyGoalQuestions,
          studyPlan: sanitizedPlan,
        },
        rawActivities: ctx.rawActivities,
        answers: ctx.answers,
        simulados: ctx.simulados,
        disciplines: OAB_DISCIPLINES,
        questionsMap: cachedCatalog.questionsMap,
        isPremium: ctx.premiumEval.isPremium,
        subscriptionStatus: ctx.premiumEval.subscriptionStatus,
        nowMs,
      });
      return sendJson(res, 200, payload);
    } catch (err) {
      console.error('Erro ao salvar Plano de Estudos no Firestore Admin:', err);
      return sendJson(res, 503, {
        error:
          'Não foi possível salvar seu Plano de Estudos no momento. Tente novamente em instantes.',
        unavailable: true,
      });
    }
  }

  // POST: activity lifecycle actions (create, update/reschedule, complete, cancel)
  const action = typeof body?.action === 'string' ? body.action.trim() : '';

  try {
    const userDocRef = db.collection('users').doc(user.uid);
    const activitiesCol = userDocRef.collection('study_activities');

    if (action === 'create_activity') {
      const rawType = typeof body?.type === 'string' ? body.type.trim() : '';
      if (!(VALID_ACTIVITY_TYPES as string[]).includes(rawType)) {
        return sendJson(res, 400, {
          error: 'Tipo de atividade inválido. Escolha revisão, apostila, questões, simulado ou peça.',
        });
      }
      const type = rawType as StudyActivityType;

      if (!isValidDateKey(body?.date)) {
        return sendJson(res, 400, {
          error: 'Informe uma data válida no formato AAAA-MM-DD.',
        });
      }
      const date = body.date.trim();

      const startTime = isValidTimeString(body?.startTime) ? body.startTime.trim() : '19:00';
      const rawDisciplineId =
        typeof body?.disciplineId === 'string' && body.disciplineId.trim()
          ? body.disciplineId.trim()
          : 'geral';
      const disciplineId =
        rawDisciplineId === 'geral' || rawDisciplineId === 'todas' || validDisciplineIds.has(rawDisciplineId)
          ? rawDisciplineId
          : 'geral';
      const disciplineName =
        disciplineId === 'geral' || disciplineId === 'todas'
          ? 'Estudo Geral'
          : disciplineMap.get(disciplineId)?.name || disciplineId;

      const subject =
        typeof body?.subject === 'string' ? body.subject.trim().slice(0, 140) : '';
      const title =
        typeof body?.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 160)
          : `${ACTIVITY_TYPE_LABELS[type]} · ${disciplineName}`;

      const plannedMinutes = clampInt(body?.plannedMinutes, 5, 600, 45);
      const notes = typeof body?.notes === 'string' ? body.notes.trim().slice(0, 600) : '';

      // Allow explicitly logging an already completed study session ONLY when user sets status: 'completed'
      const isDirectLog = body?.status === 'completed';
      const actualMinutes = isDirectLog
        ? clampInt(body?.actualMinutes, 1, 600, plannedMinutes)
        : 0;

      const id = deps.generateId ? deps.generateId() : defaultDeps.generateId!();
      const docPayload = {
        id,
        title,
        type,
        disciplineId,
        subject,
        date,
        startTime,
        plannedMinutes,
        actualMinutes,
        status: isDirectLog ? 'completed' : 'planned',
        notes,
        completedAt: isDirectLog ? nowIso : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await activitiesCol.doc(id).set(docPayload);

      if (isDirectLog) {
        try {
          await recordStudyActivityStreakCheck(db, {
            uid: user.uid,
            activityId: id,
            occurredAt: nowMs,
            nowMs,
          });
        } catch {
          // Ranking failure must never interrupt study plan logging
        }
      }

      const ctx = await loadUserStudyContext(db, user.uid, nowMs);
      const payload = buildStudyPlanPayload({
        userData: ctx.userData,
        rawActivities: ctx.rawActivities,
        answers: ctx.answers,
        simulados: ctx.simulados,
        disciplines: OAB_DISCIPLINES,
        questionsMap: cachedCatalog.questionsMap,
        isPremium: ctx.premiumEval.isPremium,
        subscriptionStatus: ctx.premiumEval.subscriptionStatus,
        nowMs,
      });

      return sendJson(res, 201, {
        activity: normalizeStoredActivity(id, docPayload, disciplineMap),
        report: payload,
      });
    }

    if (
      action === 'update_activity' ||
      action === 'complete_activity' ||
      action === 'cancel_activity' ||
      action === 'reopen_activity'
    ) {
      const activityId = typeof body?.activityId === 'string' ? body.activityId.trim() : '';
      if (!isValidActivityId(activityId)) {
        return sendJson(res, 400, { error: 'Identificador de atividade inválido.' });
      }

      const actRef = activitiesCol.doc(activityId);
      const actSnap = await actRef.get();
      if (!actSnap.exists) {
        return sendJson(res, 404, { error: 'Atividade não encontrada no seu plano.' });
      }

      const current = actSnap.data() || {};
      const updates: Record<string, any> = { updatedAt: nowIso };

      if (action === 'complete_activity') {
        const defaultPlanned = clampInt(current.plannedMinutes, 5, 600, 45);
        updates.status = 'completed';
        updates.actualMinutes = clampInt(body?.actualMinutes, 1, 600, defaultPlanned);
        updates.completedAt = nowIso;
        if (typeof body?.notes === 'string') {
          updates.notes = body.notes.trim().slice(0, 600);
        }
      } else if (action === 'cancel_activity') {
        // Soft cancel preserves history without deleting records
        updates.status = 'cancelled';
      } else if (action === 'reopen_activity') {
        updates.status = 'planned';
        updates.completedAt = null;
        updates.actualMinutes = 0;
      } else if (action === 'update_activity') {
        if (body?.date !== undefined) {
          if (!isValidDateKey(body.date)) {
            return sendJson(res, 400, { error: 'Data de reagendamento inválida (use AAAA-MM-DD).' });
          }
          updates.date = body.date.trim();
        }
        if (body?.startTime !== undefined) {
          if (!isValidTimeString(body.startTime)) {
            return sendJson(res, 400, { error: 'Horário inválido (use HH:mm).' });
          }
          updates.startTime = body.startTime.trim();
        }
        if (body?.type !== undefined) {
          const rawType = String(body.type).trim();
          if (!(VALID_ACTIVITY_TYPES as string[]).includes(rawType)) {
            return sendJson(res, 400, { error: 'Tipo de atividade inválido.' });
          }
          updates.type = rawType;
        }
        if (body?.disciplineId !== undefined) {
          const rawDisc = String(body.disciplineId).trim();
          updates.disciplineId =
            rawDisc === 'geral' || rawDisc === 'todas' || validDisciplineIds.has(rawDisc)
              ? rawDisc
              : 'geral';
        }
        if (typeof body?.subject === 'string') {
          updates.subject = body.subject.trim().slice(0, 140);
        }
        if (typeof body?.title === 'string' && body.title.trim()) {
          updates.title = body.title.trim().slice(0, 160);
        }
        if (body?.plannedMinutes !== undefined) {
          updates.plannedMinutes = clampInt(body.plannedMinutes, 5, 600, 45);
        }
        if (typeof body?.notes === 'string') {
          updates.notes = body.notes.trim().slice(0, 600);
        }
        // If rescheduling a previously cancelled activity, allow restoring to planned
        if (body?.restorePlanned === true && current.status === 'cancelled') {
          updates.status = 'planned';
        }
      }

      await actRef.set({ ...current, ...updates }, { merge: true });

      if (action === 'complete_activity' && current.status !== 'completed') {
        try {
          await recordStudyActivityStreakCheck(db, {
            uid: user.uid,
            activityId,
            occurredAt: nowMs,
            nowMs,
          });
        } catch {
          // Ranking failure must never interrupt study plan completion
        }
      }

      const ctx = await loadUserStudyContext(db, user.uid, nowMs);
      const payload = buildStudyPlanPayload({
        userData: ctx.userData,
        rawActivities: ctx.rawActivities,
        answers: ctx.answers,
        simulados: ctx.simulados,
        disciplines: OAB_DISCIPLINES,
        questionsMap: cachedCatalog.questionsMap,
        isPremium: ctx.premiumEval.isPremium,
        subscriptionStatus: ctx.premiumEval.subscriptionStatus,
        nowMs,
      });

      return sendJson(res, 200, {
        activity: normalizeStoredActivity(activityId, { ...current, ...updates }, disciplineMap),
        report: payload,
      });
    }

    return sendJson(res, 400, {
      error:
        'Ação inválida. Utilize create_activity, update_activity, complete_activity, cancel_activity ou reopen_activity.',
    });
  } catch (err) {
    console.error('Erro ao processar atividade no Plano de Estudos:', err);
    return sendJson(res, 503, {
      error:
        'Não foi possível atualizar a atividade no momento devido a uma indisponibilidade temporária. Tente novamente.',
      unavailable: true,
    });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleStudyPlan(req, res, defaultDeps);
}
