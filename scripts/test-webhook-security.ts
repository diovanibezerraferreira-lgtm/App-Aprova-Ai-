import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getAsaasConfig, asaasFetch } from '../api/_asaas.ts';
import webhookAsaasHandler from '../api/webhook-asaas.ts';
import webhookBasicsHandler, { handleWebhook, type WebhookDeps } from '../api/webhook-basics.ts';
import {
  getFirebaseAdminDiagnostics,
  getProductionFirebaseIdentifiers,
  isUsingProductionFirestore,
  isPreviewSharingProductionFirestore,
} from '../api/_firebaseAdmin.ts';
import {
  handleCreateSubscription,
  type CreateSubscriptionDeps,
} from '../api/create-subscription.ts';
import {
  handleSubscriptionStatus,
  type SubscriptionStatusDeps,
} from '../api/subscription-status.ts';
import {
  resolveAccessContext,
  getDailyQuotaStatus,
  consumeQuestionQuota,
  consumeSimuladoQuota,
  saveSimuladoSession,
  getSimuladoSession,
} from '../api/_accessControl.ts';
import questionsHandler from '../api/questions.ts';
import simuladosHandler from '../api/simulados.ts';
import materialsHandler from '../api/materials.ts';
import briefsHandler from '../api/briefs.ts';

const PROD_PROJECT_ID = 'gen-lang-client-0793753103';
const PROD_DATABASE_ID = 'ai-studio-aprovadireito-858e292a-4f1d-4483-a130-1a8041386c5a';

function createMockReq(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}): IncomingMessage & { body?: any } {
  const req = new EventEmitter() as IncomingMessage & { body?: any; readableEnded?: boolean };
  req.method = options.method || 'POST';
  if (options.url) req.url = options.url;
  req.headers = options.headers || {};
  req.body = options.body;
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
    set statusCode(val: number) {
      statusCode = val;
    },
    setHeader(name: string, val: string) {
      headers[name.toLowerCase()] = val;
    },
    end(chunk?: any) {
      if (chunk) body += String(chunk);
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => statusCode,
    getJson: () => (body ? JSON.parse(body) : null),
  };
}

function createMemoryFirestore(initialUsers: Record<string, any> = {}) {
  const collections = new Map<string, Map<string, any>>();
  collections.set('users', new Map(Object.entries(initialUsers)));
  collections.set('processed_webhook_events', new Map());

  const makeDocRef = (colName: string, docId: string) => ({
    __col: colName,
    id: docId,
    async get() {
      const col = collections.get(colName);
      const data = col?.get(docId);
      return {
        exists: data !== undefined,
        id: docId,
        data: () => (data ? { ...data } : undefined),
      };
    },
    async set(data: any, opts?: { merge?: boolean }) {
      let col = collections.get(colName);
      if (!col) {
        col = new Map();
        collections.set(colName, col);
      }
      const prev = opts?.merge ? col.get(docId) || {} : {};
      col.set(docId, { ...prev, ...data });
    },
  });

  const db = {
    collection(colName: string) {
      return {
        doc: (docId: string) => makeDocRef(colName, docId),
        where(field: string, _op: string, value: any) {
          return {
            limit: () => ({
              async get() {
                const col = collections.get(colName) || new Map();
                for (const [id, data] of col.entries()) {
                  if (data?.[field] === value) {
                    return {
                      empty: false,
                      docs: [{ id, data: () => ({ ...data }) }],
                    };
                  }
                }
                return { empty: true, docs: [] };
              },
            }),
          };
        },
      };
    },
    async runTransaction(fn: (tx: any) => Promise<void>) {
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: any, opts?: { merge?: boolean }) => ref.set(data, opts),
      };
      await fn(tx);
    },
  };

  return {
    db: db as any,
    getUser: (uid: string) => collections.get('users')?.get(uid),
    getEventsCount: () => collections.get('processed_webhook_events')?.size || 0,
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const backup: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    backup[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(backup)) {
        if (backup[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = backup[key];
        }
      }
    });
}

