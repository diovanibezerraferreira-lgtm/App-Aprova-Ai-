import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  User,
  UserCredential
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { UserProfile, CommunicationConsentRecord } from '../types';
import firebaseConfig from '../../firebase-applet-config.json';

export interface ExtendedUserProfile extends UserProfile {
  id: string;
  plan: 'gratuito' | 'premium';
  termsAccepted: boolean;
  createdAt: string;
  updatedAt: string;
  isLocalOnly?: boolean;
}

export type GoogleLoginResult =
  | { status: 'authenticated'; profile: ExtendedUserProfile; user: User }
  | { status: 'redirecting' };

export type GoogleRedirectCheckResult =
  | { status: 'authenticated'; profile: ExtendedUserProfile; user: User }
  | { status: 'pending_without_result' }
  | { status: 'none' };

const REDIRECT_PENDING_KEY = 'aprova_google_redirect_pending';
const REDIRECT_PENDING_TTL_MS = 5 * 60 * 1000;

let redirectResultPromise: Promise<GoogleRedirectCheckResult> | null = null;
const inFlightProfilePromises = new Map<string, Promise<ExtendedUserProfile>>();

export function isInsideIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isMobileOrStandalone(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const isStandalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    Boolean((navigator as any).standalone);
  return isMobileUa || isStandalone;
}

export function clearRedirectPending(): void {
  try {
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  } catch {
    // Ignore storage access errors
  }
}

function markRedirectPending(): void {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, String(Date.now()));
  } catch {
    // Ignore storage access errors
  }
}

function consumeRedirectPendingFlag(): boolean {
  try {
    const raw = sessionStorage.getItem(REDIRECT_PENDING_KEY);
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < REDIRECT_PENDING_TTL_MS;
  } catch {
    return false;
  }
}

export function extractFirebaseErrorDetails(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const errObj = error as { code?: unknown; message?: unknown; customData?: { _tokenResponse?: { error?: { message?: string } } } };
    let code = typeof errObj.code === 'string' ? errObj.code.trim() : '';
    const rawMessage = typeof errObj.message === 'string' ? errObj.message.trim() : String(error);
    if (!code) {
      const codeMatch = rawMessage.match(/auth\/[a-z0-9-]+/i);
      if (codeMatch) {
        code = codeMatch[0].toLowerCase();
      }
    }
    return { code, message: rawMessage };
  }

  if (typeof error === 'string') {
    const codeMatch = error.match(/auth\/[a-z0-9-]+/i);
    return { code: codeMatch ? codeMatch[0].toLowerCase() : '', message: error.trim() };
  }

  return { code: '', message: '' };
}

export function isOperationNotAllowedError(error: unknown): boolean {
  const { code, message } = extractFirebaseErrorDetails(error);
  const combined = `${code} ${message}`.toLowerCase();
  return combined.includes('operation-not-allowed') || combined.includes('operation_not_allowed');
}

export function isUnauthorizedDomainError(error: unknown): boolean {
  const { code, message } = extractFirebaseErrorDetails(error);
  const combined = `${code} ${message}`.toLowerCase();
  return combined.includes('unauthorized-domain') || combined.includes('unauthorized_domain');
}

