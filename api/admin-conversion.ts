import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { getAdminFirestore } from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { sendCampaignEmailWithGuards } from './_emailService.js';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function verifySecret(req: IncomingMessage): boolean {
  const expected = (process.env.DIAGNOSTIC_SECRET || '').trim();
  if (!expected) return false;

  const headers = req.headers || {};
  const custom = headers['x-admin-secret'] || (headers as any)['X-Admin-Secret'] || headers['x-diagnostic-secret'];
  const token = typeof custom === 'string' ? custom.trim() : '';

  const auth = headers.authorization || (headers as any).Authorization;
  const bearer = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  const presented = token || bearer;
  if (!presented) return false;

  try {
    const bA = Buffer.from(presented);
    const bB = Buffer.from(expected);
    if (bA.length !== bB.length) return false;
    return crypto.timingSafeEqual(bA, bB);
  } catch {
    return false;
  }
}

export const CAMPAIGN_DEFINITIONS = [
  {
    id: 'campaign-day-0',
    day: 0,
    title: 'Boas-vindas & Onboarding',
    targetAudience: 'Novos usuários cadastrados (Plano Gratuito)',
    subject: 'Bem-vindo ao Aprova Direito! Comece sua preparação rumo à OAB',
    headline: 'Descubra a plataforma definitiva para sua aprovação na OAB e Concursos',
    ctaText: 'EXPLORAR QUESTÕES E SIMULADOS'
  },
  {
    id: 'campaign-day-1',
    day: 1,
    title: 'Primeiros Passos na OAB',
    targetAudience: 'Usuários com 1 dia de cadastro (Plano Gratuito)',
    subject: 'Como estruturar seus estudos para a 1ª fase do Exame de Ordem',
    headline: 'Estratégias essenciais para dominar as disciplinas de maior peso na OAB',
    ctaText: 'ACESSAR SIMULADOS GRATUITOS'
  },
  {
    id: 'campaign-day-3',
    day: 3,
    title: 'Prática de Questões & Feedback',
    targetAudience: 'Usuários com 3 dias de cadastro sem assinatura',
    subject: 'Já testou nosso banco de questões comentadas pela FGV?',
    headline: 'Pratique com questões gabaritadas e fundamentos legais atualizados',
    ctaText: 'RESOLVER QUESTÕES AGORA'
  },
  {
    id: 'campaign-day-5',
    day: 5,
    title: 'Plano de Estudos & 2ª Fase',
    targetAudience: 'Usuários com 5 dias de cadastro sem assinatura',
    subject: 'Monte seu cronograma personalizado e conheça a 2ª fase',
    headline: 'Organize sua rotina de estudos com metas diárias e simulados cronometrados',
    ctaText: 'VER PLANO DE ESTUDOS'
  },
  {
    id: 'campaign-day-7',
    day: 7,
    title: 'Desbloqueio Premium (Conversão Final)',
    targetAudience: 'Usuários com 7 dias de cadastro (Oferta Especial)',
    subject: 'Desbloqueie o Plano Premium do Aprova Direito com condições especiais',
    headline: 'Tenha acesso ilimitado a todo o acervo de questões, simulados e apostilas',
    ctaText: 'ASSINAR PLANO PREMIUM'
  }
];

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  if (!verifySecret(req)) {
    return sendJson(res, 401, { error: 'UNAUTHORIZED_ADMIN_SECRET', message: 'Segredo de administrador inválido ou ausente.' });
  }

  const db = getAdminFirestore();
  if (!db) {
    return sendJson(res, 500, { error: 'DATABASE_NOT_INITIALIZED' });
  }

  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET') {
    try {
      // Gather user metrics from Firestore
      const usersSnap = await db.collection('users').get();
      let totalUsers = 0;
      let freeUsers = 0;
      let eligibleUsers = 0;
      let activePremium = 0;

      const historyStats = {
        sent: 0,
        pending: 0,
        failed: 0,
        unknown: 0
      };

      for (const doc of usersSnap.docs) {
        totalUsers++;
        const data = doc.data() || {};
        const isEmailConsent = Boolean(data.consents?.email);
        const premiumEval = evaluatePremiumAccess(data);

        if (premiumEval.isPremium) {
          activePremium++;
        } else {
          freeUsers++;
          if (isEmailConsent) {
            eligibleUsers++;
          }
        }

        // Fetch campaign history subcollection
        try {
          const historySnap = await doc.ref.collection('campaign_history').get();
          for (const hDoc of historySnap.docs) {
            const hData = hDoc.data() || {};
            const st = hData.status;
            if (st === 'SENT') historyStats.sent++;
            else if (st === 'PENDING') historyStats.pending++;
            else if (st === 'FAILED') historyStats.failed++;
            else if (st === 'UNKNOWN') historyStats.unknown++;
          }
        } catch {}
      }

      return sendJson(res, 200, {
        success: true,
        metrics: {
          totalUsers,
          freeUsers,
          eligibleUsers,
          activePremium,
          conversionRate: totalUsers > 0 ? Number(((activePremium / totalUsers) * 100).toFixed(2)) : 0
        },
        historyStats,
        campaigns: CAMPAIGN_DEFINITIONS
      });
    } catch (err: any) {
      console.error('Error in GET /api/admin-conversion:', err);
      return sendJson(res, 500, { error: err?.message || 'INTERNAL_ERROR' });
    }
  }

  if (method === 'POST') {
    try {
      const body = req.body || {};
      const action = body.action;

      if (action === 'test-dry-run') {
        const { uid, to, campaignId, headline, ctaText } = body;
        if (!uid || !to || !campaignId) {
          return sendJson(res, 400, { error: 'MISSING_PARAMS', message: 'Parâmetros uid, to e campaignId são obrigatórios.' });
        }

        // Execute sendCampaignEmailWithGuards with mock test fetch to ensure 0 real calls
        let fetchCalled = false;
        const mockFetch = async () => {
          fetchCalled = true;
          return {
            ok: true,
            text: async () => 'DRY_RUN_OK'
          };
        };

        const result = await sendCampaignEmailWithGuards({
          uid,
          to,
          campaignId,
          headline,
          ctaText,
          _testFetch: mockFetch as any
        });

        return sendJson(res, 200, {
          success: true,
          dryRunResult: result,
          fetchCalled,
          message: 'Teste de simulação executado com sucesso utilizando o motor de campanhas.'
        });
      }

      return sendJson(res, 400, { error: 'UNKNOWN_ACTION', message: 'Ação administrativa desconhecida.' });
    } catch (err: any) {
      console.error('Error in POST /api/admin-conversion:', err);
      return sendJson(res, 500, { error: err?.message || 'INTERNAL_ERROR' });
    }
  }

  return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
}
