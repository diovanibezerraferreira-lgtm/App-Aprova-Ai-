import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ThinkingLevel } from '@google/genai';
import subscriptionsHandler, {
  handleSubscriptionsRoute,
  resolveSubscriptionAction,
} from '../api/subscriptions.ts';
import contentHandler, {
  handleContentRoute,
  resolveContentResource,
} from '../api/content.ts';
import leaderboardRouterHandler, {
  handleLeaderboardRoute,
  resolveLeaderboardTarget,
} from '../api/leaderboard.ts';
import webhookAsaasHandler from '../api/webhook-asaas.ts';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_FALLBACK_GEMINI_MODEL,
  GEMINI_REQUEST_TIMEOUT_MS,
  buildThinkingConfigForModel,
} from '../api/_aiTutorEngine.ts';

const ROOT_DIR = process.cwd();
const API_DIR = path.resolve(ROOT_DIR, 'api');

const EXPECTED_SERVERLESS_FUNCTIONS = [
  'ai-tutor.ts',
  'content.ts',
  'flash-lite-test.ts',
  'leaderboard.ts',
  'performance-report.ts',
  'questions.ts',
  'simulados.ts',
  'study-plan.ts',
  'subscriptions.ts',
  'webhook-asaas.ts',
].sort();

function collectVercelServerlessFunctions(dir: string, relBase = ''): string[] {
  const entries = readdirSync(dir);
  const found: string[] = [];

  for (const name of entries) {
    // Vercel ignores any file or folder inside api/ whose name starts with "_" or "."
    if (name.startsWith('_') || name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, name);
    const relPath = relBase ? `${relBase}/${name}` : name;
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      found.push(...collectVercelServerlessFunctions(fullPath, relPath));
    } else if (/\.(ts|js|mjs|cjs)$/i.test(name) && !name.endsWith('.d.ts')) {
      found.push(relPath);
    }
  }

  return found.sort();
}

function createMockReq(options: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}): IncomingMessage & { body?: any; readableEnded?: boolean } {
  const req = new EventEmitter() as IncomingMessage & {
    body?: any;
    readableEnded?: boolean;
  };
  req.method = options.method || 'GET';
  req.url = options.url;
  req.headers = options.headers || {};
  if (options.body !== undefined) {
    req.body = options.body;
  }
  req.readableEnded = true;
  return req;
}

function createMockRes() {
  let statusCode = 200;
  let body = '';
  const headers: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: any) {
      if (chunk !== undefined && chunk !== null) {
        body += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
      }
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body,
    getJson: () => (body ? JSON.parse(body) : null),
  };
}

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

test('1. Contagem de Serverless Functions na pasta api/ respeita limite da Vercel Hobby (<= 12) e totaliza exatamente 9 funções', () => {
  const functions = collectVercelServerlessFunctions(API_DIR);

  assert.ok(
    functions.length <= 12,
    `Limite do plano Vercel Hobby excedido: encontradas ${functions.length} funções (${functions.join(', ')})`
  );
  assert.equal(functions.length, 10, `Esperadas exatamente 10 funções Serverless, encontradas ${functions.length}`);
  assert.deepEqual(functions, EXPECTED_SERVERLESS_FUNCTIONS);

  // Verifica ausência de dependência circular nos módulos internos consolidados
  const internalFiles = [
    'api/_webhookAsaasHandler.ts',
    'api/_subscriptions/create.ts',
    'api/_subscriptions/status.ts',
    'api/_subscriptions/history.ts',
    'api/_content/materials.ts',
    'api/_content/briefs.ts',
    'api/_leaderboardRecover.ts',
  ];

  for (const rel of internalFiles) {
    const src = readFileSync(path.resolve(ROOT_DIR, rel), 'utf-8');
    assert.ok(!src.includes('../subscriptions'), `${rel} não deve importar roteador subscriptions.ts`);
    assert.ok(!src.includes('../content'), `${rel} não deve importar roteador content.ts`);
    assert.ok(!src.includes('./leaderboard.js'), `${rel} não deve importar roteador leaderboard.ts`);
    assert.ok(!src.includes('./webhook-asaas.js'), `${rel} não deve importar roteador webhook-asaas.ts`);
  }
});

