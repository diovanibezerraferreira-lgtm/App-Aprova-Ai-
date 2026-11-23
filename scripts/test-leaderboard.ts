import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  LEADERBOARD_COLLECTIONS,
  LEADERBOARD_CONFIG_DOC_ID,
  LEADERBOARD_POINTS,
  LEADERBOARD_TIMEZONE,
  assertPositivePoints,
  buildSafeDefaultNickname,
  configureOfficialLeaderboardLaunch,
  enqueueLeaderboardOutbox,
  getPeriodKeysForTimestamp,
  persistServerVerifiedAction,
  recordQuestionAnswerScore,
  recordSimuladoCompletionScore,
  recordStudyActivityStreakCheck,
  reconcileLeaderboardFromServerSources,
  reprocessPendingLeaderboardOutbox,
  type LeaderboardEventRecord,
  type LeaderboardPublicProfile,
  type LeaderboardPeriodEntry,
  type LeaderboardPrivateProfile,
  type LeaderboardOutboxRecord,
} from '../api/_leaderboardEngine.js';
import { handleLeaderboard } from '../api/leaderboard.js';
import { handleLeaderboardRecover } from '../api/_leaderboardRecover.js';
import { handleQuestions } from '../api/questions.js';
import { handleSimulados } from '../api/simulados.js';
import { handleStudyPlan } from '../api/study-plan.js';
import { handleAiTutor } from '../api/ai-tutor.js';
import { getAiTutorLimits, resolveGeminiModel } from '../api/_aiTutorEngine.js';
import { MOCK_QUESTIONS } from '../api/_data/questions.js';
import {
  claimSimuladoSessionCompletion,
  type AccessContext,
  type SimuladoSessionRecord,
} from '../api/_accessControl.js';

// ============================================================================
// Transactional In-Memory Firestore Mock (with serial lock & fault injection)
// ============================================================================
class MockFirestore {
  private collections = new Map<string, Map<string, any>>();
  private txChain: Promise<unknown> = Promise.resolve();
  public failNextTransactions = 0;
  public failTransactionsMessage = 'UNAVAILABLE: Simulated transient Firestore error';
  public failOutboxWrites = 0;
  public failVerifiedActionWrites = 0;

  private ensureCol(pathKey: string): Map<string, any> {
    let col = this.collections.get(pathKey);
    if (!col) {
      col = new Map<string, any>();
      this.collections.set(pathKey, col);
    }
    return col;
  }

  public seed(pathKey: string, docId: string, data: any): void {
    this.ensureCol(pathKey).set(docId, structuredClone(data));
  }

  public getDoc(pathKey: string, docId: string): any | undefined {
    const val = this.ensureCol(pathKey).get(docId);
    return val !== undefined ? structuredClone(val) : undefined;
  }

  public getCollectionValues(pathKey: string): Array<{ id: string; data: any }> {
    const col = this.ensureCol(pathKey);
    return Array.from(col.entries()).map(([id, data]) => ({
      id,
      data: structuredClone(data),
    }));
  }

  private makeDocRef(colPath: string, docId: string): any {
    const self = this;
    return {
      __colPath: colPath,
      __docId: docId,
      id: docId,
      async get() {
        const val = self.ensureCol(colPath).get(docId);
        return {
          id: docId,
          exists: val !== undefined,
          data: () => (val !== undefined ? structuredClone(val) : undefined),
        };
      },
      async set(data: any, opts?: { merge?: boolean }) {
        if (colPath === LEADERBOARD_COLLECTIONS.outbox && self.failOutboxWrites > 0) {
          self.failOutboxWrites -= 1;
          const err: any = new Error('UNAVAILABLE: Simulated outbox write failure');
          err.code = 14;
          throw err;
        }
        if (colPath === LEADERBOARD_COLLECTIONS.verifiedActions && self.failVerifiedActionWrites > 0) {
          self.failVerifiedActionWrites -= 1;
          const err: any = new Error('UNAVAILABLE: Simulated verified action write failure');
          err.code = 14;
          throw err;
        }
        const col = self.ensureCol(colPath);
        if (opts?.merge && col.has(docId)) {
          col.set(docId, { ...structuredClone(col.get(docId)), ...structuredClone(data) });
        } else {
          col.set(docId, structuredClone(data));
        }
      },
      collection(subName: string) {
        return self.collection(`${colPath}/${docId}/${subName}`);
      },
    };
  }

  public collection(colPath: string): any {
    const self = this;

    const buildQuery = (
      filters: Array<{ field: string; op: string; value: any }> = [],
      orderBySpec: { field: string; dir: 'asc' | 'desc' } | null = null,
      limitCount: number | null = null,
      startAfterDoc: any = null
    ): any => ({
      where(field: string, op: string, value: any) {
        return buildQuery([...filters, { field, op, value }], orderBySpec, limitCount, startAfterDoc);
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return buildQuery(filters, { field, dir }, limitCount, startAfterDoc);
      },
      startAfter(docSnap: any) {
        return buildQuery(filters, orderBySpec, limitCount, docSnap);
      },
      limit(n: number) {
        return buildQuery(filters, orderBySpec, n, startAfterDoc);
      },
      async get() {
        let entries = Array.from(self.ensureCol(colPath).entries()).map(([id, data]) => ({
          id,
          data: structuredClone(data),
        }));

        for (const f of filters) {
          if (f.op === '==') {
            entries = entries.filter((e) => e.data?.[f.field] === f.value);
          }
        }

        if (orderBySpec) {
          entries.sort((a, b) => {
            const av = a.data?.[orderBySpec.field] ?? 0;
            const bv = b.data?.[orderBySpec.field] ?? 0;
            if (av === bv) return a.id.localeCompare(b.id);
            return orderBySpec.dir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
          });
        } else {
          // Implicit Firestore ordering by __name__ (document ID ascending)
          entries.sort((a, b) => a.id.localeCompare(b.id));
        }

        if (startAfterDoc && typeof startAfterDoc.id === 'string') {
          const cursorId = startAfterDoc.id;
          if (!orderBySpec) {
            entries = entries.filter((e) => e.id > cursorId);
          } else {
            const idx = entries.findIndex((e) => e.id === cursorId);
            if (idx >= 0) {
              entries = entries.slice(idx + 1);
            }
          }
        }

        if (limitCount !== null) {
          entries = entries.slice(0, limitCount);
        }

        return {
          docs: entries.map((e) => ({
            id: e.id,
            exists: true,
            data: () => structuredClone(e.data),
          })),
        };
      },
    });

    return {
      doc(docId: string) {
        return self.makeDocRef(colPath, docId);
      },
      where(field: string, op: string, value: any) {
        return buildQuery([{ field, op, value }]);
      },
      orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
        return buildQuery([], { field, dir });
      },
      startAfter(docSnap: any) {
        return buildQuery([], null, null, docSnap);
      },
      limit(n: number) {
        return buildQuery([], null, n);
      },
      async get() {
        return buildQuery().get();
      },
    };
  }

  public async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.failNextTransactions > 0) {
        this.failNextTransactions -= 1;
        const err: any = new Error(this.failTransactionsMessage);
        err.code = 14;
        throw err;
      }

      const pendingWrites: Array<{ colPath: string; docId: string; data: any; merge: boolean }> = [];
      let writePhaseStarted = false;

      const tx = {
        get: async (docRef: any) => {
          if (writePhaseStarted) {
            throw new Error('Firestore transactions require all reads to be executed before all writes.');
          }
          const val = this.ensureCol(docRef.__colPath).get(docRef.__docId);
          return {
            id: docRef.__docId,
            exists: val !== undefined,
            data: () => (val !== undefined ? structuredClone(val) : undefined),
          };
        },
        set: (docRef: any, data: any, opts?: { merge?: boolean }) => {
          writePhaseStarted = true;
          pendingWrites.push({
            colPath: docRef.__colPath,
            docId: docRef.__docId,
            data: structuredClone(data),
            merge: Boolean(opts?.merge),
          });
        },
      };

      const result = await fn(tx);
      for (const w of pendingWrites) {
        const col = this.ensureCol(w.colPath);
        if (w.merge && col.has(w.docId)) {
          col.set(w.docId, { ...structuredClone(col.get(w.docId)), ...structuredClone(w.data) });
        } else {
          col.set(w.docId, structuredClone(w.data));
        }
      }
      return result;
    };

    const next = this.txChain.then(run, run);
    this.txChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function createMockReqRes(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const req = {
    method: options.method || 'GET',
    url: options.url || '/api/leaderboard',
    headers: options.headers || {},
    body: options.body,
  } as unknown as IncomingMessage & { body?: any };

  let statusCode = 200;
  let rawBody = '';
  const headers: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, val: string) {
      headers[name.toLowerCase()] = String(val);
    },
    end(chunk?: string) {
      if (chunk) rawBody += chunk;
    },
  } as unknown as ServerResponse;

  return {
    req,
    res,
    getResult: () => ({
      status: statusCode,
      headers,
      body: rawBody ? JSON.parse(rawBody) : null,
    }),
  };
}

