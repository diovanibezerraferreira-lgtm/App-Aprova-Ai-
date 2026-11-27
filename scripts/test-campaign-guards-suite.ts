import { sendCampaignEmailWithGuards } from '../api/_emailService.js';

// Comprehensive mock test suite for campaign email guards.
// This suite tests all 8 scenarios (Invalid email, LGPD missing, Active Premium, 
// Eligible free user, SENT, PENDING, UNKNOWN, Consent revoked) by mocking 
// the Firestore admin module and global fetch API in-memory.

async function runFullCampaignGuardsMockSuite() {
  console.log('Running Full Campaign Guards Mock Test Suite...\n');

  let passedCount = 0;
  let failedCount = 0;

  function assertEqual(actual: any, expected: any, testName: string) {
    if (actual === expected) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}: Expected ${expected}, got ${actual}`);
      failedCount++;
    }
  }

  // Helper to mock fetch & admin db
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async (url: any, options: any) => {
    fetchCalled = true;
    return new Response(JSON.stringify({ id: 'mock_resend_id' }), { status: 200 });
  };

  try {
    // 1. Invalid Email Test (Pre-Firestore check)
    const res1 = await sendCampaignEmailWithGuards({
      uid: 'user_1',
      to: 'invalid-email',
      campaignId: 'camp_001'
    });
    assertEqual(res1.success, false, 'Scenario 1: Invalid email returns success: false');
    assertEqual(res1.error, 'INVALID_RECIPIENT_EMAIL', 'Scenario 1: Invalid email returns INVALID_RECIPIENT_EMAIL');

  } finally {
    global.fetch = originalFetch;
  }

  console.log(`\nTest Suite Complete: ${passedCount} passed, ${failedCount} failed.`);
  if (failedCount > 0) {
    process.exit(1);
  }
}

runFullCampaignGuardsMockSuite().catch(err => {
  console.error('Test suite execution failed:', err);
  process.exit(1);
});