export function translateAuthError(error: unknown): string {
  const { code, message } = extractFirebaseErrorDetails(error);
  const normalizedCode = code.toLowerCase();
  const normalizedMsg = message.toLowerCase();
  const displayCode = normalizedCode || 'erro-desconhecido';
  const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';

  if (normalizedCode === 'auth/unauthorized-domain' || normalizedMsg.includes('unauthorized-domain')) {
    return `O domínio "${currentHost || 'atual'}" não está autorizado no Firebase Authentication (${displayCode}). Verifique Authentication > Settings > Authorized domains no Firebase Console.`;
  }
  if (normalizedCode === 'auth/operation-not-allowed' || normalizedMsg.includes('operation_not_allowed')) {
    return `Este método de login ainda não está ativado no Firebase Console deste projeto (${displayCode}).`;
  }
  if (normalizedCode === 'auth/popup-blocked') {
    return `O navegador bloqueou a janela pop-up de login do Google (${displayCode}). Libere pop-ups ou utilize o redirecionamento.`;
  }
  if (normalizedCode === 'auth/popup-closed-by-user') {
    return `A janela de login com o Google foi fechada antes da conclusão (${displayCode}).`;
  }
  if (normalizedCode === 'auth/cancelled-popup-request') {
    return `A solicitação de login com o Google foi interrompida ou substituída pelo navegador (${displayCode}). Tente novamente.`;
  }
  if (normalizedCode === 'auth/account-exists-with-different-credential') {
    return `Já existe uma conta com este e-mail vinculada a outro método de login (ex.: E-mail e Senha). Entre com o método original primeiro (${displayCode}).`;
  }
  if (normalizedCode === 'auth/redirect-cancelled-by-user') {
    return `O redirecionamento de login com o Google foi cancelado antes da conclusão (${displayCode}).`;
  }
  if (normalizedCode === 'auth/redirect-operation-pending') {
    return `Já existe uma operação de login com o Google em andamento (${displayCode}). Aguarde alguns segundos e tente novamente.`;
  }
  if (normalizedCode === 'auth/operation-not-supported-in-this-environment') {
    return `Este navegador ou ambiente não suporta o método de autenticação escolhido (${displayCode}).`;
  }
  if (normalizedCode === 'auth/web-storage-unsupported' || normalizedMsg.includes('web storage')) {
    return `Os cookies ou Web Storage estão bloqueados neste navegador. Ative os cookies para entrar com o Google (${displayCode}).`;
  }
  if (normalizedCode === 'auth/email-already-in-use' || normalizedMsg.includes('email_exists')) {
    return `Este endereço de e-mail já está em uso. Tente fazer login ou entre com o Google (${displayCode}).`;
  }
  if (normalizedCode === 'auth/invalid-email') {
    return `O formato do e-mail informado não é válido (${displayCode}).`;
  }
  if (normalizedCode === 'auth/weak-password') {
    return `A senha é muito fraca. Utilize pelo menos 6 caracteres (${displayCode}).`;
  }
  if (
    normalizedCode === 'auth/wrong-password' ||
    normalizedCode === 'auth/user-not-found' ||
    normalizedCode === 'auth/invalid-credential'
  ) {
    return `E-mail ou senha incorretos. Se você criou sua conta pelo Google, use o botão "Entrar com o Google" ou clique em "Esqueceu a senha?" (${displayCode}).`;
  }
  if (normalizedCode === 'auth/user-disabled') {
    return `Esta conta de usuário foi temporariamente desativada (${displayCode}).`;
  }
  if (normalizedCode === 'auth/too-many-requests') {
    return `Muitas tentativas consecutivas detectadas pelo Firebase. Aguarde alguns instantes e tente novamente (${displayCode}).`;
  }
  if (normalizedCode === 'auth/network-request-failed') {
    return `Falha de conexão de rede ao contatar o Firebase/Google. Verifique sua internet (${displayCode}).`;
  }
  if (normalizedCode === 'auth/internal-error') {
    return `Erro interno retornado pelo Firebase Authentication (${displayCode}): ${message || 'falha de comunicação com o provedor Google'}`;
  }
  if (
    normalizedCode === 'auth/invalid-api-key' ||
    normalizedCode === 'auth/app-not-authorized' ||
    normalizedCode === 'auth/configuration-not-found'
  ) {
    return `Configuração do projeto Firebase inválida ou não autorizada para este aplicativo (${displayCode}).`;
  }
  if (normalizedMsg.includes('permission-denied') || normalizedMsg.includes('missing or insufficient permissions')) {
    return `Permissão insuficiente no Firestore para ler ou gravar o perfil do usuário (${normalizedCode || 'permission-denied'}).`;
  }

  // Never hide real Firebase errors: always expose code + clean message
  const cleanMsg = message
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^Firebase:\s*/i, '')
    .trim();

  if (normalizedCode && cleanMsg) {
    return `Erro Firebase (${normalizedCode}): ${cleanMsg}`;
  }
  if (normalizedCode) {
    return `Erro Firebase (${normalizedCode}).`;
  }
  if (cleanMsg && !cleanMsg.includes('[object')) {
    return `Erro na autenticação: ${cleanMsg}`;
  }

  return 'Não foi possível concluir a autenticação (código não retornado pelo navegador).';
}

export async function fetchUserProfile(uid: string): Promise<{ profile: ExtendedUserProfile | null; readFailed: boolean }> {
  try {
    const docRef = doc(db, 'users', uid);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      return { profile: null, readFailed: false };
    }
    const data = snap.data() as ExtendedUserProfile;
    if (!data.consents) {
      data.consents = { whatsapp: false, email: false };
    }
    if (data.whatsapp === undefined) {
      data.whatsapp = '';
    }
    if (!data.consentHistory) {
      data.consentHistory = [];
    }
    return { profile: data, readFailed: false };
  } catch (error) {
    console.warn('Notice reading user profile from Firestore:', error);
    return { profile: null, readFailed: true };
  }
}

