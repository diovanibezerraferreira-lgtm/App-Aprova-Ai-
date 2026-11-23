import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from '../_firebaseAdmin.js';
import { getAsaasConfig, asaasFetch } from '../_asaas.js';
import {
  evaluatePremiumAccess,
  type PremiumAccessEvaluation,
  type SubscriptionLifecycleStatus,
} from '../_premiumValidity.js';
import {
  getPaidPlansCatalog,
  resolvePlanIdFromValueOrCycle,
  resolveUserPlanDetails,
  type PlanDefinition,
  type PlanId,
} from '../_plans.js';

export interface SubscriptionHistoryDeps {
  verifyFirebaseUser: typeof verifyFirebaseUser;
  getAdminFirestore: typeof getAdminFirestore;
  isPreviewSharingProductionFirestore: typeof isPreviewSharingProductionFirestore;
  getAsaasConfig: typeof getAsaasConfig;
  asaasFetch: typeof asaasFetch;
  nowMs?: () => number;
}

const defaultDeps: SubscriptionHistoryDeps = {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
  getAsaasConfig,
  asaasFetch,
  nowMs: () => Date.now(),
};

export type PaymentStatusTone =
  | 'confirmed'
  | 'pending'
  | 'overdue'
  | 'cancelled'
  | 'refunded'
  | 'other';

export interface PaymentHistoryItem {
  id: string;
  date: string | null;
  dueDate: string | null;
  confirmedDate: string | null;
  value: number;
  billingType: string;
  paymentMethodLabel: string;
  status: string;
  statusLabel: string;
  statusTone: PaymentStatusTone;
  description: string | null;
  subscriptionId: string | null;
  planId: PlanId;
}

export type AccessState =
  | 'active_renewal'
  | 'cancelled_active'
  | 'expired'
  | 'pending'
  | 'overdue'
  | 'free';

export type RenewalStatus = 'active' | 'cancelled' | 'pending' | 'none';

export interface SubscriptionSummaryPayload {
  plan: PlanDefinition;
  isPremium: boolean;
  isExpired: boolean;
  isCancelledWithActiveAccess: boolean;
  accessState: AccessState;
  subscriptionStatus: SubscriptionLifecycleStatus;
  asaasSubscriptionStatus: string;
  asaasSubscriptionStatusLabel: string;
  renewalStatus: RenewalStatus;
  renewalLabel: string;
  startDate: string | null;
  premiumUntil: string | null;
  cancelledAt: string | null;
  nextDueDate: string | null;
  paymentMethodLabel: string | null;
  hasSubscriptionRecord: boolean;
}

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function parseQueryParams(req: IncomingMessage) {
  try {
    const rawUrl = req.url || '/api/subscription-history';
    const parsed = new URL(rawUrl, 'http://localhost');
    const pageRaw = Number(parsed.searchParams.get('page') || '1');
    const limitRaw = Number(parsed.searchParams.get('limit') || '10');

    const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
    const limit =
      Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(20, Math.floor(limitRaw)) : 10;

    return {
      page,
      limit,
      offset: (page - 1) * limit,
      requestedUid: (parsed.searchParams.get('uid') || parsed.searchParams.get('userId') || '').trim(),
      requestedCustomerId: (
        parsed.searchParams.get('customerId') ||
        parsed.searchParams.get('asaasCustomerId') ||
        ''
      ).trim(),
      requestedSubscriptionId: (parsed.searchParams.get('subscriptionId') || '').trim(),
    };
  } catch {
    return {
      page: 1,
      limit: 10,
      offset: 0,
      requestedUid: '',
      requestedCustomerId: '',
      requestedSubscriptionId: '',
    };
  }
}

export function formatPaymentMethodLabel(billingType?: unknown): string {
  const upper = String(billingType || 'UNDEFINED').trim().toUpperCase();
  switch (upper) {
    case 'PIX':
      return 'Pix';
    case 'CREDIT_CARD':
      return 'Cartão de Crédito';
    case 'DEBIT_CARD':
      return 'Cartão de Débito';
    case 'BOLETO':
      return 'Boleto Bancário';
    case 'UNDEFINED':
      return 'Pix ou Cartão';
    default:
      return upper || 'Não informado';
  }
}

