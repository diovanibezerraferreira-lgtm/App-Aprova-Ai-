import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { sendAdminTestEmail } from './_emailService.js';
import { isPreviewSharingProductionFirestore } from './_firebaseAdmin.js';

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

  try {
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
