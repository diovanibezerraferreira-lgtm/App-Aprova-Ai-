import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { getAdminFirestore, getFirebaseAdminDiagnostics } from './_firebaseAdmin.js';
import {
  getAsaasConfig,
  asaasFetch,
  fetchAsaasPaymentById,
  fetchAsaasSubscriptionById,
  type AsaasPayment,
  type AsaasSubscription,
} from './_asaas.js';
import {
  computePaidPeriodEndIso,
  parseDateTimestamp,
  resolveFallbackPremiumUntilIso,
} from './_premiumValidity.js';

type RequestWithBody = IncomingMessage & { body?: any };

const CONFIRMED_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const ACTIVATION_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const NEGATIVE_PAYMENT_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_DELETED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
]);
const SUBSCRIPTION_LIFECYCLE_EVENTS = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

const DEFAULT_PROD_PROJECT_ID = 'gen-lang-client-0793753103';
const DEFAULT_PROD_DATABASE_ID = 'ai-studio-aprovadireito-858e292a-4f1d-4483-a130-1a8041386c5a';

export interface WebhookDeps {
  getAdminFirestore: typeof getAdminFirestore;
  getFirebaseAdminDiagnostics: typeof getFirebaseAdminDiagnostics;
  getAsaasConfig: typeof getAsaasConfig;
  asaasFetch: typeof asaasFetch;
  fetchAsaasPaymentById: typeof fetchAsaasPaymentById;
  fetchAsaasSubscriptionById: typeof fetchAsaasSubscriptionById;
}

const defaultDeps: WebhookDeps = {
  getAdminFirestore,
  getFirebaseAdminDiagnostics,
  getAsaasConfig,
  asaasFetch,
  fetchAsaasPaymentById,
  fetchAsaasSubscriptionById,
};

function getProductionFirebaseIdentifiers(): { projectId: string; databaseId: string } {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      projectId: String(parsed?.projectId || DEFAULT_PROD_PROJECT_ID),
      databaseId: String(parsed?.firestoreDatabaseId || DEFAULT_PROD_DATABASE_ID),
    };
  } catch {
    return {
      projectId: DEFAULT_PROD_PROJECT_ID,
      databaseId: DEFAULT_PROD_DATABASE_ID,
    };
  }
}

async function readBody(req: RequestWithBody): Promise<any> {
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

  if (req.readableEnded) {
    return {};
  }

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
      reject(new Error('Tempo limite ao ler corpo da requisição do webhook.'));
    }, 3000);

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
        reject(new Error('Corpo do webhook inválido'));
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

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function cleanTokenValue(raw?: string | string[]): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') return '';
  let value = first.trim();
  let prev = '';
  while (value !== prev) {
    prev = value;
    value = value.replace(/(\\r\\n|\\n|\\r)+$/g, '').trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function extractAsaasAccessToken(req: RequestWithBody): {
  token: string;
  headerPresent: boolean;
} {
  const headers = req.headers || {};
  let rawHeader: string | string[] | undefined = headers['asaas-access-token'];

  if (rawHeader === undefined) {
    for (const [key, val] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'asaas-access-token' || lower === 'access_token') {
        rawHeader = val;
        break;
      }
    }
  }

  const token = cleanTokenValue(rawHeader);
  return {
    token,
    headerPresent: rawHeader !== undefined && token.length > 0,
  };
}

