import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleStudyPlan, type StudyPlanDeps } from '../api/study-plan.js';
import {
  computeStudyStreaks,
  generateSuggestedWeeklySchedule,
  getWeekBounds,
  createDefaultStudyPlan,
} from '../api/_studyPlanEngine.js';
import { OAB_DISCIPLINES } from '../api/_data/disciplines.js';
import { MOCK_QUESTIONS } from '../api/_data/questions.js';
import { buildQuestionCatalogIndexes } from '../api/_performanceAnalytics.js';

interface MockResponseState {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function createMockRes(): { res: ServerResponse; state: MockResponseState } {
  const state: MockResponseState = {
    statusCode: 200,
    headers: {},
    body: '',
  };

  const res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(code: number) {
      state.statusCode = code;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = String(value);
    },
    end(chunk?: string) {
      if (chunk) state.body += chunk;
    },
  } as unknown as ServerResponse;

  return { res, state };
}

function createMockReq(method: string, url = '/api/study-plan'): IncomingMessage {
  return {
    method,
    url,
    headers: { authorization: 'Bearer valid-mock-token' },
  } as unknown as IncomingMessage;
}

interface UserStoreBucket {
  profile: Record<string, any>;
  answers: Record<string, Record<string, any>>;
  simulados: Record<string, Record<string, any>>;
  study_activities: Record<string, Record<string, any>>;
}

