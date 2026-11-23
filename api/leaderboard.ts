import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import {
  LEADERBOARD_COLLECTIONS,
  LEADERBOARD_CONFIG_DOC_ID,
  normalizeLeaderboardConfig,
  getPeriodKeysForTimestamp,
  buildPeriodDocId,
  sanitizePublicProfile,
  sanitizePeriodEntry,
  reprocessPendingLeaderboardOutbox,
  type LeaderboardPublicProfile,
  type LeaderboardPeriodEntry,
  type LeaderboardEventRecord,
} from './_leaderboardEngine.js';
import leaderboardRecoverHandler, {
  handleLeaderboardRecover,
  type LeaderboardRecoverDeps,
} from './_leaderboardRecover.js';

export { handleLeaderboardRecover, type LeaderboardRecoverDeps };

export interface LeaderboardApiDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  nowMs?: () => number;
}

const defaultDeps: LeaderboardApiDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  nowMs: () => Date.now(),
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function getRequestedUidFromUrl(req: IncomingMessage): string {
  try {
    const parsed = new URL(req.url || '/api/leaderboard', 'http://localhost');
    return (parsed.searchParams.get('uid') || parsed.searchParams.get('userId') || '').trim();
  } catch {
    return '';
  }
}

function getRequestedLimit(req: IncomingMessage): number {
  try {
    const parsed = new URL(req.url || '/api/leaderboard', 'http://localhost');
    const raw = parseInt(parsed.searchParams.get('limit') || '50', 10);
    if (!Number.isFinite(raw)) return 50;
    return Math.min(100, Math.max(1, raw));
  } catch {
    return 50;
  }
}