test('2. vercel.json e server.ts preservam build, SPA fallback e todas as rotas públicas atuais', () => {
  const vercelJson = JSON.parse(readFileSync(path.resolve(ROOT_DIR, 'vercel.json'), 'utf-8'));

  assert.equal(vercelJson.installCommand, 'bun install');
  assert.equal(vercelJson.buildCommand, 'bun run build');
  assert.ok(Array.isArray(vercelJson.rewrites), 'vercel.json deve possuir array rewrites');

  // SPA fallback preservado na posição 0 excluindo api/
  assert.equal(vercelJson.rewrites[0].destination, '/index.html');
  assert.ok(String(vercelJson.rewrites[0].source).includes('api/'));

  const expectedRewrites = [
    ['/api/webhook-basics', '/api/webhook-asaas'],
    ['/api/create-subscription', '/api/subscriptions?__action=create'],
    ['/api/subscription-status', '/api/subscriptions?__action=status'],
    ['/api/subscription-history', '/api/subscriptions?__action=history'],
    ['/api/materials', '/api/content?__resource=materials'],
    ['/api/briefs', '/api/content?__resource=briefs'],
    ['/api/leaderboard-recover', '/api/leaderboard?__action=recover'],
  ];

  for (const [source, destination] of expectedRewrites) {
    const match = vercelJson.rewrites.find(
      (r: any) => r?.source === source && r?.destination === destination
    );
    assert.ok(match, `Rewrite obrigatório ausente em vercel.json: ${source} -> ${destination}`);
  }

  const serverTs = readFileSync(path.resolve(ROOT_DIR, 'server.ts'), 'utf-8');
  const expectedServerRoutes = [
    '/api/create-subscription',
    '/api/subscription-status',
    '/api/subscription-history',
    '/api/webhook-asaas',
    '/api/webhook-basics',
    '/api/questions',
    '/api/simulados',
    '/api/briefs',
    '/api/materials',
    '/api/performance-report',
    '/api/study-plan',
    '/api/ai-tutor',
    '/api/leaderboard',
    '/api/leaderboard-recover',
  ];

  for (const route of expectedServerRoutes) {
    assert.ok(
      serverTs.includes(`app.all('${route}'`),
      `Rota pública ausente em server.ts: ${route}`
    );
  }
});

