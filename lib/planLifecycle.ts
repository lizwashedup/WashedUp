import { isPlanPast } from './planTime';

export type PlanTerminalStatus = 'cancelled' | 'completed';
export type PlanLifecycleInput = {
  status?: unknown;
  startTime: string | Date;
  endTime?: string | Date | null;
};

/** Match the saved entry triggers' lower(coalesce(status, '')) exactly.
 * Unknown data must not manufacture a cancellation/completion label. */
export function getPlanTerminalStatus(status: unknown): PlanTerminalStatus | null {
  if (typeof status !== 'string') return null;
  const value = status.toLowerCase();
  return value === 'cancelled' || value === 'completed' ? value : null;
}

/** Lifecycle alone is not permission to join: keep the caller's visibility,
 * membership, eligibility, capacity and successful-read gates separately. */
export function getPlanLifecycle(plan: PlanLifecycleInput, now: string | Date | number = Date.now()) {
  const terminalStatus = getPlanTerminalStatus(plan.status);
  const isPast = isPlanPast(plan.startTime, plan.endTime, now);
  return { terminalStatus, isPast, isClosed: terminalStatus !== null || isPast };
}
