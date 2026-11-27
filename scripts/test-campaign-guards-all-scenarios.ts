import { sendCampaignEmailWithGuards } from '../api/_emailService.js';

class MockDocRef {
  constructor(public path: string, private store: Map<string, any>) {}
  collection(subName: string) {
    return {
      doc: (subId: string) => new MockDocRef(`${this.path}/${subName}/${subId}`, this.store)
    };
  }
  async set(data: any, options?: { merge?: boolean }) {
    const existing = this.store.get(this.path) || {};
    if (options?.merge) {
      this.store.set(this.path, { ...existing, ...data });
    } else {
      this.store.set(this.path, data);
    }
  }
  async get() {
    const data = this.store.get(this.path);
    return {
      exists: data !== undefined,
      data: () => data
    };
  }
}

class MockFirestore {
  private store = new Map<string, any>();

  setDoc(path: string, data: any) {
    this.store.set(path, data);
  }

  collection(name: string) {
    return {
      doc: (id: string) => new MockDocRef(`/${name}/${id}`, this.store)
    };
  }

  async runTransaction(updateFunction: any) {
    const transaction = {
      get: async (docRef: MockDocRef) => {
        return docRef.get();
      },
      set: (docRef: MockDocRef, data: any, options?: { merge?: boolean }) => {
        const existing = this.store.get(docRef.path) || {};
        if (options?.merge) {
          this.store.set(docRef.path, { ...existing, ...data });
        } else {
          this.store.set(docRef.path, data);
        }
      }
    };
    return updateFunction(transaction);
  }
}

async function runAllEightScenarios() {
  console.log('Running 8 Dynamic Campaign Guards Scenarios with In-Memory Mocks...\n');
  let passed = 0;
  let failed = 0;

  function assert(cond: boolean, name: string) {
    if (cond) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${name}`);
      failed++;
    }
  }

  process.env.RESEND_API_KEY = 'mock_resend_key_123';

  // Scenario 1: Invalid Email
  {
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_1',
      to: 'invalid-email-format',
      campaignId: 'camp_1'
    });
    assert(res.success === false && res.error === 'INVALID_RECIPIENT_EMAIL', '1. E-mail inválido');
  }

  // Scenario 2: LGPD Consent Missing
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_2', { consents: { email: false }, isPremium: false });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_2',
      to: 'user2@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'LGPD_CONSENT_REQUIRED', '2. Ausência de consentimento LGPD');
  }

  // Scenario 3: Active Premium
  {
    const db = new MockFirestore();
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    db.setDoc('/users/user_3', { consents: { email: true }, isPremium: true, subscriptionStatus: 'ACTIVE', premiumUntil: futureDate });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_3',
      to: 'user3@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'USER_HAS_ACTIVE_PREMIUM', '3. Usuário Premium ativo');
  }

  // Scenario 4: Eligible Free User with Consent (Simulated send)
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_4', { consents: { email: true }, isPremium: false, subscriptionStatus: 'NONE' });
    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return {
        ok: true,
        text: async () => 'OK'
      };
    };

    const res = await sendCampaignEmailWithGuards({
      uid: 'user_4',
      to: 'user4@test.com',
      campaignId: 'camp_1',
      _testDb: db,
      _testFetch: mockFetch as any
    });
    assert(Boolean(res.success) && fetchCalled, '4. Usuário gratuito com consentimento (envio simulado)');
  }

  // Scenario 5: Already SENT
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_5', { consents: { email: true }, isPremium: false });
    db.setDoc('/users/user_5/campaign_history/camp_1', { status: 'SENT', updatedAt: new Date().toISOString() });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_5',
      to: 'user5@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'ALREADY_SENT', '5. Campanha já enviada (SENT)');
  }

  // Scenario 6: Already PENDING (Active mutex)
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_6', { consents: { email: true }, isPremium: false });
    db.setDoc('/users/user_6/campaign_history/camp_1', { status: 'PENDING', updatedAt: new Date().toISOString() });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_6',
      to: 'user6@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'ALREADY_PENDING', '6. Campanha pendente (PENDING)');
  }

  // Scenario 7: State UNKNOWN
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_7', { consents: { email: true }, isPremium: false });
    db.setDoc('/users/user_7/campaign_history/camp_1', { status: 'UNKNOWN', updatedAt: new Date().toISOString() });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_7',
      to: 'user7@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'CAMPAIGN_STATE_UNKNOWN_REQUIRES_RECONCILIATION', '7. Estado UNKNOWN');
  }

  // Scenario 8: Revoked Consent
  {
    const db = new MockFirestore();
    db.setDoc('/users/user_8', { consents: { email: false }, isPremium: false });
    const res = await sendCampaignEmailWithGuards({
      uid: 'user_8',
      to: 'user8@test.com',
      campaignId: 'camp_1',
      _testDb: db
    });
    assert(res.success === false && res.error === 'LGPD_CONSENT_REQUIRED', '8. Consentimento revogado');
  }

  console.log(`\nTest Suite Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllEightScenarios().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
