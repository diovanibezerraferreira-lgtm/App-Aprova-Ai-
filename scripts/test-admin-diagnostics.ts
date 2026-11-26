import handler from '../api/admin-diagnostics.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

async function simulateRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; body: any }> {
  const req = new IncomingMessage(new Socket()) as IncomingMessage & { body?: any };
  req.method = options.method || 'POST';
  req.url = options.url || '/api/admin-diagnostics?__action=campaign-dry-run';
  req.headers = options.headers || {};
  if (options.body !== undefined) {
    req.body = options.body;
  }

  let statusCode = 200;
  let responseBody = '';

  const res = new ServerResponse(req);
  res.statusCode = 200;
  res.setHeader = () => res;
  res.end = (chunk?: any) => {
    if (chunk) responseBody += chunk.toString();
    res.emit('finish');
    return res;
  };

  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (val) => { statusCode = val; }
  });

  process.env.DIAGNOSTIC_SECRET = 'super-secret-diagnostic-key-12345';

  await handler(req, res);

  let parsed: any = null;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    parsed = responseBody;
  }

  return { status: statusCode, body: parsed };
}

async function runAdminDiagnosticsTests() {
  console.log('Running Admin Diagnostics Consolidated Endpoint Tests...\n');

  // 1. GET method: 405
  const t0 = await simulateRequest({
    method: 'GET',
    url: '/api/admin-diagnostics?__action=campaign-dry-run',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
  });
  assert(t0.status === 405, 'GET should return 405');
  console.log('[PASS] GET method returns 405');

  // 2. Missing or invalid action: 400
  const t1 = await simulateRequest({
    method: 'POST',
    url: '/api/admin-diagnostics',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: {}
  });
  assert(t1.status === 400, 'Missing action should return 400');
  assert(t1.body.error === 'INVALID_ACTION', 'Error should be INVALID_ACTION');
  console.log('[PASS] Missing action returns 400');

  // 3. Unauthorized (wrong secret): 401
  const t2 = await simulateRequest({
    method: 'POST',
    url: '/api/admin-diagnostics?__action=campaign-dry-run',
    headers: { 'x-diagnostic-secret': 'wrong-secret' },
    body: {}
  });
  assert(t2.status === 401, 'Wrong secret should return 401');
  console.log('[PASS] Unauthorized call returns 401');

  // 4. Invalid cursor (> 128 chars): 400
  const t3 = await simulateRequest({
    method: 'POST',
    url: '/api/admin-diagnostics?__action=campaign-dry-run',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: { cursor: 'a'.repeat(129), referenceTimestamp: Date.now() }
  });
  assert(t3.status === 400, 'Invalid cursor should return 400');
  assert(t3.body.error === 'INVALID_CURSOR', 'Error should be INVALID_CURSOR');
  console.log('[PASS] Invalid cursor returns 400');

  // 5. Email reset without reason: 400
  const t4 = await simulateRequest({
    method: 'POST',
    url: '/api/admin-diagnostics?__action=email-reset',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: {}
  });
  assert(t4.status === 400, 'Email reset without reason should return 400');
  assert(t4.body.error === 'REASON_REQUIRED', 'Error should be REASON_REQUIRED');
  console.log('[PASS] email-reset validates reason field');

  console.log('\nAll Admin Diagnostics Consolidated Endpoint Tests Passed Successfully!');
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

runAdminDiagnosticsTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