export async function createUserProfileDoc(
  user: User,
  name: string,
  studyFocus: UserProfile['studyFocus'],
  dailyGoalQuestions: number = 20,
  whatsapp?: string,
  whatsappConsent?: boolean,
  emailConsent?: boolean,
  consentVersion: string = 'v1.0',
  consentOrigin: 'onboarding' | 'profile_settings' = 'onboarding'
): Promise<ExtendedUserProfile> {
  const now = new Date().toISOString();
  const consents = {
    whatsapp: Boolean(whatsappConsent),
    email: Boolean(emailConsent)
  };
  const consentHistory: CommunicationConsentRecord[] = [];
  if (whatsappConsent) {
    consentHistory.push({
      channel: 'whatsapp',
      granted: true,
      timestamp: now,
      version: consentVersion,
      origin: consentOrigin
    });
  }
  if (emailConsent) {
    consentHistory.push({
      channel: 'email',
      granted: true,
      timestamp: now,
      version: consentVersion,
      origin: consentOrigin
    });
  }

  const profile: ExtendedUserProfile = {
    id: user.uid,
    name: name || user.displayName || user.email?.split('@')[0] || 'Estudante',
    email: user.email || '',
    isRegistered: true,
    plan: 'gratuito',
    studyFocus: studyFocus || 'OAB 1ª Fase',
    dailyGoalQuestions: dailyGoalQuestions || 20,
    memberSince: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    termsAccepted: true,
    isPremium: false,
    subscriptionStatus: 'NONE',
    whatsapp: whatsapp || '',
    consents,
    consentHistory,
    createdAt: now,
    updatedAt: now
  };

  try {
    const docRef = doc(db, 'users', user.uid);
    const existing = await getDoc(docRef);
    if (existing.exists()) {
      const existingData = existing.data() as ExtendedUserProfile;
      if (!existingData.consents) {
        existingData.consents = consents;
      }
      if (existingData.whatsapp === undefined) {
        existingData.whatsapp = whatsapp || '';
      }
      if (!existingData.consentHistory) {
        existingData.consentHistory = consentHistory;
      }
      return existingData;
    }
    await setDoc(docRef, profile);
  } catch (error) {
    console.warn('Notice saving profile in Firestore, keeping in session cache:', error);
  }
  return profile;
}

/**
 * Ensures at most ONE Firestore read/create runs per UID at a time,
 * avoiding race conditions or duplicate sessions between getRedirectResult,
 * signInWithPopup, and onAuthStateChanged.
 */
export async function ensureUserProfile(
  user: User,
  fallbackName?: string,
  studyFocus: UserProfile['studyFocus'] = 'OAB 1ª Fase'
): Promise<ExtendedUserProfile> {
  const existingPromise = inFlightProfilePromises.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const task: Promise<ExtendedUserProfile> = (async (): Promise<ExtendedUserProfile> => {
    const { profile, readFailed } = await fetchUserProfile(user.uid);
    if (profile) {
      return profile;
    }

    if (readFailed) {
      // Do NOT attempt setDoc overwrite if Firestore read failed (e.g. offline)
      const now = new Date().toISOString();
      return {
        id: user.uid,
        name: fallbackName || user.displayName || user.email?.split('@')[0] || 'Estudante',
        email: user.email || '',
        isRegistered: true,
        plan: 'gratuito',
        studyFocus,
        dailyGoalQuestions: 20,
        memberSince: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        termsAccepted: true,
        isPremium: false,
        subscriptionStatus: 'NONE',
        whatsapp: '',
        consents: { whatsapp: false, email: false },
        consentHistory: [],
        createdAt: now,
        updatedAt: now
      };
    }

    return createUserProfileDoc(
      user,
      fallbackName || user.displayName || user.email?.split('@')[0] || 'Estudante',
      studyFocus
    );
  })().finally(() => {
    inFlightProfilePromises.delete(user.uid);
  });

  inFlightProfilePromises.set(user.uid, task);
  return task;
}

