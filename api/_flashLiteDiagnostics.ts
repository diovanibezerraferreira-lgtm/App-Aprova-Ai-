import { GoogleGenAI } from '@google/genai';

export interface FlashLiteDiagnosticResult {
  status: number;
  modelTested: string;
  success: boolean;
  errorCategory: string | null;
  elapsedMs: number;
}

let lastExecutionTimestamp = 0;
const COOLDOWN_MS = 10_000;

export async function runFlashLiteDiagnostic(
  apiKey: string | undefined = process.env.GEMINI_API_KEY
): Promise<FlashLiteDiagnosticResult> {
  const modelTested = 'gemini-3.5-flash-lite';
  const start = Date.now();

  const now = Date.now();
  if (now - lastExecutionTimestamp < COOLDOWN_MS) {
    return {
      status: 429,
      modelTested,
      success: false,
      errorCategory: 'RATE_LIMIT_COOLDOWN',
      elapsedMs: 0,
    };
  }
  lastExecutionTimestamp = now;

  const cleanKey = (apiKey || '').trim();
  if (!cleanKey || cleanKey === 'MY_GEMINI_API_KEY') {
    return {
      status: 503,
      modelTested,
      success: false,
      errorCategory: 'AI_PROVIDER_NOT_CONFIGURED',
      elapsedMs: Date.now() - start,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: cleanKey });
    const response = await ai.models.generateContent({
      model: modelTested,
      contents: [{ role: 'user', parts: [{ text: 'Responda apenas: TESTE OK' }] }],
      config: {
        maxOutputTokens: 32,
      },
    });

    const text = (response.text || '').trim();
    const success = text.length > 0;

    return {
      status: success ? 200 : 502,
      modelTested,
      success,
      errorCategory: success ? null : 'AI_EMPTY_RESPONSE',
      elapsedMs: Date.now() - start,
    };
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || 500);
    const msg = String(err?.message || err).toUpperCase();

    let errorCategory = 'AI_PROVIDER_ERROR';
    if (status === 401 || status === 403 || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID')) {
      errorCategory = 'AI_PROVIDER_AUTH_ERROR';
    } else if (status === 429 || msg.includes('RESOURCE_EXHAUSTED')) {
      errorCategory = 'AI_RATE_LIMIT';
    } else if (status === 503 || msg.includes('UNAVAILABLE') || msg.includes('HIGH DEMAND')) {
      errorCategory = 'AI_PROVIDER_UNAVAILABLE';
    } else if (status === 504 || msg.includes('TIMEOUT') || msg.includes('DEADLINE')) {
      errorCategory = 'AI_TIMEOUT';
    }

    return {
      status: status >= 400 && status < 600 ? status : 500,
      modelTested,
      success: false,
      errorCategory,
      elapsedMs: Date.now() - start,
    };
  }
}
