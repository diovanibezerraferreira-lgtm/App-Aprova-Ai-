export type SubscriptionLifecycleStatus =
  | 'NONE'
  | 'PENDING'
  | 'ACTIVE'
  | 'OVERDUE'
  | 'CANCELLED';

const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export interface PremiumAccessEvaluation {
  isPremium: boolean;
  subscriptionStatus: SubscriptionLifecycleStatus;
  premiumUntil: string | null;
  isCancelledWithActiveAccess: boolean;
  isExpired: boolean;
}

export function normalizeSubscriptionStatus(raw?: unknown): SubscriptionLifecycleStatus {
  const upper = String(raw || 'NONE').trim().toUpperCase();
  if (
    upper === 'NONE' ||
    upper === 'PENDING' ||
    upper === 'ACTIVE' ||
    upper === 'OVERDUE' ||
    upper === 'CANCELLED'
  ) {
    return upper;
  }
  return 'NONE';
}

export function getTodaySaoPauloYmd(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

export function parseAsaasDateYmd(raw?: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function toSaoPauloEndOfDayIso(ymd: string): string {
  return new Date(`${ymd}T23:59:59.999-03:00`).toISOString();
}

export function parseDateTimestamp(raw?: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }

  if (typeof raw === 'object' && raw !== null) {
    const anyRaw = raw as { toDate?: () => Date; seconds?: number; _seconds?: number };
    if (typeof anyRaw.toDate === 'function') {
      const d = anyRaw.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
    }
    const sec = typeof anyRaw.seconds === 'number' ? anyRaw.seconds : anyRaw._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      return sec * 1000;
    }
    return null;
  }

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(`${trimmed}T23:59:59.999-03:00`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function daysInMonthUtc(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function addMonthsToYmd(ymd: string, months: number): string {
  const [yStr, mStr, dStr] = ymd.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonthUtc(targetYear, targetMonth);
  const targetDay = Math.min(day, maxDay);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(
    targetDay
  ).padStart(2, '0')}`;
}

export function addDaysToYmd(ymd: string, days: number): string {
  const [yStr, mStr, dStr] = ymd.split('-');
  const dt = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr) + days));
  return dt.toISOString().slice(0, 10);
}

function getCycleMonths(cycle?: unknown): number {
  const upper = String(cycle || 'MONTHLY').trim().toUpperCase();
  switch (upper) {
    case 'BIMONTHLY':
      return 2;
    case 'QUARTERLY':
      return 3;
    case 'SEMIANNUALLY':
      return 6;
    case 'YEARLY':
      return 12;
    case 'MONTHLY':
    default:
      return 1;
  }
}

function pickLaterYmd(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function computePaidPeriodEndIso(params: {
  paymentDueDate?: unknown;
  paymentDate?: unknown;
  confirmedDate?: unknown;
  clientPaymentDate?: unknown;
  subscriptionNextDueDate?: unknown;
  subscriptionCycle?: unknown;
  existingPremiumUntil?: unknown;
  nowMs?: number;
}): string {
  const nowMs = params.nowMs ?? Date.now();
  const dueYmd = parseAsaasDateYmd(params.paymentDueDate);
  const paidYmd =
    parseAsaasDateYmd(params.confirmedDate) ||
    parseAsaasDateYmd(params.paymentDate) ||
    parseAsaasDateYmd(params.clientPaymentDate);

  const baseYmd = pickLaterYmd(dueYmd, paidYmd) || getTodaySaoPauloYmd(nowMs);
  const cycleUpper = String(params.subscriptionCycle || 'MONTHLY').trim().toUpperCase();

  let cycleEndYmd =
    cycleUpper === 'WEEKLY'
      ? addDaysToYmd(baseYmd, 7)
      : addMonthsToYmd(baseYmd, getCycleMonths(cycleUpper));

  const subNextDueYmd = parseAsaasDateYmd(params.subscriptionNextDueDate);
  if (subNextDueYmd && subNextDueYmd > baseYmd && subNextDueYmd > cycleEndYmd) {
    cycleEndYmd = subNextDueYmd;
  }

  const computedIso = toSaoPauloEndOfDayIso(cycleEndYmd);
  const computedMs = Date.parse(computedIso);

  // Never shorten an already granted future validity due to an older/out-of-order payment event
  const existingMs = parseDateTimestamp(params.existingPremiumUntil);
  if (existingMs !== null && existingMs > computedMs) {
    return new Date(existingMs).toISOString();
  }

  return computedIso;
}

/**
 * Fallback for legacy active records created before `premiumUntil` existed.
 * Only infers a 1-month period if at least one payment/due date is stored on the document.
 */
export function resolveFallbackPremiumUntilIso(userData: any): string | null {
  if (!userData || userData.isPremium !== true) return null;

  const dueYmd = parseAsaasDateYmd(userData.subscriptionDueDate);
  const lastPayYmd = parseAsaasDateYmd(userData.lastPaymentDate);
  const baseYmd = pickLaterYmd(dueYmd, lastPayYmd);
  if (!baseYmd) return null;

  return toSaoPauloEndOfDayIso(addMonthsToYmd(baseYmd, 1));
}

export function evaluatePremiumAccess(
  userData: any,
  nowMs: number = Date.now()
): PremiumAccessEvaluation {
  if (!userData || typeof userData !== 'object') {
    return {
      isPremium: false,
      subscriptionStatus: 'NONE',
      premiumUntil: null,
      isCancelledWithActiveAccess: false,
      isExpired: false,
    };
  }

  const subscriptionStatus = normalizeSubscriptionStatus(userData.subscriptionStatus);
  const rawPremiumUntilMs = parseDateTimestamp(userData.premiumUntil);
  const premiumUntilIso =
    rawPremiumUntilMs !== null ? new Date(rawPremiumUntilMs).toISOString() : null;

  if (rawPremiumUntilMs !== null) {
    const withinPaidPeriod = rawPremiumUntilMs > nowMs;
    const isPremium =
      userData.isPremium === true && withinPaidPeriod && subscriptionStatus !== 'NONE';
    const isExpired = userData.isPremium === true && !withinPaidPeriod;

    return {
      isPremium,
      subscriptionStatus,
      premiumUntil: premiumUntilIso,
      isCancelledWithActiveAccess: isPremium && subscriptionStatus === 'CANCELLED',
      isExpired,
    };
  }

  // Legacy records without `premiumUntil`: active only while subscriptionStatus === 'ACTIVE'
  const isLegacyPremium = userData.isPremium === true && subscriptionStatus === 'ACTIVE';
  return {
    isPremium: isLegacyPremium,
    subscriptionStatus,
    premiumUntil: null,
    isCancelledWithActiveAccess: false,
    isExpired: false,
  };
}
