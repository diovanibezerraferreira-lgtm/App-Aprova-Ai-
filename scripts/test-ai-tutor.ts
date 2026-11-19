import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import { ThinkingLevel } from '@google/genai';
import { terminate } from 'firebase/firestore';
import { deleteApp, getApps } from 'firebase/app';
import { handleAiTutor, type AiTutorDeps } from '../api/ai-tutor.js';
import {
  DEFAULT_FREE_AI_DAILY_LIMIT,
  DEFAULT_PREMIUM_AI_DAILY_LIMIT,
  DEFAULT_GEMINI_MODEL,
  GEMINI_REQUEST_TIMEOUT_MS,
  buildThinkingConfigForModel,
  createDefaultGeminiGenerator,
  extractSanitizedSdkError,
  getAiTutorLimits,
  resolveGeminiModel,
  sanitizeDiagnosticText,
  type AiTutorGenerateFn,
} from '../api/_aiTutorEngine.js';
import { MOCK_QUESTIONS } from '../api/_data/questions.js';
import { db as clientDb } from '../src/services/firebase.js';
import { askQuestionAiTutor, ApiAccessError } from '../src/services/contentService.js';

after(async () => {
  try {
    await terminate(clientDb);
    for (const app of getApps()) {
      await deleteApp(app);
    }
  } catch {
    // ignore teardown warnings
  }
});