test('api/_asaas.ts compara VERCEL_ENV e ASAAS_ENVIRONMENT com valores literais exatos', async () => {
  // Produção válida com valores literais exatos
  await withEnv(
    {
      VERCEL_ENV: 'production',
      ASAAS_ENVIRONMENT: 'production',
      ASAAS_API_KEY: '$aact_prod_00000000000000000000',
    },
    () => {
      const cfg = getAsaasConfig();
      assert.equal(cfg.vercelEnv, 'production');
      assert.equal(cfg.rawEnvExact, 'production');
      assert.equal(cfg.isProduction, true);
      assert.equal(cfg.envError, null);
      assert.equal(cfg.envMismatch, false);
      assert.equal(cfg.baseUrl, 'https://api.asaas.com/v3');
    }
  );

  // Sandbox válido com valor literal exato 'sandbox'
  await withEnv(
    {
      VERCEL_ENV: 'preview',
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: '$aact_hmlg_sandboxkey123456',
    },
    () => {
      const cfg = getAsaasConfig();
      assert.equal(cfg.vercelEnv, 'preview');
      assert.equal(cfg.rawEnvExact, 'sandbox');
      assert.equal(cfg.isProduction, false);
      assert.equal(cfg.envError, null);
      assert.equal(cfg.envMismatch, false);
      assert.equal(cfg.baseUrl, 'https://api-sandbox.asaas.com/v3');
    }
  );

  // Em VERCEL_ENV='production', exige exatamente ASAAS_ENVIRONMENT='production' (sem traduzir 'PRODUCTION' ou 'prod')
  for (const badEnv of ['sandbox', 'PRODUCTION', 'prod', 'PREVIEW', '']) {
    await withEnv(
      {
        VERCEL_ENV: 'production',
        ASAAS_ENVIRONMENT: badEnv,
        ASAAS_API_KEY: '$aact_prod_00000000000000000000',
      },
      async () => {
        const cfg = getAsaasConfig();
        assert.equal(cfg.isProduction, false);
        assert.ok(cfg.envError, `Esperado erro para ASAAS_ENVIRONMENT="${badEnv}"`);
        await assert.rejects(() => asaasFetch('/customers?limit=1'));
      }
    );
  }

  // Rejeita VERCEL_ENV='PRODUCTION' com case errado se tentar rodar sandbox/inconsistente e rejeita chave sandbox com ASAAS_ENVIRONMENT='production'
  await withEnv(
    {
      VERCEL_ENV: 'production',
      ASAAS_ENVIRONMENT: 'production',
      ASAAS_API_KEY: '$aact_hmlg_sandboxkey123456',
    },
    async () => {
      const cfg = getAsaasConfig();
      assert.equal(cfg.envMismatch, true);
      await assert.rejects(() => asaasFetch('/customers?limit=1'), /Incompatibilidade de ambiente/);
    }
  );
});