function tokensMatch(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeDocId(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function isNotFoundOrInvalidEntityError(err: any): boolean {
  const status = Number(err?.status);
  return status === 404 || status === 400;
}

export async function handleWebhook(
  req: RequestWithBody,
  res: ServerResponse,
  deps: WebhookDeps = defaultDeps
) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Método não permitido' });
  }

  try {
    const config = deps.getAsaasConfig();
    const expectedWebhookToken = cleanTokenValue(process.env.ASAAS_WEBHOOK_TOKEN);

    // 1. Validate Asaas webhook secret token from asaas-access-token header
    if (!expectedWebhookToken) {
      console.error('ASAAS_WEBHOOK_TOKEN não configurado no servidor.');
      return sendJson(res, 500, {
        error:
          'ASAAS_WEBHOOK_TOKEN não configurado no servidor. Defina o token secreto do webhook nas variáveis de ambiente.',
      });
    }

    const { token: headerToken, headerPresent } = extractAsaasAccessToken(req);
    if (!headerPresent || !tokensMatch(headerToken, expectedWebhookToken)) {
      console.warn(
        `Webhook rejeitado (401): header asaas-access-token ${headerPresent ? 'divergente' : 'ausente'} (receivedLen=${headerToken.length}, expectedLen=${expectedWebhookToken.length}).`
      );
      return sendJson(res, 401, { error: 'Token de webhook inválido ou ausente' });
    }

    // 2. Enforce strict Vercel & Asaas environment and Firestore isolation BEFORE any DB read/write
    const diagnostics = deps.getFirebaseAdminDiagnostics();
    const prodIds = getProductionFirebaseIdentifiers();
    const isProductionFirestore =
      diagnostics.projectId === prodIds.projectId &&
      diagnostics.databaseId === prodIds.databaseId;
    const VERCEL_ENV = config.vercelEnv || cleanTokenValue(process.env.VERCEL_ENV);

    if (VERCEL_ENV === 'preview' && isProductionFirestore) {
      console.warn(
        `Webhook bloqueado (403) no ambiente Preview: Preview compartilha o Firestore de produção (${diagnostics.databaseId}).`
      );
      return sendJson(res, 403, {
        blocked: true,
        error:
          'Processamento de webhook bloqueado no ambiente Preview enquanto compartilhar o Firestore de produção.',
      });
    }

    if (config.envError) {
      console.error('Configuração inválida do ambiente Asaas no webhook:', config.envError);
      return sendJson(res, 500, { error: config.envError });
    }

    if (config.envMismatch) {
      const mismatchMsg = `Incompatibilidade de ambiente Asaas: ASAAS_ENVIRONMENT está definido como "${config.env}", mas a ASAAS_API_KEY pertence ao ambiente "${config.keyEnv}".`;
      console.error(mismatchMsg);
      return sendJson(res, 500, { error: mismatchMsg });
    }

    if (!config.isProduction && isProductionFirestore) {
      console.warn(
        `Webhook bloqueado (403): ambiente Asaas "${config.env}" não pode alterar assinaturas na base de produção.`
      );
      return sendJson(res, 403, {
        blocked: true,
        error:
          'Eventos do ambiente Sandbox não podem alterar usuários, assinaturas ou dados Premium na base de produção.',
      });
    }

    const payload = await readBody(req);
    const { event, payment, subscription } = payload || {};

    if (!event || typeof event !== 'string') {
      return sendJson(res, 400, { error: 'Evento não especificado' });
    }

    const isActivationEvent = ACTIVATION_EVENTS.has(event);
    const isNegativePaymentEvent = NEGATIVE_PAYMENT_EVENTS.has(event);
    const isSubscriptionLifecycleEvent = SUBSCRIPTION_LIFECYCLE_EVENTS.has(event);

    // 3. In Production, directly verify the payment/subscription against the server-configured Asaas API
    let verifiedPayment: AsaasPayment | null = null;
    let verifiedSubscription: AsaasSubscription | null = null;

    if (config.isProduction && (isActivationEvent || isNegativePaymentEvent)) {
      const paymentId = typeof payment?.id === 'string' ? payment.id.trim() : '';
      if (!paymentId) {
        return sendJson(res, 400, { error: 'ID do pagamento ausente no webhook Asaas.' });
      }

      try {
        verifiedPayment = await deps.fetchAsaasPaymentById(paymentId);
      } catch (apiErr: any) {
        if (isNotFoundOrInvalidEntityError(apiErr)) {
          console.warn(
            `Webhook bloqueado (403): pagamento ${paymentId} (${event}) não existe na API Asaas de produção (possível evento Sandbox).`
          );
          return sendJson(res, 403, {
            blocked: true,
            error:
              'Pagamento não localizado no ambiente Asaas de produção. Evento rejeitado para proteger a base real.',
          });
        }
        const status = Number(apiErr?.status) === 500 ? 500 : 502;
        console.error(`Falha ao consultar pagamento ${paymentId} na API Asaas:`, apiErr);
        return sendJson(res, status, {
          error:
            apiErr?.message ||
            'Não foi possível validar o pagamento diretamente na API Asaas de produção.',
        });
      }

      if (!verifiedPayment || verifiedPayment.id !== paymentId) {
        return sendJson(res, 403, {
          blocked: true,
          error: 'Pagamento retornado pela API Asaas não corresponde ao ID do webhook.',
        });
      }
    } else if (config.isProduction && isSubscriptionLifecycleEvent) {
      const subscriptionId = typeof subscription?.id === 'string' ? subscription.id.trim() : '';
      if (!subscriptionId) {
        return sendJson(res, 400, { error: 'ID da assinatura ausente no webhook Asaas.' });
      }

      try {
        verifiedSubscription = await deps.fetchAsaasSubscriptionById(subscriptionId);
      } catch (apiErr: any) {
        if (isNotFoundOrInvalidEntityError(apiErr)) {
          console.warn(
            `Webhook bloqueado (403): assinatura ${subscriptionId} (${event}) não existe na API Asaas de produção.`
          );
          return sendJson(res, 403, {
            blocked: true,
            error:
              'Assinatura não localizada no ambiente Asaas de produção. Evento rejeitado para proteger a base real.',
          });
        }
        const status = Number(apiErr?.status) === 500 ? 500 : 502;
        console.error(`Falha ao consultar assinatura ${subscriptionId} na API Asaas:`, apiErr);
        return sendJson(res, status, {
          error:
            apiErr?.message ||
            'Não foi possível validar a assinatura diretamente na API Asaas de produção.',
        });
      }

      if (!verifiedSubscription || verifiedSubscription.id !== subscriptionId) {
        return sendJson(res, 403, {
          blocked: true,
          error: 'Assinatura retornada pela API Asaas não corresponde ao ID do webhook.',
        });
      }
    }

    const db = deps.getAdminFirestore();
    if (!db) {
      const currentDiagnostics = deps.getFirebaseAdminDiagnostics();
      console.error('Firestore Admin não inicializado no webhook:', currentDiagnostics);
      return sendJson(res, 500, {
        error:
          currentDiagnostics.lastAdminInitError ||
          'Banco de dados administrativo não disponível no servidor.',
      });
    }

    // Use API-verified entities as authoritative sources when available
    const effectivePayment = verifiedPayment || payment;
    const effectiveSubscription = verifiedSubscription || subscription;

    // 4. Build deterministic idempotency keys
    const rawEventId =
      payload.id ||
      (effectivePayment?.id
        ? `${effectivePayment.id}_${event}`
        : `${event}_${effectiveSubscription?.id || Date.now()}`);
    const eventId = sanitizeDocId(rawEventId);
    const paymentEventId = effectivePayment?.id
      ? sanitizeDocId(`${effectivePayment.id}_${event}`)
      : null;

    const eventRef = db.collection('processed_webhook_events').doc(eventId);
    const paymentEventRef =
      paymentEventId && paymentEventId !== eventId
        ? db.collection('processed_webhook_events').doc(paymentEventId)
        : null;

    // 5. Identify target Firebase user UID (prefer API-verified externalReference/customer)
    let targetUid: string | null = null;

    if (effectivePayment?.externalReference) {
      targetUid = String(effectivePayment.externalReference).trim() || null;
    } else if (effectiveSubscription?.externalReference) {
      targetUid = String(effectiveSubscription.externalReference).trim() || null;
    } else if (!config.isProduction && payment?.externalReference) {
      targetUid = String(payment.externalReference).trim() || null;
    } else if (!config.isProduction && subscription?.externalReference) {
      targetUid = String(subscription.externalReference).trim() || null;
    }

    const customerId = effectivePayment?.customer || effectiveSubscription?.customer || null;

    if (!targetUid && customerId) {
      const userSnapshot = await db
        .collection('users')
        .where('asaasCustomerId', '==', customerId)
        .limit(1)
        .get();

      if (!userSnapshot.empty) {
        targetUid = userSnapshot.docs[0].id;
      }
    }

    const candidateEmail =
      (typeof payment?.email === 'string' && payment.email.trim()) ||
      (typeof payment?.customerEmail === 'string' && payment.customerEmail.trim()) ||
      '';

    if (!targetUid && candidateEmail) {
      const emailSnapshot = await db
        .collection('users')
        .where('email', '==', candidateEmail)
        .limit(1)
        .get();

      if (!emailSnapshot.empty) {
        targetUid = emailSnapshot.docs[0].id;
      }
    }

    // External Asaas fallback only when local lookups could not resolve UID
    if (!targetUid && customerId && config.isConfigured) {
      try {
        const customerData = await deps.asaasFetch<any>(
          `/customers/${encodeURIComponent(customerId)}`,
          {},
          2500
        );
        if (customerData?.externalReference) {
          targetUid = String(customerData.externalReference).trim() || null;
        } else if (customerData?.email) {
          const emailSnapshot = await db
            .collection('users')
            .where('email', '==', String(customerData.email).trim())
            .limit(1)
            .get();
          if (!emailSnapshot.empty) {
            targetUid = emailSnapshot.docs[0].id;
          }
        }
      } catch (fetchErr) {
        console.warn('Aviso ao consultar cliente no Asaas durante webhook:', fetchErr);
      }
    }

    if (targetUid && (targetUid.includes('/') || targetUid.length > 128)) {
      console.warn('targetUid inválido ignorado no webhook:', targetUid);
      targetUid = null;
    }

    console.log(
      `Recebido webhook Asaas [${config.env}]: [${event}] eventId=${eventId} para usuário UID: ${targetUid || 'desconhecido'}`
    );

    // 6. Single atomic Firestore Transaction for Idempotency + User Subscription State
    let alreadyProcessed = false;
    let actionTaken = 'recorded';
    const userDocRef = targetUid ? db.collection('users').doc(targetUid) : null;

    await db.runTransaction(async (tx) => {
      const [existingEvent, existingPaymentEvent, existingUserSnap] = await Promise.all([
        tx.get(eventRef),
        paymentEventRef ? tx.get(paymentEventRef) : Promise.resolve(null),
        userDocRef ? tx.get(userDocRef) : Promise.resolve(null),
      ]);

      if (existingEvent.exists || existingPaymentEvent?.exists) {
        alreadyProcessed = true;
        return;
      }

      const existingUser = existingUserSnap?.exists ? existingUserSnap.data() : null;
      const incomingSubId = effectivePayment?.subscription || effectiveSubscription?.id || null;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const getRetainedPaidUntil = (): string | null => {
        if (!existingUser) return null;
        const explicitMs = parseDateTimestamp(existingUser.premiumUntil);
        if (explicitMs !== null) {
          return explicitMs > nowMs ? new Date(explicitMs).toISOString() : null;
        }
        const fallbackIso = resolveFallbackPremiumUntilIso(existingUser);
        const fallbackMs = parseDateTimestamp(fallbackIso);
        return fallbackMs !== null && fallbackMs > nowMs ? fallbackIso : null;
      };

      const isStaleSubscriptionMismatch = Boolean(
        existingUser?.subscriptionId &&
          incomingSubId &&
          existingUser.subscriptionId !== incomingSubId
      );

      const isCustomerMismatch = Boolean(
        existingUser?.isPremium === true &&
          existingUser?.asaasCustomerId &&
          customerId &&
          existingUser.asaasCustomerId !== customerId
      );

      if (userDocRef) {
        switch (event) {
          case 'PAYMENT_RECEIVED':
          case 'PAYMENT_CONFIRMED': {
            const paymentStatus = effectivePayment?.status
              ? String(effectivePayment.status).trim()
              : null;

            if (verifiedPayment?.deleted) {
              actionTaken = 'ignored_deleted_payment';
              break;
            }

            // Never unlock Premium unless verified status returned by Asaas API is CONFIRMED, RECEIVED, or RECEIVED_IN_CASH
            if (!paymentStatus || !CONFIRMED_PAYMENT_STATUSES.has(paymentStatus)) {
              actionTaken = `ignored_unconfirmed_status_${paymentStatus || 'UNKNOWN'}`;
              break;
            }

            const thisPaymentPeriodEndIso = computePaidPeriodEndIso({
              paymentDueDate: effectivePayment?.dueDate,
              paymentDate: (effectivePayment as any)?.paymentDate,
              confirmedDate: (effectivePayment as any)?.confirmedDate,
              clientPaymentDate: (effectivePayment as any)?.clientPaymentDate,
              subscriptionNextDueDate: effectiveSubscription?.nextDueDate,
              subscriptionCycle: effectiveSubscription?.cycle,
              existingPremiumUntil: null,
              nowMs,
            });
            const existingPremiumUntilMs = parseDateTimestamp(existingUser?.premiumUntil);
            const isOutdatedPayment =
              existingPremiumUntilMs !== null &&
              Date.parse(thisPaymentPeriodEndIso) < existingPremiumUntilMs;

            const nextPremiumUntil = isOutdatedPayment
              ? new Date(existingPremiumUntilMs!).toISOString()
              : thisPaymentPeriodEndIso;

            const keepCancelledOnSameSub =
              existingUser?.subscriptionStatus === 'CANCELLED' &&
              Boolean(existingUser?.cancelledAt) &&
              Boolean(incomingSubId) &&
              existingUser?.subscriptionId === incomingSubId;

            const confirmedDateRaw =
              (effectivePayment as any)?.confirmedDate ||
              (effectivePayment as any)?.paymentDate ||
              nowIso;

            tx.set(
              userDocRef,
              {
                isPremium: true,
                plan: 'premium',
                subscriptionStatus: keepCancelledOnSameSub ? 'CANCELLED' : 'ACTIVE',
                ...(keepCancelledOnSameSub ? {} : { cancelledAt: null }),
                subscriptionId: isOutdatedPayment
                  ? existingUser?.subscriptionId || incomingSubId || null
                  : incomingSubId || existingUser?.subscriptionId || null,
                asaasCustomerId: customerId || existingUser?.asaasCustomerId || null,
                subscriptionDueDate: isOutdatedPayment
                  ? existingUser?.subscriptionDueDate ||
                    effectivePayment?.dueDate ||
                    effectiveSubscription?.nextDueDate ||
                    null
                  : effectivePayment?.dueDate ||
                    effectiveSubscription?.nextDueDate ||
                    existingUser?.subscriptionDueDate ||
                    null,
                premiumUntil: nextPremiumUntil,
                lastPaymentDate: nowIso,
                lastConfirmedPaymentId: isOutdatedPayment
                  ? existingUser?.lastConfirmedPaymentId || effectivePayment?.id || null
                  : effectivePayment?.id || existingUser?.lastConfirmedPaymentId || null,
                lastConfirmedPaymentDate: isOutdatedPayment
                  ? existingUser?.lastConfirmedPaymentDate || confirmedDateRaw
                  : confirmedDateRaw,
                paymentMethod:
                  effectivePayment?.billingType || existingUser?.paymentMethod || 'UNDEFINED',
                updatedAt: nowIso,
              },
              { merge: true }
            );
            actionTaken = 'premium_activated';
            break;
          }

          case 'PAYMENT_OVERDUE': {
            const verifiedStatus = effectivePayment?.status
              ? String(effectivePayment.status).trim()
              : null;

            if (verifiedStatus && CONFIRMED_PAYMENT_STATUSES.has(verifiedStatus)) {
              actionTaken = 'ignored_overdue_payment_already_paid';
              break;
            }

            // Do not revoke an active/current subscription due to an abandoned older subscription
            if (isStaleSubscriptionMismatch) {
              actionTaken = 'ignored_stale_subscription_overdue';
              break;
            }

            if (isCustomerMismatch && existingUser?.subscriptionStatus === 'ACTIVE') {
              actionTaken = 'ignored_customer_mismatch_overdue';
              break;
            }

            const retainedUntil = getRetainedPaidUntil();
            const isDifferentFromConfirmed =
              !existingUser?.lastConfirmedPaymentId ||
              !effectivePayment?.id ||
              effectivePayment.id !== existingUser.lastConfirmedPaymentId;

            if (retainedUntil && isDifferentFromConfirmed) {
              tx.set(
                userDocRef,
                {
                  isPremium: true,
                  plan: 'premium',
                  subscriptionStatus: 'OVERDUE',
                  premiumUntil: retainedUntil,
                  updatedAt: nowIso,
                },
                { merge: true }
              );
              actionTaken = 'subscription_overdue_access_retained';
              break;
            }

            tx.set(
              userDocRef,
              {
                isPremium: false,
                plan: 'gratuito',
                subscriptionStatus: 'OVERDUE',
                updatedAt: nowIso,
              },
              { merge: true }
            );
            actionTaken = 'subscription_overdue';
            break;
          }

          case 'PAYMENT_REFUNDED':
          case 'PAYMENT_DELETED':
          case 'PAYMENT_CHARGEBACK_REQUESTED':
          case 'PAYMENT_REPROVED_BY_RISK_ANALYSIS':
          case 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED': {
            const verifiedStatus = effectivePayment?.status
              ? String(effectivePayment.status).trim()
              : null;

            if (
              event === 'PAYMENT_REFUNDED' &&
              verifiedStatus &&
              CONFIRMED_PAYMENT_STATUSES.has(verifiedStatus)
            ) {
              actionTaken = 'ignored_refund_payment_still_confirmed';
              break;
            }

            if (isStaleSubscriptionMismatch) {
              actionTaken = 'ignored_stale_subscription_cancelled';
              break;
            }

            if (isCustomerMismatch && existingUser?.subscriptionStatus === 'ACTIVE') {
              actionTaken = 'ignored_customer_mismatch_cancelled';
              break;
            }

            const isReversalEvent =
              event === 'PAYMENT_REFUNDED' || event === 'PAYMENT_CHARGEBACK_REQUESTED';
            const retainedUntil = getRetainedPaidUntil();
            const isDifferentFromConfirmedPayment = Boolean(
              existingUser?.lastConfirmedPaymentId &&
                effectivePayment?.id &&
                existingUser.lastConfirmedPaymentId !== effectivePayment.id
            );

            if (isReversalEvent) {
              if (retainedUntil && isDifferentFromConfirmedPayment) {
                actionTaken = 'ignored_non_current_payment_reversal';
                break;
              }

              tx.set(
                userDocRef,
                {
                  isPremium: false,
                  plan: 'gratuito',
                  subscriptionStatus: 'CANCELLED',
                  premiumUntil: null,
                  cancelledAt: nowIso,
                  updatedAt: nowIso,
                },
                { merge: true }
              );
              actionTaken = 'subscription_cancelled';
              break;
            }

            // Pending invoice deletions or failed future renewal attempts must not erase an already paid period
            if (retainedUntil && (isDifferentFromConfirmedPayment || event === 'PAYMENT_DELETED')) {
              tx.set(
                userDocRef,
                {
                  isPremium: true,
                  plan: 'premium',
                  premiumUntil: retainedUntil,
                  updatedAt: nowIso,
                },
                { merge: true }
              );
              actionTaken = 'ignored_unpaid_invoice_with_active_period';
              break;
            }

            tx.set(
              userDocRef,
              {
                isPremium: false,
                plan: 'gratuito',
                subscriptionStatus: 'CANCELLED',
                updatedAt: nowIso,
              },
              { merge: true }
            );
            actionTaken = 'subscription_cancelled';
            break;
          }

          case 'SUBSCRIPTION_DELETED':
          case 'SUBSCRIPTION_INACTIVATED': {
            const verifiedSubStatus = effectiveSubscription?.status
              ? String(effectiveSubscription.status).trim()
              : null;

            if (
              verifiedSubscription &&
              !verifiedSubscription.deleted &&
              verifiedSubStatus === 'ACTIVE'
            ) {
              actionTaken = 'ignored_subscription_still_active';
              break;
            }

            if (isStaleSubscriptionMismatch) {
              actionTaken = 'ignored_stale_subscription_cancelled';
              break;
            }

            if (isCustomerMismatch && existingUser?.subscriptionStatus === 'ACTIVE') {
              actionTaken = 'ignored_customer_mismatch_cancelled';
              break;
            }

            const payloadEventTimestamp = payload?.dateCreated || payload?.eventDate || null;
            const payloadEventMs = parseDateTimestamp(payloadEventTimestamp);
            const lastPaymentMs = parseDateTimestamp(existingUser?.lastPaymentDate);

            if (
              payloadEventMs !== null &&
              lastPaymentMs !== null &&
              payloadEventMs < lastPaymentMs &&
              existingUser?.subscriptionStatus === 'ACTIVE'
            ) {
              actionTaken = 'ignored_outdated_cancellation_event';
              break;
            }

            const retainedUntil = getRetainedPaidUntil();
            if (retainedUntil) {
              tx.set(
                userDocRef,
                {
                  isPremium: true,
                  plan: 'premium',
                  subscriptionStatus: 'CANCELLED',
                  premiumUntil: retainedUntil,
                  cancelledAt: existingUser?.cancelledAt || nowIso,
                  updatedAt: nowIso,
                },
                { merge: true }
              );
              actionTaken = 'subscription_cancelled_access_retained';
            } else {
              tx.set(
                userDocRef,
                {
                  isPremium: false,
                  plan: 'gratuito',
                  subscriptionStatus: 'CANCELLED',
                  premiumUntil: null,
                  cancelledAt: existingUser?.cancelledAt || nowIso,
                  updatedAt: nowIso,
                },
                { merge: true }
              );
              actionTaken = 'subscription_cancelled';
            }
            break;
          }

          default:
            actionTaken = 'ignored_event_type';
            break;
        }
      } else {
        actionTaken = 'user_not_found';
      }

      const auditRecord = {
        eventId,
        paymentEventId: paymentEventId || null,
        event,
        environment: config.env,
        verifiedWithAsaasApi: Boolean(verifiedPayment || verifiedSubscription),
        targetUid: targetUid || null,
        customerId: customerId || null,
        paymentId: effectivePayment?.id || null,
        subscriptionId: incomingSubId,
        actionTaken,
        processedAt: nowIso,
        payloadSummary: {
          event,
          paymentStatus: effectivePayment?.status || null,
          value: effectivePayment?.value ?? null,
          billingType: effectivePayment?.billingType || null,
        },
      };

      tx.set(eventRef, auditRecord);
      if (paymentEventRef) {
        tx.set(paymentEventRef, auditRecord);
      }
    });

    if (alreadyProcessed) {
      return sendJson(res, 200, { status: 'already_processed', eventId });
    }

    return sendJson(res, 200, {
      received: true,
      event,
      eventId,
      actionTaken,
      userUpdated:
        actionTaken === 'premium_activated' ||
        actionTaken === 'subscription_overdue' ||
        actionTaken === 'subscription_overdue_access_retained' ||
        actionTaken === 'subscription_cancelled' ||
        actionTaken === 'subscription_cancelled_access_retained',
    });
  } catch (error: any) {
    console.error('Erro ao processar webhook do Asaas:', error);
    return sendJson(res, 500, {
      error: error.message || 'Erro interno ao processar webhook.',
    });
  }
}

export default async function handler(req: RequestWithBody, res: ServerResponse) {
  return handleWebhook(req, res);
}
