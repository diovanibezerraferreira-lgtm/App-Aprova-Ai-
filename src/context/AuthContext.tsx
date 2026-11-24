import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
  ExtendedUserProfile,
  ensureUserProfile,
  registerWithEmail,
  loginWithEmail,
  loginWithGoogle,
  resolveGoogleRedirectResult,
  translateAuthError,
  requestPasswordReset,
  logout,
  updateUserProfileDoc,
  createLocalFallbackProfile
} from '../services/authService';
import {
  loadUserAnswersFromFirestore,
  loadUserSimuladosFromFirestore
} from '../services/firestoreSync';
import { UserProfile } from '../types';
import { fetchSubscriptionStatus } from '../services/asaasService';
import {
  getStoredProfile,
  saveStoredProfile,
  clearStoredProfile,
  resetUserProgress,
  mergeRemoteAnswersIntoStorage,
  mergeRemoteSimuladosIntoStorage
} from '../utils/storage';

interface AuthContextType {
  currentUser: User | null;
  userProfile: ExtendedUserProfile | null;
  isPremiumActive: boolean;
  loading: boolean;
  authModalOpen: boolean;
  authModalMode: 'login' | 'signup' | 'forgot';
  authRedirectError: string | null;
  clearAuthRedirectError: () => void;
  openAuthModal: (mode?: 'login' | 'signup' | 'forgot') => void;
  closeAuthModal: () => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  signUp: (
    name: string,
    email: string,
    pass: string,
    focus: UserProfile['studyFocus'],
    whatsapp?: string,
    whatsappConsent?: boolean,
    emailConsent?: boolean
  ) => Promise<void>;
  signIn: (email: string, pass: string) => Promise<void>;
  signInGoogle: (options?: { forcePopup?: boolean }) => Promise<'authenticated' | 'redirecting'>;
  signInLocally: (name: string, email: string, focus: UserProfile['studyFocus']) => void;
  resetPassword: (email: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  updateProfileData: (data: Partial<ExtendedUserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isProfilePremiumActive(user: User | null, profile: ExtendedUserProfile | null): boolean {
  if (!user || !profile) return false;
  const status = String(profile.subscriptionStatus || 'NONE').toUpperCase();
  if (status === 'NONE') return false;

  if (profile.premiumUntil) {
    const untilMs = /^\d{4}-\d{2}-\d{2}$/.test(profile.premiumUntil.trim())
      ? Date.parse(`${profile.premiumUntil.trim()}T23:59:59.999-03:00`)
      : Date.parse(profile.premiumUntil);
    if (!Number.isNaN(untilMs)) {
      return profile.isPremium === true && untilMs > Date.now();
    }
  }

  return profile.isPremium === true && status === 'ACTIVE';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<ExtendedUserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [authRedirectError, setAuthRedirectError] = useState<string | null>(null);

  const hydratedUidRef = useRef<string | null>(null);
  const listenerUidRef = useRef<string | null>(null);
  const reconciledUidRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let unsubscribeDoc: (() => void) | null = null;
    let authInitialized = false;
    let redirectSettled = false;

    const finishLoadingIfReady = () => {
      if (isMounted && authInitialized && redirectSettled) {
        setLoading(false);
      }
    };

    const hydrateSessionForUser = async (user: User) => {
      try {
        const profile = await ensureUserProfile(
          user,
          user.displayName || user.email?.split('@')[0] || 'Estudante',
          'OAB 1ª Fase'
        );
        if (!isMounted) return;
        setUserProfile(profile);
        saveStoredProfile(profile);

        // Hydrate cloud study progress once per UID session
        if (hydratedUidRef.current !== user.uid) {
          hydratedUidRef.current = user.uid;
          Promise.all([
            loadUserAnswersFromFirestore(),
            loadUserSimuladosFromFirestore()
          ]).then(([remoteAnswers, remoteSimulados]) => {
            mergeRemoteAnswersIntoStorage(remoteAnswers);
            mergeRemoteSimuladosIntoStorage(remoteSimulados);
          }).catch(() => {});
        }

        // Attach real-time profile listener once per UID
        if (listenerUidRef.current !== user.uid) {
          if (unsubscribeDoc) {
            unsubscribeDoc();
            unsubscribeDoc = null;
          }
          listenerUidRef.current = user.uid;
          try {
            const { doc, onSnapshot } = await import('firebase/firestore');
            const { db } = await import('../services/firebase');
            if (!isMounted) return;
            unsubscribeDoc = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
              if (!isMounted) return;
              if (snapshot.exists()) {
                const updatedData = snapshot.data() as ExtendedUserProfile;
                setUserProfile(updatedData);
                saveStoredProfile(updatedData);
              }
            }, (err) => {
              console.warn('Real-time profile listener notice:', err);
            });
          } catch (listenerErr) {
            console.warn('Could not attach profile listener:', listenerErr);
          }
        }

        // Silent one-time server reconciliation per UID for legacy subscriptions without premiumUntil
        if (
          reconciledUidRef.current !== user.uid &&
          profile.subscriptionId &&
          profile.subscriptionStatus !== 'NONE' &&
          !profile.premiumUntil &&
          !isProfilePremiumActive(user, profile)
        ) {
          reconciledUidRef.current = user.uid;
          fetchSubscriptionStatus()
            .then((statusRes) => {
              if (!isMounted) return;
              if (statusRes.isPremium || statusRes.premiumUntil) {
                setUserProfile((prev) => {
                  if (!prev || prev.id !== user.uid) return prev;
                  const nextProfile: ExtendedUserProfile = {
                    ...prev,
                    isPremium: statusRes.isPremium,
                    plan: statusRes.isPremium ? 'premium' : 'gratuito',
                    subscriptionStatus: statusRes.subscriptionStatus,
                    premiumUntil: statusRes.premiumUntil ?? prev.premiumUntil,
                  };
                  saveStoredProfile(nextProfile);
                  return nextProfile;
                });
              }
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error('Error hydrating user profile:', e);
        if (!isMounted) return;
        const fallback = getStoredProfile();
        const fallbackExt: ExtendedUserProfile = {
          ...fallback,
          id: user.uid,
          plan: 'gratuito',
          isPremium: false,
          subscriptionStatus: 'NONE',
          termsAccepted: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        setUserProfile(fallbackExt);
      }
    };

    // 1. Handle Google Redirect return (deduplicated singleton across StrictMode)
    resolveGoogleRedirectResult()
      .then((res) => {
        if (!isMounted) return;
        if (res.status === 'authenticated') {
          setAuthRedirectError(null);
          setCurrentUser(res.user);
          setUserProfile(res.profile);
          saveStoredProfile(res.profile);
          setAuthModalOpen(false);
        } else if (res.status === 'pending_without_result' && !auth.currentUser) {
          setAuthRedirectError(
            'O navegador móvel não preservou a sessão após o redirecionamento do Google (cookies/armazenamento entre domínios). Toque em "Tentar via Pop-up" ou abra no Chrome padrão. (auth/redirect-storage-blocked)'
          );
          setAuthModalMode('login');
          setAuthModalOpen(true);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Google redirect authentication notice:', err);
        setAuthRedirectError(translateAuthError(err));
        setAuthModalMode('login');
        setAuthModalOpen(true);
      })
      .finally(() => {
        redirectSettled = true;
        finishLoadingIfReady();
      });

    // 2. Listen to Firebase Auth state changes
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;
      setCurrentUser(user);

      if (user) {
        setAuthRedirectError(null);
        await hydrateSessionForUser(user);
      } else {
        hydratedUidRef.current = null;
        listenerUidRef.current = null;
        reconciledUidRef.current = null;
        if (unsubscribeDoc) {
          unsubscribeDoc();
          unsubscribeDoc = null;
        }
        setUserProfile(null);
      }

      authInitialized = true;
      finishLoadingIfReady();
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubscribeDoc) {
        unsubscribeDoc();
      }
    };
  }, []);

  const isPremiumActive = isProfilePremiumActive(currentUser, userProfile);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const user = auth.currentUser;
    if (!user) return {};
    try {
      const token = await user.getIdToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, []);

  const clearAuthRedirectError = useCallback(() => {
    setAuthRedirectError(null);
  }, []);

  const openAuthModal = (mode: 'login' | 'signup' | 'forgot' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  const signUp = async (
    name: string,
    email: string,
    pass: string,
    focus: UserProfile['studyFocus'],
    whatsapp?: string,
    whatsappConsent?: boolean,
    emailConsent?: boolean
  ) => {
    setAuthRedirectError(null);
    const profile = await registerWithEmail(name, email, pass, focus, whatsapp, whatsappConsent, emailConsent);
    setUserProfile(profile);
    saveStoredProfile(profile);
  };

  const signIn = async (email: string, pass: string) => {
    setAuthRedirectError(null);
    const user = await loginWithEmail(email, pass);
    const profile = await ensureUserProfile(
      user,
      user.displayName || email.split('@')[0],
      'OAB 1ª Fase'
    );
    setUserProfile(profile);
    saveStoredProfile(profile);
  };

  const signInGoogle = async (options?: { forcePopup?: boolean }): Promise<'authenticated' | 'redirecting'> => {
    setAuthRedirectError(null);
    const res = await loginWithGoogle(options);
    if (res.status === 'authenticated') {
      setCurrentUser(res.user);
      setUserProfile(res.profile);
      saveStoredProfile(res.profile);
      return 'authenticated';
    }
    return 'redirecting';
  };

  const signInLocally = (name: string, email: string, focus: UserProfile['studyFocus']) => {
    const profile = {
      ...createLocalFallbackProfile(name, email, focus),
      isPremium: false,
      subscriptionStatus: 'NONE' as const,
      plan: 'gratuito' as const,
    };
    setUserProfile(profile);
    saveStoredProfile(profile);
  };

  const resetPassword = async (email: string) => {
    await requestPasswordReset(email);
  };

  const signOutUser = async () => {
    try {
      await logout();
    } catch (e) {
      console.warn('Notice during signOut:', e);
    }
    hydratedUidRef.current = null;
    listenerUidRef.current = null;
    reconciledUidRef.current = null;
    setCurrentUser(null);
    setUserProfile(null);
    setAuthRedirectError(null);
    clearStoredProfile();
    resetUserProgress();
  };

  const updateProfileData = async (data: Partial<ExtendedUserProfile>) => {
    if (currentUser) {
      await updateUserProfileDoc(currentUser.uid, data);
    }
    const current = userProfile || getStoredProfile();
    const updated = { ...current, ...data, updatedAt: new Date().toISOString() } as ExtendedUserProfile;
    setUserProfile(updated);
    saveStoredProfile(updated);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        isPremiumActive,
        loading,
        authModalOpen,
        authModalMode,
        authRedirectError,
        clearAuthRedirectError,
        openAuthModal,
        closeAuthModal,
        getAuthHeaders,
        signUp,
        signIn,
        signInGoogle,
        signInLocally,
        resetPassword,
        signOutUser,
        updateProfileData
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