test('3. Roteador api/subscriptions.ts despacha create, status e history preservando query params, headers, corpo e métodos HTTP', async () => {
  const calls: Array<{ target: string; method?: string; url?: string; auth?: string; body?: any }> = [];

  const mockDeps = {
    create: async (req: IncomingMessage & { body?: any }, res: ServerResponse) => {
      calls.push({
        target: 'create',
        method: req.method,
        url: req.url,
        auth: String(req.headers.authorization || ''),
        body: req.body,
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: 'create' }));
    },
    status: async (req: IncomingMessage & { body?: any }, res: ServerResponse) => {
      calls.push({
        target: 'status',
        method: req.method,
        url: req.url,
        auth: String(req.headers.authorization || ''),
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: 'status' }));
    },
    history: async (req: IncomingMessage & { body?: any }, res: ServerResponse) => {
      calls.push({
        target: 'history',
        method: req.method,
        url: req.url,
        auth: String(req.headers.authorization || ''),
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: 'history' }));
    },
  };

  // Via rewrite Vercel (?__action=...) + preservação de query string e body
  const rCreate = createMockRes();
  await handleSubscriptionsRoute(
    createMockReq({
      method: 'POST',
      url: '/api/subscriptions?__action=create',
      headers: { authorization: 'Bearer tok_1' },
      body: { cpfCnpj: '12345678909', name: 'Aluno Teste' },
    }),
    rCreate.res,
    mockDeps
  );
  assert.equal(rCreate.getStatus(), 200);
  assert.deepEqual(rCreate.getJson(), { ok: 'create' });

  const rStatus = createMockRes();
  await handleSubscriptionsRoute(
    createMockReq({
      method: 'GET',
      url: '/api/subscriptions?__action=status',
      headers: { authorization: 'Bearer tok_2' },
    }),
    rStatus.res,
    mockDeps
  );
  assert.equal(rStatus.getStatus(), 200);
  assert.deepEqual(rStatus.getJson(), { ok: 'status' });

  const rHistory = createMockRes();
  await handleSubscriptionsRoute(
    createMockReq({
      method: 'GET',
      url: '/api/subscriptions?__action=history&page=2&limit=5',
      headers: { authorization: 'Bearer tok_3' },
    }),
    rHistory.res,
    mockDeps
  );
  assert.equal(rHistory.getStatus(), 200);
  assert.deepEqual(rHistory.getJson(), { ok: 'history' });

  // Via caminhos diretos (server.ts)
  assert.equal(resolveSubscriptionAction(createMockReq({ url: '/api/create-subscription' })), 'create');
  assert.equal(resolveSubscriptionAction(createMockReq({ url: '/api/subscription-status' })), 'status');
  assert.equal(
    resolveSubscriptionAction(createMockReq({ url: '/api/subscription-history?page=1&limit=10' })),
    'history'
  );
  assert.equal(resolveSubscriptionAction(createMockReq({ url: '/api/subscriptions' })), null);
  assert.equal(resolveSubscriptionAction(createMockReq({ url: '/api/subscriptions?__action=unknown' })), null);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].auth, 'Bearer tok_1');
  assert.deepEqual(calls[0].body, { cpfCnpj: '12345678909', name: 'Aluno Teste' });
  assert.equal(calls[2].url, '/api/subscriptions?__action=history&page=2&limit=5');

  // Rota desconhecida retorna 404
  const rNotFound = createMockRes();
  await subscriptionsHandler(createMockReq({ method: 'GET', url: '/api/subscriptions?__action=invalid' }), rNotFound.res);
  assert.equal(rNotFound.getStatus(), 404);

  // Handlers reais preservam restrições de método HTTP (405)
  const rCreateGet = createMockRes();
  await subscriptionsHandler(createMockReq({ method: 'GET', url: '/api/subscriptions?__action=create' }), rCreateGet.res);
  assert.equal(rCreateGet.getStatus(), 405);

  const rStatusPost = createMockRes();
  await subscriptionsHandler(createMockReq({ method: 'POST', url: '/api/subscriptions?__action=status' }), rStatusPost.res);
  assert.equal(rStatusPost.getStatus(), 405);

  const rHistoryPost = createMockRes();
  await subscriptionsHandler(createMockReq({ method: 'POST', url: '/api/subscriptions?__action=history' }), rHistoryPost.res);
  assert.equal(rHistoryPost.getStatus(), 405);
});

