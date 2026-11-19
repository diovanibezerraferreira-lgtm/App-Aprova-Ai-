import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'http';
import { MOCK_QUESTIONS } from '../api/_data/questions.js';
import { OAB_DISCIPLINES } from '../api/_data/disciplines.js';
import {
  buildPerformanceReport,
  buildQuestionCatalogIndexes,
  MIN_ANSWERS_FOR_RECOMMENDATIONS,
  type RawAnswerRecord,
  type RawSimuladoRecord,
} from '../api/_performanceAnalytics.js';
import {
  handlePerformanceReport,
  type PerformanceReportDeps,
} from '../api/performance-report.js';
import questionsHandler from '../api/questions.js';

const catalog = buildQuestionCatalogIndexes(MOCK_QUESTIONS);
const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = Date.UTC(2026, 10, 19, 15, 0, 0); // 2026-11-19 12:00 BRT

function getQuestionsByDiscipline(disciplineId: string, count: number) {
  return MOCK_QUESTIONS.filter((q) => q.disciplineId === disciplineId).slice(0, count);
}

function getWrongOption(correct: 'A' | 'B' | 'C' | 'D'): 'A' | 'B' | 'C' | 'D' {
  return correct === 'A' ? 'B' : 'A';
}

function createMockReq(url: string, method = 'GET', headers: Record<string, string> = {}) {
  return {
    url,
    method,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function createMockRes() {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string | string[]> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(val: number) {
      statusCode = val;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string | Buffer) {
      if (chunk) body += chunk.toString();
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getJson: () => (body ? JSON.parse(body) : null),
  };
}

interface MockUserStore {
  profile: Record<string, any>;
  answers: Array<{ id: string; data: Record<string, any> }>;
  simulados: Array<{ id: string; data: Record<string, any> }>;
}

function createTrackingFirestore(
  usersMap: Record<string, MockUserStore>,
  options?: { shouldThrow?: boolean }
) {
  let writeCount = 0;
  let readCount = 0;

  const db = {
    collection(colName: string) {
      assert.equal(colName, 'users');
      return {
        doc(uid: string) {
          const store = usersMap[uid];
          return {
            async get() {
              readCount += 1;
              if (options?.shouldThrow) {
                throw new Error('Firestore permission or network failure');
              }
              return {
                exists: Boolean(store),
                data: () => (store ? { ...store.profile } : undefined),
              };
            },
            async set() {
              writeCount += 1;
              throw new Error('Unexpected write in read-only performance endpoint');
            },
            async update() {
              writeCount += 1;
              throw new Error('Unexpected update in read-only performance endpoint');
            },
            async delete() {
              writeCount += 1;
              throw new Error('Unexpected delete in read-only performance endpoint');
            },
            collection(subName: string) {
              return {
                async get() {
                  readCount += 1;
                  if (options?.shouldThrow) {
                    throw new Error('Firestore subcollection read failure');
                  }
                  const list =
                    subName === 'answers'
                      ? store?.answers || []
                      : subName === 'simulados'
                        ? store?.simulados || []
                        : [];
                  return {
                    docs: list.map((item) => ({
                      id: item.id,
                      data: () => ({ ...item.data }),
                    })),
                  };
                },
                doc() {
                  return {
                    async set() {
                      writeCount += 1;
                      throw new Error('Unexpected subcollection write');
                    },
                    async delete() {
                      writeCount += 1;
                      throw new Error('Unexpected subcollection delete');
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    db: db as any,
    getWriteCount: () => writeCount,
    getReadCount: () => readCount,
  };
}

describe('Relatório de Desempenho Inteligente — Motor Analítico', () => {
  it('1. Usuário sem histórico: retorna zeros honestos, sem datas inventadas e sem recomendações precipitadas', () => {
    const report = buildPerformanceReport({
      answers: [],
      simulados: [],
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: false,
      subscriptionStatus: 'NONE',
      nowMs: FIXED_NOW,
    });

    assert.equal(report.overview.hasAnswers, false);
    assert.equal(report.overview.totalAnswered, 0);
    assert.equal(report.overview.totalCorrect, 0);
    assert.equal(report.overview.totalIncorrect, 0);
    assert.equal(report.overview.accuracyPercent, 0);
    assert.equal(report.overview.simuladosCompleted, 0);
    assert.equal(report.overview.periodComparison.hasEnoughData, false);

    // No fabricated chart dates
    for (const period of ['7', '30', '90'] as const) {
      assert.equal(report.evolution[period].hasEnoughData, false);
      assert.equal(report.evolution[period].points.length, 0);
      assert.ok(report.evolution[period].insufficientReason);
    }

    // No premature recommendations
    assert.equal(report.recommendations.hasEnoughData, false);
    assert.equal(report.recommendations.items.length, 0);
    assert.equal(report.recommendations.minRequiredAnswers, MIN_ANSWERS_FOR_RECOMMENDATIONS);
    assert.equal(report.disciplines.length, 0);
    assert.equal(report.errorHistory.totalErrors, 0);
    assert.equal(report.simuladosHistory.total, 0);
  });

  it('2. Usuário com poucas respostas (3 em 1 dia): exibe totais reais mas bloqueia conclusões precipitadas', () => {
    const eticaQs = getQuestionsByDiscipline('etica', 3);
    const answers: RawAnswerRecord[] = eticaQs.map((q, idx) => ({
      questionId: q.id,
      disciplineId: q.disciplineId,
      selectedOptionId: idx < 2 ? q.correctOptionId : getWrongOption(q.correctOptionId),
      isCorrect: idx < 2,
      timestamp: FIXED_NOW - idx * 60_000,
    }));

    const report = buildPerformanceReport({
      answers,
      simulados: [],
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: false,
      subscriptionStatus: 'NONE',
      nowMs: FIXED_NOW,
    });

    assert.equal(report.overview.hasAnswers, true);
    assert.equal(report.overview.totalAnswered, 3);
    assert.equal(report.overview.totalCorrect, 2);
    assert.equal(report.overview.totalIncorrect, 1);
    assert.equal(report.overview.accuracyPercent, 67);

    // Only 1 active day -> evolution chart does not invent extra days
    assert.equal(report.evolution['7'].activeDays, 1);
    assert.equal(report.evolution['7'].points.length, 1);
    assert.equal(report.evolution['7'].hasEnoughData, false);

    // Too few answers -> recommendations blocked & discipline marked insufficient
    assert.equal(report.recommendations.hasEnoughData, false);
    assert.equal(report.recommendations.items.length, 0);
    assert.equal(report.disciplines.length, 1);
    assert.equal(report.disciplines[0].status, 'insufficient');
    assert.equal(report.disciplines[0].needsAttention, false);

    // Single wrong answer still appears in error history
    assert.equal(report.errorHistory.totalErrors, 1);
    assert.equal(report.errorHistory.items[0].questionId, eticaQs[2].id);
  });

  it('3. Usuário com histórico em várias disciplinas: calcula evolução real 7/30/90d, comparação entre períodos e disciplinas críticas', () => {
    const eticaQs = getQuestionsByDiscipline('etica', 8); // strong: 7/8 = 88%
    const penalQs = getQuestionsByDiscipline('penal', 8); // weak: 3/8 = 38% (needsAttention)
    const civilQs = getQuestionsByDiscipline('civil', 6); // medium: 4/6 = 67%

    const answers: RawAnswerRecord[] = [
      // Previous 30-day window (days -45 to -35): 6 answers, 2 correct (33%)
      ...penalQs.slice(0, 6).map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: idx < 2 ? q.correctOptionId : getWrongOption(q.correctOptionId),
        isCorrect: idx < 2,
        timestamp: FIXED_NOW - (42 - idx) * DAY_MS,
      })),
      // Current 30-day window (within last 7 days, across 3 distinct dates): 16 answers, 12 correct (75%)
      ...eticaQs.map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: idx < 7 ? q.correctOptionId : getWrongOption(q.correctOptionId),
        isCorrect: idx < 7,
        timestamp: FIXED_NOW - (idx < 4 ? 5 : 2) * DAY_MS,
      })),
      ...penalQs.slice(6, 8).map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: idx === 0 ? q.correctOptionId : getWrongOption(q.correctOptionId),
        isCorrect: idx === 0,
        timestamp: FIXED_NOW - 2 * DAY_MS,
      })),
      ...civilQs.map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: idx < 4 ? q.correctOptionId : getWrongOption(q.correctOptionId),
        isCorrect: idx < 4,
        timestamp: FIXED_NOW - (idx < 3 ? 1 : 0) * DAY_MS,
      })),
    ];

    const report = buildPerformanceReport({
      answers,
      simulados: [],
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      nowMs: FIXED_NOW,
    });

    assert.equal(report.overview.totalAnswered, 22);
    assert.equal(report.overview.totalCorrect, 14);
    assert.equal(report.overview.totalIncorrect, 8);
    assert.equal(report.overview.accuracyPercent, 64);

    // 7d evolution has ONLY the 4 real active dates (-5d, -2d, -1d, 0d) — no fabricated dates
    assert.equal(report.evolution['7'].hasEnoughData, true);
    assert.equal(report.evolution['7'].points.length, 4);
    assert.equal(report.evolution['7'].totalAnswered, 16);

    // 30d period comparison: current 75% (16q) vs previous 33% (6q) => +42 p.p.
    assert.equal(report.overview.periodComparison.hasEnoughData, true);
    assert.equal(report.overview.periodComparison.currentAccuracy, 75);
    assert.equal(report.overview.periodComparison.previousAccuracy, 33);
    assert.equal(report.overview.periodComparison.accuracyDelta, 42);

    // Discipline attention detection
    const penal = report.disciplines.find((d) => d.disciplineId === 'penal');
    const etica = report.disciplines.find((d) => d.disciplineId === 'etica');
    assert.ok(penal && etica);
    assert.equal(penal.accuracyPercent, 38);
    assert.equal(penal.needsAttention, true);
    assert.equal(penal.status, 'attention');
    assert.equal(etica.accuracyPercent, 88);
    assert.equal(etica.needsAttention, false);
    assert.equal(etica.status, 'strong');

    // Recommendations generated with actionable Penal discipline reinforcement
    assert.equal(report.recommendations.hasEnoughData, true);
    assert.ok(report.recommendations.items.length >= 2);
    assert.ok(
      report.recommendations.items.some(
        (r) => r.category === 'disciplina' && r.targetDisciplineId === 'penal'
      )
    );
  });

  it('4. Usuário com acertos e erros: classifica assuntos reais (legado sem subject), pagina histórico de erros e inclui gabarito/comentário', () => {
    // Pick 2 distinct subjects with at least 4 questions each from MOCK_QUESTIONS
    const bySubject = new Map<string, typeof MOCK_QUESTIONS>();
    for (const q of MOCK_QUESTIONS) {
      const key = `${q.disciplineId}::${q.subject}`;
      const list = bySubject.get(key) || [];
      list.push(q);
      bySubject.set(key, list);
    }

    const richSubjects = Array.from(bySubject.values()).filter((list) => list.length >= 5);
    assert.ok(richSubjects.length >= 2, 'Catálogo deve conter assuntos com >= 5 questões');

    const strongSubjectQs = richSubjects[0].slice(0, 4); // 4/4 = 100%
    const weakSubjectQs = richSubjects[1].slice(0, 5); // 1/5 = 20% (4 errors)

    // Intentionally omit `subject` on raw records to test legacy Firestore answer enrichment
    const answers: RawAnswerRecord[] = [
      ...strongSubjectQs.map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: q.correctOptionId,
        isCorrect: true,
        timestamp: FIXED_NOW - (10 + idx) * 60_000,
      })),
      ...weakSubjectQs.map((q, idx) => ({
        questionId: q.id,
        disciplineId: q.disciplineId,
        selectedOptionId: idx === 0 ? q.correctOptionId : getWrongOption(q.correctOptionId),
        isCorrect: idx === 0,
        timestamp: FIXED_NOW - idx * 60_000,
      })),
    ];

    const page1 = buildPerformanceReport({
      answers,
      simulados: [],
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      nowMs: FIXED_NOW,
      errorsPage: 1,
      errorsLimit: 2,
    });

    assert.equal(page1.subjects.hasEnoughData, true);
    assert.ok(
      page1.subjects.strongest.some((s) => s.subject === strongSubjectQs[0].subject && s.accuracyPercent === 100)
    );
    assert.ok(
      page1.subjects.weakest.some((s) => s.subject === weakSubjectQs[0].subject && s.accuracyPercent === 20)
    );
    assert.ok(page1.subjects.understudied.length > 0);

    // Error history pagination: 4 total errors, limit 2 => 2 pages
    assert.equal(page1.errorHistory.totalErrors, 4);
    assert.equal(page1.errorHistory.totalPages, 2);
    assert.equal(page1.errorHistory.items.length, 2);

    const firstError = page1.errorHistory.items[0];
    assert.equal(firstError.subject, weakSubjectQs[0].subject);
    assert.ok(firstError.correctOptionId);
    assert.ok(firstError.correctOptionText.length > 0);
    assert.ok(firstError.selectedOptionText.length > 0);
    assert.ok(firstError.explanation.length > 0);
    assert.equal(page1.errorHistory.retryableQuestionIds.length, 4);

    // Page 2 returns remaining 2 errors
    const page2 = buildPerformanceReport({
      answers,
      simulados: [],
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      nowMs: FIXED_NOW,
      errorsPage: 2,
      errorsLimit: 2,
    });
    assert.equal(page2.errorHistory.page, 2);
    assert.equal(page2.errorHistory.items.length, 2);
    assert.notEqual(page2.errorHistory.items[0].questionId, page1.errorHistory.items[0].questionId);
  });

  it('5. Histórico de simulados: calcula total, média, ordenação cronológica e paginação', () => {
    const simulados: RawSimuladoRecord[] = [
      {
        id: 'sim-1',
        configTitle: 'Simulado Rápido OAB',
        disciplineId: 'todas',
        totalQuestions: 20,
        correctAnswers: 10,
        timeSpentSeconds: 900,
        date: new Date(FIXED_NOW - 10 * DAY_MS).toISOString(),
      },
      {
        id: 'sim-2',
        configTitle: 'Simulado Ética Profissional',
        disciplineId: 'etica',
        totalQuestions: 10,
        correctAnswers: 8,
        timeSpentSeconds: 420,
        date: new Date(FIXED_NOW - 2 * DAY_MS).toISOString(),
      },
      {
        id: 'sim-3',
        configTitle: 'Simulado Completo 1ª Fase',
        disciplineId: 'todas',
        totalQuestions: 80,
        correctAnswers: 56,
        timeSpentSeconds: 12400,
        date: new Date(FIXED_NOW - 1 * DAY_MS).toISOString(),
      },
    ];

    const report = buildPerformanceReport({
      answers: [],
      simulados,
      questionsMap: catalog.questionsMap,
      disciplines: OAB_DISCIPLINES,
      catalogSubjectCounts: catalog.catalogSubjectCounts,
      catalogDisciplineCounts: catalog.catalogDisciplineCounts,
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      nowMs: FIXED_NOW,
      simuladosPage: 1,
      simuladosLimit: 2,
    });

    assert.equal(report.overview.simuladosCompleted, 3);
    assert.equal(report.simuladosHistory.total, 3);
    assert.equal(report.simuladosHistory.totalPages, 2);
    assert.equal(report.simuladosHistory.items.length, 2);
    // Newest first
    assert.equal(report.simuladosHistory.items[0].id, 'sim-3');
    assert.equal(report.simuladosHistory.items[0].accuracyPercent, 70);
    assert.equal(report.simuladosHistory.items[1].id, 'sim-2');
    assert.equal(report.simuladosHistory.items[1].accuracyPercent, 80);
    // Average: (50 + 80 + 70) / 3 = 67
    assert.equal(report.simuladosHistory.averageAccuracy, 67);
  });
});

