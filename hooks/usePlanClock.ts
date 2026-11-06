import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getPlanCutoff } from '../lib/planTime';

type TimedPlan = { start_time: string; end_time?: string | null };

/** Refresh at a visible plan's start/end, and when returning from background.
 * No polling or provider requests. Long waits respect the platform timer limit. */
export function usePlanClock(plans: readonly TimedPlan[]): number {
  const [revision, refresh] = useState(0);
  const now = Date.now();
  let next = Infinity;
  for (const plan of plans) {
    for (const time of [Date.parse(plan.start_time), getPlanCutoff(plan.start_time, plan.end_time)]) {
      if (time > now && time < next) next = time;
    }
  }
  useEffect(() => {
    // Use the boundary selected at render. If the JS thread was busy during
    // commit, schedule an immediate refresh for the already elapsed boundary.
    const delay = Math.min(Math.max(0, next - Date.now()), 2147483647);
    const timer = Number.isFinite(next) ? setTimeout(() => refresh(value => value + 1), delay) : undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh(value => value + 1);
    });
    return () => { if (timer !== undefined) clearTimeout(timer); subscription.remove(); };
  }, [next, revision]);
  return now;
}