test('4. Roteador api/content.ts despacha materials e briefs preservando métodos HTTP e rejeitando recursos inválidos', async () => {
  const dispatched: string[] = [];
  const mockDeps = {
    materials: async (_req: IncomingMessage, res: ServerResponse) => {
      dispatched.push('materials');
      res.statusCode = 200;
      res.end(JSON.stringify({ resource: 'materials' }));
    },
    briefs: async (_req: IncomingMessage, res: ServerResponse) => {
      dispatched.push('briefs');
      res.statusCode = 200;
      res.end(JSON.stringify({ resource: 'briefs' }));
    },
  };

  const rMat = createMockRes();
  await handleContentRoute(
    createMockReq({ method: 'GET', url: '/api/content?__resource=materials' }),
    rMat.res,
    mockDeps
  );
  assert.equal(rMat.getStatus(), 200);
  assert.deepEqual(rMat.getJson(), { resource: 'materials' });

  const rBrief = createMockRes();
  await handleContentRoute(
    createMockReq({ method: 'GET', url: '/api/briefs' }),
    rBrief.res,
    mockDeps
  );
  assert.equal(rBrief.getStatus(), 200);
  assert.deepEqual(rBrief.getJson(), { resource: 'briefs' });

  assert.deepEqual(dispatched, ['materials', 'briefs']);
  assert.equal(resolveContentResource(createMockReq({ url: '/api/materials' })), 'materials');
  assert.equal(resolveContentResource(createMockReq({ url: '/api/content?__resource=briefs' })), 'briefs');
  assert.equal(resolveContentResource(createMockReq({ url: '/api/content?__resource=other' })), null);

  // Recurso inválido -> 404
  const r404 = createMockRes();
  await contentHandler(createMockReq({ method: 'GET', url: '/api/content' }), r404.res);
  assert.equal(r404.getStatus(), 404);

  // Handlers reais rejeitam métodos diferentes de GET com 405
  const rMatPost = createMockRes();
  await contentHandler(createMockReq({ method: 'POST', url: '/api/content?__resource=materials' }), rMatPost.res);
  assert.equal(rMatPost.getStatus(), 405);

  const rBriefPost = createMockRes();
  await contentHandler(createMockReq({ method: 'POST', url: '/api/content?__resource=briefs' }), rBriefPost.res);
  assert.equal(rBriefPost.getStatus(), 405);
});

test('5. Roteador api/leaderboard.ts preserva separação entre ranking do aluno e recuperação administrativa protegida por segredo', async () => {
  const dispatched: Array<{ target: string; url?: string; secret?: string }> = [];
  const mockDeps = {
    leaderboard: async (req: IncomingMessage, res: ServerResponse) => {
      dispatched.push({ target: 'leaderboard', url: req.url });
      res.statusCode = 200;
      res.end(JSON.stringify({ target: 'leaderboard' }));
    },
    recover: async (req: IncomingMessage, res: ServerResponse) => {
      dispatched.push({
        target: 'recover',
        url: req.url,
        secret: String(req.headers['x-leaderboard-admin-secret'] || ''),
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ target: 'recover' }));
    },
  };

  const rGetLb = createMockRes();
  await handleLeaderboardRoute(
    createMockReq({ method: 'GET', url: '/api/leaderboard?limit=20' }),
    rGetLb.res,
    mockDeps
  );
  assert.equal(rGetLb.getStatus(), 200);
  assert.deepEqual(rGetLb.getJson(), { target: 'leaderboard' });

  const rRecoverRewrite = createMockRes();
  await handleLeaderboardRoute(
    createMockReq({
      method: 'POST',
      url: '/api/leaderboard?__action=recover&includeFailed=true&pageSize=25',
      headers: { 'x-leaderboard-admin-secret': 'super-secret-admin-key-123456' },
      body: { reconcileMissing: true },
    }),
    rRecoverRewrite.res,
    mockDeps
  );
  assert.equal(rRecoverRewrite.getStatus(), 200);
  assert.deepEqual(rRecoverRewrite.getJson(), { target: 'recover' });
  assert.equal(dispatched[1].secret, 'super-secret-admin-key-123456');

  assert.equal(resolveLeaderboardTarget(createMockReq({ url: '/api/leaderboard' })), 'leaderboard');
  assert.equal(resolveLeaderboardTarget(createMockReq({ url: '/api/leaderboard-recover' })), 'recover');
  assert.equal(resolveLeaderboardTarget(createMockReq({ url: '/api/leaderboard?__action=recover' })), 'recover');
  assert.equal(resolveLeaderboardTarget(createMockReq({ url: '/api/leaderboard?__action=unknown' })), null);

  // Ação inválida -> 404
  const rInvalidAction = createMockRes();
  await leaderboardRouterHandler(
    createMockReq({ method: 'GET', url: '/api/leaderboard?__action=unknown' }),
    rInvalidAction.res
  );
  assert.equal(rInvalidAction.getStatus(), 404);

  // Handlers reais: /api/leaderboard bloqueia POST (somente leitura)
  const rLbPost = createMockRes();
  await leaderboardRouterHandler(
    createMockReq({ method: 'POST', url: '/api/leaderboard' }),
    rLbPost.res
  );
  assert.equal(rLbPost.getStatus(), 405);

  // Handlers reais: /api/leaderboard?__action=recover bloqueia métodos inválidos (DELETE -> 405)
  // e bloqueia chamadas sem segredo (GET de cron sem segredo -> 401, POST de aluno com token Firebase -> 401)
  await withEnv(
    {
      VERCEL_ENV: 'production',
      LEADERBOARD_ADMIN_SECRET: 'prod_admin_secret_at_least_24_chars',
      CRON_SECRET: undefined,
    },
    async () => {
      const rRecDelete = createMockRes();
      await leaderboardRouterHandler(
        createMockReq({ method: 'DELETE', url: '/api/leaderboard?__action=recover' }),
        rRecDelete.res
      );
      assert.equal(rRecDelete.getStatus(), 405);

      const rRecGetNoSecret = createMockRes();
      await leaderboardRouterHandler(
        createMockReq({ method: 'GET', url: '/api/leaderboard?__action=recover' }),
        rRecGetNoSecret.res
      );
      assert.equal(rRecGetNoSecret.getStatus(), 401);

      const rRecStudentBearer = createMockRes();
      await leaderboardRouterHandler(
        createMockReq({
          method: 'POST',
          url: '/api/leaderboard?__action=recover',
          headers: { authorization: 'Bearer fake_student_firebase_jwt' },
        }),
        rRecStudentBearer.res
      );
      assert.equal(rRecStudentBearer.getStatus(), 401);

      const rRecDirectPathNoSecret = createMockRes();
      await leaderboardRouterHandler(
        createMockReq({ method: 'POST', url: '/api/leaderboard-recover' }),
        rRecDirectPathNoSecret.res
      );
      assert.equal(rRecDirectPathNoSecret.getStatus(), 401);
    }
  );
});