test('Rota pública /api/webhook-asaas encaminha ao manipulador único api/webhook-basics.ts e protege corretamente', async () => {
  // Verifica wiring no vercel.json e server.ts e delegação de api/webhook-asaas.ts -> api/webhook-basics.ts
  const vercelJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'vercel.json'), 'utf-8'));
  const rewriteSource = String(vercelJson?.rewrites?.[0]?.source || '');
  assert.ok(rewriteSource.includes('api/'), 'vercel.json deve excluir api/ do rewrite para index.html');

  const serverTs = readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');
  assert.ok(serverTs.includes("app.all('/api/webhook-asaas'"), 'server.ts deve montar /api/webhook-asaas');
  assert.ok(
    serverTs.includes("import('./api/webhook-asaas.js')"),
    'server.ts deve encaminhar /api/webhook-asaas para ./api/webhook-asaas.js'
  );

  const webhookAsaasSrc = readFileSync(
    path.resolve(process.cwd(), 'api/webhook-asaas.ts'),
    'utf-8'
  );
  const webhookBasicsSrc = readFileSync(
    path.resolve(process.cwd(), 'api/webhook-basics.ts'),
    'utf-8'
  );

  assert.ok(
    webhookAsaasSrc.includes("from './webhook-basics.js'"),
    'api/webhook-asaas.ts deve delegar para ./webhook-basics.js sem duplicar implementação'
  );
  assert.ok(
    webhookAsaasSrc.includes('return webhookBasicsHandler(req, res)'),
    'api/webhook-asaas.ts deve encaminhar req e res sem alterar o conteúdo'
  );
  assert.ok(
    !webhookAsaasSrc.includes('webhook-asaas'),
    'api/webhook-asaas.ts não pode conter autorreferência'
  );
  assert.ok(
    !webhookBasicsSrc.includes('webhook-asaas') && !webhookBasicsSrc.includes('webhook-basics'),
    'api/webhook-basics.ts não pode conter importação circular ou autorreferência'
  );

  // Verifica ambos os entrypoints (webhook-asaas.ts e webhook-basics.ts) respondendo 405, 401 e 403 em VERCEL_ENV='preview'
  await withEnv(
    {
      VERCEL_ENV: 'preview',
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: '$aact_hmlg_sandboxkey123456',
      ASAAS_WEBHOOK_TOKEN: 'whsec_test_123',
    },
    async () => {
      const resGet = createMockRes();
      await webhookAsaasHandler(createMockReq({ method: 'GET' }), resGet.res);
      assert.equal(resGet.getStatus(), 405);

      const resBadToken = createMockRes();
      await webhookAsaasHandler(
        createMockReq({
          method: 'POST',
          headers: { 'asaas-access-token': 'token_errado' },
          body: {},
        }),
        resBadToken.res
      );
      assert.equal(resBadToken.getStatus(), 401);

      const forwardedBody = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_sbx' } };
      const forwardedReq = createMockReq({
        method: 'POST',
        headers: { 'asaas-access-token': 'whsec_test_123' },
        body: forwardedBody,
      });
      const resPreviewAsaas = createMockRes();
      await webhookAsaasHandler(forwardedReq, resPreviewAsaas.res);
      assert.equal(resPreviewAsaas.getStatus(), 403);
      assert.equal(resPreviewAsaas.getJson().blocked, true);
      assert.deepEqual(forwardedReq.body, { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_sbx' } });

      const resPreviewBasics = createMockRes();
      await webhookBasicsHandler(
        createMockReq({
          method: 'POST',
          headers: { 'asaas-access-token': 'whsec_test_123' },
          body: { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_sbx' } },
        }),
        resPreviewBasics.res
      );
      assert.equal(resPreviewBasics.getStatus(), 403);
      assert.equal(resPreviewBasics.getJson().blocked, true);
    }
  );
});

test('VERCEL_ENV === "preview" compartilhando Firestore de produção bloqueia webhooks (403) sem alterar usuários', async () => {
  const store = createMemoryFirestore({
    uid_real: { email: 'real@teste.com', isPremium: false, plan: 'gratuito' },
  });

  const deps: WebhookDeps = {
    getAdminFirestore: () => store.db,
    getFirebaseAdminDiagnostics: () => ({
      projectId: PROD_PROJECT_ID,
      databaseId: PROD_DATABASE_ID,
      hasServiceAccountJson: true,
      hasClientEmail: true,
      hasPrivateKey: true,
      isVercel: true,
      lastAdminInitError: null,
    }),
    getAsaasConfig,
    asaasFetch,
    fetchAsaasPaymentById: async () => {
      throw new Error('Não deve consultar API quando Preview está bloqueado');
    },
    fetchAsaasSubscriptionById: async () => {
      throw new Error('Não deve consultar API quando Preview está bloqueado');
    },
  };

  await withEnv(
    {
      VERCEL_ENV: 'preview',
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: '$aact_hmlg_sandboxkey123456',
      ASAAS_WEBHOOK_TOKEN: 'whsec_test_123',
    },
    async () => {
      const req = createMockReq({
        headers: { 'asaas-access-token': 'whsec_test_123' },
        body: {
          id: 'evt_preview_1',
          event: 'PAYMENT_RECEIVED',
          payment: {
            id: 'pay_sandbox_1',
            customer: 'cus_sbx_1',
            status: 'RECEIVED',
            externalReference: 'uid_real',
          },
        },
      });
      const mock = createMockRes();
      await handleWebhook(req, mock.res, deps);

      assert.equal(mock.getStatus(), 403);
      assert.equal(mock.getJson().blocked, true);
      assert.equal(store.getUser('uid_real').isPremium, false);
      assert.equal(store.getEventsCount(), 0);
    }
  );
});

test('Em Produção, consulta GET https://api.asaas.com/v3/payments/{id} com fetch real e rejeita pagamento Sandbox (404 -> 403)', async () => {
  const store = createMemoryFirestore({
    uid_real: { email: 'real@teste.com', isPremium: false, plan: 'gratuito' },
  });

  const capturedRequests: Array<{ url: string; method: string; accessToken: string }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    capturedRequests.push({
      url,
      method: String(init?.method || 'GET'),
      accessToken: String(headers.access_token || ''),
    });

    if (url.endsWith('/payments/pay_sandbox_fake_in_prod')) {
      return new Response(
        JSON.stringify({ errors: [{ description: 'Cobrança não encontrada.' }] }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        id: 'pay_prod_real_confirmed',
        customer: 'cus_prod_1',
        subscription: 'sub_prod_1',
        value: 29.9,
        status: 'CONFIRMED',
        billingType: 'PIX',
        dueDate: '2026-11-20',
        externalReference: 'uid_real',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    await withEnv(
      {
        VERCEL_ENV: 'production',
        ASAAS_ENVIRONMENT: 'production',
        ASAAS_API_KEY: '$aact_prod_realkey123456',
        ASAAS_WEBHOOK_TOKEN: 'whsec_prod_secret',
      },
      async () => {
        const deps: WebhookDeps = {
          getAdminFirestore: () => store.db,
          getFirebaseAdminDiagnostics: () => ({
            projectId: PROD_PROJECT_ID,
            databaseId: PROD_DATABASE_ID,
            hasServiceAccountJson: true,
            hasClientEmail: true,
            hasPrivateKey: true,
            isVercel: true,
            lastAdminInitError: null,
          }),
          getAsaasConfig,
          asaasFetch,
          // Usa as funções reais do api/_asaas.ts que disparam globalThis.fetch!
          fetchAsaasPaymentById: async (id) =>
            (await import('../api/_asaas.ts')).fetchAsaasPaymentById(id),
          fetchAsaasSubscriptionById: async (id) =>
            (await import('../api/_asaas.ts')).fetchAsaasSubscriptionById(id),
        };

        // 1) ID de pagamento Sandbox -> API de Produção retorna 404 -> Webhook bloqueia com 403
        const resSandbox = createMockRes();
        await handleWebhook(
          createMockReq({
            headers: { 'asaas-access-token': 'whsec_prod_secret' },
            body: {
              id: 'evt_spoof_1',
              event: 'PAYMENT_RECEIVED',
              payment: {
                id: 'pay_sandbox_fake_in_prod',
                status: 'RECEIVED',
                externalReference: 'uid_real',
              },
            },
          }),
          resSandbox.res,
          deps
        );

        assert.equal(resSandbox.getStatus(), 403);
        assert.equal(store.getUser('uid_real').isPremium, false);
        assert.equal(
          capturedRequests[0].url,
          'https://api.asaas.com/v3/payments/pay_sandbox_fake_in_prod'
        );
        assert.equal(capturedRequests[0].method, 'GET');
        assert.equal(capturedRequests[0].accessToken, '$aact_prod_realkey123456');

        // 2) Pagamento real CONFIRMED na API de Produção -> Ativa Premium corretamente
        const resReal = createMockRes();
        await handleWebhook(
          createMockReq({
            headers: { 'asaas-access-token': 'whsec_prod_secret' },
            body: {
              id: 'evt_prod_ok',
              event: 'PAYMENT_CONFIRMED',
              payment: {
                id: 'pay_prod_real_confirmed',
                status: 'CONFIRMED',
              },
            },
          }),
          resReal.res,
          deps
        );

        assert.equal(resReal.getStatus(), 200);
        assert.equal(resReal.getJson().actionTaken, 'premium_activated');
        assert.equal(store.getUser('uid_real').isPremium, true);
        assert.equal(store.getUser('uid_real').subscriptionStatus, 'ACTIVE');
        assert.equal(
          capturedRequests[1].url,
          'https://api.asaas.com/v3/payments/pay_prod_real_confirmed'
        );
        assert.equal(capturedRequests[1].method, 'GET');
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Em Produção, status PENDING na API não libera Premium mesmo com payload adulterado', async () => {
  const store = createMemoryFirestore({
    uid_1: { email: 'aluno1@teste.com', isPremium: false, plan: 'gratuito' },
  });

  const deps: WebhookDeps = {
    getAdminFirestore: () => store.db,
    getFirebaseAdminDiagnostics: () => ({
      projectId: PROD_PROJECT_ID,
      databaseId: PROD_DATABASE_ID,
      hasServiceAccountJson: true,
      hasClientEmail: true,
      hasPrivateKey: true,
      isVercel: true,
      lastAdminInitError: null,
    }),
    getAsaasConfig,
    asaasFetch,
    fetchAsaasPaymentById: async () => ({
      id: 'pay_prod_pending',
      customer: 'cus_prod_1',
      subscription: 'sub_prod_1',
      value: 29.9,
      status: 'PENDING',
      billingType: 'PIX',
      dueDate: '2026-11-20',
      externalReference: 'uid_1',
    }),
    fetchAsaasSubscriptionById: async () => {
      throw new Error('unexpected');
    },
  };

  await withEnv(
    {
      VERCEL_ENV: 'production',
      ASAAS_ENVIRONMENT: 'production',
      ASAAS_API_KEY: '$aact_prod_realkey123456',
      ASAAS_WEBHOOK_TOKEN: 'whsec_prod_secret',
    },
    async () => {
      const res1 = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_pending_spoof',
            event: 'PAYMENT_CONFIRMED',
            payment: {
              id: 'pay_prod_pending',
              status: 'CONFIRMED',
              externalReference: 'uid_1',
            },
          },
        }),
        res1.res,
        deps
      );

      assert.equal(res1.getStatus(), 200);
      assert.equal(res1.getJson().userUpdated, false);
      assert.equal(store.getUser('uid_1').isPremium, false);
    }
  );
});

test('Em Produção, preserva estornos, chargebacks, inadimplência e cancelamentos verificados, bloqueando eventos de outro ambiente ou obsoletos', async () => {
  const store = createMemoryFirestore({
    uid_sub_active: {
      email: 'ativo@teste.com',
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'ACTIVE',
      subscriptionId: 'sub_real_current',
      asaasCustomerId: 'cus_real_1',
    },
  });

  let paymentHandler: (id: string) => Promise<any> = async () => {
    const err: any = new Error('404');
    err.status = 404;
    throw err;
  };
  let subHandler: (id: string) => Promise<any> = async () => {
    const err: any = new Error('404');
    err.status = 404;
    throw err;
  };

  const deps: WebhookDeps = {
    getAdminFirestore: () => store.db,
    getFirebaseAdminDiagnostics: () => ({
      projectId: PROD_PROJECT_ID,
      databaseId: PROD_DATABASE_ID,
      hasServiceAccountJson: true,
      hasClientEmail: true,
      hasPrivateKey: true,
      isVercel: true,
      lastAdminInitError: null,
    }),
    getAsaasConfig,
    asaasFetch,
    fetchAsaasPaymentById: (id) => paymentHandler(id),
    fetchAsaasSubscriptionById: (id) => subHandler(id),
  };

  await withEnv(
    {
      VERCEL_ENV: 'production',
      ASAAS_ENVIRONMENT: 'production',
      ASAAS_API_KEY: '$aact_prod_realkey123456',
      ASAAS_WEBHOOK_TOKEN: 'whsec_prod_secret',
    },
    async () => {
      // 1) Estorno Sandbox (404 na API de Produção) bloqueado com 403
      const resSandboxRefund = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_sbx_refund',
            event: 'PAYMENT_REFUNDED',
            payment: {
              id: 'pay_sbx_refund',
              customer: 'cus_real_1',
              subscription: 'sub_real_current',
              externalReference: 'uid_sub_active',
            },
          },
        }),
        resSandboxRefund.res,
        deps
      );
      assert.equal(resSandboxRefund.getStatus(), 403);
      assert.equal(store.getUser('uid_sub_active').isPremium, true);

      // 2) OVERDUE de assinatura obsoleta não derruba assinatura ACTIVE mais nova
      paymentHandler = async () => ({
        id: 'pay_prod_old_overdue',
        customer: 'cus_real_1',
        subscription: 'sub_old_abandoned',
        status: 'OVERDUE',
        value: 29.9,
        billingType: 'BOLETO',
        dueDate: '2026-10-01',
        externalReference: 'uid_sub_active',
      });
      const resStaleOverdue = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_stale_overdue',
            event: 'PAYMENT_OVERDUE',
            payment: { id: 'pay_prod_old_overdue' },
          },
        }),
        resStaleOverdue.res,
        deps
      );
      assert.equal(resStaleOverdue.getStatus(), 200);
      assert.equal(resStaleOverdue.getJson().actionTaken, 'ignored_stale_subscription_overdue');
      assert.equal(store.getUser('uid_sub_active').isPremium, true);

      // 3) PAYMENT_OVERDUE real verificado marca OVERDUE
      paymentHandler = async () => ({
        id: 'pay_prod_real_overdue',
        customer: 'cus_real_1',
        subscription: 'sub_real_current',
        status: 'OVERDUE',
        value: 29.9,
        billingType: 'PIX',
        dueDate: '2026-11-15',
        externalReference: 'uid_sub_active',
      });
      const resOverdue = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_real_overdue',
            event: 'PAYMENT_OVERDUE',
            payment: { id: 'pay_prod_real_overdue' },
          },
        }),
        resOverdue.res,
        deps
      );
      assert.equal(resOverdue.getStatus(), 200);
      assert.equal(resOverdue.getJson().actionTaken, 'subscription_overdue');
      assert.equal(store.getUser('uid_sub_active').isPremium, false);
      assert.equal(store.getUser('uid_sub_active').subscriptionStatus, 'OVERDUE');

      await store.db.collection('users').doc('uid_sub_active').set(
        { isPremium: true, plan: 'premium', subscriptionStatus: 'ACTIVE' },
        { merge: true }
      );

      // 4) PAYMENT_CHARGEBACK_REQUESTED real verificado cancela
      paymentHandler = async () => ({
        id: 'pay_prod_cb',
        customer: 'cus_real_1',
        subscription: 'sub_real_current',
        status: 'CHARGEBACK_REQUESTED',
        value: 29.9,
        billingType: 'CREDIT_CARD',
        dueDate: '2026-11-15',
        externalReference: 'uid_sub_active',
      });
      const resChargeback = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_real_cb',
            event: 'PAYMENT_CHARGEBACK_REQUESTED',
            payment: { id: 'pay_prod_cb' },
          },
        }),
        resChargeback.res,
        deps
      );
      assert.equal(resChargeback.getStatus(), 200);
      assert.equal(resChargeback.getJson().actionTaken, 'subscription_cancelled');
      assert.equal(store.getUser('uid_sub_active').isPremium, false);
      assert.equal(store.getUser('uid_sub_active').subscriptionStatus, 'CANCELLED');

      await store.db.collection('users').doc('uid_sub_active').set(
        { isPremium: true, plan: 'premium', subscriptionStatus: 'ACTIVE' },
        { merge: true }
      );

      // 5) SUBSCRIPTION_INACTIVATED real verificado cancela
      subHandler = async () => ({
        id: 'sub_real_current',
        customer: 'cus_real_1',
        value: 29.9,
        nextDueDate: '2026-12-15',
        cycle: 'MONTHLY',
        billingType: 'UNDEFINED',
        status: 'INACTIVE',
        deleted: true,
        externalReference: 'uid_sub_active',
      });
      const resSubInact = createMockRes();
      await handleWebhook(
        createMockReq({
          headers: { 'asaas-access-token': 'whsec_prod_secret' },
          body: {
            id: 'evt_sub_inact',
            event: 'SUBSCRIPTION_INACTIVATED',
            subscription: { id: 'sub_real_current' },
          },
        }),
        resSubInact.res,
        deps
      );
      assert.equal(resSubInact.getStatus(), 200);
      assert.equal(resSubInact.getJson().actionTaken, 'subscription_cancelled');
      assert.equal(store.getUser('uid_sub_active').isPremium, false);
      assert.equal(store.getUser('uid_sub_active').subscriptionStatus, 'CANCELLED');
    }
  );
});

