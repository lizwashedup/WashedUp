/** The feed supplies outsider availability. Total attendance and Circle size
 * are not a substitute: Circle members are outside the public allowance. */
export type CircleCardSource = {
  circle_id?: string | null;
  circle_visibility?: 'circle_only' | 'open' | null;
  circle_metadata_known?: boolean;
  stranger_cap?: number | null;
  spots_remaining?: number | null;
};
export function circlePlanCardState(plan: CircleCardSource) {
  const kind = plan.circle_metadata_known === false ? 'unknown' : plan.circle_id
    ? plan.circle_visibility === 'open' ? 'open' : plan.circle_visibility === 'circle_only' ? 'private' : 'unknown'
    : 'ordinary';
  const cap = Number.isInteger(plan.stranger_cap) && plan.stranger_cap! >= 2 && plan.stranger_cap! <= 7 ? plan.stranger_cap! : null;
  const remaining = kind === 'open' && cap !== null && Number.isInteger(plan.spots_remaining) && plan.spots_remaining! >= 0 && plan.spots_remaining! <= cap
    ? plan.spots_remaining! : null;
  return {kind, cap, remaining,
    footer: kind === 'private' ? 'Circle members only' : remaining === 0 ? 'No open spots' : remaining !== null ? `${remaining} ${remaining === 1 ? 'spot' : 'spots'} open` : 'Check availability',
  } as const;
}
