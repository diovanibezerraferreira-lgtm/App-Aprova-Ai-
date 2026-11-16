import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
  ExtendedUserProfile,
  fetchUserProfile,
  registerWithEmail,
  loginWithEmail,
  loginWithGoogle,
  requestPasswordReset,
  logout,
  updateUserProfileDoc,
  createUserProfileDoc,
  createLocalFallbackProfile
} from '../services/authService';
import {
  loadUserAnswersFromFirestore,
  loadUserSimuladosFromFirestore
} from '../services/firestoreSync';
import { UserProfile } from '../types';
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
  openAuthModal: (mode?: 'login' | 'signup' | 'forgot') => void;
  closeAuthModal: () => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  signUp: (name: string, email: string, pass: string, focus: UserProfile['studyFocus']) => Promise<void>;
  signIn: (email: string, pass: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInLocally: (name: string, email: string, focus: UserProfile['studyFocus']) => void;
  resetPassword: (email: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  updateProfileData: (data: Partial<ExtendedUserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isProfilePremiumActive(user: User | null, profile: ExtendedUserProfile | null): boolean {
  if (!user || !profile) return false;
  return profile.isPremium === true && profile.subscriptionStatus === 'ACTIVE';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<ExtendedUserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup' | 'forgot'>('login');

  useEffect(() => {
    let unsubscribeDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = null;
      }

      setCurrentUser(user);
      if (user) {
        try {
          let profile = await fetchUserProfile(user.uid);
          if (!profile) {
            profile = await createUserProfileDoc(
              user,
              user.displayName || user.email?.split('@')[0] || 'Estudante',
              'OAB 1ª Fase'
            );
          }
          setUserProfile(profile);
          saveStoredProfile(profile);

          // Hydrate cloud study progress on login
          Promise.all([
            loadUserAnswersFromFirestore(),
            loadUserSimuladosFromFirestore()
          ]).then(([remoteAnswers, remoteSimulados]) => {
            mergeRemoteAnswersIntoStorage(remoteAnswers);
            mergeRemoteSimuladosIntoStorage(remoteSimulados);
          }).catch(() => {});

          // Real-time listener: When Asaas Webhook updates user doc, UI updates automatically!
          try {
            const { doc, onSnapshot } = await import('firebase/firestore');
            const { db } = await import('../services/firebase');
            unsubscribeDoc = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
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
        } catch (e) {
          console.error('Error fetching user profile:', e);
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
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => {
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

  const openAuthModal = (mode: 'login' | 'signup' | 'forgot' = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  const signUp = async (name: string, email: string, pass: string, focus: UserProfile['studyFocus']) => {
    const profile = await registerWithEmail(name, email, pass, focus);
    setUserProfile(profile);
    saveStoredProfile(profile);
  };

  const signIn = async (email: string, pass: string) => {
    const user = await loginWithEmail(email, pass);
    let profile = await fetchUserProfile(user.uid);
    if (!profile) {
      profile = await createUserProfileDoc(user, user.displayName || email.split('@')[0], 'OAB 1ª Fase');
    }
    setUserProfile(profile);
    saveStoredProfile(profile);
  };

  const signInGoogle = async () => {
    const profile = await loginWithGoogle();
    setUserProfile(profile);
    saveStoredProfile(profile);
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
    setCurrentUser(null);
    setUserProfile(null);
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
