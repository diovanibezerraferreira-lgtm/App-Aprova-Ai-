import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables (.env / .env.local)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getCliArg(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) {
      return args[i + 1];
    }
    if (arg.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }
  }
  return undefined;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const cliPort = getCliArg('port');
  const cliHost = getCliArg('host') || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';
  const envPort = !isProd && process.env.PORT === '8080' ? undefined : process.env.PORT;
  const PORT = parseInt(cliPort || envPort || '3000', 10) || 3000;
  const disableHmr = process.env.DISABLE_HMR === 'true';

  // Parse JSON bodies for API endpoints
  app.use('/api', express.json({ limit: '1mb' }));

  // Mount API endpoints matching Vercel serverless functions in /api/
  app.all('/api/create-subscription', async (req, res) => {
    try {
      const { default: handler } = await import('./api/create-subscription.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/create-subscription:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/webhook-asaas', async (req, res) => {
    try {
      const { default: handler } = await import('./api/webhook-asaas.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/webhook-asaas:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/subscription-status', async (req, res) => {
    try {
      const { default: handler } = await import('./api/subscription-status.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/subscription-status:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/subscription-history', async (req, res) => {
    try {
      const { default: handler } = await import('./api/subscription-history.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/subscription-history:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/questions', async (req, res) => {
    try {
      const { default: handler } = await import('./api/questions.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/questions:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/simulados', async (req, res) => {
    try {
      const { default: handler } = await import('./api/simulados.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/simulados:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/briefs', async (req, res) => {
    try {
      const { default: handler } = await import('./api/briefs.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/briefs:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  app.all('/api/materials', async (req, res) => {
    try {
      const { default: handler } = await import('./api/materials.js');
      await handler(req, res);
    } catch (err: any) {
      console.error('Error in /api/materials:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Internal server error' });
      }
    }
  });

  // Safe healthcheck endpoint (never leaks secret keys)
  app.get('/api/health', (_req, res) => {
    const hasAsaasKey = !!process.env.ASAAS_API_KEY;
    const hasWebhookToken = !!process.env.ASAAS_WEBHOOK_TOKEN;
    const asaasEnv = process.env.ASAAS_ENVIRONMENT || 'sandbox';

    res.json({
      status: 'ok',
      asaas: {
        configured: hasAsaasKey,
        environment: asaasEnv,
        hasWebhookToken,
      },
      timestamp: new Date().toISOString(),
    });
  });

  if (isProd) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Dev mode with Vite middleware bound cleanly to the shared HTTP server
    // Attach server.ws to httpServer even when HMR is disabled so Vite 8 client
    // connects on the active server port instead of falling back to port 24678.
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, cliHost, () => {
    console.log(
      `Server running on http://${cliHost}:${PORT} in ${isProd ? 'production' : 'development'} mode (HMR: ${disableHmr ? 'disabled' : 'attached'})`
    );
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
