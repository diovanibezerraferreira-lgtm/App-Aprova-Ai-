import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { getAdminFirestore, isPreviewSharingProductionFirestore } from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { FieldPath } from 'firebase-admin/firestore';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function extractDiagnosticSecret(req: IncomingMessage): string {
  const headers = req.headers || {};
  const customHeader = headers['x-diagnostic-secret'] || (headers as any)['X-Diagnostic-Secret'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  const authHeader = headers.authorization || (headers as any).Authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function isEligibleForCampaign(userData: any, nowMs: number = Date.now()): boolean {
  if (!userData || userData.consents?.email !== true) {
    return false;
  }
  const evaluation = evaluatePremiumAccess(userData, nowMs);
  return evaluation.isPremium === false;
}

const MAX_BODY_BYTES = 4096; // 4 KB limit

async function readJsonBody(req: IncomingMessage & { body?: any }): Promise<any> {
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
      const str = req.body.toString('utf-8').trim();
      return str ? JSON.parse(str) : {};
    }
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf-8') > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
      const str = req.body.trim();
      return str ? JSON.parse(str) : {};
    }
    try {
      const jsonStr = JSON.stringify(req.body);
      if (Buffer.byteLength(jsonStr, 'utf-8') > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
      return req.body;
    } catch (err: any) {
      if (err?.message === 'PAYLOAD_TOO_LARGE') throw err;
      throw new Error('INVALID_JSON_BODY');
    }
  }

  if (req.readableEnded) return {};

  return new Promise((resolve, reject) => {
    let bytesReceived = 0;
    let data = '';
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      bytesReceived += chunk.length;
      if (bytesReceived > MAX_BODY_BYTES) {
        cleanup();
        try {
          req.on('data', () => {});
          req.on('error', () => {});
          req.resume();
        } catch {}
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      data += chunk.toString('utf-8');
    };

    const onEnd = () => {
      if (settled) return;
      cleanup();
      try {
        const str = data.trim();
        resolve(str ? JSON.parse(str) : {});
      } catch {
        reject(new Error('INVALID_JSON_BODY'));
      }
    };

    const onError = (err: any) => {
      if (settled) return;
      cleanup();
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

const MIN_SECRET_LENGTH = 16;
const BATCH_SIZE = 500;

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
): Promise<void> {
  const method = (req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    return sendJson(res, 405, {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Método não permitido. Utilize POST.',
    });
  }

  try {
    if (isPreviewSharingProductionFirestore()) {
      return sendJson(res, 403, {
        error: 'PREVIEW_PRODUCTION_FIRESTORE_BLOCKED',
        message: 'Ambiente Preview bloqueado por segurança.',
      });
    }
  } catch {
    return sendJson(res, 403, {
      error: 'ENVIRONMENT_INSPECTION_FAILED',
      message: 'Falha ao validar o ambiente de execução.',
    });
  }

  const configuredSecret = (process.env.DIAGNOSTIC_SECRET || '').trim();
  if (configuredSecret.length < MIN_SECRET_LENGTH) {
    return sendJson(res, 503, {
      error: 'DIAGNOSTIC_SECRET_NOT_CONFIGURED',
      message: 'Segredo de diagnóstico não configurado no servidor.',
    });
  }

  const presented = extractDiagnosticSecret(req);
  if (!presented || presented.length < MIN_SECRET_LENGTH || !timingSafeCompare(presented, configuredSecret)) {
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
      message: 'Acesso restrito a chamadas administrativas autorizadas.',
    });
  }

  let body: any = {};
  try {
    body = await readJsonBody(req);
  } catch (err: any) {
    if (err?.message === 'PAYLOAD_TOO_LARGE') {
      return sendJson(res, 413, {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'O corpo da requisição excede o limite máximo de 4 KB.',
      });
    }
    return sendJson(res, 400, {
      error: 'INVALID_JSON_BODY',
      message: 'Corpo da requisição inválido ou malformado.',
    });
  }

  // Validate cursor first (max 128 chars, safe Firestore document ID characters)
  let cursor: string | null = null;
  if (body?.cursor !== undefined && body?.cursor !== null && body?.cursor !== '') {
    if (typeof body.cursor !== 'string' || body.cursor.length > 128 || !/^[\w\-.@:]+$/.test(body.cursor)) {
      return sendJson(res, 400, {
        error: 'INVALID_CURSOR',
        message: 'O cursor fornecido é inválido, malformado ou excede 128 caracteres.',
      });
    }
    cursor = body.cursor.trim();
  }

  // Validate referenceTimestamp (must be a safe positive integer number type, not string, not decimal)
  let referenceTimestamp: number;
  const hasTimestamp = body?.referenceTimestamp !== undefined && body?.referenceTimestamp !== null;

  if (cursor && !hasTimestamp) {
    return sendJson(res, 400, {
      error: 'REFERENCE_TIMESTAMP_REQUIRED_WITH_CURSOR',
      message: 'O parâmetro "referenceTimestamp" é obrigatório quando o cursor é fornecido.',
    });
  }

  if (hasTimestamp) {
    const rawTs = body.referenceTimestamp;
    if (typeof rawTs !== 'number' || !Number.isInteger(rawTs) || rawTs <= 0 || rawTs > Date.now() + 86400000 * 365) {
      return sendJson(res, 400, {
        error: 'INVALID_REFERENCE_TIMESTAMP',
        message: 'O parâmetro "referenceTimestamp" deve ser um número inteiro positivo válido.',
      });
    }
    referenceTimestamp = rawTs;
  } else {
    referenceTimestamp = Date.now();
  }

  const db = getAdminFirestore();
  if (!db) {
    return sendJson(res, 500, {
      error: 'DATABASE_NOT_INITIALIZED',
      message: 'Banco de dados não inicializado.',
    });
  }

  try {
    let query = db.collection('users').orderBy(FieldPath.documentId()).limit(BATCH_SIZE + 1);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const docs = snapshot.docs;

    const hasMore = docs.length > BATCH_SIZE;
    const pageDocs = hasMore ? docs.slice(0, BATCH_SIZE) : docs;
    const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null;

    let totalExamined = 0;
    let eligible = 0;
    let premiumExcluded = 0;
    let noConsent = 0;
    let invalidEmail = 0;
    let insufficientData = 0;

    for (const docSnap of pageDocs) {
      totalExamined++;
      const userData = docSnap.data();

      // Mutually exclusive precedence order:
      // 1. Insufficient Data
      if (!userData || typeof userData !== 'object') {
        insufficientData++;
        continue;
      }

      // 2. Invalid Email
      if (!isValidEmail(userData.email)) {
        invalidEmail++;
        continue;
      }

      // 3. No Consent (strict check: consents.email === true)
      if (userData.consents?.email !== true) {
        noConsent++;
        continue;
      }

      // 4. Premium Excluded (active premium access evaluated using referenceTimestamp)
      const evaluation = evaluatePremiumAccess(userData, referenceTimestamp);
      if (evaluation.isPremium === true) {
        premiumExcluded++;
        continue;
      }

      // 5. Eligible (all exclusions passed)
      if (isEligibleForCampaign(userData, referenceTimestamp)) {
        eligible++;
      } else {
        // Fallback or unhandled edge case
        insufficientData++;
      }
    }

    const sumCategories = eligible + premiumExcluded + noConsent + invalidEmail + insufficientData;
    if (sumCategories !== totalExamined) {
      const diff = totalExamined - sumCategories;
      insufficientData += diff;
    }

    const responsePayload: any = {
      success: true,
      pageSize: pageDocs.length,
      referenceTimestamp,
      metrics: {
        totalExamined,
        eligible,
        premiumExcluded,
        noConsent,
        invalidEmail,
        insufficientData,
      },
      hasMore,
    };

    if (nextCursor) {
      responsePayload.nextCursor = nextCursor;
    }

    return sendJson(res, 200, responsePayload);

  } catch (err: any) {
    console.error('[Campaign Dry-Run Error] Internal failure during dry-run scan.');
    return sendJson(res, 500, {
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Erro interno ao processar a simulação de campanha.',
    });
  }
}
