import { evaluatePremiumAccess } from '../api/_premiumValidity.js';

function isEligibleForCampaign(userData: any, nowMs: number = Date.now()): boolean {
  if (!userData || userData.consents?.email !== true) {
    return false;
  }
  const evaluation = evaluatePremiumAccess(userData, nowMs);
  return evaluation.isPremium === false;
}

function runTests() {
  const now = Date.now();
  const futureDate = new Date(now + 86400000 * 30).toISOString(); // 30 days in future
  const pastDate = new Date(now - 86400000 * 30).toISOString();   // 30 days in past

  const testCases = [
    {
      name: '1. ACTIVE com vigência futura',
      user: { isPremium: true, subscriptionStatus: 'ACTIVE', premiumUntil: futureDate, consents: { email: true } },
      expected: false
    },
    {
      name: '2. ACTIVE legado sem premiumUntil',
      user: { isPremium: true, subscriptionStatus: 'ACTIVE', premiumUntil: null, consents: { email: true } },
      expected: false
    },
    {
      name: '3. CANCELLED com vigência futura',
      user: { isPremium: true, subscriptionStatus: 'CANCELLED', premiumUntil: futureDate, consents: { email: true } },
      expected: false
    },
    {
      name: '4. OVERDUE com vigência futura',
      user: { isPremium: true, subscriptionStatus: 'OVERDUE', premiumUntil: futureDate, consents: { email: true } },
      expected: false
    },
    {
      name: '5. CANCELLED com vigência expirada (com consentimento)',
      user: { isPremium: true, subscriptionStatus: 'CANCELLED', premiumUntil: pastDate, consents: { email: true } },
      expected: true
    },
    {
      name: '6. OVERDUE com vigência expirada (com consentimento)',
      user: { isPremium: true, subscriptionStatus: 'OVERDUE', premiumUntil: pastDate, consents: { email: true } },
      expected: true
    },
    {
      name: '7. Usuário gratuito com consentimento',
      user: { isPremium: false, subscriptionStatus: 'NONE', premiumUntil: null, consents: { email: true } },
      expected: true
    },
    {
      name: '8. Usuário sem consentimento',
      user: { isPremium: false, subscriptionStatus: 'NONE', premiumUntil: null, consents: { email: false } },
      expected: false
    },
    {
      name: '9. PENDING sem acesso Premium (com consentimento)',
      user: { isPremium: false, subscriptionStatus: 'PENDING', premiumUntil: null, consents: { email: true } },
      expected: true
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const result = isEligibleForCampaign(tc.user, now);
    if (result === tc.expected) {
      console.log(`[PASS] ${tc.name}`);
      passed++;
    } else {
      console.error(`[FAIL] ${tc.name}: expected ${tc.expected}, got ${result}`);
      failed++;
    }
  }

  console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
