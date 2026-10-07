import {CreatorPageScopeExpired, type CreatorPageScope} from './creatorPageReview';
import {RequestDeadlineError} from './requestWithDeadline';

type ReuseScope = CreatorPageScope & {reuseSignal?: AbortSignal};

/** Cancellation follows one copy through its entry, media and save work.
 * A retired operation can never continue into another write or clear a journal. */
export function createPageEventReuseOperation(parent: CreatorPageScope, onCancel?: () => void) {
  const controller = new AbortController();
  const parentSignal = (parent as ReuseScope).reuseSignal;
  let active = true;
  const cancel = () => { if (!controller.signal.aborted) { controller.abort(); onCancel?.(); } };
  const scope: ReuseScope = {userId: parent.userId, reuseSignal: controller.signal,
    isCurrent: () => active && !controller.signal.aborted && parent.isCurrent()};
  parentSignal?.addEventListener('abort', cancel);
  if (parentSignal?.aborted) cancel();
  async function wait<T>(pending: PromiseLike<T>, milliseconds?: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = () => {};
    try {
      const stopped = new Promise<never>((_, reject) => {
        stop = () => reject(new CreatorPageScopeExpired());
        controller.signal.addEventListener('abort', stop);
        if (!scope.isCurrent()) stop();
        if (milliseconds !== undefined) timer = setTimeout(() => {
          reject(new RequestDeadlineError()); cancel();
        }, milliseconds);
      });
      const value = await Promise.race([Promise.resolve(pending), stopped]);
      if (!scope.isCurrent()) throw new CreatorPageScopeExpired();
      return value;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.signal.removeEventListener('abort', stop);
    }
  }
  return {scope, cancel, wait, finish: () => { active = false; parentSignal?.removeEventListener('abort', cancel); }};
}

/** Bound network waits inside journal queues. Storage writes remain serialized
 * until settled; timing one out must never let a late write replace a new journal.
 * Media byte transfers keep their existing progress-based stall deadlines. */
export async function pageEventReuseNetwork<T>(parent: CreatorPageScope, work: (scope: CreatorPageScope) => PromiseLike<T>, milliseconds = 12_000): Promise<T> {
  const operation = createPageEventReuseOperation(parent);
  try {
    if (!operation.scope.isCurrent()) throw new CreatorPageScopeExpired();
    return await operation.wait(work(operation.scope), milliseconds);
  } finally { operation.finish(); }
}
