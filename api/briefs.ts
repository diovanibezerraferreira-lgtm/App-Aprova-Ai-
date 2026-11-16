import type { IncomingMessage, ServerResponse } from 'http';
import { LEGAL_BRIEFS } from './_data/legalBriefs.js';
import {
  resolveAccessContext,
  sendJson,
  FREE_BRIEF_IDS,
} from './_accessControl.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido' });
  }

  try {
    const ctx = await resolveAccessContext(req, res);

    if (ctx.isPremium) {
      const fullBriefs = LEGAL_BRIEFS.map((b) => ({
        ...b,
        isFree: FREE_BRIEF_IDS.has(b.id),
        isLocked: false,
        structureStepsCount: b.structureGuide.length,
      }));

      return sendJson(res, 200, {
        isPremium: true,
        subscriptionStatus: ctx.subscriptionStatus,
        total: LEGAL_BRIEFS.length,
        freeCount: FREE_BRIEF_IDS.size,
        freeIds: Array.from(FREE_BRIEF_IDS),
        briefs: fullBriefs,
      });
    }

    // Unauthenticated or Free user:
    // Full content ONLY for the 2 free briefs (Resposta à Acusação + Reclamação Trabalhista).
    // All other 40 briefs have drafts, case scenarios, and step-by-step guides stripped on the server.
    const freemiumBriefs = LEGAL_BRIEFS.map((b) => {
      const isFree = FREE_BRIEF_IDS.has(b.id);
      if (isFree) {
        return {
          ...b,
          isFree: true,
          isLocked: false,
          structureStepsCount: b.structureGuide.length,
        };
      }

      return {
        id: b.id,
        title: b.title,
        area: b.area,
        subject: b.subject,
        legalBasis: b.legalBasis,
        legalDeadlines: b.legalDeadlines,
        jurisdiction: b.jurisdiction,
        overview: b.overview,
        structureGuide: [],
        caseScenario: {
          title: 'Conteúdo Exclusivo do Plano Premium',
          problemStatement: '',
          clientNeeds: '',
        },
        fullDraft: '',
        isFree: false,
        isLocked: true,
        structureStepsCount: b.structureGuide.length,
      };
    });

    return sendJson(res, 200, {
      isPremium: false,
      subscriptionStatus: ctx.subscriptionStatus,
      total: LEGAL_BRIEFS.length,
      freeCount: FREE_BRIEF_IDS.size,
      freeIds: Array.from(FREE_BRIEF_IDS),
      briefs: freemiumBriefs,
    });
  } catch (error: any) {
    console.error('Erro em /api/briefs:', error);
    return sendJson(res, error?.status || 500, {
      error: error?.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
      message: error?.message || 'Erro interno ao carregar peças processuais.',
    });
  }
}
