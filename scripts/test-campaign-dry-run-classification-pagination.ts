import { evaluatePremiumAccess } from '../api/_premiumValidity.js';

function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function classifyUser(userData: any, referenceTimestamp: number): string {
  if (!userData || typeof userData !== 'object') {
    return 'insufficientData';
  }
  if (!isValidEmail(userData.email)) {
    return 'invalidEmail';
  }
  if (userData.consents?.email !== true) {
    return 'noConsent';
  }
  const evaluation = evaluatePremiumAccess(userData, referenceTimestamp);
  if (evaluation.isPremium === true) {
    return 'premiumExcluded';
  }
  return 'eligible';
}

function runClassificationAndPaginationTests() {
  console.log('Running Classification & Pagination Tests...\n');

  const now = Date.now();
  const futureDate = new Date(now + 86400000 * 30).toISOString(); // 30 days in future

  // 1. Classification Tests
  const users = [
    { email: 'user1@test.com', consents: { email: true }, isPremium: false, subscriptionStatus: 'NONE' }, // Eligible
    { email: 'user2@test.com', consents: { email: true }, isPremium: true, subscriptionStatus: 'ACTIVE', premiumUntil: futureDate }, // Premium Excluded
    { email: 'user3@test.com', consents: { email: false }, isPremium: false, subscriptionStatus: 'NONE' }, // No Consent
    { email: 'invalid-email', consents: { email: true }, isPremium: false, subscriptionStatus: 'NONE' }, // Invalid Email
    { email: null, consents: { email: true }, isPremium: false, subscriptionStatus: 'NONE' }, // Invalid Email (null)
    { email: 'user6@test.com', consents: { email: true }, isPremium: true, subscriptionStatus: 'CANCELLED', premiumUntil: futureDate }, // Premium Excluded (Cancelled with future paid)
    null, // Insufficient Data (null)
  ];

  let totalExamined = 0;
  let eligible = 0;
  let premiumExcluded = 0;
  let noConsent = 0;
  let invalidEmail = 0;
  let insufficientData = 0;

  for (const u of users) {
    totalExamined++;
    const cat = classifyUser(u, now);
    if (cat === 'eligible') eligible++;
    else if (cat === 'premiumExcluded') premiumExcluded++;
    else if (cat === 'noConsent') noConsent++;
    else if (cat === 'invalidEmail') invalidEmail++;
    else if (cat === 'insufficientData') insufficientData++;
  }

  const sumCategories = eligible + premiumExcluded + noConsent + invalidEmail + insufficientData;
  assert(sumCategories === totalExamined, 'Sum of categories must equal totalExamined');
  assert(eligible === 1, 'Should have exactly 1 eligible user');
  assert(premiumExcluded === 2, 'Should have exactly 2 premium excluded users');
  assert(noConsent === 1, 'Should have exactly 1 no-consent user');
  assert(invalidEmail === 2, 'Should have exactly 2 invalid email users');
  assert(insufficientData === 1, 'Should have exactly 1 insufficient data user');

  console.log('[PASS] Classification tests: mutually exclusive, exact sum, proper categorization.');

  // 2. Pagination Mock Tests
  const allMockDocs = [
    { id: 'user_001', data: () => ({ email: 'u1@test.com', consents: { email: true }, isPremium: false }) },
    { id: 'user_002', data: () => ({ email: 'u2@test.com', consents: { email: true }, isPremium: false }) },
    { id: 'user_003', data: () => ({ email: 'u3@test.com', consents: { email: true }, isPremium: false }) },
    { id: 'user_004', data: () => ({ email: 'u4@test.com', consents: { email: true }, isPremium: false }) },
    { id: 'user_005', data: () => ({ email: 'u5@test.com', consents: { email: true }, isPremium: false }) },
  ];

  const BATCH_SIZE = 2;
  let cursor: string | null = null;
  let pageCount = 0;
  let processedIds = new Set<string>();
  let hasMore = true;

  while (hasMore) {
    pageCount++;
    const startIndex = cursor ? allMockDocs.findIndex(d => d.id === cursor) + 1 : 0;
    const querySlice = allMockDocs.slice(startIndex, startIndex + BATCH_SIZE + 1);

    const pageHasMore = querySlice.length > BATCH_SIZE;
    const pageDocs = pageHasMore ? querySlice.slice(0, BATCH_SIZE) : querySlice;
    const nextPageCursor = pageHasMore ? pageDocs[pageDocs.length - 1].id : null;

    for (const doc of pageDocs) {
      assert(!processedIds.has(doc.id), `Document ${doc.id} processed twice!`);
      processedIds.add(doc.id);
    }

    cursor = nextPageCursor;
    hasMore = pageHasMore;
  }

  assert(pageCount === 3, 'Should take 3 pages for 5 docs with batch size 2');
  assert(processedIds.size === 5, 'All 5 documents processed without duplication');
  assert(hasMore === false, 'Last page must return hasMore false');
  console.log('[PASS] Pagination mock tests: cursor continuation, no duplication, exact page count, hasMore false on last page.');

  console.log('\nAll Classification & Pagination Tests Passed Successfully!');
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

runClassificationAndPaginationTests();
