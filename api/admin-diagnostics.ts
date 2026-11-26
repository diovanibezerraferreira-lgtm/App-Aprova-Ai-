import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { getAdminFirestore, isPreviewSharingProductionFirestore } from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { runFlashLiteDiagnostic } from './_flashLiteDiagnostics.js';
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

const MIN_SECRET_LENGTH = 16;
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

function isEligibleForCampaign(userData: any, nowMs: number = Date.now()): boolean {
  if (!userData || userData.consents?.email !== true) {
    return false;
  }
  const evaluation = evaluatePremiumAccess(userData, nowMs);
  return evaluation.isPremium === false;
}

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

  // Parse action from query string or URL
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const action = urlObj.searchParams.get('__action');

  const ALLOWED_ACTIONS = ['email-test', 'email-reset', 'campaign-dry-run', 'flash-test'];
  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return sendJson(res, 400, {
      error: 'INVALID_ACTION',
      message: 'Ação administrativa inválida ou não especificada.',
    });
  }

  try {
    if (isPreviewSharingProductionFirestore()) {
      return sendJson(res, 403, {
        error: 'PREVIEW_PRODUCTION_FIRESTORE_BLOCKED',
        message: 'Ambiente Preview bloqueado por segurança.',
        blocked: true,
      });
    }
  } catch {
    return sendJson(res, 403, {
      error: 'ENVIRONMENT_INSPECTION_FAILED',
      message: 'Falha ao validar o ambiente de execução.',
      blocked: true,
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
  const authorized = presented.length >= MIN_SECRET_LENGTH && timingSafeCompare(presented, configuredSecret);

  if (!authorized) {
    return sendJson(res, 401, {
      error: 'UNAUTHORIZED',
      message: 'Acesso restrito a chamadas administrativas autorizadas.',
    });
  }

  // Dispatch based on action
  if (action === 'email-test') {
    try {
      const { sendAdminTestEmail } = await import('./_emailService.js');
      const result = await sendAdminTestEmail(process.env.RESEND_API_KEY);
      return sendJson(res, result.success ? 200 : result.status, {
        success: result.success,
        recipient: result.recipient,
        status: result.status,
        error: result.error || null,
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        recipient: 'suporteappaprovadireito@gmail.com',
        status: 500,
        error: err?.message || 'Erro interno ao executar teste de e-mail.',
      });
    }
  }

  if (action === 'email-reset') {
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

    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return sendJson(res, 400, {
        error: 'REASON_REQUIRED',
        message: 'O campo "reason" (motivo do reset) é obrigatório e não pode estar vazio.',
      });
    }

    if (reason.length > 500) {
      return sendJson(res, 400, {
        error: 'REASON_TOO_LONG',
        message: 'O campo "reason" excede o limite máximo de 500 caracteres.',
      });
    }

    const db = getAdminFirestore();
    if (!db) {
      return sendJson(res, 500, {
        error: 'DATABASE_NOT_INITIALIZED',
        message: 'Banco de dados não inicializado.',
      });
    }

    const testRef = db.collection('admin_tests').doc('global_email_test');
    const nowIso = new Date().toISOString();

    try {
      const result = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(testRef);
        if (!doc.exists) {
          return {
            error: 'RESET_STATE_NOT_ALLOWED',
            message: 'O documento de teste não existe. Não há estado para resetar.',
            status: 409
          };
        }

        const data = doc.data();
        const st = data?.status;

        if (st === 'PENDING') {
          return {
            error: 'TEST_MUTEX_PENDING_ACTIVE',
            message: 'Não é permitido resetar enquanto houver um teste em execução (PENDING).',
            status: 423
          };
        }

        if (st === 'UNKNOWN') {
          return {
            error: 'TEST_STATE_UNKNOWN_REQUIRES_RECONCILIATION',
            message: 'O estado atual é UNKNOWN e requer reconciliação manual com o histórico do Resend antes de qualquer reset.',
            status: 409
          };
        }

        if (st !== 'SENT' && st !== 'FAILED') {
          return {
            error: 'RESET_STATE_NOT_ALLOWED',
            message: `O estado atual (${st || 'NONE'}) não é elegível para reset. Apenas SENT e FAILED podem ser resetados.`,
            status: 409
          };
        }

        const previousState = st;
        const newRunId = crypto.randomBytes(16).toString('hex');

        transaction.set(testRef, {
          status: 'RESET',
          runId: newRunId,
          previousState,
          reason,
          authMethod: 'DIAGNOSTIC_SECRET',
          resetAt: nowIso,
          updatedAt: nowIso
        }, { merge: true });

        return {
          success: true,
          previousState,
          reason,
          resetAt: nowIso,
          message: 'Estado de teste administrativo resetado com sucesso. Pronto para novo teste.'
        };
      });

      if ('error' in result) {
        return sendJson(res, result.status || 400, {
          error: result.error,
          message: result.message
        });
      }

      return sendJson(res, 200, {
        success: true,
        previousState: result.previousState,
        reason: result.reason,
        resetAt: result.resetAt,
        message: result.message
      });

    } catch (err: any) {
      console.error('[Admin Email Reset Error] Internal failure during reset transaction.');
      return sendJson(res, 500, {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Erro interno ao processar o reset administrativo.',
      });
    }
  }

  if (action === 'campaign-dry-run') {
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

    const BATCH_SIZE = 500;

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

        if (!userData || typeof userData !== 'object') {
          insufficientData++;
          continue;
        }

        if (!isValidEmail(userData.email)) {
          invalidEmail++;
          continue;
        }

        if (userData.consents?.email !== true) {
          noConsent++;
          continue;
        }

        let evaluation;
        try {
          evaluation = evaluatePremiumAccess(userData, referenceTimestamp);
        } catch {
          insufficientData++;
          continue;
        }

        if (!evaluation || typeof evaluation.isPremium !== 'boolean') {
          insufficientData++;
          continue;
        }

        if (evaluation.isPremium === true) {
          premiumExcluded++;
        } else {
          eligible++;
        }
      }

      const sumCategories = eligible + premiumExcluded + noConsent + invalidEmail + insufficientData;
      if (sumCategories !== totalExamined) {
        console.error('[Campaign Dry-Run Error] Classification sum mismatch: totalExamined does not equal sum of categories.');
        return sendJson(res, 500, {
          error: 'INTERNAL_CLASSIFICATION_MISMATCH',
          message: 'Erro interno de consistência na classificação dos usuários.',
        });
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

  if (action === 'flash-test') {
    try {
      const result = await runFlashLiteDiagnostic(process.env.GEMINI_API_KEY);
      return sendJson(res, result.status, {
        success: result.success,
        modelTested: result.modelTested,
        status: result.status,
        errorCategory: result.errorCategory,
        elapsedMs: result.elapsedMs,
      });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        modelTested: 'gemini-3.5-flash-lite',
        status: 500,
        errorCategory: 'INTERNAL_ERROR',
        elapsedMs: 0,
      });
    }
  }

  return sendJson(res, 400, {
    error: 'INVALID_ACTION',
    message: 'Ação administrativa desconhecida.',
  });
}
