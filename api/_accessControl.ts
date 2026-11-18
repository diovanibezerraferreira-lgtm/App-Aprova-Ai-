import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  hasAdminCredentials,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import type { Firestore } from 'firebase-admin/firestore';

export const FREE_DAILY_QUESTIONS_LIMIT = 10;
export const FREE_DAILY_SIMULADOS_LIMIT = 1;

export const FREE_BRIEF_IDS = new Set<string>([
  'resposta-acusacao',
  'reclamacao-trabalhista',
]);

export const FREE_MATERIAL_IDS = new Set<string>([
  'manual-ext-etica-50p',
  'manual-ext-const-50p',
  'manual-ext-civil-50p',
]);

export interface AccessContext {
  isAuthenticated: boolean;
  uid: string | null;
  email: string | null;
  isPremium: boolean;
  subscriptionStatus: 'NONE' | 'PENDING' | 'ACTIVE' | 'OVERDUE' | 'CANCELLED';
  dateKey: string;
  quotaKeys: string[];
  primaryQuotaKey: string;
}

export interface DailyUsageRecord {
  dateKey: string;
  questionIds: string[];
  questionsCount: number;
  simuladosCount: number;
  updatedAt: string;
}

export interface QuotaStatus {
  dateKey: string;
  questionsLimit: number | null;
  questionsUsed: number;
  questionsRemaining: number | null;
  answeredQuestionIdsToday: string[];
  simuladosLimit: number | null;
  simuladosUsed: number;
  simuladosRemaining: number | null;
}

export interface SimuladoSessionRecord {
  id: string;
  title: string;
  ownerKey: string;
  isPremium: boolean;
  questionIds: string[];
  timeLimitMinutes: number;
  createdAt: number;
}

// Local in-memory fallback only used when Firestore Admin is unavailable (e.g. local dev without Admin credentials)
const memoryQuotaStore = new Map<string, DailyUsageRecord>();
const memorySimuladoSessions = new Map<string, SimuladoSessionRecord>();

export function assertPreviewNotSharingProductionFirestore(): void {
  if (isPreviewSharingProductionFirestore()) {
    const err: any = new Error(
      'Acesso a dados, cotas e sessões bloqueado no ambiente Preview enquanto compartilhar o Firestore de produção.'
    );
    err.status = 403;
    err.code = 'PREVIEW_PRODUCTION_FIRESTORE_BLOCKED';
    err.blocked = true;
    throw err;
  }
}

function getUsableFirestore(): Firestore | null {
  assertPreviewNotSharingProductionFirestore();
  if (!hasAdminCredentials()) {
    return null;
  }
  return getAdminFirestore();
}

function isLocalQuotaFallbackAllowed(err: any): boolean {
  const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
  if (isVercel) return false;
  const code = err?.code;
  const msg = String(err?.message || '').toUpperCase();
  return (
    code === 7 ||
    code === 'PERMISSION_DENIED' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('MISSING OR INSUFFICIENT PERMISSIONS') ||
    msg.includes('COULD NOT LOAD THE DEFAULT CREDENTIALS')
  );
}

const ANON_COOKIE_NAME = 'aprova_did';

function getServerSecret(): string {
  return (
    process.env.QUOTA_SIGNING_SECRET ||
    process.env.ASAAS_WEBHOOK_TOKEN ||
    process.env.FIREBASE_PRIVATE_KEY ||
    'aprova-direito-freemium-server-secret-2026'
  );
}