export function normalizePaymentStatus(
  rawStatus?: unknown,
  isDeleted?: boolean
): { status: string; statusLabel: string; statusTone: PaymentStatusTone } {
  const rawUpper = String(rawStatus || 'UNKNOWN').trim().toUpperCase();
  const effectiveStatus =
    isDeleted && (rawUpper === 'PENDING' || rawUpper === 'OVERDUE' || rawUpper === 'UNKNOWN')
      ? 'CANCELLED'
      : rawUpper;

  switch (effectiveStatus) {
    case 'CONFIRMED':
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return {
        status: effectiveStatus,
        statusLabel: 'Confirmado',
        statusTone: 'confirmed',
      };
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return {
        status: effectiveStatus,
        statusLabel: 'Pendente',
        statusTone: 'pending',
      };
    case 'OVERDUE':
    case 'DUNNING_REQUESTED':
    case 'DUNNING_RECEIVED':
      return {
        status: effectiveStatus,
        statusLabel: 'Vencido',
        statusTone: 'overdue',
      };
    case 'CANCELLED':
    case 'DELETED':
      return {
        status: effectiveStatus,
        statusLabel: 'Cancelado',
        statusTone: 'cancelled',
      };
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return {
        status: effectiveStatus,
        statusLabel: 'Estornado',
        statusTone: 'refunded',
      };
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return {
        status: effectiveStatus,
        statusLabel: 'Contestado (Chargeback)',
        statusTone: 'refunded',
      };
    default:
      return {
        status: effectiveStatus,
        statusLabel: effectiveStatus,
        statusTone: 'other',
      };
  }
}

function sanitizePaymentRow(raw: any, fallbackPlanId: PlanId): PaymentHistoryItem {
  const { status, statusLabel, statusTone } = normalizePaymentStatus(
    raw?.status,
    Boolean(raw?.deleted)
  );
  const billingType = String(raw?.billingType || 'UNDEFINED').trim().toUpperCase();
  const confirmedDate =
    typeof raw?.confirmedDate === 'string' && raw.confirmedDate
      ? raw.confirmedDate
      : typeof raw?.paymentDate === 'string' && raw.paymentDate
        ? raw.paymentDate
        : typeof raw?.clientPaymentDate === 'string' && raw.clientPaymentDate
          ? raw.clientPaymentDate
          : null;
  const dueDate = typeof raw?.dueDate === 'string' && raw.dueDate ? raw.dueDate : null;
  const dateCreated =
    typeof raw?.dateCreated === 'string' && raw.dateCreated ? raw.dateCreated : null;
  const value = Number(raw?.value ?? 0);

  const detectedPlanId =
    resolvePlanIdFromValueOrCycle({ value }) ||
    (fallbackPlanId === 'free' ? 'monthly' : fallbackPlanId);

  return {
    id: String(raw?.id || ''),
    date: confirmedDate || dueDate || dateCreated || null,
    dueDate,
    confirmedDate,
    value: Number.isFinite(value) ? value : 0,
    billingType,
    paymentMethodLabel: formatPaymentMethodLabel(billingType),
    status,
    statusLabel,
    statusTone,
    description: typeof raw?.description === 'string' ? raw.description : null,
    subscriptionId: typeof raw?.subscription === 'string' ? raw.subscription : null,
    planId: detectedPlanId === 'free' ? 'monthly' : detectedPlanId,
  };
}

