import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from '../_firebaseAdmin.js';
import { getAsaasConfig, asaasFetch } from '../_asaas.js';
import {
  computePaidPeriodEndIso,
  evaluatePremiumAccess,
  normalizeSubscriptionStatus,
  parseDateTimestamp,
} from '../_premiumValidity.js';

export interface SubscriptionStatusDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  getAsaasConfig: typeof getAsaasConfig;
  asaasFetch: typeof asaasFetch;
}

const defaultDeps: SubscriptionStatusDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  getAsaasConfig,
  asaasFetch,
};

const CONFIRMED_PAYMENT_STATUSES = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
const REVERSED_OR_DISPUTED_STATUSES = new Set([
  'REFUNDED',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DUNNING_REQUESTED',
  'DUNNING_RECEIVED',
]);
const REVERSAL_WEBHOOK_EVENTS = [
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
] as const;

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sanitizeDocId(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

function isProductionAsaasConfig(config: ReturnType<typeof getAsaasConfig>): boolean {
  return Boolean(
    config &&
      config.isProduction === true &&
      !config.envError &&
      !config.envMismatch &&
      config.isConfigured &&
      config.baseUrl === 'https://api.asaas.com/v3'
  );
}

function hasPaymentReversalIndicators(payment: any): boolean {
  if (!payment || typeof payment !== 'object') return true;
  const status = String(payment.status || '').trim().toUpperCase();
  if (REVERSED_OR_DISPUTED_STATUSES.has(status)) return true;
  if (payment.deleted === true) return true;
  if (payment.chargeback) return true;
  if (Array.isArray(payment.refunds) && payment.refunds.length > 0) return true;
  const refundStatus = String(payment.refundStatus || '').trim().toUpperCase();
  if (refundStatus === 'DONE' || refundStatus === 'PENDING' || refundStatus === 'IN_PROGRESS') {
    return true;
  }
  return false;
}

function hasValidUidOwnership(params: {
  uid: string;
  payment: any;
  subscription: any;
  expectedSubId: string;
  expectedCustomerId: string;
}): boolean {
  const { uid, payment, subscription, expectedSubId, expectedCustomerId } = params;
  if (!payment || !subscription) return false;

  const subIdOnSub = String(subscription.id || '').trim();
  const subIdOnPay = String(payment.subscription || '').trim();
  if (subIdOnSub !== expectedSubId || subIdOnPay !== expectedSubId) {
    return false;
  }

  const subCustomer = String(subscription.customer || '').trim();
  const payCustomer = String(payment.customer || '').trim();
  if (expectedCustomerId) {
    if ((subCustomer && subCustomer !== expectedCustomerId) || payCustomer !== expectedCustomerId) {
      return false;
    }
  }
  if (subCustomer && payCustomer && subCustomer !== payCustomer) {
    return false;
  }

  const subExtRef =
    typeof subscription.externalReference === 'string'
      ? subscription.externalReference.trim()
      : '';
  const payExtRef =
    typeof payment.externalReference === 'string' ? payment.externalReference.trim() : '';

  // Reject any explicit externalReference mismatch on either entity
  if (subExtRef && subExtRef !== uid) return false;
  if (payExtRef && payExtRef !== uid) return false;

  // Never rely solely on email or customerId: require explicit UID proof via externalReference
  if (payExtRef === uid) return true;
  if (!payExtRef && subExtRef === uid) return true;

  return false;
}

async function hasRecordedReversalInFirestore(db: any, paymentId: string): Promise<boolean> {
  if (!db || !paymentId) return false;
  try {
    const snaps = await Promise.all(
      REVERSAL_WEBHOOK_EVENTS.map((evt) =>
        db.collection('processed_webhook_events').doc(sanitizeDocId(`${paymentId}_${evt}`)).get()
      )
    );
    return snaps.some((s) => Boolean(s?.exists));
  } catch (err) {
    console.warn('Aviso ao verificar eventos de estorno/chargeback no Firestore:', err);
    return true;
  }
}

export async function handleSubscriptionStatus(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SubscriptionStatusDeps = defaultDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido' });
  }

  try {
    if (deps.isPreviewSharingProductionFirestore()) {
      return sendJson(res, 403, {
        blocked: true,
        error:
          'Consulta de assinatura bloqueada no ambiente Preview enquanto compartilhar o Firestore de produção.',
      });
    }

    const user = await deps.verifyFirebaseUser(req);
    if (!user || !user.uid) {
      return sendJson(res, 401, { error: 'Não autorizado.' });
    }

    const config = deps.getAsaasConfig();
    const db = deps.getAdminFirestore();

    let userDocData: any = null;
    if (db) {
      try {
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
          userDocData = doc.data();
        }
      } catch (dbErr) {
        console.warn('Aviso ao ler status da assinatura no Firestore Admin:', dbErr);
      }
    }

    const initialValidity = evaluatePremiumAccess(userDocData);
    let asaasDetails: any = null;
    let latestCheckoutUrl: string | null = null;
    let reconciled = false;

    if (config.isConfigured && userDocData?.subscriptionId) {
      try {
        const expectedSubId = String(userDocData.subscriptionId).trim();
        const [sub, payments] = await Promise.all([
          deps.asaasFetch<any>(`/subscriptions/${expectedSubId}`, {}, 5000),
          deps.asaasFetch<any>(`/subscriptions/${expectedSubId}/payments`, {}, 5000),
        ]);
        const paymentList = Array.isArray(payments?.data) ? payments.data : [];
        const pendingPayment = paymentList.find(
          (p: any) => p.status === 'PENDING' || p.status === 'OVERDUE'
        );
        if (pendingPayment?.invoiceUrl) {
          latestCheckoutUrl = pendingPayment.invoiceUrl;
        }
        asaasDetails = {
          status: sub?.status,
          nextDueDate: sub?.nextDueDate,
          value: sub?.value,
          billingType: sub?.billingType,
          recentPayments: paymentList.slice(0, 5),
        };

        // Reconcile legacy confirmed payments ONLY against Asaas Production API
        const needsLegacyReconciliation =
          db !== null &&
          isProductionAsaasConfig(config) &&
          !initialValidity.isPremium &&
          !initialValidity.premiumUntil &&
          Boolean(sub) &&
          String(sub?.id || '').trim() === expectedSubId;

        if (needsLegacyReconciliation) {
          const expectedCustomerId =
            typeof userDocData?.asaasCustomerId === 'string'
              ? userDocData.asaasCustomerId.trim()
              : '';

          const candidates = paymentList
            .filter((p: any) => {
              const status = String(p?.status || '').trim().toUpperCase();
              if (!CONFIRMED_PAYMENT_STATUSES.has(status)) return false;
              if (hasPaymentReversalIndicators(p)) return false;
              return hasValidUidOwnership({
                uid: user.uid,
                payment: p,
                subscription: sub,
                expectedSubId,
                expectedCustomerId,
              });
            })
            .map((p: any) => {
              const periodEndIso = computePaidPeriodEndIso({
                paymentDueDate: p.dueDate,
                paymentDate: p.paymentDate,
                confirmedDate: p.confirmedDate,
                clientPaymentDate: p.clientPaymentDate,
                subscriptionCycle: sub?.cycle,
              });
              return {
                payment: p,
                periodEndMs: parseDateTimestamp(periodEndIso) ?? 0,
              };
            })
            .sort(
              (a: { periodEndMs: number }, b: { periodEndMs: number }) =>
                b.periodEndMs - a.periodEndMs
            );

          const latestCandidate = candidates[0]?.payment;
          if (latestCandidate?.id) {
            try {
              const verifiedPayment = await deps.asaasFetch<any>(
                `/payments/${encodeURIComponent(String(latestCandidate.id).trim())}`,
                { method: 'GET' },
                5000
              );

              const verifiedStatus = String(verifiedPayment?.status || '').trim().toUpperCase();
              const isStillConfirmed =
                CONFIRMED_PAYMENT_STATUSES.has(verifiedStatus) &&
                !hasPaymentReversalIndicators(verifiedPayment) &&
                hasValidUidOwnership({
                  uid: user.uid,
                  payment: verifiedPayment,
                  subscription: sub,
                  expectedSubId,
                  expectedCustomerId,
                });

              if (
                isStillConfirmed &&
                !(await hasRecordedReversalInFirestore(db, String(verifiedPayment.id)))
              ) {
                const reconciledUntil = computePaidPeriodEndIso({
                  paymentDueDate: verifiedPayment.dueDate,
                  paymentDate: verifiedPayment.paymentDate,
                  confirmedDate: verifiedPayment.confirmedDate,
                  clientPaymentDate: verifiedPayment.clientPaymentDate,
                  subscriptionCycle: sub?.cycle,
                  existingPremiumUntil: userDocData?.premiumUntil,
                });
                const reconciledUntilMs = parseDateTimestamp(reconciledUntil);

                if (reconciledUntilMs !== null && reconciledUntilMs > Date.now()) {
                  const nowIso = new Date().toISOString();
                  const subStatusUpper = String(sub?.status || '').trim().toUpperCase();
                  const reconciledSubStatus =
                    sub?.deleted ||
                    subStatusUpper === 'INACTIVE' ||
                    userDocData?.subscriptionStatus === 'CANCELLED'
                      ? 'CANCELLED'
                      : subStatusUpper === 'ACTIVE'
                        ? 'ACTIVE'
                        : normalizeSubscriptionStatus(userDocData?.subscriptionStatus);

                  const confirmedDateIso =
                    verifiedPayment.confirmedDate ||
                    verifiedPayment.paymentDate ||
                    verifiedPayment.clientPaymentDate ||
                    userDocData?.lastConfirmedPaymentDate ||
                    nowIso;

                  const reconciledFields = {
                    isPremium: true,
                    plan: 'premium',
                    subscriptionStatus: reconciledSubStatus,
                    subscriptionId: expectedSubId,
                    asaasCustomerId:
                      verifiedPayment.customer ||
                      sub?.customer ||
                      userDocData?.asaasCustomerId ||
                      null,
                    subscriptionDueDate:
                      verifiedPayment.dueDate || userDocData?.subscriptionDueDate || null,
                    premiumUntil: reconciledUntil,
                    lastConfirmedPaymentId: verifiedPayment.id,
                    lastConfirmedPaymentDate: confirmedDateIso,
                    lastPaymentDate: userDocData?.lastPaymentDate || confirmedDateIso,
                    paymentMethod:
                      verifiedPayment.billingType || userDocData?.paymentMethod || 'UNDEFINED',
                    ...(reconciledSubStatus === 'CANCELLED'
                      ? { cancelledAt: userDocData?.cancelledAt || nowIso }
                      : {}),
                    updatedAt: nowIso,
                  };

                  await db.collection('users').doc(user.uid).set(reconciledFields, { merge: true });
                  userDocData = { ...(userDocData || {}), ...reconciledFields };
                  reconciled = true;
                }
              }
            } catch (verifyPayErr: any) {
              console.warn(
                'Aviso ao revalidar pagamento candidato para reconciliação:',
                verifyPayErr?.message || verifyPayErr
              );
            }
          }
        }
      } catch (err: any) {
        console.warn('Não foi possível obter detalhes diretos da assinatura no Asaas:', err.message);
      }
    }

    const validity = evaluatePremiumAccess(userDocData);

    if (db && validity.isExpired && userDocData?.isPremium === true) {
      try {
        await db.collection('users').doc(user.uid).set(
          {
            isPremium: false,
            plan: 'gratuito',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (expErr) {
        console.warn('Aviso ao persistir expiração de Premium em subscription-status:', expErr);
      }
    }

    return sendJson(res, 200, {
      isPremium: validity.isPremium,
      subscriptionStatus: validity.subscriptionStatus,
      premiumUntil: validity.premiumUntil,
      isCancelledWithActiveAccess: validity.isCancelledWithActiveAccess,
      subscriptionId: userDocData?.subscriptionId || null,
      asaasCustomerId: userDocData?.asaasCustomerId || null,
      subscriptionDueDate: userDocData?.subscriptionDueDate || null,
      latestCheckoutUrl,
      reconciled,
      environment: config.env,
      sandbox: !config.isProduction,
      asaasDetails,
    });
  } catch (error: any) {
    console.error('Erro em subscription-status:', error);
    return sendJson(res, error.status || 500, {
      error: error.message || 'Erro ao consultar assinatura.',
    });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleSubscriptionStatus(req, res);
}