export function getTodayDateKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sanitizeKey(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function hashValue(input: string): string {
  return crypto
    .createHmac('sha256', getServerSecret())
    .update(input)
    .digest('hex')
    .slice(0, 32);
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers?.cookie;
  const out: Record<string, string> = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function signCookieId(id: string): string {
  const sig = hashValue(`cid:${id}`).slice(0, 16);
  return `${id}.${sig}`;
}

function verifySignedCookieId(raw?: string): string | null {
  if (!raw || !raw.includes('.')) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig || !/^[a-zA-Z0-9_-]{8,64}$/.test(id)) return null;
  const expectedSig = hashValue(`cid:${id}`).slice(0, 16);
  const a = Buffer.from(sig, 'utf-8');
  const b = Buffer.from(expectedSig, 'utf-8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function getClientIp(req: IncomingMessage): string {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(',')[0].trim();
  }
  const realIp = req.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown-ip';
}

function ensureAnonCookie(req: IncomingMessage, res: ServerResponse): string {
  const cookies = parseCookies(req);
  const existing = verifySignedCookieId(cookies[ANON_COOKIE_NAME]);
  if (existing) return existing;

  const newId = crypto.randomBytes(12).toString('hex');
  const signed = signCookieId(newId);
  const isHttps =
    req.headers?.['x-forwarded-proto'] === 'https' ||
    Boolean(process.env.VERCEL);

  const cookieFlags = [
    `${ANON_COOKIE_NAME}=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 30}`,
    ...(isHttps ? ['Secure'] : []),
  ];
  res.setHeader('Set-Cookie', cookieFlags.join('; '));
  return newId;
}

export function sendJson(res: ServerResponse, status: number, payload: any): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.end(JSON.stringify(payload));
}

