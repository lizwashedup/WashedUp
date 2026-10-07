import type { CreatorPageScope } from './creatorPageReview';
// Navigation intent only: never substitutes for the directory's fresh event read.
const savedEvents = new Map<string, string>();
const key = (pageId: string, userId: string) => `${userId}:${pageId}`;
export function rememberSavedCreatorEvent(pageId: string, eventId: string, scope: CreatorPageScope) {
  if (scope.isCurrent()) savedEvents.set(key(pageId, scope.userId), eventId);
}
export function takeSavedCreatorEvent(pageId: string, scope: CreatorPageScope): string | undefined {
  if (!scope.isCurrent()) return undefined;
  const id = key(pageId, scope.userId), eventId = savedEvents.get(id);
  savedEvents.delete(id);
  return eventId;
}
