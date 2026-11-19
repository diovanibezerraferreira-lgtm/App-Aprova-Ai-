import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handleSubscriptionHistory,
  type SubscriptionHistoryDeps,
} from '../api/subscription-history.ts';

function createMockReq(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & { readableEnded?: boolean };
  req.method = options.method || 'GET';
  req.url = options.url || '/api/subscription-history';
  req.headers = options.headers || {};
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

function createReadOnlyTrackingFirestore(initialUsers: Record<string, any> = {}) {
  const users = new Map<string, any>(Object.entries(initialUsers));
  let writeAttempts = 0;

  const db = {
    collection(colName: string) {
      return {
        doc(docId: string) {
          return {
            async get() {
              const data = colName === 'users' ? users.get(docId) : undefined;
              return {
                exists: data !== undefined,
                id: docId,
                data: () => (data ? { ...data } : undefined),
              };
            },
            async set() {
              writeAttempts += 1;
              throw new Error('Subscription history endpoint MUST NOT write to Firestore');
            },
            async update() {
              writeAttempts += 1;
              throw new Error('Subscription history endpoint MUST NOT update Firestore');
            },
            async delete() {
              writeAttempts += 1;
              throw new Error('Subscription history endpoint MUST NOT delete from Firestore');
            },
          };
        },
      };
    },
  };

  return {
    db: db as any,
    getWriteAttempts: () => writeAttempts,
  };
}

const defaultProdAsaasConfig = () => ({
  apiKey: '$aact_prod_mock',
  rawEnvExact: 'production',
  vercelEnv: 'production',
  env: 'production' as const,
  keyEnv: 'production' as const,
  envError: null,
  envMismatch: false,
  isProduction: true,
  baseUrl: 'https://api.asaas.com/v3',
  webhookToken: 'tok',
  isConfigured: true,
});

function buildDeps(overrides: Partial<SubscriptionHistoryDeps> = {}): SubscriptionHistoryDeps {
  return {
    verifyFirebaseUser: async () => ({
      uid: 'user-123',
      email: 'aluno@aprovadireito.com.br',
      name: 'Aluno Teste',
    }),
    getAdminFirestore: () => createReadOnlyTrackingFirestore().db,
    isPreviewSharingProductionFirestore: () => false,
    getAsaasConfig: defaultProdAsaasConfig,
    asaasFetch: async () => ({ data: [], totalCount: 0, hasMore: false }) as any,
    nowMs: () => Date.parse('2026-11-18T12:00:00.000Z'),
    ...overrides,
  };
}

test('1. Active subscription user returns full summary, sanitized paginated payments, and zero writes/charges', async () => {
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'ACTIVE',
      subscriptionId: 'sub_active_1',
      asaasCustomerId: 'cus_active_1',
      subscriptionDueDate: '2026-12-10',
      premiumUntil: '2026-12-10T23:59:59.999-03:00',
      lastConfirmedPaymentDate: '2026-11-10',
      paymentMethod: 'PIX',
    },
  });

  const asaasCalls: Array<{ endpoint: string; method: string }> = [];
  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async (endpoint, options) => {
      const method = String(options?.method || 'GET').toUpperCase();
      asaasCalls.push({ endpoint, method });
      assert.equal(method, 'GET', 'Must only send GET requests to Asaas');

      if (endpoint === '/subscriptions/sub_active_1') {
        return {
          id: 'sub_active_1',
          customer: 'cus_active_1',
          externalReference: 'user-123',
          status: 'ACTIVE',
          cycle: 'MONTHLY',
          value: 29.9,
          nextDueDate: '2026-12-10',
          dateCreated: '2026-10-10',
          billingType: 'PIX',
        } as any;
      }

      if (endpoint === '/customers/cus_active_1') {
        return {
          id: 'cus_active_1',
          name: 'Aluno Teste',
          cpfCnpj: '12345678909',
          externalReference: 'user-123',
        } as any;
      }

      if (endpoint.startsWith('/payments?customer=cus_active_1')) {
        return {
          totalCount: 2,
          hasMore: false,
          data: [
            {
              id: 'pay_002',
              customer: 'cus_active_1',
              subscription: 'sub_active_1',
              externalReference: 'user-123',
              value: 29.9,
              billingType: 'PIX',
              status: 'RECEIVED',
              confirmedDate: '2026-11-10',
              dueDate: '2026-11-10',
              creditCard: { creditCardNumber: '4444' },
            },
            {
              id: 'pay_001',
              customer: 'cus_active_1',
              subscription: 'sub_active_1',
              externalReference: 'user-123',
              value: 29.9,
              billingType: 'CREDIT_CARD',
              status: 'CONFIRMED',
              confirmedDate: '2026-10-10',
              dueDate: '2026-10-10',
            },
          ],
        } as any;
      }

      throw new Error(`Unexpected endpoint: ${endpoint}`);
    },
  });

  const req = createMockReq({ method: 'GET', url: '/api/subscription-history?page=1&limit=10' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(tracker.getWriteAttempts(), 0);
  assert.equal(json.asaasSynced, true);
  assert.equal(json.summary.isPremium, true);
  assert.equal(json.summary.accessState, 'active_renewal');
  assert.equal(json.summary.renewalStatus, 'active');
  assert.equal(json.summary.plan.id, 'monthly');
  assert.equal(json.summary.plan.price, 29.9);
  assert.equal(json.summary.startDate, '2026-10-10');
  assert.equal(json.summary.asaasSubscriptionStatus, 'ACTIVE');
  assert.equal(json.payments.length, 2);
  assert.equal(json.payments[0].id, 'pay_002');
  assert.equal(json.payments[0].paymentMethodLabel, 'Pix');
  assert.equal(json.payments[0].statusLabel, 'Confirmado');
  assert.equal(json.payments[1].paymentMethodLabel, 'Cartão de Crédito');

  // Ensure zero sensitive data leaked
  const serialized = JSON.stringify(json);
  assert.equal(serialized.includes('12345678909'), false);
  assert.equal(serialized.includes('creditCard'), false);
  assert.equal(asaasCalls.every((c) => c.method === 'GET'), true);
});