export async function readJsonBody(req: IncomingMessage & { body?: any }): Promise<any> {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) {
      const str = req.body.toString('utf-8').trim();
      return str ? JSON.parse(str) : {};
    }
    if (typeof req.body === 'string') {
      const str = req.body.trim();
      return str ? JSON.parse(str) : {};
    }
    return req.body || {};
  }

  if (req.readableEnded) return {};

  return new Promise((resolve, reject) => {
    let settled = false;
    let data = '';

    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Tempo limite ao ler corpo da requisição.'));
    }, 4000);

    const onData = (chunk: Buffer | string) => {
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const trimmed = data.trim();
      if (!trimmed) return resolve({});
      try {
        resolve(JSON.parse(trimmed));
      } catch {
        reject(new Error('Corpo JSON inválido.'));
      }
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Resolve authenticated user + authoritative Premium status from Firestore Admin SDK.
 * Never trusts localStorage or client-supplied plan flags.
 */
export async function resolveAccessContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<AccessContext> {
  assertPreviewNotSharingProductionFirestore();
  const dateKey = getTodayDateKey();
  const authHeader = req.headers?.authorization || (req.headers as any)?.Authorization;

  if (authHeader && typeof authHeader === 'string' && authHeader.trim().length > 0) {
    // Validate Firebase ID Token strictly via Admin SDK
    const user = await verifyFirebaseUser(req);
    const db = getUsableFirestore();

    let isPremium = false;
    let subscriptionStatus: AccessContext['subscriptionStatus'] = 'NONE';

    if (db) {
      try {
        const userSnap = await db.collection('users').doc(user.uid).get();
        if (userSnap.exists) {
          const data = userSnap.data() || {};
          const rawStatus = String(data.subscriptionStatus || 'NONE').toUpperCase();
          if (
            rawStatus === 'NONE' ||
            rawStatus === 'PENDING' ||
            rawStatus === 'ACTIVE' ||
            rawStatus === 'OVERDUE' ||
            rawStatus === 'CANCELLED'
          ) {
            subscriptionStatus = rawStatus;
          }
          // Active Premium strictly requires both isPremium === true and subscriptionStatus === 'ACTIVE'
          isPremium = data.isPremium === true && subscriptionStatus === 'ACTIVE';
        }
      } catch (err) {
        console.warn('Aviso ao validar assinatura do usuário no Firestore Admin:', err);
        isPremium = false;
      }
    }

    const uidKey = sanitizeKey(`${dateKey}_uid_${user.uid}`);
    return {
      isAuthenticated: true,
      uid: user.uid,
      email: user.email || null,
      isPremium,
      subscriptionStatus,
      dateKey,
      quotaKeys: [uidKey],
      primaryQuotaKey: uidKey,
    };
  }

  // Unauthenticated visitor: track quota by BOTH IP hash and signed HttpOnly cookie
  const ipHash = hashValue(`ip:${getClientIp(req)}`);
  const cid = ensureAnonCookie(req, res);
  const ipKey = sanitizeKey(`${dateKey}_ip_${ipHash}`);
  const cidKey = sanitizeKey(`${dateKey}_cid_${cid}`);

  return {
    isAuthenticated: false,
    uid: null,
    email: null,
    isPremium: false,
    subscriptionStatus: 'NONE',
    dateKey,
    quotaKeys: ipKey === cidKey ? [ipKey] : [ipKey, cidKey],
    primaryQuotaKey: ipKey,
  };
}

async function readDailyRecords(keys: string[]): Promise<DailyUsageRecord[]> {
  const db = getUsableFirestore();
  if (!db) {
    return keys
      .map((k) => memoryQuotaStore.get(k))
      .filter((v): v is DailyUsageRecord => Boolean(v));
  }

  try {
    const snaps = await Promise.all(keys.map((k) => db.collection('daily_usage').doc(k).get()));
    return snaps
      .filter((s) => s.exists)
      .map((s) => s.data() as DailyUsageRecord);
  } catch (err) {
    if (isLocalQuotaFallbackAllowed(err)) {
      return keys
        .map((k) => memoryQuotaStore.get(k))
        .filter((v): v is DailyUsageRecord => Boolean(v));
    }
    throw err;
  }
}

function mergeUsageRecords(dateKey: string, records: DailyUsageRecord[]): DailyUsageRecord {
  const questionIdSet = new Set<string>();
  let maxQuestions = 0;
  let maxSimulados = 0;

  for (const r of records) {
    if (Array.isArray(r.questionIds)) {
      for (const qId of r.questionIds) questionIdSet.add(qId);
    }
    if (typeof r.questionsCount === 'number') {
      maxQuestions = Math.max(maxQuestions, r.questionsCount);
    }
    if (typeof r.simuladosCount === 'number') {
      maxSimulados = Math.max(maxSimulados, r.simuladosCount);
    }
  }

  return {
    dateKey,
    questionIds: Array.from(questionIdSet),
    questionsCount: Math.max(maxQuestions, questionIdSet.size),
    simuladosCount: maxSimulados,
    updatedAt: new Date().toISOString(),
  };
}

export async function getDailyQuotaStatus(ctx: AccessContext): Promise<QuotaStatus> {
  assertPreviewNotSharingProductionFirestore();
  if (ctx.isPremium) {
    return {
      dateKey: ctx.dateKey,
      questionsLimit: null,
      questionsUsed: 0,
      questionsRemaining: null,
      answeredQuestionIdsToday: [],
      simuladosLimit: null,
      simuladosUsed: 0,
      simuladosRemaining: null,
    };
  }

  const records = await readDailyRecords(ctx.quotaKeys);
  const merged = mergeUsageRecords(ctx.dateKey, records);

  return {
    dateKey: ctx.dateKey,
    questionsLimit: FREE_DAILY_QUESTIONS_LIMIT,
    questionsUsed: merged.questionsCount,
    questionsRemaining: Math.max(0, FREE_DAILY_QUESTIONS_LIMIT - merged.questionsCount),
    answeredQuestionIdsToday: merged.questionIds,
    simuladosLimit: FREE_DAILY_SIMULADOS_LIMIT,
    simuladosUsed: merged.simuladosCount,
    simuladosRemaining: Math.max(0, FREE_DAILY_SIMULADOS_LIMIT - merged.simuladosCount),
  };
}

export async function consumeQuestionQuota(
  ctx: AccessContext,
  questionId: string
): Promise<{
  allowed: boolean;
  questionsUsed: number;
  questionsRemaining: number;
  alreadyAnsweredToday: boolean;
}> {
  assertPreviewNotSharingProductionFirestore();
  if (ctx.isPremium) {
    return {
      allowed: true,
      questionsUsed: 0,
      questionsRemaining: 9999,
      alreadyAnsweredToday: false,
    };
  }

  const consumeInMemory = () => {
    const records = ctx.quotaKeys
      .map((k) => memoryQuotaStore.get(k))
      .filter((v): v is DailyUsageRecord => Boolean(v));
    const merged = mergeUsageRecords(ctx.dateKey, records);
    const alreadyAnsweredToday = merged.questionIds.includes(questionId);

    if (!alreadyAnsweredToday && merged.questionsCount >= FREE_DAILY_QUESTIONS_LIMIT) {
      return {
        allowed: false,
        questionsUsed: merged.questionsCount,
        questionsRemaining: 0,
        alreadyAnsweredToday: false,
      };
    }

    const updatedIds = alreadyAnsweredToday
      ? merged.questionIds
      : [...merged.questionIds, questionId];
    const nextCount = alreadyAnsweredToday
      ? merged.questionsCount
      : Math.max(merged.questionsCount + 1, updatedIds.length);
    const nextRecord: DailyUsageRecord = {
      dateKey: ctx.dateKey,
      questionIds: updatedIds,
      questionsCount: nextCount,
      simuladosCount: merged.simuladosCount,
      updatedAt: nowIso,
    };
    if (!alreadyAnsweredToday) {
      for (const key of ctx.quotaKeys) {
        memoryQuotaStore.set(key, nextRecord);
      }
    }
    return {
      allowed: true,
      questionsUsed: nextRecord.questionsCount,
      questionsRemaining: Math.max(0, FREE_DAILY_QUESTIONS_LIMIT - nextRecord.questionsCount),
      alreadyAnsweredToday,
    };
  };

  const db = getUsableFirestore();
  const nowIso = new Date().toISOString();

  if (!db) {
    return consumeInMemory();
  }

  let result = {
    allowed: false,
    questionsUsed: 0,
    questionsRemaining: 0,
    alreadyAnsweredToday: false,
  };

  try {
    await db.runTransaction(async (tx) => {
      const refs = ctx.quotaKeys.map((k) => db.collection('daily_usage').doc(k));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const existing = snaps
        .filter((s) => s.exists)
        .map((s) => s.data() as DailyUsageRecord);

      const merged = mergeUsageRecords(ctx.dateKey, existing);
      const alreadyAnsweredToday = merged.questionIds.includes(questionId);

      if (!alreadyAnsweredToday && merged.questionsCount >= FREE_DAILY_QUESTIONS_LIMIT) {
        result = {
          allowed: false,
          questionsUsed: merged.questionsCount,
          questionsRemaining: 0,
          alreadyAnsweredToday: false,
        };
        return;
      }

      const updatedIds = alreadyAnsweredToday
        ? merged.questionIds
        : [...merged.questionIds, questionId];
      const nextCount = alreadyAnsweredToday
        ? merged.questionsCount
        : Math.max(merged.questionsCount + 1, updatedIds.length);

      const nextRecord: DailyUsageRecord = {
        dateKey: ctx.dateKey,
        questionIds: updatedIds,
        questionsCount: nextCount,
        simuladosCount: merged.simuladosCount,
        updatedAt: nowIso,
      };

      if (!alreadyAnsweredToday) {
        for (const ref of refs) {
          tx.set(ref, nextRecord, { merge: true });
        }
      }

      result = {
        allowed: true,
        questionsUsed: nextCount,
        questionsRemaining: Math.max(0, FREE_DAILY_QUESTIONS_LIMIT - nextCount),
        alreadyAnsweredToday,
      };
    });
  } catch (err) {
    if (isLocalQuotaFallbackAllowed(err)) {
      return consumeInMemory();
    }
    throw err;
  }

  return result;
}

export async function consumeSimuladoQuota(ctx: AccessContext): Promise<{
  allowed: boolean;
  simuladosUsed: number;
  simuladosRemaining: number;
}> {
  assertPreviewNotSharingProductionFirestore();
  if (ctx.isPremium) {
    return {
      allowed: true,
      simuladosUsed: 0,
      simuladosRemaining: 9999,
    };
  }

  const nowIso = new Date().toISOString();
  const consumeInMemory = () => {
    const records = ctx.quotaKeys
      .map((k) => memoryQuotaStore.get(k))
      .filter((v): v is DailyUsageRecord => Boolean(v));
    const merged = mergeUsageRecords(ctx.dateKey, records);

    if (merged.simuladosCount >= FREE_DAILY_SIMULADOS_LIMIT) {
      return {
        allowed: false,
        simuladosUsed: merged.simuladosCount,
        simuladosRemaining: 0,
      };
    }

    const nextCount = merged.simuladosCount + 1;
    const nextRecord: DailyUsageRecord = {
      ...merged,
      simuladosCount: nextCount,
      updatedAt: nowIso,
    };
    for (const key of ctx.quotaKeys) {
      memoryQuotaStore.set(key, nextRecord);
    }
    return {
      allowed: true,
      simuladosUsed: nextCount,
      simuladosRemaining: Math.max(0, FREE_DAILY_SIMULADOS_LIMIT - nextCount),
    };
  };

  const db = getUsableFirestore();
  if (!db) {
    return consumeInMemory();
  }

  let result = {
    allowed: false,
    simuladosUsed: 0,
    simuladosRemaining: 0,
  };

  try {
    await db.runTransaction(async (tx) => {
      const refs = ctx.quotaKeys.map((k) => db.collection('daily_usage').doc(k));
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const existing = snaps
        .filter((s) => s.exists)
        .map((s) => s.data() as DailyUsageRecord);

      const merged = mergeUsageRecords(ctx.dateKey, existing);
      if (merged.simuladosCount >= FREE_DAILY_SIMULADOS_LIMIT) {
        result = {
          allowed: false,
          simuladosUsed: merged.simuladosCount,
          simuladosRemaining: 0,
        };
        return;
      }

      const nextCount = merged.simuladosCount + 1;
      const nextRecord: DailyUsageRecord = {
        ...merged,
        simuladosCount: nextCount,
        updatedAt: nowIso,
      };

      for (const ref of refs) {
        tx.set(ref, nextRecord, { merge: true });
      }

      result = {
        allowed: true,
        simuladosUsed: nextCount,
        simuladosRemaining: Math.max(0, FREE_DAILY_SIMULADOS_LIMIT - nextCount),
      };
    });
  } catch (err) {
    if (isLocalQuotaFallbackAllowed(err)) {
      return consumeInMemory();
    }
    throw err;
  }

  return result;
}

export async function saveSimuladoSession(session: SimuladoSessionRecord): Promise<void> {
  assertPreviewNotSharingProductionFirestore();
  memorySimuladoSessions.set(session.id, session);
  const db = getUsableFirestore();
  if (db) {
    try {
      await db.collection('simulado_sessions').doc(sanitizeKey(session.id)).set(session);
    } catch (err) {
      console.warn('Aviso ao persistir sessão de simulado:', err);
    }
  }
}

export async function getSimuladoSession(sessionId: string): Promise<SimuladoSessionRecord | null> {
  assertPreviewNotSharingProductionFirestore();
  const cleanId = sanitizeKey(sessionId);
  const db = getUsableFirestore();
  if (db) {
    try {
      const snap = await db.collection('simulado_sessions').doc(cleanId).get();
      if (snap.exists) {
        return snap.data() as SimuladoSessionRecord;
      }
    } catch (err) {
      console.warn('Aviso ao recuperar sessão de simulado:', err);
    }
  }
  return memorySimuladoSessions.get(sessionId) || memorySimuladoSessions.get(cleanId) || null;
}