interface MockResState {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function createMockRes(): { res: ServerResponse; state: MockResState } {
  const state: MockResState = {
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

function createMockReq(method: string, url = '/api/ai-tutor'): IncomingMessage {
  return {
    method,
    url,
    headers: { authorization: 'Bearer valid-mock-token' },
  } as unknown as IncomingMessage;
}

interface MockUserDoc {
  profile: Record<string, any>;
  answers: Record<string, Record<string, any>>;
  ai_tutor_usage: Record<string, Record<string, any>>;
}

function createMockFirestore(initial: {
  users?: Record<string, Partial<MockUserDoc>>;
  daily_usage?: Record<string, Record<string, any>>;
}) {
  const users = new Map<string, MockUserDoc>();
  const dailyUsage = new Map<string, Record<string, any>>(
    Object.entries(initial.daily_usage || {})
  );

  for (const [uid, data] of Object.entries(initial.users || {})) {
    users.set(uid, {
      profile: { ...(data.profile || {}) },
      answers: { ...(data.answers || {}) },
      ai_tutor_usage: { ...(data.ai_tutor_usage || {}) },
    });
  }

  const ensureUser = (uid: string): MockUserDoc => {
    if (!users.has(uid)) {
      users.set(uid, { profile: {}, answers: {}, ai_tutor_usage: {} });
    }
    return users.get(uid)!;
  };

  const makeAiUsageRef = (uid: string, dateKey: string) => ({
    _kind: 'ai_tutor_usage' as const,
    uid,
    dateKey,
    async get() {
      const u = users.get(uid);
      const data = u?.ai_tutor_usage[dateKey];
      return { exists: Boolean(data), data: () => (data ? { ...data } : undefined) };
    },
    async set(data: Record<string, any>, opts?: { merge?: boolean }) {
      const u = ensureUser(uid);
      const prev = u.ai_tutor_usage[dateKey] || {};
      u.ai_tutor_usage[dateKey] = opts?.merge ? { ...prev, ...data } : { ...data };
    },
  });

  const db = {
    collection(name: string) {
      if (name === 'daily_usage') {
        return {
          doc(key: string) {
            return {
              async get() {
                const data = dailyUsage.get(key);
                return { exists: Boolean(data), data: () => (data ? { ...data } : undefined) };
              },
            };
          },
        };
      }
      assert.equal(name, 'users');
      return {
        doc(uid: string) {
          return {
            async get() {
              const u = users.get(uid);
              return { exists: Boolean(u), data: () => (u ? { ...u.profile } : undefined) };
            },
            collection(sub: 'answers' | 'ai_tutor_usage') {
              return {
                doc(docId: string) {
                  if (sub === 'ai_tutor_usage') {
                    return makeAiUsageRef(uid, docId);
                  }
                  return {
                    async get() {
                      const u = users.get(uid);
                      const data = u?.answers[docId];
                      return {
                        exists: Boolean(data),
                        data: () => (data ? { ...data } : undefined),
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    async runTransaction(fn: (tx: any) => Promise<void>) {
      const tx = {
        async get(ref: any) {
          return ref.get();
        },
        set(ref: any, data: Record<string, any>, opts?: { merge?: boolean }) {
          return ref.set(data, opts);
        },
      };
      await fn(tx);
    },
  };

  return { db, users, dailyUsage };
}

const PENAL_QUESTION = MOCK_QUESTIONS.find((q) => q.disciplineId === 'penal')!;
const CIVIL_QUESTION = MOCK_QUESTIONS.find((q) => q.disciplineId === 'civil')!;
const DATE_KEY = '2026-11-19';
const NOW_MS = Date.parse('2026-11-19T15:00:00.000Z');

function makeDeps(opts: {
  uid?: string;
  db: any;
  body?: any;
  previewBlocked?: boolean;
  authError?: Error;
  generateAiAnswer?: AiTutorGenerateFn;
}): AiTutorDeps {
  return {
    verifyFirebaseUser: async () => {
      if (opts.authError) throw opts.authError;
      return { uid: opts.uid || 'uid-student', email: 'aluno@aprovadireito.com.br' };
    },
    getAdminFirestore: () => opts.db,
    isPreviewSharingProductionFirestore: () => Boolean(opts.previewBlocked),
    readJsonBody: async () => opts.body ?? {},
    getTodayDateKey: () => DATE_KEY,
    generateAiAnswer:
      opts.generateAiAnswer ||
      (async () => ({
        answer: 'Explicação didática estruturada com base na legislação e na questão.',
        model: DEFAULT_GEMINI_MODEL,
        usage: { inputTokens: 900, outputTokens: 420, totalTokens: 1320 },
      })),
    getLimits: () => ({
      freeDailyLimit: DEFAULT_FREE_AI_DAILY_LIMIT,
      premiumDailyLimit: DEFAULT_PREMIUM_AI_DAILY_LIMIT,
    }),
    resolveModel: () => DEFAULT_GEMINI_MODEL,
    nowMs: () => NOW_MS,
  };
}

test('1. Consulta sobre questão de Direito Penal envia enunciado, alternativas, gabarito e fundamentação para aluno Premium', async () => {
  assert.ok(PENAL_QUESTION, 'Deve existir questão de Direito Penal no catálogo');

  const { db } = createMockFirestore({
    users: {
      'uid-prem': {
        profile: {
          isPremium: true,
          subscriptionStatus: 'ACTIVE',
          premiumUntil: '2027-01-01T00:00:00.000Z',
        },
      },
    },
  });

  let capturedPrompt = '';
  let capturedSystem = '';

  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-prem',
      db,
      body: {
        questionId: PENAL_QUESTION.id,
        message: 'Por que essa alternativa está correta e qual artigo fundamenta?',
        history: [],
      },
      generateAiAnswer: async ({ systemInstruction, contents }) => {
        capturedSystem = systemInstruction;
        capturedPrompt = contents.map((c) => c.parts.map((p) => p.text).join('\n')).join('\n');
        return {
          answer: `Texto legal: ${PENAL_QUESTION.legalFoundation}. Explicação didática sobre a alternativa ${PENAL_QUESTION.correctOptionId}.`,
          model: DEFAULT_GEMINI_MODEL,
          usage: { inputTokens: 950, outputTokens: 380, totalTokens: 1330 },
        };
      },
    })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  assert.equal(body.questionId, PENAL_QUESTION.id);
  assert.equal(body.solutionUnlocked, true);
  assert.equal(body.isPremium, true);
  assert.equal(body.quota.dailyLimit, 30);
  assert.equal(body.quota.usedToday, 1);
  assert.equal(body.quota.remainingToday, 29);

  // Prompt contains Penal statement, options, official answer and legal foundation
  assert.ok(capturedPrompt.includes('Direito Penal'));
  assert.ok(capturedPrompt.includes(PENAL_QUESTION.statement));
  assert.ok(capturedPrompt.includes(`Alternativa ${PENAL_QUESTION.correctOptionId}`));
  assert.ok(capturedPrompt.includes(PENAL_QUESTION.legalFoundation));
  assert.ok(capturedSystem.includes('NUNCA invente números de artigos de lei'));
});

test('2. Consulta sobre questão de Direito Civil com explicação das alternativas e histórico de conversa', async () => {
  assert.ok(CIVIL_QUESTION, 'Deve existir questão de Direito Civil no catálogo');

  const { db } = createMockFirestore({
    users: {
      'uid-civil': {
        profile: { isPremium: false },
        answers: {
          [CIVIL_QUESTION.id]: {
            questionId: CIVIL_QUESTION.id,
            selectedOptionId: 'A',
            isCorrect: CIVIL_QUESTION.correctOptionId === 'A',
            timestamp: NOW_MS - 60_000,
          },
        },
      },
    },
  });

  let capturedTurns = 0;
  let capturedPrompt = '';

  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-civil',
      db,
      body: {
        questionId: CIVIL_QUESTION.id,
        message: 'Por que as demais alternativas estão erradas?',
        history: [
          { role: 'user', content: 'Qual é o tema central desta questão?' },
          { role: 'assistant', content: `O tema central é ${CIVIL_QUESTION.subject}.` },
        ],
      },
      generateAiAnswer: async ({ contents }) => {
        capturedTurns = contents.length;
        capturedPrompt = contents.map((c) => c.parts.map((p) => p.text).join('\n')).join('\n');
        return {
          answer: `Análise das alternativas incorretas em ${CIVIL_QUESTION.subject}, com base em ${CIVIL_QUESTION.legalFoundation}.`,
          model: DEFAULT_GEMINI_MODEL,
          usage: { inputTokens: 1050, outputTokens: 510, totalTokens: 1560 },
        };
      },
    })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  assert.equal(body.solutionUnlocked, true);
  assert.equal(body.quota.planType, 'free');
  assert.equal(body.quota.usedToday, 1);
  assert.equal(body.quota.remainingToday, 2);
  // 2 priming turns + 2 history turns + 1 current message = 5 turns
  assert.equal(capturedTurns, 5);
  assert.ok(capturedPrompt.includes('Direito Civil'));
  assert.ok(capturedPrompt.includes(CIVIL_QUESTION.legalFoundation));
});

test('3. Regra anti-spoiler: usuário gratuito que NÃO respondeu a questão NÃO recebe nem envia gabarito/comentário ao modelo', async () => {
  const { db } = createMockFirestore({
    users: {
      'uid-free-unanswered': {
        profile: { isPremium: false },
        answers: {},
      },
    },
  });

  let capturedSystem = '';
  let capturedPrompt = '';

  // GET status check confirms solutionUnlocked: false
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('GET', `/api/ai-tutor?questionId=${encodeURIComponent(PENAL_QUESTION.id)}`),
      res,
      makeDeps({ uid: 'uid-free-unanswered', db })
    );
    assert.equal(state.statusCode, 200);
    const statusBody = JSON.parse(state.body);
    assert.equal(statusBody.solutionUnlocked, false);
    assert.equal(statusBody.quota.remainingToday, 3);
  }

  // POST consultation even if client tries to spoof solutionUnlocked: true
  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-free-unanswered',
      db,
      body: {
        questionId: PENAL_QUESTION.id,
        message: 'Me diga qual é a alternativa correta!',
        solutionUnlocked: true, // malicious client spoof attempt
        history: [],
      },
      generateAiAnswer: async ({ systemInstruction, contents }) => {
        capturedSystem = systemInstruction;
        capturedPrompt = contents.map((c) => c.parts.map((p) => p.text).join('\n')).join('\n');
        return {
          answer:
            'Antes de revelar o gabarito, responda a questão na tela. Posso explicar os conceitos jurídicos do enunciado para ajudá-lo.',
          model: DEFAULT_GEMINI_MODEL,
          usage: { inputTokens: 820, outputTokens: 160, totalTokens: 980 },
        };
      },
    })
  );

  assert.equal(state.statusCode, 200);
  const body = JSON.parse(state.body);
  assert.equal(body.solutionUnlocked, false);

  // CRITICAL: official answer, explanation and legalFoundation must NEVER be sent into the prompt
  assert.ok(!capturedPrompt.includes(`Gabarito oficial cadastrado no banco`));
  assert.ok(!capturedPrompt.includes(PENAL_QUESTION.explanation));
  assert.ok(!capturedPrompt.includes(PENAL_QUESTION.legalFoundation));
  assert.ok(capturedSystem.includes('TERMINANTEMENTE PROIBIDO de revelar'));
});

test('4. Usuário sem autenticação é bloqueado com HTTP 401 e spoofing de UID/Preview com HTTP 403', async () => {
  const { db } = createMockFirestore({});

  // 401 Unauthenticated
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('POST'),
      res,
      makeDeps({
        db,
        authError: new Error('Token Firebase ausente ou inválido.'),
        body: { questionId: PENAL_QUESTION.id, message: 'Explique o enunciado' },
      })
    );
    assert.equal(state.statusCode, 401);
  }

  // 403 Query UID spoof
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('GET', `/api/ai-tutor?uid=other-user&questionId=${PENAL_QUESTION.id}`),
      res,
      makeDeps({ uid: 'uid-real', db })
    );
    assert.equal(state.statusCode, 403);
  }