test('2. Cancelled subscription with still-valid Premium preserves access until paid date without revocation', async () => {
  const premiumUntil = '2026-12-05T23:59:59.999-03:00';
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'CANCELLED',
      subscriptionId: 'sub_canc_1',
      asaasCustomerId: 'cus_canc_1',
      premiumUntil,
      cancelledAt: '2026-11-12T10:00:00.000Z',
      lastConfirmedPaymentDate: '2026-11-05',
    },
  });

  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async (endpoint) => {
      if (endpoint === '/subscriptions/sub_canc_1') {
        return {
          id: 'sub_canc_1',
          customer: 'cus_canc_1',
          externalReference: 'user-123',
          status: 'INACTIVE',
          deleted: true,
          cycle: 'MONTHLY',
          value: 29.9,
          dateCreated: '2026-11-05',
        } as any;
      }
      if (endpoint === '/customers/cus_canc_1') {
        return { id: 'cus_canc_1', externalReference: 'user-123' } as any;
      }
      return {
        totalCount: 1,
        hasMore: false,
        data: [
          {
            id: 'pay_pix_1',
            customer: 'cus_canc_1',
            subscription: 'sub_canc_1',
            externalReference: 'user-123',
            value: 29.9,
            billingType: 'PIX',
            status: 'RECEIVED',
            confirmedDate: '2026-11-05',
            dueDate: '2026-11-05',
          },
        ],
      } as any;
    },
  });

  const req = createMockReq({ method: 'GET' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(tracker.getWriteAttempts(), 0);
  assert.equal(json.summary.isPremium, true);
  assert.equal(json.summary.isCancelledWithActiveAccess, true);
  assert.equal(json.summary.accessState, 'cancelled_active');
  assert.equal(json.summary.renewalStatus, 'cancelled');
  assert.equal(json.summary.nextDueDate, null);
  assert.equal(json.summary.premiumUntil, '2026-12-06T02:59:59.999Z');
});

