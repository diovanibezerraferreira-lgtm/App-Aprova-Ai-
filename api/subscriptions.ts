import type { IncomingMessage, ServerResponse } from 'http';
import createSubscriptionHandler, {
  handleCreateSubscription,
  type CreateSubscriptionDeps,
} from './_subscriptions/create.js';
import subscriptionStatusHandler, {
  handleSubscriptionStatus,
  type SubscriptionStatusDeps,
} from './_subscriptions/status.js';
import subscriptionHistoryHandler, {
  handleSubscriptionHistory,
  type SubscriptionHistoryDeps,
} from './_subscriptions/history.js';

export {
  handleCreateSubscription,
  handleSubscriptionStatus,
  handleSubscriptionHistory,
  type CreateSubscriptionDeps,
  type SubscriptionStatusDeps,
  type SubscriptionHistoryDeps,
};

type RequestWithBody = IncomingMessage & { body?: any };

export type SubscriptionRouteAction = 'create' | 'status' | 'history';

export interface SubscriptionsRouterDeps {
  create?: (req: RequestWithBody, res: ServerResponse) => Promise<void>;
  status?: (req: RequestWithBody, res: ServerResponse) => Promise<void>;
  history?: (req: RequestWithBody, res: ServerResponse) => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

export function resolveSubscriptionAction(req: IncomingMessage): SubscriptionRouteAction | null {
  try {
    const parsed = new URL(req.url || '/api/subscriptions', 'http://localhost');
    const explicitAction = (parsed.searchParams.get('__action') || '').trim().toLowerCase();
    if (explicitAction === 'create' || explicitAction === 'status' || explicitAction === 'history') {
      return explicitAction;
    }
    if (explicitAction) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname === '/api/create-subscription') return 'create';
    if (pathname === '/api/subscription-status') return 'status';
    if (pathname === '/api/subscription-history') return 'history';
    return null;
  } catch {
    return null;
  }
}

export async function handleSubscriptionsRoute(
  req: RequestWithBody,
  res: ServerResponse,
  deps?: SubscriptionsRouterDeps
): Promise<void> {
  const action = resolveSubscriptionAction(req);
  if (action === 'create') {
    const fn = deps?.create || createSubscriptionHandler;
    return fn(req, res);
  }
  if (action === 'status') {
    const fn = deps?.status || subscriptionStatusHandler;
    return fn(req, res);
  }
  if (action === 'history') {
    const fn = deps?.history || subscriptionHistoryHandler;
    return fn(req, res);
  }

  return sendJson(res, 404, {
    error: 'NOT_FOUND',
    message: 'Rota de assinatura não encontrada.',
  });
}

export default async function handler(
  req: RequestWithBody,
  res: ServerResponse
): Promise<void> {
  return handleSubscriptionsRoute(req, res);
}