  // 403 Body UID spoof
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('POST'),
      res,
      makeDeps({
        uid: 'uid-real',
        db,
        body: { uid: 'other-user', questionId: PENAL_QUESTION.id, message: 'Ajuda' },
      })
    );
    assert.equal(state.statusCode, 403);
  }

  // 403 Preview sharing production Firestore
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('GET'),
      res,
      makeDeps({ uid: 'uid-real', db, previewBlocked: true })
    );
    assert.equal(state.statusCode, 403);
  }
});

test('5. Limite diário de consultas gratuitas bloqueia a 4ª consulta com HTTP 429 sem chamar a IA', async () => {
  const { db } = createMockFirestore({
    users: {
      'uid-limit': {
        profile: { isPremium: false },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 3, planType: 'free' },
        },
      },
    },
  });

  let aiWasCalled = false;
  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-limit',
      db,
      body: {
        questionId: CIVIL_QUESTION.id,
        message: 'Pode dar um exemplo prático?',
        history: [],
      },
      generateAiAnswer: async () => {
        aiWasCalled = true;
        return {
          answer: 'Não deve ser chamado',
          model: DEFAULT_GEMINI_MODEL,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
      },
    })
  );

  assert.equal(state.statusCode, 429);
  assert.equal(aiWasCalled, false);
  const body = JSON.parse(state.body);
  assert.equal(body.error, 'AI_DAILY_LIMIT_REACHED');
  assert.equal(body.quota.remainingToday, 0);
  assert.equal(body.quota.dailyLimit, 3);
});