test('6. Webhook oficial /api/webhook-asaas mantém proteção (405 GET, 401 token inválido, 403 Preview)', async () => {
  await withEnv(
    {
      VERCEL_ENV: 'preview',
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: '$aact_hmlg_test_key',
      ASAAS_WEBHOOK_TOKEN: 'whsec_prod_secret_token',
    },
    async () => {
      const rGet = createMockRes();
      await webhookAsaasHandler(createMockReq({ method: 'GET', url: '/api/webhook-asaas' }), rGet.res);
      assert.equal(rGet.getStatus(), 405);

      const rBadToken = createMockRes();
      await webhookAsaasHandler(
        createMockReq({
          method: 'POST',
          url: '/api/webhook-asaas',
          headers: { 'asaas-access-token': 'wrong_token' },
          body: {},
        }),
        rBadToken.res
      );
      assert.equal(rBadToken.getStatus(), 401);

      const rPreview = createMockRes();
      await webhookAsaasHandler(
        createMockReq({
          method: 'POST',
          url: '/api/webhook-asaas',
          headers: { 'asaas-access-token': 'whsec_prod_secret_token' },
          body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } },
        }),
        rPreview.res
      );
      assert.equal(rPreview.getStatus(), 403);
      assert.equal(rPreview.getJson().blocked, true);
    }
  );
});

test('7. Professor Virtual IA permanece dedicado com retry, fallback gemini-3.5-flash-lite, ThinkingLevel.MINIMAL e orçamento total de 18s', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(DEFAULT_FALLBACK_GEMINI_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(GEMINI_REQUEST_TIMEOUT_MS, 18_000);
  assert.deepEqual(buildThinkingConfigForModel('gemini-3.5-flash-lite'), {
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
});
