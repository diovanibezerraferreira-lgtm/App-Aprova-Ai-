import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import { readJsonBody } from './_accessControl.js';
import {
  reprocessPendingLeaderboardOutbox,
  reconcileLeaderboardFromServerSources,
} from './_leaderboardEngine.js';

export interface LeaderboardRecoverDeps {
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  readJsonBody: typeof readJsonBody;
  getAllowedSecrets?: () => string[];
  nowMs?: () => number;
}

const MIN_SECRET_LENGTH = 16;

function getDefaultAllowedSecrets(): string[] {
  const candidates = [
    process.env.LEADERBOARD_ADMIN_SECRET,
    process.env.CRON_SECRET,
  ];
  return candidates
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length >= MIN_SECRET_LENGTH);
}

const defaultDeps: LeaderboardRecoverDeps = {
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  readJsonBody,
  getAllowedSecrets: getDefaultAllowedSecrets,
  nowMs: () => Date.now(),
};

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractPresentedSecret(req: IncomingMessage): string {
  const headers = req.headers || {};
  const customHeader = headers['x-leaderboard-admin-secret'] || (headers as any)['X-Leaderboard-Admin-Secret'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  const authHeader = headers.authorization || (headers as any).Authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function parseBoolParam(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return fallback;
}

function parseIntParam(val: unknown, min: number, max: number, fallback: number): number {
  const num = typeof val === 'number' ? val : parseInt(String(val ?? ''), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

/**
 * Protected admin / cron endpoint for global leaderboard outbox reprocessing
 * and secondary reconciliation from server-verified sources.
 * NEVER accessible to students (rejects Firebase student tokens and unauthenticated calls).
 */
export async function handleLeaderboardRecover(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LeaderboardRecoverDeps = defaultDeps
): Promise<void> {
  const method = (req.method || 'POST').toUpperCase();
  // Support GET (Vercel Cron) and POST (manual admin invocation)
  if (method !== 'GET' && method !== 'POST') {
    return sendJson(res, 405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Use GET (cron) ou POST (administrativo).',
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

  // 2. Fail closed if no admin/cron secret is configured in environment variables
  const allowedSecrets = deps.getAllowedSecrets
    ? deps.getAllowedSecrets().filter((s) => typeof s === 'string' && s.trim().length >= MIN_SECRET_LENGTH)
    : getDefaultAllowedSecrets();

  if (allowedSecrets.length === 0) {
    return sendJson(res, 503, {
      error: 'ADMIN_SECRET_NOT_CONFIGURED',
      message: 'Segredo administrativo/cron do ranking não configurado no ambiente do servidor.',
    });
  }

  // 3. Constant-time verification of server-side admin/cron secret
  const presented = extractPresentedSecret(req);
  const authorized =
    presented.length >= MIN_SECRET_LENGTH &&
    allowedSecrets.some((secret) => timingSafeCompare(presented, secret));

  if (!authorized) {
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
      message: 'Acesso restrito a rotinas administrativas autenticadas do servidor.',
    });
  }

  const db = deps.getAdminFirestore();
  if (!db) {
    return sendJson(res, 503, {
      error: 'UNAVAILABLE',
      message: 'Firestore Admin indisponível para recuperação do ranking.',
      unavailable: true,
    });
  }

  let body: Record<string, any> = {};
  if (method === 'POST') {
    try {
      body = (await deps.readJsonBody(req)) || {};
    } catch {
      return sendJson(res, 400, {
        error: 'INVALID_JSON',
        message: 'Corpo JSON inválido.',
      });
    }
  }

  let searchParams: URLSearchParams | null = null;
  try {
    searchParams = new URL(req.url || '/api/leaderboard-recover', 'http://localhost').searchParams;
  } catch {
    searchParams = null;
  }

  const pageSize = parseIntParam(body.pageSize ?? searchParams?.get('pageSize'), 1, 100, 50);
  const maxTotal = parseIntParam(body.maxTotal ?? searchParams?.get('maxTotal'), 1, 2000, 500);
  const includeFailed = parseBoolParam(
    body.includeFailed ?? searchParams?.get('includeFailed'),
    false
  );
  const includeReconciliation = parseBoolParam(
    body.includeReconciliation ?? searchParams?.get('includeReconciliation'),
    true
  );
  const rawCursor = body.cursor ?? searchParams?.get('cursor');
  const cursor =
    typeof rawCursor === 'string' && rawCursor.trim().length > 0 && rawCursor.trim().length <= 128
      ? rawCursor.trim()
      : null;

  const nowMs = deps.nowMs ? deps.nowMs() : Date.now();

  try {
    const outbox = await reprocessPendingLeaderboardOutbox(db, {
      pageSize,
      maxTotal,
      cursor,
      includeFailed,
      nowMs,
    });

    const reconciliation = includeReconciliation
      ? await reconcileLeaderboardFromServerSources(db, {
          pageSize,
          maxTotal,
          nowMs,
        })
      : null;

    return sendJson(res, 200, {
      ok: true,
      executedAt: new Date(nowMs).toISOString(),
      outbox,
      reconciliation,
    });
  } catch (err) {
    console.error('Erro na rotina administrativa /api/leaderboard-recover:', err);
    return sendJson(res, 503, {
      error: 'RECOVERY_FAILED',
      message: 'Falha transitória ao executar recuperação do ranking.',
    });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleLeaderboardRecover(req, res, defaultDeps);
}