test('6. Falha do provedor de IA retorna HTTP 503 claro, NÃO desconta cota e NÃO inventa resposta', async () => {
  const { db, users } = createMockFirestore({
    users: {
      'uid-fail': {
        profile: { isPremium: false },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 1, planType: 'free' },
        },
      },
    },
  });

  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-fail',
      db,
      body: {
        questionId: PENAL_QUESTION.id,
        message: 'Pode explicar de forma mais simples?',
        history: [],
      },
      generateAiAnswer: async () => {
        const err: any = new Error('Upstream 503 UNAVAILABLE');
        err.status = 503;
        throw err;
      },
    })
  );

  assert.equal(state.statusCode, 503);
  const body = JSON.parse(state.body);
  assert.equal(body.unavailable, true);
  assert.equal(body.answer, undefined);
  assert.equal(body.quota.usedToday, 1);
  assert.equal(body.quota.remainingToday, 2);
  // Stored count remained 1 (never charged on AI failure!)
  assert.equal(users.get('uid-fail')!.ai_tutor_usage[DATE_KEY].count, 1);
});

test('7. Proteção da chave de API: nenhum arquivo do frontend importa @google/genai ou acessa GEMINI_API_KEY, e modelos proibidos são rejeitados', () => {
  const srcDir = path.resolve(process.cwd(), 'src');

  function walkFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkFiles(full));
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(full);
      }
    }
    return files;
  }

  for (const file of walkFiles(srcDir)) {
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(
      !content.includes('@google/genai'),
      `Frontend não pode importar @google/genai (${file})`
    );
    assert.ok(
      !content.includes('GEMINI_API_KEY'),
      `Frontend não pode referenciar GEMINI_API_KEY (${file})`
    );
  }

  // Prohibited legacy models fall back safely to DEFAULT_GEMINI_MODEL
  assert.equal(resolveGeminiModel({ GEMINI_MODEL: 'gemini-1.5-flash' }), DEFAULT_GEMINI_MODEL);
  assert.equal(resolveGeminiModel({ GEMINI_MODEL: 'gemini-2.0-flash' }), DEFAULT_GEMINI_MODEL);
  assert.deepEqual(getAiTutorLimits({}), {
    freeDailyLimit: 3,
    premiumDailyLimit: 30,
  });
});

