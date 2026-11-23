import type { IncomingMessage, ServerResponse } from 'http';
import { STUDY_MATERIALS } from '../_data/studyMaterials.js';
import {
  resolveAccessContext,
  sendJson,
  FREE_MATERIAL_IDS,
} from '../_accessControl.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Método não permitido' });
  }

  try {
    const ctx = await resolveAccessContext(req, res);

    if (ctx.isPremium) {
      const fullMaterials = STUDY_MATERIALS.map((mat) => ({
        ...mat,
        hasFreePreview: FREE_MATERIAL_IDS.has(mat.id),
        isFullyLocked: false,
        chapters: mat.chapters.map((ch) => ({
          ...ch,
          isLocked: false,
        })),
      }));

      return sendJson(res, 200, {
        isPremium: true,
        subscriptionStatus: ctx.subscriptionStatus,
        total: STUDY_MATERIALS.length,
        freeCount: FREE_MATERIAL_IDS.size,
        freeIds: Array.from(FREE_MATERIAL_IDS),
        materials: fullMaterials,
      });
    }

    // Unauthenticated or Free user:
    // Only the 3 selected materials (Ética, Direito Constitucional, Direito Civil)
    // expose Chapter 1 (index 0). All remaining chapters and all other 28 materials
    // have their chapter body text stripped on the server.
    const freemiumMaterials = STUDY_MATERIALS.map((mat) => {
      const hasFreePreview = FREE_MATERIAL_IDS.has(mat.id);
      return {
        id: mat.id,
        title: mat.title,
        disciplineId: mat.disciplineId,
        author: mat.author,
        estimatedReadTime: mat.estimatedReadTime,
        description: mat.description,
        pageCount: mat.pageCount,
        isExtensiveManual: mat.isExtensiveManual,
        edition: mat.edition,
        hasFreePreview,
        isFullyLocked: !hasFreePreview,
        chapters: mat.chapters.map((ch, idx) => {
          const isUnlocked = hasFreePreview && idx === 0;
          if (isUnlocked) {
            return {
              ...ch,
              isLocked: false,
            };
          }
          return {
            title: ch.title,
            content: '',
            keyStatutes: [],
            summaryPoints: [],
            isLocked: true,
          };
        }),
      };
    });

    return sendJson(res, 200, {
      isPremium: false,
      subscriptionStatus: ctx.subscriptionStatus,
      total: STUDY_MATERIALS.length,
      freeCount: FREE_MATERIAL_IDS.size,
      freeIds: Array.from(FREE_MATERIAL_IDS),
      materials: freemiumMaterials,
    });
  } catch (error: any) {
    console.error('Erro em /api/materials:', error);
    return sendJson(res, error?.status || 500, {
      error: error?.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
      message: error?.message || 'Erro interno ao carregar apostilas.',
    });
  }
}
