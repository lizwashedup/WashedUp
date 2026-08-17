export type CommunityRouteDecision =
  | { allowed: true }
  | { allowed: false; redirect: '/(tabs)/explore' };

/**
 * Grant-gated exception (mirrors app/(creator)/_layout.tsx's own bypass,
 * 8-17): a real grant-holding creator is admitted even while the flag is
 * off, same as the creator shell itself, so their own rooms and public-page
 * previews (linked from app/(creator)/menu.tsx and app/creator/edit-page.tsx)
 * keep working. hasGrant defaults to false so a caller has to opt in; it
 * does not change what an ungranted visitor sees, who still bounces to
 * explore exactly as before.
 */
export function communityRouteDecision(enabled: boolean, hasGrant: boolean = false): CommunityRouteDecision {
  return enabled || hasGrant ? { allowed: true } : { allowed: false, redirect: '/(tabs)/explore' };
}