test('3. Expired Premium user is reported as expired without mutating Firestore', async () => {
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'CANCELLED',
      subscriptionId: 'sub_exp_1',
      asaasCustomerId: 'cus_exp_1',
      premiumUntil: '2026-11-10T23:59:59.999-03:00',
    },
  });

  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    nowMs: () => Date.parse('2026-11-18T12:00:00.000Z'),
    asaasFetch: async (endpoint) => {
      if (endpoint === '/subscriptions/sub_exp_1') {
        return {
          id: 'sub_exp_1',
          customer: 'cus_exp_1',
          externalReference: 'user-123',
          status: 'INACTIVE',
          cycle: 'MONTHLY',
          value: 29.9,
        } as any;
      }
      if (endpoint === '/customers/cus_exp_1') {
        return { id: 'cus_exp_1', externalReference: 'user-123' } as any;
      }
      return { totalCount: 0, hasMore: false, data: [] } as any;
    },
  });

  const req = createMockReq({ method: 'GET' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(tracker.getWriteAttempts(), 0);
  assert.equal(json.summary.isPremium, false);
  assert.equal(json.summary.isExpired, true);
  assert.equal(json.summary.accessState, 'expired');
  assert.equal(json.summary.renewalStatus, 'cancelled');
});

test('4. User with subscription but no payments returns empty payment list cleanly', async () => {
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: false,
      plan: 'gratuito',
      subscriptionStatus: 'PENDING',
      subscriptionId: 'sub_pend_1',
      asaasCustomerId: 'cus_pend_1',
    },
  });

  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async (endpoint) => {
      if (endpoint === '/subscriptions/sub_pend_1') {
        return {
          id: 'sub_pend_1',
          customer: 'cus_pend_1',
          externalReference: 'user-123',
          status: 'ACTIVE',
          cycle: 'MONTHLY',
          value: 29.9,
        } as any;
      }
      if (endpoint === '/customers/cus_pend_1') {
        return { id: 'cus_pend_1', externalReference: 'user-123' } as any;
      }
      return { totalCount: 0, hasMore: false, data: [] } as any;
    },
  });

  const req = createMockReq({ method: 'GET' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(json.asaasSynced, true);
  assert.deepEqual(json.payments, []);
  assert.equal(json.summary.accessState, 'pending');
  assert.equal(json.pagination.totalCount, 0);
});

test('5. Legitimate absence of subscription (NONE doc or non-existent user doc) returns free plan and does not call Asaas', async () => {
  // Case A: User document exists with subscriptionStatus NONE
  let asaasCalled = false;
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: false,
      plan: 'gratuito',
      subscriptionStatus: 'NONE',
    },
  });

  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async () => {
      asaasCalled = true;
      return {} as any;
    },
  });

  const req = createMockReq({ method: 'GET' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(asaasCalled, false);
  assert.equal(tracker.getWriteAttempts(), 0);
  assert.equal(json.summary.plan.id, 'free');
  assert.equal(json.summary.isPremium, false);
  assert.equal(json.summary.accessState, 'free');
  assert.equal(json.summary.renewalStatus, 'none');
  assert.deepEqual(json.payments, []);

  // Case B: Firestore query succeeds cleanly but user document does not exist yet
  const emptyTracker = createReadOnlyTrackingFirestore({});
  const emptyDeps = buildDeps({
    getAdminFirestore: () => emptyTracker.db,
    asaasFetch: async () => {
      asaasCalled = true;
      return {} as any;
    },
  });

  const emptyMock = createMockRes();
  await handleSubscriptionHistory(createMockReq({ method: 'GET' }), emptyMock.res, emptyDeps);
  assert.equal(emptyMock.getStatus(), 200);
  const emptyJson = emptyMock.getJson();
  assert.equal(asaasCalled, false);
  assert.equal(emptyTracker.getWriteAttempts(), 0);
  assert.equal(emptyJson.summary.plan.id, 'free');
  assert.equal(emptyJson.summary.isPremium, false);
  assert.equal(emptyJson.summary.accessState, 'free');
  assert.deepEqual(emptyJson.payments, []);
});