function deriveSummaryState(params: {
  userDocData: any;
  validity: PremiumAccessEvaluation;
  asaasSub: any;
  asaasSynced: boolean;
  payments: PaymentHistoryItem[];
}): SubscriptionSummaryPayload {
  const { userDocData, validity, asaasSub, asaasSynced, payments } = params;
  const plan = resolveUserPlanDetails({
    userDocData,
    asaasSubscription: asaasSub,
    validity,
  });

  const subDeleted = Boolean(asaasSub?.deleted);
  const rawAsaasSubStatus = asaasSub
    ? subDeleted
      ? 'CANCELLED'
      : String(asaasSub.status || 'UNKNOWN').trim().toUpperCase()
    : '';

  const isCancelledInAsaasOrDb =
    validity.subscriptionStatus === 'CANCELLED' ||
    subDeleted ||
    rawAsaasSubStatus === 'INACTIVE' ||
    rawAsaasSubStatus === 'CANCELLED';

  const isExpired = validity.isExpired;

  let accessState: AccessState = 'free';
  if (validity.isPremium && isCancelledInAsaasOrDb) {
    accessState = 'cancelled_active';
  } else if (validity.isPremium) {
    accessState = 'active_renewal';
  } else if (isExpired) {
    accessState = 'expired';
  } else if (validity.subscriptionStatus === 'OVERDUE') {
    accessState = 'overdue';
  } else if (validity.subscriptionStatus === 'PENDING') {
    accessState = 'pending';
  }

  let renewalStatus: RenewalStatus = 'none';
  let renewalLabel = 'Sem assinatura recorrente ativa';
  if (isCancelledInAsaasOrDb) {
    renewalStatus = 'cancelled';
    renewalLabel = 'Renovação cancelada (sem novas cobranças)';
  } else if (
    validity.subscriptionStatus === 'ACTIVE' ||
    rawAsaasSubStatus === 'ACTIVE'
  ) {
    renewalStatus = 'active';
    renewalLabel = 'Renovação automática ativa';
  } else if (validity.subscriptionStatus === 'PENDING') {
    renewalStatus = 'pending';
    renewalLabel = 'Aguardando confirmação do pagamento inicial';
  } else if (validity.subscriptionStatus === 'OVERDUE') {
    renewalStatus = 'pending';
    renewalLabel = 'Renovação pendente de regularização';
  }

  let asaasSubscriptionStatus = rawAsaasSubStatus;
  let asaasSubscriptionStatusLabel = 'Não contratada';

  if (rawAsaasSubStatus) {
    switch (rawAsaasSubStatus) {
      case 'ACTIVE':
        asaasSubscriptionStatusLabel = 'Ativa no Asaas';
        break;
      case 'INACTIVE':
      case 'CANCELLED':
        asaasSubscriptionStatusLabel = 'Cancelada / Inativa no Asaas';
        break;
      case 'EXPIRED':
        asaasSubscriptionStatusLabel = 'Expirada no Asaas';
        break;
      default:
        asaasSubscriptionStatusLabel = rawAsaasSubStatus;
        break;
    }
  } else if (!asaasSynced && (userDocData?.subscriptionId || userDocData?.asaasCustomerId)) {
    asaasSubscriptionStatus = 'UNAVAILABLE';
    asaasSubscriptionStatusLabel = 'Indisponível no momento';
  } else if (userDocData?.subscriptionId) {
    asaasSubscriptionStatus = validity.subscriptionStatus;
    switch (validity.subscriptionStatus) {
      case 'ACTIVE':
        asaasSubscriptionStatusLabel = 'Ativa';
        break;
      case 'CANCELLED':
        asaasSubscriptionStatusLabel = 'Cancelada';
        break;
      case 'PENDING':
        asaasSubscriptionStatusLabel = 'Aguardando pagamento';
        break;
      case 'OVERDUE':
        asaasSubscriptionStatusLabel = 'Em atraso';
        break;
      default:
        asaasSubscriptionStatusLabel = 'Não contratada';
    }
  } else {
    asaasSubscriptionStatus = 'NONE';
    asaasSubscriptionStatusLabel = 'Não contratada';
  }

  const confirmedPaymentsDates = payments
    .filter((p) => p.statusTone === 'confirmed' && p.date)
    .map((p) => p.date as string)
    .sort();

  const startDate: string | null =
    (typeof asaasSub?.dateCreated === 'string' && asaasSub.dateCreated) ||
    confirmedPaymentsDates[0] ||
    (typeof userDocData?.lastConfirmedPaymentDate === 'string' &&
      userDocData.lastConfirmedPaymentDate) ||
    (typeof userDocData?.lastPaymentDate === 'string' && userDocData.lastPaymentDate) ||
    null;

  const nextDueDate: string | null =
    isCancelledInAsaasOrDb || validity.subscriptionStatus === 'NONE'
      ? null
      : (typeof asaasSub?.nextDueDate === 'string' && asaasSub.nextDueDate) ||
        (typeof userDocData?.subscriptionDueDate === 'string' &&
          userDocData.subscriptionDueDate) ||
        null;

  const rawPaymentMethod =
    payments.find((p) => p.statusTone === 'confirmed')?.billingType ||
    payments[0]?.billingType ||
    asaasSub?.billingType ||
    userDocData?.paymentMethod ||
    null;

  return {
    plan,
    isPremium: validity.isPremium,
    isExpired,
    isCancelledWithActiveAccess: validity.isPremium && isCancelledInAsaasOrDb,
    accessState,
    subscriptionStatus: validity.subscriptionStatus,
    asaasSubscriptionStatus,
    asaasSubscriptionStatusLabel,
    renewalStatus,
    renewalLabel,
    startDate,
    premiumUntil: validity.premiumUntil,
    cancelledAt:
      typeof userDocData?.cancelledAt === 'string' ? userDocData.cancelledAt : null,
    nextDueDate,
    paymentMethodLabel: rawPaymentMethod ? formatPaymentMethodLabel(rawPaymentMethod) : null,
    hasSubscriptionRecord: Boolean(
      userDocData?.subscriptionId ||
        userDocData?.asaasCustomerId ||
        validity.subscriptionStatus !== 'NONE'
    ),
  };
}

