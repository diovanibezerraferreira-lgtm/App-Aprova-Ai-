import type { IncomingMessage, ServerResponse } from 'http';
import { MOCK_QUESTIONS } from './_data/questions.js';
import { OAB_DISCIPLINES } from './_data/disciplines.js';
import {
  resolveAccessContext,
  getDailyQuotaStatus,
  consumeQuestionQuota,
  readJsonBody,
  sendJson,
  FREE_DAILY_QUESTIONS_LIMIT,
} from './_accessControl.js';

function getDailySeed(dateKey: string): number {
  let hash = 0;
  for (let i = 0; i < dateKey.length; i++) {
    hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getFreeDailySampleQuestions(dateKey: string, extraIncludedIds: string[] = []) {
  const seed = getDailySeed(dateKey);
  const selected: typeof MOCK_QUESTIONS = [];
  const selectedIds = new Set<string>();

  for (let dIdx = 0; dIdx < OAB_DISCIPLINES.length; dIdx++) {
    const disc = OAB_DISCIPLINES[dIdx];
    const pool = MOCK_QUESTIONS.filter((q) => q.disciplineId === disc.id);
    if (pool.length === 0) continue;

    // 2 sample questions per discipline rotated deterministically per day
    const firstIdx = (seed + dIdx * 17) % pool.length;
    const secondIdx = (firstIdx + Math.max(1, Math.floor(pool.length / 3))) % pool.length;

    for (const q of [pool[firstIdx], pool[secondIdx]]) {
      if (q && !selectedIds.has(q.id)) {
        selectedIds.add(q.id);
        selected.push(q);
      }
    }
  }

  for (const qId of extraIncludedIds) {
    if (!selectedIds.has(qId)) {
      const found = MOCK_QUESTIONS.find((q) => q.id === qId);
      if (found) {
        selectedIds.add(found.id);
        selected.push(found);
      }
    }
  }

  return selected;
}

function buildStatsForPool(pool: typeof MOCK_QUESTIONS) {
  const subjectCounts = new Map<string, number>();
  for (const q of pool) {
    subjectCounts.set(q.subject, (subjectCounts.get(q.subject) || 0) + 1);
  }
  const availableSubjects = Array.from(subjectCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    availableSubjects,
    difficultyCounts: {
      todas: pool.length,
      facil: pool.filter((q) => q.difficulty === 'Fácil').length,
      medio: pool.filter((q) => q.difficulty === 'Médio').length,
      dificil: pool.filter((q) => q.difficulty === 'Difícil').length,
    },
  };
}

export default async function handler(req: IncomingMessage & { query?: any; body?: any }, res: ServerResponse) {
  try {
    const ctx = await resolveAccessContext(req, res);

    if (req.method === 'GET') {
      const urlObj = new URL(req.url || '/api/questions', 'http://localhost');
      const disciplineId = urlObj.searchParams.get('disciplineId') || 'todas';
      const subject = urlObj.searchParams.get('subject') || 'todos';
      const difficulty = urlObj.searchParams.get('difficulty') || 'todas';
      const page = Math.max(1, parseInt(urlObj.searchParams.get('page') || '1', 10) || 1);
      const limit = Math.min(350, Math.max(1, parseInt(urlObj.searchParams.get('limit') || '300', 10) || 300));

      const quota = await getDailyQuotaStatus(ctx);

      const byDiscipline: Record<string, number> = {};
      for (const q of MOCK_QUESTIONS) {
        byDiscipline[q.disciplineId] = (byDiscipline[q.disciplineId] || 0) + 1;
      }

      if (ctx.isPremium) {
        const disciplinePool =
          disciplineId === 'todas'
            ? MOCK_QUESTIONS
            : MOCK_QUESTIONS.filter((q) => q.disciplineId === disciplineId);

        const subjectPool =
          subject === 'todos'
            ? disciplinePool
            : disciplinePool.filter((q) => q.subject === subject);

        const filteredPool =
          difficulty === 'todas'
            ? subjectPool
            : subjectPool.filter((q) => q.difficulty === difficulty);

        const { availableSubjects } = buildStatsForPool(disciplinePool);
        const { difficultyCounts } = buildStatsForPool(subjectPool);

        const totalFiltered = filteredPool.length;
        const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * limit;
        const pagedQuestions = filteredPool.slice(start, start + limit);

        return sendJson(res, 200, {
          isPremium: true,
          subscriptionStatus: ctx.subscriptionStatus,
          quota,
          catalogStats: {
            total: MOCK_QUESTIONS.length,
            byDiscipline,
          },
          availableSubjects,
          difficultyCounts,
          questions: pagedQuestions,
          pagination: {
            page: safePage,
            limit,
            total: totalFiltered,
            totalPages,
          },
        });
      }

      // Free / unauthenticated user: return ONLY curated daily sample across disciplines
      // without exposing answers/explanations until submitted via POST /api/questions
      const freeSamplePool = getFreeDailySampleQuestions(ctx.dateKey, quota.answeredQuestionIdsToday);
      const disciplinePool =
        disciplineId === 'todas'
          ? freeSamplePool
          : freeSamplePool.filter((q) => q.disciplineId === disciplineId);

      const subjectPool =
        subject === 'todos'
          ? disciplinePool
          : disciplinePool.filter((q) => q.subject === subject);

      const filteredPool =
        difficulty === 'todas'
          ? subjectPool
          : subjectPool.filter((q) => q.difficulty === difficulty);

      const { availableSubjects } = buildStatsForPool(disciplinePool);
      const { difficultyCounts } = buildStatsForPool(subjectPool);

      const answeredTodaySet = new Set(quota.answeredQuestionIdsToday);
      const safeQuestions = filteredPool.map((q) => {
        const alreadyAnswered = answeredTodaySet.has(q.id);
        return {
          id: q.id,
          disciplineId: q.disciplineId,
          subject: q.subject,
          statement: q.statement,
          options: q.options,
          difficulty: q.difficulty,
          examReference: q.examReference,
          // Never expose correctOptionId or explanations before user consumes daily quota
          correctOptionId: alreadyAnswered ? q.correctOptionId : undefined,
          explanation: alreadyAnswered ? q.explanation : '',
          legalFoundation: alreadyAnswered ? q.legalFoundation : '',
        };
      });

      return sendJson(res, 200, {
        isPremium: false,
        subscriptionStatus: ctx.subscriptionStatus,
        quota,
        catalogStats: {
          total: MOCK_QUESTIONS.length,
          byDiscipline,
        },
        availableSubjects,
        difficultyCounts,
        questions: safeQuestions,
        pagination: {
          page: 1,
          limit: safeQuestions.length,
          total: safeQuestions.length,
          totalPages: 1,
        },
      });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const questionId = typeof body?.questionId === 'string' ? body.questionId.trim() : '';
      const selectedOptionId = body?.selectedOptionId;

      if (!questionId || !['A', 'B', 'C', 'D'].includes(selectedOptionId)) {
        return sendJson(res, 400, {
          error: 'INVALID_REQUEST',
          message: 'Informe questionId e selectedOptionId válidos (A, B, C ou D).',
        });
      }

      const question = MOCK_QUESTIONS.find((q) => q.id === questionId);
      if (!question) {
        return sendJson(res, 404, {
          error: 'NOT_FOUND',
          message: 'Questão não encontrada.',
        });
      }

      if (!ctx.isPremium) {
        const quotaRes = await consumeQuestionQuota(ctx, questionId);
        if (!quotaRes.allowed) {
          return sendJson(res, 403, {
            error: 'DAILY_LIMIT_REACHED',
            message: `Você atingiu o limite diário de ${FREE_DAILY_QUESTIONS_LIMIT} questões gratuitas. Assine o Plano Premium para resolver todas as ${MOCK_QUESTIONS.length} questões sem limites.`,
            questionsLimit: FREE_DAILY_QUESTIONS_LIMIT,
            questionsUsed: quotaRes.questionsUsed,
            questionsRemaining: 0,
          });
        }

        return sendJson(res, 200, {
          isPremium: false,
          questionId: question.id,
          isCorrect: selectedOptionId === question.correctOptionId,
          correctOptionId: question.correctOptionId,
          explanation: question.explanation,
          legalFoundation: question.legalFoundation,
          examReference: question.examReference,
          questionsLimit: FREE_DAILY_QUESTIONS_LIMIT,
          questionsUsed: quotaRes.questionsUsed,
          questionsRemaining: quotaRes.questionsRemaining,
        });
      }

      return sendJson(res, 200, {
        isPremium: true,
        questionId: question.id,
        isCorrect: selectedOptionId === question.correctOptionId,
        correctOptionId: question.correctOptionId,
        explanation: question.explanation,
        legalFoundation: question.legalFoundation,
        examReference: question.examReference,
        questionsLimit: null,
        questionsUsed: 0,
        questionsRemaining: null,
      });
    }

    return sendJson(res, 405, { error: 'Método não permitido' });
  } catch (error: any) {
    console.error('Erro em /api/questions:', error);
    return sendJson(res, error?.status || 500, {
      error: error?.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
      message: error?.message || 'Erro interno ao processar questões.',
    });
  }
}
