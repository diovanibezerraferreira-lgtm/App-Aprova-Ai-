import type { IncomingMessage, ServerResponse } from 'http';
import materialsHandler from './_content/materials.js';
import briefsHandler from './_content/briefs.js';

export type ContentRouteResource = 'materials' | 'briefs';

export interface ContentRouterDeps {
  materials?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  briefs?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.end(JSON.stringify(payload));
}

export function resolveContentResource(req: IncomingMessage): ContentRouteResource | null {
  try {
    const parsed = new URL(req.url || '/api/content', 'http://localhost');
    const explicitResource = (parsed.searchParams.get('__resource') || '').trim().toLowerCase();
    if (explicitResource === 'materials' || explicitResource === 'briefs') {
      return explicitResource;
    }
    if (explicitResource) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (pathname === '/api/materials') return 'materials';
    if (pathname === '/api/briefs') return 'briefs';
    return null;
  } catch {
    return null;
  }
}

export async function handleContentRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps?: ContentRouterDeps
): Promise<void> {
  const resource = resolveContentResource(req);
  if (resource === 'materials') {
    const fn = deps?.materials || materialsHandler;
    return fn(req, res);
  }
  if (resource === 'briefs') {
    const fn = deps?.briefs || briefsHandler;
    return fn(req, res);
  }

  return sendJson(res, 404, {
    error: 'NOT_FOUND',
    message: 'Recurso de conteúdo não encontrado.',
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  return handleContentRoute(req, res);
}