test('api/_firebaseAdmin.ts identifica Preview compartilhando Firestore de produção sem afetar Production, Development ou Preview isolado', async () => {
  const prodIds = getProductionFirebaseIdentifiers();
  assert.equal(prodIds.projectId, PROD_PROJECT_ID);
  assert.equal(prodIds.databaseId, PROD_DATABASE_ID);

  await withEnv(
    {
      VERCEL_ENV: 'preview',
      FIREBASE_PROJECT_ID: undefined,
      FIRESTORE_DATABASE_ID: undefined,
    },
    () => {
      assert.equal(isUsingProductionFirestore(), true);
      assert.equal(isPreviewSharingProductionFirestore(), true);
    }
  );

  await withEnv(
    {
      VERCEL_ENV: 'preview',
      FIREBASE_PROJECT_ID: PROD_PROJECT_ID,
      FIRESTORE_DATABASE_ID: 'preview-homologacao-db',
    },
    () => {
      assert.equal(isUsingProductionFirestore(), false);
      assert.equal(isPreviewSharingProductionFirestore(), false);
    }
  );

  await withEnv(
    {
      VERCEL_ENV: 'production',
      FIREBASE_PROJECT_ID: undefined,
      FIRESTORE_DATABASE_ID: undefined,
    },
    () => {
      assert.equal(isUsingProductionFirestore(), true);
      assert.equal(isPreviewSharingProductionFirestore(), false);
    }
  );

  await withEnv(
    {
      VERCEL_ENV: undefined,
      FIREBASE_PROJECT_ID: undefined,
      FIRESTORE_DATABASE_ID: undefined,
    },
    () => {
      assert.equal(isUsingProductionFirestore(getFirebaseAdminDiagnostics()), true);
      assert.equal(isPreviewSharingProductionFirestore(), false);
    }
  );
});

