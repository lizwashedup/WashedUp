import { supabase } from './supabase';
import { recordParticipationAssent, type ParticipationAssentContext } from './participationTerms';

export type PlanParticipationScope = { viewerId: string; isCurrent: () => boolean };
export class ObsoletePlanParticipation extends Error {}
export class ChangedPlanParticipationAccount extends Error {}
export function requirePlanParticipationCurrent(scope: PlanParticipationScope) {
  if (!scope.isCurrent()) throw new ObsoletePlanParticipation();
}
export async function requirePlanParticipationAccount(scope: PlanParticipationScope) {
  requirePlanParticipationCurrent(scope);
  const result = await supabase.auth.getUser();
  requirePlanParticipationCurrent(scope);
  if (result.error) throw new Error('Couldn’t check your account. Try again.');
  if (result.data.user?.id !== scope.viewerId) throw new ChangedPlanParticipationAccount('Couldn’t check your account. Try again.');
}

/** Retain the server-owned terms/version semantics; bind the context to the
 * account and notice visit that actually initiated this assent. */
export async function recordScopedPlanAssent(context: ParticipationAssentContext, scope: PlanParticipationScope) {
  await requirePlanParticipationAccount(scope);
  const ok = await recordParticipationAssent(context);
  requirePlanParticipationCurrent(scope);
  return ok;
}
