import type { CreatorPageScope } from './creatorPageReview';
import { requestWithDeadline } from './requestWithDeadline';

/** Bound the UI waiter, never the service's durable attempt or exclusive lock.
 * A timed-out operation may still settle; its scope then prevents another step. */
export async function waitForCommunityJoin<T>(scope: CreatorPageScope, operation: (owned: CreatorPageScope) => Promise<T>): Promise<T> {
  let active = true;
  const owned = { userId: scope.userId, isCurrent: () => active && scope.isCurrent() };
  try {
    if (!owned.isCurrent()) throw Error('This visit has changed.');
    return await requestWithDeadline(operation(owned), 12_000);
  } finally { active = false; }
}