function makeAccessCtx(params: { uid: string; isPremium: boolean; dateKey?: string }): AccessContext {
  const dateKey = params.dateKey || '2026-06-01';
  const key = `${dateKey}_uid_${params.uid}`;
  return {
    isAuthenticated: true,
    uid: params.uid,
    email: `${params.uid}@example.com`,
    isPremium: params.isPremium,
    subscriptionStatus: params.isPremium ? 'ACTIVE' : 'NONE',
    premiumUntil: params.isPremium ? '2026-12-31T00:00:00.000Z' : null,
    dateKey,
    quotaKeys: [key],
    primaryQuotaKey: key,
  };
}

// Official launch timestamp: 2026-06-01 00:00:00 America/Sao_Paulo (-03:00)
const LAUNCH_ISO = '2026-06-01T00:00:00-03:00';
const LAUNCH_MS = Date.parse(LAUNCH_ISO);
const BEFORE_LAUNCH_MS = LAUNCH_MS - 1_000; // 2026-05-31 23:59:59 -03:00
const DAY1_MS = Date.parse('2026-06-01T14:00:00-03:00');

async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      passed += 1;
      console.log(`✅ [PASS] ${name}`);
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      throw err;
    }
  };

  // 1. Inactive by default + never auto-activated by student actions
  await runCase('1. Ranking inicia inativo por padrão e nunca auto-ativa na primeira ação de aluno', async () => {
    const db = new MockFirestore();
    db.seed('users', 'uid_student_1', {
      name: 'Carlos Eduardo Silva',
      email: 'carlos.silva@gmail.com',
      cpf: '123.456.789-00',
      dailyGoalQuestions: 5,
    });

    const qRes = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_student_1',
      questionId: MOCK_QUESTIONS[0].id,
      isCorrect: true,
      occurredAt: DAY1_MS,
      nowMs: DAY1_MS,
    });

    assert.equal(qRes.awarded, false);
    assert.equal(qRes.totalPointsAwarded, 0);
    assert.equal(qRes.reason, 'RANKING_INACTIVE');
    assert.equal(db.getDoc(LEADERBOARD_COLLECTIONS.config, LEADERBOARD_CONFIG_DOC_ID), undefined);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.publicProfiles).length, 0);

    // Explicit admin activation MUST require a launch date/time
    await assert.rejects(
      () => configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: null }),
      /obrigatório configurar a data e o horário oficial/i
    );
  });

  // 2. Zero retroactive points before official launch (America/Sao_Paulo)
  await runCase('2. Nenhuma atividade anterior à data/hora oficial (America/Sao_Paulo) gera pontos ou conta para metas', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, {
      active: true,
      launchAtIso: LAUNCH_ISO,
      nowMs: LAUNCH_MS,
    });
    const cfg = db.getDoc(LEADERBOARD_COLLECTIONS.config, LEADERBOARD_CONFIG_DOC_ID);
    assert.equal(cfg.active, true);
    assert.equal(cfg.timezone, LEADERBOARD_TIMEZONE);
    assert.equal(cfg.launchDateKey, '2026-06-01');

    db.seed('users', 'uid_retro', { name: 'Ana Beatriz', dailyGoalQuestions: 5 });

    // Answer 5 questions 1 second BEFORE launch
    for (let i = 0; i < 5; i++) {
      const r = await recordQuestionAnswerScore(db as any, {
        uid: 'uid_retro',
        questionId: MOCK_QUESTIONS[i].id,
        isCorrect: true,
        occurredAt: BEFORE_LAUNCH_MS - i * 1000,
        nowMs: DAY1_MS,
      });
      assert.equal(r.awarded, false);
      assert.equal(r.reason, 'BEFORE_LAUNCH');
      assert.equal(r.totalPointsAwarded, 0);
    }

    // Complete simulado BEFORE launch
    const simPre = await recordSimuladoCompletionScore(db as any, {
      uid: 'uid_retro',
      sessionId: 'sim_pre_launch',
      sessionOwnerUid: 'uid_retro',
      questionIds: [MOCK_QUESTIONS[0].id],
      answers: [
        {
          questionId: MOCK_QUESTIONS[0].id,
          selectedOptionId: 'A',
          validOptionIds: ['A', 'B', 'C', 'D'],
        },
      ],
      occurredAt: BEFORE_LAUNCH_MS,
      nowMs: DAY1_MS,
    });
    assert.equal(simPre.awarded, false);
    assert.equal(simPre.reason, 'BEFORE_LAUNCH');

    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.publicProfiles).length, 0);
  });

  // 3. Questions scoring (+5 wrong, +10 right, 0 on repeat/refresh)
  await runCase('3. Questões: +5 primeira resposta válida, +5 acerto (+10 total) e 0 em repetição/refresh', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_q', { name: 'Pedro Henrique Souza', dailyGoalQuestions: 20 });

    const q1 = MOCK_QUESTIONS[0];
    const q2 = MOCK_QUESTIONS[1];

    // Q1 wrong -> +5
    const r1 = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_q',
      questionId: q1.id,
      isCorrect: false,
      occurredAt: DAY1_MS,
      nowMs: DAY1_MS,
    });
    assert.equal(r1.awarded, true);
    assert.equal(r1.totalPointsAwarded, 5);
    assert.equal(r1.events[0].basePoints, 5);
    assert.equal(r1.events[0].bonusPoints, 0);

    // Repeat Q1 even getting it right later -> 0 points!
    const r1Repeat = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_q',
      questionId: q1.id,
      isCorrect: true,
      occurredAt: DAY1_MS + 10_000,
      nowMs: DAY1_MS + 10_000,
    });
    assert.equal(r1Repeat.awarded, false);
    assert.equal(r1Repeat.totalPointsAwarded, 0);
    assert.equal(r1Repeat.reason, 'DUPLICATE_EVENT');

    // Q2 right -> +10
    const r2 = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_q',
      questionId: q2.id,
      isCorrect: true,
      occurredAt: DAY1_MS + 20_000,
      nowMs: DAY1_MS + 20_000,
    });
    assert.equal(r2.awarded, true);
    assert.equal(r2.totalPointsAwarded, 10);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_q') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 15);
    assert.equal(pub.questionsPoints, 15);
    assert.equal(pub.questionsAnsweredCount, 2);
    assert.equal(pub.questionsCorrectCount, 1);
  });

  // 4. Concurrency / Race condition prevention via deterministic IDs + transactions
  await runCase('4. Concorrência: 5 chamadas simultâneas na mesma questão e no mesmo simulado creditam apenas 1 vez', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_race', { name: 'Juliana Costa', dailyGoalQuestions: 20 });

    const qResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordQuestionAnswerScore(db as any, {
          uid: 'uid_race',
          questionId: MOCK_QUESTIONS[3].id,
          isCorrect: true,
          occurredAt: DAY1_MS,
          nowMs: DAY1_MS,
        })
      )
    );
    assert.equal(qResults.filter((r) => r.awarded).length, 1);
    assert.equal(qResults.filter((r) => r.reason === 'DUPLICATE_EVENT').length, 4);

    const simResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordSimuladoCompletionScore(db as any, {
          uid: 'uid_race',
          sessionId: 'sim_race_1',
          sessionOwnerUid: 'uid_race',
          questionIds: [MOCK_QUESTIONS[0].id, MOCK_QUESTIONS[1].id],
          answers: [
            { questionId: MOCK_QUESTIONS[0].id, selectedOptionId: 'A', validOptionIds: ['A', 'B', 'C', 'D'] },
            { questionId: MOCK_QUESTIONS[1].id, selectedOptionId: 'B', validOptionIds: ['A', 'B', 'C', 'D'] },
          ],
          occurredAt: DAY1_MS,
          nowMs: DAY1_MS,
        })
      )
    );
    assert.equal(simResults.filter((r) => r.awarded).length, 1);
    assert.equal(simResults.filter((r) => r.reason === 'DUPLICATE_EVENT').length, 4);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_race') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 40); // 10 + 30
  });

  // 5. Simulados strict rules: 100% valid options, ownership (Free & Premium), duplicate blocked, empty/incomplete blocked
  await runCase('5. Simulados: exige 100% respondidas com opções válidas, valida UID inclusive Premium e bloqueia duplicata/vazio/incompleto', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_prem_owner', { name: 'Lucas Premium', isPremium: true });
    db.seed('users', 'uid_prem_other', { name: 'Marcos Invasor', isPremium: true });

    const sessions = new Map<string, SimuladoSessionRecord>();
    const makeSimDeps = (ctx: AccessContext) => ({
      resolveAccessContext: async () => ctx,
      getDailyQuotaStatus: async () => ({
        dateKey: '2026-06-01',
        questionsLimit: null,
        questionsUsed: 0,
        questionsRemaining: null,
        answeredQuestionIdsToday: [],
        simuladosLimit: null,
        simuladosUsed: 0,
        simuladosRemaining: null,
      }),
      consumeSimuladoQuota: async () => ({ allowed: true, simuladosUsed: 1, simuladosRemaining: 0 }),
      saveSimuladoSession: async (s: SimuladoSessionRecord) => {
        sessions.set(s.id, s);
        db.seed('simulado_sessions', s.id, s);
      },
      getSimuladoSession: async (id: string) => db.getDoc('simulado_sessions', id) || sessions.get(id) || null,
      readJsonBody: async (r: any) => r.body,
      getLeaderboardFirestore: () => db as any,
      nowMs: () => DAY1_MS,
    });

    const ownerCtx = makeAccessCtx({ uid: 'uid_prem_owner', isPremium: true });
    const otherPremCtx = makeAccessCtx({ uid: 'uid_prem_other', isPremium: true });

    // Start a 5-question custom simulado as Premium owner
    const startCall = createMockReqRes({
      method: 'POST',
      body: { action: 'start', customConfig: { disciplineId: 'etica', questionCount: 5, timeLimitMinutes: 15 } },
    });
    await handleSimulados(startCall.req, startCall.res, makeSimDeps(ownerCtx));
    const startRes = startCall.getResult();
    assert.equal(startRes.status, 200);
    const sessionId = startRes.body.sessionId;
    const totalQ = startRes.body.questions.length;
    assert.equal(totalQ, 5);

    // Another PREMIUM user tries to finish owner's session -> HTTP 403 FORBIDDEN!
    const hijackCall = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId, userAnswers: { 0: 'A', 1: 'A', 2: 'A', 3: 'A', 4: 'A' } },
    });
    await handleSimulados(hijackCall.req, hijackCall.res, makeSimDeps(otherPremCtx));
    assert.equal(hijackCall.getResult().status, 403);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);

    // Incomplete simulado (4/5 answered) -> grades normally (HTTP 200) but awards 0 points!
    const startPartial = createMockReqRes({
      method: 'POST',
      body: { action: 'start', customConfig: { disciplineId: 'etica', questionCount: 5, timeLimitMinutes: 15 } },
    });
    await handleSimulados(startPartial.req, startPartial.res, makeSimDeps(ownerCtx));
    const partialSessionId = startPartial.getResult().body.sessionId;

    const finishPartial = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId: partialSessionId, userAnswers: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' } },
    });
    await handleSimulados(finishPartial.req, finishPartial.res, makeSimDeps(ownerCtx));
    assert.equal(finishPartial.getResult().status, 200);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);

    // Invalid option ('Z') on one question -> awards 0 points!
    const startInvalidOpt = createMockReqRes({
      method: 'POST',
      body: { action: 'start', customConfig: { disciplineId: 'etica', questionCount: 5, timeLimitMinutes: 15 } },
    });
    await handleSimulados(startInvalidOpt.req, startInvalidOpt.res, makeSimDeps(ownerCtx));
    const invalidOptSessionId = startInvalidOpt.getResult().body.sessionId;

    const finishInvalidOpt = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId: invalidOptSessionId, userAnswers: { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'Z' } },
    });
    await handleSimulados(finishInvalidOpt.req, finishInvalidOpt.res, makeSimDeps(ownerCtx));
    assert.equal(finishInvalidOpt.getResult().status, 200);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);

    // Empty simulado session -> HTTP 400 EMPTY_SIMULADO + 0 points
    db.seed('simulado_sessions', 'sim_empty', {
      id: 'sim_empty',
      title: 'Vazio',
      ownerKey: ownerCtx.primaryQuotaKey,
      ownerUid: 'uid_prem_owner',
      isPremium: true,
      questionIds: [],
      timeLimitMinutes: 15,
      createdAt: DAY1_MS,
    });
    const finishEmpty = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId: 'sim_empty', userAnswers: {} },
    });
    await handleSimulados(finishEmpty.req, finishEmpty.res, makeSimDeps(ownerCtx));
    assert.equal(finishEmpty.getResult().status, 400);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);

    // 100% valid answers by rightful owner -> +30 points!
    const finishValid = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId, userAnswers: { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'A' } },
    });
    await handleSimulados(finishValid.req, finishValid.res, makeSimDeps(ownerCtx));
    assert.equal(finishValid.getResult().status, 200);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_prem_owner') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 30);
    assert.equal(pub.simuladosPoints, 30);
    assert.equal(pub.simuladosCompletedCount, 1);

    // Duplicate finish on same sessionId -> HTTP 409 SIMULADO_ALREADY_COMPLETED + 0 extra points
    const finishDup = createMockReqRes({
      method: 'POST',
      body: { action: 'finish', sessionId, userAnswers: { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'A' } },
    });
    await handleSimulados(finishDup.req, finishDup.res, makeSimDeps(ownerCtx));
    assert.equal(finishDup.getResult().status, 409);
    const pubAfterDup = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pubAfterDup.totalPoints, 30);
  });

  // 6. Daily goal (+20), Weekly goal (+100), and 7-day consecutive streak (+50)
  await runCase('6. Metas diária (+20), semanal (+100) e sequência de 7 dias (+50) comprovadas no servidor sem duplicidade', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_goals', {
      name: 'Fernanda Alves',
      dailyGoalQuestions: 5,
      studyPlan: { dailyGoalQuestions: 5, weeklyGoalQuestions: 10 },
    });

    // Day 1 (2026-06-01, Monday): answer 5 unique questions (all wrong = 5 pts each) -> reaches dailyGoal (5) -> +20
    let day1BonusEvents: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await recordQuestionAnswerScore(db as any, {
        uid: 'uid_goals',
        questionId: MOCK_QUESTIONS[i].id,
        isCorrect: false,
        occurredAt: DAY1_MS + i * 1000,
        nowMs: DAY1_MS + i * 1000,
      });
      day1BonusEvents.push(...r.events.map((e) => e.type));
    }
    assert.equal(day1BonusEvents.filter((t) => t === 'daily_goal_completed').length, 1);
    assert.equal(day1BonusEvents.filter((t) => t === 'weekly_goal_completed').length, 0);

    // 6th question on Day 1 -> +5 only (NO duplicate daily goal!)
    const r6 = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_goals',
      questionId: MOCK_QUESTIONS[5].id,
      isCorrect: false,
      occurredAt: DAY1_MS + 10_000,
      nowMs: DAY1_MS + 10_000,
    });
    assert.equal(r6.totalPointsAwarded, 5);
    assert.equal(r6.events.length, 1);

    // Day 2 (2026-06-02, Tuesday): answer 4 more unique questions -> reaches weeklyGoal (6+4=10) -> +100
    const DAY2_MS = Date.parse('2026-06-02T14:00:00-03:00');
    let day2Types: string[] = [];
    for (let i = 6; i < 10; i++) {
      const r = await recordQuestionAnswerScore(db as any, {
        uid: 'uid_goals',
        questionId: MOCK_QUESTIONS[i].id,
        isCorrect: false,
        occurredAt: DAY2_MS + i * 1000,
        nowMs: DAY2_MS + i * 1000,
      });
      day2Types.push(...r.events.map((e) => e.type));
    }
    assert.equal(day2Types.filter((t) => t === 'weekly_goal_completed').length, 1);

    // Days 3, 4, 5, 6, 7: complete 1 study activity per day via handleStudyPlan (Day 7 triggers +50 streak!)
    let streakAwardedOnDay7 = false;
    for (let dayOffset = 2; dayOffset <= 6; dayOffset++) {
      const ts = DAY1_MS + dayOffset * 86_400_000;
      const dateStr = getPeriodKeysForTimestamp(ts).dateKey;
      const call = createMockReqRes({
        method: 'POST',
        body: {
          action: 'create_activity',
          type: 'revisao',
          date: dateStr,
          startTime: '19:00',
          plannedMinutes: 30,
          actualMinutes: 30,
          status: 'completed',
        },
      });
      await handleStudyPlan(call.req, call.res, {
        verifyFirebaseUser: async () => ({ uid: 'uid_goals', email: 'fernanda@example.com' }),
        getAdminFirestore: () => db as any,
        isPreviewSharingProductionFirestore: () => false,
        readJsonBody: async (r: any) => r.body,
        nowMs: () => ts,
        generateId: () => `act_day_${dayOffset + 1}`,
      });
      assert.equal(call.getResult().status, 201);
      if (dayOffset === 6) {
        const events = db
          .getCollectionValues(LEADERBOARD_COLLECTIONS.events)
          .map((e) => e.data as LeaderboardEventRecord);
        streakAwardedOnDay7 = events.some((e) => e.type === 'streak_7d_completed');
      }
    }
    assert.equal(streakAwardedOnDay7, true);

    // Extra activity on Day 7 MUST NOT duplicate +50 streak!
    const day7Ts = DAY1_MS + 6 * 86_400_000 + 3_600_000;
    const dupStreak = await recordStudyActivityStreakCheck(db as any, {
      uid: 'uid_goals',
      activityId: 'act_day_7_extra',
      occurredAt: day7Ts,
      nowMs: day7Ts,
    });
    assert.equal(dupStreak.totalPointsAwarded, 0);

    // Verify exact total points:
    // 10 wrong questions (50) + 1 daily goal (20) + 1 weekly goal (100) + 1 streak 7d (50) = 220
    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_goals') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 220);
    assert.equal(pub.questionsPoints, 50);
    assert.equal(pub.goalsPoints, 120);
    assert.equal(pub.streakPoints, 50);
    assert.equal(pub.dailyGoalsCompletedCount, 1);
    assert.equal(pub.weeklyGoalsCompletedCount, 1);
    assert.equal(pub.streak7dCount, 1);
    assert.equal(pub.currentStreakDays, 7);
  });

  // 7. Strict Privacy: random publicProfileId, zero UID/full name/email/CPF/plan in public docs & API
  await runCase('7. Privacidade: publicProfileId aleatório e zero exposição de UID, nome completo, e-mail, CPF ou plano', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });

    const sensitiveUid = 'firebase_secret_uid_999';
    db.seed('users', sensitiveUid, {
      name: 'Maria Clara Oliveira Santos',
      email: 'maria.oliveira@gmail.com',
      cpf: '321.654.987-11',
      plan: 'premium',
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      asaasCustomerId: 'cus_000123456',
    });

    await recordQuestionAnswerScore(db as any, {
      uid: sensitiveUid,
      questionId: MOCK_QUESTIONS[0].id,
      isCorrect: true,
      occurredAt: DAY1_MS,
      nowMs: DAY1_MS,
    });

    // Check nickname sanitization edge cases
    assert.match(buildSafeDefaultNickname('Maria Clara Oliveira Santos', 'pub_abcd1234'), /^Maria #1234$/);
    assert.match(buildSafeDefaultNickname('maria@email.com', 'pub_abcd1234'), /^Estudante #1234$/);
    assert.match(buildSafeDefaultNickname('123.456.789-00', 'pub_abcd1234'), /^Estudante #1234$/);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, sensitiveUid) as LeaderboardPrivateProfile;
    assert.ok(priv.publicProfileId.startsWith('pub_'));
    assert.notEqual(priv.publicProfileId, sensitiveUid);
    assert.ok(!priv.publicProfileId.includes(sensitiveUid));

    // Inspect raw Firestore docs in public, weekly, monthly
    const publicDocs = db.getCollectionValues(LEADERBOARD_COLLECTIONS.publicProfiles);
    const weeklyDocs = db.getCollectionValues(LEADERBOARD_COLLECTIONS.weekly);
    const monthlyDocs = db.getCollectionValues(LEADERBOARD_COLLECTIONS.monthly);

    assert.equal(publicDocs.length, 1);
    assert.equal(publicDocs[0].id, priv.publicProfileId);
    assert.notEqual(publicDocs[0].id, sensitiveUid);

    const serializedPublic = JSON.stringify({ publicDocs, weeklyDocs, monthlyDocs });
    for (const secret of [
      sensitiveUid,
      'Oliveira',
      'Santos',
      'maria.oliveira@gmail.com',
      '321.654.987-11',
      'cus_000123456',
      'isPremium',
      'subscriptionStatus',
    ]) {
      assert.ok(!serializedPublic.includes(secret), `Dado sensível vazou nas coleções públicas: ${secret}`);
    }

    // Inspect GET /api/leaderboard response
    const getCall = createMockReqRes({ method: 'GET', url: '/api/leaderboard' });
    await handleLeaderboard(getCall.req, getCall.res, {
      verifyFirebaseUser: async () => ({ uid: sensitiveUid, email: 'maria.oliveira@gmail.com' }),
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => false,
      nowMs: () => DAY1_MS,
    });
    const resObj = getCall.getResult();
    assert.equal(resObj.status, 200);
    const serializedApi = JSON.stringify(resObj.body);
    for (const secret of [
      sensitiveUid,
      'Oliveira',
      'Santos',
      'maria.oliveira@gmail.com',
      '321.654.987-11',
      'cus_000123456',
      'isPremium',
    ]) {
      assert.ok(!serializedApi.includes(secret), `Dado sensível vazou em /api/leaderboard: ${secret}`);
    }
    assert.equal(resObj.body.rankings.general[0].isCurrentUser, true);
    assert.equal(resObj.body.rankings.general[0].publicProfileId, priv.publicProfileId);
    assert.equal(resObj.body.me.totalPoints, 10);
  });

  // 8. Exact equality between Free and Premium students
  await runCase('8. Igualdade Free vs Premium: mesma pontuação exata para as mesmas ações', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_free', { name: 'Joao Gratuito', isPremium: false, plan: 'gratuito' });
    db.seed('users', 'uid_premium', { name: 'Paulo Premium', isPremium: true, plan: 'premium' });

    const qCorrect = MOCK_QUESTIONS[0];
    const qWrong = MOCK_QUESTIONS[1];
    const wrongOpt = qWrong.options.find((o) => o.id !== qWrong.correctOptionId)!.id;

    for (const [uid, isPremium] of [
      ['uid_free', false],
      ['uid_premium', true],
    ] as const) {
      const ctx = makeAccessCtx({ uid, isPremium });
      const qDeps = {
        resolveAccessContext: async () => ctx,
        consumeQuestionQuota: async () => ({
          allowed: true,
          questionsUsed: 1,
          questionsRemaining: 9,
          alreadyAnsweredToday: false,
        }),
        readJsonBody: async (r: any) => r.body,
        getLeaderboardFirestore: () => db as any,
        nowMs: () => DAY1_MS,
      };

      const c1 = createMockReqRes({
        method: 'POST',
        body: { questionId: qCorrect.id, selectedOptionId: qCorrect.correctOptionId },
      });
      await handleQuestions(c1.req, c1.res, qDeps);
      assert.equal(c1.getResult().status, 200);

      const c2 = createMockReqRes({
        method: 'POST',
        body: { questionId: qWrong.id, selectedOptionId: wrongOpt },
      });
      await handleQuestions(c2.req, c2.res, qDeps);
      assert.equal(c2.getResult().status, 200);

      const simRes = await recordSimuladoCompletionScore(db as any, {
        uid,
        sessionId: `sim_eq_${uid}`,
        sessionOwnerUid: uid,
        questionIds: [qCorrect.id],
        answers: [{ questionId: qCorrect.id, selectedOptionId: qCorrect.correctOptionId, validOptionIds: ['A', 'B', 'C', 'D'] }],
        occurredAt: DAY1_MS,
        nowMs: DAY1_MS,
      });
      assert.equal(simRes.totalPointsAwarded, 30);
    }

    const freePriv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_free') as LeaderboardPrivateProfile;
    const premPriv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_premium') as LeaderboardPrivateProfile;
    const freePub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, freePriv.publicProfileId) as LeaderboardPublicProfile;
    const premPub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, premPriv.publicProfileId) as LeaderboardPublicProfile;

    assert.equal(freePub.totalPoints, 45);
    assert.equal(premPub.totalPoints, 45);
    assert.equal(freePub.questionsPoints, premPub.questionsPoints);
    assert.equal(freePub.simuladosPoints, premPub.simuladosPoints);
  });

  // 9. Professor Virtual IA never awards points
  await runCase('9. Professor Virtual IA gera 0 pontos e não registra eventos no ranking', async () => {
    assert.equal(LEADERBOARD_POINTS.AI_TUTOR, 0);
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_ai', { name: 'Beatriz IA', isPremium: true });

    const call = createMockReqRes({
      method: 'POST',
      url: '/api/ai-tutor',
      body: {
        questionId: MOCK_QUESTIONS[0].id,
        message: 'Por que a alternativa correta está certa?',
      },
    });
    await handleAiTutor(call.req, call.res, {
      verifyFirebaseUser: async () => ({ uid: 'uid_ai', email: 'bia@example.com' }),
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => false,
      readJsonBody: async (r: any) => r.body,
      getTodayDateKey: () => '2026-06-01',
      generateAiAnswer: async () => ({
        answer: 'Explicação jurídica direta.',
        model: 'gemini-3.1-flash-lite',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
      getLimits: getAiTutorLimits,
      resolveModel: resolveGeminiModel,
      nowMs: () => DAY1_MS,
    });
    assert.equal(call.getResult().status, 200);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.publicProfiles).length, 0);
  });

  // 10. Failure resilience + Idempotent Outbox Recovery (including pre-launch outbox item rejection)
  await runCase('10. Recuperação de falhas: falha transitória não quebra questão/simulado, grava outbox e reprocessa sem duplicar', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_rec', { name: 'Rafael Resiliente', isPremium: true });

    const q = MOCK_QUESTIONS[4];
    const ctx = makeAccessCtx({ uid: 'uid_rec', isPremium: true });

    // Inject transient Firestore transaction failure on next question answer
    db.failNextTransactions = 1;
    const qCall = createMockReqRes({
      method: 'POST',
      body: { questionId: q.id, selectedOptionId: q.correctOptionId },
    });
    await handleQuestions(qCall.req, qCall.res, {
      resolveAccessContext: async () => ctx,
      readJsonBody: async (r: any) => r.body,
      getLeaderboardFirestore: () => db as any,
      nowMs: () => DAY1_MS,
    });

    // Normal question answering STILL returns HTTP 200!
    assert.equal(qCall.getResult().status, 200);
    assert.equal(qCall.getResult().body.isCorrect, true);

    // Event was safely queued in leaderboard_outbox
    const outboxDocs = db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox);
    assert.equal(outboxDocs.length, 1);
    assert.equal((outboxDocs[0].data as LeaderboardOutboxRecord).status, 'pending');

    // Also enqueue a pre-launch outbox item -> recovery MUST skip it with 0 points!
    await enqueueLeaderboardOutbox(db as any, {
      uid: 'uid_rec',
      kind: 'question_answer',
      sourceId: MOCK_QUESTIONS[5].id,
      payload: { questionId: MOCK_QUESTIONS[5].id, isCorrect: true },
      occurredAt: BEFORE_LAUNCH_MS,
      error: new Error('Simulated pre-launch failure'),
      nowMs: DAY1_MS,
    });

    // Reprocess outbox -> recovers exactly +10 points and skips pre-launch item
    const recovery1 = await reprocessPendingLeaderboardOutbox(db as any, {
      uid: 'uid_rec',
      nowMs: DAY1_MS + 5_000,
    });
    assert.equal(recovery1.processed, 1);
    assert.equal(recovery1.skipped, 1);
    assert.equal(recovery1.totalPointsRecovered, 10);

    // Reprocessing again (even resetting status to pending maliciously) MUST award 0 extra points!
    const recoveredDoc = db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).find(
      (d) => d.data.sourceId === q.id
    )!;
    db.seed(LEADERBOARD_COLLECTIONS.outbox, recoveredDoc.id, {
      ...recoveredDoc.data,
      status: 'pending',
    });
    const recovery2 = await reprocessPendingLeaderboardOutbox(db as any, {
      uid: 'uid_rec',
      nowMs: DAY1_MS + 10_000,
    });
    assert.equal(recovery2.processed, 1);
    assert.equal(recovery2.totalPointsRecovered, 0);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_rec') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 10);
  });

  // 11. Client manipulation blocked + negative points impossible + Firestore rules verified
  await runCase('11. Segurança: cliente bloqueado de gravar pontos, pontos negativos impossíveis e firestore.rules restritivas', async () => {
    const db = new MockFirestore();

    // Negative / zero points guard
    assert.throws(() => assertPositivePoints(0, 'test'), /inteiro positivo/i);
    assert.throws(() => assertPositivePoints(-50, 'test'), /inteiro positivo/i);

    // POST/PUT/DELETE to /api/leaderboard blocked with 405
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const call = createMockReqRes({ method, body: { totalPoints: 999999 } });
      await handleLeaderboard(call.req, call.res, {
        verifyFirebaseUser: async () => ({ uid: 'uid_x', email: 'x@example.com' }),
        getAdminFirestore: () => db as any,
        isPreviewSharingProductionFirestore: () => false,
      });
      assert.equal(call.getResult().status, 405);
    }

    // Unauthenticated GET -> 401
    const unauth = createMockReqRes({ method: 'GET' });
    await handleLeaderboard(unauth.req, unauth.res, {
      verifyFirebaseUser: async () => {
        throw new Error('Token ausente');
      },
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => false,
    });
    assert.equal(unauth.getResult().status, 401);

    // Cross-UID GET -> 403
    const crossUid = createMockReqRes({ method: 'GET', url: '/api/leaderboard?uid=victim_uid' });
    await handleLeaderboard(crossUid.req, crossUid.res, {
      verifyFirebaseUser: async () => ({ uid: 'attacker_uid', email: 'attacker@example.com' }),
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => false,
    });
    assert.equal(crossUid.getResult().status, 403);

    // Preview sharing production Firestore -> 403
    const previewBlocked = createMockReqRes({ method: 'GET' });
    await handleLeaderboard(previewBlocked.req, previewBlocked.res, {
      verifyFirebaseUser: async () => ({ uid: 'uid_x', email: 'x@example.com' }),
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => true,
    });
    assert.equal(previewBlocked.getResult().status, 403);

    // Verify firestore.rules explicitly denies client read/write on all 8 leaderboard collections
    const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    assert.equal(Object.values(LEADERBOARD_COLLECTIONS).length, 8);
    for (const col of Object.values(LEADERBOARD_COLLECTIONS)) {
      const regex = new RegExp(`match\\s+/${col}/\\{[^}]+\\}\\s*\\{\\s*allow read, write: if false;\\s*\\}`);
      assert.match(rulesText, regex, `firestore.rules deve bloquear cliente em ${col}`);
    }
  });

  // 12. Simultaneous main tx failure + transient outbox failures -> exponential backoff retry recovers cleanly
  await runCase('12. Retry com backoff: falha simultânea na transação e nas 2 primeiras gravações do outbox recupera na 3ª tentativa', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_backoff', { name: 'Tiago Backoff', dailyGoalQuestions: 20 });

    const observedDelays: number[] = [];
    db.failNextTransactions = 1;
    db.failOutboxWrites = 2; // Fail attempts 1 & 2, succeed on attempt 3

    const res = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_backoff',
      questionId: MOCK_QUESTIONS[6].id,
      isCorrect: true,
      occurredAt: DAY1_MS,
      nowMs: DAY1_MS,
      retryOptions: {
        maxAttempts: 3,
        baseDelayMs: 40,
        sleepFn: async (ms) => {
          observedDelays.push(ms);
        },
      },
    });

    assert.equal(res.awarded, false);
    assert.equal(res.reason, 'TRANSIENT_FAILURE_QUEUED');
    assert.equal(res.queuedForRecovery, true);
    assert.equal(res.secondaryProofPersisted, true);
    assert.deepEqual(observedDelays, [40, 80]);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).length, 1);

    const rec = await reprocessPendingLeaderboardOutbox(db as any, { nowMs: DAY1_MS + 2_000 });
    assert.equal(rec.processed, 1);
    assert.equal(rec.totalPointsRecovered, 10);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_backoff') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 10);
  });

  // 13. Simultaneous main tx + ALL outbox retries fail -> secondary server-only reconciliation recovers without duplicates
  await runCase('13. Reconciliação secundária: recupera via fontes persistentes do servidor quando transação e outbox falham, ignorando pré-lançamento e dados do navegador', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_reconcile', { name: 'Camila Reconciliacao', dailyGoalQuestions: 20 });

    // Seed browser-writable collections with spoofed client answers/simulados -> MUST be completely ignored!
    db.seed('users/uid_reconcile/answers', MOCK_QUESTIONS[20].id, {
      questionId: MOCK_QUESTIONS[20].id,
      isCorrect: true,
      timestamp: DAY1_MS,
    });
    db.seed('users/uid_reconcile/simulados', 'sim_browser_spoof', {
      id: 'sim_browser_spoof',
      totalQuestions: 10,
      correctAnswers: 10,
      createdAt: DAY1_MS,
    });

    // Simulate main tx + ALL 3 outbox retries failing on a valid question answer
    // (server proof in leaderboard_verified_actions was persisted beforehand)
    db.failNextTransactions = 1;
    db.failOutboxWrites = 3;
    const qOut = await recordQuestionAnswerScore(db as any, {
      uid: 'uid_reconcile',
      questionId: MOCK_QUESTIONS[7].id,
      isCorrect: true,
      occurredAt: DAY1_MS,
      nowMs: DAY1_MS,
      retryOptions: { maxAttempts: 3, baseDelayMs: 0 },
    });
    assert.equal(qOut.awarded, false);
    assert.equal(qOut.queuedForRecovery, false);
    assert.equal(qOut.secondaryProofPersisted, true);
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).length, 0);

    // Seed an independent completed 100%-valid simulado_sessions doc (without outbox or verified_actions)
    db.seed('simulado_sessions', 'sim_server_only_valid', {
      id: 'sim_server_only_valid',
      title: 'Simulado Express',
      ownerKey: '2026-06-01_uid_uid_reconcile',
      ownerUid: 'uid_reconcile',
      isPremium: false,
      questionIds: [MOCK_QUESTIONS[0].id, MOCK_QUESTIONS[1].id],
      timeLimitMinutes: 15,
      createdAt: DAY1_MS,
      completedAt: DAY1_MS + 60_000,
      completedByUid: 'uid_reconcile',
      fullyAnsweredForRanking: true,
    });

    // Seed ineligible records that MUST be ignored:
    // a) Pre-launch verified action
    await persistServerVerifiedAction(db as any, {
      uid: 'uid_reconcile',
      kind: 'question_answer',
      sourceId: MOCK_QUESTIONS[8].id,
      payload: { questionId: MOCK_QUESTIONS[8].id, isCorrect: true },
      occurredAt: BEFORE_LAUNCH_MS,
      nowMs: DAY1_MS,
    });
    // b) Pre-launch simulado_sessions
    db.seed('simulado_sessions', 'sim_pre_launch_srv', {
      id: 'sim_pre_launch_srv',
      title: 'Pré-lançamento',
      ownerKey: '2026-05-31_uid_uid_reconcile',
      ownerUid: 'uid_reconcile',
      isPremium: true,
      questionIds: [MOCK_QUESTIONS[0].id],
      timeLimitMinutes: 15,
      createdAt: BEFORE_LAUNCH_MS - 5000,
      completedAt: BEFORE_LAUNCH_MS,
      completedByUid: 'uid_reconcile',
      fullyAnsweredForRanking: true,
    });
    // c) Incomplete simulado_sessions (fullyAnsweredForRanking: false)
    db.seed('simulado_sessions', 'sim_incomplete_srv', {
      id: 'sim_incomplete_srv',
      title: 'Incompleto',
      ownerKey: '2026-06-01_uid_uid_reconcile',
      ownerUid: 'uid_reconcile',
      isPremium: true,
      questionIds: [MOCK_QUESTIONS[0].id],
      timeLimitMinutes: 15,
      createdAt: DAY1_MS,
      completedAt: DAY1_MS + 10_000,
      completedByUid: 'uid_reconcile',
      fullyAnsweredForRanking: false,
    });
    // d) Mismatched owner simulado_sessions
    db.seed('simulado_sessions', 'sim_hijacked_srv', {
      id: 'sim_hijacked_srv',
      title: 'Outro dono',
      ownerKey: '2026-06-01_uid_uid_reconcile',
      ownerUid: 'uid_reconcile',
      isPremium: true,
      questionIds: [MOCK_QUESTIONS[0].id],
      timeLimitMinutes: 15,
      createdAt: DAY1_MS,
      completedAt: DAY1_MS + 10_000,
      completedByUid: 'uid_intruder',
      fullyAnsweredForRanking: true,
    });

    // Run secondary reconciliation
    const rec1 = await reconcileLeaderboardFromServerSources(db as any, {
      pageSize: 2,
      maxTotal: 50,
      nowMs: DAY1_MS + 120_000,
    });
    assert.equal(rec1.active, true);
    assert.equal(rec1.recovered, 2); // 1 question (+10) + 1 valid simulado (+30)
    assert.equal(rec1.totalPointsRecovered, 40);
    assert.equal(rec1.skippedIneligible, 3); // pre-launch verified action + pre-launch sim + hijacked sim (incomplete filtered by where)

    // Run secondary reconciliation AGAIN -> 0 duplicate points!
    const rec2 = await reconcileLeaderboardFromServerSources(db as any, {
      pageSize: 2,
      maxTotal: 50,
      nowMs: DAY1_MS + 180_000,
    });
    assert.equal(rec2.recovered, 0);
    assert.equal(rec2.totalPointsRecovered, 0);
    assert.equal(rec2.alreadyScored, 2);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_reconcile') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 40);
    assert.equal(pub.questionsPoints, 10);
    assert.equal(pub.simuladosPoints, 30);
  });

  // 14. Paginated global outbox reprocessing for > 100 pending events across multiple students
  await runCase('14. Reprocessamento global paginado (> 100 eventos): processa 135 eventos de múltiplos alunos com cursor sem duplicar', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });

    // Seed 5 students, each with 27 pending outbox question events (5 * 27 = 135 events > 100!)
    // Use high dailyGoalQuestions=200 so only question points (+10 each) are tested cleanly
    const studentIds = ['uid_bulk_1', 'uid_bulk_2', 'uid_bulk_3', 'uid_bulk_4', 'uid_bulk_5'];
    for (const uid of studentIds) {
      db.seed('users', uid, { name: `Aluno ${uid}`, dailyGoalQuestions: 200, studyPlan: { dailyGoalQuestions: 200, weeklyGoalQuestions: 1400 } });
      for (let i = 0; i < 27; i++) {
        await enqueueLeaderboardOutbox(db as any, {
          uid,
          kind: 'question_answer',
          sourceId: `bulk_q_${i}`,
          payload: { questionId: `bulk_q_${i}`, isCorrect: true },
          occurredAt: DAY1_MS + i * 1000,
          error: new Error('Simulated bulk outage'),
          nowMs: DAY1_MS,
        });
      }
    }
    assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).length, 135);

    // Loop cursor pagination with maxTotal=60, pageSize=40 until drained
    let cursor: string | null = null;
    let totalProcessed = 0;
    let totalPoints = 0;
    let batches = 0;
    let totalPages = 0;

    do {
      const batch = await reprocessPendingLeaderboardOutbox(db as any, {
        pageSize: 40,
        maxTotal: 60,
        cursor,
        nowMs: DAY1_MS + 300_000,
      });
      batches += 1;
      totalPages += batch.pagesScanned;
      totalProcessed += batch.processed;
      totalPoints += batch.totalPointsRecovered;
      cursor = batch.hasMore ? batch.nextCursor : null;
      assert.ok(batches <= 5, 'Paginação não deve entrar em loop infinito');
    } while (cursor);

    assert.equal(batches, 3); // 60 + 60 + 15 = 135
    assert.ok(totalPages >= 4);
    assert.equal(totalProcessed, 135);
    assert.equal(totalPoints, 1350);

    // Verify every student received exactly 270 points
    for (const uid of studentIds) {
      const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, uid) as LeaderboardPrivateProfile;
      const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
      assert.equal(pub.totalPoints, 270);
      assert.equal(pub.questionsAnsweredCount, 27);
    }

    // Subsequent pass finds 0 pending items and adds 0 points
    const extraPass = await reprocessPendingLeaderboardOutbox(db as any, { nowMs: DAY1_MS + 360_000 });
    assert.equal(extraPass.processed, 0);
    assert.equal(extraPass.totalPointsRecovered, 0);
  });

  // 15. Recovery of 'failed' outbox items + deferral during temporary RANKING_INACTIVE
  await runCase('15. Recuperação de eventos em status failed e preservação de pendentes durante pausa temporária do ranking', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_failed_rec', { name: 'Daniela Recovery', dailyGoalQuestions: 20 });

    // Create an outbox item that exhausted its 10 retry attempts (status === 'failed')
    const outboxId = await enqueueLeaderboardOutbox(db as any, {
      uid: 'uid_failed_rec',
      kind: 'question_answer',
      sourceId: MOCK_QUESTIONS[9].id,
      payload: { questionId: MOCK_QUESTIONS[9].id, isCorrect: true },
      occurredAt: DAY1_MS,
      error: new Error('Persistent transient error'),
      nowMs: DAY1_MS,
    });
    const failedDoc = db.getDoc(LEADERBOARD_COLLECTIONS.outbox, outboxId);
    db.seed(LEADERBOARD_COLLECTIONS.outbox, outboxId, {
      ...failedDoc,
      status: 'failed',
      attempts: 10,
    });

    // Also enqueue a pending post-launch item while temporarily pausing the ranking
    const pendingId = await enqueueLeaderboardOutbox(db as any, {
      uid: 'uid_failed_rec',
      kind: 'question_answer',
      sourceId: MOCK_QUESTIONS[10].id,
      payload: { questionId: MOCK_QUESTIONS[10].id, isCorrect: false },
      occurredAt: DAY1_MS + 5_000,
      error: new Error('Transient error'),
      nowMs: DAY1_MS + 5_000,
    });

    // Pause ranking temporarily (active: false)
    await configureOfficialLeaderboardLaunch(db as any, { active: false, launchAtIso: LAUNCH_ISO, nowMs: DAY1_MS + 10_000 });
    const pausedRun = await reprocessPendingLeaderboardOutbox(db as any, {
      includeFailed: true,
      nowMs: DAY1_MS + 12_000,
    });
    assert.equal(pausedRun.deferredInactive, 2);
    assert.equal(pausedRun.skipped, 0);
    assert.equal(db.getDoc(LEADERBOARD_COLLECTIONS.outbox, pendingId).status, 'pending');
    assert.equal(db.getDoc(LEADERBOARD_COLLECTIONS.outbox, outboxId).status, 'failed');

    // Re-activate ranking -> default run (includeFailed: false) recovers only 'pending' (+5)
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: DAY1_MS + 20_000 });
    const pendingOnly = await reprocessPendingLeaderboardOutbox(db as any, {
      includeFailed: false,
      nowMs: DAY1_MS + 21_000,
    });
    assert.equal(pendingOnly.processed, 1);
    assert.equal(pendingOnly.totalPointsRecovered, 5);
    assert.equal(db.getDoc(LEADERBOARD_COLLECTIONS.outbox, outboxId).status, 'failed');

    // Admin recovery with includeFailed: true recovers the 'failed' item (+10)
    const failedRecovery = await reprocessPendingLeaderboardOutbox(db as any, {
      includeFailed: true,
      nowMs: DAY1_MS + 22_000,
    });
    assert.equal(failedRecovery.processed, 1);
    assert.equal(failedRecovery.totalPointsRecovered, 10);
    assert.equal(db.getDoc(LEADERBOARD_COLLECTIONS.outbox, outboxId).status, 'processed');

    // Re-running with includeFailed: true adds 0 duplicate points
    const repeatRun = await reprocessPendingLeaderboardOutbox(db as any, {
      includeFailed: true,
      nowMs: DAY1_MS + 23_000,
    });
    assert.equal(repeatRun.processed, 0);
    assert.equal(repeatRun.totalPointsRecovered, 0);

    const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_failed_rec') as LeaderboardPrivateProfile;
    const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
    assert.equal(pub.totalPoints, 15);
  });

  // 16. Protected admin/cron endpoint /api/leaderboard-recover security & behavior
  await runCase('16. Endpoint /api/leaderboard-recover: protege com segredo de ambiente, bloqueia alunos/Preview e executa recuperação global sem expor PII', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });

    const sensitiveUid = 'uid_admin_recover_secret_777';
    db.seed('users', sensitiveUid, {
      name: 'Roberto Carlos Almeida',
      email: 'roberto.almeida@example.com',
      cpf: '999.888.777-66',
      dailyGoalQuestions: 20,
    });

    await enqueueLeaderboardOutbox(db as any, {
      uid: sensitiveUid,
      kind: 'question_answer',
      sourceId: MOCK_QUESTIONS[11].id,
      payload: { questionId: MOCK_QUESTIONS[11].id, isCorrect: true },
      occurredAt: DAY1_MS,
      error: new Error('Outage'),
      nowMs: DAY1_MS,
    });

    const ADMIN_SECRET = 'super-secret-leaderboard-admin-key-2026';
    const CRON_SECRET = 'super-secret-vercel-cron-key-2026';

    const makeRecoverDeps = (overrides: Record<string, any> = {}) => ({
      getAdminFirestore: () => db as any,
      isPreviewSharingProductionFirestore: () => false,
      readJsonBody: async (r: any) => r.body || {},
      getAllowedSecrets: () => [ADMIN_SECRET, CRON_SECRET],
      nowMs: () => DAY1_MS + 60_000,
      ...overrides,
    });

    // a) Unconfigured secret -> 503 fail closed
    const noSecret = createMockReqRes({
      method: 'POST',
      url: '/api/leaderboard-recover',
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    await handleLeaderboardRecover(noSecret.req, noSecret.res, makeRecoverDeps({ getAllowedSecrets: () => [] }));
    assert.equal(noSecret.getResult().status, 503);

    // b) Missing auth, wrong secret, or student Firebase JWT -> 401
    const unauthorizedHeaderCases: Array<Record<string, string>> = [
      {},
      { authorization: 'Bearer wrong-secret-value-123456' },
      { authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.student_firebase_token.sig' },
      { 'x-leaderboard-admin-secret': 'short' },
    ];
    for (const headers of unauthorizedHeaderCases) {
      const unauth = createMockReqRes({ method: 'POST', url: '/api/leaderboard-recover', headers });
      await handleLeaderboardRecover(unauth.req, unauth.res, makeRecoverDeps());
      assert.equal(unauth.getResult().status, 401);
    }

    // c) Preview sharing production Firestore -> 403
    const previewCall = createMockReqRes({
      method: 'POST',
      url: '/api/leaderboard-recover',
      headers: { 'x-leaderboard-admin-secret': ADMIN_SECRET },
    });
    await handleLeaderboardRecover(
      previewCall.req,
      previewCall.res,
      makeRecoverDeps({ isPreviewSharingProductionFirestore: () => true })
    );
    assert.equal(previewCall.getResult().status, 403);

    // d) Disallowed methods -> 405
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const badMethod = createMockReqRes({
        method,
        url: '/api/leaderboard-recover',
        headers: { 'x-leaderboard-admin-secret': ADMIN_SECRET },
      });
      await handleLeaderboardRecover(badMethod.req, badMethod.res, makeRecoverDeps());
      assert.equal(badMethod.getResult().status, 405);
    }

    // e) Valid POST with x-leaderboard-admin-secret -> 200, recovers outbox & never leaks UID/PII
    const okPost = createMockReqRes({
      method: 'POST',
      url: '/api/leaderboard-recover',
      headers: { 'x-leaderboard-admin-secret': ADMIN_SECRET },
      body: { pageSize: 20, maxTotal: 100, includeFailed: true, includeReconciliation: true },
    });
    await handleLeaderboardRecover(okPost.req, okPost.res, makeRecoverDeps());
    const postRes = okPost.getResult();
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.ok, true);
    assert.equal(postRes.body.outbox.processed, 1);
    assert.equal(postRes.body.outbox.totalPointsRecovered, 10);

    const serialized = JSON.stringify(postRes.body);
    for (const secret of [sensitiveUid, 'Roberto', 'Almeida', 'roberto.almeida@example.com', '999.888.777-66', ADMIN_SECRET]) {
      assert.ok(!serialized.includes(secret), `Resposta administrativa vazou dado sensível: ${secret}`);
    }

    // f) Valid GET (Vercel Cron) with Bearer CRON_SECRET -> 200, idempotent (0 extra points)
    const okGet = createMockReqRes({
      method: 'GET',
      url: '/api/leaderboard-recover?includeFailed=true&pageSize=25',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    await handleLeaderboardRecover(okGet.req, okGet.res, makeRecoverDeps());
    assert.equal(okGet.getResult().status, 200);
    assert.equal(okGet.getResult().body.outbox.totalPointsRecovered, 0);
  });

  // 17. Simulado finish resilience during transient Firestore outage in claimSimuladoSessionCompletion
  await runCase('17. Finalização de simulado sob falha transitória do Firestore: entrega correção (HTTP 200) sem erro 500 e preserva bloqueios de dono/duplicidade/100% válidas', async () => {
    const db = new MockFirestore();
    await configureOfficialLeaderboardLaunch(db as any, { active: true, launchAtIso: LAUNCH_ISO, nowMs: LAUNCH_MS });
    db.seed('users', 'uid_sim_resilient', { name: 'Gustavo Simulado', isPremium: true });
    db.seed('users', 'uid_sim_other', { name: 'Invasor Premium', isPremium: true });

    const ownerCtx = makeAccessCtx({ uid: 'uid_sim_resilient', isPremium: true });
    const otherCtx = makeAccessCtx({ uid: 'uid_sim_other', isPremium: true });

    const qList = MOCK_QUESTIONS.slice(0, 3);
    const makeSimResilientDeps = (ctx: AccessContext) => ({
      resolveAccessContext: async () => ctx,
      getDailyQuotaStatus: async () => ({
        dateKey: '2026-06-01',
        questionsLimit: null,
        questionsUsed: 0,
        questionsRemaining: null,
        answeredQuestionIdsToday: [],
        simuladosLimit: null,
        simuladosUsed: 0,
        simuladosRemaining: null,
      }),
      consumeSimuladoQuota: async () => ({ allowed: true, simuladosUsed: 1, simuladosRemaining: 0 }),
      saveSimuladoSession: async (s: SimuladoSessionRecord) => {
        db.seed('simulado_sessions', s.id, s);
      },
      getSimuladoSession: async (id: string) => db.getDoc('simulado_sessions', id) || null,
      claimSimuladoSessionCompletion,
      readJsonBody: async (r: any) => r.body,
      getLeaderboardFirestore: () => db as any,
      nowMs: () => DAY1_MS,
    });

    // Simulate Vercel production environment where local quota fallback is disabled
    const prevVercel = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      // Session 1: 100% valid answers during transient Firestore outage on claimCompletion
      const simOutageId = 'sim_outage_valid_1';
      db.seed('simulado_sessions', simOutageId, {
        id: simOutageId,
        title: 'Simulado Resiliente',
        ownerKey: ownerCtx.primaryQuotaKey,
        ownerUid: 'uid_sim_resilient',
        isPremium: true,
        questionIds: qList.map((q) => q.id),
        timeLimitMinutes: 15,
        createdAt: DAY1_MS,
        completedAt: null,
        completedByUid: null,
      });

      // Ownership check STILL blocks another Premium user (403) even during outage
      const wrongOwnerCall = createMockReqRes({
        method: 'POST',
        body: { action: 'finish', sessionId: simOutageId, userAnswers: { 0: 'A', 1: 'B', 2: 'C' } },
      });
      await handleSimulados(wrongOwnerCall.req, wrongOwnerCall.res, makeSimResilientDeps(otherCtx));
      assert.equal(wrongOwnerCall.getResult().status, 403);

      // Inject transient Firestore failure on claimSimuladoSessionCompletion transaction
      db.failNextTransactions = 1;
      const finishOutageCall = createMockReqRes({
        method: 'POST',
        body: {
          action: 'finish',
          sessionId: simOutageId,
          userAnswers: {
            0: qList[0].correctOptionId,
            1: qList[1].correctOptionId,
            2: qList[2].correctOptionId,
          },
        },
      });
      await handleSimulados(finishOutageCall.req, finishOutageCall.res, makeSimResilientDeps(ownerCtx));
      const finishOutageRes = finishOutageCall.getResult();

      // Student STILL receives HTTP 200 with full result & answer key (NO HTTP 500!)
      assert.equal(finishOutageRes.status, 200);
      assert.equal(finishOutageRes.body.totalQuestions, 3);
      assert.equal(finishOutageRes.body.correctAnswers, 3);
      assert.equal(finishOutageRes.body.gradedQuestions.length, 3);

      // Synchronous unconfirmed points are NOT immediately credited; deferred outbox item IS queued safely
      assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.events).length, 0);
      assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).length, 1);

      // Reprocessing recovers the +30 points exactly once
      const recOut = await reprocessPendingLeaderboardOutbox(db as any, { nowMs: DAY1_MS + 5_000 });
      assert.equal(recOut.processed, 1);
      assert.equal(recOut.totalPointsRecovered, 30);

      // Session 2: incomplete simulado during transient outage -> returns HTTP 200 grading, 0 points, 0 outbox items!
      const simIncompleteOutageId = 'sim_outage_incomplete_2';
      db.seed('simulado_sessions', simIncompleteOutageId, {
        id: simIncompleteOutageId,
        title: 'Simulado Incompleto Sob Falha',
        ownerKey: ownerCtx.primaryQuotaKey,
        ownerUid: 'uid_sim_resilient',
        isPremium: true,
        questionIds: qList.map((q) => q.id),
        timeLimitMinutes: 15,
        createdAt: DAY1_MS,
        completedAt: null,
        completedByUid: null,
      });

      db.failNextTransactions = 1;
      const incompleteOutageCall = createMockReqRes({
        method: 'POST',
        body: {
          action: 'finish',
          sessionId: simIncompleteOutageId,
          userAnswers: { 0: qList[0].correctOptionId, 1: qList[1].correctOptionId }, // missing index 2
        },
      });
      await handleSimulados(incompleteOutageCall.req, incompleteOutageCall.res, makeSimResilientDeps(ownerCtx));
      assert.equal(incompleteOutageCall.getResult().status, 200);
      assert.equal(incompleteOutageCall.getResult().body.correctAnswers, 2);
      // Outbox count did NOT grow (still just the 1 processed item from simOutageId)
      assert.equal(db.getCollectionValues(LEADERBOARD_COLLECTIONS.outbox).length, 1);

      // Session 3: already-completed session STILL blocked with 409 even if Firestore tx would fail
      const simAlreadyDoneId = 'sim_already_done_3';
      db.seed('simulado_sessions', simAlreadyDoneId, {
        id: simAlreadyDoneId,
        title: 'Já Finalizado',
        ownerKey: ownerCtx.primaryQuotaKey,
        ownerUid: 'uid_sim_resilient',
        isPremium: true,
        questionIds: qList.map((q) => q.id),
        timeLimitMinutes: 15,
        createdAt: DAY1_MS,
        completedAt: DAY1_MS + 1_000,
        completedByUid: 'uid_sim_resilient',
        fullyAnsweredForRanking: true,
      });
      db.failNextTransactions = 1;
      const alreadyDoneCall = createMockReqRes({
        method: 'POST',
        body: { action: 'finish', sessionId: simAlreadyDoneId, userAnswers: { 0: 'A', 1: 'B', 2: 'C' } },
      });
      await handleSimulados(alreadyDoneCall.req, alreadyDoneCall.res, makeSimResilientDeps(ownerCtx));
      assert.equal(alreadyDoneCall.getResult().status, 409);

      const priv = db.getDoc(LEADERBOARD_COLLECTIONS.privateProfiles, 'uid_sim_resilient') as LeaderboardPrivateProfile;
      const pub = db.getDoc(LEADERBOARD_COLLECTIONS.publicProfiles, priv.publicProfileId) as LeaderboardPublicProfile;
      assert.equal(pub.totalPoints, 30);
    } finally {
      if (prevVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = prevVercel;
      }
    }
  });

  console.log(`\n🎉 Todas as ${passed} suítes de teste do Ranking Aprova Direito (Etapa 6.1) passaram!`);
}

runTests().catch((err) => {
  console.error('\n💥 Falha na suíte test-leaderboard:', err);
  process.exit(1);
});
