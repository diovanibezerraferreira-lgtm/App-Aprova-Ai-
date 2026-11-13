import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, initializeFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';

const DEFAULT_PROJECT_ID = 'gen-lang-client-0793753103';
const DEFAULT_DATABASE_ID = 'ai-studio-aprovadireito-858e292a-4f1d-4483-a130-1a8041386c5a';

let cachedApp: App | null = null;
let cachedTokenVerifyApp: App | null = null;
let cachedFirestore: Firestore | null = null;
let cachedFirestoreDbId: string | null = null;
let lastAdminInitError: string | null = null;

function cleanEnvValue(value?: string): string {
  if (!value) return '';
  let trimmed = value.trim();
  // Remove trailing comma if pasted directly from JSON
  if (trimmed.endsWith(',') && (trimmed.startsWith('"') || trimmed.startsWith("'"))) {
    trimmed = trimmed.slice(0, -1).trim();
  }
  while (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function scrubSensitiveText(message: string): string {
  return message.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[CHAVE_PRIVADA_OCULTA]');
}

export function normalizePrivateKey(rawKey?: string): string {
  if (!rawKey || typeof rawKey !== 'string') return '';
  let key = rawKey.trim();
  if (!key) return '';

  // Handle pasted JSON key-value pair like: "private_key": "-----BEGIN..."
  const jsonFieldMatch = key.match(/^["']?private_key["']?\s*:\s*([\s\S]+)$/i);
  if (jsonFieldMatch) {
    key = jsonFieldMatch[1].trim();
  }

  // Strip trailing comma left over from JSON copy-paste
  if (key.endsWith(',')) {
    key = key.slice(0, -1).trim();
  }

  // If JSON-string-encoded (e.g. "\"-----BEGIN...\\n\""), decode via JSON.parse
  if (key.startsWith('"') && key.endsWith('"')) {
    try {
      const parsed = JSON.parse(key);
      if (typeof parsed === 'string') {
        key = parsed;
      }
    } catch {
      // Fallback to manual quote stripping below
    }
  }

  key = cleanEnvValue(key);

  // Support Base64-encoded PEM stored in FIREBASE_PRIVATE_KEY
  if (!key.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(key)) {
    try {
      const decoded = Buffer.from(key.replace(/\s+/g, ''), 'base64').toString('utf-8');
      if (decoded.includes('-----BEGIN') && decoded.includes('PRIVATE KEY-----')) {
        key = decoded.trim();
      }
    } catch {
      // Ignore invalid base64
    }
  }

  // Normalize escaped and real line breaks while preserving exact key characters
  key = key
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Re-strip quotes if exposed after unescaping
  key = cleanEnvValue(key);

  // Ensure valid PEM structure (supports multi-line or single-line space-separated Vercel pastes)
  const pemMatch = key.match(/(-----BEGIN [A-Z0-9 ]+-----)([\s\S]+?)(-----END [A-Z0-9 ]+-----)/);
  if (pemMatch) {
    const header = pemMatch[1].trim();
    const rawBody = pemMatch[2].trim();
    const footer = pemMatch[3].trim();

    // If body contains spaces (e.g. single-line paste turned newlines into spaces) or has no newlines,
    // re-wrap the exact base64 characters into standard 64-char PEM lines without altering any key character.
    const normalizedLines = rawBody
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const hasInlineSpacesOrSingleLine =
      normalizedLines.length <= 1 || normalizedLines.some((line) => /\s/.test(line));

    const body = hasInlineSpacesOrSingleLine
      ? (rawBody.replace(/\s+/g, '').match(/.{1,64}/g) || []).join('\n')
      : normalizedLines.join('\n');

    return `${header}\n${body}\n${footer}\n`;
  }

  return key;
}

function parseServiceAccountJson(rawJson: string): any {
  const cleaned = cleanEnvValue(rawJson);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  } catch {
    // Support Base64-encoded service account JSON
    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.private_key === 'string') {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  }
}

function getConfigFromFile(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getTargetProjectId(): string {
  const fileConfig = getConfigFromFile();
  return (
    cleanEnvValue(process.env.FIREBASE_PROJECT_ID) ||
    fileConfig.projectId ||
    DEFAULT_PROJECT_ID
  );
}

function getTargetDatabaseId(): string {
  const fileConfig = getConfigFromFile();
  return (
    cleanEnvValue(process.env.FIRESTORE_DATABASE_ID) ||
    fileConfig.firestoreDatabaseId ||
    DEFAULT_DATABASE_ID
  );
}

export function hasAdminCredentials(): boolean {
  const saJson = cleanEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const clientEmail = cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const gac = cleanEnvValue(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  return Boolean(saJson || (clientEmail && privateKey) || gac);
}

export function getFirebaseAdminDiagnostics() {
  const saJson = cleanEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const clientEmail = cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  return {
    projectId: getTargetProjectId(),
    databaseId: getTargetDatabaseId(),
    hasServiceAccountJson: Boolean(saJson),
    hasClientEmail: Boolean(clientEmail),
    hasPrivateKey: Boolean(privateKey && privateKey.includes('PRIVATE KEY')),
    isVercel: process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV),
    lastAdminInitError,
  };
}

export function getFirebaseAdminApp(): App | null {
  if (cachedApp) {
    return cachedApp;
  }

  try {
    const existingApps = getApps();
    const defaultExisting = existingApps.find((a) => a.name === '[DEFAULT]');
    if (defaultExisting) {
      cachedApp = defaultExisting;
      return cachedApp;
    }

    const projectId = getTargetProjectId();
    const serviceAccountJson = cleanEnvValue(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    const clientEmail = cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL);
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (serviceAccountJson) {
      const parsed = parseServiceAccountJson(serviceAccountJson);
      cachedApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || projectId,
      });
      lastAdminInitError = null;
      return cachedApp;
    }

    if (clientEmail && privateKey) {
      if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
        lastAdminInitError =
          'FIREBASE_PRIVATE_KEY em formato inválido (esperado PEM com BEGIN/END PRIVATE KEY).';
        console.error(lastAdminInitError);
        return null;
      }
      cachedApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
      lastAdminInitError = null;
      return cachedApp;
    }

    // Do NOT silently fall back to GCE metadata lookup on Vercel without credentials:
    // querying 169.254.169.254 on AWS Lambda hangs Firestore calls until 408/504 timeout.
    const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
    const hasGac = Boolean(cleanEnvValue(process.env.GOOGLE_APPLICATION_CREDENTIALS));
    if (isVercel && !hasGac) {
      lastAdminInitError =
        'Credenciais do Firebase Admin não configuradas (defina FIREBASE_SERVICE_ACCOUNT_KEY ou FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).';
      console.error(lastAdminInitError);
      return null;
    }

    // GCP / Cloud Run ADC fallback
    cachedApp = initializeApp({ projectId });
    lastAdminInitError = null;
    return cachedApp;
  } catch (err: any) {
    lastAdminInitError = scrubSensitiveText(
      err?.message || 'Falha desconhecida ao inicializar Firebase Admin SDK.'
    );
    console.error('Erro ao inicializar Firebase Admin SDK:', lastAdminInitError);
    return null;
  }
}

/**
 * Returns a Firestore Admin instance forced to HTTP/1.1 REST transport (`preferRest: true`).
 * Using REST instead of gRPC prevents cold-start channel/HTTP2 stalls and 408 timeouts
 * in serverless runtimes like Vercel.
 */
export function getAdminFirestore(): Firestore | null {
  const app = getFirebaseAdminApp();
  if (!app) return null;

  const dbId = getTargetDatabaseId();
  if (cachedFirestore && cachedFirestoreDbId === dbId) {
    return cachedFirestore;
  }

  try {
    cachedFirestore = dbId
      ? initializeFirestore(app, { preferRest: true }, dbId)
      : initializeFirestore(app, { preferRest: true });
    cachedFirestoreDbId = dbId;
    return cachedFirestore;
  } catch (err: any) {
    // initializeFirestore throws if the Firestore instance for this (app, dbId) was already created
    try {
      cachedFirestore = dbId ? getFirestore(app, dbId) : getFirestore(app);
      cachedFirestoreDbId = dbId;
      return cachedFirestore;
    } catch (fallbackErr: any) {
      console.warn('Aviso ao obter Firestore Admin para databaseId:', dbId, err?.message || fallbackErr);
      return null;
    }
  }
}

function getTokenVerificationApp(): App | null {
  const adminApp = getFirebaseAdminApp();
  if (adminApp) return adminApp;

  if (cachedTokenVerifyApp) return cachedTokenVerifyApp;

  try {
    const projectId = getTargetProjectId();
    const existing = getApps().find((a) => a.name === 'token-verifier');
    cachedTokenVerifyApp = existing || initializeApp({ projectId }, 'token-verifier');
    return cachedTokenVerifyApp;
  } catch (err) {
    console.warn('Erro ao criar app auxiliar para verificação de token:', err);
    return null;
  }
}

export async function verifyFirebaseUser(
  req: any
): Promise<{ uid: string; email: string; name?: string }> {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    const err: any = new Error(
      'Cabeçalho de autorização não fornecido ou inválido (formato esperado: Bearer <token>).'
    );
    err.status = 401;
    throw err;
  }

  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    const err: any = new Error('Token de autenticação ausente.');
    err.status = 401;
    throw err;
  }

  const app = getTokenVerificationApp();
  if (!app) {
    const err: any = new Error(
      'Firebase Admin SDK não inicializado no servidor. Configure as variáveis de ambiente do Firebase.'
    );
    err.status = 500;
    throw err;
  }

  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email || '',
      name: decoded.name || '',
    };
  } catch (err: any) {
    console.error('Erro ao verificar token Firebase:', err);
    const authErr: any = new Error(
      `Token de autenticação inválido ou expirado: ${err.message || 'não autorizado'}`
    );
    authErr.status = 401;
    throw authErr;
  }
}