test('8. Modelo padrão é gemini-3.1-flash-lite compatível com @google/genai e desativa retries internos do SDK', async () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(resolveGeminiModel({}), 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_REQUEST_TIMEOUT_MS, 18_000);

  // ThinkingLevel compatibility per model family
  assert.deepEqual(buildThinkingConfigForModel('gemini-3.1-flash-lite'), {
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
  assert.deepEqual(buildThinkingConfigForModel('gemini-4-hydrogen'), {
    thinkingLevel: ThinkingLevel.LOW,
  });
  assert.equal(buildThinkingConfigForModel('gemini-2.5-flash'), undefined);

  let capturedClientConfig: any = null;
  let capturedCallConfig: any = null;
  let callCount = 0;

  const generator = createDefaultGeminiGenerator('test-secret-key-never-logged', {
    timeoutMs: 5_000,
    clientFactory: (cfg) => {
      capturedClientConfig = cfg;
      return {
        models: {
          async generateContent(params: any) {
            callCount += 1;
            capturedCallConfig = params;
            return {
              text: 'Resposta objetiva com base legal.',
              usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
            };
          },
        },
      };
    },
  });

  const result = await generator({
    model: DEFAULT_GEMINI_MODEL,
    systemInstruction: 'Instruções',
    contents: [{ role: 'user', parts: [{ text: 'Dúvida' }] }],
  });

  assert.equal(callCount, 1);
  assert.equal(result.model, 'gemini-3.1-flash-lite');
  assert.equal(result.answer, 'Resposta objetiva com base legal.');
  assert.equal(capturedClientConfig.httpOptions.timeout, 5_000);
  assert.equal(capturedClientConfig.httpOptions.retryOptions.attempts, 1);
  assert.deepEqual(capturedCallConfig.config.thinkingConfig, {
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
  assert.ok(capturedCallConfig.config.abortSignal instanceof AbortSignal);
});

test('9. Timeout do Gemini aciona AbortSignal, não faz retry duplicado, retorna HTTP 504 e NÃO desconta cota', async () => {
  let providerCalls = 0;
  let signalAborted = false;

  const slowGenerator = createDefaultGeminiGenerator('test-secret-key', {
    timeoutMs: 80,
    clientFactory: () => ({
      models: {
        generateContent(params: any) {
          providerCalls += 1;
          return new Promise((_resolve, reject) => {
            const sig: AbortSignal | undefined = params?.config?.abortSignal;
            if (sig) {
              sig.addEventListener(
                'abort',
                () => {
                  signalAborted = true;
                  const abortErr: any = new Error('The operation was aborted');
                  abortErr.name = 'AbortError';
                  reject(abortErr);
                },
                { once: true }
              );
            }
          });
        },
      },
    }),
  });

  const { db, users } = createMockFirestore({
    users: {
      'uid-timeout': {
        profile: { isPremium: false },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 1, planType: 'free' },
        },
      },
    },
  });

  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-timeout',
      db,
      body: {
        questionId: PENAL_QUESTION.id,
        message: 'Explique a fundamentação jurídica.',
        history: [],
      },
      generateAiAnswer: slowGenerator,
    })
  );

  assert.equal(providerCalls, 1, 'Não deve fazer retry duplicado em caso de timeout');
  assert.equal(signalAborted, true, 'AbortSignal deve ser acionado ao atingir o timeout');
  assert.equal(state.statusCode, 504);
  const body = JSON.parse(state.body);
  assert.equal(body.error, 'AI_TIMEOUT');
  assert.equal(body.unavailable, true);
  assert.equal(body.quota.usedToday, 1);
  assert.equal(body.quota.remainingToday, 2);
  assert.equal(users.get('uid-timeout')!.ai_tutor_usage[DATE_KEY].count, 1);
});