test('6. Cross-user access attempts (UID/customerId/subscriptionId tampering or mismatched externalReference) are blocked with HTTP 403', async () => {
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      subscriptionStatus: 'ACTIVE',
      subscriptionId: 'sub_own_1',
      asaasCustomerId: 'cus_own_1',
      premiumUntil: '2026-12-10T23:59:59.999-03:00',
    },
  });

  let asaasCalledOnProbing = false;
  const baseDeps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async () => {
      asaasCalledOnProbing = true;
      return {} as any;
    },
  });

  for (const probeUrl of [
    '/api/subscription-history?uid=other_user',
    '/api/subscription-history?customerId=cus_other_999',
    '/api/subscription-history?subscriptionId=sub_other_999',
  ]) {
    const req = createMockReq({ method: 'GET', url: probeUrl });
    const mock = createMockRes();
    await handleSubscriptionHistory(req, mock.res, baseDeps);
    assert.equal(mock.getStatus(), 403, `Expected 403 for ${probeUrl}`);
    assert.equal(mock.getJson().blocked, true);
    assert.equal(asaasCalledOnProbing, false);
  }

  // Also test Asaas returning another user's externalReference
  const mismatchDeps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async (endpoint) => {
      if (endpoint === '/subscriptions/sub_own_1') {
        return {
          id: 'sub_own_1',
          customer: 'cus_own_1',
          externalReference: 'different-user-999',
          status: 'ACTIVE',
        } as any;
      }
      return {} as any;
    },
  });

  const mismatchReq = createMockReq({ method: 'GET' });
  const mismatchMock = createMockRes();
  await handleSubscriptionHistory(mismatchReq, mismatchMock.res, mismatchDeps);
  assert.equal(mismatchMock.getStatus(), 403);
  assert.equal(mismatchMock.getJson().blocked, true);
});

test('7. Asaas communication failure returns clean warning and zero invented payments', async () => {
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'ACTIVE',
      subscriptionId: 'sub_err_1',
      asaasCustomerId: 'cus_err_1',
      premiumUntil: '2026-12-10T23:59:59.999-03:00',
    },
  });

  const deps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async () => {
      throw new Error('Tempo limite excedido ao comunicar com o Asaas (5000ms).');
    },
  });

  const req = createMockReq({ method: 'GET' });
  const mock = createMockRes();
  await handleSubscriptionHistory(req, mock.res, deps);

  assert.equal(mock.getStatus(), 200);
  const json = mock.getJson();
  assert.equal(json.asaasSynced, false);
  assert.ok(typeof json.asaasError === 'string' && json.asaasError.length > 0);
  assert.deepEqual(json.payments, []);
  assert.equal(json.summary.isPremium, true);
  assert.equal(json.summary.asaasSubscriptionStatus, 'UNAVAILABLE');
});

test('8. Pagination, Annual/Monthly plan catalog structure, and Preview-Production guard work properly', async () => {
  // Preview guard test
  let verifyCalled = false;
  const previewDeps = buildDeps({
    isPreviewSharingProductionFirestore: () => true,
    verifyFirebaseUser: async () => {
      verifyCalled = true;
      return { uid: 'user-123', email: 'a@b.com' };
    },
  });
  const previewMock = createMockRes();
  await handleSubscriptionHistory(createMockReq({ method: 'GET' }), previewMock.res, previewDeps);
  assert.equal(previewMock.getStatus(), 403);
  assert.equal(previewMock.getJson().blocked, true);
  assert.equal(verifyCalled, false);

  // Pagination & Annual plan detection (catalog checkoutEnabled=false for annual)
  const tracker = createReadOnlyTrackingFirestore({
    'user-123': {
      isPremium: true,
      plan: 'premium',
      subscriptionStatus: 'ACTIVE',
      subscriptionId: 'sub_annual_1',
      asaasCustomerId: 'cus_annual_1',
      premiumUntil: '2027-11-18T23:59:59.999-03:00',
    },
  });

  let receivedPaymentsUrl = '';
  const pagedDeps = buildDeps({
    getAdminFirestore: () => tracker.db,
    asaasFetch: async (endpoint) => {
      if (endpoint === '/subscriptions/sub_annual_1') {
        return {
          id: 'sub_annual_1',
          customer: 'cus_annual_1',
          externalReference: 'user-123',
          status: 'ACTIVE',
          cycle: 'YEARLY',
          value: 249.0,
        } as any;
      }
      if (endpoint === '/customers/cus_annual_1') {
        return { id: 'cus_annual_1', externalReference: 'user-123' } as any;
      }
      receivedPaymentsUrl = endpoint;
      return {
        totalCount: 12,
        hasMore: true,
        data: [
          {
            id: 'pay_ref_1',
            customer: 'cus_annual_1',
            externalReference: 'user-123',
            value: 29.9,
            billingType: 'PIX',
            status: 'REFUNDED',
            dueDate: '2026-09-10',
          },
          {
            id: 'pay_other_leak',
            customer: 'cus_someone_else',
            externalReference: 'user-999',
            value: 29.9,
            billingType: 'PIX',
            status: 'RECEIVED',
            dueDate: '2026-09-10',
          },
        ],
      } as any;
    },
  });

  const pagedMock = createMockRes();
  await handleSubscriptionHistory(
    createMockReq({ method: 'GET', url: '/api/subscription-history?page=2&limit=5' }),
    pagedMock.res,
    pagedDeps
  );

  assert.equal(pagedMock.getStatus(), 200);
  assert.equal(receivedPaymentsUrl, '/payments?customer=cus_annual_1&offset=5&limit=5');
  const json = pagedMock.getJson();
  assert.equal(json.pagination.page, 2);
  assert.equal(json.pagination.limit, 5);
  assert.equal(json.pagination.totalPages, 3);
  assert.equal(json.pagination.hasMore, true);
  assert.equal(json.summary.plan.id, 'annual');
  assert.equal(json.summary.plan.price, 249.0);
  assert.equal(json.summary.plan.installmentValue, 20.75);
  assert.equal(json.plansCatalog.length, 2);
  assert.equal(json.plansCatalog[0].checkoutEnabled, true);
  assert.equal(json.plansCatalog[1].checkoutEnabled, false);
  // Defensive filter excluded pay_other_leak
  assert.equal(json.payments.length, 1);
  assert.equal(json.payments[0].id, 'pay_ref_1');
  assert.equal(json.payments[0].statusLabel, 'Estornado');
});

