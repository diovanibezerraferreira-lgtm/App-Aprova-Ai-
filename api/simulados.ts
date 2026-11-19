import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { MOCK_QUESTIONS } from './_data/questions.js';
import { OAB_DISCIPLINES } from './_data/disciplines.js';
import { SIMULADO_PRESETS, OFFICIAL_OAB_DISTRIBUTION } from './_data/simulados.js';
import {
  resolveAccessContext,
  getDailyQuotaStatus,
  consumeSimuladoQuota,
  saveSimuladoSession,
  getSimuladoSession,
  claimSimuladoSessionCompletion,
  readJsonBody,
  sendJson,
  FREE_DAILY_SIMULADOS_LIMIT,
} from './_accessControl.js';
import { getAdminFirestore, hasAdminCredentials } from './_firebaseAdmin.js';
import {
  recordSimuladoCompletionScore,
  validateSimuladoForRanking,
  readLeaderboardConfigEligibility,
  enqueueLeaderboardOutboxWithRetry,
} from './_leaderboardEngine.js';
import type { Question, DisciplineId } from '../src/types/index.js';

export interface SimuladosHandlerDeps {
  resolveAccessContext?: typeof resolveAccessContext;
  getDailyQuotaStatus?: typeof getDailyQuotaStatus;
  consumeSimuladoQuota?: typeof consumeSimuladoQuota;
  saveSimuladoSession?: typeof saveSimuladoSession;
  getSimuladoSession?: typeof getSimuladoSession;
  claimSimuladoSessionCompletion?: typeof claimSimuladoSessionCompletion;
  readJsonBody?: typeof readJsonBody;
  getLeaderboardFirestore?: () => ReturnType<typeof getAdminFirestore> | null;
  nowMs?: () => number;
}

function getSafeLeaderboardDb() {
  try {
    return hasAdminCredentials() ? getAdminFirestore() : null;
  } catch {
    return null;
  }
}

function shuffleArray<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stripAnswersForClient(questions: Question[]) {
  return questions.map((q) => ({
    id: q.id,
    disciplineId: q.disciplineId,
    subject: q.subject,
    statement: q.statement,
    options: q.options,
    difficulty: q.difficulty,
    examReference: q.examReference,
  }));
}

