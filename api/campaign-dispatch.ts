import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { getAdminFirestore } from './_firebaseAdmin.js';
import { evaluatePremiumAccess } from './_premiumValidity.js';
import { sendCampaignEmailWithGuards } from './_emailService.js';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

function timingSafeCompare(provided: string, expected: string): boolean {
  try {
    const bufA = Buffer.from(provided);
    const bufB = Buffer.from(expected);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function verifyCronSecret(req: IncomingMessage): boolean {
  const expected = (process.env.CRON_SECRET || process.env.DIAGNOSTIC_SECRET || '').trim();
  if (!expected) return false;

  const headers = req.headers || {};
  const custom = headers['x-cron-secret'] || (headers as any)['X-Cron-Secret'] || headers['x-admin-secret'];
  const token = typeof custom === 'string' ? custom.trim() : '';

  const auth = headers.authorization || (headers as any).Authorization;
  const bearer = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';

  const presented = token || bearer;
  if (!presented) return false;

  return timingSafeCompare(presented, expected);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!verifyCronSecret(req)) {
    return sendJson(res, 401, { error: 'UNAUTHORIZED_CRON_SECRET', message: 'Acesso restrito a chamadas de cron autorizadas.' });
  }

  const db = getAdminFirestore();
  if (!db) {
    return sendJson(res, 500, { error: 'DATABASE_NOT_INITIALIZED' });
  }

  const isDispatchEnabled = process.env.CAMPAIGN_DISPATCH_ENABLED === 'true';

  try {
    // Process in batches (respecting Vercel Hobby 10s timeout limit)
    const usersSnap = await db.collection('users').limit(50).get();
    const nowMs = Date.now();
    const results: any[] = [];

    const targetMilestones = [0, 1, 3, 5, 7];

    for (const doc of usersSnap.docs) {
      const uid = doc.id;
      const userData = doc.data() || {};
      const email = userData.email;

      if (!email || typeof email !== 'string') continue;

      // 1. Check email consent LGPD
      if (userData.consents?.email !== true) continue;

      // 2. Check Premium access (skip active premium users)
      const premiumEval = evaluatePremiumAccess(userData, nowMs);
      if (premiumEval.isPremium) continue;

      // 3. Calculate account age in days from createdAt
      const createdAtMs = userData.createdAt ? Date.parse(userData.createdAt) : nowMs;
      const ageDays = Math.max(0, Math.floor((nowMs - createdAtMs) / (1000 * 60 * 60 * 24)));

      // Find matching milestone (allow 24-hour grace window per milestone day)
      const matchedMilestone = targetMilestones.find(m => ageDays === m);
      if (matchedMilestone === undefined) continue;

      const campaignId = `campaign-day-${matchedMilestone}`;

      // 4. If dispatch is not explicitly enabled via activation key, use mock fetch to ensure 0 real emails
      const mockFetch = isDispatchEnabled ? undefined : async () => ({
        ok: true,
        text: async () => 'DISPATCH_DISABLED_DRY_RUN'
      });

      const dispatchResult = await sendCampaignEmailWithGuards({
        uid,
        to: email,
        campaignId,
        userName: userData.name,
        _testFetch: mockFetch as any
      });

      results.push({
        uid,
        email,
        campaignId,
        ageDays,
        dispatchResult,
        liveDispatch: isDispatchEnabled
      });
    }

    return sendJson(res, 200, {
      success: true,
      dispatchEnabled: isDispatchEnabled,
      processedCount: results.length,
      results,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    console.error('Error in /api/campaign-dispatch:', err);
    return sendJson(res, 500, { error: err?.message || 'INTERNAL_ERROR' });
  }
}
