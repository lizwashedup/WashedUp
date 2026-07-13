import { supabase } from './supabase';

// Server-driven feature flags (see supabase migration remote_flags). One cached
// read per session at the trigger. If the read fails (offline, or the table
// isn't migrated yet), fall back to the build-time env value for `enabled`
// only, so an unreachable backend degrades to the committed default, never to
// silently-on.
export interface RemoteFlag {
  enabled: boolean;
  rollout_pct: number; // 0-100
  holdout_pct: number; // 0-100
}

const cache = new Map<string, RemoteFlag>();

function clampPct(n: unknown): number {
  const v = typeof n === 'number' ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export async function getRemoteFlag(key: string, fallbackEnabled: boolean): Promise<RemoteFlag> {
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const { data, error } = await supabase
      .from('remote_flags')
      .select('enabled, rollout_pct, holdout_pct')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) throw error ?? new Error('remote_flag_missing');
    const flag: RemoteFlag = {
      enabled: !!data.enabled,
      rollout_pct: clampPct(data.rollout_pct),
      holdout_pct: clampPct(data.holdout_pct),
    };
    cache.set(key, flag); // cache only a real read; fallback is never cached
    return flag;
  } catch {
    return { enabled: fallbackEnabled, rollout_pct: fallbackEnabled ? 100 : 0, holdout_pct: 0 };
  }
}