test('Preview + Firestore de produção bloqueia create-subscription e subscription-status com HTTP 403 sem chamar Asaas nem gravar no Firestore', async () => {
  let asaasCalls = 0;
  let dbCalls = 0;
  let authCalls = 0;

  const blockedCreateDeps: CreateSubscriptionDeps = {
    isPreviewSharingProductionFirestore,
    verifyFirebaseUser: async () => {
      authCalls++;
      return { uid: 'uid_real', email: 'real@teste.com', name: 'Aluno Real' };
    },
    getAdminFirestore: () => {
      dbCalls++;
      throw new Error('Firestore não deve ser acessado quando Preview está bloqueado');
    },
    getAsaasConfig: () => {
      asaasCalls++;
      return getAsaasConfig();
    },
    getOrCreateCustomer: async () => {
      asaasCalls++;
      throw new Error('Asaas não deve ser chamado quando Preview está bloqueado');
    },
    createMonthlySubscription: async () => {
      asaasCalls++;
      throw new Error('Asaas não deve ser chamado quando Preview está bloqueado');
    },
    getSubscriptionPendingCheckoutUrl: async () => {
      asaasCalls++;
      return null;
    },
  };

  const blockedStatusDeps: SubscriptionStatusDeps = {
    isPreviewSharingProductionFirestore,
    verifyFirebaseUser: async () => {
      authCalls++;
      return { uid: 'uid_real', email: 'real@teste.com', name: 'Aluno Real' };
    },
    getAdminFirestore: () => {
      dbCalls++;
      throw new Error('Firestore não deve ser acessado quando Preview está bloqueado');
    },
    getAsaasConfig: () => {
      asaasCalls++;
      return getAsaasConfig();
    },
    asaasFetch: (async () => {
      asaasCalls++;
      throw new Error('Asaas não deve ser chamado quando Preview está bloqueado');
    }) as typeof asaasFetch,
  };

  await withEnv(
    {
      VERCEL_ENV: 'preview',
      FIREBASE_PROJECT_ID: undefined,
      FIRESTORE_DATABASE_ID: undefined,
      ASAAS_ENVIRONMENT: 'sandbox',
      ASAAS_API_KEY: '$aact_hmlg_sandboxkey123456',
    },
    async () => {
      const resCreate = createMockRes();
      await handleCreateSubscription(
        createMockReq({
          method: 'POST',
          headers: { authorization: 'Bearer fake_token' },
          body: { name: 'Aluno Real Teste', cpf: '12345678909' },
        }),
        resCreate.res,
        blockedCreateDeps
      );
      assert.equal(resCreate.getStatus(), 403);
      assert.equal(resCreate.getJson().blocked, true);

      const resStatus = createMockRes();
      await handleSubscriptionStatus(
        createMockReq({
          method: 'GET',
          headers: { authorization: 'Bearer fake_token' },
        }),
        resStatus.res,
        blockedStatusDeps
      );
      assert.equal(resStatus.getStatus(), 403);
      assert.equal(resStatus.getJson().blocked, true);

      assert.equal(asaasCalls, 0);
      assert.equal(dbCalls, 0);
      assert.equal(authCalls, 0);
    }
  );
});