function createInMemoryFirestore(initialUsers: Record<string, Partial<UserStoreBucket>>) {
  const store = new Map<string, UserStoreBucket>();
  const writeLog: string[] = [];

  for (const [uid, data] of Object.entries(initialUsers)) {
    store.set(uid, {
      profile: { ...(data.profile || {}) },
      answers: { ...(data.answers || {}) },
      simulados: { ...(data.simulados || {}) },
      study_activities: { ...(data.study_activities || {}) },
    });
  }

  const ensureBucket = (uid: string): UserStoreBucket => {
    if (!store.has(uid)) {
      store.set(uid, {
        profile: {},
        answers: {},
        simulados: {},
        study_activities: {},
      });
    }
    return store.get(uid)!;
  };

  const db = {
    collection(colName: string) {
      assert.equal(colName, 'users');
      return {
        doc(uid: string) {
          return {
            async get() {
              const bucket = store.get(uid);
              return {
                exists: Boolean(bucket),
                data: () => (bucket ? { ...bucket.profile } : undefined),
              };
            },
            async set(data: Record<string, any>, opts?: { merge?: boolean }) {
              writeLog.push(`users/${uid}`);
              const bucket = ensureBucket(uid);
              bucket.profile = opts?.merge ? { ...bucket.profile, ...data } : { ...data };
            },
            collection(subCol: 'answers' | 'simulados' | 'study_activities') {
              return {
                async get() {
                  const bucket = store.get(uid);
                  const map = bucket ? bucket[subCol] : {};
                  const docs = Object.entries(map).map(([id, docData]) => ({
                    id,
                    data: () => ({ ...docData }),
                  }));
                  return { docs };
                },
                doc(docId: string) {
                  return {
                    async get() {
                      const bucket = store.get(uid);
                      const exists = Boolean(bucket && bucket[subCol][docId]);
                      return {
                        exists,
                        data: () => (exists ? { ...bucket![subCol][docId] } : undefined),
                      };
                    },
                    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
                      writeLog.push(`users/${uid}/${subCol}/${docId}`);
                      const bucket = ensureBucket(uid);
                      const existing = bucket[subCol][docId] || {};
                      bucket[subCol][docId] = opts?.merge
                        ? { ...existing, ...data }
                        : { ...data };
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

  return { db, store, writeLog };
}

function makeDeps(options: {
  uid?: string;
  email?: string;
  db: any;
  body?: any;
  nowMs?: number;
  previewBlocked?: boolean;
  authThrows?: Error;
  nextId?: () => string;
}): StudyPlanDeps {
  let seq = 1;
  return {
    verifyFirebaseUser: async () => {
      if (options.authThrows) throw options.authThrows;
      return {
        uid: options.uid || 'user-a',
        email: options.email || 'user-a@example.com',
      };
    },
    getAdminFirestore: () => options.db,
    isPreviewSharingProductionFirestore: () => Boolean(options.previewBlocked),
    readJsonBody: async () => options.body ?? {},
    nowMs: () => options.nowMs ?? Date.parse('2026-11-18T15:00:00.000Z'), // Wed 12:00 BRT
    generateId: options.nextId || (() => `act_test_${seq++}`),
  };
}

// Fixed reference timestamp: Wednesday, 2026-11-18 12:00 BRT (15:00 UTC)
// Week bounds (Mon..Sun): 2026-11-16 .. 2026-11-22
const REF_NOW_MS = Date.parse('2026-11-18T15:00:00.000Z');

test('1. Aluno sem planejamento recebe defaults honestos sem dados fictícios', async () => {
  const { db } = createInMemoryFirestore({
    'user-empty': {
      profile: {
        name: 'Aluno Novo',
        dailyGoalQuestions: 25,
        isPremium: false,
      },
      answers: {},
      simulados: {},
      study_activities: {},
    },
  });

  const { res, state } = createMockRes();
  await handleStudyPlan(
    createMockReq('GET'),
    res,
    makeDeps({ uid: 'user-empty', db, nowMs: REF_NOW_MS })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  assert.equal(body.plan.isConfigured, false);
  assert.equal(body.plan.dailyGoalQuestions, 25);
  assert.equal(body.plan.weeklyGoalQuestions, 125);
  assert.equal(body.activities.length, 0);
  assert.equal(body.tracking.todayAnswered, 0);
  assert.equal(body.tracking.weekAnswered, 0);
  assert.equal(body.tracking.weeklyTotalLoggedMinutes, 0);
  assert.equal(body.tracking.weeklyPlannedMinutes, 0);
  assert.equal(body.tracking.currentStreakDays, 0);
  assert.equal(body.tracking.longestStreakDays, 0);
  assert.equal(body.remindersCapabilities.backgroundPushConfigured, false);
});

test('2. Criação e edição de metas via PUT salva studyPlan, sincroniza dailyGoalQuestions e preserva dados financeiros', async () => {
  const { db, store, writeLog } = createInMemoryFirestore({
    'user-prem': {
      profile: {
        name: 'Candidata Premium',
        dailyGoalQuestions: 20,
        isPremium: true,
        premiumUntil: '2027-01-01T00:00:00.000Z',
        subscriptionStatus: 'ACTIVE',
        asaasCustomerId: 'cus_preserved_123',
      },
      answers: {},
      simulados: {},
      study_activities: {},
    },
  });

  const { res, state } = createMockRes();
  await handleStudyPlan(
    createMockReq('PUT'),
    res,
    makeDeps({
      uid: 'user-prem',
      db,
      nowMs: REF_NOW_MS,
      body: {
        plan: {
          dailyGoalQuestions: 35,
          weeklyGoalQuestions: 210,
          weeklyGoalHours: 14.5,
          availableDays: [1, 2, 3, 4, 5, 6],
          preferredTimeSlots: ['manha', 'noite'],
          selectedDisciplines: ['etica', 'constitucional', 'civil', 'invalida-ignorada'],
          weeklySchedule: {
            '1': ['etica', 'constitucional'],
            '3': ['civil'],
          },
          reminders: {
            enabled: true,
            time: '20:30',
            days: [1, 3, 5],
            browserNotificationsEnabled: true,
          },
        },
        // Attempt to tamper financial fields must NEVER persist
        isPremium: false,
        subscriptionStatus: 'CANCELLED',
      },
    })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  assert.equal(body.plan.isConfigured, true);
  assert.equal(body.plan.dailyGoalQuestions, 35);
  assert.equal(body.plan.weeklyGoalQuestions, 210);
  assert.equal(body.plan.weeklyGoalHours, 14.5);
  assert.deepEqual(body.plan.availableDays, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(body.plan.selectedDisciplines, ['etica', 'constitucional', 'civil']);
  assert.deepEqual(body.plan.weeklySchedule, {
    '1': ['etica', 'constitucional'],
    '3': ['civil'],
  });
  assert.equal(body.plan.reminders.time, '20:30');

  const storedProfile = store.get('user-prem')!.profile;
  assert.equal(storedProfile.dailyGoalQuestions, 35);
  assert.equal(storedProfile.isPremium, true);
  assert.equal(storedProfile.premiumUntil, '2027-01-01T00:00:00.000Z');
  assert.equal(storedProfile.subscriptionStatus, 'ACTIVE');
  assert.equal(storedProfile.asaasCustomerId, 'cus_preserved_123');
  assert.deepEqual(writeLog, ['users/user-prem']);
});

test('3. Criação de atividade planejada NÃO auto-conclui por questões; conclusão explícita separa tempo planejado e efetivo', async () => {
  const { db } = createInMemoryFirestore({
    'user-act': {
      profile: { name: 'Estudante', dailyGoalQuestions: 20 },
      answers: {
        q1: {
          questionId: 'q1',
          disciplineId: 'etica',
          isCorrect: true,
          timestamp: '2026-11-18T13:00:00.000Z',
        },
      },
      simulados: {},
      study_activities: {},
    },
  });

  // Step A: create planned activity (60 min planned)
  const createRes = createMockRes();
  await handleStudyPlan(
    createMockReq('POST'),
    createRes.res,
    makeDeps({
      uid: 'user-act',
      db,
      nowMs: REF_NOW_MS,
      body: {
        action: 'create_activity',
        type: 'questoes',
        disciplineId: 'etica',
        subject: 'Prerrogativas do advogado',
        date: '2026-11-18',
        startTime: '19:00',
        plannedMinutes: 60,
      },
    })
  );

  assert.equal(createRes.state.statusCode, 201);
  const created = JSON.parse(createRes.state.body);
  assert.equal(created.activity.status, 'planned');
  assert.equal(created.activity.plannedMinutes, 60);
  assert.equal(created.activity.actualMinutes, 0);
  // Even though user already answered a question today, planned activity stays planned (NEVER auto-completed)
  assert.equal(created.report.tracking.weekActivitiesPlanned, 1);
  assert.equal(created.report.tracking.weekActivitiesCompleted, 0);
  assert.equal(created.report.tracking.weeklyPlannedMinutes, 60);
  assert.equal(created.report.tracking.weeklyLoggedActivityMinutes, 0);

  // Step B: explicitly complete activity with 42 actual minutes
  const completeRes = createMockRes();
  await handleStudyPlan(
    createMockReq('POST'),
    completeRes.res,
    makeDeps({
      uid: 'user-act',
      db,
      nowMs: REF_NOW_MS,
      body: {
        action: 'complete_activity',
        activityId: created.activity.id,
        actualMinutes: 42,
        notes: 'Concluído com revisão dos artigos 6º e 7º do EOAB',
      },
    })
  );

  assert.equal(completeRes.state.statusCode, 200);
  const completed = JSON.parse(completeRes.state.body);
  assert.equal(completed.activity.status, 'completed');
  assert.equal(completed.activity.plannedMinutes, 60);
  assert.equal(completed.activity.actualMinutes, 42);
  assert.equal(completed.report.tracking.weekActivitiesCompleted, 1);
  assert.equal(completed.report.tracking.weeklyPlannedMinutes, 60);
  assert.equal(completed.report.tracking.weeklyLoggedActivityMinutes, 42);
  assert.equal(completed.report.tracking.weeklyTotalLoggedMinutes, 42);
});

test('4. Registro direto de estudo nos 5 tipos suportados (revisao, apostila, questoes, simulado, peca)', async () => {
  const { db } = createInMemoryFirestore({
    'user-types': {
      profile: { name: 'Estudante' },
      answers: {},
      simulados: {},
      study_activities: {},
    },
  });

  const types = ['revisao', 'apostila', 'questoes', 'simulado', 'peca'] as const;
  let lastReport: any = null;
  let seq = 1;

  for (const t of types) {
    const r = createMockRes();
    await handleStudyPlan(
      createMockReq('POST'),
      r.res,
      makeDeps({
        uid: 'user-types',
        db,
        nowMs: REF_NOW_MS,
        nextId: () => `act_type_${seq++}`,
        body: {
          action: 'create_activity',
          type: t,
          disciplineId: 'constitucional',
          date: '2026-11-18',
          startTime: '18:00',
          plannedMinutes: 30,
          actualMinutes: 25,
          status: 'completed',
        },
      })
    );
    assert.equal(r.state.statusCode, 201);
    lastReport = JSON.parse(r.state.body).report;
  }

  assert.equal(lastReport.tracking.activitiesTotalCompleted, 5);
  assert.equal(lastReport.tracking.weeklyLoggedActivityMinutes, 125);
  for (const t of types) {
    const bucket = lastReport.tracking.byActivityType.find((b: any) => b.type === t);
    assert.ok(bucket);
    assert.equal(bucket.completedCount, 1);
    assert.equal(bucket.loggedMinutes, 25);
  }
});

test('5. Reagendamento, cancelamento sem apagar histórico e reabertura de atividade', async () => {
  const { db, store } = createInMemoryFirestore({
    'user-resched': {
      profile: { name: 'Estudante' },
      answers: {},
      simulados: {},
      study_activities: {
        act_1: {
          id: 'act_1',
          title: 'Revisão · Direito Civil',
          type: 'revisao',
          disciplineId: 'civil',
          subject: 'Obrigações',
          date: '2026-11-18',
          startTime: '19:00',
          plannedMinutes: 50,
          actualMinutes: 0,
          status: 'planned',
          notes: '',
          completedAt: null,
          createdAt: '2026-11-18T10:00:00.000Z',
          updatedAt: '2026-11-18T10:00:00.000Z',
        },
      },
    },
  });

  // Reschedule to Friday 2026-11-20 at 20:15
  const upd = createMockRes();
  await handleStudyPlan(
    createMockReq('POST'),
    upd.res,
    makeDeps({
      uid: 'user-resched',
      db,
      nowMs: REF_NOW_MS,
      body: {
        action: 'update_activity',
        activityId: 'act_1',
        date: '2026-11-20',
        startTime: '20:15',
        plannedMinutes: 75,
      },
    })
  );
  assert.equal(upd.state.statusCode, 200);
  const updBody = JSON.parse(upd.state.body);
  assert.equal(updBody.activity.date, '2026-11-20');
  assert.equal(updBody.activity.startTime, '20:15');
  assert.equal(updBody.activity.plannedMinutes, 75);
  assert.equal(updBody.report.tracking.calendarDays['2026-11-20'].plannedMinutes, 75);

  // Cancel preserves record as cancelled and removes from active plannedMinutes
  const canc = createMockRes();
  await handleStudyPlan(
    createMockReq('POST'),
    canc.res,
    makeDeps({
      uid: 'user-resched',
      db,
      nowMs: REF_NOW_MS,
      body: {
        action: 'cancel_activity',
        activityId: 'act_1',
      },
    })
  );
  assert.equal(canc.state.statusCode, 200);
  const cancBody = JSON.parse(canc.state.body);
  assert.equal(cancBody.activity.status, 'cancelled');
  assert.equal(cancBody.report.tracking.activitiesTotalCancelled, 1);
  assert.equal(cancBody.report.tracking.weeklyPlannedMinutes, 0);
  assert.ok(store.get('user-resched')!.study_activities['act_1']); // Never deleted!

  // Reschedule with restorePlanned brings it back to planned
  const restore = createMockRes();
  await handleStudyPlan(
    createMockReq('POST'),
    restore.res,
    makeDeps({
      uid: 'user-resched',
      db,
      nowMs: REF_NOW_MS,
      body: {
        action: 'update_activity',
        activityId: 'act_1',
        date: '2026-11-21',
        restorePlanned: true,
      },
    })
  );
  assert.equal(restore.state.statusCode, 200);
  const restoreBody = JSON.parse(restore.state.body);
  assert.equal(restoreBody.activity.status, 'planned');
  assert.equal(restoreBody.activity.date, '2026-11-21');
});

test('6. Contabilização de questões SEM duplicidade + integração somente-leitura com simulados e calendário semanal/mensal', async () => {
  const { db, writeLog } = createInMemoryFirestore({
    'user-dedup': {
      profile: { name: 'Estudante', dailyGoalQuestions: 10 },
      answers: {
        // Two docs referencing the exact same questionId 'q_dup' must count ONCE
        doc_a: {
          questionId: 'q_dup',
          disciplineId: 'etica',
          isCorrect: false,
          timestamp: '2026-11-18T12:00:00.000Z',
        },
        doc_b: {
          questionId: 'q_dup',
          disciplineId: 'etica',
          isCorrect: true,
          timestamp: '2026-11-18T14:00:00.000Z',
        },
        q_today_2: {
          questionId: 'q_today_2',
          disciplineId: 'civil',
          isCorrect: true,
          timestamp: '2026-11-18T14:30:00.000Z',
        },
        // Monday of same week (2026-11-16)
        q_mon: {
          questionId: 'q_mon',
          disciplineId: 'penal',
          isCorrect: true,
          timestamp: '2026-11-16T18:00:00.000Z',
        },
        // Previous week in same month (2026-11-10) -> counts in month calendar, NOT in weekAnswered
        q_prev_week: {
          questionId: 'q_prev_week',
          disciplineId: 'penal',
          isCorrect: false,
          timestamp: '2026-11-10T18:00:00.000Z',
        },
      },
      simulados: {
        sim_1: {
          id: 'sim_1',
          configTitle: 'Simulado OAB Completo',
          totalQuestions: 40,
          correctAnswers: 28,
          timeSpentSeconds: 3600, // 60 min
          date: '2026-11-17T20:00:00.000Z', // Tuesday of current week
        },
      },
      study_activities: {
        act_tue: {
          id: 'act_tue',
          type: 'apostila',
          disciplineId: 'constitucional',
          date: '2026-11-17',
          startTime: '19:00',
          plannedMinutes: 45,
          actualMinutes: 30,
          status: 'completed',
          completedAt: '2026-11-17T22:30:00.000Z',
        },
      },
    },
  });

  const { res, state } = createMockRes();
  await handleStudyPlan(
    createMockReq('GET'),
    res,
    makeDeps({ uid: 'user-dedup', db, nowMs: REF_NOW_MS })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  const t = body.tracking;

  // Week bounds for Wed 2026-11-18 are Mon 2026-11-16 .. Sun 2026-11-22
  assert.equal(t.weekStartKey, '2026-11-16');
  assert.equal(t.weekEndKey, '2026-11-22');

  // Deduplication: q_dup counted once + q_today_2 = 2 today
  assert.equal(t.todayAnswered, 2);
  assert.equal(t.calendarDays['2026-11-18'].questionsAnswered, 2);
  assert.equal(t.calendarDays['2026-11-18'].questionsCorrect, 2);

  // Week answered: q_dup + q_today_2 + q_mon = 3 (q_prev_week excluded from week)
  assert.equal(t.weekAnswered, 3);
  assert.equal(t.calendarDays['2026-11-10'].questionsAnswered, 1);

  // Simulados integrated separately from logged activities
  assert.equal(t.weekSimuladosCompleted, 1);
  assert.equal(t.weeklySimuladosMinutes, 60);
  assert.equal(t.weeklyLoggedActivityMinutes, 30);
  assert.equal(t.weeklyTotalLoggedMinutes, 90);
  assert.equal(t.calendarDays['2026-11-17'].simuladosCompleted, 1);
  assert.equal(t.calendarDays['2026-11-17'].totalLoggedMinutes, 90);

  // Streak: Mon (q_mon) + Tue (sim + completed activity) + Wed (today answers) = 3 consecutive days!
  assert.equal(t.currentStreakDays, 3);
  assert.equal(t.longestStreakDays, 3);
  assert.equal(t.activeDaysThisWeek, 3);
  assert.equal(t.activeDaysThisMonth, 4); // Nov 10, 16, 17, 18

  // Strictly read-only: zero writes during GET
  assert.equal(writeLog.length, 0);
});

test('7. Sequência de dias reais: ignora atividades apenas planejadas ou canceladas e aplica grace window de ontem', () => {
  // Consecutive days Nov 15, 16, 17 -> on Nov 18 (still in progress), streak remains 3
  const grace = computeStudyStreaks(
    new Set(['2026-11-15', '2026-11-16', '2026-11-17']),
    '2026-11-18'
  );
  assert.equal(grace.currentStreakDays, 3);
  assert.equal(grace.longestStreakDays, 3);

  // Gap of 2 days (last active Nov 16, today Nov 18) -> current streak resets to 0, longest remains 4
  const broken = computeStudyStreaks(
    new Set(['2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']),
    '2026-11-18'
  );
  assert.equal(broken.currentStreakDays, 0);
  assert.equal(broken.longestStreakDays, 4);

  // Week bounds check on Sunday (2026-11-22) must still anchor to Monday 2026-11-16
  assert.deepEqual(getWeekBounds('2026-11-22'), {
    weekStartKey: '2026-11-16',
    weekEndKey: '2026-11-22',
  });
});

test('8. Sugestão automática prioriza disciplina com baixo aproveitamento real sem sobrescrever grade salva', () => {
  const catalog = buildQuestionCatalogIndexes(MOCK_QUESTIONS);
  const plan = createDefaultStudyPlan(20);
  plan.availableDays = [1, 3, 5];
  plan.selectedDisciplines = ['etica', 'civil', 'penal'];
  plan.weeklySchedule = { '1': ['etica'] };

  // Give 'penal' 6 answers with 16% accuracy (1/6) and 'etica' 6 answers with 100% accuracy (6/6)
  const answers = [
    ...Array.from({ length: 6 }, (_, i) => ({
      questionId: `synthetic-penal-${i}`,
      disciplineId: 'penal',
      isCorrect: i === 0,
      timestamp: '2026-11-17T12:00:00.000Z',
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      questionId: `synthetic-etica-${i}`,
      disciplineId: 'etica',
      isCorrect: true,
      timestamp: '2026-11-17T13:00:00.000Z',
    })),
  ];

  const suggestion = generateSuggestedWeeklySchedule({
    plan,
    disciplines: OAB_DISCIPLINES,
    answers,
    questionsMap: catalog.questionsMap,
  });

  assert.equal(suggestion.basedOnPerformance, true);
  assert.ok(suggestion.rationale[0].includes('Penal'));
  assert.deepEqual(Object.keys(suggestion.schedule).sort(), ['1', '3', '5']);
  // Original plan.weeklySchedule untouched!
  assert.deepEqual(plan.weeklySchedule, { '1': ['etica'] });
});

test('9. Isolamento rigoroso entre usuários e bloqueios de segurança (405, 403 Preview, 401 Auth, 403 UID spoof, 503 DB)', async () => {
  const { db } = createInMemoryFirestore({
    'user-a': {
      profile: { name: 'Usuário A' },
      study_activities: {
        act_a: {
          id: 'act_a',
          type: 'revisao',
          disciplineId: 'etica',
          date: '2026-11-18',
          startTime: '19:00',
          plannedMinutes: 40,
          actualMinutes: 0,
          status: 'planned',
        },
      },
    },
    'user-b': {
      profile: { name: 'Usuário B' },
      study_activities: {
        act_b: {
          id: 'act_b',
          type: 'peca',
          disciplineId: 'civil',
          date: '2026-11-18',
          startTime: '20:00',
          plannedMinutes: 90,
          actualMinutes: 90,
          status: 'completed',
        },
      },
    },
  });

  // 405 unsupported method
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(createMockReq('DELETE'), res, makeDeps({ db }));
    assert.equal(state.statusCode, 405);
  }

  // 403 Preview sharing production Firestore
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(createMockReq('GET'), res, makeDeps({ db, previewBlocked: true }));
    assert.equal(state.statusCode, 403);
  }

  // 401 Unauthenticated
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(
      createMockReq('GET'),
      res,
      makeDeps({ db, authThrows: new Error('Token ausente') })
    );
    assert.equal(state.statusCode, 401);
  }

  // 403 Query UID spoof (never touches Firestore)
  {
    let dbTouched = false;
    const { res, state } = createMockRes();
    await handleStudyPlan(
      createMockReq('GET', '/api/study-plan?uid=user-b'),
      res,
      {
        ...makeDeps({ uid: 'user-a', db }),
        getAdminFirestore: () => {
          dbTouched = true;
          return db as any;
        },
      }
    );
    assert.equal(state.statusCode, 403);
    assert.equal(dbTouched, false);
  }

  // 403 Body UID spoof on POST
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(
      createMockReq('POST'),
      res,
      makeDeps({
        uid: 'user-a',
        db,
        body: { action: 'cancel_activity', userId: 'user-b', activityId: 'act_b' },
      })
    );
    assert.equal(state.statusCode, 403);
  }

  // User A cannot cancel or see User B's activity even with valid act_b ID
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(
      createMockReq('POST'),
      res,
      makeDeps({
        uid: 'user-a',
        db,
        body: { action: 'cancel_activity', activityId: 'act_b' },
      })
    );
    assert.equal(state.statusCode, 404);
  }

  // User A GET returns ONLY User A's activities
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(createMockReq('GET'), res, makeDeps({ uid: 'user-a', db, nowMs: REF_NOW_MS }));
    assert.equal(state.statusCode, 200);
    const body = JSON.parse(state.body);
    assert.equal(body.activities.length, 1);
    assert.equal(body.activities[0].id, 'act_a');
  }

  // 503 when Firestore Admin is unavailable
  {
    const { res, state } = createMockRes();
    await handleStudyPlan(createMockReq('GET'), res, makeDeps({ uid: 'user-a', db: null }));
    assert.equal(state.statusCode, 503);
    assert.equal(JSON.parse(state.body).unavailable, true);
  }
});
