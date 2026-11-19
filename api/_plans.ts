import type { PremiumAccessEvaluation } from './_premiumValidity.js';

export type PlanId = 'free' | 'monthly' | 'annual';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  price: number;
  cycle: 'MONTHLY' | 'YEARLY' | null;
  installmentCount: number | null;
  installmentValue: number | null;
  billingLabel: string;
  checkoutEnabled: boolean;
}

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Plano Gratuito',
    price: 0,
    cycle: null,
    installmentCount: null,
    installmentValue: null,
    billingLabel: 'Gratuito',
    checkoutEnabled: false,
  },
  monthly: {
    id: 'monthly',
    name: 'Plano Premium Mensal',
    price: 29.9,
    cycle: 'MONTHLY',
    installmentCount: null,
    installmentValue: null,
    billingLabel: 'R$ 29,90 / mês',
    checkoutEnabled: true,
  },
  annual: {
    id: 'annual',
    name: 'Plano Premium Anual',
    price: 249.0,
    cycle: 'YEARLY',
    installmentCount: 12,
    installmentValue: 20.75,
    billingLabel: 'R$ 249,00 / ano (até 12x de R$ 20,75)',
    checkoutEnabled: false,
  },
};

export function getPaidPlansCatalog(): PlanDefinition[] {
  return [PLAN_CATALOG.monthly, PLAN_CATALOG.annual];
}

export function resolvePlanIdFromValueOrCycle(params: {
  cycle?: unknown;
  value?: unknown;
  planId?: unknown;
}): PlanId | null {
  const rawPlanId = String(params.planId || '').trim().toLowerCase();
  if (rawPlanId === 'annual' || rawPlanId === 'yearly' || rawPlanId === 'anual') {
    return 'annual';
  }
  if (rawPlanId === 'monthly' || rawPlanId === 'mensal') {
    return 'monthly';
  }

  const rawCycle = String(params.cycle || '').trim().toUpperCase();
  if (rawCycle === 'YEARLY') return 'annual';
  if (rawCycle === 'MONTHLY') return 'monthly';

  const numValue = Number(params.value);
  if (Number.isFinite(numValue) && numValue > 0) {
    if (numValue >= 200) return 'annual';
    return 'monthly';
  }

  return null;
}

export function resolveUserPlanDetails(params: {
  userDocData: any;
  asaasSubscription?: any;
  validity: PremiumAccessEvaluation;
}): PlanDefinition {
  const { userDocData, asaasSubscription, validity } = params;

  const detectedFromSub = asaasSubscription
    ? resolvePlanIdFromValueOrCycle({
        cycle: asaasSubscription.cycle,
        value: asaasSubscription.value,
      })
    : null;

  if (detectedFromSub) {
    return PLAN_CATALOG[detectedFromSub];
  }

  const detectedFromUser = resolvePlanIdFromValueOrCycle({
    planId: userDocData?.planId,
    cycle: userDocData?.planCycle,
    value: userDocData?.planValue,
  });

  if (detectedFromUser && (validity.isPremium || validity.subscriptionStatus !== 'NONE')) {
    return PLAN_CATALOG[detectedFromUser];
  }

  const hasPaidSubscriptionContext =
    validity.isPremium ||
    validity.subscriptionStatus !== 'NONE' ||
    Boolean(userDocData?.subscriptionId);

  if (hasPaidSubscriptionContext) {
    return PLAN_CATALOG.monthly;
  }

  return PLAN_CATALOG.free;
}