function buildPremiumSimuladoQuestions(
  presetId?: string,
  customConfig?: {
    disciplineId?: string;
    difficulty?: string;
    questionCount?: number;
    timeLimitMinutes?: number;
  }
): { questions: Question[]; title: string; timeLimitMinutes: number; disciplineId: string } {
  if (presetId) {
    const preset = SIMULADO_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      const err: any = new Error('Modalidade de simulado não encontrada.');
      err.status = 404;
      throw err;
    }

    let prepared: Question[] = [];

    if (preset.id.startsWith('simulado-oab')) {
      OFFICIAL_OAB_DISTRIBUTION.forEach((item) => {
        const matching = MOCK_QUESTIONS.filter((q) => q.disciplineId === item.disciplineId);
        prepared.push(...shuffleArray(matching).slice(0, item.count));
      });
    } else if (preset.id === 'simulado-concurso-magistratura') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'civil')).slice(0, 10),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-civil')).slice(0, 10),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'constitucional')).slice(0, 10),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'penal')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 7),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'consumidor')).slice(0, 5)
      );
    } else if (preset.id === 'simulado-concurso-mp') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'penal')).slice(0, 12),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 12),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'constitucional')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'administrativo')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'ambiental')).slice(0, 5),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'consumidor')).slice(0, 5)
      );
    } else if (preset.id === 'simulado-concurso-defensoria') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'direitos-humanos')).slice(0, 10),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'penal')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'civil')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'crianca-adolescente')).slice(0, 6)
      );
    } else if (preset.id === 'simulado-concurso-delegado') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'penal')).slice(0, 12),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 12),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'constitucional')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'administrativo')).slice(0, 8)
      );
    } else if (preset.id === 'simulado-concurso-tribunais') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-civil')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 8),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-trabalho')).slice(0, 6),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'constitucional')).slice(0, 4),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'administrativo')).slice(0, 4)
      );
    } else if (preset.id === 'simulado-pegadinhas-fgv') {
      prepared = shuffleArray(MOCK_QUESTIONS.filter((q) => q.difficulty === 'Difícil')).slice(0, 25);
    } else if (preset.id === 'simulado-diagnostico-30') {
      prepared = shuffleArray(MOCK_QUESTIONS).slice(0, 30);
    } else if (preset.id === 'simulado-bloco-penal') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'penal')).slice(0, 6),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-penal')).slice(0, 6)
      );
    } else if (preset.id === 'simulado-bloco-trabalhista') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'trabalho')).slice(0, 5),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-trabalho')).slice(0, 5)
      );
    } else if (preset.id === 'simulado-bloco-civel') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'civil')).slice(0, 6),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'processo-civil')).slice(0, 6)
      );
    } else if (preset.id === 'simulado-bloco-publico') {
      prepared.push(
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'constitucional')).slice(0, 4),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'administrativo')).slice(0, 4),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'tributario')).slice(0, 4),
        ...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === 'financeiro')).slice(0, 3)
      );
    } else if (preset.id === 'simulado-bloco-transversais') {
      const transversais: DisciplineId[] = [
        'direitos-humanos',
        'ambiental',
        'consumidor',
        'crianca-adolescente',
        'filosofia',
        'eleitoral',
        'internacional',
        'previdenciario',
      ];
      transversais.forEach((dId) => {
        prepared.push(...shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === dId)).slice(0, 2));
      });
    } else if (preset.disciplineId && preset.disciplineId !== 'todas') {
      prepared = shuffleArray(MOCK_QUESTIONS.filter((q) => q.disciplineId === preset.disciplineId)).slice(
        0,
        preset.questionCount
      );
    } else {
      prepared = shuffleArray(MOCK_QUESTIONS).slice(0, preset.questionCount);
    }

    if (prepared.length === 0) {
      prepared = shuffleArray(MOCK_QUESTIONS).slice(0, 10);
    }

    return {
      questions: prepared,
      title: preset.title,
      timeLimitMinutes: preset.timeLimitMinutes,
      disciplineId: preset.disciplineId || 'todas',
    };
  }

  // Custom Simulado (Premium only)
  const disciplineId = customConfig?.disciplineId || 'todas';
  const difficulty = customConfig?.difficulty || 'todas';
  const count = Math.min(80, Math.max(5, Number(customConfig?.questionCount) || 20));
  const timeLimitMinutes = Math.min(300, Math.max(5, Number(customConfig?.timeLimitMinutes) || 45));

  const disc = OAB_DISCIPLINES.find((d) => d.id === disciplineId);
  const diffLabel = difficulty === 'todas' ? '' : ` · Nível ${difficulty}`;
  const title =
    disciplineId === 'todas'
      ? `Simulado Personalizado Geral (${count}Q${diffLabel})`
      : `Simulado Personalizado: ${disc?.name || disciplineId} (${count}Q${diffLabel})`;

  let pool = MOCK_QUESTIONS;
  if (disciplineId !== 'todas') {
    pool = pool.filter((q) => q.disciplineId === disciplineId);
  }
  if (difficulty !== 'todas') {
    pool = pool.filter((q) => q.difficulty === difficulty);
  }

  let prepared = shuffleArray(pool).slice(0, count);
  if (prepared.length === 0) {
    prepared = shuffleArray(MOCK_QUESTIONS).slice(0, 10);
  }

  return {
    questions: prepared,
    title,
    timeLimitMinutes,
    disciplineId,
  };
}

