import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyFirebaseUser,
  getAdminFirestore,
  isPreviewSharingProductionFirestore,
} from './_firebaseAdmin.js';
import { getAsaasConfig, asaasFetch } from './_asaas.js';

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

function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
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

    let asaasDetails: any = null;
    let latestCheckoutUrl: string | null = null;

    if (config.isConfigured && userDocData?.subscriptionId) {
      try {
        const [sub, payments] = await Promise.all([
          deps.asaasFetch<any>(`/subscriptions/${userDocData.subscriptionId}`, {}, 5000),
          deps.asaasFetch<any>(`/subscriptions/${userDocData.subscriptionId}/payments`, {}, 5000),
        ]);
        const paymentList = payments.data || [];
        const pendingPayment = paymentList.find(
          (p: any) => p.status === 'PENDING' || p.status === 'OVERDUE'
        );
        if (pendingPayment?.invoiceUrl) {
          latestCheckoutUrl = pendingPayment.invoiceUrl;
        }
        asaasDetails = {
          status: sub.status,
          nextDueDate: sub.nextDueDate,
          value: sub.value,
          billingType: sub.billingType,
          recentPayments: paymentList.slice(0, 5),
        };
      } catch (err: any) {
        console.warn('Não foi possível obter detalhes diretos da assinatura no Asaas:', err.message);
      }
    }

    return sendJson(res, 200, {
      isPremium: !!userDocData?.isPremium,
      subscriptionStatus: userDocData?.subscriptionStatus || 'NONE',
      subscriptionId: userDocData?.subscriptionId || null,
      asaasCustomerId: userDocData?.asaasCustomerId || null,
      subscriptionDueDate: userDocData?.subscriptionDueDate || null,
      latestCheckoutUrl,
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