export async function handleSubscriptionHistory(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SubscriptionHistoryDeps = defaultDeps
) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido.' });
  }

  try {
    if (deps.isPreviewSharingProductionFirestore()) {
      return sendJson(res, 403, {
        blocked: true,
        error:
          'Consulta de assinatura e pagamentos bloqueada no ambiente Preview enquanto compartilhar o Firestore de produção.',
      });
    }

    const user = await deps.verifyFirebaseUser(req);
    if (!user || !user.uid) {
      return sendJson(res, 401, { error: 'Não autorizado.' });
    }

    const {
      page,
      limit,
      offset,
      requestedUid,
      requestedCustomerId,
      requestedSubscriptionId,
    } = parseQueryParams(req);

    // Block explicit cross-user UID probing immediately
    if (requestedUid && requestedUid !== user.uid) {
      return sendJson(res, 403, {
        blocked: true,
        error: 'Acesso negado: não é permitido consultar pagamentos de outro usuário.',
      });
    }

    const db = deps.getAdminFirestore();
    if (!db) {
      console.error('Firestore Admin indisponível ao consultar histórico de assinatura.');
      return sendJson(res, 503, {
        unavailable: true,
        error:
          'Serviço temporariamente indisponível: não foi possível conectar ao banco de dados para consultar sua assinatura. Tente novamente em instantes.',
      });
    }

    let userDocData: any = null;
    try {
      const docSnap = await db.collection('users').doc(user.uid).get();
      if (docSnap.exists) {
        userDocData = docSnap.data();
      }
    } catch (dbErr) {
      console.error('Erro ao ler perfil no Firestore Admin para histórico de assinatura:', dbErr);
      return sendJson(res, 503, {
        unavailable: true,
        error:
          'Serviço temporariamente indisponível: não foi possível consultar os dados da sua assinatura no banco de dados. Tente novamente em instantes.',
      });
    }

    const storedSubId =
      typeof userDocData?.subscriptionId === 'string' ? userDocData.subscriptionId.trim() : '';
    const storedCustomerId =
      typeof userDocData?.asaasCustomerId === 'string' ? userDocData.asaasCustomerId.trim() : '';

    // Block cross-user customerId or subscriptionId parameter tampering BEFORE contacting Asaas
    if (requestedCustomerId && (!storedCustomerId || requestedCustomerId !== storedCustomerId)) {
      return sendJson(res, 403, {
        blocked: true,
        error: 'Acesso negado: identificador de cliente não pertence ao usuário autenticado.',
      });
    }

    if (requestedSubscriptionId && (!storedSubId || requestedSubscriptionId !== storedSubId)) {
      return sendJson(res, 403, {
        blocked: true,
        error: 'Acesso negado: identificador de assinatura não pertence ao usuário autenticado.',
      });
    }

    const nowMs = (deps.nowMs || Date.now)();
    const validity = evaluatePremiumAccess(userDocData, nowMs);
    const config = deps.getAsaasConfig();

    let asaasSub: any = null;
    let verifiedCustomerId = storedCustomerId;
    let payments: PaymentHistoryItem[] = [];
    let totalCount = 0;
    let hasMore = false;
    let asaasSynced = true;
    let asaasError: string | null = null;

    if (config.isConfigured && (storedSubId || storedCustomerId)) {
      try {
        if (storedSubId) {
          const fetchedSub = await deps.asaasFetch<any>(
            `/subscriptions/${encodeURIComponent(storedSubId)}`,
            { method: 'GET' },
            5000
          );

          if (fetchedSub) {
            const subExtRef =
              typeof fetchedSub.externalReference === 'string'
                ? fetchedSub.externalReference.trim()
                : '';
            const subCustomer =
              typeof fetchedSub.customer === 'string' ? fetchedSub.customer.trim() : '';

            if (subExtRef && subExtRef !== user.uid) {
              return sendJson(res, 403, {
                blocked: true,
                error: 'Assinatura vinculada não pertence ao usuário autenticado.',
              });
            }

            if (storedCustomerId && subCustomer && subCustomer !== storedCustomerId) {
              return sendJson(res, 403, {
                blocked: true,
                error: 'Divergência de titularidade na assinatura vinculada.',
              });
            }

            asaasSub = fetchedSub;
            if (!verifiedCustomerId && subCustomer && subExtRef === user.uid) {
              verifiedCustomerId = subCustomer;
            }
          }
        }

        if (verifiedCustomerId) {
          const fetchedCustomer = await deps.asaasFetch<any>(
            `/customers/${encodeURIComponent(verifiedCustomerId)}`,
            { method: 'GET' },
            5000
          );
          const customerExtRef =
            typeof fetchedCustomer?.externalReference === 'string'
              ? fetchedCustomer.externalReference.trim()
              : '';

          if (customerExtRef && customerExtRef !== user.uid) {
            return sendJson(res, 403, {
              blocked: true,
              error: 'Cliente Asaas vinculado não pertence ao usuário autenticado.',
            });
          }
        }

        const paymentsEndpoint = verifiedCustomerId
          ? `/payments?customer=${encodeURIComponent(verifiedCustomerId)}&offset=${offset}&limit=${limit}`
          : `/subscriptions/${encodeURIComponent(storedSubId)}/payments?offset=${offset}&limit=${limit}`;

        const paymentsResult = await deps.asaasFetch<{
          data?: any[];
          totalCount?: number;
          hasMore?: boolean;
        }>(paymentsEndpoint, { method: 'GET' }, 6000);

        const rawList = Array.isArray(paymentsResult?.data) ? paymentsResult.data : [];
        const ownedList = rawList.filter((p) => {
          if (!p || typeof p !== 'object') return false;
          const payExtRef =
            typeof p.externalReference === 'string' ? p.externalReference.trim() : '';
          if (payExtRef && payExtRef !== user.uid) return false;

          const payCustomer = typeof p.customer === 'string' ? p.customer.trim() : '';
          if (verifiedCustomerId && payCustomer && payCustomer !== verifiedCustomerId) {
            return false;
          }

          if (!verifiedCustomerId && storedSubId) {
            const paySub = typeof p.subscription === 'string' ? p.subscription.trim() : '';
            if (paySub && paySub !== storedSubId) return false;
          }

          return true;
        });

        const fallbackPlan = resolveUserPlanDetails({
          userDocData,
          asaasSubscription: asaasSub,
          validity,
        }).id;

        payments = ownedList.map((p) => sanitizePaymentRow(p, fallbackPlan));
        totalCount =
          typeof paymentsResult?.totalCount === 'number' && paymentsResult.totalCount >= 0
            ? paymentsResult.totalCount
            : ownedList.length;
        hasMore =
          typeof paymentsResult?.hasMore === 'boolean'
            ? paymentsResult.hasMore
            : offset + payments.length < totalCount;
      } catch (asaasErr: any) {
        console.warn(
          'Falha de comunicação ao consultar histórico no Asaas:',
          asaasErr?.message || asaasErr
        );
        asaasSynced = false;
        asaasError =
          'Não foi possível sincronizar o histórico de pagamentos com o Asaas no momento. Exibindo os dados salvos da sua conta.';
        payments = [];
        totalCount = 0;
        hasMore = false;
      }
    }

    const summary = deriveSummaryState({
      userDocData,
      validity,
      asaasSub,
      asaasSynced,
      payments,
    });

    const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : payments.length > 0 ? 1 : 0;

    return sendJson(res, 200, {
      summary,
      payments,
      pagination: {
        page,
        limit,
        offset,
        totalCount,
        totalPages,
        hasMore,
      },
      plansCatalog: getPaidPlansCatalog(),
      asaasSynced,
      asaasError,
      environment: config.env,
      sandbox: !config.isProduction,
    });
  } catch (error: any) {
    console.error('Erro em subscription-history:', error);
    return sendJson(res, error?.status || 500, {
      error: error?.message || 'Erro ao consultar histórico da assinatura.',
    });
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return handleSubscriptionHistory(req, res);
}
