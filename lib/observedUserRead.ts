import { supabase } from './supabase';
import { requestWithDeadline } from './requestWithDeadline';

type UserResult = Awaited<ReturnType<typeof supabase.auth.getUser>>;
let pending: Promise<UserResult> | null = null;

/** Share only an IN-FLIGHT server check. Auth uses a serial lock: launching
 * one getUser per mounted reader queues identical network requests ahead of
 * the requests that actually load the screen. Completed results are never
 * cached, and each consumer still verifies its own account/visit generation.
 * Callers must have a live auth observer and retire this read on auth events
 * and observer cleanup, including unobserved A -> B -> A transitions. */
export function readObservedUser(): Promise<UserResult> {
  if (pending) return pending;
  const request = requestWithDeadline(supabase.auth.getUser(), 12_000);
  pending = request;
  const clear = () => { if (pending === request) pending = null; };
  // Handle both outcomes without creating an unhandled rejected finally chain.
  void request.then(clear, clear);
  return request;
}

export function retireObservedUserRead(): void {
  // Do not cancel work another consumer is awaiting. Its own generation guard
  // determines whether it may use the response. A later caller starts fresh.
  pending = null;
}