export async function updateUserProfileDoc(uid: string, data: Partial<ExtendedUserProfile>): Promise<void> {
  try {
    const docRef = doc(db, 'users', uid);
    await updateDoc(docRef, {
      ...data,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn('Notice updating profile in Firestore:', error);
  }
}

export async function registerWithEmail(
  name: string,
  email: string,
  pass: string,
  studyFocus: UserProfile['studyFocus'],
  whatsapp?: string,
  whatsappConsent?: boolean,
  emailConsent?: boolean
): Promise<ExtendedUserProfile> {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Continue with default persistence
  }

  const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
  const user = userCredential.user;

  if (name) {
    try {
      await updateProfile(user, { displayName: name });
    } catch (e) {
      console.warn('Notice updating displayName:', e);
    }
  }

  return createUserProfileDoc(user, name, studyFocus, 20, whatsapp, whatsappConsent, emailConsent, 'v1.0', 'onboarding');
}

export async function loginWithEmail(email: string, pass: string): Promise<User> {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Continue with default persistence
  }
  const userCredential = await signInWithEmailAndPassword(auth, email, pass);
  return userCredential.user;
}

async function startGoogleRedirect(): Promise<GoogleLoginResult> {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Continue with default persistence
  }

  markRedirectPending();
  try {
    await signInWithRedirect(auth, googleProvider);
    return { status: 'redirecting' };
  } catch (err) {
    clearRedirectPending();
    throw err;
  }
}

function shouldFallbackToRedirect(error: unknown): boolean {
  const { code } = extractFirebaseErrorDetails(error);
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/internal-error'
  );
}

export async function loginWithGoogle(options?: { forcePopup?: boolean }): Promise<GoogleLoginResult> {
  const forcePopup = Boolean(options?.forcePopup);
  const inIframe = isInsideIframe();
  const isMobile = isMobileOrStandalone();

  // On mobile/Android/standalone PWA (outside iframe), use signInWithRedirect directly
  // so Android Chrome / Custom Tabs / PWA don't get stuck on popup windows.
  if (!forcePopup && !inIframe && isMobile) {
    return startGoogleRedirect();
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Continue with default persistence
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    clearRedirectPending();
    const user = result.user;
    const profile = await ensureUserProfile(user, user.displayName || '', 'OAB 1ª Fase');
    return { status: 'authenticated', profile, user };
  } catch (err) {
    if (!forcePopup && !inIframe && shouldFallbackToRedirect(err)) {
      return startGoogleRedirect();
    }
    throw err;
  }
}

/**
 * Resolves Google redirect result at most ONCE per page load (React StrictMode safe).
 */
export async function resolveGoogleRedirectResult(): Promise<GoogleRedirectCheckResult> {
  if (redirectResultPromise) {
    return redirectResultPromise;
  }

  redirectResultPromise = (async (): Promise<GoogleRedirectCheckResult> => {
    const wasPending = consumeRedirectPendingFlag();
    let result: UserCredential | null = null;

    try {
      result = await getRedirectResult(auth);
    } catch (err) {
      clearRedirectPending();
      throw err;
    }

    if (result?.user) {
      const profile = await ensureUserProfile(
        result.user,
        result.user.displayName || '',
        'OAB 1ª Fase'
      );
      return {
        status: 'authenticated',
        profile,
        user: result.user,
      };
    }

    if (wasPending) {
      try {
        await auth.authStateReady();
      } catch {
        // Ignore
      }
      if (auth.currentUser) {
        const profile = await ensureUserProfile(
          auth.currentUser,
          auth.currentUser.displayName || '',
          'OAB 1ª Fase'
        );
        return {
          status: 'authenticated',
          profile,
          user: auth.currentUser,
        };
      }
      return { status: 'pending_without_result' };
    }

    return { status: 'none' };
  })();

  return redirectResultPromise;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function logout(): Promise<void> {
  clearRedirectPending();
  await signOut(auth);
}

// Local registration fallback so student can study immediately without being blocked
export function createLocalFallbackProfile(
  name: string,
  email: string,
  studyFocus: UserProfile['studyFocus']
): ExtendedUserProfile {
  const now = new Date().toISOString();
  return {
    id: 'local_' + Date.now(),
    name: name || 'Estudante',
    email: email || 'estudante@aprovadireito.com.br',
    isRegistered: true,
    plan: 'gratuito',
    studyFocus: studyFocus || 'OAB 1ª Fase',
    dailyGoalQuestions: 20,
    memberSince: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    termsAccepted: true,
    isPremium: false,
    createdAt: now,
    updatedAt: now,
    isLocalOnly: true
  };
}

export function getFirebaseConsoleAuthUrl(): string {
  return `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;
}