export async function handleLeaderboard(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeaderboardApiDeps = defaultDeps
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();

  // Strictly read-only: browser can NEVER write, set, or modify scores
  if (method !== 'GET') {
    return sendJson(res, 405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'A pontuação do ranking é calculada exclusivamente no servidor e não pode ser alterada pelo navegador.',
    });
  }

  // 1. Protect production Firestore from Preview environments
  if (deps.isPreviewSharingProductionFirestore()) {
    return sendJson(res, 403, {
      error: 'PREVIEW_PRODUCTION_FIRESTORE_BLOCKED',
      message: 'Ambiente Preview bloqueado por segurança para evitar acesso ao Firestore de Produção.',
      blocked: true,
    });
  }

  // 2. Require authenticated Firebase user
  let user: { uid: string; email?: string };
  try {
    user = await deps.verifyFirebaseUser(req);
  } catch (err: any) {
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
      message: err?.message || 'Autenticação obrigatória para consultar o Ranking Aprova Direito.',
    });
  }

  // 3. Enforce strict user isolation on optional query param
  const requestedUid = getRequestedUidFromUrl(req);
  if (requestedUid && requestedUid !== user.uid) {
    return sendJson(res, 403, {
      error: 'FORBIDDEN',
      message: 'Acesso negado: você só pode consultar seus próprios dados do ranking.',
      blocked: true,
    });
  }

  const db = deps.getAdminFirestore();
  if (!db) {
    return sendJson(res, 503, {
      error: 'UNAVAILABLE',
      message: 'Serviço do ranking temporariamente indisponível.',
      unavailable: true,
    });
  }

  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
  const limit = getRequestedLimit(req);
  const { dateKey, weekKey, monthKey } = getPeriodKeysForTimestamp(nowMs);

  try {
    // Best-effort transparent recovery of any pending outbox events for this authenticated user
    try {
      await reprocessPendingLeaderboardOutbox(db, { uid: user.uid, limit: 20, nowMs });
    } catch {
      // Recovery failure must never break read endpoint
    }

    const [configSnap, privateSnap] = await Promise.all([
      db.collection(LEADERBOARD_COLLECTIONS.config).doc(LEADERBOARD_CONFIG_DOC_ID).get(),
      db.collection(LEADERBOARD_COLLECTIONS.privateProfiles).doc(user.uid).get(),
    ]);

    const config = normalizeLeaderboardConfig(
      configSnap.exists ? (configSnap.data() as Record<string, any>) : null
    );

    const privateData = privateSnap.exists ? (privateSnap.data() as Record<string, any>) : null;
    const myPublicProfileId =
      typeof privateData?.publicProfileId === 'string' && privateData.publicProfileId.trim()
        ? privateData.publicProfileId.trim()
        : null;

    if (!config.active) {
      return sendJson(res, 200, {
        config,
        periods: { dateKey, weekKey, monthKey },
        me: null,
        rankings: {
          general: [],
          weekly: [],
          monthly: [],
        },
      });
    }

    const [
      generalSnap,
      weeklySnap,
      monthlySnap,
      myPublicSnap,
      myWeeklySnap,
      myMonthlySnap,
      myEventsSnap,
    ] = await Promise.all([
      db
        .collection(LEADERBOARD_COLLECTIONS.publicProfiles)
        .orderBy('totalPoints', 'desc')
        .limit(limit)
        .get(),
      db
        .collection(LEADERBOARD_COLLECTIONS.weekly)
        .where('periodKey', '==', weekKey)
        .orderBy('points', 'desc')
        .limit(limit)
        .get(),
      db
        .collection(LEADERBOARD_COLLECTIONS.monthly)
        .where('periodKey', '==', monthKey)
        .orderBy('points', 'desc')
        .limit(limit)
        .get(),
      myPublicProfileId
        ? db.collection(LEADERBOARD_COLLECTIONS.publicProfiles).doc(myPublicProfileId).get()
        : Promise.resolve(null),
      myPublicProfileId
        ? db
            .collection(LEADERBOARD_COLLECTIONS.weekly)
            .doc(buildPeriodDocId(weekKey, myPublicProfileId))
            .get()
        : Promise.resolve(null),
      myPublicProfileId
        ? db
            .collection(LEADERBOARD_COLLECTIONS.monthly)
            .doc(buildPeriodDocId(monthKey, myPublicProfileId))
            .get()
        : Promise.resolve(null),
      db
        .collection(LEADERBOARD_COLLECTIONS.events)
        .where('uid', '==', user.uid)
        .limit(30)
        .get(),
    ]);

    const general = generalSnap.docs.map((doc: any, idx: number) => {
      const safe = sanitizePublicProfile(doc.data() as LeaderboardPublicProfile);
      return {
        rank: idx + 1,
        ...safe,
        isCurrentUser: Boolean(myPublicProfileId && safe.publicProfileId === myPublicProfileId),
      };
    });

    const weekly = weeklySnap.docs.map((doc: any, idx: number) => {
      const safe = sanitizePeriodEntry(doc.data() as LeaderboardPeriodEntry);
      return {
        rank: idx + 1,
        ...safe,
        isCurrentUser: Boolean(myPublicProfileId && safe.publicProfileId === myPublicProfileId),
      };
    });

    const monthly = monthlySnap.docs.map((doc: any, idx: number) => {
      const safe = sanitizePeriodEntry(doc.data() as LeaderboardPeriodEntry);
      return {
        rank: idx + 1,
        ...safe,
        isCurrentUser: Boolean(myPublicProfileId && safe.publicProfileId === myPublicProfileId),
      };
    });

    const myPublic =
      myPublicSnap && myPublicSnap.exists
        ? sanitizePublicProfile(myPublicSnap.data() as LeaderboardPublicProfile)
        : null;
    const myWeekly =
      myWeeklySnap && myWeeklySnap.exists
        ? sanitizePeriodEntry(myWeeklySnap.data() as LeaderboardPeriodEntry)
        : null;
    const myMonthly =
      myMonthlySnap && myMonthlySnap.exists
        ? sanitizePeriodEntry(myMonthlySnap.data() as LeaderboardPeriodEntry)
        : null;

    // Return user's own recent scoring events WITHOUT exposing internal uid
    const recentEvents = myEventsSnap.docs
      .map((doc: any) => doc.data() as LeaderboardEventRecord)
      .sort((a: LeaderboardEventRecord, b: LeaderboardEventRecord) => b.occurredAt - a.occurredAt)
      .slice(0, 20)
      .map((ev: LeaderboardEventRecord) => ({
        eventId: ev.eventId,
        type: ev.type,
        sourceId: ev.sourceId,
        points: ev.points,
        basePoints: ev.basePoints,
        bonusPoints: ev.bonusPoints,
        dateKey: ev.dateKey,
        weekKey: ev.weekKey,
        monthKey: ev.monthKey,
        occurredAt: ev.occurredAt,
        createdAt: ev.createdAt,
      }));

    return sendJson(res, 200, {
      config,
      periods: { dateKey, weekKey, monthKey },
      me: myPublic
        ? {
            ...myPublic,
            weeklyPoints: myWeekly?.points ?? 0,
            monthlyPoints: myMonthly?.points ?? 0,
            recentEvents,
          }
        : {
            publicProfileId: null,
            nickname: null,
            avatar: null,
            totalPoints: 0,
            weeklyPoints: 0,
            monthlyPoints: 0,
            questionsPoints: 0,
            simuladosPoints: 0,
            goalsPoints: 0,
            streakPoints: 0,
            questionsAnsweredCount: 0,
            questionsCorrectCount: 0,
            simuladosCompletedCount: 0,
            dailyGoalsCompletedCount: 0,
            weeklyGoalsCompletedCount: 0,
            streak7dCount: 0,
            currentStreakDays: 0,
            bestStreakDays: 0,
            recentEvents: [],
          },
      rankings: {
        general,
        weekly,
        monthly,
      },
    });
  } catch (err) {
    console.error('Erro ao consultar /api/leaderboard:', err);
    return sendJson(res, 503, {
      error: 'UNAVAILABLE',
      message: 'Não foi possível carregar os dados do ranking no momento.',
      unavailable: true,
    });
  }
}

export type LeaderboardRouteTarget = 'leaderboard' | 'recover';

export interface LeaderboardRouterDeps {
  leaderboard?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  recover?: (req: IncomingMessage & { body?: any }, res: ServerResponse) => Promise<void>;
}

export function resolveLeaderboardTarget(req: IncomingMessage): LeaderboardRouteTarget | null {
  try {
    const parsed = new URL(req.url || '/api/leaderboard', 'http://localhost');
    const explicitAction = (parsed.searchParams.get('__action') || '').trim().toLowerCase();
    if (explicitAction === 'recover') {
      return 'recover';
    }
    if (explicitAction) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname === '/api/leaderboard-recover') {
      return 'recover';
    }
    return 'leaderboard';
  } catch {
    return 'leaderboard';
  }
}

export async function handleLeaderboardRoute(
  req: IncomingMessage & { body?: any },
  res: ServerResponse,
  deps?: LeaderboardRouterDeps
): Promise<void> {
  const target = resolveLeaderboardTarget(req);
  if (target === 'recover') {
    const fn = deps?.recover || leaderboardRecoverHandler;
    return fn(req, res);
  }
  if (target === 'leaderboard') {
    const fn = deps?.leaderboard || ((r, s) => handleLeaderboard(r, s, defaultDeps));
    return fn(req, res);
  }

  return sendJson(res, 404, {
    error: 'NOT_FOUND',
    message: 'Rota do ranking não encontrada.',
  });
}

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
): Promise<void> {
  return handleLeaderboardRoute(req, res);
}
