import type { QueryClient } from '@tanstack/react-query';

let sequence = 0;
export const nextPlanReviewId = () => `${Date.now()}-${++sequence}`;
export const planReviewKey = (viewerId: string, reviewId: string) =>
  ['similar-plan-review', viewerId, reviewId] as const;

/** The caller has checked this source and built its flow-specific prefill.
 * Give the review its own composer. Only the opaque ID travels in navigation. */
export function planReviewDestination(client: QueryClient, viewerId: string,
  prefill: Record<string, string>, reviewId = nextPlanReviewId()) {
  client.setQueryData(planReviewKey(viewerId, reviewId), prefill);
  return { pathname: '/similar-plan' as const, params: { reviewId } };
}