test('9. Firestore Admin unavailability or read failure returns HTTP 503 and never falls back to Plano Gratuito', async () => {
  let asaasCalled = false;

  // Case A: getAdminFirestore returns null (missing credentials / failed init)
  const nullDbDeps = buildDeps({
    getAdminFirestore: () => null,
    asaasFetch: async () => {
      asaasCalled = true;
      return {} as any;
    },
  });
  const nullDbMock = createMockRes();
  await handleSubscriptionHistory(createMockReq({ method: 'GET' }), nullDbMock.res, nullDbDeps);
  assert.equal(nullDbMock.getStatus(), 503);
  const nullDbJson = nullDbMock.getJson();
  assert.equal(nullDbJson.unavailable, true);
  assert.ok(typeof nullDbJson.error === 'string' && nullDbJson.error.includes('indisponível'));
  assert.equal(nullDbJson.summary, undefined);
  assert.equal(asaasCalled, false);

  // Case B: Firestore read throws permission error (7 PERMISSION_DENIED)
  const permDeniedDb = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              const err: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.');
              err.code = 7;
              throw err;
            },
          };
        },
      };
    },
  };
  const permDeniedDeps = buildDeps({
    getAdminFirestore: () => permDeniedDb as any,
    asaasFetch: async () => {
      asaasCalled = true;
      return {} as any;
    },
  });
  const permDeniedMock = createMockRes();
  await handleSubscriptionHistory(
    createMockReq({ method: 'GET' }),
    permDeniedMock.res,
    permDeniedDeps
  );
  assert.equal(permDeniedMock.getStatus(), 503);
  const permDeniedJson = permDeniedMock.getJson();
  assert.equal(permDeniedJson.unavailable, true);
  assert.ok(typeof permDeniedJson.error === 'string' && permDeniedJson.error.includes('indisponível'));
  assert.equal(permDeniedJson.summary, undefined);
  assert.equal(asaasCalled, false);

  // Case C: Firestore read throws connection/unavailable error
  const connErrDb = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              throw new Error('14 UNAVAILABLE: Connection reset by peer');
            },
          };
        },
      };
    },
  };
  const connErrDeps = buildDeps({
    getAdminFirestore: () => connErrDb as any,
    asaasFetch: async () => {
      asaasCalled = true;
      return {} as any;
    },
  });
  const connErrMock = createMockRes();
  await handleSubscriptionHistory(createMockReq({ method: 'GET' }), connErrMock.res, connErrDeps);
  assert.equal(connErrMock.getStatus(), 503);
  const connErrJson = connErrMock.getJson();
  assert.equal(connErrJson.unavailable, true);
  assert.ok(typeof connErrJson.error === 'string' && connErrJson.error.includes('indisponível'));
  assert.equal(connErrJson.summary, undefined);
  assert.equal(asaasCalled, false);
});
