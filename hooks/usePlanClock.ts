import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getPlanCutoff } from '../lib/planTime';

type TimedPlan = { start_time: string; end_time?: string | null };

/** Refresh at a visible plan's start/end, and when returning from background.
 * No polling or provider requests. Long waits respect the platform timer limit. */
export function usePlanClock(plans: readonly TimedPlan[]): number {
  const [revision, refresh] = useState(0);
  const transitions = JSON.stringify(plans.flatMap(plan => [
    Date.parse(plan.start_time), getPlanCutoff(plan.start_time, plan.end_time),
  ]).filter(Number.isFinite).sort((a, b) => a - b));
  useEffect(() => {
    const next = (JSON.parse(transitions) as number[]).find(time => time > Date.now());
    const timer = next === undefined ? undefined : setTimeout(() => refresh(value => value + 1), Math.min(next - Date.now(), 2147483647));
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh(value => value + 1);
    });
    return () => { if (timer !== undefined) clearTimeout(timer); subscription.remove(); };
  }, [transitions, revision]);
  return Date.now();
}
