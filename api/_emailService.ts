import { getAdminFirestore } from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import crypto from 'crypto';

function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function verifyAdminSecret(providedSecret: string | undefined, expectedSecret: string = process.env.DIAGNOSTIC_SECRET || ''): boolean {
  if (!providedSecret || !expectedSecret) return false;
  try {
    const bufA = Buffer.from(providedSecret);
    const bufB = Buffer.from(expectedSecret);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export interface EmailTemplateParams {
  userName?: string;
  headline?: string;
  bodyHtml?: string;
  ctaText?: string;
  checkoutUrl?: string;
}

export function generateCampaignEmailHtml(params: EmailTemplateParams): { subject: string; html: string; text: string } {
  const name = escapeHtml(params.userName || 'estudante');
  const checkoutUrl = escapeHtml(params.checkoutUrl || 'https://aprova-direito.vercel.app/?tab=premium');
  const headline = escapeHtml(params.headline || 'Dê o próximo passo rumo à sua aprovação na OAB');
  const ctaText = escapeHtml(params.ctaText || 'ASSINAR PREMIUM AGORA');
  
  const customBody = params.bodyHtml || `
    <p>
      Sua preparação para o Exame de Ordem e Concursos Jurídicos merece ferramentas de alto desempenho. Com o <strong>Plano Premium</strong> do Aprova Direito, você estuda com foco total e acesso completo a todo o nosso acervo.
    </p>
    <div style="background-color: #F8FAFC; border-left: 4px solid #D4AF37; padding: 16px 20px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0; font-size: 14px; color: #1E293B; font-weight: 600;">
        O que você desbloqueia no Plano Premium:
      </p>
      <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 14px; color: #475569; line-height: 1.5;">
        <li>Banco completo de questões didáticas com comentários e fundamentação legal.</li>
        <li>Simulados cronometrados e ilimitados no padrão FGV.</li>
        <li>Laboratório de peças processuais para a 2ª fase.</li>
        <li>Biblioteca de apostilas e manuais aprofundados.</li>
      </ul>
    </div>
    <p>
      Tenha acesso irrestrito por R$ 29,90/mês, com pagamento seguro via Cartão de Crédito ou Pix (sem fidelidade).
    </p>
  `;

  const subject = `${params.userName ? params.userName + ', d' : 'D'}ê o próximo passo rumo à sua aprovação na OAB`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aprova Direito - Plano Premium</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #F8FAFC; padding: 40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(11,31,58,0.08); border: 1px solid #E2E8F0;">
          
          <!-- Header -->
          <tr>
            <td align="center" style="background-color: #0B1F3A; padding: 32px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="color: #D4AF37; font-family: serif; font-size: 22px; font-weight: bold; letter-spacing: 1px;">
                    ⚖️ APROVA DIREITO
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 40px 32px; color: #334155; font-size: 16px; line-height: 1.6;">
              <p style="margin-top: 0; font-size: 18px; font-weight: bold; color: #0B1F3A;">
                Olá, ${name}!
              </p>
              
              ${customBody}

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 32px auto;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #D4AF37;">
                    <a href="${checkoutUrl}" target="_blank" style="font-size: 15px; font-weight: bold; color: #0B1F3A; text-decoration: none; padding: 14px 32px; display: inline-block; border-radius: 8px; background-color: #D4AF37; border: 1px solid #C5A028; letter-spacing: 0.5px;">
                      ${ctaText}
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin-bottom: 0; font-size: 14px; color: #64748B;">
                Bons estudos,<br>
                <strong>Equipe Aprova Direito</strong>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color: #F1F5F9; padding: 20px 24px; font-size: 12px; color: #94A3B8;">
              <p style="margin: 0;">
                Você está recebendo este e-mail por estar cadastrado na plataforma Aprova Direito.<br>
                Para alterar suas preferências de comunicação, acesse as configurações do seu perfil.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Olá, ${params.userName || 'estudante'}!\n\n${headline}\n\nAcesse: ${params.checkoutUrl || 'https://aprova-direito.vercel.app/?tab=premium'}\n\nBons estudos,\nEquipe Aprova Direito`;

  return { subject, html, text };
}

export interface SendCampaignParams {
  uid: string;
  to: string;
  campaignId: string;
  userName?: string;
  headline?: string;
  bodyHtml?: string;
  ctaText?: string;
  from?: string;
  // Optional test dependency overrides for isolated testing
  _testDb?: any;
  _testFetch?: typeof fetch;
}

export async function sendCampaignEmailWithGuards(params: SendCampaignParams): Promise<{ success: boolean; error?: string }> {
  if (!isValidEmail(params.to)) {
    return { success: false, error: 'INVALID_RECIPIENT_EMAIL' };
  }

  const db = params._testDb || getAdminFirestore();
  if (!db) {
    return { success: false, error: 'DATABASE_NOT_INITIALIZED' };
  }

  const userRef = db.collection('users').doc(params.uid);
  const historyRef = userRef.collection('campaign_history').doc(params.campaignId);

  // 1. Transactional Atomic Reservation, LGPD & Premium Check
  try {
    const acquireResult = await db.runTransaction(async (transaction: any) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) {
        return { status: 'ERROR' as const, error: 'USER_NOT_FOUND' };
      }
      const userData = userDoc.data();
      const emailConsent = Boolean(userData?.consents?.email);
      if (!emailConsent) {
        return { status: 'ERROR' as const, error: 'LGPD_CONSENT_REQUIRED' };
      }

      const premiumEvaluation = evaluatePremiumAccess(userData);
      if (premiumEvaluation.isPremium === true) {
        return { status: 'ERROR' as const, error: 'USER_HAS_ACTIVE_PREMIUM' };
      }

      const historyDoc = await transaction.get(historyRef);
      const nowMs = Date.now();
      const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes timeout for abandoned pending reservations

      if (historyDoc.exists) {
        const data = historyDoc.data();
        const st = data?.status;
        const updatedAt = data?.updatedAt ? Date.parse(data.updatedAt) : 0;

        if (st === 'SENT') {
          return { status: 'ERROR' as const, error: 'ALREADY_SENT' };
        }
        if (st === 'UNKNOWN') {
          // Requires manual reconciliation, do not retry automatically
          return { status: 'ERROR' as const, error: 'CAMPAIGN_STATE_UNKNOWN_REQUIRES_RECONCILIATION' };
        }
        if (st === 'PENDING') {
          if (nowMs - updatedAt < STALE_PENDING_MS) {
            return { status: 'ERROR' as const, error: 'ALREADY_PENDING' };
          }
        }
      }

      // Atomically set state to PENDING
      transaction.set(historyRef, {
        campaignId: params.campaignId,
        channel: 'email',
        to: params.to,
        status: 'PENDING',
        createdAt: nowMs,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return { status: 'OK' as const };
    });

    if (acquireResult.status === 'ERROR') {
      return { success: false, error: acquireResult.error };
    }
  } catch (err: any) {
    return { success: false, error: `TRANSACTION_ERROR: ${err?.message || err}` };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    try {
      await historyRef.set({
        status: 'FAILED',
        error: 'RESEND_API_KEY_NOT_CONFIGURED',
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}
    return { success: false, error: 'RESEND_API_KEY_NOT_CONFIGURED' };
  }

  const { subject, html, text } = generateCampaignEmailHtml({
    userName: params.userName,
    headline: params.headline,
    bodyHtml: params.bodyHtml,
    ctaText: params.ctaText,
    checkoutUrl: 'https://aprova-direito.vercel.app/?tab=premium'
  });

  const fromEmail = params.from || process.env.RESEND_FROM_EMAIL || 'Aprova Direito <noreply@aprovadireito.com.br>';
  const idempotencyKey = `campaign-${params.campaignId}-${params.uid}`;

  const fetchFn = params._testFetch || fetch;

  // 2. Dispatch via Resend API with Idempotency-Key header
  try {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject,
        html,
        text
      })
    });

    if (response.ok) {
      // 3. Confirm SENT status ONLY upon explicit success confirmation from Resend
      await historyRef.set({
        campaignId: params.campaignId,
        channel: 'email',
        to: params.to,
        timestamp: new Date().toISOString(),
        status: 'SENT',
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return { success: true };
    }

    const errBody = await response.text();

    // If explicit client error (4xx), Resend rejected it -> FAILED
    if (response.status >= 400 && response.status < 500) {
      await historyRef.set({
        status: 'FAILED',
        error: `RESEND_CLIENT_ERROR_${response.status}: ${errBody}`,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return { success: false, error: `RESEND_CLIENT_ERROR_${response.status}: ${errBody}` };
    }

    // If server error (5xx) or ambiguous status -> UNKNOWN (cannot confirm if accepted or dropped)
    await historyRef.set({
      status: 'UNKNOWN',
      error: `RESEND_SERVER_AMBIGUOUS_${response.status}: ${errBody}`,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    return { success: false, error: `RESEND_SERVER_AMBIGUOUS_${response.status}: ${errBody}` };

  } catch (err: any) {
    // Network timeout, connection drop -> UNKNOWN (status uncertain, do not retry automatically)
    try {
      await historyRef.set({
        status: 'UNKNOWN',
        error: `NETWORK_TIMEOUT_OR_AMBIGUOUS: ${err?.message || err}`,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch {}

    return { success: false, error: `NETWORK_TIMEOUT_OR_AMBIGUOUS: ${err?.message || err}` };
  }
}

export interface AdminTestEmailResult {
  success: boolean;
  status: number;
  recipient: string;
  error?: string;
}

export async function sendAdminTestEmail(
  apiKey: string | undefined = process.env.RESEND_API_KEY
): Promise<AdminTestEmailResult> {
  const recipient = 'suporteappaprovadireito@gmail.com';
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    return {
      success: false,
      status: 503,
      recipient,
      error: 'RESEND_API_KEY_NOT_CONFIGURED',
    };
  }

  const db = getAdminFirestore();
  if (!db) {
    return { success: false, status: 500, recipient, error: 'DATABASE_NOT_INITIALIZED' };
  }

  const testRef = db.collection('admin_tests').doc('global_email_test');
  const runId = crypto.randomBytes(16).toString('hex');

  try {
    const acquireResult = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(testRef);
      if (doc.exists) {
        const data = doc.data();
        const st = data?.status;

        if (st === 'SENT') {
          return { status: 'ERROR' as const, error: 'TEST_ALREADY_SENT_PERMANENT_BLOCK', httpStatus: 409 };
        }
        if (st === 'UNKNOWN') {
          return { status: 'ERROR' as const, error: 'TEST_STATE_UNKNOWN_REQUIRES_RECONCILIATION', httpStatus: 409 };
        }
        if (st === 'PENDING') {
          return { status: 'ERROR' as const, error: 'TEST_ALREADY_PENDING_MUTEX_LOCKED', httpStatus: 429 };
        }
      }

      // Atomically set state to PENDING with unique runId (no automatic timeout expiration)
      transaction.set(testRef, {
        status: 'PENDING',
        runId,
        createdAt: Date.now(),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return { status: 'OK' as const };
    });

    if (acquireResult.status === 'ERROR') {
      return {
        success: false,
        status: acquireResult.httpStatus || 400,
        recipient,
        error: acquireResult.error
      };
    }
  } catch (err: any) {
    return {
      success: false,
      status: 500,
      recipient,
      error: `TRANSACTION_ERROR: ${err?.message || err}`
    };
  }

  const { subject, html, text } = generateCampaignEmailHtml({
    userName: 'Administrador',
    headline: 'Teste de Envio - Sistema de E-mails Aprova Direito',
    ctaText: 'ACESSAR PLATAFORMA',
    checkoutUrl: 'https://aprova-direito.vercel.app/?tab=premium',
  });

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Aprova Direito <noreply@aprovadireito.app.br>';
  const idempotencyKey = `admin-test-${runId}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanKey}`,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject,
        html,
        text,
      }),
    });

    if (response.ok) {
      try {
        await db.runTransaction(async (t) => {
          const snap = await t.get(testRef);
          if (snap.exists && snap.data()?.runId === runId) {
            t.set(testRef, {
              status: 'SENT',
              runId,
              timestamp: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        });
      } catch {}

      return {
        success: true,
        status: 200,
        recipient,
      };
    }

    const errBody = await response.text();

    if (response.status >= 400 && response.status < 500) {
      try {
        await db.runTransaction(async (t) => {
          const snap = await t.get(testRef);
          if (snap.exists && snap.data()?.runId === runId) {
            t.set(testRef, {
              status: 'FAILED',
              runId,
              error: `RESEND_CLIENT_ERROR_${response.status}: ${errBody}`,
              updatedAt: new Date().toISOString()
            }, { merge: true });
          }
        });
      } catch {}

      return {
        success: false,
        status: response.status,
        recipient,
        error: `RESEND_CLIENT_ERROR_${response.status}: ${errBody}`,
      };
    }

    // Server error (5xx) or ambiguous response -> UNKNOWN
    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(testRef);
        if (snap.exists && snap.data()?.runId === runId) {
          t.set(testRef, {
            status: 'UNKNOWN',
            runId,
            error: `RESEND_SERVER_AMBIGUOUS_${response.status}: ${errBody}`,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      });
    } catch {}

    return {
      success: false,
      status: response.status,
      recipient,
      error: `RESEND_SERVER_AMBIGUOUS_${response.status}: ${errBody}`,
    };

  } catch (err: any) {
    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(testRef);
        if (snap.exists && snap.data()?.runId === runId) {
          t.set(testRef, {
            status: 'UNKNOWN',
            runId,
            error: `NETWORK_TIMEOUT_OR_AMBIGUOUS: ${err?.message || err}`,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      });
    } catch {}

    return {
      success: false,
      status: 500,
      recipient,
      error: `NETWORK_TIMEOUT_OR_AMBIGUOUS: ${err?.message || err}`,
    };
  }
}