test('Production e Development continuam operando normalmente em create-subscription e subscription-status', async () => {
  for (const vercelEnv of ['production', undefined]) {
    const store = createMemoryFirestore({
      uid_prod_user: {
        email: 'aluno@teste.com',
        name: 'Aluno Teste Silva',
        isPremium: false,
        subscriptionStatus: 'NONE',
      },
    });

    let createdSubCalls = 0;
    const createDeps: CreateSubscriptionDeps = {
      isPreviewSharingProductionFirestore,
      verifyFirebaseUser: async () => ({
        uid: 'uid_prod_user',
        email: 'aluno@teste.com',
        name: 'Aluno Teste Silva',
      }),
      getAdminFirestore: () => store.db,
      getAsaasConfig,
      getOrCreateCustomer: async ({ externalReference }) => ({
        id: 'cus_ok_1',
        name: 'Aluno Teste Silva',
        email: 'aluno@teste.com',
        externalReference,
      }),
      createMonthlySubscription: async ({ value }) => {
        createdSubCalls++;
        assert.equal(value, 29.9);
        return {
          subscription: { id: 'sub_ok_1', status: 'ACTIVE', value } as any,
          invoiceUrl: 'https://www.asaas.com/i/fatura_ok',
        };
      },
      getSubscriptionPendingCheckoutUrl: async () => null,
    };

    const statusDeps: SubscriptionStatusDeps = {
      isPreviewSharingProductionFirestore,
      verifyFirebaseUser: async () => ({
        uid: 'uid_prod_user',
        email: 'aluno@teste.com',
        name: 'Aluno Teste Silva',
      }),
      getAdminFirestore: () => store.db,
      getAsaasConfig,
      asaasFetch: (async (endpoint: string) => {
        if (endpoint.endsWith('/payments')) {
          return { data: [{ status: 'PENDING', invoiceUrl: 'https://www.asaas.com/i/fatura_ok' }] };
        }
        return { status: 'ACTIVE', nextDueDate: '2026-12-18', value: 29.9, billingType: 'PIX' };
      }) as typeof asaasFetch,
    };

    await withEnv(
      {
        VERCEL_ENV: vercelEnv,
        ASAAS_ENVIRONMENT: vercelEnv === 'production' ? 'production' : 'sandbox',
        ASAAS_API_KEY:
          vercelEnv === 'production'
            ? '$aact_prod_00000000000000000000'
            : '$aact_hmlg_sandboxkey123456',
      },
      async () => {
        const resCreate = createMockRes();
        await handleCreateSubscription(
          createMockReq({
            method: 'POST',
            headers: { authorization: 'Bearer valid_token' },
            body: { name: 'Aluno Teste Silva' },
          }),
          resCreate.res,
          createDeps
        );
        assert.equal(resCreate.getStatus(), 200);
        assert.equal(resCreate.getJson().checkoutUrl, 'https://www.asaas.com/i/fatura_ok');
        assert.equal(createdSubCalls, 1);
        assert.equal(store.getUser('uid_prod_user').subscriptionId, 'sub_ok_1');
        assert.equal(store.getUser('uid_prod_user').subscriptionStatus, 'PENDING');

        const resStatus = createMockRes();
        await handleSubscriptionStatus(
          createMockReq({
            method: 'GET',
            headers: { authorization: 'Bearer valid_token' },
          }),
          resStatus.res,
          statusDeps
        );
        assert.equal(resStatus.getStatus(), 200);
        assert.equal(resStatus.getJson().subscriptionId, 'sub_ok_1');
        assert.equal(resStatus.getJson().latestCheckoutUrl, 'https://www.asaas.com/i/fatura_ok');
      }
    );
  }
});

