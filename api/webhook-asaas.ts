import type { IncomingMessage, ServerResponse } from 'http';
import webhookBasicsHandler, { handleWebhook, type WebhookDeps } from './webhook-basics.js';

export { handleWebhook, type WebhookDeps };

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
) {
  return webhookBasicsHandler(req, res);
}
