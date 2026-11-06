import type { QueryClient } from '@tanstack/react-query';
import { planReviewDestination } from './planCopyReview';

/** Start a fresh form with this one removable person selected. The handoff
 * belongs to the initiating member and cannot change a form in the Post tab. */
export function buildComposerWithPerson(
  client: QueryClient, viewerId: string, personId: string, name: string | null, photo: string | null,
): string {
  const prefill: Record<string, string> = { prefillInvitePersonId: personId };
  if (name?.trim()) prefill.prefillInvitePersonName = name.trim();
  if (photo) prefill.prefillInvitePersonPhoto = photo;
  const {pathname, params} = planReviewDestination(client, viewerId, prefill);
  return `${pathname}?reviewId=${encodeURIComponent(params.reviewId)}`;
}