test('api/_accessControl.ts e endpoints Freemium retornam HTTP 403 no Preview + Firestore de produção sem usar fallback em memória e continuam funcionando em Production/Development', async () => {
  const sampleCtx = {
    isAuthenticated: false,
    uid: null,
    email: null,
    isPremium: false,
    subscriptionStatus: 'NONE' as const,
    dateKey: '2026-11-18',
    quotaKeys: ['2026-11-18_ip_test'],
    primaryQuotaKey: '2026-11-18_ip_test',
  };

  await withEnv(
    {
      VERCEL_ENV: 'preview',
      FIREBASE_PROJECT_ID: undefined,
      FIRESTORE_DATABASE_ID: undefined,
    },
    async () => {
      await assert.rejects(
        () => resolveAccessContext(createMockReq({ method: 'GET' }), createMockRes().res),
        (err: any) => err?.status === 403 && err?.blocked === true
      );
      await assert.rejects(
        () => getDailyQuotaStatus(sampleCtx),
        (err: any) => err?.status === 403 && err?.blocked === true
      );
      await assert.rejects(
        () => consumeQuestionQuota(sampleCtx, 'q_1'),
        (err: any) => err?.status === 403 && err?.blocked === true
      );
      await assert.rejects(
        () => consumeSimuladoQuota(sampleCtx),
        (err: any) => err?.status === 403 && err?.blocked === true
      );
      await assert.rejects(
        () =>
          saveSimuladoSession({
            id: 'sim_blocked',
            title: 'Blocked',
            ownerKey: '2026-11-18_ip_test',
            isPremium: false,
            questionIds: [],
            timeLimitMinutes: 15,
            createdAt: Date.now(),
          }),
        (err: any) => err?.status === 403 && err?.blocked === true
      );
      await assert.rejects(
        () => getSimuladoSession('sim_blocked'),
        (err: any) => err?.status === 403 && err?.blocked === true
      );

      for (const [handlerFn, url] of [
        [questionsHandler, '/api/questions'],
        [simuladosHandler, '/api/simulados'],
        [materialsHandler, '/api/materials'],
        [briefsHandler, '/api/briefs'],
      ] as const) {
        const res = createMockRes();
        await handlerFn(createMockReq({ method: 'GET', url }), res.res);
        assert.equal(res.getStatus(), 403, `${url} deve retornar 403 no Preview + Firestore de produção`);
      }
    }
  );

  for (const vercelEnv of ['production', undefined]) {
    await withEnv(
      {
        VERCEL_ENV: vercelEnv,
        FIREBASE_PROJECT_ID: undefined,
        FIRESTORE_DATABASE_ID: undefined,
      },
      async () => {
        const resQ = createMockRes();
        await questionsHandler(createMockReq({ method: 'GET', url: '/api/questions' }), resQ.res);
        assert.equal(resQ.getStatus(), 200);

        const resS = createMockRes();
        await simuladosHandler(createMockReq({ method: 'GET', url: '/api/simulados' }), resS.res);
        assert.equal(resS.getStatus(), 200);
      }
    );
  }
});
