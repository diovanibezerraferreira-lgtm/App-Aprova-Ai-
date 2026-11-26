import handler from '../api/campaign-dry-run.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

async function simulateRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
}): Promise<{ status: number; body: any }> {
  const req = new IncomingMessage(new Socket()) as IncomingMessage & { body?: any };
  req.method = options.method || 'POST';
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

async function runEndpointTests() {
  console.log('Running Campaign Dry-Run Endpoint Tests...\n');

  // 1. GET: 405
  const t1 = await simulateRequest({ method: 'GET' });
  assert(t1.status === 405, 'GET should return 405');
  console.log('[PASS] GET returns 405');

  // 2. Missing secret: 401
  const t2 = await simulateRequest({ method: 'POST', body: {} });
  assert(t2.status === 401, 'Missing secret should return 401');
  console.log('[PASS] Missing secret returns 401');

  // 3. Incorrect secret: 401
  const t3 = await simulateRequest({
    method: 'POST',
    headers: { 'x-diagnostic-secret': 'wrong-secret' },
    body: {}
  });
  assert(t3.status === 401, 'Incorrect secret should return 401');
  console.log('[PASS] Incorrect secret returns 401');

  // 4. Invalid cursor (> 128 chars or bad chars): 400
  const t4 = await simulateRequest({
    method: 'POST',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: { cursor: 'a'.repeat(129), referenceTimestamp: Date.now() }
  });
  assert(t4.status === 400, 'Invalid cursor should return 400');
  console.log('[PASS] Invalid cursor returns 400');

  // 5. Invalid timestamp (string/decimal): 400
  const t5 = await simulateRequest({
    method: 'POST',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: { referenceTimestamp: '1732591920000' } // string instead of number
  });
  assert(t5.status === 400, 'String timestamp should return 400');
  console.log('[PASS] Invalid timestamp (string) returns 400');

  const t5_dec = await simulateRequest({
    method: 'POST',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: { referenceTimestamp: 1732591920000.5 } // decimal
  });
  assert(t5_dec.status === 400, 'Decimal timestamp should return 400');
  console.log('[PASS] Invalid timestamp (decimal) returns 400');

  // 6. Cursor present without timestamp: 400
  const t6 = await simulateRequest({
    method: 'POST',
    headers: { 'x-diagnostic-secret': 'super-secret-diagnostic-key-12345' },
    body: { cursor: 'valid_user_id' } // missing referenceTimestamp
  });
  assert(t6.status === 400, 'Cursor without timestamp should return 400');
  console.log('[PASS] Cursor without timestamp returns 400');

  console.log('\nAll Endpoint Validation Tests Passed Successfully!');
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

runEndpointTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