function buildFreeExpressQuestions(): Question[] {
  // 10 curated express questions drawn across strategic OAB disciplines
  const targetDiscs: DisciplineId[] = [
    'etica',
    'constitucional',
    'civil',
    'processo-civil',
    'penal',
    'processo-penal',
    'trabalho',
    'processo-trabalho',
    'administrativo',
    'tributario',
  ];

  const picked: Question[] = [];
  for (const dId of targetDiscs) {
    const pool = MOCK_QUESTIONS.filter((q) => q.disciplineId === dId).slice(0, 15);
    if (pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool[idx]);
    }
  }
  return picked.slice(0, 10);
}

export async function handleSimulados(
  req: IncomingMessage & { body?: any },
  res: ServerResponse,
  deps: SimuladosHandlerDeps = {}
) {
  try {
    const resolveCtx = deps.resolveAccessContext || resolveAccessContext;
    const getQuota = deps.getDailyQuotaStatus || getDailyQuotaStatus;
    const consumeQuota = deps.consumeSimuladoQuota || consumeSimuladoQuota;
    const saveSession = deps.saveSimuladoSession || saveSimuladoSession;
    const getSession = deps.getSimuladoSession || getSimuladoSession;
    const claimCompletion = deps.claimSimuladoSessionCompletion || claimSimuladoSessionCompletion;
    const parseBody = deps.readJsonBody || readJsonBody;
    const getLeaderboardDb = deps.getLeaderboardFirestore || getSafeLeaderboardDb;
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();

    const ctx = await resolveCtx(req, res);

    if (req.method === 'GET') {
      const quota = await getQuota(ctx);
      const presets = SIMULADO_PRESETS.map((p) => ({
        ...p,
        isFree: p.id === 'simulado-express-10',
        isLocked: !ctx.isPremium && p.id !== 'simulado-express-10',
      }));

      return sendJson(res, 200, {
        isPremium: ctx.isPremium,
        subscriptionStatus: ctx.subscriptionStatus,
        quota,
        presets,
      });
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const action = body?.action;

      if (action === 'start') {
        const presetId = typeof body?.presetId === 'string' ? body.presetId.trim() : undefined;
        const customConfig = body?.customConfig;

        if (!ctx.isPremium) {
          if (presetId !== 'simulado-express-10' || customConfig) {
            return sendJson(res, 403, {
              error: 'PREMIUM_REQUIRED',
              message:
                'Esta modalidade de simulado é exclusiva do Plano Premium (R$ 29,90/mês). No plano gratuito você pode realizar 1 Simulado Express (10 questões) por dia.',
            });
          }

          const quotaRes = await consumeQuota(ctx);
          if (!quotaRes.allowed) {
            return sendJson(res, 403, {
              error: 'DAILY_LIMIT_REACHED',
              message: `Você já realizou seu ${FREE_DAILY_SIMULADOS_LIMIT} Simulado Express gratuito de hoje. Assine o Plano Premium para fazer simulados ilimitados.`,
              simuladosLimit: FREE_DAILY_SIMULADOS_LIMIT,
              simuladosUsed: quotaRes.simuladosUsed,
              simuladosRemaining: 0,
            });
          }

          const questions = buildFreeExpressQuestions();
          const sessionId = `sim_${crypto.randomBytes(10).toString('hex')}`;
          await saveSession({
            id: sessionId,
            title: 'Simulado Express (10 Questões)',
            ownerKey: ctx.primaryQuotaKey,
            ownerUid: ctx.uid,
            isPremium: false,
            questionIds: questions.map((q) => q.id),
            timeLimitMinutes: 15,
            createdAt: nowMs,
            completedAt: null,
            completedByUid: null,
          });

          const updatedQuota = await getQuota(ctx);
          return sendJson(res, 200, {
            isPremium: false,
            sessionId,
            title: 'Simulado Express (10 Questões)',
            disciplineId: 'todas',
            timeLimitMinutes: 15,
            questions: stripAnswersForClient(questions),
            quota: updatedQuota,
          });
        }

        // Premium user: unlimited access to all 40 presets & custom simulados
        const built = buildPremiumSimuladoQuestions(presetId, customConfig);
        const sessionId = `sim_${crypto.randomBytes(10).toString('hex')}`;
        await saveSession({
          id: sessionId,
          title: built.title,
          ownerKey: ctx.primaryQuotaKey,
          ownerUid: ctx.uid,
          isPremium: true,
          questionIds: built.questions.map((q) => q.id),
          timeLimitMinutes: built.timeLimitMinutes,
          createdAt: nowMs,
          completedAt: null,
          completedByUid: null,
        });

        return sendJson(res, 200, {
          isPremium: true,
          sessionId,
          title: built.title,
          disciplineId: built.disciplineId,
          timeLimitMinutes: built.timeLimitMinutes,
          questions: built.questions,
          quota: await getQuota(ctx),
        });
      }

      if (action === 'finish') {
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
        const userAnswers = (body?.userAnswers && typeof body.userAnswers === 'object') ? body.userAnswers : {};

        if (!sessionId) {
          return sendJson(res, 400, {
            error: 'INVALID_REQUEST',
            message: 'sessionId ausente.',
          });
        }

        const session = await getSession(sessionId);
        if (!session) {
          return sendJson(res, 404, {
            error: 'NOT_FOUND',
            message: 'Sessão do simulado não encontrada.',
          });
        }

        // Strict session ownership validation for ALL users (Free AND Premium)
        if (typeof session.ownerUid === 'string' && session.ownerUid.trim().length > 0) {
          if (!ctx.isAuthenticated || ctx.uid !== session.ownerUid) {
            return sendJson(res, 403, {
              error: 'FORBIDDEN',
              message: 'Sessão não pertence ao usuário atual.',
            });
          }
        } else if (ctx.isAuthenticated && ctx.uid) {
          const matchesLegacyUidKey =
            ctx.quotaKeys.includes(session.ownerKey) ||
            session.ownerKey.endsWith(`_uid_${ctx.uid}`);
          if (!matchesLegacyUidKey) {
            return sendJson(res, 403, {
              error: 'FORBIDDEN',
              message: 'Sessão não pertence ao usuário atual.',
            });
          }
        } else if (!ctx.quotaKeys.includes(session.ownerKey)) {
          return sendJson(res, 403, {
            error: 'FORBIDDEN',
            message: 'Sessão não pertence ao usuário atual.',
          });
        }

        if (!Array.isArray(session.questionIds) || session.questionIds.length === 0) {
          return sendJson(res, 400, {
            error: 'EMPTY_SIMULADO',
            message: 'Sessão de simulado sem questões válidas.',
          });
        }

        // Fast duplicate block if session snapshot already records completion
        if (typeof session.completedAt === 'number' && session.completedAt > 0) {
          return sendJson(res, 409, {
            error: 'SIMULADO_ALREADY_COMPLETED',
            message: 'Este simulado já foi finalizado anteriormente.',
          });
        }

        const questionMap = new Map(MOCK_QUESTIONS.map((q) => [q.id, q]));
        const gradedQuestions: Question[] = [];
        let correctCount = 0;

        const rankingValidationAnswers: Array<{
          questionId: string;
          selectedOptionId: unknown;
          validOptionIds: string[];
        }> = [];

        const answerDetails = session.questionIds.map((qId, idx) => {
          const q = questionMap.get(qId);
          const selected = userAnswers[idx];
          const validOptionIds: string[] = q ? q.options.map((opt) => opt.id) : [];
          const isValidOption = typeof selected === 'string' && validOptionIds.includes(selected);
          const isCorrect = Boolean(q && isValidOption && selected === q.correctOptionId);
          if (isCorrect) correctCount++;
          if (q) gradedQuestions.push(q);
          rankingValidationAnswers.push({
            questionId: qId,
            selectedOptionId: selected,
            validOptionIds,
          });
          return {
            questionId: qId,
            selectedOptionId: selected,
            isCorrect,
          };
        });

        const verifiedOwnerUid =
          ctx.isAuthenticated && ctx.uid
            ? typeof session.ownerUid === 'string' && session.ownerUid.trim()
              ? session.ownerUid.trim()
              : session.ownerKey.endsWith(`_uid_${ctx.uid}`)
                ? ctx.uid
                : null
            : null;

        const rankingValidation = validateSimuladoForRanking({
          uid: ctx.uid,
          sessionOwnerUid: verifiedOwnerUid,
          questionIds: session.questionIds,
          answers: rankingValidationAnswers,
        });
        const isFullyAnsweredForRanking = rankingValidation.valid;

        // Atomically mark session as completed once (blocks duplicate finish calls).
        // Transient Firestore failure degrades safely without HTTP 500 so grading/gabarito still succeeds.
        let claim: {
          claimed: boolean;
          alreadyCompleted: boolean;
          storageUnavailable?: boolean;
          session: any;
        };
        try {
          claim = await claimCompletion(
            session.id,
            {
              completedAt: nowMs,
              completedByUid: ctx.uid,
              fullyAnsweredForRanking: isFullyAnsweredForRanking,
            },
            deps.getLeaderboardFirestore ? deps.getLeaderboardFirestore() : undefined
          );
        } catch (claimErr) {
          console.warn(
            'Aviso: erro transitório ao confirmar conclusão do simulado; preservando correção:',
            (claimErr as any)?.code ?? (claimErr as any)?.message ?? 'UNAVAILABLE'
          );
          claim = {
            claimed: false,
            alreadyCompleted: false,
            storageUnavailable: true,
            session,
          };
        }

        if (claim.alreadyCompleted) {
          return sendJson(res, 409, {
            error: 'SIMULADO_ALREADY_COMPLETED',
            message: 'Este simulado já foi finalizado anteriormente.',
          });
        }

        // Award +30 leaderboard points ONLY if authenticated, owner-verified, and 100% answered with valid options
        if (ctx.isAuthenticated && ctx.uid && verifiedOwnerUid === ctx.uid && isFullyAnsweredForRanking) {
          const lbDb = getLeaderboardDb();
          if (claim.claimed && !claim.storageUnavailable) {
            try {
              await recordSimuladoCompletionScore(lbDb, {
                uid: ctx.uid,
                sessionId: session.id,
                sessionOwnerUid: verifiedOwnerUid,
                questionIds: session.questionIds,
                answers: rankingValidationAnswers,
                occurredAt: nowMs,
                nowMs,
              });
            } catch {
              // Ranking failure must never interrupt simulado grading
            }
          } else if (claim.storageUnavailable && lbDb) {
            // Do NOT synchronously award unconfirmed points during a Firestore outage.
            // Best-effort idempotent enqueue (deterministic ob_sim_* / ev_sim_*) only if ranking is active & post-launch.
            try {
              const preCheck = await readLeaderboardConfigEligibility(lbDb, nowMs);
              if (preCheck.eligible) {
                await enqueueLeaderboardOutboxWithRetry(lbDb, {
                  uid: ctx.uid,
                  kind: 'simulado_completed',
                  sourceId: session.id,
                  payload: {
                    sessionId: session.id,
                    totalQuestions: session.questionIds.length,
                    fullyAnswered: true,
                  },
                  occurredAt: nowMs,
                  error: new Error('SIMULADO_CLAIM_STORAGE_UNAVAILABLE'),
                  nowMs,
                });
              }
            } catch {
              // Never interrupt simulado grading
            }
          }
        }

        return sendJson(res, 200, {
          sessionId: session.id,
          totalQuestions: session.questionIds.length,
          correctAnswers: correctCount,
          answers: answerDetails,
          gradedQuestions,
        });
      }

      return sendJson(res, 400, {
        error: 'INVALID_ACTION',
        message: 'Ação inválida. Utilize start ou finish.',
      });
    }

    return sendJson(res, 405, { error: 'Método não permitido' });
  } catch (error: any) {
    console.error('Erro em /api/simulados:', error);
    return sendJson(res, error?.status || 500, {
      error: error?.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
      message: error?.message || 'Erro interno ao processar simulado.',
    });
  }
}

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  return handleSimulados(req, res);
}