describe('Endpoint GET /api/performance-report — Segurança, Isolamento e Preservação de Dados', () => {
  it('6. Isolamento entre usuários: bloqueia uid divergente (403) e nunca retorna dados de outro aluno', async () => {
    const qA = MOCK_QUESTIONS[0];
    const qB = MOCK_QUESTIONS[1];

    const tracker = createTrackingFirestore({
      'user-A': {
        profile: { isPremium: true, subscriptionStatus: 'ACTIVE' },
        answers: [
          {
            id: qA.id,
            data: {
              questionId: qA.id,
              disciplineId: qA.disciplineId,
              selectedOptionId: qA.correctOptionId,
              isCorrect: true,
              timestamp: FIXED_NOW,
            },
          },
        ],
        simulados: [],
      },
      'user-B': {
        profile: { isPremium: true, subscriptionStatus: 'ACTIVE' },
        answers: [
          {
            id: qB.id,
            data: {
              questionId: qB.id,
              disciplineId: qB.disciplineId,
              selectedOptionId: getWrongOption(qB.correctOptionId),
              isCorrect: false,
              timestamp: FIXED_NOW,
            },
          },
        ],
        simulados: [
          {
            id: 'sim-B',
            data: {
              id: 'sim-B',
              configTitle: 'Simulado do Usuário B',
              totalQuestions: 20,
              correctAnswers: 15,
              timeSpentSeconds: 600,
              date: new Date(FIXED_NOW).toISOString(),
            },
          },
        ],
      },
    });

    const deps: PerformanceReportDeps = {
      verifyFirebaseUser: async () => ({ uid: 'user-A', email: 'a@example.com' }),
      getAdminFirestore: () => tracker.db,
      isPreviewSharingProductionFirestore: () => false,
      nowMs: () => FIXED_NOW,
    };

    // Attempt to request user-B data while authenticated as user-A -> HTTP 403 without touching Firestore
    const crossReq = createMockReq('/api/performance-report?uid=user-B', 'GET');
    const crossRes = createMockRes();
    await handlePerformanceReport(crossReq, crossRes.res, deps);
    assert.equal(crossRes.getStatus(), 403);
    assert.equal(crossRes.getJson().blocked, true);
    assert.equal(tracker.getReadCount(), 0);

    // Valid request for user-A returns ONLY user-A data with ZERO writes
    const ownReq = createMockReq('/api/performance-report', 'GET');
    const ownRes = createMockRes();
    await handlePerformanceReport(ownReq, ownRes.res, deps);
    assert.equal(ownRes.getStatus(), 200);

    const payload = ownRes.getJson();
    assert.equal(payload.overview.totalAnswered, 1);
    assert.equal(payload.overview.totalCorrect, 1);
    assert.equal(payload.overview.simuladosCompleted, 0);
    assert.equal(tracker.getWriteCount(), 0);
  });

  it('7. Segurança: retorna 405 para POST, 403 em Preview/Produção, 401 sem token e 503 se Firestore falhar', async () => {
    const baseDeps: PerformanceReportDeps = {
      verifyFirebaseUser: async () => ({ uid: 'user-A', email: 'a@example.com' }),
      getAdminFirestore: () => null,
      isPreviewSharingProductionFirestore: () => false,
      nowMs: () => FIXED_NOW,
    };

    // 405 on POST
    const postRes = createMockRes();
    await handlePerformanceReport(createMockReq('/api/performance-report', 'POST'), postRes.res, baseDeps);
    assert.equal(postRes.getStatus(), 405);

    // 403 on preview sharing prod firestore
    const previewRes = createMockRes();
    await handlePerformanceReport(createMockReq('/api/performance-report', 'GET'), previewRes.res, {
      ...baseDeps,
      isPreviewSharingProductionFirestore: () => true,
    });
    assert.equal(previewRes.getStatus(), 403);

    // 401 on unauthenticated request
    const unauthRes = createMockRes();
    await handlePerformanceReport(createMockReq('/api/performance-report', 'GET'), unauthRes.res, {
      ...baseDeps,
      verifyFirebaseUser: async () => {
        throw new Error('Token ausente');
      },
    });
    assert.equal(unauthRes.getStatus(), 401);

    // 503 when Firestore Admin is unavailable (null)
    const unavailRes = createMockRes();
    await handlePerformanceReport(createMockReq('/api/performance-report', 'GET'), unavailRes.res, baseDeps);
    assert.equal(unavailRes.getStatus(), 503);
    assert.equal(unavailRes.getJson().unavailable, true);

    // 503 when Firestore throws during read (never fabricates empty zeros)
    const failingTracker = createTrackingFirestore({}, { shouldThrow: true });
    const throwRes = createMockRes();
    await handlePerformanceReport(createMockReq('/api/performance-report', 'GET'), throwRes.res, {
      ...baseDeps,
      getAdminFirestore: () => failingTracker.db,
    });
    assert.equal(throwRes.getStatus(), 503);
    assert.equal(throwRes.getJson().unavailable, true);
  });

  it('8. Modo Refazer Questões em GET /api/questions?questionIds=... preserva regras do Plano Gratuito sem vazar gabarito', async () => {
    const sampleIds = [MOCK_QUESTIONS[0].id, MOCK_QUESTIONS[5].id];
    const req = createMockReq(`/api/questions?questionIds=${sampleIds.join(',')}`, 'GET');
    const mockRes = createMockRes();

    await questionsHandler(req, mockRes.res);
    assert.equal(mockRes.getStatus(), 200);

    const data = mockRes.getJson();
    assert.equal(data.isPremium, false);
    assert.equal(data.questions.length, 2);
    assert.equal(data.questions[0].id, sampleIds[0]);
    assert.equal(data.questions[1].id, sampleIds[1]);

    // Unanswered questions in Free plan MUST NOT expose correctOptionId or explanation
    assert.equal(data.questions[0].correctOptionId, undefined);
    assert.equal(data.questions[0].explanation, '');
    assert.equal(data.questions[0].legalFoundation, '');
  });
});
