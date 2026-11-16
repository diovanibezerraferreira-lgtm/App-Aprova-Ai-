import { QuestionAnswerRecord, SimuladoResult, UserProfile } from '../types';
import { syncAnswerToFirestore, syncSimuladoToFirestore } from '../services/firestoreSync';

const PROFILE_KEY = 'aprova_direito_profile';
const ANSWERS_KEY = 'aprova_direito_answers';
const SIMULADOS_KEY = 'aprova_direito_simulados';

const DEFAULT_PROFILE: UserProfile = {
  name: 'Estudante Concurseiro',
  email: 'estudante@aprovadireito.com.br',
  isRegistered: false,
  studyFocus: 'OAB 1ª Fase',
  targetExamDate: '2026-11-29',
  dailyGoalQuestions: 20,
  memberSince: 'Novembro de 2026',
  isPremium: false,
  subscriptionStatus: 'NONE',
};

export const getStoredProfile = (): UserProfile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw);
    // Security: NEVER trust Premium or subscription status flags from localStorage
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      isPremium: false,
      subscriptionStatus: 'NONE',
    };
  } catch {
    return DEFAULT_PROFILE;
  }
};

export const saveStoredProfile = (profile: UserProfile): void => {
  try {
    // Security: never persist authoritative Premium flags into localStorage
    const sanitizedProfile: UserProfile = {
      ...profile,
      isPremium: false,
      subscriptionStatus: 'NONE',
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(sanitizedProfile));
  } catch (e) {
    console.error('Failed to save profile', e);
  }
};

export const clearStoredProfile = (): void => {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch (e) {
    console.error('Failed to clear profile', e);
  }
};

export const getStoredAnswers = (): QuestionAnswerRecord[] => {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const saveQuestionAnswer = (record: QuestionAnswerRecord): QuestionAnswerRecord[] => {
  try {
    const current = getStoredAnswers();
    const filtered = current.filter(a => a.questionId !== record.questionId);
    filtered.push(record);
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(filtered));

    // Async sync to Firestore when authenticated
    syncAnswerToFirestore(record).catch(err => {
      console.warn('Silent Firestore sync notice:', err);
    });

    return filtered;
  } catch (e) {
    console.error('Failed to save answer', e);
    return [];
  }
};

export const mergeRemoteAnswersIntoStorage = (remoteRecords: QuestionAnswerRecord[]): void => {
  try {
    if (!Array.isArray(remoteRecords) || remoteRecords.length === 0) return;
    const current = getStoredAnswers();
    const byId = new Map<string, QuestionAnswerRecord>();
    for (const r of current) byId.set(r.questionId, r);
    for (const r of remoteRecords) {
      const existing = byId.get(r.questionId);
      if (!existing || r.timestamp > existing.timestamp) {
        byId.set(r.questionId, r);
      }
    }
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(Array.from(byId.values())));
  } catch (e) {
    console.error('Failed to merge remote answers', e);
  }
};

export const resetQuestionAnswers = (questionIds: string[]): QuestionAnswerRecord[] => {
  try {
    const current = getStoredAnswers();
    const idSet = new Set(questionIds);
    const filtered = current.filter(a => !idSet.has(a.questionId));
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(filtered));
    return filtered;
  } catch (e) {
    console.error('Failed to reset answers', e);
    return [];
  }
};

export const getStoredSimulados = (): SimuladoResult[] => {
  try {
    const raw = localStorage.getItem(SIMULADOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const saveSimuladoResult = (result: SimuladoResult): void => {
  try {
    const current = getStoredSimulados();
    current.unshift(result);
    const trimmed = current.slice(0, 20);
    localStorage.setItem(SIMULADOS_KEY, JSON.stringify(trimmed));

    // Async sync to Firestore when authenticated
    syncSimuladoToFirestore(result).catch(err => {
      console.warn('Silent Firestore sync notice:', err);
    });
  } catch (e) {
    console.error('Failed to save simulado result', e);
  }
};

export const mergeRemoteSimuladosIntoStorage = (remoteResults: SimuladoResult[]): void => {
  try {
    if (!Array.isArray(remoteResults) || remoteResults.length === 0) return;
    const current = getStoredSimulados();
    const byId = new Map<string, SimuladoResult>();
    for (const s of current) byId.set(s.id, s);
    for (const s of remoteResults) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
    const merged = Array.from(byId.values()).slice(0, 20);
    localStorage.setItem(SIMULADOS_KEY, JSON.stringify(merged));
  } catch (e) {
    console.error('Failed to merge remote simulados', e);
  }
};

export const calculatePerformanceMetrics = () => {
  const answers = getStoredAnswers();
  const totalAnswered = answers.length;
  const totalCorrect = answers.filter(a => a.isCorrect).length;
  const totalIncorrect = totalAnswered - totalCorrect;
  const accuracyPercent = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  const todayAnswered = answers.filter(a => a.timestamp >= todayTimestamp).length;

  const disciplineStats: Record<string, { total: number; correct: number; percent: number }> = {};
  for (const a of answers) {
    if (!disciplineStats[a.disciplineId]) {
      disciplineStats[a.disciplineId] = { total: 0, correct: 0, percent: 0 };
    }
    disciplineStats[a.disciplineId].total += 1;
    if (a.isCorrect) disciplineStats[a.disciplineId].correct += 1;
  }

  for (const disc in disciplineStats) {
    const item = disciplineStats[disc];
    item.percent = Math.round((item.correct / item.total) * 100);
  }

  return {
    totalAnswered,
    totalCorrect,
    totalIncorrect,
    accuracyPercent,
    todayAnswered,
    disciplineStats
  };
};

export const resetUserProgress = (): void => {
  try {
    localStorage.removeItem(ANSWERS_KEY);
    localStorage.removeItem(SIMULADOS_KEY);
  } catch (e) {
    console.error('Failed to reset', e);
  }
};