test('10. Resposta vazia da IA retorna HTTP 502 (nunca HTTP 200) e NÃO desconta cota do aluno', async () => {
  const { db, users } = createMockFirestore({
    users: {
      'uid-empty': {
        profile: {
          isPremium: true,
          subscriptionStatus: 'ACTIVE',
          premiumUntil: '2027-01-01T00:00:00.000Z',
        },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 4, planType: 'premium' },
        },
      },
    },
  });

  // Scenario A: empty string returned directly by generator
  {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('POST'),
      res,
      makeDeps({
        uid: 'uid-empty',
        db,
        body: {
          questionId: CIVIL_QUESTION.id,
          message: 'Por que essa alternativa está correta?',
          history: [],
        },
        generateAiAnswer: async () => ({
          answer: '   \n\t  ',
          model: DEFAULT_GEMINI_MODEL,
          usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
        }),
      })
    );

    assert.equal(state.statusCode, 502);
    const body = JSON.parse(state.body);
    assert.equal(body.error, 'AI_EMPTY_RESPONSE');
    assert.equal(body.unavailable, true);
    assert.equal(body.answer, undefined);
    assert.equal(body.quota.usedToday, 4);
    assert.equal(users.get('uid-empty')!.ai_tutor_usage[DATE_KEY].count, 4);
  }

  // Scenario B: createDefaultGeminiGenerator rejects empty response.text
  const emptyGen = createDefaultGeminiGenerator('test-secret-key', {
    clientFactory: () => ({
      models: {
        async generateContent() {
          return { text: '   ' };
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      emptyGen({
        model: DEFAULT_GEMINI_MODEL,
        systemInstruction: 'sys',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }),
    (err: any) => err?.code === 'AI_EMPTY_RESPONSE' && err?.status === 502
  );
});

test('11. Erro da API (503 / 429 / chave ausente) faz no máximo 1 chamada, não expõe chave e NÃO desconta cota', async () => {
  const secretKey = 'AIzaSyFakeSecretDoNotExpose123456';
  let callCount = 0;

  const failingGen = createDefaultGeminiGenerator(secretKey, {
    clientFactory: () => ({
      models: {
        async generateContent() {
          callCount += 1;
          const err: any = new Error(`Upstream 503 UNAVAILABLE for key ${secretKey}`);
          err.status = 503;
          throw err;
        },
      },
    }),
  });

  const { db, users } = createMockFirestore({
    users: {
      'uid-api-err': {
        profile: { isPremium: false },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 2, planType: 'free' },
        },
      },
    },
  });

  const { res, state } = createMockRes();
  await handleAiTutor(
    createMockReq('POST'),
    res,
    makeDeps({
      uid: 'uid-api-err',
      db,
      body: {
        questionId: PENAL_QUESTION.id,
        message: 'Qual o fundamento legal?',
        history: [],
      },
      generateAiAnswer: failingGen,
    })
  );

  assert.equal(callCount, 1, 'Erro 503 não deve disparar retries duplicados');
  assert.equal(state.statusCode, 503);
  assert.ok(!state.body.includes(secretKey), 'Resposta nunca pode vazar GEMINI_API_KEY');
  const body = JSON.parse(state.body);
  assert.equal(body.unavailable, true);
  assert.equal(body.quota.usedToday, 2);
  assert.equal(users.get('uid-api-err')!.ai_tutor_usage[DATE_KEY].count, 2);
});

test('12. Frontend askQuestionAiTutor trata timeout, cancelamento (AbortSignal) e HTTP 200 vazio/inválido', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 12A: Client timeout
    globalThis.fetch = ((_input: any, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            const err: any = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        askQuestionAiTutor(
          { questionId: PENAL_QUESTION.id, message: 'Explique', history: [] },
          { timeoutMs: 60 }
        ),
      (err: any) => err instanceof ApiAccessError && err.status === 504 && err.code === 'REQUEST_TIMEOUT'
    );

    // 12B: Explicit cancellation via AbortController
    const controller = new AbortController();
    const pending = askQuestionAiTutor(
      { questionId: PENAL_QUESTION.id, message: 'Explique', history: [] },
      { signal: controller.signal, timeoutMs: 5_000 }
    );
    setTimeout(() => controller.abort(), 25);

    await assert.rejects(
      () => pending,
      (err: any) => err instanceof ApiAccessError && err.status === 499 && err.code === 'REQUEST_ABORTED'
    );

    // 12C: HTTP 200 with empty body -> EMPTY_RESPONSE (never silently returns {})
    globalThis.fetch = (async () =>
      new Response('', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

    await assert.rejects(
      () => askQuestionAiTutor({ questionId: PENAL_QUESTION.id, message: 'Explique', history: [] }),
      (err: any) => err instanceof ApiAccessError && err.status === 502 && err.code === 'EMPTY_RESPONSE'
    );

    // 12D: HTTP 200 with truncated/malformed JSON -> INVALID_JSON_RESPONSE
    globalThis.fetch = (async () =>
      new Response('{"answer": "cortado', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () => askQuestionAiTutor({ questionId: PENAL_QUESTION.id, message: 'Explique', history: [] }),
      (err: any) =>
        err instanceof ApiAccessError && err.status === 502 && err.code === 'INVALID_JSON_RESPONSE'
    );

    // 12E: HTTP 200 with valid JSON but empty answer -> AI_EMPTY_RESPONSE
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ questionId: PENAL_QUESTION.id, answer: '   ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () => askQuestionAiTutor({ questionId: PENAL_QUESTION.id, message: 'Explique', history: [] }),
      (err: any) => err instanceof ApiAccessError && err.status === 502 && err.code === 'AI_EMPTY_RESPONSE'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('13. QuestionAiTutorPanel garante cancelamento, AbortController no unmount e encerramento do loading no finally', () => {
  const panelPath = path.resolve(process.cwd(), 'src/components/QuestionAiTutorPanel.tsx');
  const source = fs.readFileSync(panelPath, 'utf-8');

  assert.ok(source.includes('AbortController'), 'Painel deve usar AbortController');
  assert.ok(source.includes('cancelActiveRequest'), 'Painel deve expor cancelamento explícito');
  assert.ok(source.includes('Cancelar'), 'Painel deve exibir botão Cancelar durante o carregamento');
  assert.ok(source.includes('finally {'), 'Painel deve encerrar loading no bloco finally');
  assert.ok(source.includes('setSending(false)'), 'Painel deve sempre resetar setSending(false)');
  assert.ok(
    source.includes('REQUEST_ABORTED'),
    'Painel deve tratar cancelamento sem manter estado preso'
  );
});

test('14. Diagnóstico preserva erro original do SDK (DEADLINE_EXCEEDED, 404, 429, 403 e causa de rede) mesmo quando convertido em AI_TIMEOUT', async () => {
  // 14A: Server-side 504 DEADLINE_EXCEEDED ApiError before local abort timer
  const serverDeadlineGen = createDefaultGeminiGenerator('test-secret-key', {
    timeoutMs: 5_000,
    clientFactory: () => ({
      models: {
        async generateContent() {
          const apiErr: any = new Error(
            JSON.stringify({
              error: {
                code: 504,
                message: 'Deadline expired before operation could complete.',
                status: 'DEADLINE_EXCEEDED',
              },
            })
          );
          apiErr.name = 'ApiError';
          apiErr.status = 504;
          throw apiErr;
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      serverDeadlineGen({
        model: DEFAULT_GEMINI_MODEL,
        systemInstruction: 'sys',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }),
    (err: any) => {
      assert.equal(err.code, 'AI_TIMEOUT');
      assert.equal(err.status, 504);
      assert.equal(err.sdkDiagnostic.origin, 'sdk_api_error');
      assert.equal(err.sdkDiagnostic.localTimedOut, false);
      assert.equal(err.sdkDiagnostic.abortSignalAborted, false);
      assert.equal(err.sdkDiagnostic.errorName, 'ApiError');
      assert.equal(err.sdkDiagnostic.httpStatus, 504);
      assert.equal(err.sdkDiagnostic.googleCode, 504);
      assert.equal(err.sdkDiagnostic.googleStatus, 'DEADLINE_EXCEEDED');
      assert.equal(
        err.sdkDiagnostic.googleMessage,
        'Deadline expired before operation could complete.'
      );
      return true;
    }
  );

  // 14B: Local AbortController timeout distinguishes localTimedOut=true
  const localTimeoutGen = createDefaultGeminiGenerator('test-secret-key', {
    timeoutMs: 60,
    clientFactory: () => ({
      models: {
        generateContent(params: any) {
          return new Promise((_resolve, reject) => {
            params?.config?.abortSignal?.addEventListener(
              'abort',
              () => {
                const abortErr: any = new Error('The operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              },
              { once: true }
            );
          });
        },
      },
    }),
  });

  await assert.rejects(
    () =>
      localTimeoutGen({
        model: DEFAULT_GEMINI_MODEL,
        systemInstruction: 'sys',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      }),
    (err: any) => {
      assert.equal(err.code, 'AI_TIMEOUT');
      assert.equal(err.sdkDiagnostic.origin, 'local_abort_timeout');
      assert.equal(err.sdkDiagnostic.localTimedOut, true);
      assert.equal(err.sdkDiagnostic.abortSignalAborted, true);
      assert.equal(err.sdkDiagnostic.errorName, 'AbortError');
      return true;
    }
  );

  // 14C: Network error with Undici causeCode & 404/429 ApiError metadata
  const netErr: any = new TypeError('fetch failed');
  netErr.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
  const netDiag = extractSanitizedSdkError(netErr);
  assert.equal(netDiag.origin, 'network_or_abort');
  assert.equal(netDiag.causeCode, 'UND_ERR_CONNECT_TIMEOUT');

  const notFoundErr: any = new Error(
    JSON.stringify({
      error: {
        code: 404,
        message: 'models/gemini-3.1-flash-lite is not found for API version v1beta',
        status: 'NOT_FOUND',
      },
    })
  );
  notFoundErr.name = 'ApiError';
  notFoundErr.status = 404;
  const nfDiag = extractSanitizedSdkError(notFoundErr);
  assert.equal(nfDiag.origin, 'sdk_api_error');
  assert.equal(nfDiag.httpStatus, 404);
  assert.equal(nfDiag.googleCode, 404);
  assert.equal(nfDiag.googleStatus, 'NOT_FOUND');
});

test('15. Sanitização de logs bloqueia chaves, tokens, JWT, e-mails, CPF, conteúdo da questão e dados pessoais', async () => {
  const secretKey = 'AIzaSyTestSecretKey9876543210ABCDE';
  const fakeBearer = 'Bearer ya29.superSecretAccessToken123456';
  const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1aWQtc2VjcmV0In0.signaturePayloadXYZ123';
  const personalEmail = 'aluno.privado@aprovadireito.com.br';
  const personalCpf = '123.456.789-00';
  const secretStudentPrompt = 'FRASE_CONFIDENCIAL_DO_ALUNO_998877';

  // Direct unit check on sanitizeDiagnosticText
  const sanitizedSample = sanitizeDiagnosticText(
    `Request failed for ${personalEmail} CPF ${personalCpf} ?key=${secretKey} ${fakeBearer} jwt=${fakeJwt} x-goog-api-key: ${secretKey}`
  )!;
  assert.ok(!sanitizedSample.includes(secretKey));
  assert.ok(!sanitizedSample.includes('ya29.superSecretAccessToken'));
  assert.ok(!sanitizedSample.includes('eyJhbGciOiJSUzI1NiJ9'));
  assert.ok(!sanitizedSample.includes(personalEmail));
  assert.ok(!sanitizedSample.includes(personalCpf));
  assert.ok(sanitizedSample.includes('[REDACTED_EMAIL]'));
  assert.ok(sanitizedSample.includes('[REDACTED_CPF]'));

  // End-to-end log capture through handleAiTutor
  const { db, users } = createMockFirestore({
    users: {
      'uid-secret-student-42': {
        profile: { isPremium: false, email: personalEmail },
        ai_tutor_usage: {
          [DATE_KEY]: { dateKey: DATE_KEY, count: 1, planType: 'free' },
        },
      },
    },
  });

  const leakyErrorGen = createDefaultGeminiGenerator(secretKey, {
    timeoutMs: 5_000,
    clientFactory: () => ({
      models: {
        async generateContent() {
          const apiErr: any = new Error(
            JSON.stringify({
              error: {
                code: 403,
                status: 'PERMISSION_DENIED',
                message: `API key ${secretKey} rejected for ${personalEmail} (?key=${secretKey}) ${fakeBearer} CPF ${personalCpf}`,
              },
            })
          );
          apiErr.name = 'ApiError';
          apiErr.status = 403;
          throw apiErr;
        },
      },
    }),
  });

  const capturedLogs: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    capturedLogs.push(args.map((a) => String(a)).join(' '));
  };

  try {
    const { res, state } = createMockRes();
    await handleAiTutor(
      createMockReq('POST'),
      res,
      makeDeps({
        uid: 'uid-secret-student-42',
        db,
        body: {
          questionId: PENAL_QUESTION.id,
          message: secretStudentPrompt,
          history: [],
        },
        generateAiAnswer: leakyErrorGen,
      })
    );

    assert.equal(state.statusCode, 503);
    const responseBody = JSON.parse(state.body);
    assert.equal(responseBody.sdkDiagnostic, undefined, 'Resposta HTTP não deve expor sdkDiagnostic');
    assert.equal(responseBody.sdk, undefined, 'Resposta HTTP não deve expor sdk');
    assert.equal(users.get('uid-secret-student-42')!.ai_tutor_usage[DATE_KEY].count, 1);

    assert.equal(capturedLogs.length, 1);
    const rawLog = capturedLogs[0];
    const parsedLog = JSON.parse(rawLog);

    assert.equal(parsedLog.event, 'ai_tutor_provider_error');
    assert.equal(parsedLog.model, DEFAULT_GEMINI_MODEL);
    assert.equal(parsedLog.mappedCode, 'AI_PROVIDER_AUTH_ERROR');
    assert.equal(parsedLog.mappedHttpStatus, 503);
    assert.equal(parsedLog.sdk.origin, 'sdk_api_error');
    assert.equal(parsedLog.sdk.httpStatus, 403);
    assert.equal(parsedLog.sdk.googleCode, 403);
    assert.equal(parsedLog.sdk.googleStatus, 'PERMISSION_DENIED');

    // Strict non-leakage assertions on serialized log
    assert.ok(!rawLog.includes(secretKey), 'Log nunca pode conter GEMINI_API_KEY');
    assert.ok(!rawLog.includes('ya29.superSecretAccessToken'), 'Log nunca pode conter Bearer token');
    assert.ok(!rawLog.includes(personalEmail), 'Log nunca pode conter e-mail pessoal');
    assert.ok(!rawLog.includes(personalCpf), 'Log nunca pode conter CPF');
    assert.ok(!rawLog.includes('uid-secret-student-42'), 'Log nunca pode conter UID do aluno');
    assert.ok(!rawLog.includes(secretStudentPrompt), 'Log nunca pode conter pergunta do aluno');
    assert.ok(!rawLog.includes(PENAL_QUESTION.statement), 'Log nunca pode conter enunciado da questão');
    assert.ok(!rawLog.includes(PENAL_QUESTION.explanation), 'Log nunca pode conter explicação oficial');
  } finally {
    console.error = originalConsoleError;
  }
});
