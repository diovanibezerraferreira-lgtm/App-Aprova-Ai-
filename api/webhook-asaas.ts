import type { IncomingMessage, ServerResponse } from 'http';
import webhookAsaasHandler, {
  handleWebhook,
  type WebhookDeps,
} from './_webhookAsaasHandler.js';

export { handleWebhook, type WebhookDeps };

export default async function handler(
  req: IncomingMessage & { body?: any },
  res: ServerResponse
) {
  return webhookAsaasHandler(req, res);
}
