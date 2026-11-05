import { requestWithDeadline } from '../requestWithDeadline';

/** Bound a read without replacing a caller's React Query abort signal.
 * Some request thenables (and cached promises) expose abortSignal themselves.
 * A fresh promise deliberately leaves cancellation with the existing caller;
 * late completion after the deadline cannot settle the returned read again.
 * Do not use this for dispatched writes, whose outcome may be unconfirmed.
 */
export function readCircleRequest<T>(request: PromiseLike<T>): Promise<T> {
  const pending = new Promise<T>((resolve, reject) => { request.then(resolve, reject); });
  return requestWithDeadline(pending, 12_000);
}
